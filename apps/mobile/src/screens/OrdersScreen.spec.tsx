/**
 * Smoke test untuk OrdersScreen, verify component mounts without errors.
 *
 * Full render test dengan async HOC chain (getCurrentUserId, withObservables,
 * fetchPool) sulit diisolasi di Jest tanpa integration setup yang kompleks.
 * Test ini cukup memastikan component tidak throw saat mount dengan mock data.
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

// Mock @nozbe/watermelondb/react SEBELUM import component
jest.mock('@nozbe/watermelondb/react', () => ({
  withDatabase: (C: any) => C,
  withObservables: (_trigger: any, _getObs: any) => (C: any) => C,
}));

// Mock Alert
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    Alert: {
      alert: jest.fn(),
    },
  };
});

jest.mock('@nozbe/watermelondb', () => ({
  Q: {
    where: jest.fn().mockReturnValue({ _where: 'test' }),
    sortBy: jest.fn().mockReturnValue({ _sortBy: 'test' }),
  },
}));

// Mock Config
jest.mock('react-native-config', () => ({
  default: { API_BASE_URL: 'http://localhost:3000' },
}));

// Mock session
jest.mock('../sync/session', () => ({
  getCurrentUserId: () => Promise.resolve('driver-123'),
}));

// Mock API client
// Must use require.resolve to ensure correct module path
jest.mock('../sync/client', () => {
  // Define a minimal error class for the instanceof check in catch block
  class UnauthorizedError extends Error {
    constructor() {
      super('Sesi berakhir, silakan login ulang');
      this.name = 'UnauthorizedError';
    }
  }
  return {
    fetchAvailableOrders: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    UnauthorizedError,
    acceptOrder: jest.fn(),
    // Ambil ApiError dari modul asli, dipakai oleh OrdersScreen.tsx
    // untuk `err instanceof ApiError` di catch handleAccept.
    ApiError: jest.requireActual('../sync/client').ApiError,
  };
});

// Mock ordersSocket
// Simpan semua callback yang didaftarkan lewat ordersSocket.on(...) per event,
// supaya tes bisa memanggilnya sendiri untuk meniru event 'connect' dari socket.
// Namanya diawali mock karena jest.mock factory hanya boleh memakai variabel
// luar yang namanya diawali mock.
const mockOrdersSocketConnectListeners: Array<() => void> = [];
const mockOrdersSocketUnsubscribes: jest.Mock<unknown[], []> = jest.fn();

jest.mock('../sync/ordersSocket', () => ({
  ordersSocket: {
    onOrderAvailable: jest.fn().mockReturnValue(jest.fn()),
    onOrderUnavailable: jest.fn().mockReturnValue(jest.fn()),
    on: jest.fn((event: string, cb: () => void) => {
      if (event === 'connect') {
        mockOrdersSocketConnectListeners.push(cb);
      }
      return mockOrdersSocketUnsubscribes;
    }),
  },
}));

// Mock navigation
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: { children: React.ReactNode }) => children,
  useNavigation: () => ({
    navigate: jest.fn(),
  }),
}));

// Mock routing provider untuk route pre-compute
jest.mock('../map/routing', () => ({
  GraphHopperRoutingProvider: jest.fn().mockImplementation(() => ({
    getRoute: jest.fn().mockResolvedValue({ distance: 1000, duration: 300 }),
  })),
}));

// Mock location service
jest.mock('../map/location', () => ({
  locationService: {
    getLastKnown: jest.fn().mockResolvedValue(null),
    subscribe: jest.fn().mockResolvedValue(jest.fn()),
  },
}));

// Mock network monitor
jest.mock('../map/networkMonitor', () => ({
  networkMonitor: {
    getStatus: jest.fn().mockReturnValue('online'),
    subscribe: jest.fn().mockReturnValue(jest.fn()),
  },
}));

// Mock sync coordinator
jest.mock('../sync', () => ({
  syncCoordinator: {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn(),
    flushNow: jest.fn().mockResolvedValue(null),
    pullNow: jest.fn().mockResolvedValue(null),
  },
}));

// Mock outbox
const mockHasPendingAction = jest.fn();
const mockHasStalePendingAction = jest.fn();
jest.mock('../sync/outbox', () => ({
  __esModule: true,
  hasPendingAction: (...args: unknown[]) => mockHasPendingAction(...args),
  hasStalePendingAction: (...args: unknown[]) => mockHasStalePendingAction(...args),
}));

// Mock WatermelonDB
const mockOrdersCollection = {
  query: jest.fn().mockReturnValue({
    fetch: jest.fn().mockResolvedValue([]),
    fetchCount: jest.fn().mockResolvedValue(0),
    observe: jest.fn().mockReturnValue({
      subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
    }),
  }),
  find: jest.fn().mockRejectedValue(new Error('not found')),
  create: jest.fn().mockResolvedValue({}),
  prepareCreateFromDirtyRaw: jest.fn().mockReturnValue({
    _preparedState: 'create',
    _raw: { id: '', _status: 'synced' },
  }),
};

const mockBatch = jest.fn().mockResolvedValue(undefined);

const mockDatabase = {
  get: jest.fn().mockReturnValue(mockOrdersCollection),
  write: jest.fn().mockImplementation(async (fn: () => Promise<void>) => fn()),
  batch: mockBatch,
};

// Import after mocks
import { OrdersScreen, OrdersScreenBase } from './OrdersScreen';
import { fetchAvailableOrders } from '../sync/client';

// Plain-object order stand-ins for OrdersScreenBase's myOrders prop, the
// component only reads plain properties (id/status/totalCents/currency) in
// renderItem, no WatermelonDB model methods, so these don't need to be real
// OrderModel instances.
function makeOrder(overrides: Partial<{ id: string; status: string; totalCents: number; currency: string; driverId: string | null }> = {}) {
  return {
    id: 'order-1',
    status: 'ASSIGNED',
    totalCents: 25000,
    currency: 'IDR',
    driverId: 'driver-123',
    ...overrides,
  };
}

describe('OrdersScreen smoke test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock to return new { items, hasMore } format
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    // Reset find to reject (new order create path)
    mockOrdersCollection.find = jest.fn().mockRejectedValue(new Error('not found'));
    mockOrdersCollection.create = jest.fn().mockResolvedValue({});
    mockOrdersCollection.prepareCreateFromDirtyRaw = jest.fn().mockReturnValue({
      _preparedState: 'create',
      _raw: { id: '', _status: 'synced' },
    });
    mockBatch.mockResolvedValue(undefined);
  });

  test('mounts without throwing', () => {
    let error: Error | null = null;

    try {
      // Render synchronously, async HOC chain causes loading state but doesn't throw
      const { UNSAFE_root } = render(<OrdersScreen database={mockDatabase as never} />);
      // Access root to prevent "unused variable" warning
      expect(UNSAFE_root).toBeTruthy();
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeNull();
  });

  test('fetchPool uses prepareCreateFromDirtyRaw with batch for new orders', async () => {
    // Regression test: verify the CORRECT WatermelonDB pattern for custom ID.
    // Old buggy pattern: create() with _raw.id override, causes corrupt rows.
    // Correct pattern: prepareCreateFromDirtyRaw + database.batch().
    const poolItems = [
      { orderId: 'order-custom-1', totalCents: 25000, currency: 'IDR', itemsCount: 2, createdAt: '2024-01-01T00:00:00Z', version: 7 },
    ];
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: poolItems, hasMore: false });

    render(<OrdersScreen database={mockDatabase as never} />);

    await waitFor(() => {
      expect(fetchAvailableOrders).toHaveBeenCalled();
    });

    // Verify prepareCreateFromDirtyRaw was called (NOT the old create() pattern)
    expect(mockOrdersCollection.prepareCreateFromDirtyRaw).toHaveBeenCalledTimes(1);

    // Verify batch was called to persist the prepared record
    expect(mockBatch).toHaveBeenCalledTimes(1);

    // Verify the custom ID was passed correctly (snake_case keys)
    expect(mockOrdersCollection.prepareCreateFromDirtyRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'order-custom-1',
        _status: 'synced',
        _changed: '',
        status: 'ASSIGNED',
        total_cents: 25000,
        currency: 'IDR',
        customer_id: '',
        driver_id: null,
        items_json: '[]',
        address_json: '{}',
        server_version: 7,
      }),
    );

    // Old create() pattern should NOT be called
    expect(mockOrdersCollection.create).not.toHaveBeenCalled();
  });

  test('fetchPool skips items with null/undefined orderId without throwing', async () => {
    // Regression test: backend returning null orderId previously caused
    // "Cannot read property 'id' of null" TypeError from WatermelonDB find(null)
    const poolItemsWithNullOrderId = [
      { orderId: null, totalCents: 25000, currency: 'IDR', itemsCount: 2, createdAt: '2024-01-01T00:00:00Z', version: 7 },
      { orderId: 'order-valid', totalCents: 30000, currency: 'IDR', itemsCount: 1, createdAt: '2024-01-01T00:00:00Z', version: 7 },
      { orderId: undefined, totalCents: 35000, currency: 'IDR', itemsCount: 3, createdAt: '2024-01-01T00:00:00Z', version: 7 },
    ];
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: poolItemsWithNullOrderId, hasMore: false });

    let caughtError: Error | null = null;
    try {
      render(<OrdersScreen database={mockDatabase as never} />);
      await waitFor(() => {
        expect(fetchAvailableOrders).toHaveBeenCalled();
      });
    } catch (e) {
      caughtError = e as Error;
    }

    // Should NOT throw TypeError
    expect(caughtError).toBeNull();

    // Valid item should be processed via prepareCreateFromDirtyRaw + batch
    expect(mockOrdersCollection.prepareCreateFromDirtyRaw).toHaveBeenCalledTimes(1);
    expect(mockBatch).toHaveBeenCalledTimes(1);

    // Old create() pattern should NOT be called
    expect(mockOrdersCollection.create).not.toHaveBeenCalled();
  });

  test('fetchPool handles array with only null orderId items gracefully', async () => {
    // Edge case: all items have null orderId, should not crash
    const allNullOrderId = [
      { orderId: null, totalCents: 25000, currency: 'IDR', itemsCount: 2, createdAt: '2024-01-01T00:00:00Z', version: 7 },
      { orderId: undefined, totalCents: 30000, currency: 'IDR', itemsCount: 1, createdAt: '2024-01-01T00:00:00Z', version: 7 },
    ];
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: allNullOrderId, hasMore: false });

    let caughtError: Error | null = null;
    try {
      render(<OrdersScreen database={mockDatabase as never} />);
      await waitFor(() => {
        expect(fetchAvailableOrders).toHaveBeenCalled();
      });
    } catch (e) {
      caughtError = e as Error;
    }

    // Should NOT throw
    expect(caughtError).toBeNull();
    // No creates should happen since all items are skipped
    expect(mockOrdersCollection.create).not.toHaveBeenCalled();
    expect(mockOrdersCollection.prepareCreateFromDirtyRaw).not.toHaveBeenCalled();
    expect(mockBatch).not.toHaveBeenCalled();
  });

  test('fetchPool passes correct custom ID to prepareCreateFromDirtyRaw', async () => {
    // Regression test: verify custom ID from backend is passed correctly to
    // prepareCreateFromDirtyRaw (not the auto-generated ID pattern).
    const customOrderId = '9e934d93-9da2-4d6a-b587-87a98d3a5cec';
    const poolItems = [
      { orderId: customOrderId, totalCents: 50000, currency: 'IDR', itemsCount: 1, city: 'Jakarta', createdAt: '2026-07-23T04:15:57.745Z', version: 7 },
    ];
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: poolItems, hasMore: false });

    render(<OrdersScreen database={mockDatabase as never} />);

    await waitFor(() => {
      expect(fetchAvailableOrders).toHaveBeenCalled();
    });

    // Verify the exact custom ID from backend is preserved
    expect(mockOrdersCollection.prepareCreateFromDirtyRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        id: customOrderId,
      }),
    );

    // Verify batch was called to persist
    expect(mockBatch).toHaveBeenCalledTimes(1);
    expect(mockBatch).toHaveBeenCalledWith(
      expect.objectContaining({ _preparedState: 'create' }),
    );
  });
});

// Pending action badge (Fase 2 outbox wiring)
//
// Rendered via OrdersScreenBase directly (bypassing the withDatabase/
// withObservables-wrapped OrdersScreen export) because the
// '@nozbe/watermelondb/react' mock above treats withObservables as an
// identity HOC that never actually computes myOrders, so myOrders is
// always undefined through the wrapped export in this test file. Testing
// the base component with plain-object props sidesteps that without having
// to build a more elaborate observable mock just for this.
describe('pending action badge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    mockHasPendingAction.mockResolvedValue(false);
  });

  test('shows badge for a myOrders item with a pending action, not for one without', async () => {
    mockHasPendingAction.mockImplementation((orderId: string) =>
      Promise.resolve(orderId === 'order-pending'),
    );
    const myOrders = [makeOrder({ id: 'order-pending' }), makeOrder({ id: 'order-normal' })];

    const { queryAllByText } = render(
      <OrdersScreenBase database={mockDatabase as never} myOrders={myOrders as never} />,
    );

    await waitFor(() => {
      expect(mockHasPendingAction).toHaveBeenCalledWith('order-pending');
      expect(mockHasPendingAction).toHaveBeenCalledWith('order-normal');
    });

    await waitFor(() => {
      expect(queryAllByText('Menunggu sinkronisasi')).toHaveLength(1);
    });
  });

  test('shows no badge when nothing is pending', async () => {
    const myOrders = [makeOrder({ id: 'order-a' }), makeOrder({ id: 'order-b' })];

    const { queryAllByText } = render(
      <OrdersScreenBase database={mockDatabase as never} myOrders={myOrders as never} />,
    );

    await waitFor(() => {
      expect(mockHasPendingAction).toHaveBeenCalled();
    });

    expect(queryAllByText('Menunggu sinkronisasi')).toHaveLength(0);
  });

  test('never shows in the pool ("Tersedia") section, even if a pool item id would otherwise resolve pending=true', async () => {
    // Pool orders come from poolOrders state (via fetchAvailableOrders), not
    // myOrders, renderItem gates the badge on section.title === 'Order
    // Saya', so a pool item must never show it, and hasPendingAction should
    // never even be called for a pool item's id.
    mockHasPendingAction.mockResolvedValue(true);
    const sharedId = 'order-shared-id';
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({
      items: [
        { orderId: sharedId, totalCents: 25000, currency: 'IDR', itemsCount: 1, createdAt: '2024-01-01T00:00:00Z' },
      ],
      hasMore: false,
    });
    const myOrders = [makeOrder({ id: 'order-mine' })];

    const { queryAllByText } = render(
      <OrdersScreenBase database={mockDatabase as never} myOrders={myOrders as never} />,
    );

    await waitFor(() => {
      expect(fetchAvailableOrders).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mockHasPendingAction).toHaveBeenCalledWith('order-mine');
    });

    // "Order Saya" item shows the badge...
    await waitFor(() => {
      expect(queryAllByText('Menunggu sinkronisasi')).toHaveLength(1);
    });
    // ...and hasPendingAction was never asked about the pool item's id at all.
    expect(mockHasPendingAction).not.toHaveBeenCalledWith(sharedId);
  });
});

// Stale pending action badge
describe('stale pending action badge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    mockHasPendingAction.mockResolvedValue(false);
    mockHasStalePendingAction.mockResolvedValue(false);
  });

  test('shows warning badge with stale message when pending action is older than 60 minutes', async () => {
    mockHasPendingAction.mockImplementation((orderId: string) =>
      Promise.resolve(orderId === 'order-stale'),
    );
    mockHasStalePendingAction.mockImplementation((orderId: string) =>
      Promise.resolve(orderId === 'order-stale'),
    );
    const myOrders = [makeOrder({ id: 'order-stale' }), makeOrder({ id: 'order-normal' })];

    const { queryAllByText, getByText } = render(
      <OrdersScreenBase database={mockDatabase as never} myOrders={myOrders as never} />,
    );

    await waitFor(() => {
      expect(mockHasPendingAction).toHaveBeenCalledWith('order-stale');
      expect(mockHasStalePendingAction).toHaveBeenCalledWith('order-stale');
    });

    await waitFor(() => {
      expect(getByText('Belum tersinkron dari sejam lalu — cek koneksi internet kamu')).toBeTruthy();
    });
    // Normal pending badge should NOT show for stale orders
    expect(queryAllByText('Menunggu sinkronisasi')).toHaveLength(0);
  });

  test('shows normal badge for fresh pending action (< 60 minutes)', async () => {
    mockHasPendingAction.mockImplementation((orderId: string) =>
      Promise.resolve(orderId === 'order-fresh'),
    );
    mockHasStalePendingAction.mockImplementation((_orderId: string) =>
      Promise.resolve(false), // not stale
    );
    const myOrders = [makeOrder({ id: 'order-fresh' })];

    const { queryAllByText, getByText } = render(
      <OrdersScreenBase database={mockDatabase as never} myOrders={myOrders as never} />,
    );

    await waitFor(() => {
      expect(mockHasPendingAction).toHaveBeenCalledWith('order-fresh');
      expect(mockHasStalePendingAction).toHaveBeenCalledWith('order-fresh');
    });

    await waitFor(() => {
      expect(getByText('Menunggu sinkronisasi')).toBeTruthy();
    });
    // Stale badge should NOT show for fresh orders
    expect(queryAllByText('Belum tersinkron dari sejam lalu — cek koneksi internet kamu')).toHaveLength(0);
  });

  test('mixed: one stale pending, one fresh pending, each shows correct badge', async () => {
    mockHasPendingAction.mockImplementation((orderId: string) =>
      Promise.resolve(orderId === 'order-stale' || orderId === 'order-fresh'),
    );
    mockHasStalePendingAction.mockImplementation((orderId: string) =>
      Promise.resolve(orderId === 'order-stale'),
    );
    const myOrders = [makeOrder({ id: 'order-stale' }), makeOrder({ id: 'order-fresh' })];

    const { getByText } = render(
      <OrdersScreenBase database={mockDatabase as never} myOrders={myOrders as never} />,
    );

    await waitFor(() => {
      expect(mockHasStalePendingAction).toHaveBeenCalledWith('order-stale');
      expect(mockHasStalePendingAction).toHaveBeenCalledWith('order-fresh');
    });

    await waitFor(() => {
      expect(getByText('Belum tersinkron dari sejam lalu — cek koneksi internet kamu')).toBeTruthy();
    });
    await waitFor(() => {
      expect(getByText('Menunggu sinkronisasi')).toBeTruthy();
    });
  });
});

// Accept order online gating
describe('Accept order online gating', () => {
  const { networkMonitor } = require('../map/networkMonitor');

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset networkMonitor to online by default
    networkMonitor.getStatus.mockReturnValue('online');
    networkMonitor.subscribe.mockReturnValue(jest.fn());
    // Reset fetchAvailableOrders mock
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    // Reset pool query mock
    mockOrdersCollection.query = jest.fn().mockReturnValue({
      fetch: jest.fn().mockResolvedValue([]),
      fetchCount: jest.fn().mockResolvedValue(0),
      observe: jest.fn().mockReturnValue({
        subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
      }),
    });
  });

  test('shows alert and skips DB write when offline', async () => {
    // Override to offline
    networkMonitor.getStatus.mockReturnValue('offline');

    // Set up pool orders so the Accept button appears.
    // Must have WatermelonDB model methods: prepareDestroyPermanently for DELETE loop
    // in fetchPool (triggered when hasMore=false and serverIds is empty).
    const poolOrderMock = {
      ...makeOrder({ id: 'pool-order-1', status: 'ASSIGNED', driverId: null }),
      _raw: { id: 'pool-order-1', driver_id: null, _status: 'synced' },
      prepareDestroyPermanently: jest.fn().mockReturnValue({ _preparedState: 'destroy', _raw: { id: 'pool-order-1' } }),
    };
    mockOrdersCollection.query = jest.fn().mockReturnValue({
      fetch: jest.fn().mockResolvedValue([poolOrderMock]),
      fetchCount: jest.fn().mockResolvedValue(0),
      observe: jest.fn().mockReturnValue({
        subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
      }),
    });

    const { getByText } = render(
      <OrdersScreenBase database={mockDatabase as never} myOrders={[]} />,
    );

    // Wait for pool to load
    await waitFor(() => {
      expect(fetchAvailableOrders).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    // Verify networkMonitor returns offline
    expect(networkMonitor.getStatus()).toBe('offline');

    // Verify the button is disabled when offline
    const acceptButton = (getByText('Terima Order').parent as any)?.parent;
    expect(acceptButton?.props.disabled).toBe(true);

    // Reset mock write call count before testing guard behavior
    mockDatabase.write.mockClear();

    // Manually trigger handleAccept to test the guard (bypasses disabled prop)
    await acceptButton?.props.onPress();

    const Alert = require('react-native').Alert;
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Butuh Koneksi',
        'Terima order butuh koneksi internet biar nggak bentrok sama driver lain.',
      );
    });

    // DB write should NOT be called when guard triggers
    expect(mockDatabase.write).not.toHaveBeenCalled();
  });

  test('accepts order normally when online', async () => {
    // Already set to online in beforeEach

    // Set up pool orders so the Accept button appears.
    // Must have WatermelonDB model methods: prepareDestroyPermanently for DELETE loop.
    const poolOrderMock = {
      ...makeOrder({ id: 'pool-order-2', status: 'ASSIGNED', driverId: null }),
      _raw: { id: 'pool-order-2', driver_id: null, _status: 'synced' },
      prepareDestroyPermanently: jest.fn().mockReturnValue({ _preparedState: 'destroy', _raw: { id: 'pool-order-2' } }),
    };
    mockOrdersCollection.query = jest.fn().mockReturnValue({
      fetch: jest.fn().mockResolvedValue([poolOrderMock]),
      fetchCount: jest.fn().mockResolvedValue(0),
      observe: jest.fn().mockReturnValue({
        subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
      }),
    });
    mockOrdersCollection.find = jest.fn().mockResolvedValue({
      ...poolOrderMock,
      update: jest.fn(),
    });

    const { getByText } = render(
      <OrdersScreenBase database={mockDatabase as never} myOrders={[]} />,
    );

    // Wait for pool to load
    await waitFor(() => {
      expect(fetchAvailableOrders).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    // Verify networkMonitor returns online
    expect(networkMonitor.getStatus()).toBe('online');

    // Tap Accept button
    const acceptButton = (getByText('Terima Order').parent as any)?.parent;
    acceptButton?.props.onPress();

    const Alert = require('react-native').Alert;
    await waitFor(() => {
      // Alert should NOT be called when online
      expect(Alert.alert).not.toHaveBeenCalled();
    });

    // DB write should be called
    await waitFor(() => {
      expect(mockDatabase.write).toHaveBeenCalled();
    });
  });
});

// --- Ambil ulang pool saat socket tersambung lagi ---
// Server tidak mengirim ulang event yang terlewat selama socket putus, jadi
// order baru yang dibuat saat offline tidak muncul sendiri. OrdersScreen
// mendengar event 'connect' dari ordersSocket dan memanggil fetchPool() lagi
// supaya tab Tersedia berisi order terbaru setelah sambungan pulih.
describe('ambil ulang pool saat ordersSocket connect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Kosongkan daftar listener supaya tidak bocor antar tes
    while (mockOrdersSocketConnectListeners.length > 0) {
      mockOrdersSocketConnectListeners.pop();
    }
    mockOrdersSocketUnsubscribes.mockClear();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
  });

  test('event connect memanggil fetchPool (terlihat dari pemanggilan fetchAvailableOrders)', async () => {
    render(<OrdersScreenBase database={mockDatabase as never} myOrders={[]} />);

    // Tunggu sampai OrdersScreen mendaftarkan callback 'connect'
    await waitFor(() => {
      expect(mockOrdersSocketConnectListeners.length).toBeGreaterThan(0);
    });

    // Saat mount fetchAvailableOrders sudah dipanggil sekali. Kosongkan dulu
    // hitungannya supaya tes ini hanya mengukur efek event 'connect'.
    (fetchAvailableOrders as jest.Mock).mockClear();

    // Panggil callback yang didaftarkan lewat ordersSocket.on('connect', ...)
    mockOrdersSocketConnectListeners[0]();

    await waitFor(() => {
      expect(fetchAvailableOrders).toHaveBeenCalled();
    });
  });

  test('unmount memanggil unsubscribe untuk listener connect', async () => {
    const { unmount } = render(<OrdersScreenBase database={mockDatabase as never} myOrders={[]} />);

    // Tunggu sampai listener terdaftar dan unsubscribeRef terisi
    await waitFor(() => {
      expect(mockOrdersSocketConnectListeners.length).toBeGreaterThan(0);
    });

    // Sebelum unmount: unsubscribe belum dipanggil
    expect(mockOrdersSocketUnsubscribes).not.toHaveBeenCalled();

    unmount();

    // Setelah unmount: unsubscribe untuk listener connect terpanggil
    expect(mockOrdersSocketUnsubscribes).toHaveBeenCalled();
  });
});

// Terima order menulis data lengkap dari respons
// handleAccept harus menuliskan kolom order dari respons POST /orders/:id/accept
// (bukan cuma status, driver_id, server_version) supaya baris siap dipakai
// rute dan OrderDetail tanpa fetch ulang.
describe('Terima order menulis data lengkap dari respons', () => {
  const { networkMonitor } = require('../map/networkMonitor');
  const { GraphHopperRoutingProvider } = require('../map/routing');
  const { locationService } = require('../map/location');
  const { acceptOrder } = require('../sync/client');

  // Respons POST /orders/:id/accept yang lengkap, koordinat tujuan [lng, lat].
  // Nilai lng dan lat sengaja jauh berbeda supaya urutan tertukar ketahuan.
  const fullOrderResponse = {
    id: 'pool-accept-gps',
    customerId: 'customer-9',
    driverId: 'driver-AC21',
    status: 'PREPARING',
    items: [
      { id: 'item-1', productId: 'prod-1', name: 'Nasi Goreng', quantity: 2, unitPriceCents: 12500 },
    ],
    deliveryAddress: {
      recipientName: 'Citra',
      phone: '081234567890',
      street: 'Jl. Sudirman No. 1',
      city: 'Jakarta',
      postalCode: '10110',
      coordinates: [106.85, -6.2],
    },
    totalCents: 25000,
    currency: 'IDR',
    notes: 'Pedesin',
    createdAt: '2026-01-15T03:04:05.678Z',
    updatedAt: '2026-01-15T03:05:00.000Z',
    version: 4,
    cancelledBy: null,
    cancelReason: null,
  };

  // Buat mock baris pool dengan _getRaw, _setRaw, prepareUpdate yang bisa
  // diverifikasi. _setRaw merekam semua panggilan supaya tes bisa
  // memastikan kolom respons tertulis di _raw.
  function makeAcceptablePoolOrder(id: string, serverVersion: number) {
    const setRawCalls: Array<[string, unknown]> = [];
    const rowForUpdate = {
      _setRaw: jest.fn((key: string, value: unknown) => {
        setRawCalls.push([key, value]);
      }),
      _raw: { _status: '', _changed: 'sentinel' },
    };
    const order = {
      ...makeOrder({ id, status: 'ASSIGNED', driverId: null }),
      _raw: { id, driver_id: null, _status: 'synced' },
      _getRaw: jest.fn((key: string) => {
        if (key === 'server_version') return serverVersion;
        if (key === 'address_json') return null;
        return undefined;
      }),
      prepareUpdate: jest.fn((cb: (r: typeof rowForUpdate) => void) => {
        cb(rowForUpdate);
        return { _preparedState: 'update', _row: rowForUpdate };
      }),
      prepareDestroyPermanently: jest.fn().mockReturnValue({ _preparedState: 'destroy' }),
      __rowForUpdate: rowForUpdate,
      __setRawCalls: setRawCalls,
    };
    return order;
  }

  // Versi GraphHopperRoutingProvider yang dipakai layar, supaya kita bisa
  // inspeksi getRoute yang dipanggil.
  function getLastProviderGetRoute(): jest.Mock {
    const mocked = jest.mocked(GraphHopperRoutingProvider);
    const lastResult = mocked.mock.results[mocked.mock.results.length - 1];
    const instance = lastResult?.value;
    if (!instance) {
      throw new Error('GraphHopperRoutingProvider belum pernah dibuat');
    }
    return instance.getRoute;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    networkMonitor.getStatus.mockReturnValue('online');
    networkMonitor.subscribe.mockReturnValue(jest.fn());
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    mockOrdersCollection.query = jest.fn().mockReturnValue({
      fetch: jest.fn().mockResolvedValue([]),
      fetchCount: jest.fn().mockResolvedValue(0),
      observe: jest.fn().mockReturnValue({
        subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
      }),
    });
  });

  test('Terima sukses dengan GPS ada: baris berisi address_json, items_json, customer_id dari respons, getRoute dipanggil dengan asal = GPS dan tujuan = koordinat respons', async () => {
    // GPS tersedia lewat getLastKnown
    (locationService.getLastKnown as jest.Mock).mockResolvedValue({
      coords: { latitude: -6.175, longitude: 106.827 },
    });
    (acceptOrder as jest.Mock).mockResolvedValue(fullOrderResponse);

    const poolOrder = makeAcceptablePoolOrder('pool-accept-gps', 3);
    mockOrdersCollection.query = jest.fn().mockReturnValue({
      fetch: jest.fn().mockResolvedValue([poolOrder]),
      fetchCount: jest.fn().mockResolvedValue(0),
      observe: jest.fn().mockReturnValue({
        subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
      }),
    });

    const { getByText } = render(
      <OrdersScreenBase database={mockDatabase as never} myOrders={[]} />,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    const acceptButton = getByText('Terima Order').parent?.parent;
    await act(async () => {
      await acceptButton?.props.onPress();
    });

    // acceptOrder dipanggil dengan id dan version
    expect(acceptOrder).toHaveBeenCalledWith('pool-accept-gps', 3);

    // Kolom respons tertulis di _raw baris
    const calls: Array<[string, unknown]> = poolOrder.__setRawCalls;
    const find = (key: string) => calls.find(([k]) => k === key)?.[1];

    expect(find('status')).toBe('PREPARING');
    expect(find('driver_id')).toBe('driver-AC21');
    expect(find('server_version')).toBe(4);
    expect(find('customer_id')).toBe('customer-9');
    expect(find('total_cents')).toBe(25000);
    expect(find('currency')).toBe('IDR');
    expect(find('notes')).toBe('Pedesin');
    expect(find('cancelled_by')).toBeNull();
    expect(find('cancel_reason')).toBeNull();
    expect(find('updated_at')).toBe(Date.parse('2026-01-15T03:05:00.000Z'));

    // items_json dan address_json adalah string JSON hasil serialisasi
    const itemsJsonRaw = find('items_json');
    expect(typeof itemsJsonRaw).toBe('string');
    expect(JSON.parse(String(itemsJsonRaw))).toEqual(fullOrderResponse.items);

    const addressJsonRaw = find('address_json');
    expect(typeof addressJsonRaw).toBe('string');
    expect(JSON.parse(String(addressJsonRaw))).toEqual(fullOrderResponse.deliveryAddress);

    // created_at TIDAK diubah
    expect(calls.find(([k]) => k === 'created_at')).toBeUndefined();

    // _status 'synced' dan _changed ''
    expect(poolOrder.__rowForUpdate._raw._status).toBe('synced');
    expect(poolOrder.__rowForUpdate._raw._changed).toBe('');

    // getRoute dipanggil dengan asal = GPS dan tujuan = koordinat RESPONS
    // (bukan dari model baris yang masih pool)
    const providerGetRoute = getLastProviderGetRoute();
    expect(providerGetRoute).toHaveBeenCalledTimes(1);
    expect(providerGetRoute).toHaveBeenCalledWith({
      origin: { lng: 106.827, lat: -6.175 },
      destination: { lng: 106.85, lat: -6.2 },
    });
  });

  test('Terima sukses tanpa GPS: baris tetap lengkap, getRoute tidak dipanggil', async () => {
    // GPS tidak tersedia
    (locationService.getLastKnown as jest.Mock).mockResolvedValue(null);
    (locationService.subscribe as jest.Mock).mockResolvedValue(jest.fn());
    (acceptOrder as jest.Mock).mockResolvedValue(fullOrderResponse);

    const poolOrder = makeAcceptablePoolOrder('pool-accept-no-gps', 3);
    mockOrdersCollection.query = jest.fn().mockReturnValue({
      fetch: jest.fn().mockResolvedValue([poolOrder]),
      fetchCount: jest.fn().mockResolvedValue(0),
      observe: jest.fn().mockReturnValue({
        subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
      }),
    });

    const { getByText } = render(
      <OrdersScreenBase database={mockDatabase as never} myOrders={[]} />,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    const acceptButton = getByText('Terima Order').parent?.parent;
    await act(async () => {
      await acceptButton?.props.onPress();
    });

    // Kolom tetap lengkap meski tanpa GPS
    const calls: Array<[string, unknown]> = poolOrder.__setRawCalls;
    const find = (key: string) => calls.find(([k]) => k === key)?.[1];
    expect(find('status')).toBe('PREPARING');
    expect(find('customer_id')).toBe('customer-9');
    const addressJsonRaw = find('address_json');
    expect(typeof addressJsonRaw).toBe('string');
    expect(JSON.parse(String(addressJsonRaw))).toEqual(fullOrderResponse.deliveryAddress);

    // getRoute TIDAK dipanggil karena tidak ada GPS
    const providerGetRoute = getLastProviderGetRoute();
    expect(providerGetRoute).not.toHaveBeenCalled();
  });
});
