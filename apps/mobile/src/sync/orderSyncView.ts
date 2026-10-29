/**
 * Aturan tampilan Order Saya: status yang tampil di kartu dan lencana
 * sinkronisasi.
 *
 * Aturan ini sama dengan yang dipakai OrderDetailScreen (lihat activeAction
 * sampai displayStatus di sana), supaya daftar Order dan detail order
 * selaras. Kolom aksi dibaca lewat _getRaw karena dekorator model tidak
 * aktif di Jest.
 */

import { OrderStatus } from '@delivery/shared';

import { PendingActionModel, readUpdateStatusTarget } from '../db/models/PendingActionModel';
import { STALE_THRESHOLD_MS } from './outbox';
import type { SyncState } from '../components/SyncBadge';

export interface OrderSyncView {
  displayStatus: OrderStatus;
  syncState: SyncState | null;
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
 * - syncState: 'stale' kalau ada aksi aktif yang sudah menunggu lebih dari
 *   sejam, 'pending' kalau ada aksi aktif, null kalau tidak ada aksi aktif.
 *   Aksi aktif tanpa waktu pembuatan tidak dianggap basi, jadi lencana
 *   'pending'.
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

  let syncState: SyncState | null = null;
  if (active.length > 0) {
    const now = Date.now();
    const isStale = active.some(
      (action) => readActionAgeMs(action, now) > STALE_THRESHOLD_MS,
    );
    syncState = isStale ? 'stale' : 'pending';
  }

  return { displayStatus, syncState };
}
