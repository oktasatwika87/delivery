/**
 * Unit tests untuk routeSnapshot.ts
 *
 * Test focus:
 * - Haversine distance calculation
 * - withinRadius matching with 300m threshold
 * - LRU retention: keep newest 20, delete oldest
 */

import { haversineDistance, withinRadius, MAX_SNAPSHOTS, destMatches, DEST_MATCH_RADIUS_METERS } from './routeSnapshot';

// Mock types

interface MockRouteSnapshot {
  id: string;
  originLat: string;
  originLng: string;
  destLat: string;
  destLng: string;
  fetchedAt: number;
}

// Test helpers

/**
 * Buat mock snapshot dengan koordinat.
 * fetchedAt default incremental supaya urutan jelas.
 */
const snapshots: MockRouteSnapshot[] = [];
let snapshotCounter = 0;

function resetSnapshots() {
  snapshots.length = 0;
  snapshotCounter = 0;
}

function createSnapshot(
  id: string,
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): MockRouteSnapshot {
  const snapshot: MockRouteSnapshot = {
    id,
    originLat: originLat.toString(),
    originLng: originLng.toString(),
    destLat: destLat.toString(),
    destLng: destLng.toString(),
    fetchedAt: Date.now() + snapshotCounter++,
  };
  snapshots.push(snapshot);
  return snapshot;
}


// Tests

describe('routeSnapshot', () => {
  beforeEach(() => {
    resetSnapshots();
  });

  describe('haversineDistance()', () => {
    test('zero distance for same coordinates', () => {
      const point = { lat: -6.175, lng: 106.827 };
      expect(haversineDistance(point, point)).toBe(0);
    });

    test('known distance Jakarta to Bandung (~120km)', () => {
      // Jakarta: -6.2088, 106.8456
      // Bandung: -6.9175, 107.6191
      const jakarta = { lat: -6.2088, lng: 106.8456 };
      const bandung = { lat: -6.9175, lng: 107.6191 };
      const dist = haversineDistance(jakarta, bandung);
      // Should be approximately 120-125 km
      expect(dist).toBeGreaterThan(115_000);
      expect(dist).toBeLessThan(130_000);
    });

    test('very short distance (same building)', () => {
      // Two points ~50m apart
      const a = { lat: -6.175, lng: 106.827 };
      const b = { lat: -6.17545, lng: 106.82745 };
      const dist = haversineDistance(a, b);
      expect(dist).toBeLessThan(100);
      expect(dist).toBeGreaterThan(20);
    });
  });

  describe('withinRadius()', () => {
    test('exact same point is within radius', () => {
      const point = { lat: -6.175, lng: 106.827 };
      expect(withinRadius(point, point, 300)).toBe(true);
    });

    test('point 50m away is within 300m radius', () => {
      const a = { lat: -6.175, lng: 106.827 };
      const b = { lat: -6.17545, lng: 106.82745 };
      expect(withinRadius(a, b, 300)).toBe(true);
    });

    test('point 500m away is outside 300m radius', () => {
      const a = { lat: -6.175, lng: 106.827 };
      // ~500m north
      const b = { lat: -6.1795, lng: 106.827 };
      expect(withinRadius(a, b, 300)).toBe(false);
    });

    test('DEST_MATCH_RADIUS_METERS constant is 25', () => {
      expect(DEST_MATCH_RADIUS_METERS).toBe(25);
    });
  });

  describe('LRU retention (MAX_SNAPSHOTS)', () => {
    test('MAX_SNAPSHOTS constant is 20', () => {
      expect(MAX_SNAPSHOTS).toBe(20);
    });

    test('simulates keeping newest 20 entries', () => {
      // Create 25 snapshots (more than MAX_SNAPSHOTS)
      for (let i = 0; i < 25; i++) {
        createSnapshot(
          `snap-${i}`,
          -6.175 + i * 0.001, // varied lat
          106.827 + i * 0.001, // varied lng
          -6.2 + i * 0.001,
          106.85 + i * 0.001,
        );
      }

      expect(snapshots).toHaveLength(25);

      // Simulate retention: sort by fetchedAt desc, keep first 20
      const sorted = [...snapshots].sort((a, b) => b.fetchedAt - a.fetchedAt);
      const kept = sorted.slice(0, MAX_SNAPSHOTS);
      const toDelete = sorted.slice(MAX_SNAPSHOTS);

      expect(kept).toHaveLength(20);
      expect(toDelete).toHaveLength(5);

      // The oldest 5 (snap-0 through snap-4) should be deleted
      const deletedIds = toDelete.map((s) => s.id);
      expect(deletedIds).toContain('snap-0');
      expect(deletedIds).toContain('snap-4');

      // The newest 5 (snap-20 through snap-24) should be kept
      const keptIds = kept.map((s) => s.id);
      expect(keptIds).toContain('snap-20');
      expect(keptIds).toContain('snap-24');
    });

    test('no deletion when under MAX_SNAPSHOTS', () => {
      // Create only 15 snapshots
      for (let i = 0; i < 15; i++) {
        createSnapshot(`snap-${i}`, -6.175, 106.827, -6.2, 106.85);
      }

      const sorted = [...snapshots].sort((a, b) => b.fetchedAt - a.fetchedAt);
      const toDelete = sorted.slice(MAX_SNAPSHOTS);

      expect(toDelete).toHaveLength(0);
    });

    test('exact boundary: 20 entries stays unchanged', () => {
      // Create exactly 20
      for (let i = 0; i < 20; i++) {
        createSnapshot(`snap-${i}`, -6.175, 106.827, -6.2, 106.85);
      }

      const sorted = [...snapshots].sort((a, b) => b.fetchedAt - a.fetchedAt);
      const toDelete = sorted.slice(MAX_SNAPSHOTS);

      expect(toDelete).toHaveLength(0);
    });
  });

  describe('radius matching scenarios', () => {
    // destMatches(): menerima snapshot minimal { destLat, destLng } dan
    // titik tujuan. Snapshot disimpan WatermelonDB sebagai string, jadi
    // Number(string) harus menghasilkan koordinat valid.
    describe('destMatches() dengan snapshot sebagai objek biasa', () => {
      test('asal beda sekitar 2 km tapi tujuan sama: cocok (asal diabaikan)', () => {
        // Snapshot punya tujuan [-6.2, 106.85]. Query minta tujuan sama
        // tapi asal 2 km lebih utara. Pencocokan hanya lihat tujuan.
        const snapshot = { destLat: '-6.2', destLng: '106.85' };
        // 2 km offset latitude = 2_000 / 111_000 ~ 0.018 deg
        const queryOrigin = { lat: -6.218, lng: 106.85 };
        const queryDest = { lat: -6.2, lng: 106.85 };
        // Asal query memang beda 2 km dari snapshot (kalau dicek manual).
        expect(haversineDistance(queryOrigin, { lat: -6.2, lng: 106.85 })).toBeGreaterThan(1500);
        // destMatches hanya lihat tujuan, jadi cocok.
        expect(destMatches(snapshot, queryDest)).toBe(true);
      });

      test('tujuan beda sekitar 30 m: tidak cocok', () => {
        const snapshot = { destLat: '-6.2', destLng: '106.85' };
        // 30 m offset latitude = 30 / 111_000 ~ 0.00027 deg
        const queryDest = { lat: -6.1997, lng: 106.85 };
        // Sanity: jarak memang di atas 25 m
        const dist = haversineDistance({ lat: -6.2, lng: 106.85 }, queryDest);
        expect(dist).toBeGreaterThan(DEST_MATCH_RADIUS_METERS);
        expect(destMatches(snapshot, queryDest)).toBe(false);
      });

      test('tujuan sama persis: cocok', () => {
        const snapshot = { destLat: '-6.2', destLng: '106.85' };
        const queryDest = { lat: -6.2, lng: 106.85 };
        expect(destMatches(snapshot, queryDest)).toBe(true);
      });

      test('destLat dan destLng number (bukan string) juga diterima', () => {
        const snapshot = { destLat: -6.2, destLng: 106.85 };
        const queryDest = { lat: -6.2, lng: 106.85 };
        expect(destMatches(snapshot, queryDest)).toBe(true);
      });
    });
  });
});
