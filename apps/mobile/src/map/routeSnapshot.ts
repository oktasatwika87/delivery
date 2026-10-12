/**
 * routeSnapshot, cache rute terakhir untuk fallback offline.
 *
 * Pencocokan snapshot berdasarkan tujuan saja, radius 25 m. Asal
 * diabaikan - kalau ikut dicek, rute offline akan hilang begitu
 * driver bergeser dari titik saat fetch, padahal rute untuk
 * TUJUAN yang sama masih valid sampai tujuan bergeser > 25 m.
 *
 * Tujuan disimpan apa adanya dari koordinat order, jadi order
 * yang sama selalu berjarak 0, dan 25 m cukup sempit supaya order
 * lain di dekatnya tidak tertukar.
 *
 * LRU 20 entry: cleanup jalan sekali saat app dibuka (App.tsx)
 * dan setelah tiap insert (insertFromRoute).
 */

import { Q } from '@nozbe/watermelondb';
import type { Database } from '@nozbe/watermelondb';

import { RouteSnapshotModel } from '../db/models/RouteSnapshotModel';
import type { LngLat, Route } from './routing';

/** Radius pencocokan tujuan, snapshot yang tujuan-nya dalam 25 m dianggap cocok. */
export const DEST_MATCH_RADIUS_METERS = 25;

/** LRU cap. */
export const MAX_SNAPSHOTS = 20;

/** Earth radius dalam meter, dipakai untuk haversine. */
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

/** Tipe longgar (string atau number) supaya tes bisa pakai objek
 *  biasa tanpa WatermelonDB. Number() mengkonversi keduanya jadi
 *  koordinat valid. */
export interface MinimalDestSnapshot {
  destLat: string | number;
  destLng: string | number;
}

/** Cek apakah snapshot cocok dengan titik tujuan (radius 25 m, asal diabaikan). */
export function destMatches(
  snapshot: MinimalDestSnapshot,
  dest: LngLat,
  radiusMeters: number = DEST_MATCH_RADIUS_METERS,
): boolean {
  const snapDest: LngLat = { lat: Number(snapshot.destLat), lng: Number(snapshot.destLng) };
  return withinRadius(snapDest, dest, radiusMeters);
}

// Service

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
    // Cleanup di background, caller tidak perlu tunggu.
    this.runRetentionCleanup(db).catch((err) =>
      console.warn('[routeSnapshot] post-insert cleanup failed:', err),
    );
    return created;
  }

  /**
   * Query snapshot terbaru yang cocok dengan tujuan query (radius 25 m,
   * asal diabaikan). Return null kalau tidak ada.
   */
  async findMatch(
    db: Database,
    query: { origin: LngLat; destination: LngLat },
  ): Promise<RouteSnapshotModel | null> {
    const collection = db.get<RouteSnapshotModel>('route_snapshots');
    // Pull semua snapshot, dataset kecil (max 20), index scan tidak perlu.
    // Sort by fetched_at desc supaya yang paling baru di-return kalau ada
    // beberapa match.
    const rows = await collection
      .query(Q.sortBy('fetched_at', Q.desc))
      .fetch();

    for (const row of rows) {
      if (destMatches(row, query.destination)) {
        return row;
      }
    }
    return null;
  }

  /**
   * Enforce retention LRU, hapus entry paling lama sampai count <= MAX_SNAPSHOTS.
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
