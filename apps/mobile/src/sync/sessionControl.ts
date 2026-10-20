/**
 * Pengendali sesi sinkron.
 *
 * Sinkron dan kedua socket hanya berjalan selama ada sesi, dimulai
 * dan dihentikan lewat satu pasang fungsi:
 * - beginSyncSession(db): mulai sinkron (coordinator.start) dan
 *   menyambungkan kedua socket (orders + chat).
 * - endSyncSession(): hentikan sinkron dan putuskan kedua socket.
 *
 * Kegagalan satu panggilan tidak menggagalkan yang lain: setiap langkah
 * menangkap galat dengan .catch yang mencatat, jadi pemanggil (App.tsx)
 * tidak perlu menunggu atau menangani galat.
 */

import { syncCoordinator } from './coordinator';
import { ordersSocket } from './ordersSocket';
import { chatSocket } from './socket';
import type { Database } from '@nozbe/watermelondb';

export function beginSyncSession(db: Database): void {
  syncCoordinator.start(db).catch((err) => {
    console.warn('[sessionControl] sync start failed:', err);
  });
  ordersSocket.connect().catch((err) => {
    console.warn('[sessionControl] orders socket connect failed:', err);
  });
  chatSocket.connect().catch((err) => {
    console.warn('[sessionControl] chat socket connect failed:', err);
  });
}

export function endSyncSession(): void {
  syncCoordinator.stop();
  ordersSocket.disconnect();
  chatSocket.disconnect();
}