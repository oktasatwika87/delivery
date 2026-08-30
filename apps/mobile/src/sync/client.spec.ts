/**
 * Tests untuk sync/client.ts API functions.
 */

import type { CreateOrderInput, Order } from '@delivery/shared';

// Import module under test (top-level import for jest)
import * as clientModule from './client';

describe('createOrder', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
    // Mock getCurrentToken untuk return token test
    jest.doMock('./session', () => ({
      getCurrentToken: jest.fn().mockResolvedValue('test-token'),
    }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
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

    (global.fetch as jest.Mock).mockResolvedValueOnce({
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
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/orders',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(input),
      })
    );
  });

  it('throw error dengan pesan jelas saat 4xx', async () => {
    const { createOrder } = clientModule;

    (global.fetch as jest.Mock).mockResolvedValueOnce({
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

    (global.fetch as jest.Mock).mockResolvedValueOnce({
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
