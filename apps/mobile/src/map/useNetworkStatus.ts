import { useSyncExternalStore } from 'react';

import { networkMonitor } from './networkMonitor';
import type { NetworkStatus } from './networkMonitor';

/**
 * Status jaringan untuk layar.
 *
 * Dibaca lewat useSyncExternalStore, jadi status yang berubah di antara
 * render dan efek tetap terbaca. Di iOS monitor bisa berubah dari
 * 'unknown' ke 'online' persis di saat layar dipasang, tanpa sempat
 * memberi tahu pendengar.
 */

/** Berlangganan perubahan status monitor. Dibuat sekali di modul ini. */
const langganan = (ubah: () => void): (() => void) => networkMonitor.subscribe(() => ubah());

/** Status terakhir yang diketahui monitor. Dibuat sekali di modul ini. */
const ambil = (): NetworkStatus => networkMonitor.getStatus();

export function useNetworkStatus(): NetworkStatus {
  return useSyncExternalStore(langganan, ambil);
}
