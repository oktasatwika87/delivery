/**
 * Unit tests untuk OrderTrackingScreen.
 *
 * Coverage:
 * 1. Render → loading spinner awal
 * 2. Fetch sukses → render order detail
 * 3. Fetch gagal → render error UI dengan tombol Coba Lagi
 * 4. order:accepted event → update status PREPARING + driverId (filter by orderId)
 * 5. order:rejected event → update status CANCELLED
 * 6. order:cancelled event → update status CONFIRMED + cancelReason
 * 7. Disconnect → tampil banner; Connect → hilang
 * 8. Event untuk orderId lain di-ignore (filter)
 * 9. Cleanup: subscribers di-remove saat unmount
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

import { OrderTrackingScreen } from './OrderTrackingScreen';
import { UnauthorizedError } from '../sync/client';

// ─── Mock ordersSocket (track subscribers di module-level arrays) ──────
var mockConnectSubscribers: Array<() => void> = [];
var mockDisconnectSubscribers: Array<() => void> = [];
var mockAcceptedSubscribers: Array<(p: any) => void> = [];
var mockRejectedSubscribers: Array<(p: any) => void> = [];
var mockCancelledSubscribers: Array<(p: any) => void> = [];

jest.mock('../sync/ordersSocket', () => ({
  ordersSocket: {
    isConnected: true,
    onOrderAccepted: (cb: (p: any) => void): (() => void) => {
      mockAcceptedSubscribers.push(cb);
      return () => {
        mockAcceptedSubscribers = mockAcceptedSubscribers.filter((s) => s !== cb);
      };
    },
    onOrderRejected: (cb: (p: any) => void): (() => void) => {
      mockRejectedSubscribers.push(cb);
      return () => {
        mockRejectedSubscribers = mockRejectedSubscribers.filter((s) => s !== cb);
      };
    },
    onOrderCancelled: (cb: (p: any) => void): (() => void) => {
      mockCancelledSubscribers.push(cb);
      return () => {
        mockCancelledSubscribers = mockCancelledSubscribers.filter((s) => s !== cb);
      };
    },
    on: (event: string, cb: () => void): (() => void) => {
      if (event === 'connect') mockConnectSubscribers.push(cb);
      if (event === 'disconnect') mockDisconnectSubscribers.push(cb);
      return () => {
        mockConnectSubscribers = mockConnectSubscribers.filter((s) => s !== cb);
        mockDisconnectSubscribers = mockDisconnectSubscribers.filter((s) => s !== cb);
      };
    },
  },
}));

// ─── Mock client.getOrderById + UnauthorizedError ──────────────────────
const mockGetOrderById = jest.fn();

jest.mock('../sync/client', () => {
  // requireActual untuk preserve class identity — `instanceof UnauthorizedError`
  // check di screen harus match dengan class yang di-throw dari test.
  const actual = jest.requireActual('../sync/client') as typeof import('../sync/client');
  return {
    ...actual,
    getOrderById: (...args: any[]): Promise<any> => mockGetOrderById(...args),
  };
});

// ─── Mock syncEvents ────────────────────────────────────────────────────
const mockAuthExpiredEmit = jest.fn();
jest.mock('../sync/syncEvents', () => ({
  syncEvents: {
    emit: (...args: any[]) => mockAuthExpiredEmit(...args),
  },
}));

// ─── Test helpers ───────────────────────────────────────────────────────
function resetSubscribers(): void {
  mockConnectSubscribers = [];
  mockDisconnectSubscribers = [];
  mockAcceptedSubscribers = [];
  mockRejectedSubscribers = [];
  mockCancelledSubscribers = [];
}

function triggerConnect(): void {
  mockConnectSubscribers.forEach((cb) => cb());
}
function triggerDisconnect(): void {
  mockDisconnectSubscribers.forEach((cb) => cb());
}
function triggerAccepted(payload: any): void {
  mockAcceptedSubscribers.forEach((cb) => cb(payload));
}
function triggerRejected(payload: any): void {
  mockRejectedSubscribers.forEach((cb) => cb(payload));
}
function triggerCancelled(payload: any): void {
  mockCancelledSubscribers.forEach((cb) => cb(payload));
}

const MOCK_ORDER = {
  id: '12345678-0000-0000-0000-000000000000',
  customerId: 'customer-xyz',
  status: 'PENDING',
  items: [
    {
      id: 'item-1',
      productId: 'prod-1',
      name: 'Nasi Goreng',
      quantity: 2,
      unitPriceCents: 25000,
    },
  ],
  deliveryAddress: {
    recipientName: 'Budi Santoso',
    phone: '081234567890',
    street: 'Jl. Merdeka No. 1',
    city: 'Denpasar',
    postalCode: '80111',
  },
  totalCents: 50000,
  currency: 'IDR',
  notes: 'Tolong dibungkus rapi',
  version: 1,
  createdAt: '2026-08-30T10:00:00.000Z',
  updatedAt: '2026-08-30T10:00:00.000Z',
};

describe('OrderTrackingScreen', () => {
  beforeEach(() => {
    mockGetOrderById.mockReset();
    mockAuthExpiredEmit.mockReset();
    resetSubscribers();
  });

  it('initial render → loading spinner', () => {
    mockGetOrderById.mockResolvedValue(MOCK_ORDER);

    const { getByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} />,
    );

    expect(getByText('Memuat order...')).toBeTruthy();
  });

  it('fetch sukses → render order details + status badge', async () => {
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);

    const { getByText, queryByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} />,
    );

    await waitFor(() => {
      expect(getByText('Order #12345678')).toBeTruthy();
      expect(getByText('Menunggu konfirmasi')).toBeTruthy();
    });

    // Detail pengiriman
    expect(getByText('Budi Santoso')).toBeTruthy();
    expect(getByText('081234567890')).toBeTruthy();
    expect(getByText('Jl. Merdeka No. 1')).toBeTruthy();
    expect(getByText('Denpasar, 80111')).toBeTruthy();

    // Items
    expect(getByText('2x Nasi Goreng')).toBeTruthy();
    expect(getByText('Tolong dibungkus rapi')).toBeTruthy();

    // Loading tidak lagi muncul
    expect(queryByText('Memuat order...')).toBeNull();
  });

  it('fetch gagal → render error UI dengan tombol Coba Lagi', async () => {
    mockGetOrderById.mockRejectedValueOnce(new Error('Network error'));

    const { getByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} />,
    );

    await waitFor(() => {
      expect(getByText('Gagal memuat order')).toBeTruthy();
      expect(getByText('Network error')).toBeTruthy();
      expect(getByText('Coba Lagi')).toBeTruthy();
    });

    // Tombol Coba Lagi re-trigger fetch
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);
    fireEvent.press(getByText('Coba Lagi'));

    await waitFor(() => {
      expect(getByText('Order #12345678')).toBeTruthy();
    });
  });

  it('fetch UnauthorizedError → emit auth-expired (no error UI)', async () => {
    mockGetOrderById.mockRejectedValueOnce(new UnauthorizedError());

    render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} />,
    );

    await waitFor(() => {
      expect(mockAuthExpiredEmit).toHaveBeenCalledWith(
        'auth-expired',
        expect.objectContaining({ source: 'tracking-fetch' }),
      );
    });
  });

  it('order:accepted event → update status PREPARING + driverId (matching orderId)', async () => {
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);

    const { getByText, queryByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} />,
    );

    await waitFor(() => {
      expect(getByText('Menunggu konfirmasi')).toBeTruthy();
    });

    act(() => {
      triggerAccepted({
        orderId: 'order-abc-123',
        driverId: 'driver-456',
        status: 'PREPARING',
        version: 2,
      });
    });

    await waitFor(() => {
      expect(getByText('Driver sedang menyiapkan')).toBeTruthy();
    });

    // Status lama (PENDING) sudah tidak tampil
    expect(queryByText('Menunggu konfirmasi')).toBeNull();
  });

  it('order:rejected event → update status CANCELLED', async () => {
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);

    const { getByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} />,
    );

    await waitFor(() => {
      expect(getByText('Menunggu konfirmasi')).toBeTruthy();
    });

    act(() => {
      triggerRejected({
        orderId: 'order-abc-123',
        status: 'CANCELLED',
        version: 3,
      });
    });

    await waitFor(() => {
      expect(getByText('Dibatalkan')).toBeTruthy();
    });
  });

  it('order:cancelled event → update status CONFIRMED + cancelReason', async () => {
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);

    const { getByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} />,
    );

    await waitFor(() => {
      expect(getByText('Menunggu konfirmasi')).toBeTruthy();
    });

    act(() => {
      triggerCancelled({
        orderId: 'order-abc-123',
        status: 'CONFIRMED',
        version: 4,
        reason: 'Kendaraan mogok',
      });
    });

    await waitFor(() => {
      expect(getByText('Dikonfirmasi, mencari driver...')).toBeTruthy();
      expect(getByText('Kendaraan mogok')).toBeTruthy();
    });
  });

  it('event untuk orderId LAIN di-ignore (filter by route.params.orderId)', async () => {
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);

    const { getByText, queryByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} />,
    );

    await waitFor(() => {
      expect(getByText('Menunggu konfirmasi')).toBeTruthy();
    });

    // Event untuk orderId lain — HARUS di-ignore
    act(() => {
      triggerAccepted({
        orderId: 'order-LAIN-999',
        driverId: 'driver-456',
        status: 'PREPARING',
        version: 2,
      });
    });

    // Status tidak berubah
    expect(getByText('Menunggu konfirmasi')).toBeTruthy();
    expect(queryByText('Driver sedang menyiapkan')).toBeNull();
  });

  it('disconnect → tampil banner; connect → hilang', async () => {
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);

    const { queryByText, getByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} />,
    );

    await waitFor(() => {
      expect(queryByText('Koneksi terputus, mencoba reconnect...')).toBeNull();
    });

    act(() => {
      triggerDisconnect();
    });

    await waitFor(() => {
      expect(getByText('Koneksi terputus, mencoba reconnect...')).toBeTruthy();
    });

    act(() => {
      triggerConnect();
    });

    await waitFor(() => {
      expect(queryByText('Koneksi terputus, mencoba reconnect...')).toBeNull();
    });
  });

  it('cleanup: subscribers di-remove saat unmount', async () => {
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);

    const { unmount } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} />,
    );

    await waitFor(() => {
      expect(mockAcceptedSubscribers.length).toBeGreaterThan(0);
      expect(mockRejectedSubscribers.length).toBeGreaterThan(0);
      expect(mockCancelledSubscribers.length).toBeGreaterThan(0);
      expect(mockConnectSubscribers.length).toBeGreaterThan(0);
      expect(mockDisconnectSubscribers.length).toBeGreaterThan(0);
    });

    const acceptedBefore = mockAcceptedSubscribers.length;
    const rejectedBefore = mockRejectedSubscribers.length;
    const cancelledBefore = mockCancelledSubscribers.length;
    const connectBefore = mockConnectSubscribers.length;
    const disconnectBefore = mockDisconnectSubscribers.length;

    unmount();

    expect(mockAcceptedSubscribers.length).toBe(acceptedBefore - 1);
    expect(mockRejectedSubscribers.length).toBe(rejectedBefore - 1);
    expect(mockCancelledSubscribers.length).toBe(cancelledBefore - 1);
    expect(mockConnectSubscribers.length).toBe(connectBefore - 1);
    expect(mockDisconnectSubscribers.length).toBe(disconnectBefore - 1);
  });
});