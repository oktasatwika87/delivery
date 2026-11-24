/**
 * Tes hook data layar status order untuk customer.
 *
 * Socket dan HTTP client ditiru supaya bisa memicu kejadian dan mengatur
 * jawaban server tanpa jaringan. Jam dimatikan supaya jeda 60 detik bisa
 * dicoba tanpa menunggu.
 */

import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import type {
  Order,
  OrderAcceptedPayload,
  OrderCancelledPayload,
  OrderCodCollectedPayload,
  OrderRejectedPayload,
  OrderStatusUpdatedPayload,
} from '@delivery/shared';

import { AMBIL_ULANG_MS, useCustomerOrder } from './useCustomerOrder';
import { UnauthorizedError } from '../sync/client';

var mockAcceptedSubscribers: Array<(p: OrderAcceptedPayload) => void> = [];
var mockRejectedSubscribers: Array<(p: OrderRejectedPayload) => void> = [];
var mockCancelledSubscribers: Array<(p: OrderCancelledPayload) => void> = [];
var mockCodSubscribers: Array<(p: OrderCodCollectedPayload) => void> = [];
var mockStatusSubscribers: Array<(p: OrderStatusUpdatedPayload) => void> = [];
var mockConnectSubscribers: Array<() => void> = [];
var mockDisconnectSubscribers: Array<() => void> = [];

jest.mock('../sync/ordersSocket', () => ({
  ordersSocket: {
    isConnected: true,
    onOrderAccepted: (cb: (p: OrderAcceptedPayload) => void): (() => void) => {
      mockAcceptedSubscribers.push(cb);
      return () => {
        mockAcceptedSubscribers = mockAcceptedSubscribers.filter((s) => s !== cb);
      };
    },
    onOrderRejected: (cb: (p: OrderRejectedPayload) => void): (() => void) => {
      mockRejectedSubscribers.push(cb);
      return () => {
        mockRejectedSubscribers = mockRejectedSubscribers.filter((s) => s !== cb);
      };
    },
    onOrderCancelled: (cb: (p: OrderCancelledPayload) => void): (() => void) => {
      mockCancelledSubscribers.push(cb);
      return () => {
        mockCancelledSubscribers = mockCancelledSubscribers.filter((s) => s !== cb);
      };
    },
    onOrderCodCollected: (cb: (p: OrderCodCollectedPayload) => void): (() => void) => {
      mockCodSubscribers.push(cb);
      return () => {
        mockCodSubscribers = mockCodSubscribers.filter((s) => s !== cb);
      };
    },
    onOrderStatusUpdated: (cb: (p: OrderStatusUpdatedPayload) => void): (() => void) => {
      mockStatusSubscribers.push(cb);
      return () => {
        mockStatusSubscribers = mockStatusSubscribers.filter((s) => s !== cb);
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

const mockGetOrderById = jest.fn<Promise<Order>, [string]>();

jest.mock('../sync/client', () => {
  // requireActual supaya class UnauthorizedError tetap sama dengan yang
  // dilempar hook, jadi instanceof di hook benar.
  const actual = jest.requireActual('../sync/client') as typeof import('../sync/client');
  return {
    ...actual,
    getOrderById: (id: string): Promise<Order> => mockGetOrderById(id),
  };
});

const ORDER: Order = {
  id: 'order-1',
  customerId: 'customer-1',
  status: 'PENDING',
  items: [],
  deliveryAddress: {
    recipientName: 'Budi',
    phone: '081234567890',
    street: 'Jl. Merdeka No. 1',
    city: 'Jakarta',
    postalCode: '10110',
  },
  totalCents: 25000,
  currency: 'IDR',
  version: 1,
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z',
};

interface Tertunda<T> {
  janji: Promise<T>;
  selesai: (nilai: T) => void;
}

function tertunda<T>(): Tertunda<T> {
  let selesai: (nilai: T) => void = () => {};
  const janji = new Promise<T>((res) => {
    selesai = res;
  });
  return { janji, selesai };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function resetSubscribers(): void {
  mockAcceptedSubscribers = [];
  mockRejectedSubscribers = [];
  mockCancelledSubscribers = [];
  mockCodSubscribers = [];
  mockStatusSubscribers = [];
  mockConnectSubscribers = [];
  mockDisconnectSubscribers = [];
}

function triggerAccepted(payload: OrderAcceptedPayload): void {
  mockAcceptedSubscribers.forEach((cb) => cb(payload));
}

function triggerRejected(payload: OrderRejectedPayload): void {
  mockRejectedSubscribers.forEach((cb) => cb(payload));
}

function triggerCancelled(payload: OrderCancelledPayload): void {
  mockCancelledSubscribers.forEach((cb) => cb(payload));
}

function triggerCodCollected(payload: OrderCodCollectedPayload): void {
  mockCodSubscribers.forEach((cb) => cb(payload));
}

function triggerStatusUpdated(payload: OrderStatusUpdatedPayload): void {
  mockStatusSubscribers.forEach((cb) => cb(payload));
}

function triggerConnect(): void {
  mockConnectSubscribers.forEach((cb) => cb());
}

function triggerDisconnect(): void {
  mockDisconnectSubscribers.forEach((cb) => cb());
}

function pendengarAppState(): (status: AppStateStatus) => void {
  const mock = jest.mocked(AppState.addEventListener);
  const pemanggil = mock.mock.calls[mock.mock.calls.length - 1];
  if (!pemanggil) throw new Error('belum ada pendengar AppState');
  return pemanggil[1];
}

describe('useCustomerOrder', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetSubscribers();
    mockGetOrderById.mockReset();
    mockGetOrderById.mockResolvedValue(ORDER);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('ambil pertama', () => {
    it('selama memuat data belum ada, setelah selesai order tampil', async () => {
      const { result } = renderHook(() => useCustomerOrder('order-1', true));

      expect(result.current.memuat).toBe(true);
      expect(result.current.data).toBeNull();

      await flush();

      expect(result.current.memuat).toBe(false);
      expect(result.current.data?.order).toEqual(ORDER);
      expect(result.current.data?.terakhirDiperbarui).toBeGreaterThan(0);
      expect(result.current.asalPerubahan).toBe('awal');
    });

    it('gagal: gagalMemuat true dan memuat selesai', async () => {
      mockGetOrderById.mockRejectedValueOnce(new Error('jaringan mati'));

      const { result } = renderHook(() => useCustomerOrder('order-1', true));
      await flush();

      expect(result.current.gagalMemuat).toBe(true);
      expect(result.current.memuat).toBe(false);
      expect(result.current.data).toBeNull();
    });

    it('401: tanpa galat dan memuat tetap true', async () => {
      mockGetOrderById.mockRejectedValueOnce(new UnauthorizedError());

      const { result } = renderHook(() => useCustomerOrder('order-1', true));
      await flush();

      expect(result.current.gagalMemuat).toBe(false);
      expect(result.current.memuat).toBe(true);
      expect(result.current.data).toBeNull();
    });

    it('cobaLagi mengulang ambil pertama dengan status memuat', async () => {
      mockGetOrderById.mockRejectedValueOnce(new Error('jaringan mati'));

      const { result } = renderHook(() => useCustomerOrder('order-1', true));
      await flush();
      expect(result.current.gagalMemuat).toBe(true);

      act(() => {
        result.current.cobaLagi();
      });
      expect(result.current.memuat).toBe(true);

      await flush();

      expect(result.current.gagalMemuat).toBe(false);
      expect(result.current.memuat).toBe(false);
      expect(result.current.data?.order).toEqual(ORDER);
    });
  });

  describe('perubahan dari socket', () => {
    it('order:accepted mengubah status ke preparing dan mengisi driver', async () => {
      const { result } = renderHook(() => useCustomerOrder('order-1', true));
      await flush();

      act(() => {
        triggerAccepted({
          orderId: 'order-1',
          driverId: 'driver-1',
          status: 'PREPARING',
          version: 2,
        });
      });

      expect(result.current.data?.order.status).toBe('PREPARING');
      expect(result.current.data?.order.driverId).toBe('driver-1');
      expect(result.current.asalPerubahan).toBe('pihak_lain');
    });

    it('order:accepted mengosongkan alasan pembatalan lama', async () => {
      mockGetOrderById.mockResolvedValueOnce({
        ...ORDER,
        cancelReason: 'driver_unreachable',
        cancelledBy: 'customer-1',
      });

      const { result } = renderHook(() => useCustomerOrder('order-1', true));
      await flush();

      act(() => {
        triggerAccepted({
          orderId: 'order-1',
          driverId: 'driver-1',
          status: 'PREPARING',
          version: 2,
        });
      });

      expect(result.current.data?.order.cancelReason).toBeUndefined();
      expect(result.current.data?.order.cancelledBy).toBeUndefined();
      expect(result.current.data?.order.driverUnreachableSince).toBeUndefined();
    });

    it('order:rejected memakai status dari payload dan mengosongkan driver', async () => {
      mockGetOrderById.mockResolvedValueOnce({ ...ORDER, driverId: 'driver-1' });

      const { result } = renderHook(() => useCustomerOrder('order-1', true));
      await flush();

      act(() => {
        triggerRejected({ orderId: 'order-1', status: 'ASSIGNED', version: 3 });
      });

      expect(result.current.data?.order.status).toBe('ASSIGNED');
      expect(result.current.data?.order.driverId).toBeUndefined();
      expect(result.current.asalPerubahan).toBe('pihak_lain');
    });

    it('order:cancelled mengisi cancelReason dan cancelledBy dari driver sebelumnya', async () => {
      mockGetOrderById.mockResolvedValueOnce({ ...ORDER, status: 'PREPARING', driverId: 'driver-1' });

      const { result } = renderHook(() => useCustomerOrder('order-1', true));
      await flush();

      act(() => {
        triggerCancelled({
          orderId: 'order-1',
          status: 'ASSIGNED',
          version: 4,
          reason: 'kendaraan mogok',
        });
      });

      expect(result.current.data?.order.status).toBe('ASSIGNED');
      expect(result.current.data?.order.driverId).toBeUndefined();
      expect(result.current.data?.order.cancelReason).toBe('kendaraan mogok');
      expect(result.current.data?.order.cancelledBy).toBe('driver-1');
      expect(result.current.asalPerubahan).toBe('pihak_lain');
    });

    it('order:cancelled dengan alasan driver_unreachable menulis cancelledBy sebagai customer', async () => {
      mockGetOrderById.mockResolvedValueOnce({ ...ORDER, status: 'PREPARING', driverId: 'driver-1' });

      const { result } = renderHook(() => useCustomerOrder('order-1', true));
      await flush();

      act(() => {
        triggerCancelled({
          orderId: 'order-1',
          status: 'ASSIGNED',
          version: 4,
          reason: 'driver_unreachable',
        });
      });

      expect(result.current.data?.order.cancelledBy).toBe('customer-1');
      expect(result.current.asalPerubahan).toBe('sendiri');
    });

    it('order:status_updated memakai status dan updatedAt dari payload', async () => {
      const { result } = renderHook(() => useCustomerOrder('order-1', true));
      await flush();

      act(() => {
        triggerStatusUpdated({
          orderId: 'order-1',
          status: 'OUT_FOR_DELIVERY',
          version: 2,
          updatedAt: '2026-09-25T12:00:00.000Z',
        });
      });

      expect(result.current.data?.order.status).toBe('OUT_FOR_DELIVERY');
      expect(result.current.data?.order.updatedAt).toBe('2026-09-25T12:00:00.000Z');
    });

    it('order:cod_collected menandai tunai diterima tanpa mengubah order', async () => {
      const { result } = renderHook(() => useCustomerOrder('order-1', true));
      await flush();

      act(() => {
        triggerCodCollected({
          orderId: 'order-1',
          amountCents: 25000,
          currency: 'IDR',
          collectedAt: '2026-09-02T08:00:00.000Z',
        });
      });

      expect(result.current.tunaiDiterima).toBe(true);
      expect(result.current.data?.order).toEqual(ORDER);
    });

    it('kejadian untuk order lain diabaikan', async () => {
      const { result } = renderHook(() => useCustomerOrder('order-1', true));
      await flush();

      act(() => {
        triggerAccepted({
          orderId: 'order-LAIN',
          driverId: 'driver-1',
          status: 'PREPARING',
          version: 9,
        });
      });

      expect(result.current.data?.order.status).toBe('PENDING');
    });

    it('kejadian dengan version sama atau lebih kecil diabaikan', async () => {
      mockGetOrderById.mockResolvedValueOnce({ ...ORDER, version: 4 });

      const { result } = renderHook(() => useCustomerOrder('order-1', true));
      await flush();

      act(() => {
        triggerAccepted({
          orderId: 'order-1',
          driverId: 'driver-1',
          status: 'PREPARING',
          version: 4,
        });
      });
      expect(result.current.data?.order.status).toBe('PENDING');

      act(() => {
        triggerAccepted({
          orderId: 'order-1',
          driverId: 'driver-2',
          status: 'PREPARING',
          version: 3,
        });
      });
      expect(result.current.data?.order.status).toBe('PENDING');
    });

    it('kejadian sebelum order pertama tampil memicu satu ambil ulang setelahnya', async () => {
      const { result } = renderHook(() => useCustomerOrder('order-1', true));

      act(() => {
        triggerAccepted({
          orderId: 'order-1',
          driverId: 'driver-1',
          status: 'PREPARING',
          version: 5,
        });
      });

      await flush();

      expect(mockGetOrderById).toHaveBeenCalledTimes(2);
      expect(result.current.data?.order.status).toBe('PENDING');
    });

    it('hasil get yang telat tidak menimpa kejadian socket yang lebih baru', async () => {
      const lambat = tertunda<Order>();

      const { result } = renderHook(() => useCustomerOrder('order-1', true));
      await flush();

      mockGetOrderById.mockReturnValueOnce(lambat.janji);
      act(() => {
        triggerConnect();
      });
      await flush();

      act(() => {
        triggerAccepted({
          orderId: 'order-1',
          driverId: 'driver-1',
          status: 'PREPARING',
          version: 9,
        });
      });
      expect(result.current.data?.order.version).toBe(9);

      await act(async () => {
        lambat.selesai({ ...ORDER, version: 2 });
      });

      expect(result.current.data?.order.version).toBe(9);
    });
  });

  describe('koneksi', () => {
    it('terputus saat socket putus dan hilang setelah ambil ulang berhasil', async () => {
      const { result } = renderHook(() => useCustomerOrder('order-1', true));
      await flush();
      expect(result.current.terputus).toBe(false);

      act(() => {
        triggerDisconnect();
      });
      expect(result.current.terputus).toBe(true);

      act(() => {
        triggerConnect();
      });
      await flush();

      expect(result.current.terputus).toBe(false);
    });

    it('terputus tetap kalau socket putus lagi selama ambil ulang berjalan', async () => {
      const lambat = tertunda<Order>();

      const { result } = renderHook(() => useCustomerOrder('order-1', true));
      await flush();

      act(() => {
        triggerDisconnect();
      });
      expect(result.current.terputus).toBe(true);

      mockGetOrderById.mockReturnValueOnce(lambat.janji);
      act(() => {
        triggerConnect();
      });
      await flush();

      act(() => {
        triggerDisconnect();
      });

      await act(async () => {
        lambat.selesai(ORDER);
      });

      expect(result.current.terputus).toBe(true);
    });
  });

  describe('ambil ulang berkala', () => {
    it('ambil ulang tiap 60 detik saat order preparing', async () => {
      mockGetOrderById.mockResolvedValue({ ...ORDER, status: 'PREPARING', driverId: 'driver-1' });

      const { result } = renderHook(() => useCustomerOrder('order-1', true));
      await flush();
      expect(mockGetOrderById).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(AMBIL_ULANG_MS);
      });

      expect(mockGetOrderById).toHaveBeenCalledTimes(2);
      expect(result.current.data?.order.status).toBe('PREPARING');
    });

    it('berhenti saat status bukan preparing dan tidak terputus', async () => {
      renderHook(() => useCustomerOrder('order-1', true));
      await flush();

      await act(async () => {
        jest.advanceTimersByTime(AMBIL_ULANG_MS * 2);
      });

      expect(mockGetOrderById).toHaveBeenCalledTimes(1);
    });

    it('berhenti saat layar tidak terlihat', async () => {
      mockGetOrderById.mockResolvedValue({ ...ORDER, status: 'PREPARING', driverId: 'driver-1' });

      renderHook(() => useCustomerOrder('order-1', false));
      await flush();

      await act(async () => {
        jest.advanceTimersByTime(AMBIL_ULANG_MS * 2);
      });

      expect(mockGetOrderById).toHaveBeenCalledTimes(1);
    });

    it('berhenti saat app masuk latar', async () => {
      mockGetOrderById.mockResolvedValue({ ...ORDER, status: 'PREPARING', driverId: 'driver-1' });

      renderHook(() => useCustomerOrder('order-1', true));
      await flush();

      act(() => {
        pendengarAppState()('background');
      });

      await act(async () => {
        jest.advanceTimersByTime(AMBIL_ULANG_MS * 2);
      });

      expect(mockGetOrderById).toHaveBeenCalledTimes(1);
    });

    it('app kembali aktif memicu ambil ulang', async () => {
      renderHook(() => useCustomerOrder('order-1', true));
      await flush();

      act(() => {
        pendengarAppState()('background');
      });
      act(() => {
        pendengarAppState()('active');
      });
      await flush();

      expect(mockGetOrderById).toHaveBeenCalledTimes(2);
    });
  });

  describe('pelepasan', () => {
    it('dilepas: langganan dilepas dan jawaban yang telat diabaikan', async () => {
      const lambat = tertunda<Order>();
      mockGetOrderById.mockReturnValueOnce(lambat.janji);

      const { result, unmount } = renderHook(() => useCustomerOrder('order-1', true));

      expect(mockAcceptedSubscribers.length).toBe(1);

      unmount();

      expect(mockAcceptedSubscribers.length).toBe(0);
      expect(mockConnectSubscribers.length).toBe(0);

      await act(async () => {
        lambat.selesai(ORDER);
      });

      expect(result.current.data).toBeNull();
    });

    it('orderId berganti: data lama dibuang dan jawaban telat dari order lama diabaikan', async () => {
      const lambat = tertunda<Order>();
      mockGetOrderById
        .mockReturnValueOnce(lambat.janji)
        .mockResolvedValueOnce({ ...ORDER, id: 'order-2' });

      const { result, rerender } = renderHook(
        ({ id }: { id: string }) => useCustomerOrder(id, true),
        { initialProps: { id: 'order-1' } },
      );

      rerender({ id: 'order-2' });
      await flush();

      expect(result.current.data?.order.id).toBe('order-2');

      await act(async () => {
        lambat.selesai({ ...ORDER, id: 'order-1' });
      });

      expect(result.current.data?.order.id).toBe('order-2');
    });
  });
});
