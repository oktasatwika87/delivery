/**
 * Mock untuk @maplibre/maplibre-react-native
 *
 * Menyediakan mock untuk:
 * - OfflineManager
 * - LocationManager
 * - MapView, Camera (via MapLibreGL default export)
 *
 * Reset state via beforeEach di setiap test file.
 */

// ─── OfflineManager ────────────────────────────────────────────────────

const mockPacks = new Map<string, MockOfflinePack>();

export interface MockOfflinePack {
  name: string;
  _status: {
    state: number;
    percentage: number;
    completedTileCount: number;
    completedTileSize: number;
    requiredResourceCount: number;
  };
}

const OfflineManager = {
  createPack: jest.fn().mockImplementation((_options, onProgress, _onError) => {
    // Simulasi: call onProgress sekali dengan state complete
    setTimeout(() => {
      onProgress(null, {
        state: 2, // Complete
        percentage: 100,
        completedTileCount: 100,
        completedTileSize: 1024 * 1024,
        requiredResourceCount: 100,
      });
    }, 10);
    return Promise.resolve();
  }),

  deletePack: jest.fn().mockImplementation((name: string) => {
    mockPacks.delete(name);
    return Promise.resolve();
  }),

  getPacks: jest.fn().mockImplementation(() => {
    return Promise.resolve(Array.from(mockPacks.values()));
  }),

  _reset: () => {
    mockPacks.clear();
    (OfflineManager.createPack as jest.Mock).mockClear();
    (OfflineManager.deletePack as jest.Mock).mockClear();
    (OfflineManager.getPacks as jest.Mock).mockClear();
  },
};

// ─── LocationManager ──────────────────────────────────────────────────

const locationListeners = new Set<(location: MockLocation) => void>();

export interface MockLocation {
  coords: {
    latitude: number;
    longitude: number;
    altitude: number | null;
    accuracy: number;
    altitudeAccuracy: number | null;
    heading: number | null;
    speed: number | null;
  };
  timestamp: number;
}

const LocationManager = {
  addListener: jest.fn().mockImplementation((listener: (loc: MockLocation) => void) => {
    locationListeners.add(listener);
    // Return subscription handle
    return {
      remove: () => locationListeners.delete(listener),
    };
  }),

  removeListener: jest.fn().mockImplementation((listener: (loc: MockLocation) => void) => {
    locationListeners.delete(listener);
  }),

  getLastKnownLocation: jest.fn().mockImplementation(() => {
    return Promise.resolve<MockLocation | null>({
      coords: {
        latitude: -6.175,
        longitude: 106.827,
        altitude: null,
        accuracy: 10,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    });
  }),

  setMinDisplacement: jest.fn(),

  // Test helpers
  _emitLocation: (location: MockLocation) => {
    locationListeners.forEach((l) => l(location));
  },

  _reset: () => {
    locationListeners.clear();
    (LocationManager.addListener as jest.Mock).mockClear();
    (LocationManager.removeListener as jest.Mock).mockClear();
    (LocationManager.getLastKnownLocation as jest.Mock).mockClear();
    (LocationManager.setMinDisplacement as jest.Mock).mockClear();
  },
};

// ─── MapLibreGL default export (MapView, Camera) ─────────────────────

// CameraRef mock
const mockCameraRef = {
  setCamera: jest.fn(),
  flyTo: jest.fn(),
  zoomTo: jest.fn(),
  moveTo: jest.fn(),
};

// MapView mock - functional component
const MockMapView = () => null;

// Camera mock - functional component
const MockCamera = (_props: unknown) => null;

// StyleSheet mock for mapStyle
const MockStyleSheet = {
  create: (styles: Record<string, unknown>) => styles,
};

const MapLibreGL = {
  MapView: MockMapView,
  Camera: MockCamera,
  CameraRef: mockCameraRef,
  StyleSheet: MockStyleSheet,
  Logger: {
    setLogLevel: jest.fn(),
  },
};

// ─── Type re-exports (for imports in source) ─────────────────────────

export type { OfflinePack, OfflinePackStatus } from '@maplibre/maplibre-react-native';
export type { Location } from '@maplibre/maplibre-react-native';

// ─── Root module export ──────────────────────────────────────────────

export { OfflineManager, LocationManager, MapLibreGL };

// ─── Reset all mocks before each test ──────────────────────────────

beforeEach(() => {
  OfflineManager._reset();
  LocationManager._reset();
});
