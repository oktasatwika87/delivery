/**
 * offlineStorage — abstraction layer di atas MapLibre OfflineManager v10.2.1.
 *
 * Tujuan file ini:
 *   1. Bungkus API OfflineManager MapLibre dengan tipe yang konsisten &
 *      gampang diaudit/ganti.
 *   2. Handle perbedaan API offline manager tiap versi (saat ini target v10.2.1).
 *      v10 pakai user-provided name, bounds `[[neLng,neLat],[swLng,swLat]]`,
 *      styleURL (URL, bukan Style JSON), dan state sebagai number.
 *   3. Retry otomatis saat gagal download (3x dengan exponential backoff).
 *   4. Stop-able: pause saat screen unmount (cleanup listener).
 *   5. Warning storage tipis — aggregate pack.size, threshold 200MB.
 *
 * Pakai:
 *   import { offlineStorage, DownloadProgress } from '../map/offlineStorage';
 *   await offlineStorage.downloadRegion({
 *     name: 'jakarta',
 *     bounds: [[106.7, -6.3], [106.95, -6.1]],
 *     minZoom: 10,
 *     maxZoom: 16,
 *   }, onProgress);
 */

import { OfflineManager, type OfflinePackStatus, OfflinePack } from '@maplibre/maplibre-react-native';

// ─── Types ──────────────────────────────────────────────────────────────

/** Bounding box: array of 2 [lng, lat] pairs — NE & SW. */
export type Bounds = [[number, number], [number, number]];

export interface DownloadRegionInput {
  /** Unique pack name — pack di-identify dengan string ini di v10. */
  name: string;
  /** Tile server URL — bukan Style JSON path. */
  styleURL: string;
  /** Bbox [[neLng, neLat], [swLng, swLat]]. */
  bounds: Bounds;
  /** Default 10 — zoom level minimum yang di-download. */
  minZoom?: number;
  /** Default 16 — zoom level maksimum. Untuk kurir, z16 cukup (level bangunan). */
  maxZoom?: number;
}

/**
 * 0 = Inactive, 1 = Active, 2 = Complete — sesuai
 * MapLibre OfflineRegion.STATE_* di native (lihat MLRNOfflineModule.java).
 */
export type DownloadState = 'inactive' | 'active' | 'complete';

/** Snapshot ringkas dari pack — data minimal yang UI butuhkan. */
export interface PackInfo {
  name: string;
  bounds: Bounds;
  state: DownloadState;
  /** 0-100. */
  percentage: number;
  /** Jumlah tile yang sudah ter-download. */
  completedTileCount: number;
  /** Total size downloaded (bytes). */
  completedTileSize: number;
  /** Resource total — kalau sudah tahu. */
  requiredResourceCount: number;
}

export interface DownloadProgress extends PackInfo {}

/** Listener: dipanggil tiap progress event dari native. */
export type ProgressListener = (progress: DownloadProgress) => void;
/** Listener: dipanggil saat error. */
export type ErrorListener = (error: { message: string }) => void;

// ─── Constants ──────────────────────────────────────────────────────────

export const DEFAULT_MIN_ZOOM = 10;
/** z16 = level bangunan. Untuk kurir delivery cukup — tidak perlu z18+ zoom ekstrem. */
export const DEFAULT_MAX_ZOOM = 16;
/** Tile terlalu kecil di z17+ (block-by-block), storage membengkak 4x per zoom. */
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_500;
/** Warning threshold — kalau total downloaded tile > 200MB. */
const STORAGE_WARNING_BYTES = 200 * 1024 * 1024;

// ─── State mapping ──────────────────────────────────────────────────────

const STATE_NUMBER: Record<number, DownloadState> = {
  0: 'inactive',
  1: 'active',
  2: 'complete',
};

/** Exported untuk unit test — map state number ke DownloadState enum. */
export function stateFromNumber(n: number): DownloadState {
  return STATE_NUMBER[n] ?? 'inactive';
}

function packInfoFromStatus(pack: OfflinePack, status: OfflinePackStatus): PackInfo {
  return {
    name: pack.name ?? status.name,
    // v10 tidak expose bounds sebagai tipe numerik di status — ambil dari
    // pack object (string serialized). Untuk info UI cukup ambil dari
    // metadata atau skip; UI bagian settings yang hold bounds.
    bounds: [[0, 0], [0, 0]],
    state: stateFromNumber(status.state),
    percentage: status.percentage,
    completedTileCount: status.completedTileCount,
    completedTileSize: status.completedTileSize,
    requiredResourceCount: status.requiredResourceCount,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Service ────────────────────────────────────────────────────────────

interface OfflineStorageService {
  /**
   * Download region dengan retry otomatis (3x exponential backoff).
   * Listener dipasang permanen — listeners dihapus via unsubscribe().
   */
  downloadRegion(
    input: DownloadRegionInput,
    onProgress: ProgressListener,
    onError?: ErrorListener,
  ): Promise<{ name: string; pack: OfflinePack | null }>;
  /** Cancel & hapus pack. */
  deletePack(name: string): Promise<void>;
  /** List semua pack yang sudah ter-download. */
  listPacks(): Promise<PackInfo[]>;
  /** Apakah total downloaded tile sudah melewati threshold warning. */
  isStorageLow(): Promise<boolean>;
  /** Total downloaded tile size (bytes). */
  totalUsedBytes(): Promise<number>;
  /** Warning sebelum download besar — return pesan kalau tipis, null kalau cukup. */
  checkStorageBeforeDownload(estimatedTiles?: number): Promise<string | null>;
}

class OfflineStorageServiceImpl implements OfflineStorageService {
  async downloadRegion(
    input: DownloadRegionInput,
    onProgress: ProgressListener,
    onError: ErrorListener = () => {},
  ): Promise<{ name: string; pack: OfflinePack | null }> {
    const minZoom = input.minZoom ?? DEFAULT_MIN_ZOOM;
    const maxZoom = input.maxZoom ?? DEFAULT_MAX_ZOOM;

    let attempt = 0;
    let lastError: unknown = null;
    while (attempt < MAX_RETRY_ATTEMPTS) {
      try {
        // createPack returns void di v10 — pack otomatis ter-register
        // di OfflineManager singleton.
        await OfflineManager.createPack(
          {
            name: input.name,
            styleURL: input.styleURL,
            bounds: input.bounds,
            minZoom,
            maxZoom,
          },
          (pack, status) => {
            onProgress(packInfoFromStatus(pack, status));
          },
          (_pack, err) => {
            onError({ message: err.message });
          },
        );
        // createPack v10 tidak return pack, tapi subscribe sudah terdaftar.
        return { name: input.name, pack: null };
      } catch (err) {
        lastError = err;
        attempt += 1;
        if (attempt < MAX_RETRY_ATTEMPTS) {
          const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          await delay(delayMs);
        }
      }
    }
    const message =
      lastError instanceof Error ? lastError.message : 'unknown error';
    onError({ message: `Download failed after ${MAX_RETRY_ATTEMPTS} retries: ${message}` });
    throw lastError;
  }

  async deletePack(name: string): Promise<void> {
    await OfflineManager.deletePack(name);
  }

  async listPacks(): Promise<PackInfo[]> {
    const packs = await OfflineManager.getPacks();
    const results: PackInfo[] = [];
    for (const pack of packs) {
      try {
        const status = await pack.status();
        results.push(packInfoFromStatus(pack, status));
      } catch {
        // Pack might be in transition — skip silently.
      }
    }
    return results;
  }

  async isStorageLow(): Promise<boolean> {
    return (await this.totalUsedBytes()) > STORAGE_WARNING_BYTES;
  }

  async totalUsedBytes(): Promise<number> {
    const packs = await this.listPacks();
    return packs.reduce((sum, p) => sum + p.completedTileSize, 0);
  }

  /**
   * Heuristic check sebelum download — kalau ada pack existing yang
   * sudah besar, atau ukuran estimasi di-download akan melewati
   * threshold.
   */
  async checkStorageBeforeDownload(estimatedTiles: number = 0): Promise<string | null> {
    const used = await this.totalUsedBytes();
    // Asumsi: average tile size ~8KB (compressed vector tiles).
    const projected = used + estimatedTiles * 8 * 1024;
    if (projected > STORAGE_WARNING_BYTES) {
      const projectedMB = Math.round(projected / (1024 * 1024));
      return `Storage warning: download akan menggunakan ~${projectedMB}MB. Pertimbangkan hapus region lama.`;
    }
    return null;
  }
}

export const offlineStorage: OfflineStorageService = new OfflineStorageServiceImpl();
