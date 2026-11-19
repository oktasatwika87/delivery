/**
 * Hitungan antrean aksi untuk bilah koneksi.
 *
 * Dipisah dari layar supaya layar lain yang butuh angka ini tidak perlu
 * ikut menghitung sendiri.
 */

import type { PendingActionModel } from '../db/models/PendingActionModel';

export interface HitunganAntrean {
  /** Aksi yang masih antre: 'pending' atau 'syncing'. */
  pendingCount: number;
  /** Aksi yang ditolak server atau COD yatim: 'failed' atau 'orphaned_needs_review'. */
  failedCount: number;
}

function statusAksi(action: PendingActionModel): string {
  const raw = action._getRaw('status');
  return typeof raw === 'string' ? raw : '';
}

/** Hitung berapa aksi yang masih antre dan berapa yang ditolak server. */
export function hitungAntrean(actions: PendingActionModel[]): HitunganAntrean {
  let pendingCount = 0;
  let failedCount = 0;
  for (const action of actions) {
    const status = statusAksi(action);
    if (status === 'pending' || status === 'syncing') {
      pendingCount += 1;
    } else if (status === 'failed' || status === 'orphaned_needs_review') {
      failedCount += 1;
    }
  }
  return { pendingCount, failedCount };
}
