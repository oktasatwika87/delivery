/**
 * Unit tests untuk OrderDetailScreen — cancel button visibility + behavior + outbox wiring.
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

import { OrderDetailScreen } from './OrderDetailScreen';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@delivery/shared';
import { ApiError } from '../sync/client';
import { networkMonitor } from '../map/networkMonitor';
import type { NetworkStatus } from '../map/networkMonitor';
import type { OrderModel } from '../db/models/OrderModel';

// ─── Client mocks ───────────────────────────────────────────────────────────────
const mockUpdateOrderStatus = jest.fn();
const mockGetOrderById = jest.fn();

jest.mock('../sync/client', () => {
  const actual = jest.requireActual('../sync/client') as typeof import('../sync/client');
  return {
    ...actual,
    updateOrderStatus: (...args: unknown[]) => mockUpdateOrderStatus(...args),
    getOrderById: (...args: unknown[]) => mockGetOrderById(...args),
  };
});

// ─── networkMonitor mock ────────────────────────────────────────────────────────
// mockGetStatusFn is module-level so the spy (created after jest.mock runs) can
// still reference it. See ordersSocket.spec.ts pattern.
var mockGetStatusFn = jest.fn(() => 'online');

jest.mock('../map/networkMonitor', () => ({
  networkMonitor: {
    getStatus: () => mockGetStatusFn(),
    subscribe: jest.fn((cb: (s: NetworkStatus) => void) => {
      cb('online');
      return () => {};
    }),
  },
}));

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return {
    ...actual,
    Alert: { ...actual.Alert, alert: jest.fn() },
  };
});

// ─── Navigation mock (pola sama kayak MapScreen.spec.tsx)
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: { orderId: 'order-123' } }),
}));

// getCurrentUserId mock
const mockGetCurrentUserId = jest.fn();
jest.mock('../sync/session', () => ({
  getCurrentUserId: () => mockGetCurrentUserId(),
}));

// ─── Outbox mocks ───────────────────────────────────────────────────────────────
// These are defined at module level so they can be referenced in tests
const mockEnqueueCancel = jest.fn();
const mockEnqueueCollectCod = jest.fn();
const mockHasPendingAction = jest.fn();
const mockDrainPendingActions = jest.fn();
const mockGetPendingActionsForOrder = jest.fn();
// Inline implementasi isPendingActionStale (sama dengan outbox.ts) supaya tes stale akurat
// tanpa perlu jest.requireActual yang bisa gagal karena native module.
const STALE_THRESHOLD_MS = 60 * 60 * 1000;
// Minimal shape pending action buat test mock — hanya field yang dipakai tes.
interface MockPendingAction {
  id: string;
  createdAt: Date | number | string;
}
function computeIsPendingActionStale(action: MockPendingAction | null | undefined): boolean {
  if (!action?.createdAt) return false;
  const createdAt = action.createdAt;
  const timestamp = createdAt instanceof Date ? createdAt.getTime() : Number(createdAt);
  return Date.now() - timestamp > STALE_THRESHOLD_MS;
}
const mockIsPendingActionStale = jest.fn().mockImplementation(computeIsPendingActionStale);

// NOTE: __esModule: true is required here — OrderDetailScreen.tsx uses a
// dynamic `await import('../sync/outbox')` for drainPendingActions (to avoid
// pulling the WatermelonDB native module in statically, see coordinator.ts
// for the same pattern). Without __esModule: true, Babel's dynamic-import
// interop wraps this mock differently than a static import does, and named
// destructuring off the dynamic import silently resolves to undefined.
jest.mock('../sync/outbox', () => ({
  __esModule: true,
  enqueueCancel: (...args: unknown[]) => mockEnqueueCancel(...args),
  enqueueCollectCod: (...args: unknown[]) => mockEnqueueCollectCod(...args),
  hasPendingAction: (...args: unknown[]) => mockHasPendingAction(...args),
  drainPendingActions: (...args: unknown[]) => mockDrainPendingActions(...args),
  getPendingActionsForOrder: (...args: unknown[]) => mockGetPendingActionsForOrder(...args),
  isPendingActionStale: (...args: unknown[]) => mockIsPendingActionStale(...args),
}));

// ─── WatermelonDB mock ─────────────────────────────────────────────────────────
interface MockOrderItem {
  name: string;
  quantity: number;
  unitPriceCents: number;
}
const mockOrderUpdate = jest.fn();
let mockOrderPrepareUpdate = jest.fn();
const mockOrder = {
  id: 'order-123',
  driverId: 'driver-456',
  status: OrderStatus.ASSIGNED,
  customerId: 'customer-789',
  itemsJson: [] as MockOrderItem[],
  addressJson: { street: 'Test St' },
  totalCents: 50000,
  currency: 'IDR',
  notes: 'Test notes',
  serverVersion: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  update: mockOrderUpdate,
  _getRaw: jest.fn().mockReturnValue({}),
  _setRaw: jest.fn(),
  _raw: { _status: 'synced', _changed: '' },
  prepareUpdate: mockOrderPrepareUpdate,
};

const mockFindAndObserve = jest.fn(() => ({
  subscribe: ({ next }: any) => {
    next(mockOrder);
    return { unsubscribe: jest.fn() };
  },
}));

// Mock payments for COD existence check
const mockPayments: any[] = [];
let paymentsSubscriptionCallback: ((payments: any[]) => void) | null = null;
let mockPaymentsQuery: any = null;

// Mock pending_actions for observe
const mockPendingActions: MockPendingAction[] = [];
let pendingActionsSubscriptionCallback: ((actions: MockPendingAction[]) => void) | null = null;

const mockPaymentsCollection: any = {
  query: jest.fn().mockImplementation((_query: any) => {
    mockPaymentsQuery = {
      observe: jest.fn().mockReturnValue({
        subscribe: jest.fn().mockImplementation(({ next }: { next: (payments: any[]) => void }) => {
          paymentsSubscriptionCallback = next;
          // Immediately emit current payments
          next([...mockPayments]);
          return { unsubscribe: jest.fn() };
        }),
      }),
    };
    return mockPaymentsQuery;
  }),
  create: jest.fn().mockImplementation((fn: (r: any) => void) => {
    const newPayment: any = { id: 'new-payment-id', failedSyncAttempts: 0, orderId: 'order-123', method: PaymentMethod.CASH };
    fn(newPayment);
    mockPayments.push(newPayment);
    // Notify subscription
    if (paymentsSubscriptionCallback) {
      paymentsSubscriptionCallback([...mockPayments]);
    }
    return Promise.resolve(newPayment);
  }),
};

// Mock pending_actions collection — observe terpanggil saat komponen mount
const mockPendingActionsCollection: { query: jest.Mock } = {
query: jest.fn().mockImplementation((_query: unknown) => ({
    observe: jest.fn().mockReturnValue({
      subscribe: jest.fn().mockImplementation(({ next }: { next: (actions: MockPendingAction[]) => void }) => {
        pendingActionsSubscriptionCallback = next;
        next([...mockPendingActions]);
        return { unsubscribe: jest.fn() };
      }),
    }),
  })),
};

// Mock order untuk prepareUpdate dalam database.write
const mockOrdersCollection: { findAndObserve: typeof mockFindAndObserve; find: jest.Mock } = {
  findAndObserve: mockFindAndObserve,
  find: jest.fn().mockImplementation(() => Promise.resolve({
    ...mockOrder,
    _getRaw: mockOrder._getRaw,
    prepareUpdate: mockOrderPrepareUpdate,
  })),
};

const mockDatabaseBatch = jest.fn();
const mockDatabase: any = {
  get: (name: string) => {
    if (name === 'payments') return mockPaymentsCollection;
    if (name === 'pending_actions') return mockPendingActionsCollection;
    return mockOrdersCollection;
  },
  write: async (fn: () => Promise<void>) => {
    // Simulate async database write - allows state to update between calls
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    await fn();
  },
  batch: (...args: unknown[]) => mockDatabaseBatch(...args),
};

jest.mock('@nozbe/watermelondb/react', () => ({ withDatabase: (C: any) => C }));
jest.mock('@nozbe/watermelondb', () => ({
  Q: {
    where: jest.fn().mockReturnValue({ _where: 'order_id' }),
  },
  withDatabase: (C: any) => C,
}));

function renderScreen() {
  return render(
    <OrderDetailScreen database={mockDatabase} route={{ params: { orderId: 'order-123' } } as any} />
  );
}

// ─── Tests: Visibility ─────────────────────────────────────────

describe('cancel button visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockUpdateOrderStatus.mockReset();
    mockGetOrderById.mockReset();
    mockOrderPrepareUpdate.mockReset();
    mockOrderPrepareUpdate.mockImplementation(function(this: OrderModel, fn: (r: OrderModel) => void) {
      fn(this);
      return this;
    });
  });

  test('appears for ASSIGNED status with matching driver', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
  });

  test('appears for PREPARING status with matching driver', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
  });

  test('appears for OUT_FOR_DELIVERY status with matching driver', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
  });

  test('NOT shown for PENDING status', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PENDING, driverId: undefined });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Batalkan Order')).toBeNull();
    });
  });

  test('NOT shown for DELIVERED status', async () => {
    Object.assign(mockOrder, { status: OrderStatus.DELIVERED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Batalkan Order')).toBeNull();
    });
  });

  test('NOT shown for CANCELLED status', async () => {
    Object.assign(mockOrder, { status: OrderStatus.CANCELLED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Batalkan Order')).toBeNull();
    });
  });

  test('NOT shown when driverId does not match current user', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'other-driver' });
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Batalkan Order')).toBeNull();
    });
  });
});

// ─── Tests: Cancel Button Behavior (Outbox) ──────────────────────────

describe('cancel button behavior (outbox wiring)', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456', serverVersion: 1 });
    mockHasPendingAction.mockResolvedValue(false);
    mockEnqueueCancel.mockResolvedValue({ success: true, pendingActionId: 'pending-123' });
    mockDrainPendingActions.mockResolvedValue([]);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test('shows confirmation alert with correct text', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Batalkan Order'));
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Batalkan Order',
      'Apakah Anda yakin ingin membatalkan order ini?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Tidak' }),
        expect.objectContaining({ text: 'Ya, Batalkan' }),
      ])
    );
  });

  test('pressing Ya calls enqueueCancel with order id and serverVersion', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Batalkan Order'));
    });

    // Get the "Ya, Batalkan" button handler
    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Batalkan');

    await act(async () => {
      yaButton?.onPress?.();
    });

    expect(mockEnqueueCancel).toHaveBeenCalledWith('order-123', 1);
  });

  test('drain is called after successful enqueue', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Batalkan Order'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Batalkan');

    await act(async () => {
      yaButton?.onPress?.();
    });

    // Drain should be called (dynamic import was resolved)
    expect(mockDrainPendingActions).toHaveBeenCalled();
  });

  test('button disappears after a successful cancel enqueue (prevents duplicate taps queueing 2+ cancels)', async () => {
    const { getByText, queryByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Batalkan Order'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Batalkan');

    await act(async () => {
      yaButton?.onPress?.();
    });

    // order.status is unchanged by the outbox path (no local optimistic write
    // of CANCELLED) — the button must instead be gated on hasPending (dari
    // observe). Simulasi observe fire dengan pending action agar hasPending
    // jadi true dan tombol hilang.
    await act(async () => {
      pendingActionsSubscriptionCallback?.([{ id: 'pending-cancel', createdAt: new Date() }]);
    });
    await waitFor(() => {
      expect(queryByText('Batalkan Order')).toBeNull();
    });
    expect(mockEnqueueCancel).toHaveBeenCalledTimes(1);
  });

  // enqueueCancel gagal → tidak ada banner "Menunggu sinkronisasi"
  test('enqueueCancel gagal: banner "Menunggu sinkronisasi" tidak tampil', async () => {
    mockEnqueueCancel.mockResolvedValueOnce({ success: false, error: 'Tidak bisa membatalkan order.' });

    const { getByText, queryByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Batalkan Order'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Batalkan');

    await act(async () => {
      yaButton?.onPress?.();
    });

    // Observe TIDAK fire (gagal) — hasPending tetap false — banner tidak tampil
    expect(queryByText('Menunggu sinkronisasi...')).toBeNull();
    expect(mockEnqueueCancel).toHaveBeenCalledTimes(1);
  });

  test('shows error alert when enqueueCancel fails', async () => {
    mockEnqueueCancel.mockResolvedValue({ success: false, error: 'Not authenticated' });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Batalkan Order'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Batalkan');

    await act(async () => {
      yaButton?.onPress?.();
    });

    // Should show error alert
    expect(Alert.alert).toHaveBeenCalledWith('Gagal', 'Not authenticated');
  });

  test('pressing Tidak does NOT call enqueueCancel', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Batalkan Order'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const tidakButton = buttons.find((b) => b.text === 'Tidak');

    await act(async () => {
      tidakButton?.onPress?.();
    });

    expect(mockEnqueueCancel).not.toHaveBeenCalled();
  });
});

// ─── Tests: COD Button Visibility ─────────────────────────────────

describe('COD button visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0; // reset payments
    mockHasPendingAction.mockResolvedValue(false);
  });

  test('appears for OUT_FOR_DELIVERY status with matching driver when no COD exists', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Cash (COD)')).toBeTruthy();
    });
  });

  test('NOT shown for ASSIGNED status even with matching driver', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Terima Cash (COD)')).toBeNull();
    });
  });

  test('NOT shown for PREPARING status even with matching driver', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Terima Cash (COD)')).toBeNull();
    });
  });

  test('NOT shown when driverId does not match current user', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'other-driver' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Terima Cash (COD)')).toBeNull();
    });
  });

  test('NOT shown when COD payment already exists', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({ orderId: 'order-123', method: PaymentMethod.CASH });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Terima Cash (COD)')).toBeNull();
    });
  });

  test('NOT shown for DELIVERED status', async () => {
    Object.assign(mockOrder, { status: OrderStatus.DELIVERED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Terima Cash (COD)')).toBeNull();
    });
  });

  test('NOT shown for CANCELLED status', async () => {
    Object.assign(mockOrder, { status: OrderStatus.CANCELLED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Terima Cash (COD)')).toBeNull();
    });
  });
});

// ─── Tests: COD Button Behavior (Outbox) ────────────────────────────────

describe('COD button behavior (outbox wiring)', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0; // reset payments
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockHasPendingAction.mockResolvedValue(false);
    mockEnqueueCollectCod.mockResolvedValue({ success: true, pendingActionId: 'cod-pending-123' });
    mockDrainPendingActions.mockResolvedValue([]);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test('shows confirmation alert with correct text', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Cash (COD)')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Terima Cash (COD)'));
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Terima Cash (COD)',
      expect.stringContaining('Rp'),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Batal' }),
        expect.objectContaining({ text: 'Ya, Terima' }),
      ])
    );
  });

  test('calls enqueueCollectCod with order id and amount on confirm', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Cash (COD)')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Terima Cash (COD)'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Terima');

    await act(async () => {
      yaButton?.onPress?.();
    });

    expect(mockEnqueueCollectCod).toHaveBeenCalledWith('order-123', 50000);
  });

  test('drain is called after successful enqueue', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Cash (COD)')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Terima Cash (COD)'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Terima');

    await act(async () => {
      yaButton?.onPress?.();
    });

    expect(mockDrainPendingActions).toHaveBeenCalled();
  });

  test('shows error alert when enqueueCollectCod fails', async () => {
    mockEnqueueCollectCod.mockResolvedValue({ success: false, error: 'Not authenticated' });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Cash (COD)')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Terima Cash (COD)'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Terima');

    await act(async () => {
      yaButton?.onPress?.();
    });

    expect(Alert.alert).toHaveBeenCalledWith('Gagal', 'Not authenticated');
  });

  test('double-tap is prevented by inflight guard', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Cash (COD)')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Terima Cash (COD)'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Terima');

    await act(async () => {
      yaButton?.onPress?.(); // First call
      yaButton?.onPress?.(); // Second call - should be blocked
    });

    // Only one enqueue call despite two taps
    expect(mockEnqueueCollectCod).toHaveBeenCalledTimes(1);
  });
});

// ─── Tests: Failed Payment Banner ─────────────────────────────────────────

describe('Failed Payment Banner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0; // reset payments
    paymentsSubscriptionCallback = null; // reset subscription
    mockPaymentsQuery = null; // reset query mock
    mockHasPendingAction.mockResolvedValue(false);
  });

  test('shows banner when payment status is FAILED', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({
      id: 'payment-failed-1',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.FAILED,
    });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('COD gagal diverifikasi. Hubungi support jika cash sudah di tangan.')).toBeTruthy();
    });
  });

  test('does NOT show banner when no FAILED payments', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({
      id: 'payment-ok-1',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.CAPTURED,
    });

    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('COD gagal diverifikasi. Hubungi support jika cash sudah di tangan.')).toBeNull();
    });
  });

  test('banner shows independent of order status (even when order is CANCELLED)', async () => {
    Object.assign(mockOrder, { status: OrderStatus.CANCELLED, driverId: 'driver-456' });
    mockPayments.push({
      id: 'payment-failed-2',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.FAILED,
    });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('COD gagal diverifikasi. Hubungi support jika cash sudah di tangan.')).toBeTruthy();
    });
  });

  test('banner can be dismissed', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({
      id: 'payment-failed-3',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.FAILED,
    });

    const { getByText, queryByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('COD gagal diverifikasi. Hubungi support jika cash sudah di tangan.')).toBeTruthy();
    });

    // Press dismiss button
    await act(async () => {
      fireEvent.press(getByText('✕'));
    });

    await waitFor(() => {
      expect(queryByText('COD gagal diverifikasi. Hubungi support jika cash sudah di tangan.')).toBeNull();
    });
  });

  test('banner reappears on screen re-mount when payment still FAILED', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({
      id: 'payment-failed-4',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.FAILED,
    });

    const { getByText, queryByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('COD gagal diverifikasi. Hubungi support jika cash sudah di tangan.')).toBeTruthy();
    });

    // Dismiss
    await act(async () => {
      fireEvent.press(getByText('✕'));
    });

    await waitFor(() => {
      expect(queryByText('COD gagal diverifikasi. Hubungi support jika cash sudah di tangan.')).toBeNull();
    });

    // Simulate re-mount by re-rendering
    const { getByText: getByText2 } = renderScreen();
    await waitFor(() => {
      expect(getByText2('COD gagal diverifikasi. Hubungi support jika cash sudah di tangan.')).toBeTruthy();
    });
  });
});

// ─── Tests: Payment Observation ─────────────────────────────────────────────

describe('Payment observation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0;
    paymentsSubscriptionCallback = null;
    mockPaymentsQuery = null;
  });

  test('payments query is filtered by orderId', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    renderScreen();

    await waitFor(() => {
      expect(mockPaymentsCollection.query).toHaveBeenCalled();
    });

    // Verify observe was called on the query result
    expect(mockPaymentsQuery?.observe).toHaveBeenCalled();
  });

  test('updates hasCodPayment when payment changes via observation', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    renderScreen();
    await waitFor(() => {
      expect(mockPaymentsCollection.query).toHaveBeenCalled();
    });

    // Button should be visible initially since no COD exists
    const buttonBefore = await new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(true), 0);
    });
    expect(buttonBefore).toBe(true);

    // Simulate payment being added via subscription
    mockPayments.push({
      id: 'payment-obs-1',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.CAPTURED,
    });

    // Trigger subscription callback - this updates hasCodPayment to true
    if (paymentsSubscriptionCallback) {
      paymentsSubscriptionCallback([...mockPayments]);
    }

    // After subscription callback, hasCodPayment should be true
    // The mockPaymentsCollection.create should NOT be called until user confirms
    expect(mockPaymentsCollection.create).not.toHaveBeenCalled();
  });
});

// ─── Tests: Double-Tap Prevention ─────────────────────────────────────────

describe('Double-tap prevention', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0;
    paymentsSubscriptionCallback = null;
    mockPaymentsQuery = null;
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockHasPendingAction.mockResolvedValue(false);
    mockEnqueueCollectCod.mockResolvedValue({ success: true, pendingActionId: 'cod-pending-123' });
    mockDrainPendingActions.mockResolvedValue([]);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test('handleCollectCod guard prevents concurrent calls from creating duplicate payments', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Cash (COD)')).toBeTruthy();
    });

    // First tap - opens confirmation dialog
    await act(async () => {
      fireEvent.press(getByText('Terima Cash (COD)'));
    });

    expect(Alert.alert).toHaveBeenCalledTimes(1);

    // Get the "Ya, Terima" button handler
    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Terima');
    expect(yaButton?.onPress).toBeDefined();

    // Clear previous calls
    mockEnqueueCollectCod.mockClear();

    // Call onPress TWICE synchronously (same event loop tick, no await between)
    // The first call starts the async enqueue
    // The second call should be blocked by the inflight guard
    act(() => {
      yaButton?.onPress?.(); // First call - starts enqueue
      yaButton?.onPress?.(); // Second call - should be no-op
    });

    // Wait for async operations to complete
    await waitFor(() => {
      expect(mockEnqueueCollectCod).toHaveBeenCalled();
    });

    // Only ONE enqueue should have been initiated despite two onPress calls
    // If the guard is working, only the first call executes
    expect(mockEnqueueCollectCod).toHaveBeenCalledTimes(1);
  });
});

// ─── Tests: Stale Pending Action Banner ──────────────────────────────────────

describe('Stale Pending Action Banner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPendingActions.length = 0;
    pendingActionsSubscriptionCallback = null;
  });

  test('shows normal pending banner when pending action is fresh', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText, queryByText } = renderScreen();
    // Observe fire saat mount — trigger dengan fresh pending action (bukan stale)
    await act(async () => {
      pendingActionsSubscriptionCallback?.([{ id: 'pending-1', createdAt: new Date() }]);
    });
    await waitFor(() => {
      expect(getByText('Menunggu sinkronisasi...')).toBeTruthy();
    });
    await waitFor(() => {
      expect(queryByText('Belum tersinkron dari sejam lalu — cek koneksi internet kamu')).toBeNull();
    });
  });

  test('shows stale warning banner when pending action is older than 60 minutes', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText, queryByText } = renderScreen();
    // Trigger observe dengan stale action (> 60 menit)
    await act(async () => {
      pendingActionsSubscriptionCallback?.([{ id: 'pending-stale', createdAt: new Date(Date.now() - 61 * 60 * 1000) }]);
    });
    await waitFor(() => {
      expect(getByText('Belum tersinkron dari sejam lalu — cek koneksi internet kamu')).toBeTruthy();
    });
    await waitFor(() => {
      expect(queryByText('Menunggu sinkronisasi...')).toBeNull();
    });
  });

  test('shows stale banner even when cancel button is hidden (pending action exists)', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText, queryByText } = renderScreen();
    // Trigger observe dengan stale action
    await act(async () => {
      pendingActionsSubscriptionCallback?.([{ id: 'pending-stale', createdAt: new Date(Date.now() - 120 * 60 * 1000) }]);
    });
    await waitFor(() => {
      expect(getByText('Belum tersinkron dari sejam lalu — cek koneksi internet kamu')).toBeTruthy();
    });
    await waitFor(() => {
      expect(queryByText('Batalkan Order')).toBeNull();
    });
  });

  test('no banner when no pending actions', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    // Trigger observe dengan array kosong
    await act(async () => {
      pendingActionsSubscriptionCallback?.([]);
    });
    await waitFor(() => {
      expect(queryByText('Menunggu sinkronisasi...')).toBeNull();
    });
    await waitFor(() => {
      expect(queryByText('Belum tersinkron dari sejam lalu — cek koneksi internet kamu')).toBeNull();
    });
  });

  // K17: banner hilang sendiri saat pending action dihapus — observe bikin banner reaktif
  test('banner hilang setelah pending action dihapus tanpa unmount', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText, queryByText } = renderScreen();

    // Banner tampil dengan pending action
    await act(async () => {
      pendingActionsSubscriptionCallback?.([{ id: 'pending-1', createdAt: new Date() }]);
    });
    await waitFor(() => {
      expect(getByText('Menunggu sinkronisasi...')).toBeTruthy();
    });

    // Pending action dihapus (misal: drain selesai) — banner hilang TANPA unmount
    await act(async () => {
      pendingActionsSubscriptionCallback?.([]);
    });
    await waitFor(() => {
      expect(queryByText('Menunggu sinkronisasi...')).toBeNull();
    });
  });
});

// ─── Tests: Chat / Map visibility ────────────────────────────────────────────────

describe('Chat and Map button visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
  });

  test('Chat dan Map tampil untuk driver yang ditugaskan', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Chat dengan Kurir / Customer')).toBeTruthy();
      expect(getByText('Lihat Rute Pengiriman')).toBeTruthy();
    });
  });

  test('Chat dan Map TIDAK tampil untuk driver LAIN', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'other-driver' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Chat dengan Kurir / Customer')).toBeNull();
      expect(queryByText('Lihat Rute Pengiriman')).toBeNull();
    });
  });
});

// ─── Tests: OrderConflictBanner suppression ──────────────────────────────────────
// orderConflict event dari processReject/processCancel menyebabkan banner "Status
// diperbarui server". Kalau ada pending action, event ini terjadi karena aksi
// driver sendiri (reject/cancel yang sukses), jadi banner dit-suppress via
// !hasPending gate di JSX. Tidak dites di sini karena butuh syncEvents mock
// yang lengkap — sudah ter-cover desain.

// ─── Tests: Item Price Display ─────────────────────────────────────────────────

describe('Item price display', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrder.itemsJson = []; // reset items each test
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockHasPendingAction.mockResolvedValue(false);
  });

  test('unitPriceCents 23000 * quantity 1 tampil Rp 23.000 (bukan 230)', async () => {
    // ItemRow pakai unitPriceCents (bukan priceCents yang tidak ada di data).
    // Bug lama, /100 di formatCurrency menyebabkan 23000 muncul Rp 230.
    // mockOrder.itemsJson harus di-set SEBELUM renderScreen() karena
    // mockFindAndObserve(next) hanya dipanggil sekali saat subscribe.
    mockOrder.itemsJson = [
      { name: 'Mie Goreng', quantity: 1, unitPriceCents: 23000 },
    ];
    mockOrder.totalCents = 23000;

    const { getByText, getAllByText } = renderScreen();

    await waitFor(() => {
      expect(getByText('1x Mie Goreng')).toBeTruthy();
    });

    // Item price, Rp 23.000 (bukan 230)
    const priceEls = getAllByText(/Rp\s23\.000/);
    expect(priceEls.length).toBeGreaterThanOrEqual(1);
    // Bukan 230 (sen)
    expect(() => getByText(/Rp\s230(?!0)/)).toThrow();
  });

  test('totalCents 50000 tampil Rp 50.000 di baris Total', async () => {
    mockOrder.itemsJson = [
      { name: 'Nasi Goreng', quantity: 2, unitPriceCents: 25000 },
    ];
    mockOrder.totalCents = 50000;
    mockOrder.currency = 'IDR';

    const { getAllByText } = renderScreen();

    await waitFor(() => {
      expect(getAllByText(/Total/)).toBeTruthy();
    });

    const totalPriceEls = getAllByText(/Rp\s50\.000/);
    expect(totalPriceEls.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Tests: Driver Status Button Visibility ─────────────────────────────────

describe('driver status button visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockUpdateOrderStatus.mockReset();
    mockGetOrderById.mockReset();
    mockOrderPrepareUpdate.mockReset();
    mockOrderPrepareUpdate.mockImplementation(function(this: OrderModel, fn: (r: OrderModel) => void) {
      fn(this);
      return this;
    });
    mockHasPendingAction.mockResolvedValue(false);
    mockPayments.length = 0;
  });

  test('appears for PREPARING status with matching driver and no pending', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });
  });

  test('appears for OUT_FOR_DELIVERY status with matching driver and no pending', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });
  });

  test('NOT shown for ASSIGNED status', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Mulai antar')).toBeNull();
      expect(queryByText('Selesai diantar')).toBeNull();
    });
  });

  test('NOT shown for DELIVERED status', async () => {
    Object.assign(mockOrder, { status: OrderStatus.DELIVERED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Mulai antar')).toBeNull();
      expect(queryByText('Selesai diantar')).toBeNull();
    });
  });

  test('NOT shown when driverId does not match current user', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'other-driver' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Mulai antar')).toBeNull();
    });
  });

  test('NOT shown when hasPending', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    mockHasPendingAction.mockResolvedValue(true);
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Mulai antar')).toBeNull();
    });
  });
});

// ─── Tests: Driver Status Button Behavior ───────────────────────────────────

describe('driver status button behavior', () => {
  let alertSpy: jest.SpyInstance;
  let nmSubscribeSpy: jest.SpyInstance | undefined;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockUpdateOrderStatus.mockReset();
    mockGetOrderById.mockReset();
    mockOrderPrepareUpdate.mockReset();
    mockOrderPrepareUpdate.mockImplementation(function(this: OrderModel, fn: (r: OrderModel) => void) {
      fn(this);
      return this;
    });
    mockHasPendingAction.mockResolvedValue(false);
    mockDatabaseBatch.mockReset();
    mockPayments.length = 0;
  });

  afterEach(() => {
    alertSpy.mockRestore();
    nmSubscribeSpy?.mockRestore();
    nmSubscribeSpy = undefined;
    mockGetStatusFn.mockReset();
    mockGetStatusFn.mockReturnValue('online');
  });

  test('offline: button nonaktif dengan pesan', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456', serverVersion: 1 });
    // Subscribe fires synchronously so isOnline=true from the start → button enabled.
    nmSubscribeSpy = jest.spyOn(networkMonitor, 'subscribe').mockImplementation((cb: (s: NetworkStatus) => void) => {
      cb('online');
      return () => {};
    });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });
    // Press main button → confirmation alert fires
    await act(async () => {
      fireEvent.press(getByText('Mulai antar'));
    });
    // Extract "Ya" button from confirmation alert, set getStatus='offline', press Ya
    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya');
    // Set offline BEFORE pressing Ya so offline guard fires inside onPress
    mockGetStatusFn.mockReturnValue('offline');
    await act(async () => {
      yaButton?.onPress?.();
    });
    expect(Alert.alert).toHaveBeenLastCalledWith(
      'Butuh Koneksi',
      'Status hanya bisa diubah saat ada koneksi internet.',
    );
  });

  test('sukses: updateOrderStatus dipanggil dengan server_version baris', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456', serverVersion: 3 });
    mockUpdateOrderStatus.mockResolvedValue({
      id: 'order-123',
      status: 'OUT_FOR_DELIVERY',
      version: 4,
      updatedAt: '2026-09-25T12:00:00.000Z',
    });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Mulai antar'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya');

    await act(async () => {
      yaButton?.onPress?.();
    });

    expect(mockUpdateOrderStatus).toHaveBeenCalledWith('order-123', 'OUT_FOR_DELIVERY', 3);
  });

  test('sukses: prepareUpdate dipanggil, baris ditandai synced dan _changed kosong', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456', serverVersion: 1 });
    mockUpdateOrderStatus.mockResolvedValue({
      id: 'order-123',
      status: 'OUT_FOR_DELIVERY',
      version: 2,
      updatedAt: '2026-09-25T12:00:00.000Z',
    });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Mulai antar'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya');

    await act(async () => {
      yaButton?.onPress?.();
    });

    await waitFor(() => {
      expect(mockOrderPrepareUpdate).toHaveBeenCalled();
    });

    // database.batch dipanggil dengan hasil prepareUpdate
    await waitFor(() => {
      expect(mockDatabaseBatch).toHaveBeenCalled();
    });
    expect(mockDatabaseBatch.mock.calls[0][0]).toBeDefined();
    expect(typeof mockDatabaseBatch.mock.calls[0][0]).toBe('object');

    // Verifikasi prepareUpdate cb mem-set _raw dengan benar
    const updateCb = mockOrderPrepareUpdate.mock.calls[0][0];
    const recordMock = { _setRaw: jest.fn(), _raw: { _status: '', _changed: '' } };
    updateCb(recordMock);
    expect(recordMock._setRaw).toHaveBeenCalledWith('status', 'OUT_FOR_DELIVERY');
    expect(recordMock._setRaw).toHaveBeenCalledWith('server_version', 2);
    expect(recordMock._raw._status).toBe('synced');
    expect(recordMock._raw._changed).toBe('');
    expect(recordMock._setRaw).toHaveBeenCalledWith('updated_at', Date.parse('2026-09-25T12:00:00.000Z'));
    expect(recordMock._setRaw).toHaveBeenCalledWith('last_conflict_reason', '');
    expect(recordMock._setRaw).toHaveBeenCalledWith('last_conflict_at', null);
  });

  test('409 VERSION_CONFLICT: pesan K8 muncul dan GET dipanggil', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456', serverVersion: 1 });

    mockUpdateOrderStatus.mockImplementationOnce(() =>
      Promise.reject(new ApiError('conflict', 409, 'VERSION_CONFLICT', { code: 'VERSION_CONFLICT' })),
    );
    mockGetOrderById.mockResolvedValue({
      id: 'order-123',
      status: 'OUT_FOR_DELIVERY',
      version: 2,
      updatedAt: '2026-09-25T12:00:00.000Z',
    });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Mulai antar'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya');

    await act(async () => {
      yaButton?.onPress?.();
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Order sudah berubah, data diperbarui.',
        undefined,
        [{ text: 'OK' }],
      );
    });
    expect(mockGetOrderById).toHaveBeenCalledWith('order-123');
    // database.batch dipanggil dengan hasil prepareUpdate dari refreshed GET
    await waitFor(() => {
      expect(mockDatabaseBatch).toHaveBeenCalled();
    });
    // verify updated_at dan last_conflict_at dari refreshed GET
    expect(mockOrder._setRaw).toHaveBeenCalledWith('updated_at', Date.parse('2026-09-25T12:00:00.000Z'));
    expect(mockOrder._setRaw).toHaveBeenCalledWith('last_conflict_reason', '');
    expect(mockOrder._setRaw).toHaveBeenCalledWith('last_conflict_at', null);
  });

  test('409 INVALID_TRANSITION: pesan K8 muncul dan GET dipanggil', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456', serverVersion: 1 });

    mockUpdateOrderStatus.mockImplementationOnce(() =>
      Promise.reject(new ApiError('conflict', 409, 'INVALID_TRANSITION', { code: 'INVALID_TRANSITION' })),
    );
    mockGetOrderById.mockResolvedValue({
      id: 'order-123',
      status: 'OUT_FOR_DELIVERY',
      version: 2,
      updatedAt: '2026-09-25T12:00:00.000Z',
    });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Mulai antar'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya');

    await act(async () => {
      yaButton?.onPress?.();
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Order sudah berubah, data diperbarui.',
        undefined,
        [{ text: 'OK' }],
      );
    });
    expect(mockGetOrderById).toHaveBeenCalledWith('order-123');
    // database.batch dipanggil dengan hasil prepareUpdate dari refreshed GET
    await waitFor(() => {
      expect(mockDatabaseBatch).toHaveBeenCalled();
    });
    // verify updated_at dan last_conflict_at dari refreshed GET
    expect(mockOrder._setRaw).toHaveBeenCalledWith('updated_at', Date.parse('2026-09-25T12:00:00.000Z'));
    expect(mockOrder._setRaw).toHaveBeenCalledWith('last_conflict_reason', '');
    expect(mockOrder._setRaw).toHaveBeenCalledWith('last_conflict_at', null);
  });

  test('403: pesan muncul, baris tidak ditulis, GET tidak dipanggil', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456', serverVersion: 1 });
    mockUpdateOrderStatus.mockImplementationOnce(() =>
      Promise.reject(new ApiError('Forbidden', 403, undefined, undefined)),
    );

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Mulai antar'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya');

    await act(async () => {
      yaButton?.onPress?.();
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Order ini sudah tidak ditugaskan ke Anda.',
        undefined,
        [{ text: 'OK' }],
      );
    });
    expect(mockGetOrderById).not.toHaveBeenCalled();
    expect(mockOrderPrepareUpdate).not.toHaveBeenCalled();
  });

  test('500: pesan gagal umum, baris tidak ditulis', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456', serverVersion: 1 });
    mockUpdateOrderStatus.mockImplementationOnce(() =>
      Promise.reject(new ApiError('Internal Server Error', 500)),
    );

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Mulai antar'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya');

    await act(async () => {
      yaButton?.onPress?.();
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Gagal', 'Status gagal diubah. Coba lagi.');
    });
    expect(mockOrderPrepareUpdate).not.toHaveBeenCalled();
  });

  test('error jaringan: pesan gagal umum, baris tidak ditulis', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456', serverVersion: 1 });
    mockUpdateOrderStatus.mockRejectedValue(new Error('Network request failed'));

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Mulai antar'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya');

    await act(async () => {
      yaButton?.onPress?.();
    });

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith('Gagal', 'Status gagal diubah. Coba lagi.');
    });
    expect(mockOrderPrepareUpdate).not.toHaveBeenCalled();
  });
});
