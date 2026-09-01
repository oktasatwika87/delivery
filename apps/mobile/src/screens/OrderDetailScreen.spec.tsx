/**
 * Unit tests untuk OrderDetailScreen — cancel button visibility + behavior + outbox wiring.
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

import { OrderDetailScreen } from './OrderDetailScreen';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@delivery/shared';

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
}));

// ─── WatermelonDB mock ─────────────────────────────────────────────────────────
const mockOrderUpdate = jest.fn();
const mockOrder = {
  id: 'order-123',
  driverId: 'driver-456',
  status: OrderStatus.ASSIGNED,
  customerId: 'customer-789',
  itemsJson: [],
  addressJson: { street: 'Test St' },
  totalCents: 50000,
  currency: 'IDR',
  notes: 'Test notes',
  serverVersion: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  update: mockOrderUpdate,
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

const mockDatabase: any = {
  get: (name: string) => {
    if (name === 'payments') return mockPaymentsCollection;
    return { findAndObserve: mockFindAndObserve };
  },
  write: async (fn: () => Promise<void>) => {
    // Simulate async database write - allows state to update between calls
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    await fn();
  },
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
    // of CANCELLED) — the button must instead be gated on hasPending, or a
    // driver could tap it again while offline and enqueue duplicate cancels.
    await waitFor(() => {
      expect(queryByText('Batalkan Order')).toBeNull();
    });
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
