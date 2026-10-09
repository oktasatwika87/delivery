/**
 * Unit tests untuk OrderTrackingScreen.
 *
 * Coverage:
 * 1. Render jadi loading spinner awal
 * 2. Fetch sukses jadi render order detail
 * 3. Fetch gagal jadi render error UI dengan tombol Coba Lagi
 * 4. order:accepted event jadi update status PREPARING + driverId + clear cancelReason (filter by orderId)
 * 5. order:rejected event, pakai payload.status ('ASSIGNED' pool state)
 * 6. order:cancelled event jadi pakai payload.status + cancelReason
 * 7. Disconnect jadi tampil banner; Connect jadi hilang
 * 8. Event untuk orderId lain di-ignore (filter)
 * 9. Cleanup: subscribers di-remove saat unmount
 * 10. order:cod_collected event jadi tampil banner receipt dengan jumlah benar
 * 11. order:cod_collected untuk orderId lain di-ignore
 * 12. Tombol "Tutup" pada cod banner dismiss banner
 * 13. order:cod_collected TIDAK mengubah status order (bukan state-sync event)
 * 14. STATUS_DISPLAY.ASSIGNED = "Mencari driver..." (pool state)
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

import type { OrderStatusUpdatedPayload } from '@delivery/shared';

import { OrderTrackingScreen } from './OrderTrackingScreen';
import { UnauthorizedError } from '../sync/client';

// Mock ordersSocket (track subscribers di module-level arrays)
var mockConnectSubscribers: Array<() => void> = [];
var mockDisconnectSubscribers: Array<() => void> = [];
var mockAcceptedSubscribers: Array<(p: any) => void> = [];
var mockRejectedSubscribers: Array<(p: any) => void> = [];
var mockCancelledSubscribers: Array<(p: any) => void> = [];
var mockCodCollectedSubscribers: Array<(p: any) => void> = [];
var mockStatusUpdatedSubscribers: Array<(p: OrderStatusUpdatedPayload) => void> = [];

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
    onOrderCodCollected: (cb: (p: any) => void): (() => void) => {
      mockCodCollectedSubscribers.push(cb);
      return () => {
        mockCodCollectedSubscribers = mockCodCollectedSubscribers.filter((s) => s !== cb);
      };
    },
    onOrderStatusUpdated: (cb: (p: OrderStatusUpdatedPayload) => void): (() => void) => {
      mockStatusUpdatedSubscribers.push(cb);
      return () => {
        mockStatusUpdatedSubscribers = mockStatusUpdatedSubscribers.filter((s) => s !== cb);
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

// Mock client.getOrderById + UnauthorizedError
const mockGetOrderById = jest.fn();

jest.mock('../sync/client', () => {
  // requireActual untuk preserve class identity, `instanceof UnauthorizedError`
  // check di screen harus match dengan class yang di-throw dari test.
  const actual = jest.requireActual('../sync/client') as typeof import('../sync/client');
  return {
    ...actual,
    getOrderById: (...args: any[]): Promise<any> => mockGetOrderById(...args),
  };
});

// Mock syncEvents
const mockAuthExpiredEmit = jest.fn();
jest.mock('../sync/syncEvents', () => ({
  syncEvents: {
    emit: (...args: any[]) => mockAuthExpiredEmit(...args),
  },
}));

// Test helpers
function resetSubscribers(): void {
  mockConnectSubscribers = [];
  mockDisconnectSubscribers = [];
  mockAcceptedSubscribers = [];
  mockRejectedSubscribers = [];
  mockCancelledSubscribers = [];
  mockCodCollectedSubscribers = [];
  mockStatusUpdatedSubscribers = [];
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
function triggerCodCollected(payload: any): void {
  mockCodCollectedSubscribers.forEach((cb) => cb(payload));
}
function triggerStatusUpdated(payload: OrderStatusUpdatedPayload): void {
  mockStatusUpdatedSubscribers.forEach((cb) => cb(payload));
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

  it('initial render jadi loading spinner', () => {
    mockGetOrderById.mockResolvedValue(MOCK_ORDER);

    const { getByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
    );

    expect(getByText('Memuat order...')).toBeTruthy();
  });

  it('fetch sukses jadi render order details + status badge', async () => {
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);

    const { getByText, queryByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
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

  it('fetch gagal jadi render error UI dengan tombol Coba Lagi', async () => {
    mockGetOrderById.mockRejectedValueOnce(new Error('Network error'));

    const { getByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
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

  it('fetch UnauthorizedError jadi emit auth-expired (no error UI)', async () => {
    mockGetOrderById.mockRejectedValueOnce(new UnauthorizedError());

    render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
    );

    await waitFor(() => {
      expect(mockAuthExpiredEmit).toHaveBeenCalledWith(
        'auth-expired',
        expect.objectContaining({ source: 'tracking-fetch' }),
      );
    });
  });

  it('order:accepted event jadi update status PREPARING + driverId + clear cancelReason (matching orderId)', async () => {
    // Server clear cancelReason saat accept, mobile mirror. Start dengan
    // order yang punya cancelReason stale (mis. cron-keluar ASSIGNED dengan
    // system_timeout, customer buka tracking, lalu driver accept).
    const orderWithStaleCancel = {
      ...MOCK_ORDER,
      cancelReason: 'system_timeout',
      cancelledBy: 'SYSTEM',
    };
    mockGetOrderById.mockResolvedValueOnce(orderWithStaleCancel);

    const { getByText, queryByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
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
    // cancelReason stale dari fetch harus hilang setelah accept
    expect(queryByText('Alasan Pembatalan')).toBeNull();
  });

  it('order:rejected event, pakai payload.status ASSIGNED (pool state)', async () => {
    // Backend emit status 'ASSIGNED' untuk reject, pool state. Type literal
    // OrderRejectedPayload.status yang jamin compile-time.
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);

    const { getByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
    );

    await waitFor(() => {
      expect(getByText('Menunggu konfirmasi')).toBeTruthy();
    });

    act(() => {
      triggerRejected({
        orderId: 'order-abc-123',
        status: 'ASSIGNED',
        version: 3,
      });
    });

    await waitFor(() => {
      expect(getByText('Mencari driver...')).toBeTruthy();
    });
  });

  it('order:cancelled event jadi pakai payload.status ASSIGNED + cancelReason', async () => {
    // Status 'ASSIGNED' di payload, mobile pakai langsung dari payload.
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);

    const { getByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
    );

    await waitFor(() => {
      expect(getByText('Menunggu konfirmasi')).toBeTruthy();
    });

    act(() => {
      triggerCancelled({
        orderId: 'order-abc-123',
        status: 'ASSIGNED',
        version: 4,
        reason: 'Kendaraan mogok',
      });
    });

    await waitFor(() => {
      expect(getByText('Mencari driver...')).toBeTruthy();
      expect(getByText('Kendaraan mogok')).toBeTruthy();
    });
  });

  it('event untuk orderId LAIN di-ignore (filter by route.params.orderId)', async () => {
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);

    const { getByText, queryByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
    );

    await waitFor(() => {
      expect(getByText('Menunggu konfirmasi')).toBeTruthy();
    });

    // Event untuk orderId lain, HARUS di-ignore
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

  it('order:cod_collected event jadi tampil banner receipt dengan jumlah benar', async () => {
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);

    const { getByText, queryByTestId, getByTestId } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
    );

    await waitFor(() => {
      expect(getByText('Menunggu konfirmasi')).toBeTruthy();
    });

    expect(queryByTestId('cod-collected-banner')).toBeNull();

    act(() => {
      triggerCodCollected({
        orderId: 'order-abc-123',
        amountCents: 50000,
        currency: 'IDR',
        collectedAt: '2026-09-02T08:00:00.000Z',
      });
    });

    await waitFor(() => {
      expect(getByTestId('cod-collected-banner')).toBeTruthy();
      expect(getByText('Pembayaran tunai diterima')).toBeTruthy();
    });

    // Status order TIDAK berubah, event ini bukan state-sync, murni receipt
    expect(getByText('Menunggu konfirmasi')).toBeTruthy();
  });

  it('order:cod_collected untuk orderId LAIN di-ignore', async () => {
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);

    const { getByText, queryByTestId } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
    );

    await waitFor(() => {
      expect(getByText('Menunggu konfirmasi')).toBeTruthy();
    });

    act(() => {
      triggerCodCollected({
        orderId: 'order-LAIN-999',
        amountCents: 50000,
        currency: 'IDR',
        collectedAt: '2026-09-02T08:00:00.000Z',
      });
    });

    expect(queryByTestId('cod-collected-banner')).toBeNull();
  });

  it('tombol "Tutup" pada cod banner dismiss banner', async () => {
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);

    const { getByText, queryByTestId, getByTestId } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
    );

    await waitFor(() => {
      expect(getByText('Menunggu konfirmasi')).toBeTruthy();
    });

    act(() => {
      triggerCodCollected({
        orderId: 'order-abc-123',
        amountCents: 50000,
        currency: 'IDR',
        collectedAt: '2026-09-02T08:00:00.000Z',
      });
    });

    await waitFor(() => {
      expect(getByTestId('cod-collected-banner')).toBeTruthy();
    });

    fireEvent.press(getByText('Tutup'));

    expect(queryByTestId('cod-collected-banner')).toBeNull();
  });

  it('disconnect jadi tampil banner; connect jadi hilang', async () => {
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);

    const { queryByText, getByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
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
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
    );

    await waitFor(() => {
      expect(mockAcceptedSubscribers.length).toBeGreaterThan(0);
      expect(mockRejectedSubscribers.length).toBeGreaterThan(0);
      expect(mockCancelledSubscribers.length).toBeGreaterThan(0);
      expect(mockCodCollectedSubscribers.length).toBeGreaterThan(0);
      expect(mockConnectSubscribers.length).toBeGreaterThan(0);
      expect(mockDisconnectSubscribers.length).toBeGreaterThan(0);
    });

    const acceptedBefore = mockAcceptedSubscribers.length;
    const rejectedBefore = mockRejectedSubscribers.length;
    const cancelledBefore = mockCancelledSubscribers.length;
    const codCollectedBefore = mockCodCollectedSubscribers.length;
    const statusUpdatedBefore = mockStatusUpdatedSubscribers.length;
    const connectBefore = mockConnectSubscribers.length;
    const disconnectBefore = mockDisconnectSubscribers.length;

    unmount();

    expect(mockAcceptedSubscribers.length).toBe(acceptedBefore - 1);
    expect(mockRejectedSubscribers.length).toBe(rejectedBefore - 1);
    expect(mockCancelledSubscribers.length).toBe(cancelledBefore - 1);
    expect(mockCodCollectedSubscribers.length).toBe(codCollectedBefore - 1);
    expect(mockStatusUpdatedSubscribers.length).toBe(statusUpdatedBefore - 1);
    expect(mockConnectSubscribers.length).toBe(connectBefore - 1);
    expect(mockDisconnectSubscribers.length).toBe(disconnectBefore - 1);
  });

  it('order:status_updated untuk order ini jadi update label status', async () => {
    // Payload OUT_FOR_DELIVERY: PREPARING jadi OUT_FOR_DELIVERY
    const preparingOrder = { ...MOCK_ORDER, status: 'PREPARING' as const };
    mockGetOrderById.mockResolvedValueOnce(preparingOrder);

    const { getByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
    );

    await waitFor(() => {
      expect(getByText('Driver sedang menyiapkan')).toBeTruthy();
    });

    act(() => {
      triggerStatusUpdated({
        orderId: 'order-abc-123',
        status: 'OUT_FOR_DELIVERY',
        version: 2,
        updatedAt: '2026-09-25T12:00:00.000Z',
      });
    });

    await waitFor(() => {
      expect(getByText('Dalam perjalanan')).toBeTruthy();
    });
    // Status PREPARING sudah tidak tampil
    expect(() => getByText('Driver sedang menyiapkan')).toThrow();
  });

  it('order:status_updated untuk orderId LAIN diabaikan', async () => {
    mockGetOrderById.mockResolvedValueOnce(MOCK_ORDER);

    const { getByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
    );

    await waitFor(() => {
      expect(getByText('Menunggu konfirmasi')).toBeTruthy();
    });

    act(() => {
      triggerStatusUpdated({
        orderId: 'order-LAIN-999',
        status: 'OUT_FOR_DELIVERY',
        version: 2,
        updatedAt: '2026-09-25T12:00:00.000Z',
      });
    });

    // Status tidak berubah
    expect(getByText('Menunggu konfirmasi')).toBeTruthy();
  });

  it('tampilan harga: totalCents 23000 dan item unitPriceCents 23000 tampil Rp 23.000, bukan 230', async () => {
    // formatCurrency tanpa /100. Nilai dalam rupiah apa adanya.
    // Bug lama, /100 menyebabkan 23000 muncul sebagai Rp 230 (sen).
    // Pastikan tidak NaN, bukan Rp 230.
    const orderRp23k = {
      ...MOCK_ORDER,
      totalCents: 23000,
      currency: 'IDR',
      items: [
        {
          id: 'item-price-1',
          productId: 'prod-price-1',
          name: 'Mie Goreng',
          quantity: 1,
          unitPriceCents: 23000,
        },
      ],
    };
    mockGetOrderById.mockResolvedValueOnce(orderRp23k);

    const { getAllByText, getByText } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
    );

    await waitFor(() => {
      expect(getByText('Order #12345678')).toBeTruthy();
    });

    // Total baris, Rp 23.000
    const priceTexts = getAllByText(/Rp\s23\.000/);
    expect(priceTexts).toHaveLength(2); // item + total
    // Item harga, Rp 23.000 (bukan Rp 230 dari bug /100)
    expect(getByText('1x Mie Goreng')).toBeTruthy();
  });

  it('PREPARING dengan driverId: tombol Chat dengan Kurir tampil, ketuk memanggil onOpenChat', async () => {
    const preparingWithDriver = {
      ...MOCK_ORDER,
      status: 'PREPARING' as const,
      driverId: 'driver-456',
    };
    mockGetOrderById.mockResolvedValueOnce(preparingWithDriver);

    const onOpenChat = jest.fn();
    const { getByTestId } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={onOpenChat} />,
    );

    await waitFor(() => {
      expect(getByTestId('chat-button')).toBeTruthy();
    });

    fireEvent.press(getByTestId('chat-button'));

    expect(onOpenChat).toHaveBeenCalledTimes(1);
    expect(onOpenChat).toHaveBeenCalledWith('12345678-0000-0000-0000-000000000000');
  });

  it('ASSIGNED tanpa driverId: tombol Chat dengan Kurir tidak tampil', async () => {
    const assignedNoDriver = {
      ...MOCK_ORDER,
      status: 'ASSIGNED' as const,
      driverId: undefined,
    };
    mockGetOrderById.mockResolvedValueOnce(assignedNoDriver);

    const { queryByTestId } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
    );

    await waitFor(() => {
      expect(queryByTestId('chat-button')).toBeNull();
    });
  });

  it('CANCELLED: tombol Chat dengan Kurir tidak tampil', async () => {
    const cancelledOrder = {
      ...MOCK_ORDER,
      status: 'CANCELLED' as const,
      driverId: 'driver-456',
    };
    mockGetOrderById.mockResolvedValueOnce(cancelledOrder);

    const { queryByTestId } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
    );

    await waitFor(() => {
      expect(queryByTestId('chat-button')).toBeNull();
    });
  });

  it('setelah order:accepted tombol muncul, setelah order:cancelled tombol hilang', async () => {
    // Start dengan ASSIGNED (pool state, no driver)
    const assignedNoDriver = {
      ...MOCK_ORDER,
      status: 'ASSIGNED' as const,
      driverId: undefined,
    };
    mockGetOrderById.mockResolvedValueOnce(assignedNoDriver);

    const { queryByTestId } = render(
      <OrderTrackingScreen orderId="order-abc-123" onBack={jest.fn()} onOpenChat={jest.fn()} />,
    );

    await waitFor(() => {
      expect(queryByTestId('chat-button')).toBeNull();
    });

    // order:accepted -> driverId terisi -> tombol muncul
    act(() => {
      triggerAccepted({
        orderId: 'order-abc-123',
        driverId: 'driver-789',
        status: 'PREPARING',
        version: 2,
      });
    });

    await waitFor(() => {
      expect(queryByTestId('chat-button')).toBeTruthy();
    });

    // setelah order:cancelled, driverId kosong dan tombol hilang
    act(() => {
      triggerCancelled({
        orderId: 'order-abc-123',
        status: 'ASSIGNED',
        version: 3,
        reason: 'Kendaraan mogok',
      });
    });

    await waitFor(() => {
      expect(queryByTestId('chat-button')).toBeNull();
    });
  });
});