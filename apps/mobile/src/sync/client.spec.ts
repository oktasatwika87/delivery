/**
 * Tests untuk sync/client.ts API functions.
 */

import type { CreateOrderInput, Order } from '@delivery/shared';

// Import module under test (top-level import for jest)
import * as clientModule from './client';
import * as syncEventsModule from './syncEvents';

describe('pullBatch dengan heldOrderIds', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = jest.fn();
    jest.doMock('./session', () => ({
      getCurrentToken: jest.fn().mockResolvedValue('test-token'),
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('tidak mengirim parameter heldOrderIds ketika daftar kosong', async () => {
    const { pullBatch } = clientModule;
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ nextCursor: null, records: [], serverTime: new Date().toISOString() }),
    });

    await pullBatch('device-1', null, []);

    const url = (globalThis.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).not.toContain('heldOrderIds');
  });

  it('mengirim heldOrderIds hasil encodeURIComponent ketika daftar berisi id', async () => {
    const { pullBatch } = clientModule;
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ nextCursor: null, records: [], serverTime: new Date().toISOString() }),
    });

    await pullBatch('device-1', null, ['order-1', 'order-2']);

    const url = (globalThis.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain('heldOrderIds=order-1%2Corder-2');
  });
});

describe('createOrder', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = jest.fn();
    // Mock getCurrentToken untuk return token test
    jest.doMock('./session', () => ({
      getCurrentToken: jest.fn().mockResolvedValue('test-token'),
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('201: sukses buat order, return parsed Order', async () => {
    const { createOrder } = clientModule;

    const mockOrder: Order = {
      id: 'order-123',
      customerId: 'user-456',
      status: 'PENDING',
      items: [
        { id: 'item-1', productId: 'prod-1', name: 'Nasi Goreng', quantity: 2, unitPriceCents: 25000 },
      ],
      deliveryAddress: {
        recipientName: 'Budi',
        phone: '081234567890',
        street: 'Jl. Merdeka No. 1',
        city: 'Jakarta',
        postalCode: '10110',
      },
      totalCents: 50000,
      currency: 'IDR',
      version: 1,
      createdAt: '2026-08-30T00:00:00.000Z',
      updatedAt: '2026-08-30T00:00:00.000Z',
    };

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: () => Promise.resolve(mockOrder),
    });

    const input: CreateOrderInput = {
      items: [
        { productId: 'prod-1', name: 'Nasi Goreng', quantity: 2, unitPriceCents: 25000 },
      ],
      deliveryAddress: {
        recipientName: 'Budi',
        phone: '081234567890',
        street: 'Jl. Merdeka No. 1',
        city: 'Jakarta',
        postalCode: '10110',
      },
    };

    const result = await createOrder(input);

    expect(result).toEqual(mockOrder);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/orders',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(input),
      })
    );
  });

  it('throw error dengan pesan jelas saat 4xx', async () => {
    const { createOrder } = clientModule;

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      status: 403,
      ok: false,
      text: () => Promise.resolve('Only customers can create orders'),
    });

    const input: CreateOrderInput = {
      items: [{ productId: 'p1', name: 'Item', quantity: 1, unitPriceCents: 10000 }],
      deliveryAddress: { recipientName: 'X', phone: '0', street: 'Y', city: 'Z', postalCode: '0' },
    };

    await expect(createOrder(input)).rejects.toThrow('Gagal membuat order: 403 - Only customers can create orders');
  });

  it('throw error dengan pesan jelas saat 5xx', async () => {
    const { createOrder } = clientModule;

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      status: 500,
      ok: false,
      text: () => Promise.resolve('Internal Server Error'),
    });

    const input: CreateOrderInput = {
      items: [{ productId: 'p1', name: 'Item', quantity: 1, unitPriceCents: 10000 }],
      deliveryAddress: { recipientName: 'X', phone: '0', street: 'Y', city: 'Z', postalCode: '0' },
    };

    await expect(createOrder(input)).rejects.toThrow('Gagal membuat order: 500 - Internal Server Error');
  });
});

// 401 dari server harus memicu 'auth-expired' lewat syncEvents dengan token
// yang dipakai untuk request itu. 401 tanpa token, 403, dan 500: tidak ada
// event. Setelah emit, fungsi pemanggil tetap melempar UnauthorizedError.

describe('fetchWithAuth: 401 memicu auth-expired dengan token yang dipakai', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jest.resetModules();
    globalThis.fetch = jest.fn();
    jest.doMock('./session', () => ({
      getCurrentToken: jest.fn().mockResolvedValue('test-token'),
    }));
    jest.doMock('./syncEvents', () => ({
      syncEvents: {
        emit: jest.fn(),
        on: jest.fn(),
        off: jest.fn(),
      },
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('getOrderById menerima 401: auth-expired dipancarkan sekali dengan token itu, fungsi melempar UnauthorizedError', async () => {
    const syncEvents = jest.requireMock<typeof import('./syncEvents')>('./syncEvents');
    const { getOrderById, UnauthorizedError } = jest.requireActual<typeof import('./client')>('./client');

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      status: 401,
      ok: false,
      json: () => Promise.reject(new Error('not used')),
    });

    await expect(getOrderById('order-123')).rejects.toBeInstanceOf(UnauthorizedError);

    expect(syncEvents.syncEvents.emit).toHaveBeenCalledTimes(1);
    expect(syncEvents.syncEvents.emit).toHaveBeenCalledWith(
      'auth-expired',
      { source: 'http', token: 'test-token' },
    );
  });

  it('401 tanpa token tersimpan: tidak ada event', async () => {
    jest.doMock('./session', () => ({
      getCurrentToken: jest.fn().mockResolvedValue(null),
    }));
    const syncEvents = jest.requireMock<typeof import('./syncEvents')>('./syncEvents');
    const { getOrderById, UnauthorizedError } = jest.requireActual<typeof import('./client')>('./client');

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      status: 401,
      ok: false,
      json: () => Promise.reject(new Error('not used')),
    });

    await expect(getOrderById('order-123')).rejects.toBeInstanceOf(UnauthorizedError);

    expect(syncEvents.syncEvents.emit).not.toHaveBeenCalled();
  });

  it('403: tidak ada event', async () => {
    const syncEvents = jest.requireMock<typeof import('./syncEvents')>('./syncEvents');
    const { getOrderById } = jest.requireActual<typeof import('./client')>('./client');

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      status: 403,
      ok: false,
      text: () => Promise.resolve('forbidden'),
    });

    await expect(getOrderById('order-123')).rejects.toThrow('getOrderById failed: 403');

    expect(syncEvents.syncEvents.emit).not.toHaveBeenCalled();
  });

  it('500: tidak ada event', async () => {
    const syncEvents = jest.requireMock<typeof import('./syncEvents')>('./syncEvents');
    const { getOrderById } = jest.requireActual<typeof import('./client')>('./client');

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      status: 500,
      ok: false,
      text: () => Promise.resolve('server error'),
    });

    await expect(getOrderById('order-123')).rejects.toThrow('getOrderById failed: 500');

    expect(syncEvents.syncEvents.emit).not.toHaveBeenCalled();
  });
});

describe('fetchAvailableOrders: timeout 8 detik', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jest.resetModules();
    globalThis.fetch = jest.fn();
    jest.doMock('./session', () => ({
      getCurrentToken: jest.fn().mockResolvedValue('test-token'),
    }));
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('request dibatalkan timeout: fungsi melempar galat AbortError, bukan daftar kosong', async () => {
    const { fetchAvailableOrders } = jest.requireActual<typeof import('./client')>('./client');

    // Fetch tiruan menolak dengan galat bernama AbortError kalau signal-nya
    // di-abort. Kalau signal sudah di-abort sebelum fetch dipanggil, langsung
    // menolak juga.
    (globalThis.fetch as jest.Mock).mockImplementation(
      (_url: string, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          const batal = () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          };
          if (options.signal?.aborted) {
            batal();
            return;
          }
          options.signal?.addEventListener('abort', batal);
        }),
    );

    const panggil = fetchAvailableOrders();
    const harapan = expect(panggil).rejects.toMatchObject({ name: 'AbortError' });

    // Beri waktu modul client menyelesaikan await token dan memanggil fetch.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    jest.advanceTimersByTime(8000);

    await harapan;
  });
});

void syncEventsModule;
