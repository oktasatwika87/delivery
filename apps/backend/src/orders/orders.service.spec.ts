/**
 * Unit tests untuk OrdersService.cancelOrder(), acceptOrder(), dan rejectOrder()
 *
 * Coverage:
 * 1. acceptOrder - driver berhasil accept order ASSIGNED
 * 2. acceptOrder - retry accept oleh driver yang sama (OCC handle)
 * 3. acceptOrder - gagal: order sudah di-accept driver lain → 409 ORDER_UNAVAILABLE
 * 4. acceptOrder - gagal: order tidak dalam status ASSIGNED (PENDING) → 409 ORDER_UNAVAILABLE
 * 5. acceptOrder - gagal: order tidak dalam status ASSIGNED (CONFIRMED) → 409 ORDER_UNAVAILABLE
 * 6. acceptOrder - gagal: order tidak dalam status ASSIGNED (PREPARING) → 409 ORDER_UNAVAILABLE
 * 7. acceptOrder - OCC conflict (version mismatch) → 409 VERSION_CONFLICT
 * 8. acceptOrder - order tidak ditemukan → 404 NotFound
 * 9. rejectOrder - driver berhasil reject order ASSIGNED
 * 10. rejectOrder - gagal: order tidak dalam status ASSIGNED
 * 11. rejectOrder - OCC conflict → 409 Conflict
 * 12. rejectOrder - order tidak ditemukan → 404 NotFound
 * 13. cancelOrder - berhasil cancel dari ASSIGNED (status CONFIRMED, driverId null, cancelledBy set)
 * 14. cancelOrder - berhasil cancel dari PREPARING
 * 15. cancelOrder - berhasil cancel dari OUT_FOR_DELIVERY
 * 16. cancelOrder - gagal: driver bukan owner (403 Forbidden)
 * 17. cancelOrder - gagal: order tidak dalam status cancellable
 * 18. cancelOrder - OCC conflict → 409 Conflict
 * 19. cancelOrder - order tidak ditemukan → 404 NotFound
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
    emitOrderStatusUpdated: jest.Mock;
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
      emitOrderStatusUpdated: jest.fn(),
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

    test('gagal: order sudah di-accept driver lain → 409 ORDER_UNAVAILABLE', async () => {
      const orderAssignedToAnotherDriver = {
        ...mockOrderAssigned,
        driverId: anotherDriverId,
      };

      mockPrisma.order.findUnique.mockResolvedValue(orderAssignedToAnotherDriver);

      let caught: unknown;
      try {
        await service.acceptOrder(orderId, version, driverId);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      const response = (caught as ConflictException).getResponse();
      expect(response).toMatchObject({
        code: 'ORDER_UNAVAILABLE',
        message: expect.stringContaining('already accepted by another driver'),
      });
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('gagal: order tidak dalam status ASSIGNED (PENDING) → 409 ORDER_UNAVAILABLE', async () => {
      const orderPending = {
        ...mockOrderAssigned,
        status: OrderStatusDb.PENDING,
      };

      mockPrisma.order.findUnique.mockResolvedValue(orderPending);

      let caught: unknown;
      try {
        await service.acceptOrder(orderId, version, driverId);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      const response = (caught as ConflictException).getResponse();
      expect(response).toMatchObject({
        code: 'ORDER_UNAVAILABLE',
        message: expect.stringContaining('Cannot accept order in status PENDING'),
      });
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('gagal: order tidak dalam status ASSIGNED (CONFIRMED) → 409 ORDER_UNAVAILABLE', async () => {
      const orderConfirmed = {
        ...mockOrderAssigned,
        status: OrderStatusDb.CONFIRMED,
      };

      mockPrisma.order.findUnique.mockResolvedValue(orderConfirmed);

      let caught: unknown;
      try {
        await service.acceptOrder(orderId, version, driverId);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      const response = (caught as ConflictException).getResponse();
      expect(response).toMatchObject({
        code: 'ORDER_UNAVAILABLE',
        message: expect.stringContaining('Cannot accept order in status CONFIRMED'),
      });
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('gagal: order tidak dalam status ASSIGNED (PREPARING) → 409 ORDER_UNAVAILABLE', async () => {
      const orderPreparing = {
        ...mockOrderAssigned,
        status: OrderStatusDb.PREPARING,
      };

      mockPrisma.order.findUnique.mockResolvedValue(orderPreparing);

      let caught: unknown;
      try {
        await service.acceptOrder(orderId, version, driverId);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      const response = (caught as ConflictException).getResponse();
      expect(response).toMatchObject({
        code: 'ORDER_UNAVAILABLE',
        message: expect.stringContaining('Cannot accept order in status PREPARING'),
      });
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
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

    test('OCC conflict: response body memuat code VERSION_CONFLICT', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrderAssigned);
      const prismaError = Object.assign(
        new Error('Record to update not found.'),
        { code: 'P2025', name: 'PrismaClientKnownRequestError' }
      );
      mockPrisma.order.update.mockRejectedValue(prismaError);

      let caught: unknown;
      try {
        await service.acceptOrder(orderId, version, driverId);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      const response = (caught as ConflictException).getResponse();
      expect(response).toMatchObject({
        code: 'VERSION_CONFLICT',
        message: expect.stringContaining('Order was modified by another request'),
      });
    });

    // Temuan 4: order di-cron keluar ASSIGNED dengan cancelReason 'system_timeout',
    // lalu di-accept → data update harus menghapus cancelledBy/cancelReason dan
    // toDomain tidak membawa cancelReason.
    test('accept order yang sebelumnya di-cron: cancelledBy & cancelReason di-clear', async () => {
      const reassignedOrder = {
        ...mockOrderAssigned,
        cancelledBy: 'SYSTEM',
        cancelReason: 'system_timeout',
      };
      const acceptedOrder = {
        ...reassignedOrder,
        status: OrderStatusDb.PREPARING,
        driverId,
        cancelledBy: null,
        cancelReason: null,
        version: version + 1,
      };

      mockPrisma.order.findUnique.mockResolvedValue(reassignedOrder);
      mockPrisma.order.update.mockResolvedValue(acceptedOrder);

      const result = await service.acceptOrder(orderId, version, driverId);

      // Update call harus menulis kedua field ke null
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: orderId, version },
        data: expect.objectContaining({
          status: OrderStatusDb.PREPARING,
          driverId,
          cancelledBy: null,
          cancelReason: null,
          version: { increment: 1 },
        }),
      });
      // toDomain tidak bawa cancelReason (null → undefined)
      expect(result.cancelReason).toBeUndefined();
      expect(result.cancelledBy).toBeUndefined();
      expect(result.status).toBe('PREPARING');
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

    // Order baru lahir ASSIGNED + driverId null (pool state). Sebelumnya
    // PENDING lalu di-confirm manual, sekarang create() otomatis masuk pool,
    // sehingga emitOrderAvailable dipanggil supaya driver yang online
    // langsung lihat order baru tanpa harus pull REST.
    const mockCreatedOrder = {
      id: 'new-order-id',
      customerId,
      driverId: null,
      status: OrderStatusDb.ASSIGNED,
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

    test('berhasil create order: born ASSIGNED + masuk pool', async () => {
      mockPrisma.order.create.mockResolvedValue(mockCreatedOrder);

      const result = await service.create(validInput, customerId);

      expect(result.id).toBe('new-order-id');
      // Status ASSIGNED saat lahir, bukan PENDING
      expect(result.status).toBe('ASSIGNED');
      expect(result.driverId).toBeUndefined();
      expect(result.totalCents).toBe(50000);
      expect(mockPrisma.order.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          customerId,
          itemsJson: validInput.items,
          addressJson: validInput.deliveryAddress,
          totalCents: 50000,
          currency: 'IDR',
          status: OrderStatusDb.ASSIGNED,
          driverId: null,
        }),
      });
      // pool diberi tahu supaya driver online langsung lihat
      expect(mockGateway.emitOrderAvailable).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'new-order-id', status: 'ASSIGNED' })
      );
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

    test('berhasil reject order ASSIGNED yang di-assign ke driver ybs → balik ke pool (ASSIGNED + driverId null)', async () => {
      const updatedOrder = {
        ...mockOrderAssigned,
        status: OrderStatusDb.ASSIGNED,
        driverId: null,
        cancelledBy: null,
        cancelReason: null,
        version: version + 1,
      };

      mockPrisma.order.findUnique.mockResolvedValue(mockOrderAssigned);
      mockPrisma.order.update.mockResolvedValue(updatedOrder);

      const result = await service.rejectOrder(orderId, version, driverId);

      // Balik ke pool = ASSIGNED + driverId null (bukan CONFIRMED).
      expect(result.status).toBe('ASSIGNED');
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
          status: OrderStatusDb.ASSIGNED,
          driverId: null,
          cancelledBy: null,
          cancelReason: null,
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

    test('berhasil cancel dari ASSIGNED - kembali ke pool (ASSIGNED + driverId null), cancelledBy set', async () => {
      const mockOrder = makeOrderWithDriver(OrderStatusDb.ASSIGNED);
      const cancelledOrder = {
        ...mockOrder,
        status: OrderStatusDb.ASSIGNED,
        driverId: null,
        cancelledBy: driverId,
        cancelReason: null,
        version: version + 1,
      };

      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue(cancelledOrder);

      const result = await service.cancelOrder(orderId, version, driverId);

      // Balik ke pool = ASSIGNED + driverId null (bukan CONFIRMED).
      expect(result.status).toBe('ASSIGNED');
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
          status: OrderStatusDb.ASSIGNED,
          driverId: null,
          cancelledBy: driverId,
          // releaseToPool normalisasi: undefined → null untuk Prisma
          cancelReason: null,
          version: { increment: 1 },
        }),
      });
    });

    test('berhasil cancel dari PREPARING dengan reason', async () => {
      const mockOrder = makeOrderWithDriver(OrderStatusDb.PREPARING);
      const cancelledOrder = {
        ...mockOrder,
        status: OrderStatusDb.ASSIGNED,
        driverId: null,
        cancelledBy: driverId,
        cancelReason: 'Kendaraan mogok',
        version: version + 1,
      };

      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue(cancelledOrder);

      const result = await service.cancelOrder(orderId, version, driverId, 'Kendaraan mogok');

      // Balik ke ASSIGNED (pool state) bukan CONFIRMED.
      expect(result.status).toBe('ASSIGNED');
      expect(result.driverId).toBeUndefined();
      expect(result.cancelledBy).toBe(driverId);
      expect(result.cancelReason).toBe('Kendaraan mogok');
    });

    test('berhasil cancel dari OUT_FOR_DELIVERY', async () => {
      const mockOrder = makeOrderWithDriver(OrderStatusDb.OUT_FOR_DELIVERY);
      const cancelledOrder = {
        ...mockOrder,
        status: OrderStatusDb.ASSIGNED,
        driverId: null,
        cancelledBy: driverId,
        cancelReason: null,
        version: version + 1,
      };

      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.order.update.mockResolvedValue(cancelledOrder);

      const result = await service.cancelOrder(orderId, version, driverId);

      // Status ASSIGNED (pool state), bukan CONFIRMED.
      expect(result.status).toBe('ASSIGNED');
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

  // ===== releaseToPool tests =====

  describe('releaseToPool()', () => {
    // Helper terpusat untuk semua back-to-pool operations (reject, cancel,
    // reassign). Menjamin shape konsisten: ASSIGNED + driverId null,
    // emitOrderAvailable ke pool, VERSION_CONFLICT untuk OCC miss.

    const mockAssignedOrder = {
      id: orderId,
      customerId,
      driverId,
      status: OrderStatusDb.PREPARING,
      itemsJson: [],
      addressJson: {},
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    test('success: order kembali ke pool (ASSIGNED + driverId null) + emitOrderAvailable', async () => {
      const releasedOrder = {
        ...mockAssignedOrder,
        status: OrderStatusDb.ASSIGNED,
        driverId: null,
        version: version + 1,
      };
      mockPrisma.order.update.mockResolvedValue(releasedOrder);

      const result = await service.releaseToPool({
        orderId,
        expectedVersion: version,
        cancelledBy: 'SYSTEM',
        cancelReason: 'system_timeout',
      });

      expect(result.status).toBe('ASSIGNED');
      expect(result.driverId).toBeUndefined();
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: orderId, version },
        data: expect.objectContaining({
          status: OrderStatusDb.ASSIGNED,
          driverId: null,
          cancelledBy: 'SYSTEM',
          cancelReason: 'system_timeout',
          version: { increment: 1 },
        }),
      });
      expect(mockGateway.emitOrderAvailable).toHaveBeenCalledWith(
        expect.objectContaining({ id: orderId, status: 'ASSIGNED' }),
      );
    });

    test('default cancelledBy/cancelReason → null saat tidak diberikan', async () => {
      const releasedOrder = {
        ...mockAssignedOrder,
        status: OrderStatusDb.ASSIGNED,
        driverId: null,
        cancelledBy: null,
        cancelReason: null,
        version: version + 1,
      };
      mockPrisma.order.update.mockResolvedValue(releasedOrder);

      await service.releaseToPool({ orderId, expectedVersion: version });

      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: orderId, version },
        data: expect.objectContaining({
          cancelledBy: null,
          cancelReason: null,
        }),
      });
    });

    test('OCC conflict: P2025 → ConflictException(VERSION_CONFLICT)', async () => {
      const prismaError = Object.assign(
        new Error('Record to update not found.'),
        { code: 'P2025', name: 'PrismaClientKnownRequestError' },
      );
      mockPrisma.order.update.mockRejectedValue(prismaError);

      let caught: unknown;
      try {
        await service.releaseToPool({ orderId, expectedVersion: version });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ConflictException);
      const response = (caught as ConflictException).getResponse();
      expect(response).toMatchObject({ code: 'VERSION_CONFLICT' });
      // Tidak ada emit kalau update gagal
      expect(mockGateway.emitOrderAvailable).not.toHaveBeenCalled();
    });

    test('non-P2025 error → rethrow apa adanya', async () => {
      const dbError = new Error('Database connection failed');
      mockPrisma.order.update.mockRejectedValue(dbError);

      await expect(
        service.releaseToPool({ orderId, expectedVersion: version }),
      ).rejects.toThrow('Database connection failed');
    });
  });

  // ===== transitionStatus tests =====

  // Endpoint PATCH /orders/:id/status dipersempit — hanya driver pemilik order
  // yang boleh lakukan dua transisi: PREPARING→OUT_FOR_DELIVERY dan
  // OUT_FOR_DELIVERY→DELIVERED. Sumber bukan PREPARING/OUT_FOR_DELIVERY,
  // tujuan di luar dua itu, atau bukan driverId order → error.
  describe('transitionStatus()', () => {
    function makeOrder(status: OrderStatusDb, driverIdValue: string | null) {
      return {
        id: orderId,
        customerId,
        driverId: driverIdValue,
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

    // Tes lama yang DIUBAH: transisi CONFIRMED→ASSIGNED sebelumnya
    // diizinkan, sekarang ditolak karena target ASSIGNED bukan OUT_FOR_DELIVERY
    // atau DELIVERED → 403.
    test('PATCH CONFIRMED→ASSIGNED → ditolak 403 karena target bukan salah satu dari OUT_FOR_DELIVERY/DELIVERED', async () => {
      const currentOrder = makeOrder(OrderStatusDb.CONFIRMED, null);
      mockPrisma.order.findUnique.mockResolvedValue(currentOrder);

      let caught: unknown;
      try {
        await service.transitionStatus(orderId, 'ASSIGNED', version, driverId);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ForbiddenException);
      // Service TIDAK boleh panggil update ketika target invalid.
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
      expect(mockGateway.emitOrderAvailable).not.toHaveBeenCalled();
      expect(mockGateway.emitOrderUnavailable).not.toHaveBeenCalled();
    });

    // Tes lama yang DIUBAH: transisi ASSIGNED→CANCELLED via transitionStatus
    // Tes lama yang DIUBAH: transisi ASSIGNED→CANCELLED sebelumnya
    // dianggap "order keluar pool". Sekarang CANCELLED bukan target yang
    // diizinkan — endpoint cancel mid-delivery yang punya proper rejection
    // (OrdersService.cancelOrder) tetap dipakai untuk itu.
    test('PATCH ASSIGNED→CANCELLED → ditolak 403 karena target bukan salah satu dari OUT_FOR_DELIVERY/DELIVERED', async () => {
      const currentOrder = makeOrder(OrderStatusDb.ASSIGNED, null);
      mockPrisma.order.findUnique.mockResolvedValue(currentOrder);

      let caught: unknown;
      try {
        await service.transitionStatus(orderId, 'CANCELLED', version, driverId);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
      expect(mockGateway.emitOrderUnavailable).not.toHaveBeenCalled();
    });

    // Tes lama yang DIUBAH: PREPARING→OUT_FOR_DELIVERY sebelumnya hanya
    // dites "tidak ada emit". Sekarang transisi ini sumber-tujuan cocok,
    // TIDAK memanggil emitOrderUnavailable, TETAPI memanggil
    // emitOrderStatusUpdated satu kali (event baru).
    test('PREPARING→OUT_FOR_DELIVERY sukses: emit order:status_updated, tanpa emit unavailable', async () => {
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
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: orderId, version },
        data: expect.objectContaining({
          status: OrderStatusDb.OUT_FOR_DELIVERY,
          version: { increment: 1 },
        }),
      });
      // Event baru: order:status_updated ke customer, sekali per PATCH sukses.
      expect(mockGateway.emitOrderStatusUpdated).toHaveBeenCalledTimes(1);
      expect(mockGateway.emitOrderStatusUpdated).toHaveBeenCalledWith(
        customerId,
        expect.objectContaining({
          orderId,
          status: 'OUT_FOR_DELIVERY',
          version: version + 1,
        }),
      );
      // Tidak boleh panggil unavailable (dua transisi ini bukan dari pool).
      expect(mockGateway.emitOrderUnavailable).not.toHaveBeenCalled();
      expect(mockGateway.emitOrderAvailable).not.toHaveBeenCalled();
    });

    // Tes BARU — happy path kedua: OUT_FOR_DELIVERY→DELIVERED.
    test('OUT_FOR_DELIVERY→DELIVERED sukses: emit order:status_updated, version naik', async () => {
      const currentOrder = makeOrder(OrderStatusDb.OUT_FOR_DELIVERY, driverId);
      const updatedOrder = {
        ...currentOrder,
        status: OrderStatusDb.DELIVERED,
        version: version + 1,
      };
      mockPrisma.order.findUnique.mockResolvedValue(currentOrder);
      mockPrisma.order.update.mockResolvedValue(updatedOrder);

      const result = await service.transitionStatus(orderId, 'DELIVERED', version, driverId);

      expect(result.status).toBe('DELIVERED');
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: orderId, version },
        data: expect.objectContaining({
          status: OrderStatusDb.DELIVERED,
          version: { increment: 1 },
        }),
      });
      expect(mockGateway.emitOrderStatusUpdated).toHaveBeenCalledTimes(1);
      expect(mockGateway.emitOrderStatusUpdated).toHaveBeenCalledWith(
        customerId,
        expect.objectContaining({
          orderId,
          status: 'DELIVERED',
          version: version + 1,
        }),
      );
      expect(mockGateway.emitOrderUnavailable).not.toHaveBeenCalled();
    });

    // Tes BARU: chain PREPARING→OUT_FOR_DELIVERY→DELIVERED, masing-masing
    // menaikkan versi dan memancarkan order:status_updated sekali.
    test('PREPARING→OUT_FOR_DELIVERY lalu OUT_FOR_DELIVERY→DELIVERED: 2 emit, masing-masing naik satu versi', async () => {
      const preparing = makeOrder(OrderStatusDb.PREPARING, driverId);
      const outForDelivery = {
        ...preparing,
        status: OrderStatusDb.OUT_FOR_DELIVERY,
        version: version + 1,
      };
      const delivered = {
        ...outForDelivery,
        status: OrderStatusDb.DELIVERED,
        version: version + 2,
      };

      // Step 1: PREPARING → OUT_FOR_DELIVERY
      mockPrisma.order.findUnique.mockResolvedValueOnce(preparing);
      mockPrisma.order.update.mockResolvedValueOnce(outForDelivery);
      const r1 = await service.transitionStatus(orderId, 'OUT_FOR_DELIVERY', version, driverId);
      expect(r1.status).toBe('OUT_FOR_DELIVERY');

      // Step 2: OUT_FOR_DELIVERY → DELIVERED (versi baru dari step 1)
      mockPrisma.order.findUnique.mockResolvedValueOnce(outForDelivery);
      mockPrisma.order.update.mockResolvedValueOnce(delivered);
      const r2 = await service.transitionStatus(orderId, 'DELIVERED', version + 1, driverId);
      expect(r2.status).toBe('DELIVERED');
      expect(r2.version).toBe(version + 2);

      expect(mockGateway.emitOrderStatusUpdated).toHaveBeenCalledTimes(2);
      expect(mockGateway.emitOrderStatusUpdated).toHaveBeenNthCalledWith(
        1,
        customerId,
        expect.objectContaining({ status: 'OUT_FOR_DELIVERY', version: version + 1 }),
      );
      expect(mockGateway.emitOrderStatusUpdated).toHaveBeenNthCalledWith(
        2,
        customerId,
        expect.objectContaining({ status: 'DELIVERED', version: version + 2 }),
      );
    });

    // Tes BARU — cek 2: order tidak ada → 404.
    test('order tidak ditemukan → 404 NotFound', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.transitionStatus(orderId, 'OUT_FOR_DELIVERY', version, driverId),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.transitionStatus(orderId, 'OUT_FOR_DELIVERY', version, driverId),
      ).rejects.toThrow(`Order ${orderId} not found`);
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    // Tes BARU — cek 3 (driver ownership): userId berbeda dari order.driverId → 403.
    test('userId bukan driverId order → 403 Forbidden', async () => {
      const currentOrder = makeOrder(OrderStatusDb.PREPARING, driverId);
      mockPrisma.order.findUnique.mockResolvedValue(currentOrder);

      await expect(
        service.transitionStatus(orderId, 'OUT_FOR_DELIVERY', version, anotherDriverId),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
      expect(mockGateway.emitOrderStatusUpdated).not.toHaveBeenCalled();
    });

    // Tes BARU — cek 4: status tujuan bukan salah satu dari OUT_FOR_DELIVERY/DELIVERED → 403.
    test.each([
      ['PENDING'],
      ['CONFIRMED'],
      ['ASSIGNED'],
      ['PREPARING'],
      ['CANCELLED'],
    ])('target %s → 403 Forbidden (bukan OUT_FOR_DELIVERY/DELIVERED)', async (target) => {
      const currentOrder = makeOrder(OrderStatusDb.PREPARING, driverId);
      mockPrisma.order.findUnique.mockResolvedValue(currentOrder);

      await expect(
        service.transitionStatus(orderId, target, version, driverId),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    // Tes BARU — cek 5: DELIVERED diminta dari PREPARING (sumber seharusnya OUT_FOR_DELIVERY) → 409 INVALID_TRANSITION.
    test('DELIVERED diminta saat source PREPARING → 409 INVALID_TRANSITION', async () => {
      const currentOrder = makeOrder(OrderStatusDb.PREPARING, driverId);
      mockPrisma.order.findUnique.mockResolvedValue(currentOrder);

      let caught: unknown;
      try {
        await service.transitionStatus(orderId, 'DELIVERED', version, driverId);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      const response = (caught as ConflictException).getResponse();
      expect(response).toMatchObject({
        code: 'INVALID_TRANSITION',
      });
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    // Tes BARU — cek 5: OUT_FOR_DELIVERY diminta saat source sudah OUT_FOR_DELIVERY → 409 INVALID_TRANSITION.
    test('OUT_FOR_DELIVERY diminta saat source sudah OUT_FOR_DELIVERY → 409 INVALID_TRANSITION', async () => {
      const currentOrder = makeOrder(OrderStatusDb.OUT_FOR_DELIVERY, driverId);
      mockPrisma.order.findUnique.mockResolvedValue(currentOrder);

      let caught: unknown;
      try {
        await service.transitionStatus(orderId, 'OUT_FOR_DELIVERY', version, driverId);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      const response = (caught as ConflictException).getResponse();
      expect(response).toMatchObject({
        code: 'INVALID_TRANSITION',
      });
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    // Tes BARU — cek 5: transisi dari terminal (DELIVERED/CANCELLED) → 409 INVALID_TRANSITION.
    test.each([['DELIVERED'], ['CANCELLED']])(
      'transisi dari status %s → 409 INVALID_TRANSITION',
      async (sourceStatus) => {
        const currentOrder = makeOrder(sourceStatus as OrderStatusDb, driverId);
        mockPrisma.order.findUnique.mockResolvedValue(currentOrder);

        let caught: unknown;
        try {
          await service.transitionStatus(orderId, 'OUT_FOR_DELIVERY', version, driverId);
        } catch (err) {
          caught = err;
        }

        expect(caught).toBeInstanceOf(ConflictException);
        const response = (caught as ConflictException).getResponse();
        expect(response).toMatchObject({ code: 'INVALID_TRANSITION' });
        expect(mockPrisma.order.update).not.toHaveBeenCalled();
      },
    );

    // Tes BARU — cek 6: P2025 (OCC) → 409 VERSION_CONFLICT.
    test('OCC conflict (P2025) → 409 VERSION_CONFLICT', async () => {
      const currentOrder = makeOrder(OrderStatusDb.PREPARING, driverId);
      mockPrisma.order.findUnique.mockResolvedValue(currentOrder);

      const prismaError = Object.assign(
        new Error('Record to update not found.'),
        { code: 'P2025', name: 'PrismaClientKnownRequestError' },
      );
      mockPrisma.order.update.mockRejectedValue(prismaError);

      let caught: unknown;
      try {
        await service.transitionStatus(orderId, 'OUT_FOR_DELIVERY', version, driverId);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      const response = (caught as ConflictException).getResponse();
      expect(response).toMatchObject({
        code: 'VERSION_CONFLICT',
      });
      // Tidak ada emit kalau update gagal.
      expect(mockGateway.emitOrderStatusUpdated).not.toHaveBeenCalled();
    });

    // Tes BARU: order di pool (ASSIGNED, driverId null) bukan driver
    // manapun → cek 2 gagal duluan, 403 Forbidden (bukan 409).
    test('source ASSIGNED (driverId null) target OUT_FOR_DELIVERY → 403 (bukan driver order)', async () => {
      const currentOrder = makeOrder(OrderStatusDb.ASSIGNED, null);
      mockPrisma.order.findUnique.mockResolvedValue(currentOrder);

      let caught: unknown;
      try {
        await service.transitionStatus(orderId, 'OUT_FOR_DELIVERY', version, driverId);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ForbiddenException);
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });
  });

  // ===== findAvailable tests =====

  describe('findAvailable()', () => {
    const driverId = 'driver-uuid-1';

    function makeAvailableOrder(overrideId: string, overrideCreatedAt: Date, overrideVersion = 1) {
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
        version: overrideVersion,
        createdAt: overrideCreatedAt,
        updatedAt: overrideCreatedAt,
        cancelledBy: null as string | null,
        cancelReason: null as string | null,
      };
    }

    test('returns slim AvailableOrderPayload (not full Order) sorted by createdAt ASC', async () => {
      const now = new Date();
      const order1 = makeAvailableOrder('order-1', new Date(now.getTime() - 10000), 7);
      const order2 = makeAvailableOrder('order-2', now, 9);
      const order3 = makeAvailableOrder('order-3', new Date(now.getTime() + 10000), 11);

      // Mock findMany - will be called with correct filters (take+1 untuk hasMore)
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([order1, order2, order3]);

      const result = await service.findAvailable(driverId, 50);

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith({
        where: {
          status: OrderStatusDb.ASSIGNED,
          driverId: null,
          deletedAt: null,
        },
        take: 51,
        orderBy: { createdAt: 'asc' },
      });
      expect(result.items).toHaveLength(3);
      // Slim shape: orderId (bukan `id` dari full Order)
      expect(result.items[0].orderId).toBe('order-1');
      expect(result.items[1].orderId).toBe('order-2');
      expect(result.items[2].orderId).toBe('order-3');
      // version harus ada dan sama dengan fixture
      expect(result.items[0].version).toBe(7);
      expect(result.items[1].version).toBe(9);
      expect(result.items[2].version).toBe(11);
      // PENTING: payload TIDAK boleh bocor full Order fields seperti `customerId`,
      // `driverId`, `notes`, `cancelledBy`, `cancelReason`, `items`,
      // `deliveryAddress`. Type assertion catch-all untuk regressions.
      for (const item of result.items) {
        expect(item).not.toHaveProperty('id');
        expect(item).not.toHaveProperty('customerId');
        expect(item).not.toHaveProperty('driverId');
        expect(item).not.toHaveProperty('notes');
        expect(item).not.toHaveProperty('items');
        expect(item).not.toHaveProperty('deliveryAddress');
      }
    });

    test('maps slim payload fields correctly: orderId, totalCents, currency, itemsCount, city, createdAt', async () => {
      const createdAt = new Date('2026-08-25T10:00:00.000Z');
      const order = makeAvailableOrder('order-1', createdAt);
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([order]);

      const result = await service.findAvailable(driverId, 50);

      expect(result.items).toHaveLength(1);
      const item = result.items[0];
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

      expect(result.items[0].itemsCount).toBe(3);
    });

    test('itemsCount falls back to 0 if itemsJson is not an array (defensive)', async () => {
      // Edge case: data integrity issue, itemsJson somehow bukan array
      const order = {
        ...makeAvailableOrder('order-corrupt', new Date()),
        itemsJson: 'not-an-array' as unknown,
      };
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([order]);

      const result = await service.findAvailable(driverId, 50);

      expect(result.items[0].itemsCount).toBe(0);
    });

    test('city is undefined if addressJson missing city field', async () => {
      const order = {
        ...makeAvailableOrder('order-no-city', new Date()),
        addressJson: { recipientName: 'Budi', phone: '0812', street: 'Jl. Merdeka' /* no city */ },
      };
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([order]);

      const result = await service.findAvailable(driverId, 50);

      expect(result.items[0].city).toBeUndefined();
    });

    test('city is undefined if addressJson is null or non-object (defensive)', async () => {
      const order = {
        ...makeAvailableOrder('order-bad-addr', new Date()),
        addressJson: null as unknown,
      };
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([order]);

      const result = await service.findAvailable(driverId, 50);

      expect(result.items[0].city).toBeUndefined();
    });

    test('respects take parameter - pass through to Prisma as take+1', async () => {
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([]);

      // Service passes take+1 through to Prisma (for hasMore detection)
      await service.findAvailable(driverId, 25);
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 26 })
      );
    });

    test('respects take parameter - pass through to Prisma (100)', async () => {
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([]);

      await service.findAvailable(driverId, 100);
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 101 })
      );
    });

    test('respects take parameter - pass through to Prisma (200)', async () => {
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([]);

      // Service passes 200 through — clamping is controller's responsibility
      await service.findAvailable(driverId, 200);
      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 201 })
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

    test('returns empty items and hasMore=false when no available orders', async () => {
      mockPrisma.order.findMany = jest.fn().mockResolvedValue([]);

      const result = await service.findAvailable(driverId, 50);

      expect(result).toEqual({ items: [], hasMore: false });
    });

    // ===== hasMore tests =====

    test('hasMore=true when rows.length > take', async () => {
      // exactly take rows returned: no more data beyond this page
      const orders = Array.from({ length: 50 }, (_, i) =>
        makeAvailableOrder(`order-${i}`, new Date(1000 + i))
      );
      mockPrisma.order.findMany = jest.fn().mockResolvedValue(orders);

      const result = await service.findAvailable(driverId, 50);

      expect(result.hasMore).toBe(false);
      expect(result.items).toHaveLength(50);
    });

    test('hasMore=true when rows.length > take', async () => {
      // one extra row: more data exists beyond this page
      const orders = Array.from({ length: 51 }, (_, i) =>
        makeAvailableOrder(`order-${i}`, new Date(1000 + i))
      );
      mockPrisma.order.findMany = jest.fn().mockResolvedValue(orders);

      const result = await service.findAvailable(driverId, 50);

      expect(result.hasMore).toBe(true);
      expect(result.items).toHaveLength(50);
      expect(result.items[49].orderId).toBe('order-49'); // last returned item
    });

    test('hasMore=false when rows.length < take (less than requested)', async () => {
      // fewer orders than requested — no pagination needed
      const orders = Array.from({ length: 3 }, (_, i) =>
        makeAvailableOrder(`order-${i}`, new Date(1000 + i))
      );
      mockPrisma.order.findMany = jest.fn().mockResolvedValue(orders);

      const result = await service.findAvailable(driverId, 50);

      expect(result.hasMore).toBe(false);
      expect(result.items).toHaveLength(3);
    });

    test('hasMore=false when rows.length equals take+1 and take=1', async () => {
      // boundary case: take=1, 2 rows returned -> exactly 1 extra row
      const orders = [
        makeAvailableOrder('order-0', new Date(1000)),
        makeAvailableOrder('order-1', new Date(2000)),
      ];
      mockPrisma.order.findMany = jest.fn().mockResolvedValue(orders);

      const result = await service.findAvailable(driverId, 1);

      expect(result.hasMore).toBe(true);
      expect(result.items).toHaveLength(1);
    });
  });
});
