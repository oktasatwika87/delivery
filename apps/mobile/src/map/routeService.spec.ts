/**
 * Unit tests untuk routeService.ts
 *
 * Test scenarios:
 * 1. Online + fetch sukses jadi return rute baru + snapshot tersimpan
 * 2. Online tapi fetch gagal + ada snapshot match jadi return snapshot dengan isFromCache
 * 3. Offline + ada snapshot match jadi return snapshot dengan isFromCache (tanpa fetch)
 * 4. Offline + tidak ada snapshot match jadi return error yang jelas
 * 5. Fetch sukses tapi origin/dest di luar 300m dari snapshot manapun jadi simpan sebagai
 *    snapshot baru terpisah (bukan overwrite)
 */

import type { Database } from '@nozbe/watermelondb';

import { networkMonitor } from './networkMonitor';
import { routeSnapshotService } from './routeSnapshot';
import { RouteService, RouteUnavailableError } from './routeService';
import { InvalidConfigError } from './routing';
import type { Route, RouteRequest, RoutingProvider } from './routing';

// Mock types & helpers

interface MockRoutingProvider extends RoutingProvider {
  getRoute: jest.MockedFunction<(req: RouteRequest) => Promise<Route>>;
}

interface MockSnapshotModel {
  id: string;
  originLat: string;
  originLng: string;
  destLat: string;
  destLng: string;
  geometryJson: string;
  fetchedAt: number;
}

function createMockRoute(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
  distanceMeters = 5000,
): Route {
  return {
    origin,
    destination: dest,
    geometry: [
      [origin.lng, origin.lat],
      [dest.lng, dest.lat],
    ],
    distanceMeters,
    durationSeconds: 600,
  };
}

function createMockSnapshot(
  id: string,
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number },
): MockSnapshotModel {
  return {
    id,
    originLat: origin.lat.toString(),
    originLng: origin.lng.toString(),
    destLat: dest.lat.toString(),
    destLng: dest.lng.toString(),
    geometryJson: JSON.stringify({
      type: 'LineString',
      coordinates: [
        [origin.lng, origin.lat],
        [dest.lng, dest.lat],
      ],
    }),
    fetchedAt: Date.now(),
  };
}

// Test setup

describe('RouteService', () => {
  let mockDb: jest.MockedObject<Database>;
  let mockProvider: MockRoutingProvider;
  let routeService: RouteService;

  const testOrigin = { lat: -6.175, lng: 106.827 };
  const testDest = { lat: -6.2, lng: 106.85 };
  const testRequest: RouteRequest = { origin: testOrigin, destination: testDest };

  beforeEach(() => {
    // Reset global mocks
    jest.clearAllMocks();

    // Mock database (minimal implementation)
    mockDb = {
      get: jest.fn(),
      write: jest.fn(),
    } as unknown as jest.MockedObject<Database>;

    // Mock routing provider
    mockProvider = {
      getRoute: jest.fn(),
    } as unknown as MockRoutingProvider;

    // Create RouteService instance
    routeService = new RouteService({
      routingProvider: mockProvider,
      database: mockDb,
    });

    // Stop networkMonitor to prevent background checks
    networkMonitor.stop();
  });

  afterEach(() => {
    networkMonitor.stop();
  });

  describe('getRoute()', () => {
    describe('Online + fetch sukses', () => {
      test('return rute baru + snapshot tersimpan + isFromCache: false', async () => {
        // Arrange: network online
        jest.spyOn(networkMonitor, 'getStatus').mockReturnValue('online');

        const liveRoute = createMockRoute(testOrigin, testDest, 5000);
        mockProvider.getRoute.mockResolvedValue(liveRoute);

        const mockCollection = {
          create: jest.fn().mockResolvedValue({ id: 'snap-1' }),
        };
        (mockDb.get as jest.MockedFunction<typeof mockDb.get>).mockReturnValue(mockCollection as never);

        // Spy on routeSnapshotService.insertFromRoute
        const insertSpy = jest.spyOn(routeSnapshotService, 'insertFromRoute').mockResolvedValue({ id: 'snap-1' } as never);

        // Act
        const result = await routeService.getRoute(testRequest);

        // Assert: return live route
        expect(result.route).toEqual(liveRoute);
        expect(result.isFromCache).toBe(false);

        // Assert: provider.getRoute called once
        expect(mockProvider.getRoute).toHaveBeenCalledTimes(1);
        expect(mockProvider.getRoute).toHaveBeenCalledWith(testRequest);

        // Assert: snapshot service called to save
        expect(insertSpy).toHaveBeenCalled();
        insertSpy.mockRestore();
      });
    });

    describe('Online tapi fetch gagal + ada snapshot match', () => {
      test('return snapshot dengan isFromCache: true', async () => {
        // Arrange: network online
        jest.spyOn(networkMonitor, 'getStatus').mockReturnValue('online');

        // Provider throws
        mockProvider.getRoute.mockRejectedValue(new Error('API timeout'));

        // But snapshot exists
        const mockSnapshot = createMockSnapshot('snap-1', testOrigin, testDest);
        jest.spyOn(routeSnapshotService, 'findMatch').mockResolvedValue(mockSnapshot as never);

        // Act
        const result = await routeService.getRoute(testRequest);

        // Assert: return snapshot
        expect(result.isFromCache).toBe(true);
        expect(result.route.geometry).toBeDefined();
        expect(mockProvider.getRoute).toHaveBeenCalled(); // Still called once
      });
    });

    describe('Offline + ada snapshot match', () => {
      test('return snapshot dengan isFromCache: true (tanpa fetch)', async () => {
        // Arrange: network offline
        jest.spyOn(networkMonitor, 'getStatus').mockReturnValue('offline');

        // Snapshot exists
        const mockSnapshot = createMockSnapshot('snap-1', testOrigin, testDest);
        jest.spyOn(routeSnapshotService, 'findMatch').mockResolvedValue(mockSnapshot as never);

        // Act
        const result = await routeService.getRoute(testRequest);

        // Assert: return snapshot
        expect(result.isFromCache).toBe(true);
        expect(result.route.geometry).toBeDefined();

        // Assert: provider NOT called (offline, skip fetch)
        expect(mockProvider.getRoute).not.toHaveBeenCalled();
      });
    });

    describe('Offline + tidak ada snapshot match', () => {
      test('return RouteUnavailableError dengan pesan yang jelas', async () => {
        // Arrange: network offline
        jest.spyOn(networkMonitor, 'getStatus').mockReturnValue('offline');

        // No snapshot
        jest.spyOn(routeSnapshotService, 'findMatch').mockResolvedValue(null);

        // Act & Assert
        await expect(routeService.getRoute(testRequest)).rejects.toThrow(RouteUnavailableError);
        await expect(routeService.getRoute(testRequest)).rejects.toThrow(
          'Rute tidak tersedia, tidak ada koneksi dan tidak ada rute tersimpan untuk area ini.',
        );

        // Assert: provider NOT called
        expect(mockProvider.getRoute).not.toHaveBeenCalled();
      });
    });

    describe('Fetch sukses tapi di luar 300m radius', () => {
      test('tetap simpan sebagai snapshot baru terpisah', async () => {
        // Arrange: network online
        jest.spyOn(networkMonitor, 'getStatus').mockReturnValue('online');

        const newOrigin = { lat: -6.5, lng: 107.0 }; // ~50km away (outside 300m)
        const newDest = { lat: -6.6, lng: 107.1 };
        const requestFarAway: RouteRequest = {
          origin: newOrigin,
          destination: newDest,
        };

        const liveRoute = createMockRoute(newOrigin, newDest, 50000);
        mockProvider.getRoute.mockResolvedValue(liveRoute);

        const mockCollection = {
          create: jest.fn().mockResolvedValue({ id: 'snap-new' }),
        };
        (mockDb.get as jest.MockedFunction<typeof mockDb.get>).mockReturnValue(mockCollection as never);

        // Spy on routeSnapshotService.insertFromRoute
        const insertSpy = jest.spyOn(routeSnapshotService, 'insertFromRoute').mockResolvedValue({ id: 'snap-new' } as never);

        // Act
        const result = await routeService.getRoute(requestFarAway);

        // Assert: return live route
        expect(result.isFromCache).toBe(false);
        expect(mockProvider.getRoute).toHaveBeenCalledWith(requestFarAway);

        // Assert: snapshot saved as NEW entry (insertFromRoute called)
        expect(insertSpy).toHaveBeenCalled();
        insertSpy.mockRestore();
      });
    });

    describe('InvalidConfigError handling', () => {
      test('InvalidConfigError + ada snapshot -> fallback + console.error logged', async () => {
        // Arrange: network online
        jest.spyOn(networkMonitor, 'getStatus').mockReturnValue('online');

        // Provider throws InvalidConfigError
        mockProvider.getRoute.mockRejectedValue(
          new InvalidConfigError('GRAPHHOPPER_API_KEY invalid.'),
        );

        // Snapshot exists
        const mockSnapshot = createMockSnapshot('snap-1', testOrigin, testDest);
        jest.spyOn(routeSnapshotService, 'findMatch').mockResolvedValue(mockSnapshot as never);

        // Spy on console.error
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        // Act
        const result = await routeService.getRoute(testRequest);

        // Assert: fallback to snapshot
        expect(result.isFromCache).toBe(true);

        // Assert: console.error called with config error message
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('[routeService] Config error'),
          expect.stringContaining('GRAPHHOPPER_API_KEY invalid'),
        );

        consoleSpy.mockRestore();
      });

      test('InvalidConfigError + tidak ada snapshot jadi throw RouteUnavailableError dengan root cause', async () => {
        // Arrange: network online
        jest.spyOn(networkMonitor, 'getStatus').mockReturnValue('online');

        // Provider throws InvalidConfigError
        mockProvider.getRoute.mockRejectedValue(
          new InvalidConfigError('GRAPHHOPPER_API_KEY invalid.'),
        );

        // No snapshot
        jest.spyOn(routeSnapshotService, 'findMatch').mockResolvedValue(null);

        // Spy on console.error
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        // Act & Assert
        await expect(routeService.getRoute(testRequest)).rejects.toThrow(RouteUnavailableError);
        await expect(routeService.getRoute(testRequest)).rejects.toThrow(
          'Root cause: GRAPHHOPPER_API_KEY invalid',
        );

        // Assert: console.error called
        expect(consoleSpy).toHaveBeenCalled();

        consoleSpy.mockRestore();
      });
    });
  });

  describe('RouteUnavailableError', () => {
    test('extends Error with correct name', () => {
      const error = new RouteUnavailableError('test message');
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('RouteUnavailableError');
      expect(error.message).toBe('test message');
    });
  });

  describe('getRoute() menunggu simpan snapshot', () => {
    test('promise simpan ditahan: getRoute belum selesai sebelum simpan selesai', async () => {
      // Arrange: fetch sukses dari provider, simpan snapshot ditahan
      jest.spyOn(networkMonitor, 'getStatus').mockReturnValue('online');
      const liveRoute = createMockRoute(testOrigin, testDest, 5000);
      mockProvider.getRoute.mockResolvedValue(liveRoute);

      // Simpan ditahan lewat deferred promise
      let resolveInsert: (value: unknown) => void = () => {};
      const insertPromise = new Promise<unknown>((resolve) => {
        resolveInsert = resolve;
      });
      const insertSpy = jest
        .spyOn(routeSnapshotService, 'insertFromRoute')
        .mockReturnValue(insertPromise as never);

      // Act: mulai getRoute
      const getRoutePromise = routeService.getRoute(testRequest);

      // Tunggu beberapa microtask agar fetch selesai dan saveSnapshot
      // sudah mulai menunggu insertFromRoute.
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 20);
      });

      // getRoute belum selesai karena simpan masih ditahan
      let getRouteResolved = false;
      void getRoutePromise.then(() => {
        getRouteResolved = true;
      });
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 20);
      });
      expect(getRouteResolved).toBe(false);

      // Selesaikan simpan, getRoute baru boleh selesai
      resolveInsert({ id: 'snap-new' });

      const result = await getRoutePromise;
      expect(getRouteResolved).toBe(true);
      expect(result.isFromCache).toBe(false);
      expect(result.route).toEqual(liveRoute);
      expect(insertSpy).toHaveBeenCalled();
    });

    test('simpan gagal: getRoute tetap mengembalikan rute live dengan isFromCache false, tidak jatuh ke cabang cadangan', async () => {
      // Arrange: fetch sukses, simpan gagal (mis. DB penuh)
      jest.spyOn(networkMonitor, 'getStatus').mockReturnValue('online');
      const liveRoute = createMockRoute(testOrigin, testDest, 5000);
      mockProvider.getRoute.mockResolvedValue(liveRoute);

      const insertSpy = jest
        .spyOn(routeSnapshotService, 'insertFromRoute')
        .mockRejectedValue(new Error('Disk full'));

      // findMatch TIDAK dipanggil kalau simpan gagal (tidak jatuh ke cabang cadangan)
      const findMatchSpy = jest.spyOn(routeSnapshotService, 'findMatch');

      // Spy console.warn supaya gagal simpan tidak bocor log ke test runner
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      // Act
      const result = await routeService.getRoute(testRequest);

      // Assert: getRoute tetap mengembalikan rute live
      expect(result.isFromCache).toBe(false);
      expect(result.route).toEqual(liveRoute);
      expect(insertSpy).toHaveBeenCalled();
      // findMatch TIDAK dipanggil: simpan gagal bukan alasan untuk fallback
      expect(findMatchSpy).not.toHaveBeenCalled();
      // Gagal simpan dicatat di log
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed to save snapshot'),
        expect.any(Error),
      );

      warnSpy.mockRestore();
    });
  });
});

// snapshotToRoute conversion

describe('RouteService snapshotToRoute', () => {
  let mockDb: jest.MockedObject<Database>;
  let mockProvider: MockRoutingProvider;
  let routeService: RouteService;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDb = {} as jest.MockedObject<Database>;
    mockProvider = { getRoute: jest.fn() } as unknown as MockRoutingProvider;
    routeService = new RouteService({
      routingProvider: mockProvider,
      database: mockDb,
    });

    networkMonitor.stop();
  });

  afterEach(() => {
    networkMonitor.stop();
  });

  test('converts snapshot to Route with correct geometry', () => {
    // We need to test the private method indirectly through getRoute
    // Setup network + provider to fail + snapshot to match
    jest.spyOn(networkMonitor, 'getStatus').mockReturnValue('online');
    mockProvider.getRoute.mockRejectedValue(new Error('fail'));
    const mockSnapshot = createMockSnapshot('snap-1', { lat: -6.175, lng: 106.827 }, { lat: -6.2, lng: 106.85 });
    jest.spyOn(routeSnapshotService, 'findMatch').mockResolvedValue(mockSnapshot as never);

    return routeService.getRoute({ origin: { lat: -6.175, lng: 106.827 }, destination: { lat: -6.2, lng: 106.85 } })
      .then((result) => {
        expect(result.route.geometry).toHaveLength(2);
        expect(result.route.origin.lat).toBe(-6.175);
        expect(result.route.origin.lng).toBe(106.827);
        expect(result.route.destination.lat).toBe(-6.2);
        expect(result.route.destination.lng).toBe(106.85);
      });
  });
});
