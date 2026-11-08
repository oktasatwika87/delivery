/**
 * Konstanta gaya peta. Ubin OSM disajikan sendiri lewat tileserver-gl:
 *   - Style: ${TILE_BASE_URL}/styles/bali/style.json
 *   - Ubin: ${TILE_BASE_URL}/data/bali/{z}/{x}/{y}.pbf
 *
 * MapScreen memakai buildTileStyle, yang sumber ubinnya menunjuk TileJSON
 * (TILE_TILEJSON_URL). Paket offline diunduh offlineStorage dari style.json
 * server, yang menunjuk TileJSON yang sama, jadi peta dan paket offline memakai
 * URL ubin yang sama.
 */

import Config from 'react-native-config';

/**
 * Alamat style.json di tileserver-gl. Dipakai offlineStorage sebagai styleURL offline pack;
 * MapView tidak memakainya langsung.
 */
export const TILE_STYLE_URL = `${Config.TILE_BASE_URL}/styles/bali/style.json`;

/**
 * TileJSON endpoint dari tileserver-gl.
 * style.json di server mereferensikan ini sebagai vector source, jadi style object
 * yang dipakai MapView harus menunjuk ke sini, bukan ke style.json.
 */
export const TILE_TILEJSON_URL = `${Config.TILE_BASE_URL}/data/bali.json`;

/** Bentuk objek gaya untuk MapView.mapStyle. */
export type TileStyle = {
  version: number;
  name: string;
  sources: Record<string, { type: string; url?: string; data?: unknown }>;
  layers: Array<{
    id: string;
    type: string;
    source?: string;
    'source-layer'?: string;
    paint?: Record<string, unknown>;
  }>;
};

/**
 * Gaya untuk MapScreen.mapStyle. Layer roads memakai GeoJSON kosong
 * (local_roads) sebagai cadangan; tile_roads menggambar jalan dari
 * tileserver-gl, atau dari cache saat offline.
 *
 * Id sumber ubin memakai generation. MapLibre tidak pernah meminta ulang ubin
 * yang gagal dimuat, jadi id diganti supaya ubin diminta lagi setelah koneksi
 * pulih.
 */
export function buildTileStyle(generation: number): TileStyle {
  const tileSourceId = `tiles-${generation}`;
  return {
    version: 8,
    name: 'Offline Tile Style',
    sources: {
      local_roads: {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      },
      [tileSourceId]: {
        type: 'vector',
        url: TILE_TILEJSON_URL,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e8e0d8' } },
      {
        id: 'roads',
        type: 'line',
        source: 'local_roads',
        paint: { 'line-color': '#c8beb4', 'line-width': 2 },
      },
      {
        id: 'tile_roads',
        type: 'line',
        source: tileSourceId,
        'source-layer': 'transportation',
        paint: { 'line-color': '#ffffff', 'line-width': 2 },
      },
    ],
  };
}
