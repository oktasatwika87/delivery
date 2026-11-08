/**
 * Unit tests untuk style.ts, vector source url harus TileJSON, bukan style JSON.
 */

import { buildTileStyle, TILE_STYLE_URL, TILE_TILEJSON_URL } from './style';

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

  describe('buildTileStyle', () => {
    test('id sumber vektor memuat generation', () => {
      expect(Object.keys(buildTileStyle(0).sources)).toContain('tiles-0');
      expect(Object.keys(buildTileStyle(7).sources)).toContain('tiles-7');
    });

    test('layer tile_roads menunjuk id sumber yang sama', () => {
      const style = buildTileStyle(3);
      const tileRoads = style.layers.find((l) => l.id === 'tile_roads');
      expect(tileRoads).toBeDefined();
      expect(tileRoads?.source).toBe('tiles-3');
    });

    test('url TileJSON tetap sama antar generation', () => {
      expect(buildTileStyle(0).sources['tiles-0'].url).toBe(
        'http://10.0.2.2:8080/data/bali.json',
      );
      expect(buildTileStyle(9).sources['tiles-9'].url).toBe(
        'http://10.0.2.2:8080/data/bali.json',
      );
    });

    test('dua generation berbeda menghasilkan id sumber berbeda', () => {
      const first = buildTileStyle(0);
      const second = buildTileStyle(1);
      expect(Object.keys(first.sources)).not.toEqual(Object.keys(second.sources));
    });

    test('layer tile_roads tetap pakai transportation dan warna putih', () => {
      const style = buildTileStyle(1);
      const tileRoads = style.layers.find((l) => l.id === 'tile_roads');
      expect(tileRoads?.['source-layer']).toBe('transportation');
      expect(tileRoads?.paint?.['line-color']).toBe('#ffffff');
      expect(tileRoads?.paint?.['line-width']).toBe(2);
    });
  });
});
