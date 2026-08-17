/**
 * Map style constants — consistent tile source across download and view.
 *
 * offlineStorage.downloadRegion uses a backend-served HTTP URL
 * (${API_BASE_URL}/static/style.demotiles.offline.json) to download tiles
 * into MapLibre's native tile cache. The style JSON (with glyphs stripped)
 * is hosted by the NestJS backend at /static/.
 *
 * offlineStorage now uses a direct HTTP URL instead of the old approach
 * (which failed because OfflineManager.createPack rejects file:// and asset:// schemes).
 *
 * When offline, MapScreen uses TILE_STYLE (which references the same tile
 * source via TILE_STYLE_URL) so MapLibre serves cached tiles.
 */

/** Demo vector tile source (TileJSON 2.0.0) — used by MapView.mapStyle (online path).
 *  Zoom range: 0-6 only. Tiles at https://demotiles.maplibre.org/tiles/{z}/{x}/{y}.pbf.
 *
 *  NOTE: preset zoom levels (10-16) return no tiles when downloading offline packs
 *  with this source — this is expected behavior, not a bug. */
export const TILE_STYLE_URL = 'https://demotiles.maplibre.org/tiles/tiles.json';

/** Map style for MapScreen.mapStyle prop.
 *
 * Two layers:
 *  - local_roads: embedded empty GeoJSON (always shows blank road outlines)
 *  - tiles: references the vector tile source that offlineStorage pre-caches.
 *    MapLibre serves these tiles from native cache when offline — no network.
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
