/**
 * route_snapshots, cache rute terakhir untuk fallback offline.
 *
 * Setiap row = 1 snapshot rute yang berhasil di-fetch dari routing API.
 * Disimpan dengan:
 *   - origin_lat/lng, dest_lat/lng  jadi untuk matching (haversine 300m radius)
 *   - geometry_json jadi GeoJSON LineString sebagai string
 *   - fetched_at    jadi timestamp fetch (epoch ms). Dicatat terpisah dari
 *                     created_at supaya sinkron dengan waktu server.
 *
 * Retention: max 20 snapshot LRU (cleanup di src/map/routeSnapshot.ts,
 * triggered sekali saat app boot).
 */

import { Model } from '@nozbe/watermelondb';
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators';

export class RouteSnapshotModel extends Model {
  static override table = 'route_snapshots';

  @text('origin_lat') originLat!: string;
  @text('origin_lng') originLng!: string;
  @text('dest_lat') destLat!: string;
  @text('dest_lng') destLng!: string;
  @text('geometry_json') geometryJson!: string;
  /** Epoch ms, kapan routing API di-fetch. */
  @field('fetched_at') fetchedAt!: number;

  @readonly @date('created_at') createdAt!: Date;
  /** Alias fetched_at, ikut updated_at WatermelonDB pattern. */
  @readonly @date('updated_at') updatedAt!: Date;
}
