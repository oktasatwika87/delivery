/**
 * Outbox aksi driver (reject, cancel, collect_cod, update_status), supaya
 * aksi tetap bisa dicatat tanpa sinyal.
 *
 * Aksi ditulis ke tabel pending_actions lokal, lalu dikirim lewat
 * drainPendingActions. Pengiriman berjalan berurutan per order (lihat
 * penjaga urutan di runDrainOnce) dan mengambil aksi 'pending' dan
 * 'syncing' (aksi yang terputus di tengah pengiriman, misalnya karena
 * aplikasi ditutup paksa).
 *
 * Hasil tiap aksi dipilah dari jenis galatnya (UnauthorizedError, atau
 * ApiError dengan status dan code), bukan dari teks pesan:
 * - sukses: aksi dihapus; untuk collect_cod, payment dari respons ditulis
 *   ke baris lokal di batch yang sama, jadi layar detail tidak menunggu
 *   pull;
 * - 409 ORDER_REASSIGNED dan COD_ALREADY_CAPTURED: aksi dihapus dan
 *   alasannya ditulis ke last_conflict_reason order itu; ORDER_REASSIGNED
 *   juga menghapus semua update_status/cancel/reject untuk order itu karena
 *   order sudah bukan milik driver;
 * - 409 lain untuk cancel dan reject: handleVersionConflict;
 * - 4xx lain (termasuk 409 lain untuk COD dan update_status): aksi
 *   menjadi 'failed' dan tidak dikirim lagi sampai driver memilih Coba
 *   lagi. Pada COD, 403 ORDER_NOT_ASSIGNED dan 404 menjadi yatim;
 * - 408, 429, 5xx, galat jaringan, batas waktu, dan 401: aksi kembali
 *   'pending'. Galat jaringan, batas waktu, dan 401 juga menghentikan
 *   putaran itu.
 *
 * Aksi update_status, cancel, dan reject untuk order yang sama dikirim
 * urut per order (lihat runDrainOnce). update_status DELIVERED menunggu
 * sampai COD tercatat lokal. collect_cod tidak menunggu.
 *
 * Aksi collect_cod yang yatim (order sudah tidak ditugaskan) menghapus
 * semua update_status/cancel/reject untuk order itu dalam database.write
 * yang sama, supaya Selesai diantar yang antre di belakang COD yatim
 * tidak menunggu selamanya.
 */

import { Model, Q } from '@nozbe/watermelondb';
import type { Database } from '@nozbe/watermelondb';
import type { Payment } from '@delivery/shared';

import { database } from '../db';
import {
  PendingActionModel,
  type CancelPayload,
  type CollectCodPayload,
  type UpdateStatusPayload,
  readUpdateStatusTarget,
} from '../db/models/PendingActionModel';
import { OrderModel } from '../db/models/OrderModel';
import { PaymentModel } from '../db/models/PaymentModel';
import { syncEvents } from './syncEvents';
import { getCurrentUserId } from './session';
import {
  rejectOrder,
  cancelOrder,
  collectCodOrder,
  updateOrderStatus,
  flagOrphanedCod,
  ApiError,
  UnauthorizedError,
} from './client';
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
 * - 'waiting': aksi dilewati penjaga urutan per order, atau update_status
 *   DELIVERED menunggu COD; aksi tidak berubah dan putaran lanjut.
 * - 'failed': aksi tidak terkirim di putaran ini, entah kembali 'pending'
 *   (dikirim lagi nanti) atau menjadi 'failed' (menunggu Coba lagi).
 *
 * `stopDrain` true berarti putaran berhenti setelah aksi ini (galat jaringan,
 * batas waktu, atau 401); aksi sisanya tetap 'pending'.
 */
export interface ProcessResult {
  pendingActionId: string;
  status: 'success' | 'conflict' | 'orphaned' | 'waiting' | 'failed';
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
 * Mengantre aksi status untuk order (Mulai antar / Selesai diantar), supaya
 * driver bisa menaikkan status tanpa sinyal. Aksi dikirim lewat outbox, urut
 * per order (lihat runDrainOnce).
 *
 * Kalau sudah ada aksi untuk order itu dengan target status yang sama
 * (idempotency_key `status:<orderId>:<status>`), tidak ada aksi baru dan id
 * aksi yang sudah ada dikembalikan, supaya ketukan kedua pada tombol yang
 * sama tidak membuat aksi kedua.
 */
export async function enqueueUpdateStatus(
  orderId: string,
  status: 'OUT_FOR_DELIVERY' | 'DELIVERED',
): Promise<EnqueueResult> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return { success: false, error: 'Not authenticated' };
    }

    const idempotencyKey = `status:${orderId}:${status}`;
    const payload: UpdateStatusPayload = { status };

    const pendingActionId = generateUUID();

    const enqueueResult = await database.write(async () => {
      // Cek aksi yang sama dan pembuatan aksi berada di database.write yang
      // sama, supaya dua ketukan yang hampir bersamaan tidak membuat dua aksi.
      const existing = await database
        .get<PendingActionModel>('pending_actions')
        .query(
          Q.where('target_order_id', orderId),
          Q.where('idempotency_key', idempotencyKey),
        )
        .fetch();
      if (existing.length > 0) {
        return existing[0].id;
      }
      // expected_version 0: versi dibaca dari baris lokal saat aksi dikirim,
      // bukan saat aksi dibuat.
      const now = Date.now();
      const preparedRecord = database.get<PendingActionModel>('pending_actions').prepareCreateFromDirtyRaw({
        id: pendingActionId,
        _status: 'synced',
        _changed: '',
        action_type: 'update_status',
        target_order_id: orderId,
        expected_version: 0,
        idempotency_key: idempotencyKey,
        payload_json: JSON.stringify(payload),
        status: 'pending',
        created_at: now,
        updated_at: now,
      });
      await database.batch(preparedRecord);
      return pendingActionId;
    });

    if (enqueueResult === pendingActionId) {
      console.log(`[outbox] enqueued update_status action for order ${orderId}, target=${status}, pendingActionId=${pendingActionId}`);
    }
    return { success: true, pendingActionId: enqueueResult };
  } catch (err) {
    console.error('[outbox] failed to enqueue update_status:', err);
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
    // Penjaga urutan: aksi selain collect_cod menunggu sampai aksi yang
    // lebih tua untuk order yang sama selesai, dan update_status DELIVERED
    // menunggu COD tercatat. Dibaca ulang dari database (bukan dari daftar
    // di awal putaran) supaya aksi yang lebih tua yang baru saja dihapus
    // atau berubah di putaran ini tidak menahan.
    const skipReason = await shouldSkipAction(action, db);
    if (skipReason !== null) {
      results.push({
        pendingActionId: action.id,
        status: 'waiting',
        error: skipReason,
      });
      continue;
    }

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
 * Penjaga urutan per order. Mengembalikan teks alasan (ditulis ke
 * ProcessResult.error) kalau aksi harus dilewati, atau null kalau aksi boleh
 * diproses. Tanpa permintaan, status aksi tidak diubah, putaran lanjut ke
 * aksi berikutnya.
 *
 * - collect_cod: selalu lolos. COD sudah diterima driver, server mencatat
 *   tanpa melihat status order.
 * - Aksi lain (reject, cancel, update_status): menunggu kalau ada aksi lain
 *   untuk order yang sama dengan `created_at` lebih kecil. Status aksi apa
 *   pun (pending/syncing/failed/orphaned_needs_review) ikut menahan, karena
 *   misalnya 'failed' belum tentu permanen (driver bisa pilih Coba lagi).
 * - update_status dengan target DELIVERED: tambahan syarat, menunggu sampai
 *   payment order dengan method CASH dan status CAPTURED tercatat lokal.
 */
async function shouldSkipAction(
  action: PendingActionModel,
  db: Database,
): Promise<string | null> {
  if (action.actionType === 'collect_cod') {
    return null;
  }

  // update_status DELIVERED: tunggu payment CASH CAPTURED.
  if (action.actionType === 'update_status') {
    const target = readUpdateStatusTarget(action.payloadJson);
    if (target === 'DELIVERED') {
      const codCaptured = await db
        .get<PaymentModel>('payments')
        .query(
          Q.where('order_id', action.targetOrderId),
          Q.where('method', 'CASH'),
          Q.where('status', 'CAPTURED'),
        )
        .fetch();
      if (codCaptured.length === 0) {
        return 'COD belum tercatat';
      }
    }
  }

  // Tunggu aksi yang lebih tua untuk order yang sama.
  const currentCreatedAt = getActionCreatedAtMs(action);
  const olderActions = await db
    .get<PendingActionModel>('pending_actions')
    .query(
      Q.where('target_order_id', action.targetOrderId),
      Q.where('created_at', Q.lt(currentCreatedAt)),
    )
    .fetch();
  if (olderActions.length > 0) {
    return `menunggu aksi yang lebih tua untuk order ${action.targetOrderId}`;
  }

  return null;
}

/**
 * Waktu pembuatan aksi dalam milidetik, untuk dibandingkan dengan kolom
 * number `created_at` di query. Di model nilainya Date; nilai selain Date
 * diubah dengan Number().
 */
function getActionCreatedAtMs(action: PendingActionModel): number {
  const createdAt = action.createdAt;
  if (createdAt instanceof Date) return createdAt.getTime();
  return Number(createdAt);
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
      case 'update_status':
        return await processUpdateStatus(action, db);
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
 *
 * Untuk reason 'reassigned' (ORDER_REASSIGNED dari server): selain aksi
 * yang sedang diproses, semua aksi update_status/cancel/reject lain untuk
 * order itu ikut dihapus, karena order sudah bukan milik driver dan aksi
 * itu tidak akan diterima server. Aksi collect_cod tidak dihapus, karena
 * uangnya sudah diterima driver; kalau server menolaknya, aksi itu menjadi
 * yatim lewat markActionOrphaned.
 *
 * Untuk reason 'cancel-cod-captured': hanya aksi yang sedang diproses yang
 * dihapus; aksi status lain untuk order itu (misalnya update_status
 * DELIVERED) tetap berlaku.
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
    if (reason === 'reassigned') {
      // Untuk 'reassigned', hapus semua update_status/cancel/reject untuk order
      // itu (status aksi apa pun: pending, syncing, failed). Aksi collect_cod
      // tetap utuh; bila perlu yatim, ditangani di markActionOrphaned.
      // Aksi lain dicari dan disiapkan untuk dihapus di dalam db.write yang
      // sama dengan batch, supaya penulisan lain (misalnya Coba lagi dari
      // layar) tidak mengubah baris yang sama di antaranya.
      const siblings = await db
        .get<PendingActionModel>('pending_actions')
        .query(Q.where('target_order_id', action.targetOrderId))
        .fetch();
      for (const sibling of siblings) {
        if (sibling.id === action.id) continue;
        if (
          sibling.actionType === 'update_status' ||
          sibling.actionType === 'cancel' ||
          sibling.actionType === 'reject'
        ) {
          ops.push(sibling.prepareDestroyPermanently());
        }
      }
    }
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
 * Kirim aksi update_status (Mulai antar / Selesai diantar).
 *
 * Sukses: baris order lokal ditulis dari respons (status, server_version,
 * updated_at, driver_id, cancelled_by, cancel_reason) dan aksi dihapus
 * dalam satu batch. Tanpa event orderConflict atau pool-refresh.
 *
 * Versi yang dikirim dibaca dari baris lokal saat kirim (expected_version
 * aksi ini selalu 0), supaya aksi berikutnya untuk order yang sama memakai
 * versi dari respons aksi sebelumnya.
 */
async function processUpdateStatus(
  action: PendingActionModel,
  db: Database,
): Promise<ProcessResult> {
  const target = readUpdateStatusTarget(action.payloadJson);
  if (target === null) {
    await markActionFailed(action, db, 'Invalid payload');
    return { pendingActionId: action.id, status: 'failed', error: 'Invalid payload' };
  }

  let orderRow: OrderModel | null = null;
  try {
    orderRow = await db.get<OrderModel>('orders').find(action.targetOrderId);
  } catch (err) {
    console.warn(
      `[outbox] Order ${action.targetOrderId} not found locally for update_status:`,
      err,
    );
  }
  if (!orderRow) {
    await markActionFailed(action, db, 'Order not found');
    return { pendingActionId: action.id, status: 'failed', error: 'Order not found' };
  }

  // server_version dibaca dari _raw, sama dengan penjaga versi di applyPull.
  // Kalau bukan angka, dikirim 0: server menolaknya (400), jadi aksi menjadi
  // 'failed' dan tampil di layar detail.
  const rawVersion = orderRow._getRaw('server_version');
  const currentVersion = typeof rawVersion === 'number' ? rawVersion : 0;

  try {
    const response = await updateOrderStatus(action.targetOrderId, target, currentVersion);
    console.log(`[outbox] update_status succeeded for order ${action.targetOrderId}:`, response.status);

    await db.write(async () => {
      const ops: Model[] = [action.prepareDestroyPermanently()];
      const updatedAtRaw = Date.parse(response.updatedAt);
      const updatedAtMs = Number.isFinite(updatedAtRaw) ? updatedAtRaw : Date.now();
      if (orderRow) {
        ops.push(orderRow.prepareUpdate((r) => {
          r._setRaw('status', response.status);
          r._setRaw('server_version', response.version);
          r._setRaw('updated_at', updatedAtMs);
          r._setRaw('driver_id', response.driverId ?? null);
          r._setRaw('cancelled_by', response.cancelledBy ?? null);
          r._setRaw('cancel_reason', response.cancelReason ?? null);
          r._setRaw('last_conflict_reason', null);
          r._setRaw('last_conflict_at', null);
          r._raw._status = 'synced';
          r._raw._changed = '';
        }));
      }
      await db.batch(...ops);
    });

    return { pendingActionId: action.id, status: 'success' };
  } catch (err) {
    return await classifyAndHandleUpdateStatusError(action, db, err);
  }
}

/**
 * Pilah galat update_status. Aturan khusus untuk aksi ini (lihat juga
 * writeRejectConflictAndDelete untuk ORDER_REASSIGNED):
 * - UnauthorizedError dan ApiError 401: kembali pending, stopDrain.
 * - Galat jaringan atau batas waktu: kembali pending, stopDrain.
 * - 408, 429, 5xx: kembali pending, lanjut.
 * - 409 ORDER_REASSIGNED: tulis 'reassigned' ke order, hapus semua aksi
 *   update_status/cancel/reject untuk order itu.
 * - 409 lain (INVALID_TRANSITION, VERSION_CONFLICT, PAYMENT_NOT_CAPTURED,
 *   atau tanpa code): 'failed', pullNow. Aksi update_status/cancel/reject
 *   yang lebih baru untuk order itu ditahan penjaga urutan sampai driver
 *   memilih Coba lagi atau Abaikan.
 * - 4xx lain (400, 403 dengan/tanpa code, 404): 'failed'.
 */
async function classifyAndHandleUpdateStatusError(
  action: PendingActionModel,
  db: Database,
  err: unknown,
): Promise<ProcessResult> {
  if (err instanceof UnauthorizedError) {
    console.warn(`[outbox] Unauthorized update_status ${action.id}: ${err.message}`);
    await resetActionForRetry(action, db, err.message);
    return { pendingActionId: action.id, status: 'failed', error: err.message, stopDrain: true };
  }

  if (err instanceof ApiError) {
    const { status, code } = err;

    // 401: sesi berakhir, diperlakukan sama dengan UnauthorizedError di
    // atas. Dicek sebelum cabang 4xx lain agar tidak jatuh ke 'failed'
    // permanen.
    if (status === 401) {
      console.warn(`[outbox] ApiError 401 on update_status ${action.id}: ${err.message}`);
      await resetActionForRetry(action, db, err.message);
      return { pendingActionId: action.id, status: 'failed', error: err.message, stopDrain: true };
    }

    if (status === 409 && code === 'ORDER_REASSIGNED') {
      console.warn(`[outbox] Order reassigned on update_status: ${action.targetOrderId}`);
      return await writeRejectConflictAndDelete(action, db, 'reassigned');
    }

    if (status === 409) {
      // INVALID_TRANSITION, VERSION_CONFLICT, PAYMENT_NOT_CAPTURED, atau tanpa
      // code. Tandai gagal dan tarik data order terbaru dari server supaya
      // baris lokal sama dengan data server.
      console.warn(`[outbox] 409 on update_status ${action.id} (code=${code ?? 'none'})`);
      await markActionFailed(action, db, err.message);
      try {
        await syncCoordinator.pullNow();
      } catch (pullErr) {
        console.warn('[outbox] pullNow after update_status 409 failed:', pullErr);
      }
      return { pendingActionId: action.id, status: 'failed', error: err.message };
    }

    if (status === 408 || status === 429 || (status >= 500 && status < 600)) {
      console.warn(`[outbox] Transient ${status} on update_status ${action.id}: ${err.message}`);
      await resetActionForRetry(action, db, err.message);
      return { pendingActionId: action.id, status: 'failed', error: err.message };
    }

    // 4xx lain (400, 403 dengan/tanpa code, 404): 'failed'.
    console.warn(`[outbox] update_status rejected with ${status} (${code ?? 'no code'})`);
    await markActionFailed(action, db, err.message);
    return { pendingActionId: action.id, status: 'failed', error: err.message };
  }

  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[outbox] Unexpected update_status error for ${action.id}: ${msg}`);
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
 *
 * Dalam database.write yang sama dengan penandaan yatim, semua aksi
 * update_status, cancel, dan reject untuk order itu dihapus, karena order
 * sudah bukan milik driver. Tanpa ini, Selesai diantar yang antre di
 * belakang COD menunggu aksi COD yatim yang tidak akan pernah selesai.
 */
async function markActionOrphaned(action: PendingActionModel, db: Database): Promise<void> {
  console.log(`[outbox] Marking action ${action.id} as orphaned_needs_review`);

  await db.write(async () => {
    await action.update((row) => {
      row.status = 'orphaned_needs_review';
    });
    // Aksi lain dicari dan disiapkan untuk dihapus di dalam db.write yang
    // sama dengan batch, supaya penulisan lain (misalnya Coba lagi dari
    // layar) tidak mengubah baris yang sama di antaranya.
    const siblings = await db
      .get<PendingActionModel>('pending_actions')
      .query(Q.where('target_order_id', action.targetOrderId))
      .fetch();
    const extraOps: Model[] = [];
    for (const sibling of siblings) {
      if (sibling.id === action.id) continue;
      if (
        sibling.actionType === 'update_status' ||
        sibling.actionType === 'cancel' ||
        sibling.actionType === 'reject'
      ) {
        extraOps.push(sibling.prepareDestroyPermanently());
      }
    }
    if (extraOps.length > 0) {
      await db.batch(...extraOps);
    }
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
 * Untuk tombol Abaikan: hapus permanen aksi update_status, cancel, atau
 * reject yang 'failed'. COD tidak bisa dibuang, karena aksi itu satu-satunya
 * catatan di HP bahwa uangnya sudah diterima.
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
