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
jest.mock('../sync/client', () => ({
  fetchAvailableOrders: jest.fn().mockResolvedValue([]),
}));

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
const mockHasPendingAction = jest.fn().mockResolvedValue(false);
jest.mock('../sync/outbox', () => ({
  __esModule: true,
  hasPendingAction: (...args: unknown[]) => mockHasPendingAction(...args),
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
import { OrdersScreen } from './OrdersScreen';
import { fetchAvailableOrders } from '../sync/client';

describe('OrdersScreen smoke test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock to return empty by default
    (fetchAvailableOrders as jest.Mock).mockResolvedValue([]);
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
      { orderId: 'order-custom-1', totalCents: 25000, currency: 'IDR', itemsCount: 2, createdAt: '2024-01-01T00:00:00Z' },
    ];
    (fetchAvailableOrders as jest.Mock).mockResolvedValue(poolItems);

    render(<OrdersScreen database={mockDatabase as never} />);

    await waitFor(() => {
      expect(fetchAvailableOrders).toHaveBeenCalled();
    });

    // Verify prepareCreateFromDirtyRaw was called (NOT the old create() pattern)
    expect(mockOrdersCollection.prepareCreateFromDirtyRaw).toHaveBeenCalledTimes(1);

    // Verify batch was called to persist the prepared record
    expect(mockBatch).toHaveBeenCalledTimes(1);

    // Verify the custom ID was passed correctly
    expect(mockOrdersCollection.prepareCreateFromDirtyRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'order-custom-1',
        _status: 'synced',
        status: 'ASSIGNED',
        totalCents: 25000,
        currency: 'IDR',
        customerId: '',
        driverId: null,
      }),
    );

    // Old create() pattern should NOT be called
    expect(mockOrdersCollection.create).not.toHaveBeenCalled();
  });

  test('fetchPool skips items with null/undefined orderId without throwing', async () => {
    // Regression test: backend returning null orderId previously caused
    // "Cannot read property 'id' of null" TypeError from WatermelonDB find(null)
    const poolItemsWithNullOrderId = [
      { orderId: null, totalCents: 25000, currency: 'IDR', itemsCount: 2, createdAt: '2024-01-01T00:00:00Z' },
      { orderId: 'order-valid', totalCents: 30000, currency: 'IDR', itemsCount: 1, createdAt: '2024-01-01T00:00:00Z' },
      { orderId: undefined, totalCents: 35000, currency: 'IDR', itemsCount: 3, createdAt: '2024-01-01T00:00:00Z' },
    ];
    (fetchAvailableOrders as jest.Mock).mockResolvedValue(poolItemsWithNullOrderId);

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
      { orderId: null, totalCents: 25000, currency: 'IDR', itemsCount: 2, createdAt: '2024-01-01T00:00:00Z' },
      { orderId: undefined, totalCents: 30000, currency: 'IDR', itemsCount: 1, createdAt: '2024-01-01T00:00:00Z' },
    ];
    (fetchAvailableOrders as jest.Mock).mockResolvedValue(allNullOrderId);

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
      { orderId: customOrderId, totalCents: 50000, currency: 'IDR', itemsCount: 1, city: 'Jakarta', createdAt: '2026-07-23T04:15:57.745Z' },
    ];
    (fetchAvailableOrders as jest.Mock).mockResolvedValue(poolItems);

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
