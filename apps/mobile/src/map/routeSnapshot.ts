/**
 * routeSnapshot — service untuk cache rute terakhir & fallback offline.
 *
 * Tanggung jawab:
 *   1. Simpan snapshot baru ke route_snapshots setelah getRoute() sukses.
 *   2. Query snapshot yang cocok dengan query saat ini (origin & dest
 *      masing-masing dalam radius 300m, haversine).
 *   3. Enforce retention LRU max 20 entry — cleanup jalankan sekali saat
 *      app boot (dipanggil dari App.tsx via runRetentionCleanup).
 *
 * Catatan desain:
 *   - Radius 300m — cukup dekat untuk pickup point yang geser sedikit,
 *     cukup longgar untuk false-match dihindari.
 *   - LRU 20 entry — independen dari pasangan origin-destination, snapshot
 *     paling lama di-evict ketika insert baru kelebihan.
 *   - Cleanup TIDAK pakai interval — sekali per boot, lewat App.tsx,
 *     supaya hemat baterai (lihat keputusan #8).
 */

import { Q } from '@nozbe/watermelondb';
import type { Database } from '@nozbe/watermelondb';

import { RouteSnapshotModel } from '../db/models/RouteSnapshotModel';
import type { LngLat, Route } from './routing';

/** Radius matching — origin & dest masing-masing harus berada dalam 300m. */
export const MATCH_RADIUS_METERS = 300;

/** LRU cap — lihat keputusan #7. */
export const MAX_SNAPSHOTS = 20;

/** Earth radius dalam meter — dipakai untuk haversine. */
const EARTH_RADIUS_M = 6_371_000;

/**
 * Haversine distance (meter) antara dua koordinat lat/lng.
 * Export-kan supaya bisa di-test langsung.
 */
export function haversineDistance(a: LngLat, b: LngLat): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Apakah dua titik berada dalam radius tertentu (meter).
 * Export-kan untuk unit test.
 */
export function withinRadius(a: LngLat, b: LngLat, radiusMeters: number): boolean {
  return haversineDistance(a, b) <= radiusMeters;
}

/**
 * Cek apakah snapshot match dengan query — baik origin maupun dest
 * masing-masing harus berada dalam MATCH_RADIUS_METERS.
 */
export function snapshotMatches(
  snapshot: RouteSnapshotModel,
  query: { origin: LngLat; destination: LngLat },
  radiusMeters: number = MATCH_RADIUS_METERS,
): boolean {
  const snapOrigin: LngLat = { lat: Number(snapshot.originLat), lng: Number(snapshot.originLng) };
  const snapDest: LngLat = { lat: Number(snapshot.destLat), lng: Number(snapshot.destLng) };
  return (
    withinRadius(snapOrigin, query.origin, radiusMeters) &&
    withinRadius(snapDest, query.destination, radiusMeters)
  );
}

// ─── Service ────────────────────────────────────────────────────────────────

export interface RouteSnapshotService {
  insertFromRoute(db: Database, route: Route): Promise<RouteSnapshotModel>;
  findMatch(
    db: Database,
    query: { origin: LngLat; destination: LngLat },
  ): Promise<RouteSnapshotModel | null>;
  runRetentionCleanup(db: Database): Promise<number>;
}

class RouteSnapshotServiceImpl implements RouteSnapshotService {
  /**
   * Insert snapshot baru. Setelah insert, jalankan retention cleanup supaya
   * table tidak pernah berisi > MAX_SNAPSHOTS row.
   */
  async insertFromRoute(db: Database, route: Route): Promise<RouteSnapshotModel> {
    const collection = db.get<RouteSnapshotModel>('route_snapshots');
    const geometryJson = JSON.stringify({
      type: 'LineString',
      coordinates: route.geometry,
    });

    let created: RouteSnapshotModel | null = null;
    await db.write(async () => {
      created = await collection.create((row) => {
        row.originLat = route.origin.lat.toString();
        row.originLng = route.origin.lng.toString();
        row.destLat = route.destination.lat.toString();
        row.destLng = route.destination.lng.toString();
        row.geometryJson = geometryJson;
        row.fetchedAt = Date.now();
      });
    });

    if (!created) throw new Error('Failed to create RouteSnapshotModel');
    // Cleanup di background — caller tidak perlu tunggu.
    this.runRetentionCleanup(db).catch((err) =>
      console.warn('[routeSnapshot] post-insert cleanup failed:', err),
    );
    return created;
  }

  /**
   * Query snapshot terbaru yang match dengan query (origin & dest radius match).
   * Return null kalau tidak ada.
   */
  async findMatch(
    db: Database,
    query: { origin: LngLat; destination: LngLat },
  ): Promise<RouteSnapshotModel | null> {
    const collection = db.get<RouteSnapshotModel>('route_snapshots');
    // Pull semua snapshot — dataset kecil (max 20), index scan tidak perlu.
    // Sort by fetched_at desc supaya yang paling baru di-return kalau ada
    // beberapa match.
    const rows = await collection
      .query(Q.sortBy('fetched_at', Q.desc))
      .fetch();

    for (const row of rows) {
      if (snapshotMatches(row, query)) {
        return row;
      }
    }
    return null;
  }

  /**
   * Enforce retention LRU — hapus entry paling lama sampai count <= MAX_SNAPSHOTS.
   * Dipanggil sekali saat app boot (lihat App.tsx useEffect), supaya hemat
   * interval & baterai (keputusan #8).
   *
   * Return jumlah row yang dihapus.
   */
  async runRetentionCleanup(db: Database): Promise<number> {
    const collection = db.get<RouteSnapshotModel>('route_snapshots');
    const all = await collection.query(Q.sortBy('fetched_at', Q.desc)).fetch();
    if (all.length <= MAX_SNAPSHOTS) return 0;

    const toDelete = all.slice(MAX_SNAPSHOTS);
    await db.write(async () => {
      await db.batch(...toDelete.map((row) => row.prepareDestroyPermanently()));
    });
    return toDelete.length;
  }
}

export const routeSnapshotService: RouteSnapshotService = new RouteSnapshotServiceImpl();
