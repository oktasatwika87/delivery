/**
 * Tes untuk CustomerStack.
 *
 * Tumpukan customer memakai animasi geser dari kanan, dan layar status order
 * didaftarkan lewat komponen tingkat modul dengan tema terang. Tiruan
 * Navigator merekam opsi layar dan komponen tiap route, lalu tes memanggil
 * komponen status order secara langsung.
 */

// mock-prefix wajib karena diakses dari jest.mock factory (hoisting).
const mockScreenComponents: Record<string, unknown> = {};

// Fokus layar tiruan, supaya tes bisa membuat layar status order berubah dari
// terlihat jadi tidak terlihat.
var mockFokus = true;

/** Opsi layar yang dipakai Navigator. */
interface OpsiNavigator {
  headerShown?: boolean;
  animation?: string;
}

const mockOpsiNavigator: OpsiNavigator = {};

/** Navigasi yang dipakai layar status order. */
interface NavigasiStatusOrder {
  navigate: (nama: string, params: { roomId: string }) => void;
  goBack: () => void;
}

/** Props layar status order sesuai NativeStackScreenProps. */
interface PropsLayarStatusOrder {
  navigation: NavigasiStatusOrder;
  route: { params: { orderId: string } };
}

/** Props layar status order yang diterima OrderTrackingScreen. */
interface PropsStatusOrder {
  orderId: string;
  terlihat: boolean;
  onBack: () => void;
  onOpenChat: (roomId: string) => void;
}

let mockKomponenStatusOrder: ComponentType<PropsLayarStatusOrder> | null = null;

/** Catatan props dan tema yang diterima layar status order. */
const mockStatusOrder: { props: PropsStatusOrder | null; namaTema: string | null } = {
  props: null,
  namaTema: null,
};

// Simpan referensi ke React untuk dipakai di dalam factory jest.mock
// (yang di-hoist ke atas modul). Nama berawalan `mock` agar boleh diakses.
const mockReact = jest.requireActual<typeof import('react')>('react');

jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({
      children,
      screenOptions,
    }: {
      children: ReactNode;
      screenOptions?: OpsiNavigator;
    }): React.ReactElement => {
      mockOpsiNavigator.headerShown = screenOptions?.headerShown;
      mockOpsiNavigator.animation = screenOptions?.animation;
      return mockReact.createElement(
        mockReact.Fragment,
        null,
        children,
      );
    },
    Screen: ({
      name: routeName,
      component,
    }: {
      name: string;
      component?: ComponentType<PropsLayarStatusOrder>;
    }): null => {
      if (component !== undefined) {
        mockScreenComponents[routeName] = component;
        if (routeName === 'OrderTracking') {
          mockKomponenStatusOrder = component;
        }
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
  useIsFocused: () => mockFokus,
}));

jest.mock('react-native-config', () => ({
  default: { API_BASE_URL: 'http://localhost:3000' },
}));

// Layar status order ditiru jadi komponen yang merekam props dan nama tema
// yang berlaku di dalamnya.
jest.mock('./OrderTrackingScreen', () => {
  const tema = jest.requireActual<typeof import('../theme/ThemeProvider')>(
    '../theme/ThemeProvider',
  );
  return {
    OrderTrackingScreen: (props: PropsStatusOrder): null => {
      mockStatusOrder.props = props;
      mockStatusOrder.namaTema = tema.useTheme().name;
      return null;
    },
  };
});

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

// Penhitung jendela awal, supaya tes bisa tahu berapa kali penyedia jendela
// awal dirender.
const mockJumlahJendela = { dipasang: 0 };

// Jendela awal ditiru jadi pembungkus kosong, karena tes di bawah memeriksa
// route 'Chat' memakai ChatScreen itu sendiri.
jest.mock('../components/motion/InitialWindow', () => ({
  InitialWindowProvider: ({ children }: { children: ReactNode }): ReactNode => {
    mockJumlahJendela.dipasang += 1;
    return children;
  },
  withInitialWindow: (Layar: ComponentType<object>): ComponentType<object> => Layar,
}));

// Impor identitas marker yang sebenarnya, lewat require agar referensi
// sama dengan yang dipakai factory. Pakai helper untuk komparasi.
const mockChatScreenMarkerModule = jest.requireMock<{
  ChatScreen: ((props: object) => null) & { __marker: string };
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
import * as reanimated from 'react-native-reanimated';

import { CustomerStack } from './CustomerStack';

describe('CustomerStack', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockScreenComponents)) {
      delete mockScreenComponents[key];
    }
    mockOpsiNavigator.headerShown = undefined;
    mockOpsiNavigator.animation = undefined;
    mockKomponenStatusOrder = null;
    mockStatusOrder.props = null;
    mockStatusOrder.namaTema = null;
    mockFokus = true;
    mockJumlahJendela.dipasang = 0;
  });

  it('route Chat di customer stack memakai ChatScreen dari src/screens, bukan App', () => {
    render(<CustomerStack onLogout={jest.fn()} />);

    const chatComponent = mockScreenComponents.Chat;
    expect(chatComponent).toBeDefined();
    // Komponen untuk 'Chat' haruslah mockChatScreenMarker yang kita mock
    // untuk '../screens/ChatScreen', bukan default-export App.tsx.
    expect(chatComponent).toBe(mockChatScreenMarker);
    expect(mockChatScreenMarker.__marker).toBe('CHATSCREEN_FROM_SCREENS_FOLDER');
  });

  it('tumpukan customer memakai animasi geser dari kanan', () => {
    render(<CustomerStack onLogout={jest.fn()} />);

    expect(mockOpsiNavigator.headerShown).toBe(false);
    expect(mockOpsiNavigator.animation).toBe('slide_from_right');
  });

  it('kurangi gerakan mematikan animasi tumpukan customer', () => {
    const spy = jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);

    render(<CustomerStack onLogout={jest.fn()} />);

    expect(mockOpsiNavigator.animation).toBe('none');
    spy.mockRestore();
  });

  it('layar status order terdaftar lewat komponen dengan tema terang', () => {
    render(<CustomerStack onLogout={jest.fn()} />);

    const Layar = mockKomponenStatusOrder;
    if (Layar === null) throw new Error('layar status order tidak terdaftar');

    const navigate = jest.fn();
    const goBack = jest.fn();
    render(
      <Layar
        navigation={{ navigate, goBack }}
        route={{ params: { orderId: 'order-customer-9' } }}
      />,
    );

    expect(mockStatusOrder.namaTema).toBe('terang');
    const props = mockStatusOrder.props;
    if (props === null) throw new Error('layar status order tidak dirender');
    expect(props.orderId).toBe('order-customer-9');

    props.onBack();
    expect(goBack).toHaveBeenCalled();

    props.onOpenChat('x');
    expect(navigate).toHaveBeenCalledWith('Chat', { roomId: 'x' });
  });

  it('layar status order memasang jendela awal untuk kerangkanya', () => {
    render(<CustomerStack onLogout={jest.fn()} />);

    const Layar = mockKomponenStatusOrder;
    if (Layar === null) throw new Error('layar status order tidak terdaftar');

    render(
      <Layar
        navigation={{ navigate: jest.fn(), goBack: jest.fn() }}
        route={{ params: { orderId: 'order-customer-9' } }}
      />,
    );

    expect(mockJumlahJendela.dipasang).toBeGreaterThan(0);
  });

  it('layar status order tahu kalau sedang terlihat', () => {
    render(<CustomerStack onLogout={jest.fn()} />);

    const Layar = mockKomponenStatusOrder;
    if (Layar === null) throw new Error('layar status order tidak terdaftar');

    const navigate = jest.fn();
    const goBack = jest.fn();
    const tampilan = render(
      <Layar
        navigation={{ navigate, goBack }}
        route={{ params: { orderId: 'order-customer-9' } }}
      />,
    );

    const props = mockStatusOrder.props;
    if (props === null) throw new Error('layar status order tidak dirender');
    expect(props.terlihat).toBe(true);

    mockFokus = false;
    tampilan.rerender(
      <Layar
        navigation={{ navigate, goBack }}
        route={{ params: { orderId: 'order-customer-9' } }}
      />,
    );

    const propsBaru = mockStatusOrder.props;
    if (propsBaru === null) throw new Error('layar status order tidak dirender');
    expect(propsBaru.terlihat).toBe(false);
  });
});
