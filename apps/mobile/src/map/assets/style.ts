/**
 * Map style constants — consistent tile source across download and view.
 *
 * offlineStorage.downloadRegion uses TILE_STYLE_URL to download tiles into
 * MapLibre's native tile cache. When offline, MapScreen uses TILE_STYLE
 * (which references the same tile source) so MapLibre serves cached tiles.
 * Until tiles are downloaded, a local GeoJSON layer ensures the map is not
 * blank — but the real tile layer will appear once offline region is ready.
 */

/** Demo vector tile style — used by offlineStorage.downloadRegion to
 *  seed MapLibre's native tile cache. Must match TILE_STYLE's source URL. */
export const TILE_STYLE_URL = 'https://demotiles.maplibre.org/style.json';

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
