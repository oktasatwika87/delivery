/**
 * Outbox aksi driver (reject, cancel, collect_cod), supaya aksi tetap bisa
 * dicatat tanpa sinyal.
 *
 * Aksi ditulis ke tabel pending_actions lokal, lalu dikirim lewat
 * drainPendingActions. Pengiriman berjalan berurutan dan mengambil aksi
 * 'pending' dan 'syncing' (aksi yang terputus di tengah pengiriman, misalnya
 * karena aplikasi ditutup paksa).
 *
 * Hasil tiap aksi dipilah dari jenis galatnya (UnauthorizedError, atau ApiError
 * dengan status dan code), bukan dari teks pesan:
 * - sukses: aksi dihapus; untuk collect_cod, payment dari respons ditulis ke
 *   baris lokal di batch yang sama, jadi layar detail tidak menunggu pull;
 * - 409 ORDER_REASSIGNED dan COD_ALREADY_CAPTURED: aksi dihapus dan alasannya
 *   ditulis ke last_conflict_reason order itu;
 * - 409 lain untuk cancel dan reject: handleVersionConflict;
 * - 4xx lain (termasuk 409 lain untuk COD): aksi menjadi 'failed' dan tidak
 *   dikirim lagi sampai driver memilih Coba lagi di layar detail. Pada COD,
 *   403 ORDER_NOT_ASSIGNED dan 404 menjadi yatim;
 * - 408, 429, 5xx, galat jaringan, batas waktu, dan 401: aksi kembali
 *   'pending'. Galat jaringan, batas waktu, dan 401 juga menghentikan putaran
 *   itu.
 */

import { Model, Q } from '@nozbe/watermelondb';
import type { Database } from '@nozbe/watermelondb';
import type { Payment } from '@delivery/shared';

import { database } from '../db';
import { PendingActionModel, type CancelPayload, type CollectCodPayload } from '../db/models/PendingActionModel';
import { OrderModel } from '../db/models/OrderModel';
import { PaymentModel } from '../db/models/PaymentModel';
import { syncEvents } from './syncEvents';
import { getCurrentUserId } from './session';
import { rejectOrder, cancelOrder, collectCodOrder, flagOrphanedCod, ApiError, UnauthorizedError } from './client';
import { generateCodIdempotencyKey } from './idempotency';
import { syncCoordinator } from './coordinator';

export interface EnqueueResult {
  success: boolean;
  pendingActionId?: string;
  error?: string;
}

/**
 * Hasil pemrosesan satu aksi.
 *
 * - 'success': aksi diterima server dan dihapus.
 * - 'conflict': 409 yang ditangani (alasan ditulis ke order, atau
 *   handleVersionConflict); aksi dihapus.
 * - 'orphaned': COD untuk order yang sudah tidak ditugaskan ke driver ini;
 *   aksi menjadi 'orphaned_needs_review'.
 * - 'failed': aksi tidak terkirim di putaran ini, entah kembali 'pending'
 *   (dikirim lagi nanti) atau menjadi 'failed' (menunggu Coba lagi).
 *
 * `stopDrain` true berarti putaran berhenti setelah aksi ini (galat jaringan,
 * batas waktu, atau 401); aksi sisanya tetap 'pending'.
 */
export interface ProcessResult {
  pendingActionId: string;
  status: 'success' | 'conflict' | 'orphaned' | 'failed';
  error?: string;
  stopDrain?: boolean;
}

/**
 * Enqueue a reject action for an order.
 * Call this when driver taps "Tolak" while offline.
 *
 * @param orderId - The order being rejected
 * @param expectedVersion - Current serverVersion of the order
 */
export async function enqueueReject(orderId: string, expectedVersion: number): Promise<EnqueueResult> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Generate UUID dulu, prepareCreateFromDirtyRaw butuh ID yang sudah jadi.
    const pendingActionId = generateUUID();

    await database.write(async () => {
      // Kunci HARUS nama kolom di schema.ts (snake_case). sanitizedRaw
      // di RawRecord/index.js cuma iterasi tableSchema.columnArray -
      // kunci tak dikenal di-drop, kolom snake_case jatuh ke default
      // ('' / 0). Lihat outbox.regression.spec.ts untuk bukti.
      //
      // created_at dan updated_at harus diisi di sini. Kalau tidak, nilainya 0:
      // aksi baru langsung dianggap basi dan urutan kirim outbox tidak terjamin.
      const now = Date.now();
      const preparedRecord = database.get<PendingActionModel>('pending_actions').prepareCreateFromDirtyRaw({
        id: pendingActionId,
        _status: 'synced',
        _changed: '',
        action_type: 'reject',
        target_order_id: orderId,
        expected_version: expectedVersion,
        idempotency_key: `reject:${orderId}:${userId}`,
        // payload_json optional, default null.
        payload_json: null,
        status: 'pending',
        created_at: now,
        updated_at: now,
      });
      await database.batch(preparedRecord);

      // Mark order with pending action flag
      const order = await database.get<OrderModel>('orders').find(orderId);
      await order.update((o) => {
        (o as any)._raw._status = 'synced'; // not dirty, just flagging
      });
    });

    console.log(`[outbox] enqueued reject action for order ${orderId}, pendingActionId=${pendingActionId}`);
    return { success: true, pendingActionId };
  } catch (err) {
    console.error('[outbox] failed to enqueue reject:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Enqueue a cancel action for an order.
 * Call this when driver taps "Batal" while offline.
 *
 * @param orderId - The order being cancelled
 * @param expectedVersion - Current serverVersion of the order
 * @param reason - Optional cancellation reason
 */
export async function enqueueCancel(
  orderId: string,
  expectedVersion: number,
  reason?: string
): Promise<EnqueueResult> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return { success: false, error: 'Not authenticated' };
    }

    const payload: CancelPayload = reason ? { reason } : {};
    const pendingActionId = generateUUID();

    await database.write(async () => {
      // Kunci snake_case (lihat catatan di enqueueReject). payload_json
      // adalah kolom string berisi JSON - prepareCreateFromDirtyRaw
      // bypass decorator @json PendingActionModel, jadi nilai raw
      // harus JSON.stringify (atau null untuk optional).
      // created_at dan updated_at: lihat catatan di enqueueReject.
      const now = Date.now();
      const preparedRecord = database.get<PendingActionModel>('pending_actions').prepareCreateFromDirtyRaw({
        id: pendingActionId,
        _status: 'synced',
        _changed: '',
        action_type: 'cancel',
        target_order_id: orderId,
        expected_version: expectedVersion,
        idempotency_key: `cancel:${orderId}:${userId}:${Date.now()}`,
        payload_json: JSON.stringify(payload),
        status: 'pending',
        created_at: now,
        updated_at: now,
      });
      await database.batch(preparedRecord);
    });

    console.log(`[outbox] enqueued cancel action for order ${orderId}, reason=${reason}, pendingActionId=${pendingActionId}`);
    return { success: true, pendingActionId };
  } catch (err) {
    console.error('[outbox] failed to enqueue cancel:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Enqueue a COD collection action for an order.
 * Call this when driver taps "Terima Cash COD" while offline.
 * The idempotency key is GENERATED HERE (not later during sync) to ensure
 * stability across retries.
 *
 * @param orderId - The order for which COD is collected
 * @param amountCents - Amount collected in cents
 */
export async function enqueueCollectCod(
  orderId: string,
  amountCents: number
): Promise<EnqueueResult> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Generate idempotency key NOW, must be stable across retries
    const idempotencyKey = await generateCodIdempotencyKey(orderId);
    const payload: CollectCodPayload = { amountCents };
    const pendingActionId = generateUUID();

    await database.write(async () => {
      // Kunci snake_case (lihat catatan di enqueueReject). payload_json
      // string berisi JSON - bypass decorator @json.
      // created_at dan updated_at: lihat catatan di enqueueReject.
      const now = Date.now();
      const preparedRecord = database.get<PendingActionModel>('pending_actions').prepareCreateFromDirtyRaw({
        id: pendingActionId,
        _status: 'synced',
        _changed: '',
        action_type: 'collect_cod',
        target_order_id: orderId,
        expected_version: 0, // COD tidak butuh version check
        idempotency_key: idempotencyKey,
        payload_json: JSON.stringify(payload),
        status: 'pending',
        created_at: now,
        updated_at: now,
      });
      await database.batch(preparedRecord);
    });

    console.log(`[outbox] enqueued collect_cod action for order ${orderId}, amount=${amountCents}, idempotencyKey=${idempotencyKey}`);
    return { success: true, pendingActionId };
  } catch (err) {
    console.error('[outbox] failed to enqueue collect_cod:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Check if an order has any pending actions in the outbox.
 * Used by UI to show a badge/indicator.
 */
export async function hasPendingAction(orderId: string): Promise<boolean> {
  const pending = await database
    .get<PendingActionModel>('pending_actions')
    .query(
      Q.where('target_order_id', orderId),
      Q.where('status', Q.oneOf(['pending', 'syncing']))
    )
    .fetch();
  return pending.length > 0;
}

/**
 * Get all pending actions for an order.
 */
export async function getPendingActionsForOrder(orderId: string): Promise<PendingActionModel[]> {
  return database
    .get<PendingActionModel>('pending_actions')
    .query(Q.where('target_order_id', orderId))
    .fetch();
}

/**
 * Threshold in milliseconds after which a pending action is considered "stale".
 * 60 minutes.
 */
export const STALE_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Get the age of a pending action in milliseconds.
 * Returns 0 if action is null or has no createdAt.
 * Handles both Date objects and numeric timestamps.
 */
export function getPendingActionAgeMs(action: PendingActionModel | null): number {
  if (!action?.createdAt) return 0;
  const createdAt = action.createdAt;
  // Support both Date objects and numeric timestamps
  const timestamp = typeof createdAt.getTime === 'function' ? createdAt.getTime() : Number(createdAt);
  return Date.now() - timestamp;
}

/**
 * Check if a pending action is stale (older than STALE_THRESHOLD_MS).
 * Stale actions indicate the driver has been offline for a while, UI
 * should show a more prominent warning.
 */
export function isPendingActionStale(action: PendingActionModel | null): boolean {
  return getPendingActionAgeMs(action) > STALE_THRESHOLD_MS;
}

/**
 * Check if an order has any STALE pending actions.
 * Used by UI to show warning styling for orders with old pending actions.
 */
export async function hasStalePendingAction(orderId: string): Promise<boolean> {
  const pending = await database
    .get<PendingActionModel>('pending_actions')
    .query(
      Q.where('target_order_id', orderId),
      Q.where('status', Q.oneOf(['pending', 'syncing']))
    )
    .fetch();

  return pending.some(isPendingActionStale);
}

/**
 * Kirim semua aksi di outbox, urut created_at (yang lama dulu).
 *
 * Pemanggilan berjalan berurutan: kalau pengiriman lain masih jalan, panggilan
 * baru menunggu di antrean tingkat modul, lalu membaca ulang pending_actions.
 * Karena itu aksi 'syncing' yang ditemukan saat mulai pasti sisa pengiriman
 * yang terputus (misalnya aplikasi ditutup paksa) dan ikut dikirim lagi. Tanpa
 * antrean, dua pemanggilan bersamaan bisa mengirim aksi yang sama dua kali.
 *
 * @param db - Database instance (defaults to global database)
 * @returns Array of process results
 */
let drainQueue: Promise<unknown> = Promise.resolve();

export async function drainPendingActions(db: Database = database): Promise<ProcessResult[]> {
  console.log('[outbox] Starting drain of pending actions...');

  // Sambungkan ke ujung antrean. Kalau pengiriman sebelumnya gagal, antrean
  // tetap jalan untuk panggilan berikutnya.
  const next = drainQueue.then(
    () => runDrainOnce(db),
    () => runDrainOnce(db),
  );
  drainQueue = next.catch(() => undefined);
  return next;
}

async function runDrainOnce(db: Database): Promise<ProcessResult[]> {
  const pendingActions = await db
    .get<PendingActionModel>('pending_actions')
    .query(
      Q.where('status', Q.oneOf(['pending', 'syncing'])),
      Q.sortBy('created_at', Q.asc)
    )
    .fetch();

  console.log(`[outbox] Found ${pendingActions.length} pending actions to process`);

  const results: ProcessResult[] = [];

  for (const action of pendingActions) {
    const result = await processPendingAction(action, db);
    results.push(result);
    // Galat jaringan, batas waktu, atau 401: putaran ini berhenti, aksi sisanya
    // tetap 'pending' untuk putaran berikutnya.
    if (result.stopDrain) {
      console.log(`[outbox] Drain stopped after action ${action.id}, ${pendingActions.length - results.length} actions left pending`);
      break;
    }
  }

  console.log(`[outbox] Drain complete: ${results.length} actions processed`);
  return results;
}

/**
 * Process a single pending action.
 */
async function processPendingAction(
  action: PendingActionModel,
  db: Database
): Promise<ProcessResult> {
  console.log(`[outbox] Processing action ${action.id}: ${action.actionType} for order ${action.targetOrderId}`);

  // Mark as syncing
  await db.write(async () => {
    await action.update((row) => {
      row.status = 'syncing';
    });
  });

  try {
    switch (action.actionType) {
      case 'reject':
        return await processReject(action, db);
      case 'cancel':
        return await processCancel(action, db);
      case 'collect_cod':
        return await processCollectCod(action, db);
      default:
        console.warn(`[outbox] Unknown action type: ${action.actionType}`);
        await markActionFailed(action, db, 'Unknown action type');
        return {
          pendingActionId: action.id,
          status: 'failed',
          error: 'Unknown action type',
        };
    }
  } catch (err) {
    // Galat tak terduga di luar pemilah: aksi dikembalikan ke 'pending' supaya
    // tidak hilang.
    console.error(`[outbox] Unexpected error processing action ${action.id}:`, err);
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await resetActionForRetry(action, db, msg);
    } catch (fallbackErr) {
      console.error(`[outbox] resetActionForRetry failed for ${action.id}:`, fallbackErr);
    }
    return {
      pendingActionId: action.id,
      status: 'failed',
      error: msg,
    };
  }
}

/**
 * Kirim aksi reject.
 *
 * Sukses: baris order lokal ditulis dari respons dan aksi dihapus dalam satu
 * batch, supaya order itu kembali terbaca sebagai order pool. Galat dipilah di
 * classifyAndHandleRejectError.
 */
async function processReject(action: PendingActionModel, db: Database): Promise<ProcessResult> {
  try {
    const response = await rejectOrder(action.targetOrderId, action.expectedVersion);
    console.log(`[outbox] Reject succeeded for order ${action.targetOrderId}:`, response);

    // Lookup order lokal lebih dulu (read-only, di luar transaction) supaya
    // bisa di-batch dengan delete pending_action di bawah. Kalau order tidak
    // ada di lokal (sangat jarang, biasanya server data sudah di-pull
    // sebelum sync berikutnya), skip update, delete pending_action saja.
    let orderRow: OrderModel | null = null;
    try {
      orderRow = await db.get<OrderModel>('orders').find(action.targetOrderId);
    } catch (err) {
      console.warn(
        `[outbox] Order ${action.targetOrderId} not found locally for reject write:`,
        err,
      );
    }

    // Single batch: delete pending_action + (kalau ada) update order row lokal.
    await db.write(async () => {
      const ops: Model[] = [action.prepareDestroyPermanently()];
      if (orderRow) {
        ops.push(orderRow.prepareUpdate((r) => {
          r._setRaw('status', response.status);
          r._setRaw('driver_id', null);
          r._setRaw('server_version', response.version);
          r._setRaw('cancelled_by', null);
          r._setRaw('cancel_reason', null);
          r._setRaw('last_conflict_reason', null);
          r._setRaw('last_conflict_at', null);
          r._raw._status = 'synced';
          r._raw._changed = '';
        }));
      }
      await db.batch(...ops);
    });

    // pool-refresh membuat OrdersScreen mengambil ulang daftar Tersedia, karena
    // order ini sekarang ASSIGNED tanpa driver. orderConflict tidak dipancarkan:
    // banner "Status order diperbarui server" hanya untuk perubahan dari luar,
    // bukan untuk aksi driver sendiri yang berhasil.
    syncEvents.emit('pool-refresh', { source: 'reject-success', orderId: action.targetOrderId });

    return { pendingActionId: action.id, status: 'success' };
  } catch (err) {
    return await classifyAndHandleRejectError(action, db, err);
  }
}

/**
 * Pilah galat reject. Aturannya ada di komentar kepala file ini.
 */
async function classifyAndHandleRejectError(
  action: PendingActionModel,
  db: Database,
  err: unknown,
): Promise<ProcessResult> {
  // 401: sesi berakhir. Aksi kembali 'pending' dan putaran berhenti, supaya aksi
  // lain tidak ikut dikirim sebelum login ulang.
  if (err instanceof UnauthorizedError) {
    console.warn(`[outbox] Unauthorized reject ${action.id}: ${err.message}`);
    await resetActionForRetry(action, db, err.message);
    return { pendingActionId: action.id, status: 'failed', error: err.message, stopDrain: true };
  }
  if (err instanceof ApiError) {
    const { status, code } = err;

    // Order sudah pindah ke driver lain atau kembali ke pool.
    if (status === 409 && code === 'ORDER_REASSIGNED') {
      console.warn(`[outbox] Order reassigned: ${action.targetOrderId}`);
      return await writeRejectConflictAndDelete(action, db, 'reassigned');
    }

    if (status === 409 && code === 'COD_ALREADY_CAPTURED') {
      console.warn(`[outbox] Reject after COD captured: ${action.targetOrderId}`);
      return await writeRejectConflictAndDelete(action, db, 'cancel-cod-captured');
    }

    // 409 lain (VERSION_CONFLICT, ORDER_NOT_CANCELLABLE, atau tanpa code).
    if (status === 409) {
      console.warn(`[outbox] 409 on reject for ${action.targetOrderId} (code=${code ?? 'none'})`);
      await handleVersionConflict(action, db, 'Order sudah berubah di server');
      return { pendingActionId: action.id, status: 'conflict', error: 'Order conflict' };
    }

    // 408, 429, 5xx: gangguan sementara, aksi kembali 'pending' dan putaran
    // lanjut.
    if (status === 408 || status === 429 || (status >= 500 && status < 600)) {
      console.warn(`[outbox] Transient ${status} on reject ${action.id}: ${err.message}`);
      await resetActionForRetry(action, db, err.message);
      return { pendingActionId: action.id, status: 'failed', error: err.message };
    }

    // 4xx lain: aksi menjadi 'failed' dan tidak dikirim lagi sampai driver
    // memilih Coba lagi.
    console.warn(`[outbox] Reject rejected with ${status} (${code ?? 'no code'})`);
    await markActionFailed(action, db, err.message);
    return { pendingActionId: action.id, status: 'failed', error: err.message };
  }

  // Selain itu dianggap galat jaringan atau batas waktu: aksi kembali 'pending'
  // dan putaran berhenti.
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[outbox] Unexpected reject error for ${action.id}: ${msg}`);
  await resetActionForRetry(action, db, msg);
  return { pendingActionId: action.id, status: 'failed', error: msg, stopDrain: true };
}

/**
 * Tulis last_conflict_reason dan last_conflict_at ke baris order lokal lalu
 * hapus aksinya, dalam satu batch. Baris ditutup 'synced' supaya kolom lokal
 * ini tidak membuat baris ikut push.
 */
async function writeRejectConflictAndDelete(
  action: PendingActionModel,
  db: Database,
  reason: 'reassigned' | 'cancel-cod-captured',
): Promise<ProcessResult> {
  let orderRow: OrderModel | null = null;
  try {
    orderRow = await db.get<OrderModel>('orders').find(action.targetOrderId);
  } catch (err) {
    console.warn(`[outbox] Order ${action.targetOrderId} not found locally for ${reason} write:`, err);
  }

  await db.write(async () => {
    const ops: Model[] = [action.prepareDestroyPermanently()];
    if (orderRow) {
      ops.push(orderRow.prepareUpdate((r) => {
        r._setRaw('last_conflict_reason', reason);
        r._setRaw('last_conflict_at', Date.now());
        r._raw._status = 'synced';
        r._raw._changed = '';
      }));
    }
    await db.batch(...ops);
  });

  return { pendingActionId: action.id, status: 'conflict', error: reason };
}

/**
 * Kirim aksi cancel. Sama dengan processReject, ditambah cancelledBy dan
 * cancelReason dari respons.
 */
async function processCancel(action: PendingActionModel, db: Database): Promise<ProcessResult> {
  try {
    const payload = action.payloadJson as CancelPayload | null;
    const response = await cancelOrder(action.targetOrderId, action.expectedVersion, payload?.reason);
    console.log(`[outbox] Cancel succeeded for order ${action.targetOrderId}:`, response);

    let orderRow: OrderModel | null = null;
    try {
      orderRow = await db.get<OrderModel>('orders').find(action.targetOrderId);
    } catch (err) {
      console.warn(
        `[outbox] Order ${action.targetOrderId} not found locally for cancel write:`,
        err,
      );
    }

    await db.write(async () => {
      const ops: Model[] = [action.prepareDestroyPermanently()];
      if (orderRow) {
        ops.push(orderRow.prepareUpdate((r) => {
          r._setRaw('status', response.status);
          r._setRaw('driver_id', null);
          r._setRaw('server_version', response.version);
          const cancelledBy = typeof response.cancelledBy === 'string' ? response.cancelledBy : null;
          const cancelReason = typeof response.cancelReason === 'string' ? response.cancelReason : null;
          r._setRaw('cancelled_by', cancelledBy);
          r._setRaw('cancel_reason', cancelReason);
          r._setRaw('last_conflict_reason', null);
          r._setRaw('last_conflict_at', null);
          r._raw._status = 'synced';
          r._raw._changed = '';
        }));
      }
      await db.batch(...ops);
    });

    // Sama seperti processReject: pool-refresh dipancarkan, orderConflict tidak.
    syncEvents.emit('pool-refresh', { source: 'cancel-success', orderId: action.targetOrderId });

    return { pendingActionId: action.id, status: 'success' };
  } catch (err) {
    return await classifyAndHandleCancelError(action, db, err);
  }
}

/**
 * Pilah galat cancel, aturannya sama dengan reject.
 */
async function classifyAndHandleCancelError(
  action: PendingActionModel,
  db: Database,
  err: unknown,
): Promise<ProcessResult> {
  if (err instanceof UnauthorizedError) {
    await resetActionForRetry(action, db, err.message);
    return { pendingActionId: action.id, status: 'failed', error: err.message, stopDrain: true };
  }

  if (err instanceof ApiError) {
    const { status, code } = err;

    if (status === 409 && code === 'ORDER_REASSIGNED') {
      return await writeRejectConflictAndDelete(action, db, 'reassigned');
    }

    if (status === 409 && code === 'COD_ALREADY_CAPTURED') {
      return await writeRejectConflictAndDelete(action, db, 'cancel-cod-captured');
    }

    if (status === 409) {
      await handleVersionConflict(action, db, 'Order sudah berubah di server');
      return { pendingActionId: action.id, status: 'conflict', error: 'Order conflict' };
    }

    if (status === 408 || status === 429 || (status >= 500 && status < 600)) {
      await resetActionForRetry(action, db, err.message);
      return { pendingActionId: action.id, status: 'failed', error: err.message };
    }

    await markActionFailed(action, db, err.message);
    return { pendingActionId: action.id, status: 'failed', error: err.message };
  }

  const msg = err instanceof Error ? err.message : String(err);
  await resetActionForRetry(action, db, msg);
  return { pendingActionId: action.id, status: 'failed', error: msg, stopDrain: true };
}

/**
 * Kirim aksi collect_cod.
 *
 * Sukses: payment dari respons ditulis ke baris lokal (dibuat atau diperbarui)
 * dan aksi dihapus dalam satu batch, jadi tombol Selesai diantar langsung tampil
 * tanpa menunggu pull. Galat dipilah di classifyAndHandleCodError.
 */
async function processCollectCod(action: PendingActionModel, db: Database): Promise<ProcessResult> {
  const payload = action.payloadJson as CollectCodPayload | null;
  if (!payload) {
    await markActionFailed(action, db, 'Missing payload');
    return { pendingActionId: action.id, status: 'failed', error: 'Missing payload' };
  }

  try {
    const response = await collectCodOrder(
      action.targetOrderId,
      payload.amountCents,
      action.idempotencyKey,
    );
    console.log(`[outbox] COD collection succeeded for order ${action.targetOrderId}`);

    const payment = isPayment(response)
      ? response
      : null;
    await deleteActionAndWritePayment(action, db, payment);
    return { pendingActionId: action.id, status: 'success' };
  } catch (err) {
    return await classifyAndHandleCodError(action, db, err, payload);
  }
}

/**
 * Pilah galat collect_cod. Berbeda dengan cancel dan reject: 403
 * ORDER_NOT_ASSIGNED dan 404 menjadi yatim, dan 409 lain menjadi 'failed'.
 */
async function classifyAndHandleCodError(
  action: PendingActionModel,
  db: Database,
  err: unknown,
  payload: CollectCodPayload,
): Promise<ProcessResult> {
  // Yatim: 403 ORDER_NOT_ASSIGNED atau 404. 403 tanpa code (misalnya token yang
  // bukan driver) tidak dianggap yatim.
  if (err instanceof ApiError) {
    const { status, code } = err;

    if ((status === 403 && code === 'ORDER_NOT_ASSIGNED') || status === 404) {
      console.warn(`[outbox] Orphaned COD for ${action.targetOrderId}: ${status} ${code ?? ''}`);
      await markActionOrphaned(action, db);
      flagOrphanedCod(action.targetOrderId, payload.amountCents, action.idempotencyKey)
        .catch((e) => console.warn('[outbox] flagOrphanedCod non-fatal error:', e.message));
      return { pendingActionId: action.id, status: 'orphaned', error: `Order ${status === 404 ? 'not found' : 'not assigned'}` };
    }

    if (status === 409 && code === 'COD_ALREADY_CAPTURED') {
      // COD order ini sudah tercatat dengan kunci lain. Payment di `err.body`
      // ditulis kalau bentuknya benar; aksi dihapus dan alasannya ditulis ke order.
      const payment = extractPaymentFromBody(err.body);
      await db.write(async () => {
        const ops: Model[] = [action.prepareDestroyPermanently()];
        if (payment) {
          ops.push(await prepareUpsertPaymentOp(db, payment));
        }
        let orderRow: OrderModel | null = null;
        try {
          orderRow = await db.get<OrderModel>('orders').find(action.targetOrderId);
        } catch (lookupErr) {
          console.warn(`[outbox] Order ${action.targetOrderId} not found locally for cod-already-captured:`, lookupErr);
        }
        if (orderRow) {
          ops.push(orderRow.prepareUpdate((r) => {
            r._setRaw('last_conflict_reason', 'cod-already-captured');
            r._setRaw('last_conflict_at', Date.now());
            r._raw._status = 'synced';
            r._raw._changed = '';
          }));
        }
        await db.batch(...ops);
      });
      return { pendingActionId: action.id, status: 'conflict', error: 'cod-already-captured' };
    }

    if (status === 409) {
      // 409 lain, misalnya IDEMPOTENCY_KEY_CONFLICT.
      await markActionFailed(action, db, err.message);
      return { pendingActionId: action.id, status: 'failed', error: err.message };
    }

    if (status === 408 || status === 429 || (status >= 500 && status < 600)) {
      await resetActionForRetry(action, db, err.message);
      return { pendingActionId: action.id, status: 'failed', error: err.message };
    }

    if (status === 401) {
      // Jaga-jaga kalau 401 datang sebagai ApiError: perlakuannya sama dengan
      // UnauthorizedError di bawah.
      await resetActionForRetry(action, db, err.message);
      return { pendingActionId: action.id, status: 'failed', error: err.message, stopDrain: true };
    }

    // 4xx lain (400, 403 tanpa code, dst): 'failed'.
    await markActionFailed(action, db, err.message);
    return { pendingActionId: action.id, status: 'failed', error: err.message };
  }

  // 401: aksi kembali 'pending' dan putaran berhenti.
  if (err instanceof UnauthorizedError) {
    await resetActionForRetry(action, db, err.message);
    return { pendingActionId: action.id, status: 'failed', error: err.message, stopDrain: true };
  }

  // Selain itu dianggap galat jaringan atau batas waktu.
  const msg = err instanceof Error ? err.message : String(err);
  await resetActionForRetry(action, db, msg);
  return { pendingActionId: action.id, status: 'failed', error: msg, stopDrain: true };
}

/**
 * Pemeriksa bentuk `Payment` untuk data dari server: setiap field wajib ada
 * dan jenisnya sesuai.
 */
function isPayment(value: unknown): value is Payment {
  if (!value || typeof value !== 'object') return false;
  if (!('id' in value) || typeof value.id !== 'string') return false;
  if (!('orderId' in value) || typeof value.orderId !== 'string') return false;
  if (!('idempotencyKey' in value) || typeof value.idempotencyKey !== 'string') return false;
  if (!('method' in value) || typeof value.method !== 'string') return false;
  if (!('status' in value) || typeof value.status !== 'string') return false;
  if (!('amountCents' in value) || typeof value.amountCents !== 'number') return false;
  if (!('currency' in value) || typeof value.currency !== 'string') return false;
  if (!('kind' in value) || typeof value.kind !== 'string') return false;
  if (!('createdAt' in value) || typeof value.createdAt !== 'string') return false;
  if (!('updatedAt' in value) || typeof value.updatedAt !== 'string') return false;
  if (!('version' in value) || typeof value.version !== 'number') return false;
  return true;
}

/**
 * Baris payment lokal untuk prepareCreateFromDirtyRaw: kunci snake_case sesuai
 * kolom tabel payments, waktu dari server dalam milidetik.
 */
function buildPaymentRaw(payment: Payment): Record<string, unknown> {
  const createdAtMs = Date.parse(payment.createdAt);
  const updatedAtMs = Date.parse(payment.updatedAt);
  return {
    id: payment.id,
    _status: 'synced',
    _changed: '',
    order_id: payment.orderId,
    idempotency_key: payment.idempotencyKey,
    method: payment.method,
    status: payment.status,
    amount_cents: payment.amountCents,
    currency: payment.currency,
    kind: payment.kind,
    external_ref: payment.externalRef ?? null,
    server_version: payment.version,
    created_at: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
    updated_at: Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now(),
  };
}

/**
 * Ambil payment dari body ApiError, kalau ada dan bentuknya benar.
 */
function extractPaymentFromBody(body: unknown): Payment | null {
  if (!body || typeof body !== 'object' || !('payment' in body)) return null;
  return isPayment(body.payment) ? body.payment : null;
}

/**
 * Siapkan penulisan baris payment dari data server; dipanggil di dalam
 * database.write. Baris yang sudah ada (misalnya sudah dibawa pull karena
 * respons COD sempat hilang) diperbarui: membuat baris dengan id yang sama
 * ditolak database dan membuat aksinya terus diulang.
 */
async function prepareUpsertPaymentOp(
  db: Database,
  payment: Payment,
): Promise<Model> {
  const existing = await db.get<PaymentModel>('payments')
    .find(payment.id)
    .catch(() => null);
  if (existing) {
    return existing.prepareUpdate((r) => {
      const createdAtMs = Date.parse(payment.createdAt);
      const updatedAtMs = Date.parse(payment.updatedAt);
      r._setRaw('order_id', payment.orderId);
      r._setRaw('idempotency_key', payment.idempotencyKey);
      r._setRaw('method', payment.method);
      r._setRaw('status', payment.status);
      r._setRaw('amount_cents', payment.amountCents);
      r._setRaw('currency', payment.currency);
      r._setRaw('kind', payment.kind);
      r._setRaw('external_ref', payment.externalRef ?? null);
      r._setRaw('server_version', payment.version);
      r._setRaw('created_at', Number.isFinite(createdAtMs) ? createdAtMs : Date.now());
      r._setRaw('updated_at', Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now());
      r._raw._status = 'synced';
      r._raw._changed = '';
    });
  }
  return db.get<PaymentModel>('payments').prepareCreateFromDirtyRaw(buildPaymentRaw(payment));
}

/**
 * Hapus aksi dan tulis payment (kalau bentuknya benar) dalam satu batch.
 */
async function deleteActionAndWritePayment(
  action: PendingActionModel,
  db: Database,
  payment: Payment | null,
): Promise<void> {
  await db.write(async () => {
    const ops: Model[] = [action.prepareDestroyPermanently()];
    if (payment) {
      ops.push(await prepareUpsertPaymentOp(db, payment));
    }
    await db.batch(...ops);
  });
}

/**
 * Check if an error indicates a version conflict.
 *
 * Cek field terstruktur dulu: `status === 409`, `statusCode === 409`,
 * atau `code === 'VERSION_CONFLICT'`. Backward compat string check untuk
 * error lama yang pesan-nya generic ("version mismatch" dll).
 *
 * Catatan: clause `\b409\b` regex terhadap String(err) sudah dihapus,
 * redundant (ApiError dari client.ts selalu punya `err.status === 409`
 * duluan) DAN false-positive prone (body apapun yang memuat angka 409,
 * mis. `{"amount":409}`, akan lolos).
 */
export function isVersionConflict(err: any): boolean {
  if (!err) return false;
  const msg = String(err).toLowerCase();
  return (
    err.status === 409 ||
    err.statusCode === 409 ||
    err.code === 'VERSION_CONFLICT' ||
    (msg.includes('version') && (msg.includes('conflict') || msg.includes('mismatch') || msg.includes('stale')))
  );
}

/**
 * 409 lain untuk cancel dan reject: aksi dihapus, lalu data order diambil ulang
 * lewat pullNow.
 *
 * Untuk cancel, last_conflict_reason 'cancelled-by-server' ditulis ke baris
 * order dan baris ditutup 'synced', supaya kolom lokal itu tidak membuat baris
 * ikut push. orderConflict hanya dipancarkan untuk reject; cancel cukup memakai
 * banner tersimpan.
 */
async function handleVersionConflict(action: PendingActionModel, db: Database, reason: string): Promise<void> {
  console.log(`[outbox] Handling version conflict for action ${action.id}`);

  let cancelOrderRow: OrderModel | null = null;
  if (action.actionType === 'cancel') {
    try {
      cancelOrderRow = await db.get<OrderModel>('orders').find(action.targetOrderId);
    } catch (err) {
      console.warn(
        `[outbox] Order ${action.targetOrderId} not found locally for cancel conflict write:`,
        err,
      );
    }
  }

  await db.write(async () => {
    const ops: Model[] = [action.prepareDestroyPermanently()];
    if (cancelOrderRow) {
      ops.push(cancelOrderRow.prepareUpdate((r) => {
        r._setRaw('last_conflict_reason', 'cancelled-by-server');
        r._setRaw('last_conflict_at', Date.now());
        r._raw._status = 'synced';
        r._raw._changed = '';
      }));
    }
    await db.batch(...ops);
  });

  // Pull fresh order data via sync coordinator (transaksi sendiri), tidak
  // bisa digabung dengan batch di atas karena syncCoordinator.pullNow()
  // mengelola batch internal applyPull-nya sendiri).
  try {
    await syncCoordinator.pullNow();
  } catch (err) {
    console.warn('[outbox] Failed to pull after conflict:', err);
  }

  // Hanya reject; cancel sudah punya banner tersimpan.
  if (action.actionType !== 'cancel') {
    syncEvents.emit('orderConflict', {
      orderId: action.targetOrderId,
      reason: 'order-status-conflict',
      serverStatus: 'unknown',
      serverChangedAt: new Date().toISOString(),
      ackReason: reason,
    });
  }
}

/**
 * Tandai aksi COD sebagai yatim: uangnya sudah diterima driver, tapi order
 * sudah tidak ditugaskan ke driver ini. Aksi 'orphaned_needs_review' tidak
 * dikirim lagi, dan layar detail meminta driver menghubungi support.
 */
async function markActionOrphaned(action: PendingActionModel, db: Database): Promise<void> {
  console.log(`[outbox] Marking action ${action.id} as orphaned_needs_review`);

  await db.write(async () => {
    await action.update((row) => {
      row.status = 'orphaned_needs_review';
    });
  });

  syncEvents.emit('pendingActionOrphaned', {
    pendingActionId: action.id,
    orderId: action.targetOrderId,
    actionType: action.actionType,
    message: 'COD yang sudah dikumpulkan tapi order sudah berubah. Hubungi support untuk penyelesaian.',
  });
}

/**
 * Tandai aksi 'failed': tidak dikirim lagi sampai driver memilih Coba lagi
 * (atau Abaikan, untuk cancel dan reject) di layar detail.
 */
async function markActionFailed(action: PendingActionModel, db: Database, error: string): Promise<void> {
  console.warn(`[outbox] Action ${action.id} permanently failed: ${error}. Will not auto-retry.`);
  await db.write(async () => {
    await action.update((row) => {
      row.status = 'failed';
    });
  });
}

/**
 * Untuk tombol Coba lagi: aksi 'failed' dikembalikan ke 'pending', lalu antrean
 * langsung dikirim. Kunci idempotensi tidak berubah, jadi COD tidak bisa
 * tercatat dua kali. Aksi berstatus lain tidak diubah.
 */
export async function retryFailedAction(actionId: string): Promise<void> {
  const action = await database.get<PendingActionModel>('pending_actions').find(actionId).catch(() => null);
  if (!action) {
    console.warn(`[outbox] retryFailedAction: action ${actionId} not found`);
    return;
  }
  if (action.status !== 'failed') {
    return;
  }
  await database.write(async () => {
    await action.update((row) => {
      row.status = 'pending';
    });
  });
  // Kirim sekarang, tidak menunggu sinkron berkala.
  await drainPendingActions();
}

/**
 * Untuk tombol Abaikan: hapus permanen aksi cancel atau reject yang 'failed'.
 * COD tidak bisa dibuang, karena aksi itu satu-satunya catatan di HP bahwa
 * uangnya sudah diterima.
 */
export async function discardFailedAction(actionId: string): Promise<void> {
  const action = await database.get<PendingActionModel>('pending_actions').find(actionId).catch(() => null);
  if (!action) {
    console.warn(`[outbox] discardFailedAction: action ${actionId} not found`);
    return;
  }
  if (action.status !== 'failed') return;
  if (action.actionType === 'collect_cod') {
    console.warn(`[outbox] discardFailedAction: COD action ${actionId} cannot be discarded`);
    return;
  }
  await database.write(async () => {
    await action.destroyPermanently();
  });
}

/**
 * Kembalikan aksi ke 'pending' supaya dikirim lagi di putaran berikutnya
 * (galat jaringan, batas waktu, 401, 408, 429, 5xx, atau galat tak terduga).
 */
async function resetActionForRetry(action: PendingActionModel, db: Database, error: string): Promise<void> {
  console.log(`[outbox] Action ${action.id} will retry: ${error}`);
  await db.write(async () => {
    await action.update((row) => {
      row.status = 'pending';
    });
  });
}

/**
 * Simple UUID generation (without external library).
 * For pending_action IDs which are local-only (not synced to server).
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
