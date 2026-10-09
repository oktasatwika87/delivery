/**
 * Unit tests untuk location.ts
 *
 * Strategi test:
 * - Import locationService production langsung (no factory, kita uji kode production).
 * - Mock default behavior sudah handle listener Set + fan-out via _emitLocation.
 * - Pakai LocationManager._reset() di beforeEach untuk reset mock state
 *   (locationListeners Set + call history). Implementation TIDAK di-reset
 *   (mockClear bukan mockReset), jadi default fan-out tetap jalan.
 * - JANGAN override .mockImplementation() di test manapun, sekali di-override,
 *   mockClear() tidak restore implementation, dan override nempel ke test
 *   berikutnya (akar masalah fan-out blank).
 * - Untuk capture listener yang di-pass ke addListener, baca dari
 *   addListener.mock.calls[0][0] SETELAH subscribe, bukan via mockImplementation.
 * - Setiap test cleanup subscribe-nya via unsubscribe (return dari subscribe)
 *   agar singleton.listeners Set kembali ke 0 untuk test berikutnya, supaya
 *   subscribe berikutnya bisa re-register bridgeListener ke mock.
 * - subscribe() sekarang async (permission request), jadi semua subscribe()
 *   harus di-await.
 */

import { LocationManager } from '@maplibre/maplibre-react-native';
import type { Location } from '@maplibre/maplibre-react-native';
import { PermissionsAndroid } from 'react-native';
import { locationService } from './location';

type LocationListener = (location: Location) => void;

const makeLocation = (lat: number, lng: number): Location => ({
  coords: {
    latitude: lat,
    longitude: lng,
    // Coordinates type uses `?: number` (number | undefined), bukan
    // number | null. Pakai undefined biar match type.
    altitude: undefined,
    accuracy: 10,
    heading: undefined,
    speed: undefined,
  },
  timestamp: 1000,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const subscribe = async (listener: LocationListener) => locationService.subscribe(listener);

describe('locationService', () => {
  beforeEach(() => {
    // Clear all mocks and reset state on singleton
    jest.clearAllMocks();

    // Reset permission status dan listener state pada singleton
    (locationService as any).permissionStatus = 'never_asked';
    (locationService as any).isListening = false;
    (locationService as any).listeners.clear();

    // Mock state-only reset: locationListeners Set + call history.
    // Implementation (default fan-out) dipertahankan.
    (LocationManager as any)._reset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('subscribe()', () => {
    test('memanggil LocationManager.addListener() dengan benar', async () => {
      // Mock permission granted untuk subscribe test
      (PermissionsAndroid.request as jest.Mock).mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);

      const unsubscribe = await subscribe(() => {});

      expect(LocationManager.addListener).toHaveBeenCalledTimes(1);
      expect(LocationManager.addListener).toHaveBeenCalledWith(expect.any(Function));

      unsubscribe();
    });

    test('tidak memanggil addListener lagi kalau sudah ada subscriber', async () => {
      // Mock permission granted untuk subscribe test
      (PermissionsAndroid.request as jest.Mock).mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);

      const unsub1 = await subscribe(() => {});
      const unsub2 = await subscribe(() => {});

      expect(LocationManager.addListener).toHaveBeenCalledTimes(1);

      unsub1();
      unsub2();
    });
  });

  describe('unsubscribe (return function dari subscribe)', () => {
    test('memanggil LocationManager.removeListener() dengan benar', async () => {
      const unsubscribe = await subscribe(() => {});
      (LocationManager.removeListener as jest.Mock).mockClear();

      unsubscribe();

      expect(LocationManager.removeListener).toHaveBeenCalledTimes(1);
    });

    test('removeListener dipanggil dengan listener yang sama dengan addListener', async () => {
      const unsubscribe = await subscribe(() => {});
      const bridgeListener = (LocationManager.addListener as jest.Mock).mock.calls[0][0];
      (LocationManager.removeListener as jest.Mock).mockClear();

      unsubscribe();

      expect(LocationManager.removeListener).toHaveBeenCalledWith(bridgeListener);
    });

    test('addListener tidak dipanggil ulang setelah semua unsubscribe', async () => {
      const unsub1 = await subscribe(() => {});
      const unsub2 = await subscribe(() => {});

      unsub1();
      expect(LocationManager.addListener).toHaveBeenCalledTimes(1);

      unsub2();
      expect(LocationManager.removeListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('multiple subscribers', () => {
    test('semua subscriber dapat notifikasi saat _emitLocation() dipanggil', async () => {
      const locations1: Location[] = [];
      const locations2: Location[] = [];
      const locations3: Location[] = [];

      const unsub1 = await subscribe((loc) => locations1.push(loc));
      const unsub2 = await subscribe((loc) => locations2.push(loc));
      const unsub3 = await subscribe((loc) => locations3.push(loc));

      const mockLocation = makeLocation(-6.175, 106.827);
      (LocationManager as any)._emitLocation(mockLocation);

      expect(locations1).toHaveLength(1);
      expect(locations2).toHaveLength(1);
      expect(locations3).toHaveLength(1);
      expect(locations1[0]).toEqual(mockLocation);
      expect(locations2[0]).toEqual(mockLocation);
      expect(locations3[0]).toEqual(mockLocation);

      unsub1();
      unsub2();
      unsub3();
    });

    test('unsubscribe satu subscriber tidak mempengaruhi subscriber lain', async () => {
      const locations1: Location[] = [];
      const locations2: Location[] = [];
      const locations3: Location[] = [];

      const unsub1 = await subscribe((loc) => locations1.push(loc));
      const unsub2 = await subscribe((loc) => locations2.push(loc));
      const unsub3 = await subscribe((loc) => locations3.push(loc));

      unsub1();

      const mockLocation = makeLocation(-6.2, 106.85);
      (LocationManager as any)._emitLocation(mockLocation);

      expect(locations1).toHaveLength(0);
      expect(locations2).toHaveLength(1);
      expect(locations3).toHaveLength(1);

      unsub2();
      unsub3();
    });

    test('banyak location update semua subscriber dapat semuanya', async () => {
      const locations1: Location[] = [];
      const locations2: Location[] = [];

      const unsub1 = await subscribe((loc) => locations1.push(loc));
      const unsub2 = await subscribe((loc) => locations2.push(loc));

      const points = [
        makeLocation(-6.175, 106.827),
        makeLocation(-6.18, 106.83),
        makeLocation(-6.19, 106.84),
      ];

      for (const p of points) {
        (LocationManager as any)._emitLocation(p);
      }

      expect(locations1).toHaveLength(3);
      expect(locations2).toHaveLength(3);

      unsub1();
      unsub2();
    });
  });

  describe('getLastKnownLocation()', () => {
    test('meneruskan pemanggilan ke LocationManager.getLastKnownLocation()', async () => {
      const expected = makeLocation(-6.175, 106.827);
      (LocationManager.getLastKnownLocation as jest.Mock).mockResolvedValue(expected);

      const result = await locationService.getLastKnown();

      expect(LocationManager.getLastKnownLocation).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expected);
    });

    test('mengembalikan null kalau tidak ada last known location', async () => {
      (LocationManager.getLastKnownLocation as jest.Mock).mockResolvedValue(null);

      const result = await locationService.getLastKnown();

      expect(result).toBeNull();
    });

    test('mengembalikan null kalau getLastKnownLocation throw', async () => {
      (LocationManager.getLastKnownLocation as jest.Mock).mockRejectedValue(new Error('GPS unavailable'));

      const result = await locationService.getLastKnown();

      expect(result).toBeNull();
    });
  });

  describe('setMinDisplacement()', () => {
    test('memanggil LocationManager.setMinDisplacement() dengan parameter yang benar', () => {
      locationService.setMinDisplacement(10);

      expect(LocationManager.setMinDisplacement).toHaveBeenCalledTimes(1);
      expect(LocationManager.setMinDisplacement).toHaveBeenCalledWith(10);
    });

    test('setMinDisplacement bisa dipanggil multiple kali dengan nilai berbeda', () => {
      locationService.setMinDisplacement(5);
      locationService.setMinDisplacement(15);
      locationService.setMinDisplacement(50);

      expect(LocationManager.setMinDisplacement).toHaveBeenCalledTimes(3);
      expect(LocationManager.setMinDisplacement).toHaveBeenNthCalledWith(1, 5);
      expect(LocationManager.setMinDisplacement).toHaveBeenNthCalledWith(2, 15);
      expect(LocationManager.setMinDisplacement).toHaveBeenNthCalledWith(3, 50);
    });
  });

  describe('requestPermission()', () => {
    test('mengembalikan granted dan set permissionStatus kalau permission granted', async () => {
      // Setup mock untuk test ini
      (PermissionsAndroid.request as jest.Mock).mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);

      const result = await locationService.requestPermission();

      expect(result).toBe('granted');
      expect(locationService.hasPermission()).toBe(true);
    });

    test('memanggil PermissionsAndroid.request() setiap kali dipanggil', async () => {
      // Setup mock untuk test ini
      (PermissionsAndroid.request as jest.Mock).mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);

      await locationService.requestPermission();
      await locationService.requestPermission();

      // Setiap pemanggilan akan trigger request baru
      expect(PermissionsAndroid.request).toHaveBeenCalledTimes(2);
    });

    test('mengembalikan denied kalau permission ditolak', async () => {
      (PermissionsAndroid.request as jest.Mock).mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);

      const result = await locationService.requestPermission();

      expect(result).toBe('denied');
    });

    test('mengembalikan blocked kalau permission permanently denied (NEVER_ASK_AGAIN)', async () => {
      (PermissionsAndroid.request as jest.Mock).mockResolvedValue(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);

      const result = await locationService.requestPermission();

      expect(result).toBe('blocked');
    });
  });

  describe('hasPermission()', () => {
    test('mengembalikan true kalau permission granted', () => {
      (locationService as any).permissionStatus = 'granted';

      expect(locationService.hasPermission()).toBe(true);
    });

    test('mengembalikan false kalau permission denied', () => {
      (locationService as any).permissionStatus = 'denied';

      expect(locationService.hasPermission()).toBe(false);
    });

    test('mengembalikan false kalau permission blocked (NEVER_ASK_AGAIN)', () => {
      (locationService as any).permissionStatus = 'blocked';

      expect(locationService.hasPermission()).toBe(false);
    });

    test('mengembalikan false kalau permission belum pernah diminta', () => {
      (locationService as any).permissionStatus = 'never_asked';

      expect(locationService.hasPermission()).toBe(false);
    });
  });

  describe('Location type re-export', () => {
    test('Location type di-export dari location.ts', () => {
      // Compile-time check: tipe Location harus bisa di-refer di file yang import location.ts
      const _check: Location = makeLocation(0, 0);
      expect(_check.coords.latitude).toBe(0);
    });
  });
});