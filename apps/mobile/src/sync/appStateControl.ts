/**
 * Pengendali perubahan status aplikasi (AppState).
 *
 * Kelas ini menentukan kapan sinkron dan kedua socket dijalankan lagi
 * dari perubahan status aplikasi:
 * - 'background' menghentikan sesi dan menandainya dijeda.
 * - 'inactive' tidak melakukan apa-apa, hanya mencatat.
 * - 'active' mengecek jaringan lagi, dan menjalankan sesi lagi hanya
 *   kalau sesi sebelumnya dijeda karena background dan masih hidup.
 *
 * 'inactive' di iOS muncul tiap ada lapisan sistem di atas app, misalnya
 * dialog izin lokasi atau Control Center. Kalau ikut memutus sesi di
 * sana, sinkron dan socket putus nyambung lagi tanpa alasan.
 */

import type { AppStateStatus } from 'react-native';

export interface AppStateControlHooks {
  /** Sesi sinkron dan socket sedang hidup? */
  isSessionActive: () => boolean;
  /** Mulai sinkron dan kedua socket. */
  beginSession: () => void;
  /** Hentikan sinkron dan kedua socket. */
  endSession: () => void;
  /** Cek ulang status jaringan. */
  recheckNetwork: () => void;
  /** Catat status ke log aplikasi. */
  log?: (message: string) => void;
}

export class AppStateControl {
  /** Sesi dihentikan karena app masuk background dan belum dijalankan lagi. */
  private paused = false;

  constructor(private readonly hooks: AppStateControlHooks) {}

  handleChange(status: AppStateStatus): void {
    if (status === 'background') {
      this.hooks.log?.('[App] AppState background, sinkron dan socket dihentikan');
      this.paused = true;
      this.hooks.endSession();
      return;
    }

    if (status === 'active') {
      this.hooks.recheckNetwork();
      if (this.paused && this.hooks.isSessionActive()) {
        this.hooks.log?.('[App] AppState active, sinkron dan socket dijalankan lagi');
        this.hooks.beginSession();
      }
      this.paused = false;
      return;
    }

    this.hooks.log?.(`[App] AppState ${status}, sinkron dan socket dibiarkan`);
  }

  /** Sesi dimulai dari luar pengendali, misalnya setelah login. */
  noteSessionStarted(): void {
    this.paused = false;
  }

  /** Sesi berakhir dari luar pengendali, misalnya setelah logout. */
  noteSessionEnded(): void {
    this.paused = false;
  }
}
