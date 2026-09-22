/**
 * Smoke test untuk OrdersScreen — verify component mounts without errors.
 *
 * Full render test dengan async HOC chain (getCurrentUserId → withObservables →
 * fetchPool) sulit diisolasi di Jest tanpa integration setup yang kompleks.
 * Test ini cukup memastikan component tidak throw saat mount dengan mock data.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

// ─── Mock @nozbe/watermelondb/react SEBELUM import component ──────────────
jest.mock('@nozbe/watermelondb/react', () => ({
  withDatabase: (C: any) => C,
  withObservables: (_trigger: any, _getObs: any) => (C: any) => C,
}));

// ─── Mock Alert ────────────────────────────────────────────────────────────────
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

// ─── Mock Config ───────────────────────────────────────────────────────────────
jest.mock('react-native-config', () => ({
  default: { API_BASE_URL: 'http://localhost:3000' },
}));

// ─── Mock session ────────────────────────────────────────────────────────────
jest.mock('../sync/session', () => ({
  getCurrentUserId: () => Promise.resolve('driver-123'),
}));

// ─── Mock API client ─────────────────────────────────────────────────────────
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
  };
});

// ─── Mock ordersSocket ────────────────────────────────────────────────────────
jest.mock('../sync/ordersSocket', () => ({
  ordersSocket: {
    onOrderAvailable: jest.fn().mockReturnValue(jest.fn()),
    onOrderUnavailable: jest.fn().mockReturnValue(jest.fn()),
    on: jest.fn().mockReturnValue(jest.fn()),
  },
}));

// ─── Mock navigation ───────────────────────────────────────────────────────
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: { children: React.ReactNode }) => children,
  useNavigation: () => ({
    navigate: jest.fn(),
  }),
}));

// ─── Mock routing provider untuk route pre-compute ───────────────────────────
jest.mock('../map/routing', () => ({
  GraphHopperRoutingProvider: jest.fn().mockImplementation(() => ({
    getRoute: jest.fn().mockResolvedValue({ distance: 1000, duration: 300 }),
  })),
}));

// ─── Mock location service ────────────────────────────────────────────────────
jest.mock('../map/location', () => ({
  locationService: {
    getLastKnown: jest.fn().mockResolvedValue(null),
    subscribe: jest.fn().mockResolvedValue(jest.fn()),
  },
}));

// ─── Mock network monitor ─────────────────────────────────────────────────────
jest.mock('../map/networkMonitor', () => ({
  networkMonitor: {
    getStatus: jest.fn().mockReturnValue('online'),
    subscribe: jest.fn().mockReturnValue(jest.fn()),
  },
}));

// ─── Mock sync coordinator ─────────────────────────────────────────────────
jest.mock('../sync', () => ({
  syncCoordinator: {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn(),
    flushNow: jest.fn().mockResolvedValue(null),
    pullNow: jest.fn().mockResolvedValue(null),
  },
}));

// ─── Mock outbox ──────────────────────────────────────────────────────────────
const mockHasPendingAction = jest.fn();
const mockHasStalePendingAction = jest.fn();
jest.mock('../sync/outbox', () => ({
  __esModule: true,
  hasPendingAction: (...args: unknown[]) => mockHasPendingAction(...args),
  hasStalePendingAction: (...args: unknown[]) => mockHasStalePendingAction(...args),
}));

// ─── Mock WatermelonDB ──────────────────────────────────────────────────────
const mockOrdersCollection = {
  query: jest.fn().mockReturnValue({
    fetch: jest.fn().mockResolvedValue([]),
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

// ─── Import after mocks ───────────────────────────────────────────────────────
import { OrdersScreen, OrdersScreenBase } from './OrdersScreen';
import { fetchAvailableOrders } from '../sync/client';

// Plain-object order stand-ins for OrdersScreenBase's myOrders prop — the
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
      // Render synchronously — async HOC chain causes loading state but doesn't throw
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
    // Old buggy pattern: create() with _raw.id override — causes corrupt rows.
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
    // Edge case: all items have null orderId — should not crash
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

// ─── Pending action badge (Fase 2 outbox wiring) ───────────────────────────
//
// Rendered via OrdersScreenBase directly (bypassing the withDatabase/
// withObservables-wrapped OrdersScreen export) because the
// '@nozbe/watermelondb/react' mock above treats withObservables as an
// identity HOC that never actually computes myOrders — so myOrders is
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
    // myOrders — renderItem gates the badge on section.title === 'Order
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

// ─── Stale pending action badge ───────────────────────────────────────────────
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

// ─── Accept order online gating ──────────────────────────────────────────────
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
