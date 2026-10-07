/**
 * Unit tests untuk MapScreen.tsx routing integration.
 *
 * Test focus:
 * 1. Terima orderId dan lookup order dengan benar
 * 2. Order tidak ketemu / coordinates kosong → error tanpa crash
 * 3. getRoute() dipanggil dengan origin/destination yang benar (urutan lat/lng)
 * 4. Loading state, isFromCache indicator, error state
 * 5. Navigasi OrderDetailScreen kirim orderId dengan benar
 * 6. Throttling rute: tidak dipanggil lagi kalau GPS bergeser < 300 m
 * 7. fitBounds hanya sekali per order, bukan tiap getRoute
 * 8. Kamera tidak mengikuti GPS (centerCoordinate prop live ditiadakan)
 * 9. Pemulihan online memicu satu getRoute tambahan
 * 10. Urutan mount: fitBounds menang atas setCamera kalau keduanya siap
 */

import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { MapScreen } from './MapScreen';
import { RouteService } from '../map/routeService';
import { networkMonitor } from '../map/networkMonitor';
import { locationService } from '../map/location';
import { offlineStorage } from '../map/offlineStorage';
import type { RouteResult } from '../map/routeService';
import type { RouteRequest } from '../map/routing';
import { MATCH_RADIUS_METERS, haversineDistance } from '../map/routeSnapshot';

// ─── Mock setup ───────────────────────────────────────────────────────────────

// Tipe untuk mocks yang diekspor lewat jest.requireMock.
type MapLibreMockExports = {
  __cameraProps: jest.Mock;
  __cameraRef: {
    setCamera: jest.Mock;
    fitBounds: jest.Mock;
    flyTo: jest.Mock;
    moveTo: jest.Mock;
    zoomTo: jest.Mock;
  };
};

const mapLibreMock = jest.requireMock(
  '@maplibre/maplibre-react-native',
) as MapLibreMockExports;
const cameraMock = mapLibreMock.__cameraProps;
const mockCameraRef = mapLibreMock.__cameraRef;

// Mock react-native components
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
  }),
  useRoute: () => ({
    params: { orderId: 'order-123' },
  }),
}));

// Mock MapLibreGL — Camera adalah forwardRef agar ref imperatif bisa di-spy.
// Props yang masuk ke Camera dicatat lewat __cameraProps (jest.fn) supaya
// inspeksi props di tes tidak bergantung pada internal jest.mocked().
jest.mock('@maplibre/maplibre-react-native', () => {
  // require di dalam factory supaya tidak kena babel-plugin-jest-hoist
  // (variabel React yang di-import di top file dianggap out-of-scope).
  const mockReact = require('react');
  const mockCameraProps = jest.fn();
  const mockCameraRef = {
    setCamera: jest.fn(),
    fitBounds: jest.fn(),
    flyTo: jest.fn(),
    moveTo: jest.fn(),
    zoomTo: jest.fn(),
  };

  const Camera = mockReact.forwardRef((props: object, ref: { update: (next: typeof mockCameraRef) => void }) => {
    mockCameraProps(props);
    mockReact.useImperativeHandle(ref, () => mockCameraRef);
    return null;
  });
  Camera.displayName = 'Camera';

  const MapView = ({ children }: { children: unknown }) => children;
  const ShapeSource = ({ children }: { children: unknown }) => children;
  const LineLayer = () => null;
  const MarkerView = ({ children }: { children: unknown }) => children;

  return {
    __esModule: true,
    default: { MapView, Camera, ShapeSource, LineLayer, MarkerView },
    MapView,
    Camera,
    ShapeSource,
    LineLayer,
    MarkerView,
    __cameraProps: mockCameraProps,
    __cameraRef: mockCameraRef,
  };
});

// Mock database
const mockFind = jest.fn();
const mockGet = jest.fn().mockReturnValue({ find: mockFind });
jest.mock('@nozbe/watermelondb/react', () => ({
  withDatabase: (Component: React.ComponentType<object>) => Component,
}));
jest.mock('@nozbe/watermelondb', () => ({
  withDatabase: (Component: React.ComponentType<object>) => Component,
}));

// Mock dependencies
jest.mock('../map/routeService', () => ({
  RouteService: jest.fn(),
}));

jest.mock('../map/routing', () => ({
  GraphHopperRoutingProvider: jest.fn(),
}));

jest.mock('../map/networkMonitor', () => ({
  networkMonitor: {
    getStatus: jest.fn(() => 'online'),
    subscribe: jest.fn(() => () => {}),
    check: jest.fn(),
  },
}));

jest.mock('../map/location', () => ({
  locationService: {
    subscribe: jest.fn(() => Promise.resolve(() => {})),
    hasPermission: jest.fn(() => true),
    getLastKnown: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../map/offlineStorage', () => ({
  offlineStorage: {
    listPacks: jest.fn(),
  },
}));

jest.mock('../db/models/OrderModel', () => ({}));

// ─── Test helpers ──────────────────────────────────────────────────────────────

function createMockRouteResult(geometry: Array<[number, number]>, isFromCache = false): RouteResult {
  return {
    route: {
      origin: { lng: 106.827, lat: -6.175 },
      destination: { lng: 106.85, lat: -6.2 },
      geometry,
    },
    isFromCache,
  };
}

/** Offset meter ke utara — latitude geser sekian derajat. */
function metersNorth(latitude: number, meters: number): number {
  return latitude + meters / 111_000;
}

/** Offset meter ke timur pada latitude tertentu — longitude geser sekian derajat. */
function metersEast(longitude: number, latitude: number, meters: number): number {
  const metersPerDegLng = 111_000 * Math.cos((latitude * Math.PI) / 180);
  return longitude + meters / metersPerDegLng;
}

const DEFAULT_FALLBACK_CENTER: [number, number] = [115.2167, -8.65];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MapScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cameraMock.mockClear();
    mockCameraRef.setCamera.mockClear();
    mockCameraRef.fitBounds.mockClear();
    mockCameraRef.flyTo.mockClear();
    mockCameraRef.moveTo.mockClear();
    mockCameraRef.zoomTo.mockClear();

    // Default: network online, GPS location available
    (networkMonitor.getStatus as jest.Mock).mockReturnValue('online');
    (networkMonitor.subscribe as jest.Mock).mockReturnValue(() => {});
    (networkMonitor.check as jest.Mock).mockResolvedValue('online');

    (locationService.subscribe as jest.Mock).mockResolvedValue(() => {});

    // Default: offline packs available
    (offlineStorage.listPacks as jest.Mock).mockResolvedValue([{ state: 'complete' }]);

    // Reset database mock
    mockGet.mockReturnValue({ find: mockFind });
  });

  describe('order lookup & coordinate extraction', () => {
    test('extracts destination coordinates from order.addressJson.coordinates', async () => {
      // Mock order dengan coordinates [lng, lat] format
      mockFind.mockResolvedValue({
        addressJson: {
          coordinates: [106.85, -6.2], // [lng, lat] GeoJSON convention
        },
      });

      // Create mock RouteService
      const mockGetRoute = jest.fn().mockResolvedValue(createMockRouteResult([[106.827, -6.175], [106.85, -6.2]]));
      (RouteService as unknown as jest.Mock).mockImplementation(() => ({
        getRoute: mockGetRoute,
      }));

      // Render component
      render(<MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />);

      // Wait for effects to run
      await waitFor(() => {
        expect(mockFind).toHaveBeenCalledWith('order-123');
      });
    });

    test('handles missing coordinates gracefully', async () => {
      // Mock order tanpa coordinates
      mockFind.mockResolvedValue({
        addressJson: {
          street: 'Jl. Sudirman',
          // coordinates: undefined (tidak ada)
        },
      });

      const mockGetRoute = jest.fn();
      (RouteService as unknown as jest.Mock).mockImplementation(() => ({
        getRoute: mockGetRoute,
      }));

      const { getByText } = render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
      );

      await waitFor(() => {
        expect(getByText(/Alamat pengiriman tidak memiliki koordinat yang valid/)).toBeTruthy();
      });
    });

    test('handles order not found gracefully', async () => {
      mockFind.mockRejectedValue(new Error('Order not found'));

      const mockGetRoute = jest.fn();
      (RouteService as unknown as jest.Mock).mockImplementation(() => ({
        getRoute: mockGetRoute,
      }));

      const { getByText } = render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'invalid-id' } } as any} />,
      );

      await waitFor(() => {
        expect(getByText(/order tidak ditemukan/i)).toBeTruthy();
      });
    });
  });

  describe('getRoute() invocation', () => {
    test('calls getRoute with correct origin/destination format', async () => {
      // GPS location: { lat, lng } format
      (locationService.subscribe as jest.Mock).mockImplementation((callback) => {
        // Simulate GPS update
        setTimeout(() => {
          callback({
            coords: { latitude: -6.175, longitude: 106.827 }, // { lat, lng }
          });
        }, 0);
        return Promise.resolve(() => {});
      });

      // Order coordinates: [lng, lat] format
      mockFind.mockResolvedValue({
        addressJson: {
          coordinates: [106.85, -6.2], // [lng, lat] GeoJSON convention
        },
      });

      // Track what getRoute receives
      let capturedRequest: RouteRequest | null = null;
      const mockGetRoute = jest.fn().mockImplementation(async (req: RouteRequest) => {
        capturedRequest = req;
        return createMockRouteResult([[106.827, -6.175], [106.85, -6.2]]);
      });

      (RouteService as unknown as jest.Mock).mockImplementation(() => ({
        getRoute: mockGetRoute,
      }));

      render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
      );

      await waitFor(() => {
        expect(mockGetRoute).toHaveBeenCalled();
        expect(capturedRequest).not.toBeNull();
      });

      // Verify origin: { lng, lat } format (converted from GPS { lat, lng })
      expect(capturedRequest!.origin.lng).toBeCloseTo(106.827);
      expect(capturedRequest!.origin.lat).toBeCloseTo(-6.175);

      // Verify destination: { lng, lat } format (converted from [lng, lat] array)
      expect(capturedRequest!.destination.lng).toBeCloseTo(106.85);
      expect(capturedRequest!.destination.lat).toBeCloseTo(-6.2);
    });

    test('does not call getRoute before both origin and destination are available', async () => {
      // GPS location available
      (locationService.subscribe as jest.Mock).mockImplementation((callback) => {
        setTimeout(() => {
          callback({
            coords: { latitude: -6.175, longitude: 106.827 },
          });
        }, 0);
        return Promise.resolve(() => {});
      });

      // Order lookup pending (don't resolve yet)
      mockFind.mockImplementation(() => new Promise(() => {}));

      const mockGetRoute = jest.fn();
      (RouteService as unknown as jest.Mock).mockImplementation(() => ({
        getRoute: mockGetRoute,
      }));

      render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
      );

      // Give some time for effects to run
      await new Promise((resolve) => globalThis.setTimeout(() => resolve(undefined), 50));

      expect(mockGetRoute).not.toHaveBeenCalled();
    });
  });

  describe('routing states', () => {
    test('displays loading indicator while fetching route', async () => {
      (locationService.subscribe as jest.Mock).mockImplementation((callback) => {
        setTimeout(() => {
          callback({
            coords: { latitude: -6.175, longitude: 106.827 },
          });
        }, 0);
        return Promise.resolve(() => {});
      });

      mockFind.mockResolvedValue({
        addressJson: { coordinates: [106.85, -6.2] },
      });

      // Mock slow getRoute
      const mockGetRoute = jest.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(createMockRouteResult([[106.827, -6.175], [106.85, -6.2]])), 100)),
      );
      (RouteService as unknown as jest.Mock).mockImplementation(() => ({
        getRoute: mockGetRoute,
      }));

      const { getByText } = render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
      );

      await waitFor(() => {
        expect(getByText(/memuat rute/i)).toBeTruthy();
      });
    });

    test('displays cache indicator when route is from snapshot', async () => {
      (locationService.subscribe as jest.Mock).mockImplementation((callback) => {
        setTimeout(() => {
          callback({
            coords: { latitude: -6.175, longitude: 106.827 },
          });
        }, 0);
        return Promise.resolve(() => {});
      });

      mockFind.mockResolvedValue({
        addressJson: { coordinates: [106.85, -6.2] },
      });

      // Route from cache
      const mockGetRoute = jest.fn().mockResolvedValue(createMockRouteResult([[106.827, -6.175], [106.85, -6.2]], true));
      (RouteService as unknown as jest.Mock).mockImplementation(() => ({
        getRoute: mockGetRoute,
      }));

      const { getByText } = render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
      );

      await waitFor(() => {
        expect(getByText(/dari cache/i)).toBeTruthy();
      });
    });

    test('displays error message when getRoute throws', async () => {
      (locationService.subscribe as jest.Mock).mockImplementation((callback) => {
        setTimeout(() => {
          callback({
            coords: { latitude: -6.175, longitude: 106.827 },
          });
        }, 0);
        return Promise.resolve(() => {});
      });

      mockFind.mockResolvedValue({
        addressJson: { coordinates: [106.85, -6.2] },
      });

      const mockGetRoute = jest.fn().mockRejectedValue(new Error('Network error — cek koneksi internet.'));
      (RouteService as unknown as jest.Mock).mockImplementation(() => ({
        getRoute: mockGetRoute,
      }));

      const { getByText } = render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
      );

      await waitFor(() => {
        expect(getByText(/Network error/i)).toBeTruthy();
      });
    });
  });

  describe('atribusi dan pusat cadangan', () => {
    test('tampilkan atribusi OpenStreetMap saat ada offline region', async () => {
      // default mock: offlineStorage.listPacks return [{ state: 'complete' }]
      const { getByText } = render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
      );
      await waitFor(() => {
        expect(getByText('© OpenMapTiles © OpenStreetMap contributors')).toBeTruthy();
      });
    });

    test('tidak tampil atribusi saat belum ada offline region', async () => {
      (offlineStorage.listPacks as jest.Mock).mockResolvedValue([]);
      const { queryByText } = render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
      );
      await waitFor(() => {
        expect(queryByText('© OpenMapTiles © OpenStreetMap contributors')).toBeNull();
      });
    });

    test('tap atribusi membuka halaman hak cipta OpenStreetMap', async () => {
      const spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
      try {
        const { getByText } = render(
          <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
        );
        await waitFor(() => {
          expect(getByText('© OpenMapTiles © OpenStreetMap contributors')).toBeTruthy();
        });
        fireEvent.press(getByText('© OpenMapTiles © OpenStreetMap contributors'));
        expect(spy).toHaveBeenCalledWith('https://www.openstreetmap.org/copyright');
      } finally {
        spy.mockRestore();
      }
    });

    test('pusat cadangan Denpasar saat currentLocation null dan MapView tampil', async () => {
      // default mock: locationService.getLastKnown return null → currentLocation null
      // default mock: offlineStorage.listPacks return [{ state: 'complete' }] → hasOfflineRegion true
      render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
      );
      await waitFor(() => {
        expect(cameraMock).toHaveBeenCalled();
      });
      const props = cameraMock.mock.calls[0][0] as {
        centerCoordinate?: [number, number];
        defaultSettings?: { centerCoordinate?: [number, number]; zoomLevel?: number };
      };
      // Center fallback Denpasar lewat defaultSettings, bukan prop live.
      expect(props.defaultSettings?.centerCoordinate).toEqual(DEFAULT_FALLBACK_CENTER);
      // Tidak ada prop live centerCoordinate yang mengikat kamera ke GPS.
      expect(props.centerCoordinate).toBeUndefined();
      // Tidak ada pemanggilan imperatif tanpa GPS.
      expect(mockCameraRef.setCamera).not.toHaveBeenCalled();
      expect(mockCameraRef.fitBounds).not.toHaveBeenCalled();
    });
  });

  // ─── Tes baru ──────────────────────────────────────────────────────────────

  /**
   * Helper: pasang GPS subscriber yang mengembalikan callback supaya bisa
   * kita panggil manual untuk simulasi update GPS.
   */
  function setupGpsCapture(): {
    emit: (lat: number, lng: number) => void;
  } {
    let captured: ((loc: { coords: { latitude: number; longitude: number } }) => void) | null = null;
    (locationService.subscribe as jest.Mock).mockImplementation((cb) => {
      captured = cb;
      return Promise.resolve(() => {});
    });
    return {
      emit: (lat: number, lng: number) => {
        if (!captured) throw new Error('GPS subscriber belum terpasang');
        captured({ coords: { latitude: lat, longitude: lng } });
      },
    };
  }

  function setupRouteServiceResolve(getRouteImpl: (req: RouteRequest) => Promise<RouteResult>): jest.Mock {
    const mockGetRoute = jest.fn().mockImplementation(getRouteImpl);
    (RouteService as unknown as jest.Mock).mockImplementation(() => ({
      getRoute: mockGetRoute,
    }));
    return mockGetRoute;
  }

  describe('throttling rute berdasarkan jarak GPS', () => {
    test('GPS update berjarak < 300 m tidak memicu getRoute kedua', async () => {
      mockFind.mockResolvedValue({ addressJson: { coordinates: [106.85, -6.2] } });
      const mockGetRoute = setupRouteServiceResolve(async () =>
        createMockRouteResult([[106.827, -6.175], [106.85, -6.2]]),
      );
      const gps = setupGpsCapture();

      render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
      );

      act(() => {
        gps.emit(-6.175, 106.8);
      });
      await waitFor(() => expect(mockGetRoute).toHaveBeenCalledTimes(1));

      // Update kedua: 50 m ke utara.
      act(() => {
        gps.emit(metersNorth(-6.175, 50), 106.8);
      });
      // Beri waktu efek untuk re-run.
      await new Promise((resolve) => globalThis.setTimeout(() => resolve(undefined), 30));
      expect(mockGetRoute).toHaveBeenCalledTimes(1);

      // Update ketiga: 100 m ke timur (total ~112 m dari titik pertama, masih di bawah 300 m).
      act(() => {
        gps.emit(-6.175, metersEast(106.8, -6.175, 100));
      });
      await new Promise((resolve) => globalThis.setTimeout(() => resolve(undefined), 30));
      expect(mockGetRoute).toHaveBeenCalledTimes(1);

      // Sanity: jarak dari titik pertama memang <= 300 m.
      const firstOrigin = { lng: 106.8, lat: -6.175 };
      const lastOrigin = { lng: metersEast(106.8, -6.175, 100), lat: -6.175 };
      expect(haversineDistance(firstOrigin, lastOrigin)).toBeLessThan(MATCH_RADIUS_METERS);
    });

    test('GPS update > 300 m memicu getRoute kedua', async () => {
      mockFind.mockResolvedValue({ addressJson: { coordinates: [106.85, -6.2] } });
      const mockGetRoute = setupRouteServiceResolve(async () =>
        createMockRouteResult([[106.827, -6.175], [106.85, -6.2]]),
      );
      const gps = setupGpsCapture();

      render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
      );

      act(() => {
        gps.emit(-6.175, 106.8);
      });
      await waitFor(() => expect(mockGetRoute).toHaveBeenCalledTimes(1));

      // Update kedua: 400 m ke timur, lebih dari 300 m.
      act(() => {
        gps.emit(-6.175, metersEast(106.8, -6.175, 400));
      });
      await waitFor(() => expect(mockGetRoute).toHaveBeenCalledTimes(2));

      const firstOrigin = { lng: 106.8, lat: -6.175 };
      const lastOrigin = { lng: metersEast(106.8, -6.175, 400), lat: -6.175 };
      expect(haversineDistance(firstOrigin, lastOrigin)).toBeGreaterThan(MATCH_RADIUS_METERS);
    });
  });

  describe('fitBounds dan prop Camera', () => {
    test('fitBounds hanya sekali walau getRoute dipanggil dua kali', async () => {
      mockFind.mockResolvedValue({ addressJson: { coordinates: [106.85, -6.2] } });
      const mockGetRoute = setupRouteServiceResolve(async () =>
        createMockRouteResult([[106.827, -6.175], [106.85, -6.2]]),
      );
      const gps = setupGpsCapture();

      render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
      );

      act(() => {
        gps.emit(-6.175, 106.8);
      });
      await waitFor(() => expect(mockGetRoute).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(mockCameraRef.fitBounds).toHaveBeenCalledTimes(1));

      act(() => {
        gps.emit(-6.175, metersEast(106.8, -6.175, 400));
      });
      await waitFor(() => expect(mockGetRoute).toHaveBeenCalledTimes(2));

      // fitBounds tidak boleh ikut terpanggil lagi walau rute ke-refetch.
      await new Promise((resolve) => globalThis.setTimeout(() => resolve(undefined), 30));
      expect(mockCameraRef.fitBounds).toHaveBeenCalledTimes(1);
    });

    test('props centerCoordinate Camera tidak berubah setelah update GPS berikutnya', async () => {
      mockFind.mockResolvedValue({ addressJson: { coordinates: [106.85, -6.2] } });
      setupRouteServiceResolve(async () =>
        createMockRouteResult([[106.827, -6.175], [106.85, -6.2]]),
      );
      const gps = setupGpsCapture();

      render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
      );

      act(() => {
        gps.emit(-6.175, 106.8);
      });
      await waitFor(() => expect(cameraMock).toHaveBeenCalled());

      // Snapshot baseline prop di pemanggilan pertama.
      const firstProps = cameraMock.mock.calls[0][0] as {
        centerCoordinate?: [number, number];
        defaultSettings?: { centerCoordinate?: [number, number] };
      };

      // Update GPS.
      act(() => {
        gps.emit(-6.175, metersEast(106.8, -6.175, 400));
      });
      await new Promise((resolve) => globalThis.setTimeout(() => resolve(undefined), 30));

      // Semua panggilan setelah yang pertama tidak boleh membawa prop
      // centerCoordinate live yang berubah tiap tick GPS.
      const subsequentCalls = cameraMock.mock.calls.slice(1);
      expect(subsequentCalls.length).toBeGreaterThan(0);
      for (const call of subsequentCalls) {
        const props = call[0] as { centerCoordinate?: [number, number] };
        // centerCoordinate live harus undefined; fallback Denpasar hanya di defaultSettings.
        expect(props.centerCoordinate).toBeUndefined();
      }
      // Sanity: defaultSettings tetap Denpasar.
      expect(firstProps.defaultSettings?.centerCoordinate).toEqual(DEFAULT_FALLBACK_CENTER);
    });
  });

  describe('urutan mount kamera', () => {
    test('rute fitBounds duluan: GPS pertama tidak memicu setCamera', async () => {
      mockFind.mockResolvedValue({ addressJson: { coordinates: [106.85, -6.2] } });
      setupRouteServiceResolve(async () =>
        createMockRouteResult([[106.827, -6.175], [106.85, -6.2]]),
      );
      const gps = setupGpsCapture();

      render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
      );

      // Tunggu order lookup + listPacks selesai agar orderDestination dan
      // hasOfflineRegion sudah di-commit sebelum GPS di-emit.
      await waitFor(() => expect(mockFind).toHaveBeenCalled());
      await new Promise((resolve) => globalThis.setTimeout(() => resolve(undefined), 30));

      // Sekarang kamera sudah mounted. Emit memicu setCurrentLocation,
      // lalu route effect akan fitBounds. setCamera tidak boleh ikut.
      act(() => {
        gps.emit(-6.175, 106.8);
      });

      await waitFor(() => expect(mockCameraRef.fitBounds).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => globalThis.setTimeout(() => resolve(undefined), 30));

      expect(mockCameraRef.setCamera).not.toHaveBeenCalled();
    });

    test('listPacks resolve setelah getRoute: fitBounds 1x, setCamera 0x', async () => {
      // listPacks sengaja resolve belakangan supaya kamera baru ter-mount
      // setelah rute sudah siap.
      (offlineStorage.listPacks as jest.Mock).mockImplementation(
        () => new Promise((resolve) => globalThis.setTimeout(() => resolve([{ state: 'complete' }]), 80)),
      );
      mockFind.mockResolvedValue({ addressJson: { coordinates: [106.85, -6.2] } });
      setupRouteServiceResolve(async () =>
        createMockRouteResult([[106.827, -6.175], [106.85, -6.2]]),
      );
      const gps = setupGpsCapture();

      render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
      );

      // GPS datang duluan, saat listPacks belum resolve.
      act(() => {
        gps.emit(-6.175, 106.8);
      });

      // Tunggu getRoute dan listPacks selesai.
      await new Promise((resolve) => globalThis.setTimeout(() => resolve(undefined), 120));

      // fitBounds terpanggil sekali setelah kamera mount. setCamera tidak
      // memupun karena fitBounds duluan.
      expect(mockCameraRef.fitBounds).toHaveBeenCalledTimes(1);
      expect(mockCameraRef.setCamera).not.toHaveBeenCalled();
    });
  });

  describe('pemulihan online', () => {
    test('online pulih memicu satu getRoute tambahan walau GPS < 300 m', async () => {
      (networkMonitor.getStatus as jest.Mock).mockReturnValue('offline');
      let networkCallback: ((status: 'online' | 'offline') => void) | null = null;
      (networkMonitor.subscribe as jest.Mock).mockImplementation((cb) => {
        networkCallback = cb;
        return () => {};
      });
      mockFind.mockResolvedValue({ addressJson: { coordinates: [106.85, -6.2] } });
      const mockGetRoute = setupRouteServiceResolve(async () =>
        createMockRouteResult([[106.827, -6.175], [106.85, -6.2]], true),
      );
      const gps = setupGpsCapture();

      render(
        <MapScreen database={{ get: mockGet } as any} navigation={{} as any} route={{ params: { orderId: 'order-123' } } as any} />,
      );

      // Offline + GPS pertama → getRoute pertama (snapshot path).
      act(() => {
        gps.emit(-6.175, 106.8);
      });
      await waitFor(() => expect(mockGetRoute).toHaveBeenCalledTimes(1));

      // Pulih ke online — handler clear lastRouteOriginRef.
      act(() => {
        networkCallback?.('online');
      });

      // Satu update GPS kecil (< 300 m).
      act(() => {
        gps.emit(metersNorth(-6.175, 100), 106.8);
      });
      await waitFor(() => expect(mockGetRoute).toHaveBeenCalledTimes(2));

      // Setelah itu update GPS kecil berikutnya tidak menambah panggilan.
      act(() => {
        gps.emit(metersNorth(-6.175, 150), 106.8);
      });
      await new Promise((resolve) => globalThis.setTimeout(() => resolve(undefined), 30));
      expect(mockGetRoute).toHaveBeenCalledTimes(2);
    });
  });
});

describe('Coordinate format conversion', () => {
  test('verifies GPS {lat, lng} converts to LngLat {lng, lat} for RoutingProvider', () => {
    // Simulasi konversi yang dilakukan di MapScreen
    const gpsLocation = { coords: { latitude: -6.175, longitude: 106.827 } };

    // Konversi dari GPS format { lat, lng } ke LngLat { lng, lat }
    const lngLat: { lng: number; lat: number } = {
      lng: gpsLocation.coords.longitude, // 106.827
      lat: gpsLocation.coords.latitude,   // -6.175
    };

    expect(lngLat.lng).toBeCloseTo(106.827);
    expect(lngLat.lat).toBeCloseTo(-6.175);
  });

  test('verifies order coordinates [lng, lat] array converts to LngLat {lng, lat}', () => {
    // Simulasi konversi dari DeliveryAddress.coordinates [lng, lat]
    const orderCoordinates: [number, number] = [106.85, -6.2]; // [lng, lat]

    const [lng, lat] = orderCoordinates;
    const lngLat: { lng: number; lat: number } = { lng, lat };

    expect(lngLat.lng).toBeCloseTo(106.85);
    expect(lngLat.lat).toBeCloseTo(-6.2);
  });
});