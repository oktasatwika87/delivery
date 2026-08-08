/**
 * routeService — orchestration layer untuk offline-first routing.
 *
 * Tanggung jawab:
 *   1. Koordinasikan RoutingProvider (GraphHopper) dengan routeSnapshot (cache).
 *   2. Cek network status sebelum fetch — hemat waktu kalau offline.
 *   3. Simpan rute hasil fetch ke snapshot untuk fallback offline.
 *   4. Return flag `isFromCache` supaya UI bisa tampilkan indikator visual.
 *
 * Flow getRoute(request):
 *   - Online → fetch dari RoutingProvider → simpan snapshot → return live route
 *   - Online tapi fetch gagal + ada snapshot match → return snapshot (isFromCache: true)
 *   - Offline + ada snapshot match → return snapshot (isFromCache: true)
 *   - Offline + tidak ada snapshot → throw "Rute tidak tersedia..."
 *
 * Catatan desain:
 *   - Tidak hardcode GraphHopperRoutingProvider — terima RoutingProvider via
 *     constructor (DI pattern) supaya gampang di-swap atau di-mock untuk testing.
 *   - Tidak hardcode routeSnapshotService — juga terima via constructor.
 */

import type { Database } from '@nozbe/watermelondb';

import { networkMonitor } from './networkMonitor';
import { routeSnapshotService } from './routeSnapshot';
import { RouteSnapshotModel } from '../db/models/RouteSnapshotModel';
import { InvalidConfigError } from './routing';
import type { Route, RouteRequest, RoutingProvider } from './routing';

/**
 * Result dari getRoute().
 * Flag isFromCache mengindikasikan apakah rute dari snapshot (stale) atau
 * hasil fetch live. UI bisa pakai flag ini untuk tampilkan "stale data"
 * indicator.
 */
export interface RouteResult {
  route: Route;
  /** true kalau rute dari snapshot, false kalau dari fetch live. */
  isFromCache: boolean;
}

/** Error yang dilempar kalau tidak ada rute sama sekali. */
export class RouteUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteUnavailableError';
  }
}

export interface RouteServiceDependencies {
  /** Provider untuk fetch rute dari API (GraphHopper, OSRM, dll). */
  routingProvider: RoutingProvider;
  /** WatermelonDB instance untuk akses route_snapshots table. */
  database: Database;
}

/**
 * RouteService — menyusun RoutingProvider + routeSnapshot + networkMonitor
 * jadi satu interface yang gampang dipanggil dari MapScreen.
 */
export class RouteService {
  private readonly routingProvider: RoutingProvider;
  private readonly database: Database;

  constructor(deps: RouteServiceDependencies) {
    this.routingProvider = deps.routingProvider;
    this.database = deps.database;
  }

  /**
   * Ambil rute dengan offline-first strategy.
   *
   * 1. Kalau online → coba fetch dari routingProvider.
   * 2. Fetch sukses → simpan ke snapshot, return live route.
   * 3. Fetch gagal ATAU offline → fallback ke snapshot match.
   * 4. Tidak ada snapshot match → throw RouteUnavailableError.
   */
  async getRoute(request: RouteRequest): Promise<RouteResult> {
    const isOnline = networkMonitor.getStatus() === 'online';

    if (isOnline) {
      try {
        const route = await this.routingProvider.getRoute(request);
        await this.saveSnapshot(route);
        return { route, isFromCache: false };
      } catch (fetchError) {
        // Fetch gagal — coba fallback ke snapshot
        const snapshot = await this.findMatch(request);

        // Bedakan config error dari transient error
        if (fetchError instanceof InvalidConfigError) {
          console.error(
            '[routeService] Config error dari routing provider (bukan transient):',
            fetchError.message,
          );
          if (snapshot) {
            // Fallback tetap diberikan tapi root cause sudah di-log
            return { route: this.snapshotToRoute(snapshot), isFromCache: true };
          }
          throw new RouteUnavailableError(
            `Rute tidak tersedia. Root cause: ${fetchError.message} ` +
              '(tidak ada rute tersimpan untuk area ini).',
          );
        }

        if (snapshot) {
          return { route: this.snapshotToRoute(snapshot), isFromCache: true };
        }
        // Tidak ada snapshot → gagal total
        throw new RouteUnavailableError(
          `Rute tidak tersedia, tidak ada koneksi dan tidak ada rute tersimpan untuk area ini.`,
        );
      }
    } else {
      // Offline langsung — tidak coba fetch
      const snapshot = await this.findMatch(request);
      if (snapshot) {
        return { route: this.snapshotToRoute(snapshot), isFromCache: true };
      }
      throw new RouteUnavailableError(
        `Rute tidak tersedia, tidak ada koneksi dan tidak ada rute tersimpan untuk area ini.`,
      );
    }
  }

  /**
   * Convert RouteSnapshotModel (WatermelonDB) ke Route (interface RoutingProvider).
   */
  private snapshotToRoute(snapshot: RouteSnapshotModel): Route {
    const parsed = JSON.parse(snapshot.geometryJson);
    return {
      origin: { lat: Number(snapshot.originLat), lng: Number(snapshot.originLng) },
      destination: { lat: Number(snapshot.destLat), lng: Number(snapshot.destLng) },
      geometry: parsed.coordinates as Array<[number, number]>,
    };
  }

  /**
   * Simpan rute ke snapshot. Error di-simpan secara async — caller tidak perlu tunggu.
   */
  private async saveSnapshot(route: Route): Promise<void> {
    routeSnapshotService
      .insertFromRoute(this.database, route)
      .catch((err) => console.warn('[routeService] failed to save snapshot:', err));
  }

  /**
   * Cari snapshot yang match dengan request (radius 300m matching).
   */
  private async findMatch(request: RouteRequest) {
    return routeSnapshotService.findMatch(this.database, {
      origin: request.origin,
      destination: request.destination,
    });
  }
}
