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
      create: jest.Mock;
    };
    $executeRaw: jest.Mock;
  };
  let mockGateway: {
    emitOrderAccepted: jest.Mock;
    emitOrderRejected: jest.Mock;
    emitOrderCancelled: jest.Mock;
    emitOrderAvailable: jest.Mock;
    emitOrderUnavailable: jest.Mock;
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
        create: jest.fn(),
      },
      $executeRaw: jest.fn(),
    };

    mockGateway = {
      emitOrderAccepted: jest.fn(),
      emitOrderRejected: jest.fn(),
      emitOrderCancelled: jest.fn(),
      emitOrderAvailable: jest.fn(),
      emitOrderUnavailable: jest.fn(),
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
      expect(mockGateway.emitOrderUnavailable).toHaveBeenCalledWith(orderId, 'accepted');
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

  // ===== create() tests =====

  describe('create()', () => {
    const validInput = {
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

    const mockCreatedOrder = {
      id: 'new-order-id',
      customerId,
      driverId: null,
      status: OrderStatusDb.PENDING,
      itemsJson: validInput.items,
      addressJson: validInput.deliveryAddress,
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      cancelledBy: null,
      cancelReason: null,
    };

    test('berhasil create order dengan input valid', async () => {
      mockPrisma.order.create.mockResolvedValue(mockCreatedOrder);

      const result = await service.create(validInput, customerId);

      expect(result.id).toBe('new-order-id');
      expect(result.status).toBe('PENDING');
      expect(result.totalCents).toBe(50000);
      expect(mockPrisma.order.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerId,
          itemsJson: validInput.items,
          addressJson: validInput.deliveryAddress,
          totalCents: 50000,
          currency: 'IDR',
        }),
      });
    });

    test('totalCents dihitung dari quantity × unitPriceCents', async () => {
      mockPrisma.order.create.mockResolvedValue({
        ...mockCreatedOrder,
        totalCents: 150000,
      });

      await service.create(
        {
          items: [
            { productId: 'p1', name: 'Item 1', quantity: 3, unitPriceCents: 50000 },
          ],
          deliveryAddress: validInput.deliveryAddress,
        },
        customerId,
      );

      expect(mockPrisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            totalCents: 150000,
          }),
        }),
      );
    });
  });

  // ===== rejectOrder tests =====

  describe('rejectOrder()', () => {
    // FIX (2026-09): rejectOrder now requires ownership (driverId param) and
    // transitions back to CONFIRMED (reassign-able), not terminal CANCELLED —
    // see the method's own doc comment in orders.service.ts for the full
    // rationale. mockOrderAssigned now has driverId set to the calling driver
    // (not null) to reflect that reject only ever makes sense for an order
    // actually assigned to that driver — a pool item (driverId: null) can
    // never belong to anyone, so it can never legitimately be rejected.
    const mockOrderAssigned = {
      id: orderId,
      customerId,
      driverId,
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

    test('berhasil reject order ASSIGNED yang di-assign ke driver ybs → balik CONFIRMED, reassign-able', async () => {
      const updatedOrder = {
        ...mockOrderAssigned,
        status: OrderStatusDb.CONFIRMED,
        driverId: null,
        version: version + 1,
      };

      mockPrisma.order.findUnique.mockResolvedValue(mockOrderAssigned);
      mockPrisma.order.update.mockResolvedValue(updatedOrder);

      const result = await service.rejectOrder(orderId, version, driverId);

      expect(result.status).toBe('CONFIRMED');
      expect(result.driverId).toBeUndefined();
      expect(result.version).toBe(version + 1);
      expect(mockGateway.emitOrderRejected).toHaveBeenCalledWith(
        customerId,
        orderId,
        version + 1,
      );
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: orderId, version },
        data: expect.objectContaining({
          status: OrderStatusDb.CONFIRMED,
          driverId: null,
          version: { increment: 1 },
        }),
      });
    });

    test('gagal: driver bukan owner (403 Forbidden) — termasuk order pool (driverId null)', async () => {
      // Order pool: driverId null — tidak dimiliki siapa pun, jadi tidak
      // reachable untuk direject oleh driver manapun. Ini kasus yang dulu
      // jadi celah (siapa pun bisa reject order pool orang lain).
      const orderPool = {
        ...mockOrderAssigned,
        driverId: null,
      };

      mockPrisma.order.findUnique.mockResolvedValue(orderPool);

      await expect(
        service.rejectOrder(orderId, version, driverId),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.rejectOrder(orderId, version, driverId),
      ).rejects.toThrow('You are not assigned to this order');
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('gagal: driver bukan owner (403 Forbidden) — order milik driver lain', async () => {
      const orderAssignedToOther = {
        ...mockOrderAssigned,
        driverId: anotherDriverId,
      };

      mockPrisma.order.findUnique.mockResolvedValue(orderAssignedToOther);

      await expect(
        service.rejectOrder(orderId, version, driverId),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('gagal: order tidak dalam status ASSIGNED (PENDING)', async () => {
      const orderPending = {
        ...mockOrderAssigned,
        status: OrderStatusDb.PENDING,
      };

      mockPrisma.order.findUnique.mockResolvedValue(orderPending);

      await expect(service.rejectOrder(orderId, version, driverId)).rejects.toThrow(
        BadRequestException,
      );
      await expect(
        service.rejectOrder(orderId, version, driverId),
      ).rejects.toThrow('Cannot reject order in status PENDING');
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('gagal: order tidak ditemukan', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(service.rejectOrder(orderId, version, driverId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(
        service.rejectOrder(orderId, version, driverId),
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

      await expect(service.rejectOrder(orderId, version, driverId)).rejects.toThrow(
        ConflictException,
      );
      await expect(
        service.rejectOrder(orderId, version, driverId),
      ).rejects.toThrow('Order was modified by another request');
    });

    test('OCC conflict: response body memuat code VERSION_CONFLICT', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrderAssigned);
      const prismaError = Object.assign(
        new Error('Record to update not found.'),
        { code: 'P2025', name: 'PrismaClientKnownRequestError' }
      );
      mockPrisma.order.update.mockRejectedValue(prismaError);

      let caught: any;
      try {
        await service.rejectOrder(orderId, version, driverId);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      const response = caught.getResponse();
      expect(response).toMatchObject({
        code: 'VERSION_CONFLICT',
        message: expect.stringContaining('Order was modified by another request'),
      });
    });

    test('reject bukan owner → response body memuat code ORDER_NOT_ASSIGNED', async () => {
      const orderAssignedToOther = {
        ...mockOrderAssigned,
        driverId: anotherDriverId,
      };
      mockPrisma.order.findUnique.mockResolvedValue(orderAssignedToOther);

      let caught: any;
      try {
        await service.rejectOrder(orderId, version, driverId);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ForbiddenException);
      const response = caught.getResponse();
      expect(response).toMatchObject({
        code: 'ORDER_NOT_ASSIGNED',
      });
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

    // Skenario A (Temuan 1): body response harus berisi machine-readable
    // `code: 'VERSION_CONFLICT'` supaya mobile outbox.ts isVersionConflict()
    // bisa deteksi tanpa parse pesan. Body object di-pass langsung ke
    // ConflictException, Nest HTTP exception filter serialize as-is.
    test('OCC conflict: response body memuat code VERSION_CONFLICT', async () => {
      const mockOrder = makeOrderWithDriver(OrderStatusDb.ASSIGNED);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);

      const prismaError = Object.assign(
        new Error('Record to update not found.'),
        { code: 'P2025', name: 'PrismaClientKnownRequestError' }
      );
      mockPrisma.order.update.mockRejectedValue(prismaError);

      let caught: any;
      try {
        await service.cancelOrder(orderId, version, driverId);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      const response = caught.getResponse();
      expect(response).toMatchObject({
        code: 'VERSION_CONFLICT',
        message: expect.stringContaining('Order was modified by another request'),
      });
    });

    test('cancel non-cancellable status → response body memuat code ORDER_NOT_CANCELLABLE', async () => {
      const mockOrder = makeOrderWithDriver(OrderStatusDb.PENDING);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);

      let caught: any;
      try {
        await service.cancelOrder(orderId, version, driverId);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      const response = caught.getResponse();
      expect(response).toMatchObject({
        code: 'ORDER_NOT_CANCELLABLE',
      });
    });

    test('cancel bukan owner → response body memuat code ORDER_NOT_ASSIGNED', async () => {
      const mockOrder = makeOrderWithDriver(OrderStatusDb.ASSIGNED);
      const orderAssignedToOther = {
        ...mockOrder,
        driverId: anotherDriverId,
      };
      mockPrisma.order.findUnique.mockResolvedValue(orderAssignedToOther);

      let caught: any;
      try {
        await service.cancelOrder(orderId, version, driverId);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ForbiddenException);
      const response = caught.getResponse();
      expect(response).toMatchObject({
        code: 'ORDER_NOT_ASSIGNED',
      });
    });
  });

  // ===== transitionStatus tests =====

  describe('transitionStatus()', () => {
    function makeOrder(status: OrderStatusDb, driverId: string | null) {
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

    test('order masuk pool (CONFIRMED→ASSIGNED, driverId=null) → emitOrderAvailable', async () => {
      const currentOrder = makeOrder(OrderStatusDb.CONFIRMED, null);
      const updatedOrder = {
        ...currentOrder,
        status: OrderStatusDb.ASSIGNED,
        version: version + 1,
      };

      mockPrisma.order.findUnique.mockResolvedValue(currentOrder);
      mockPrisma.order.update.mockResolvedValue(updatedOrder);

      const result = await service.transitionStatus(orderId, 'ASSIGNED', version, customerId);

      expect(result.status).toBe('ASSIGNED');
      expect(mockGateway.emitOrderAvailable).toHaveBeenCalledWith(
        expect.objectContaining({ id: orderId, status: 'ASSIGNED' })
      );
      expect(mockGateway.emitOrderUnavailable).not.toHaveBeenCalled();
    });

    test('order keluar pool (ASSIGNED→CANCELLED, driverId=null) → emitOrderUnavailable reassigned', async () => {
      const currentOrder = makeOrder(OrderStatusDb.ASSIGNED, null);
      const updatedOrder = {
        ...currentOrder,
        status: OrderStatusDb.CANCELLED,
        version: version + 1,
      };

      mockPrisma.order.findUnique.mockResolvedValue(currentOrder);
      mockPrisma.order.update.mockResolvedValue(updatedOrder);

      const result = await service.transitionStatus(orderId, 'CANCELLED', version, customerId);

      expect(result.status).toBe('CANCELLED');
      expect(mockGateway.emitOrderUnavailable).toHaveBeenCalledWith(orderId, 'reassigned');
      expect(mockGateway.emitOrderAvailable).not.toHaveBeenCalled();
    });

    test('transisi tidak melibatkan pool (PREPARING→OUT_FOR_DELIVERY) → neither emit', async () => {
      const currentOrder = makeOrder(OrderStatusDb.PREPARING, driverId);
      const updatedOrder = {
        ...currentOrder,
        status: OrderStatusDb.OUT_FOR_DELIVERY,
        version: version + 1,
      };

      mockPrisma.order.findUnique.mockResolvedValue(currentOrder);
      mockPrisma.order.update.mockResolvedValue(updatedOrder);

      const result = await service.transitionStatus(orderId, 'OUT_FOR_DELIVERY', version, driverId);

      expect(result.status).toBe('OUT_FOR_DELIVERY');
      expect(mockGateway.emitOrderAvailable).not.toHaveBeenCalled();
      expect(mockGateway.emitOrderUnavailable).not.toHaveBeenCalled();
    });
  });

  // ===== findAvailable tests =====

  describe('findAvailable()', () => {
    const driverId = 'driver-uuid-1';

    function makeAvailableOrder(overrideId: string, overrideCreatedAt: Date) {
      return {
        id: overrideId,
        customerId: 'customer-uuid',
        driverId: null as string | null,
        status: OrderStatusDb.ASSIGNED,
        itemsJson: [{ id: 'item-1', productId: 'prod-1', name: 'Nasi Goreng', quantity: 2, unitPriceCents: 25000 }],
        addressJson: { recipientName: 'Budi', phone: '0812', street: 'Jl. Merdeka', city: 'Denpasar' },
        totalCents: 50000,
        currency: 'IDR',
        notes: null as string | null,
        version: 1,
        createdAt: overrideCreatedAt,
        updatedAt: overrideCreatedAt,
        cancelledBy: null as string | null,
        cancelReason: null as string | null,
      };
    }

    test('returns slim AvailableOrderPayload (not full Order) sorted by createdAt ASC', async () => {
      const now = new Date();
      const order1 = makeAvailableOrder('order-1', new Date(now.getTime() - 10000));
      const order2 = makeAvailableOrder('order-2', now);
      const order3 = makeAvailableOrder('order-3', new Date(now.getTime() + 10000));

      // Mock findMany - will be called with correct filters
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([order1, order2, order3]);

      const result = await service.findAvailable(driverId, 50);

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith({
        where: {
          status: OrderStatusDb.ASSIGNED,
          driverId: null,
          deletedAt: null,
        },
        take: 50,
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(3);
      // Slim shape: orderId (bukan `id` dari full Order)
      expect(result[0].orderId).toBe('order-1');
      expect(result[1].orderId).toBe('order-2');
      expect(result[2].orderId).toBe('order-3');
      // PENTING: payload TIDAK boleh bocor full Order fields seperti `customerId`,
      // `driverId`, `notes`, `version`, `cancelledBy`, `cancelReason`, `items`,
      // `deliveryAddress`. Type assertion catch-all untuk regressions.
      for (const item of result) {
        expect(item).not.toHaveProperty('id');
        expect(item).not.toHaveProperty('customerId');
        expect(item).not.toHaveProperty('driverId');
        expect(item).not.toHaveProperty('notes');
        expect(item).not.toHaveProperty('version');
        expect(item).not.toHaveProperty('items');
        expect(item).not.toHaveProperty('deliveryAddress');
      }
    });

    test('maps slim payload fields correctly: orderId, totalCents, currency, itemsCount, city, createdAt', async () => {
      const createdAt = new Date('2026-08-25T10:00:00.000Z');
      const order = makeAvailableOrder('order-1', createdAt);
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([order]);

      const result = await service.findAvailable(driverId, 50);

      expect(result).toHaveLength(1);
      const item = result[0];
      expect(item.orderId).toBe('order-1');
      expect(item.totalCents).toBe(50000);
      expect(item.currency).toBe('IDR');
      // itemsJson array berisi 1 line item → itemsCount = 1
      expect(item.itemsCount).toBe(1);
      // city di-extract dari addressJson
      expect(item.city).toBe('Denpasar');
      // createdAt jadi ISO 8601 string, bukan Date object
      expect(item.createdAt).toBe('2026-08-25T10:00:00.000Z');
      expect(typeof item.createdAt).toBe('string');
    });

    test('itemsCount reflects items array length (multiple items)', async () => {
      const order = {
        ...makeAvailableOrder('order-multi', new Date()),
        itemsJson: [
          { id: 'item-1', productId: 'p1', name: 'A', quantity: 1, unitPriceCents: 10000 },
          { id: 'item-2', productId: 'p2', name: 'B', quantity: 2, unitPriceCents: 15000 },
          { id: 'item-3', productId: 'p3', name: 'C', quantity: 1, unitPriceCents: 20000 },
        ],
      };
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([order]);

      const result = await service.findAvailable(driverId, 50);

      expect(result[0].itemsCount).toBe(3);
    });

    test('itemsCount falls back to 0 if itemsJson is not an array (defensive)', async () => {
      // Edge case: data integrity issue, itemsJson somehow bukan array
      const order = {
        ...makeAvailableOrder('order-corrupt', new Date()),
        itemsJson: 'not-an-array' as unknown,
      };
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([order]);

      const result = await service.findAvailable(driverId, 50);

      expect(result[0].itemsCount).toBe(0);
    });

    test('city is undefined if addressJson missing city field', async () => {
      const order = {
        ...makeAvailableOrder('order-no-city', new Date()),
        addressJson: { recipientName: 'Budi', phone: '0812', street: 'Jl. Merdeka' /* no city */ },
      };
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([order]);

      const result = await service.findAvailable(driverId, 50);

      expect(result[0].city).toBeUndefined();
    });

    test('city is undefined if addressJson is null or non-object (defensive)', async () => {
      const order = {
        ...makeAvailableOrder('order-bad-addr', new Date()),
        addressJson: null as unknown,
      };
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([order]);

      const result = await service.findAvailable(driverId, 50);

      expect(result[0].city).toBeUndefined();
    });

    test('respects take parameter - pass through to Prisma', async () => {
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([]);

      // Service just passes through whatever take value it receives
      await service.findAvailable(driverId, 25);
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 25 })
      );
    });

    test('respects take parameter - pass through to Prisma (100)', async () => {
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([]);

      await service.findAvailable(driverId, 100);
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 })
      );
    });

    test('respects take parameter - pass through to Prisma (200)', async () => {
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([]);

      // Service passes 200 through — clamping is controller's responsibility
      await service.findAvailable(driverId, 200);
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 })
      );
    });

    test('excludes deleted orders (deletedAt !== null)', async () => {
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([]);

      await service.findAvailable(driverId, 50);

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deletedAt: null,
          }),
        })
      );
    });

    test('excludes orders with driverId !== null', async () => {
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([]);

      await service.findAvailable(driverId, 50);

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            driverId: null,
          }),
        })
      );
    });

    test('returns empty array when no available orders', async () => {
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([]);

      const result = await service.findAvailable(driverId, 50);

      expect(result).toEqual([]);
    });
  });
});
