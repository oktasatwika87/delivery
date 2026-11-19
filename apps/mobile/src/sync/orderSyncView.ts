/**
 * Aturan tampilan Order Saya: status yang tampil di kartu dan lencana
 * sinkronisasi.
 *
 * Aturan ini sama dengan yang dipakai OrderDetailScreen (lihat activeAction
 * sampai displayStatus di sana), supaya daftar Order dan detail order
 * selaras.
 */

import { OrderStatus } from '@delivery/shared';

import { PendingActionModel, readUpdateStatusTarget } from '../db/models/PendingActionModel';
import { STALE_THRESHOLD_MS } from './outbox';
import type { SyncState } from '../components/SyncBadge';

export interface OrderSyncView {
  displayStatus: OrderStatus;
  syncState: SyncState | null;
  /** Keadaan antrean aksi aktif, tanpa melihat aksi gagal. */
  antrean: 'pending' | 'stale' | null;
}

function readText(action: PendingActionModel, column: string): string {
  const raw = action._getRaw(column);
  return typeof raw === 'string' ? raw : '';
}

function readCreatedAt(action: PendingActionModel): number {
  const raw = action._getRaw('created_at');
  return typeof raw === 'number' ? raw : 0;
}

// Umur aksi dalam milidetik. Aksi tanpa waktu pembuatan (0 atau bukan angka)
// dihitung umur 0, sama seperti getPendingActionAgeMs di outbox.ts, jadi
// tidak dianggap basi.
function readActionAgeMs(action: PendingActionModel, now: number): number {
  const createdAt = readCreatedAt(action);
  if (!createdAt) return 0;
  return now - createdAt;
}

// Payload aksi disimpan sebagai teks JSON. Isi yang tidak bisa diurai
// dianggap tidak ada, sama seperti payload yang tidak terbaca di detail.
function readPayload(action: PendingActionModel): unknown {
  const raw = action._getRaw('payload_json');
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Status dan lencana sinkronisasi untuk satu order.
 *
 * - displayStatus: target aksi status aktif yang paling baru, yaitu status
 *   order setelah antrean selesai terkirim. Kalau tidak ada aksi status, atau
 *   ada aksi 'failed' atau COD yatim, pakai status baris order dari server.
 * - syncState: 'failed' kalau ada aksi berstatus 'failed' atau COD yatim,
 *   selain itu sama dengan antrean. null kalau tidak ada aksi aktif.
 *   Aksi aktif tanpa waktu pembuatan tidak dianggap basi, jadi lencana
 *   'pending'.
 * - antrean: keadaan aksi aktif saja, yaitu 'stale' kalau ada aksi aktif yang
 *   sudah menunggu lebih dari sejam, 'pending' kalau ada aksi aktif, null
 *   kalau tidak ada. Bedanya dari syncState: di detail order banner gagal dan
 *   banner menunggu bisa tampil bersamaan, misalnya Mulai antar ditolak
 *   server sementara COD masih antre. Lencana di kartu order hanya satu
 *   keadaan, jadi gagal menutupi keadaan antrean.
 */
export function deriveOrderSyncView(
  rowStatus: OrderStatus,
  actions: PendingActionModel[],
): OrderSyncView {
  const active = actions.filter((action) => {
    const status = readText(action, 'status');
    return status === 'pending' || status === 'syncing';
  });
  const hasFailed = actions.some((action) => readText(action, 'status') === 'failed');
  const hasOrphanedCod = actions.some(
    (action) =>
      readText(action, 'action_type') === 'collect_cod' &&
      readText(action, 'status') === 'orphaned_needs_review',
  );

  const statusActions = active
    .filter((action) => readText(action, 'action_type') === 'update_status')
    .sort((a, b) => readCreatedAt(a) - readCreatedAt(b));
  const latestStatusAction = statusActions[statusActions.length - 1];
  const latestTarget = latestStatusAction
    ? readUpdateStatusTarget(readPayload(latestStatusAction))
    : null;

  const displayStatus =
    latestTarget && !hasFailed && !hasOrphanedCod ? latestTarget : rowStatus;

  let antrean: 'pending' | 'stale' | null = null;
  if (active.length > 0) {
    const now = Date.now();
    const isStale = active.some(
      (action) => readActionAgeMs(action, now) > STALE_THRESHOLD_MS,
    );
    antrean = isStale ? 'stale' : 'pending';
  }

  let syncState: SyncState | null = null;
  if (hasFailed || hasOrphanedCod) {
    // Aksi yang ditolak server menetap sampai driver mencoba lagi atau
    // membuangnya, jadi lencana tidak berubah jadi centang.
    syncState = 'failed';
  } else {
    syncState = antrean;
  }

  return { displayStatus, syncState, antrean };
}

/**
 * Waktu paling baru dari aksi Selesai diantar yang masih antre.
 *
 * Nilainya null kalau tidak ada aksi seperti itu. Dipakai ringkasan hari ini:
 * order yang statusnya sudah selesai di HP tapi aksinya belum terkirim tetap
 * dihitung selesai, dan waktunya adalah waktu aksinya dibuat.
 */
export function queuedDeliveredAt(actions: PendingActionModel[]): number | null {
  const antre = actions.filter((action) => {
    if (readText(action, 'action_type') !== 'update_status') return false;
    const status = readText(action, 'status');
    if (status !== 'pending' && status !== 'syncing') return false;
    return readUpdateStatusTarget(readPayload(action)) === 'DELIVERED';
  });
  if (antre.length === 0) return null;
  return antre.reduce(
    (terbesar, action) => Math.max(terbesar, readCreatedAt(action)),
    0,
  );
}
