/**
 * Unit tests untuk OrdersController.findAvailable()
 *
 * Coverage:
 * 1. findAvailable - DRIVER role -> calls service.findAvailable with correct take
 * 2. findAvailable - non-DRIVER role -> 403 Forbidden
 * 3. findAvailable - take omitted -> defaults to 50
 * 4. findAvailable - take > 100 -> clamped to 100
 * 5. findAvailable - take = 0 -> uses default 50 (0 is falsy, || 50 kicks in)
 * 6. findAvailable - take negative -> Math.max clamps to 1, then || 50, then Math.min clamps
 * 7. findAvailable - take non-numeric -> parseInt returns NaN, NaN || 50 = 50
 * 8. findAvailable - response shape: controller delegates slim AvailableOrderPayload
 *    unchanged (regression guard, sebelumnya return type salah bocor full Order)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';

import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { UserRole } from '@delivery/shared';

describe('OrdersController', () => {
  let controller: OrdersController;
  let mockService: { findAvailable: jest.Mock };

  const driverId = 'driver-uuid';
  const customerId = 'customer-uuid';

  beforeEach(async () => {
    mockService = {
      findAvailable: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        {
          provide: OrdersService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<OrdersController>(OrdersController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAvailable()', () => {
    test('DRIVER role -> calls service.findAvailable with correct take', async () => {
      const result = await controller.findAvailable(driverId, UserRole.DRIVER, '25');

      expect(mockService.findAvailable).toHaveBeenCalledWith(driverId, 25);
      expect(result).toEqual({ items: [], hasMore: false });
    });

    test('non-DRIVER role -> 403 Forbidden', async () => {
      await expect(
        controller.findAvailable(customerId, UserRole.CUSTOMER, '50'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        controller.findAvailable(customerId, UserRole.CUSTOMER, '50'),
      ).rejects.toThrow('Hanya driver yang bisa melihat order tersedia');
      expect(mockService.findAvailable).not.toHaveBeenCalled();
    });

    test('take omitted -> defaults to 50', async () => {
      await controller.findAvailable(driverId, UserRole.DRIVER, undefined);

      expect(mockService.findAvailable).toHaveBeenCalledWith(driverId, 50);
    });

    test('take > 100 -> clamped to 100', async () => {
      await controller.findAvailable(driverId, UserRole.DRIVER, '200');

      expect(mockService.findAvailable).toHaveBeenCalledWith(driverId, 100);
    });

    test('take = 0 -> uses default 50 (0 is falsy)', async () => {
      // parseInt('0') = 0, 0 || 50 = 50
      await controller.findAvailable(driverId, UserRole.DRIVER, '0');

      expect(mockService.findAvailable).toHaveBeenCalledWith(driverId, 50);
    });

    test('take negative -> Math.max(-5, 1) = 1, then Math.min(1, 100) = 1', async () => {
      // parseInt('-5') = -5, -5 || 50 = -5 (truthy), Math.max(-5, 1) = 1, Math.min(1, 100) = 1
      await controller.findAvailable(driverId, UserRole.DRIVER, '-5');

      expect(mockService.findAvailable).toHaveBeenCalledWith(driverId, 1);
    });

    test('take non-numeric -> parseInt returns NaN, NaN || 50 = 50', async () => {
      await controller.findAvailable(driverId, UserRole.DRIVER, 'abc');

      expect(mockService.findAvailable).toHaveBeenCalledWith(driverId, 50);
    });

    /**
     * Regression guard supaya `findAvailable` tidak balik lagi ke `Order[]`
     * (full payload); mobile expect slim `AvailableOrderPayload[]`. Test ini
     * assert controller pass-through adalah OBJECT dengan { items, hasMore },
     * BUKAN array of full Order.
     *
     * response shape: { items: AvailableOrderPayload[], hasMore: boolean }
     */
    test('pass-through response is { items, hasMore } not full Order[]', async () => {
      const response = {
        items: [
          {
            orderId: 'order-aaa',
            totalCents: 50000,
            currency: 'IDR',
            itemsCount: 2,
            city: 'Denpasar',
            createdAt: '2026-08-25T10:00:00.000Z',
          },
        ],
        hasMore: true,
      };
      mockService.findAvailable.mockResolvedValue(response);

      const result = await controller.findAvailable(driverId, UserRole.DRIVER, '50');

      expect(result).toEqual(response);
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toHaveProperty('orderId');
      expect(result.items[0]).toHaveProperty('totalCents');
      expect(result.items[0]).toHaveProperty('currency');
      expect(result.items[0]).toHaveProperty('itemsCount');
      expect(result.items[0]).toHaveProperty('createdAt');
      expect(result).toHaveProperty('hasMore');
      expect(result.hasMore).toBe(true);
      // PENTING: full Order fields TIDAK boleh bocor di response driver pool
      // (customerId, driverId, items[], deliveryAddress, notes, itu private)
      expect(result.items[0]).not.toHaveProperty('id');
      expect(result.items[0]).not.toHaveProperty('customerId');
      expect(result.items[0]).not.toHaveProperty('driverId');
      expect(result.items[0]).not.toHaveProperty('items');
      expect(result.items[0]).not.toHaveProperty('deliveryAddress');
      expect(result.items[0]).not.toHaveProperty('notes');
      expect(result.items[0]).not.toHaveProperty('version');
    });
  });
});
