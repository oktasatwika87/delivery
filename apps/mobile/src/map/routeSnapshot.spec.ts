/**
 * Unit tests untuk routeSnapshot.ts
 *
 * Test focus:
 * - Haversine distance calculation
 * - withinRadius matching with 300m threshold
 * - LRU retention: keep newest 20, delete oldest
 */

import { haversineDistance, withinRadius, MATCH_RADIUS_METERS, MAX_SNAPSHOTS } from './routeSnapshot';

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

// Simulasi withinRadius dengan logic yang sama
function mockWithinRadius(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  radiusMeters: number,
): boolean {
  return haversineDistance(a, b) <= radiusMeters;
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

    test('MATCH_RADIUS_METERS constant is 300', () => {
      expect(MATCH_RADIUS_METERS).toBe(300);
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
    test('snapshot 100m from origin AND 150m from dest matches query', () => {
      const queryOrigin = { lat: -6.175, lng: 106.827 };
      const queryDest = { lat: -6.2, lng: 106.85 };

      // Snapshot origin ~100m north of query origin
      const snapOrigin = { lat: -6.176, lng: 106.827 };
      // Snapshot dest ~150m from query dest
      const snapDest = { lat: -6.2015, lng: 106.851 };

      const originMatch = mockWithinRadius(snapOrigin, queryOrigin, 300);
      const destMatch = mockWithinRadius(snapDest, queryDest, 300);

      expect(originMatch).toBe(true);
      expect(destMatch).toBe(true);
    });

    test('snapshot 400m from origin does NOT match', () => {
      const queryOrigin = { lat: -6.175, lng: 106.827 };

      // Snapshot origin ~400m north (outside 300m)
      const snapOrigin = { lat: -6.179, lng: 106.827 };

      const originMatch = mockWithinRadius(snapOrigin, queryOrigin, 300);

      expect(originMatch).toBe(false);
      // No need to check dest since origin already fails
    });

    test('snapshot matches even when slightly outside city block', () => {
      // Jakarta typical block size ~100-150m
      // Snapshot half a block away (~75m) should match
      const queryOrigin = { lat: -6.175, lng: 106.827 };
      const snapOrigin = { lat: -6.17568, lng: 106.828 }; // ~75m SE

      const destQuery = { lat: -6.2, lng: 106.85 };
      const snapDest = { lat: -6.20136, lng: 106.851 }; // ~150m SE

      expect(mockWithinRadius(snapOrigin, queryOrigin, 300)).toBe(true);
      expect(mockWithinRadius(snapDest, destQuery, 300)).toBe(true);
    });
  });
});
