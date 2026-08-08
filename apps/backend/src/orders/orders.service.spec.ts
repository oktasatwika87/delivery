/**
 * Unit tests untuk OrdersService.cancelOrder(), acceptOrder(), dan rejectOrder()
 *
 * Coverage:
 * 1. acceptOrder - driver berhasil accept order ASSIGNED
 * 2. acceptOrder - retry accept oleh driver yang sama (OCC handle)
 * 3. acceptOrder - gagal: order sudah di-accept driver lain
 * 4. acceptOrder - gagal: order tidak dalam status ASSIGNED
 * 5. acceptOrder - OCC conflict (version mismatch) → 409 Conflict
 * 6. acceptOrder - order tidak ditemukan → 404 NotFound
 * 7. rejectOrder - driver berhasil reject order ASSIGNED
 * 8. rejectOrder - gagal: order tidak dalam status ASSIGNED
 * 9. rejectOrder - OCC conflict → 409 Conflict
 * 10. rejectOrder - order tidak ditemukan → 404 NotFound
 * 11. cancelOrder - berhasil cancel dari ASSIGNED (status CONFIRMED, driverId null, cancelledBy set)
 * 12. cancelOrder - berhasil cancel dari PREPARING
 * 13. cancelOrder - berhasil cancel dari OUT_FOR_DELIVERY
 * 14. cancelOrder - gagal: driver bukan owner (403 Forbidden)
 * 15. cancelOrder - gagal: order tidak dalam status cancellable
 * 16. cancelOrder - OCC conflict → 409 Conflict
 * 17. cancelOrder - order tidak ditemukan → 404 NotFound
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PrismaClient, OrderStatusDb } from '@prisma/client';

import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';

describe('OrdersService', () => {
  let service: OrdersService;
  let mockPrisma: {
    order: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
    $executeRaw: jest.Mock;
  };
  let mockGateway: {
    emitOrderAccepted: jest.Mock;
    emitOrderRejected: jest.Mock;
    emitOrderCancelled: jest.Mock;
  };

  // Test data
  const orderId = 'order-uuid-123';
  const customerId = 'customer-uuid';
  const driverId = 'driver-uuid-1';
  const anotherDriverId = 'driver-uuid-2';
  const version = 1;

  beforeEach(async () => {
    mockPrisma = {
      order: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      $executeRaw: jest.fn(),
    };

    mockGateway = {
      emitOrderAccepted: jest.fn(),
      emitOrderRejected: jest.fn(),
      emitOrderCancelled: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: PrismaClient,
          useValue: mockPrisma,
        },
        {
          provide: OrdersGateway,
          useValue: mockGateway,
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===== acceptOrder tests =====

  describe('acceptOrder()', () => {
    const mockOrderAssigned = {
      id: orderId,
      customerId,
      driverId: null,
      status: OrderStatusDb.ASSIGNED,
      itemsJson: [],
      addressJson: {},
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    test('berhasil accept order ASSIGNED yang belum punya driver', async () => {
      const updatedOrder = {
        ...mockOrderAssigned,
        status: OrderStatusDb.PREPARING,
        driverId,
        version: version + 1,
      };

      mockPrisma.order.findUnique.mockResolvedValue(mockOrderAssigned);
      mockPrisma.order.update.mockResolvedValue(updatedOrder);

      const result = await service.acceptOrder(orderId, version, driverId);

      expect(result.status).toBe('PREPARING');
      expect(result.driverId).toBe(driverId);
      expect(result.version).toBe(version + 1);
      expect(mockGateway.emitOrderAccepted).toHaveBeenCalledWith(
        customerId,
        orderId,
        driverId,
        version + 1,
      );
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: orderId, version },
        data: expect.objectContaining({
          status: OrderStatusDb.PREPARING,
          driverId,
          version: { increment: 1 },
        }),
      });
    });

    test('berhasil retry accept order ASSIGNED oleh driver yang sama (OCC handle)', async () => {
      // Driver yang sama coba accept lagi (misal karena network retry)
      const orderAlreadyAcceptedBySameDriver = {
        ...mockOrderAssigned,
        driverId, // sudah punya driver yang sama
      };
      const updatedOrder = {
        ...orderAlreadyAcceptedBySameDriver,
        status: OrderStatusDb.PREPARING,
        version: version + 1,
      };

      mockPrisma.order.findUnique.mockResolvedValue(orderAlreadyAcceptedBySameDriver);
      mockPrisma.order.update.mockResolvedValue(updatedOrder);

      const result = await service.acceptOrder(orderId, version, driverId);

      expect(result.status).toBe('PREPARING');
      expect(result.driverId).toBe(driverId);
    });

    test('gagal: order sudah di-accept driver lain', async () => {
      const orderAssignedToAnotherDriver = {
        ...mockOrderAssigned,
        driverId: anotherDriverId,
      };

      mockPrisma.order.findUnique.mockResolvedValue(orderAssignedToAnotherDriver);

      await expect(service.acceptOrder(orderId, version, driverId)).rejects.toThrow(
        ConflictException,
      );
      await expect(
        service.acceptOrder(orderId, version, driverId),
      ).rejects.toThrow('already accepted by another driver');
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('gagal: order tidak dalam status ASSIGNED (PENDING)', async () => {
      const orderPending = {
        ...mockOrderAssigned,
        status: OrderStatusDb.PENDING,
      };

      mockPrisma.order.findUnique.mockResolvedValue(orderPending);

      await expect(service.acceptOrder(orderId, version, driverId)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.acceptOrder(orderId, version, driverId),
      ).rejects.toThrow('Cannot accept order in status PENDING');
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('gagal: order tidak dalam status ASSIGNED (CONFIRMED)', async () => {
      const orderConfirmed = {
        ...mockOrderAssigned,
        status: OrderStatusDb.CONFIRMED,
      };

      mockPrisma.order.findUnique.mockResolvedValue(orderConfirmed);

      await expect(service.acceptOrder(orderId, version, driverId)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.acceptOrder(orderId, version, driverId),
      ).rejects.toThrow('Cannot accept order in status CONFIRMED');
    });

    test('gagal: order tidak ditemukan', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(service.acceptOrder(orderId, version, driverId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.acceptOrder(orderId, version, driverId),
      ).rejects.toThrow(`Order ${orderId} not found`);
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('OCC conflict: version mismatch → 409 Conflict', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrderAssigned);
      // Prisma P2025 = record not found (0 rows affected karena version mismatch)
      // Simulate PrismaClientKnownRequestError with code P2025
      const prismaError = Object.assign(
        new Error('Record to update not found.'),
        { code: 'P2025', name: 'PrismaClientKnownRequestError' }
      );
      mockPrisma.order.update.mockRejectedValue(prismaError);

      await expect(service.acceptOrder(orderId, version, driverId)).rejects.toThrow(
        ConflictException,
      );
      await expect(
        service.acceptOrder(orderId, version, driverId),
      ).rejects.toThrow('Order was modified by another request');
    });
  });

  // ===== rejectOrder tests =====

  describe('rejectOrder()', () => {
    const mockOrderAssigned = {
      id: orderId,
      customerId,
      driverId: null,
      status: OrderStatusDb.ASSIGNED,
      itemsJson: [],
      addressJson: {},
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    test('berhasil reject order ASSIGNED', async () => {
      const updatedOrder = {
        ...mockOrderAssigned,
        status: OrderStatusDb.CANCELLED,
        version: version + 1,
      };

      mockPrisma.order.findUnique.mockResolvedValue(mockOrderAssigned);
      mockPrisma.order.update.mockResolvedValue(updatedOrder);

      const result = await service.rejectOrder(orderId, version);

      expect(result.status).toBe('CANCELLED');
      expect(result.version).toBe(version + 1);
      expect(mockGateway.emitOrderRejected).toHaveBeenCalledWith(
        customerId,
        orderId,
        version + 1,
      );
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: orderId, version },
        data: expect.objectContaining({
          status: OrderStatusDb.CANCELLED,
          version: { increment: 1 },
        }),
      });
    });

    test('gagal: order tidak dalam status ASSIGNED (PENDING)', async () => {
      const orderPending = {
        ...mockOrderAssigned,
        status: OrderStatusDb.PENDING,
      };

      mockPrisma.order.findUnique.mockResolvedValue(orderPending);

      await expect(service.rejectOrder(orderId, version)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.rejectOrder(orderId, version),
      ).rejects.toThrow('Cannot reject order in status PENDING');
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('gagal: order tidak ditemukan', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(service.rejectOrder(orderId, version)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.rejectOrder(orderId, version),
      ).rejects.toThrow(`Order ${orderId} not found`);
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('OCC conflict: version mismatch → 409 Conflict', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrderAssigned);
      const prismaError = Object.assign(
        new Error('Record to update not found.'),
        { code: 'P2025', name: 'PrismaClientKnownRequestError' }
      );
      mockPrisma.order.update.mockRejectedValue(prismaError);

      await expect(service.rejectOrder(orderId, version)).rejects.toThrow(
        ConflictException,
      );
      await expect(
        service.rejectOrder(orderId, version),
      ).rejects.toThrow('Order was modified by another request');
    });
  });

  // ===== cancelOrder tests =====

  describe('cancelOrder()', () => {
    // Helper untuk buat mock order dengan status tertentu
    function makeOrderWithDriver(status: OrderStatusDb) {
      return {
        id: orderId,
        customerId,
        driverId,
        status,
        itemsJson: [],
        addressJson: {},
        totalCents: 50000,
        currency: 'IDR',
        notes: null,
        version,
        createdAt: new Date(),
        updatedAt: new Date(),
        cancelledBy: null,
        cancelReason: null,
      };
    }

    test('berhasil cancel dari ASSIGNED - status CONFIRMED, driverId null, cancelledBy set', async () => {
      const mockOrder = makeOrderWithDriver(OrderStatusDb.ASSIGNED);
      const cancelledOrder = {
        ...mockOrder,
        status: OrderStatusDb.CONFIRMED,
        driverId: null,
        cancelledBy: driverId,
        cancelReason: null,
        version: version + 1,
      };

      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue(cancelledOrder);

      const result = await service.cancelOrder(orderId, version, driverId);

      expect(result.status).toBe('CONFIRMED');
      expect(result.driverId).toBeUndefined();
      expect(result.cancelledBy).toBe(driverId);
      expect(result.cancelReason).toBeUndefined();
      expect(result.version).toBe(version + 1);
      expect(mockGateway.emitOrderCancelled).toHaveBeenCalledWith(
        customerId,
        orderId,
        version + 1,
        undefined,
      );
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: orderId, version },
        data: expect.objectContaining({
          status: OrderStatusDb.CONFIRMED,
          driverId: null,
          cancelledBy: driverId,
          cancelReason: undefined,
          version: { increment: 1 },
        }),
      });
    });

    test('berhasil cancel dari PREPARING dengan reason', async () => {
      const mockOrder = makeOrderWithDriver(OrderStatusDb.PREPARING);
      const cancelledOrder = {
        ...mockOrder,
        status: OrderStatusDb.CONFIRMED,
        driverId: null,
        cancelledBy: driverId,
        cancelReason: 'Kendaraan mogok',
        version: version + 1,
      };

      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue(cancelledOrder);

      const result = await service.cancelOrder(orderId, version, driverId, 'Kendaraan mogok');

      expect(result.status).toBe('CONFIRMED');
      expect(result.driverId).toBeUndefined();
      expect(result.cancelledBy).toBe(driverId);
      expect(result.cancelReason).toBe('Kendaraan mogok');
    });

    test('berhasil cancel dari OUT_FOR_DELIVERY', async () => {
      const mockOrder = makeOrderWithDriver(OrderStatusDb.OUT_FOR_DELIVERY);
      const cancelledOrder = {
        ...mockOrder,
        status: OrderStatusDb.CONFIRMED,
        driverId: null,
        cancelledBy: driverId,
        cancelReason: null,
        version: version + 1,
      };

      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue(cancelledOrder);

      const result = await service.cancelOrder(orderId, version, driverId);

      expect(result.status).toBe('CONFIRMED');
    });

    test('gagal: driver bukan owner (403 Forbidden)', async () => {
      const mockOrder = makeOrderWithDriver(OrderStatusDb.PREPARING);
      // Order assigned to anotherDriverId
      const orderAssignedToOther = {
        ...mockOrder,
        driverId: anotherDriverId,
      };

      mockPrisma.order.findUnique.mockResolvedValue(orderAssignedToOther);

      await expect(
        service.cancelOrder(orderId, version, driverId),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.cancelOrder(orderId, version, driverId),
      ).rejects.toThrow('You are not assigned to this order');
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('gagal: order tidak dalam status cancellable (PENDING)', async () => {
      const mockOrder = makeOrderWithDriver(OrderStatusDb.PENDING);

      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);

      await expect(
        service.cancelOrder(orderId, version, driverId),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.cancelOrder(orderId, version, driverId),
      ).rejects.toThrow('Cannot cancel order in status PENDING');
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('gagal: order tidak dalam status cancellable (DELIVERED)', async () => {
      const mockOrder = makeOrderWithDriver(OrderStatusDb.DELIVERED);

      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);

      await expect(
        service.cancelOrder(orderId, version, driverId),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.cancelOrder(orderId, version, driverId),
      ).rejects.toThrow('Cannot cancel order in status DELIVERED');
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('gagal: order tidak ditemukan', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.cancelOrder(orderId, version, driverId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.cancelOrder(orderId, version, driverId),
      ).rejects.toThrow(`Order ${orderId} not found`);
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('OCC conflict: version mismatch → 409 Conflict', async () => {
      const mockOrder = makeOrderWithDriver(OrderStatusDb.ASSIGNED);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);

      // Prisma P2025 = record not found (version mismatch in OCC)
      const prismaError = Object.assign(
        new Error('Record to update not found.'),
        { code: 'P2025', name: 'PrismaClientKnownRequestError' }
      );
      mockPrisma.order.update.mockRejectedValue(prismaError);

      await expect(
        service.cancelOrder(orderId, version, driverId),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.cancelOrder(orderId, version, driverId),
      ).rejects.toThrow('Order was modified by another request');
    });
  });
});
