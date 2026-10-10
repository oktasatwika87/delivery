/**
 * Tes untuk CustomerStack, verifikasi Chat route memakai ChatScreen dari
 * src/screens, bukan default-export App.tsx.
 *
 * Pendekatan ringan: mock createNativeStackNavigator untuk merekam
 * komponen apa yang didaftarkan per nama route. Kita juga mock
 * '../screens/ChatScreen' dengan komponen penanda yang membawa identitas
 * (`__marker`). Setelah CustomerStack di-render, komponen yang
 * didaftarkan untuk 'Chat' HARUS punya identitas `__marker` yang sama
 * dengan mock kita, bukan identitas App.tsx default export.
 *
 * Pada kode lama (import ChatScreen dari App.tsx dengan path import
 * keliru), komponen untuk 'Chat' adalah App, yang TIDAK punya `__marker`
 * ini, jadi tes gagal.
 */

// mock-prefix wajib karena diakses dari jest.mock factory (hoisting).
const mockScreenComponents: Record<string, (ComponentType<object> & { __marker?: string }) | null | undefined> = {};

// Simpan referensi ke React untuk dipakai di dalam factory jest.mock
// (yang di-hoist ke atas modul). Nama berawalan `mock` agar boleh diakses.
const mockReact = jest.requireActual<typeof import('react')>('react');

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: { children: ReactNode }): React.ReactElement => {
      return mockReact.createElement(
        mockReact.Fragment,
        null,
        children,
      );
    },
    Screen: ({
      name: routeName,
      component,
    }: { name: string; component?: ComponentType<object> }): null => {
      if (component !== undefined) {
        mockScreenComponents[routeName] = component;
      }
      return null;
    },
  }),
}));

jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: { children: ReactNode }): null => {
    void children;
    return null;
  },
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), replace: jest.fn() }),
  useRoute: () => ({ params: { roomId: 'room-customer-1' } }),
}));

jest.mock('react-native-config', () => ({
  default: { API_BASE_URL: 'http://localhost:3000' },
}));

// Komponen penanda dengan `__marker` supaya bisa dibandingkan identitasnya.
// Kalau CustomerStack import ChatScreen dari '../screens/ChatScreen',
// identitas yang didaftarkan untuk route 'Chat' akan jadi identitas
// mockChatScreenMarker di bawah ini.
//
// Penanda didefinisikan DI DALAM factory jest.mock di bawah, bukan sebagai
// variabel top-level, supaya tidak kena TDZ saat jest.mock di-hoist ke atas
// modul oleh transform jest.
jest.mock('../screens/ChatScreen', () => {
  function createMarker(): ComponentType<object> & { __marker: string } {
    const marker = (): null => null;
    marker.__marker = 'CHATSCREEN_FROM_SCREENS_FOLDER';
    return marker;
  }
  return { ChatScreen: createMarker() };
});

// Impor identitas marker yang sebenarnya, lewat require agar referensi
// sama dengan yang dipakai factory. Pakai helper untuk komparasi.
const mockChatScreenMarkerModule = jest.requireMock<{
  ChatScreen: (props: object) => null & { __marker: string };
}>('../screens/ChatScreen');
const mockChatScreenMarker = mockChatScreenMarkerModule.ChatScreen;

// Stub App.tsx dependencies: kalau navigator salah import dari App.tsx
// (kode lama), ini mencegah module load meledak. Setelah fix, App.tsx
// tidak lagi di-import dari CustomerStack, jadi stub ini tidak relevan.
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: ReactNode }): null => {
    void children;
    return null;
  },
  SafeAreaView: ({ children }: { children: ReactNode }): null => {
    void children;
    return null;
  },
}));

jest.mock('@nozbe/watermelondb/react', () => ({
  DatabaseProvider: ({ children }: { children: ReactNode }): null => {
    void children;
    return null;
  },
  withDatabase: <P,>(Component: ComponentType<P>): ComponentType<P> => Component,
  withObservables: (): ComponentType<unknown> => (): null => null,
}));

jest.mock('@nozbe/watermelondb', () => ({
  Database: class {},
  Q: {
    where: jest.fn().mockReturnValue({ _where: 'test' }),
    sortBy: jest.fn().mockReturnValue({ _sortBy: 'test' }),
  },
}));

// Database singleton di src/db: stub supaya App.tsx yang salah import
// tidak menarik better-sqlite3 di jest (dependency Node-only, tidak relevan
// untuk tes React component).
jest.mock('../db', () => ({
  database: {
    get: jest.fn(),
    write: jest.fn().mockImplementation(async (fn: () => Promise<void>) => fn()),
    batch: jest.fn(),
  },
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn().mockResolvedValue(false),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
}));

jest.mock('../sync', () => ({
  syncCoordinator: {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn(),
    pullNow: jest.fn().mockResolvedValue(undefined),
    flushNow: jest.fn().mockResolvedValue(undefined),
  },
  ordersSocket: {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  },
  syncEvents: {
    on: jest.fn(() => () => {}),
    off: jest.fn(),
    emit: jest.fn(),
  },
}));

jest.mock('../sync/socket', () => ({
  chatSocket: {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    isConnected: true,
  },
}));

jest.mock('../sync/token-storage', () => ({
  getToken: jest.fn().mockResolvedValue(null),
  getRole: jest.fn().mockResolvedValue(null),
  clearToken: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../map/routeSnapshot', () => ({
  routeSnapshotService: {
    runRetentionCleanup: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../map/networkMonitor', () => ({
  networkMonitor: {
    start: jest.fn(),
    stop: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  },
}));

import type { ComponentType, ReactNode } from 'react';
import { render } from '@testing-library/react-native';
import { CustomerStack } from './CustomerStack';

describe('CustomerStack Chat route', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockScreenComponents)) {
      delete mockScreenComponents[key];
    }
  });

  it('route Chat di customer stack memakai ChatScreen dari src/screens, bukan App', () => {
    render(<CustomerStack onLogout={jest.fn()} />);

    const chatComponent = mockScreenComponents.Chat;
    expect(chatComponent).toBeDefined();
    // Komponen untuk 'Chat' haruslah mockChatScreenMarker yang kita mock
    // untuk '../screens/ChatScreen', bukan default-export App.tsx.
    expect(chatComponent).toBe(mockChatScreenMarker);
    expect(chatComponent?.__marker).toBe('CHATSCREEN_FROM_SCREENS_FOLDER');
  });
});