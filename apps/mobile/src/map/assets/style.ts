/**
 * Map style constants — consistent tile source across download and view.
 *
 * Self-hosted OSM tiles via tileserver-gl (VPS):
 *   - Style: ${TILE_BASE_URL}/styles/bali/style.json
 *   - Tiles: ${TILE_BASE_URL}/data/bali/{z}/{x}/{y}.pbf
 *
 * TILE_STYLE_URL is used by:
 *   1. MapScreen (online path) — MapView.mapStyle references TILE_STYLE,
 *      which points at TILE_STYLE_URL (tileserver-gl style.json).
 *   2. offlineStorage.downloadRegion (offline path) — OfflineManager.createPack
 *      uses OFFLINE_STYLE_URL to pre-cache tiles from tileserver-gl.
 *
 * Both paths read the same tile source (tileserver-gl serves the .mbtiles
 * at /data/bali.json TileJSON endpoint, style.json references it as "/data/bali.json"
 * relative URL so OfflineManager resolves it correctly).
 */

import Config from 'react-native-config';

/**
 * TileJSON endpoint from tileserver-gl.
 * Points at /data/bali.json (relative path so OfflineManager resolves it).
 *
 * Zoom range: 0-20 (self-hosted Bali extract, not limited like demotiles z0-6).
 */
export const TILE_STYLE_URL = `${Config.TILE_BASE_URL}/styles/bali/style.json`;

/** Map style for MapScreen.mapStyle prop.
 *
 * Two layers:
 *   - local_roads: embedded empty GeoJSON (always shows blank road outlines
 *     as fallback when tile source is unavailable).
 *   - tile_roads: references the self-hosted tile source served by tileserver-gl.
 *     MapLibre serves these tiles from native cache when offline.
 *
 * Type 'string' so Metro parses as JSON. Passed as object to MapView
 * via JSON.parse, so both the GeoJSON and tile source are resolved.
 */
export const TILE_STYLE: string = JSON.stringify({
  version: 8,
  name: 'Offline Tile Style',
  sources: {
    local_roads: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    },
    tiles: {
      type: 'vector',
      url: TILE_STYLE_URL,
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
      source: 'tiles',
      'source-layer': 'transportation',
      paint: { 'line-color': '#ffffff', 'line-width': 2 },
    },
  ],
});
