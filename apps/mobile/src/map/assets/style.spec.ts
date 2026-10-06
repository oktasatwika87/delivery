/**
 * Unit tests untuk style.ts — vector source url harus TileJSON, bukan style JSON.
 */

import { TILE_STYLE, TILE_STYLE_URL, TILE_TILEJSON_URL } from './style';

// Mock react-native-config
jest.mock('react-native-config', () => ({
  __esModule: true,
  default: {
    API_BASE_URL: 'http://10.0.2.2:3000',
    TILE_BASE_URL: 'http://10.0.2.2:8080',
  },
}));

describe('style', () => {
  describe('TILE_TILEJSON_URL', () => {
    test('menunjuk ke endpoint /data/bali.json', () => {
      expect(TILE_TILEJSON_URL).toBe('http://10.0.2.2:8080/data/bali.json');
    });
  });

  describe('TILE_STYLE_URL', () => {
    test('menunjuk ke endpoint /styles/bali/style.json', () => {
      expect(TILE_STYLE_URL).toBe('http://10.0.2.2:8080/styles/bali/style.json');
    });
  });

  describe('TILE_STYLE JSON', () => {
    test('vector source tiles url menunjuk ke TileJSON endpoint', () => {
      const parsed = JSON.parse(TILE_STYLE);
      expect(parsed.sources.tiles.url).toBe('http://10.0.2.2:8080/data/bali.json');
    });

    test('mengandung layer tile_roads dengan source-layer transportation dan warna putih', () => {
      const parsed = JSON.parse(TILE_STYLE);
      const tileRoads = parsed.layers.find(
        (l: { id: string }) => l.id === 'tile_roads',
      );
      expect(tileRoads).toBeDefined();
      expect(tileRoads['source-layer']).toBe('transportation');
      expect(tileRoads.paint['line-color']).toBe('#ffffff');
      expect(tileRoads.paint['line-width']).toBe(2);
    });
  });
});
