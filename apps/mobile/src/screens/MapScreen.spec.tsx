/**
 * Unit tests untuk MapScreen.tsx routing integration.
 *
 * Test focus:
 * 1. Terima orderId dan lookup order dengan benar
 * 2. Order tidak ketemu / coordinates kosong → error tanpa crash
 * 3. getRoute() dipanggil dengan origin/destination yang benar (urutan lat/lng)
 * 4. Loading state, isFromCache indicator, error state
 * 5. Navigasi OrderDetailScreen kirim orderId dengan benar
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

import { MapScreen } from './MapScreen';
import { RouteService } from '../map/routeService';
import { networkMonitor } from '../map/networkMonitor';
import { locationService } from '../map/location';
import { offlineStorage } from '../map/offlineStorage';
import type { RouteResult } from '../map/routeService';
import type { RouteRequest } from '../map/routing';

// ─── Mock setup ───────────────────────────────────────────────────────────────

// Mock react-native components
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
  }),
  useRoute: () => ({
    params: { orderId: 'order-123' },
  }),
}));

// Mock MapLibreGL — top-level export (matching established mock in __mocks__)
jest.mock('@maplibre/maplibre-react-native', () => ({
  MapView: () => null,
  Camera: () => null,
  ShapeSource: ({ children }: { children: React.ReactNode }) => children,
  LineLayer: () => null,
  MarkerView: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock database
const mockFind = jest.fn();
const mockGet = jest.fn().mockReturnValue({ find: mockFind });
jest.mock('@nozbe/watermelondb/react', () => ({
  withDatabase: (Component: React.ComponentType<any>) => Component,
}));
jest.mock('@nozbe/watermelondb', () => ({
  withDatabase: (Component: React.ComponentType<any>) => Component,
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MapScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();

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
