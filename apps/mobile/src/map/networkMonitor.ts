/**
 * networkMonitor — abstraksi untuk deteksi online/offline.
 *
 * Default implementation ping ringan ke API_BASE_URL (HEAD request, 5s timeout).
 * Saat ping gagal → 'offline'. Saat ping sukses → 'online'.
 *
 * Catatan:
 *   - Implementation ini coupling ke backend (API_BASE_URL), tapi semua
 *     komponen production lain (sync, chat) juga ada di sana. Kalau tambah
 *     infra stand-alone seperti @react-native-community/netinfo bisa swap
 *     lewat interface ini tanpa ubah UI.
 *   - Update state setiap 30 detik (matching dengan sync tick interval).
 *   - Manual check via check() untuk immediate status probe (e.g. saat
 *     MapScreen mount).
 */

import Config from 'react-native-config';

export type NetworkStatus = 'online' | 'offline' | 'unknown';

type Listener = (status: NetworkStatus) => void;

interface NetworkMonitor {
  /** Status terakhir yang diketahui. Initial = 'online' (optimistic). */
  getStatus(): NetworkStatus;
  /** Subscribe ke perubahan status. Return unsubscribe. */
  subscribe(listener: Listener): () => void;
  /** Manual probe — update status dari ping sekarang. */
  check(): Promise<NetworkStatus>;
  /** Start periodic check (default 30s). */
  start(intervalMs?: number): void;
  /** Stop periodic check. */
  stop(): void;
}

const API_BASE = Config.API_BASE_URL ?? 'http://localhost:3000';
const PING_TIMEOUT_MS = 5_000;
const DEFAULT_INTERVAL_MS = 30_000;

class NetworkMonitorImpl implements NetworkMonitor {
  private status: NetworkStatus = 'unknown';
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;

  getStatus(): NetworkStatus {
    return this.status;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async check(): Promise<NetworkStatus> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    try {
      // HEAD — body tidak dipakai, lebih ringan dari GET.
      const res = await fetch(API_BASE, {
        method: 'HEAD',
        signal: controller.signal,
      });
      // Backend up — anggap online. 4xx/5xx pun masih dianggap online
      // (server respond) karena device punya koneksi.
      void res;
      this.setStatus('online');
    } catch {
      this.setStatus('offline');
    } finally {
      clearTimeout(timeoutId);
    }
    return this.status;
  }

  start(intervalMs: number = DEFAULT_INTERVAL_MS): void {
    if (this.timer) return;
    // Probe sekali segera, lalu periodic.
    this.check().catch(() => {
      // Error sudah di-handle di check().
    });
    this.timer = setInterval(() => {
      this.check().catch(() => {
        // Error sudah di-handle di check().
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private setStatus(next: NetworkStatus): void {
    if (next === this.status) return;
    this.status = next;
    this.listeners.forEach((l) => l(next));
  }
}

export const networkMonitor: NetworkMonitor = new NetworkMonitorImpl();
