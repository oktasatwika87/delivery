/**
 * Unit tests untuk OrderDetailScreen — cancel button visibility + behavior.
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

import { OrderDetailScreen } from './OrderDetailScreen';
import { OrderStatus } from '@delivery/shared';

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

// WatermelonDB mock
const mockOrderUpdate = jest.fn();
const mockOrder: any = {
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

const mockDatabase: any = {
  get: () => ({ findAndObserve: mockFindAndObserve }),
  write: async (fn: () => Promise<void>) => { await fn(); },
};

jest.mock('@nozbe/watermelondb/react', () => ({ withDatabase: (C: any) => C }));
jest.mock('@nozbe/watermelondb', () => ({ withDatabase: (C: any) => C }));

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

// ─── Tests: Behavior ────────────────────────────────────────────

describe('cancel button behavior', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    mockOrderUpdate.mockImplementation(async (updater: any) => { updater(mockOrder); });
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

  test('pressing Ya writes CANCELLED status to WatermelonDB', async () => {
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

    expect(mockOrderUpdate).toHaveBeenCalled();
    const updater = mockOrderUpdate.mock.calls[0][0];
    updater(mockOrder);
    expect(mockOrder.status).toBe(OrderStatus.CANCELLED);
  });

  test('pressing Tidak does NOT write to database', async () => {
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

    expect(mockOrderUpdate).not.toHaveBeenCalled();
  });

  test('cancelledBy is set to current driver ID on confirm', async () => {
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

    expect(mockOrderUpdate).toHaveBeenCalled();
    const updater = mockOrderUpdate.mock.calls[0][0];
    updater(mockOrder);
    expect(mockOrder.cancelledBy).toBe('driver-456');
  });
});
