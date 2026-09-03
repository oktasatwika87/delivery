/**
 * Unit tests untuk ReassignmentService.
 *
 * Coverage:
 * 1. triggerReassignment - OCC success (order berhasil di-reassign)
 * 2. triggerReassignment - OCC conflict (P2025 → skip silently, return false)
 * 3. triggerReassignment - non-P2025 error → rethrow
 * 4. checkReassignments - ASSIGNED order timeout (lastSeenAt > 15 min) → reassign
 * 5. checkReassignments - ASSIGNED order with recent lastSeenAt → NOT reassign
 * 6. checkReassignments - OUT_FOR_DELIVERY order timeout (lastSeenAt > 50 min) → reassign
 * 7. checkReassignments - OUT_FOR_DELIVERY with recent lastSeenAt → NOT reassign
 * 8. checkReassignments - null lastSeenAt (driver never synced) → reassign
 * 9. checkReassignments - PREPARING order uses preparing timeout (15 min)
 * 10. checkReassignments - no active orders → no reassignments, no errors
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaClient, OrderStatusDb } from '@prisma/client';

import { ReassignmentService } from './reassignment.service';
import { OrdersGateway } from './orders.gateway';

describe('ReassignmentService', () => {
  let service: ReassignmentService;
  let mockPrisma: {
    order: {
      findMany: jest.Mock;
      update: jest.Mock;
    };
    user: {
      updateMany: jest.Mock;
    };
  };
  let mockGateway: {
    emitOrderAvailable: jest.Mock;
  };
  let mockConfig: {
    get: jest.Mock;
  };

  const orderId = 'order-uuid-123';
  const driverId = 'driver-uuid-1';
  const customerId = 'customer-uuid';
  const version = 1;

  beforeEach(async () => {
    mockPrisma = {
      order: {
        findMany: jest.fn(),
        update: jest.fn(),
      },
      user: {
        updateMany: jest.fn(),
      },
    };

    mockGateway = {
      emitOrderAvailable: jest.fn(),
    };

    mockConfig = {
      get: jest.fn().mockImplementation((key: string, fallback: number) => {
        if (key === 'REASSIGN_TIMEOUT_PREPARING_MINUTES') return 15;
        if (key === 'REASSIGN_TIMEOUT_DELIVERY_MINUTES') return 50;
        return fallback;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReassignmentService,
        { provide: PrismaClient, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfig },
        { provide: OrdersGateway, useValue: mockGateway },
      ],
    }).compile();

    service = module.get<ReassignmentService>(ReassignmentService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===== triggerReassignment tests =====

  describe('triggerReassignment()', () => {
    test('OCC success - order berhasil di-reassign, emitOrderAvailable called', async () => {
      const reassignedOrder = {
        id: orderId,
        status: OrderStatusDb.CONFIRMED,
        version: version + 1,
        itemsJson: [],
        addressJson: {},
        totalCents: 50000,
        currency: 'IDR',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrisma.order.update.mockResolvedValue(reassignedOrder);

      const result = await service.triggerReassignment(orderId, version);

      expect(result).toBe(true);
      expect(mockPrisma.order.update).toHaveBeenCalledWith({
        where: { id: orderId, version },
        data: expect.objectContaining({
          status: OrderStatusDb.CONFIRMED,
          driverId: null,
          cancelledBy: 'SYSTEM',
          cancelReason: 'system_timeout',
          version: { increment: 1 },
        }),
      });
      expect(mockGateway.emitOrderAvailable).toHaveBeenCalledWith(
        expect.objectContaining({
          id: orderId,
          status: 'CONFIRMED',
        }),
      );
    });

    test('OCC conflict (P2025) → return false, no emit', async () => {
      const prismaError = Object.assign(
        new Error('Record to update not found.'),
        { code: 'P2025', name: 'PrismaClientKnownRequestError' },
      );
      mockPrisma.order.update.mockRejectedValue(prismaError);

      const result = await service.triggerReassignment(orderId, version);

      expect(result).toBe(false);
      expect(mockGateway.emitOrderAvailable).not.toHaveBeenCalled();
    });

    test('non-P2025 error → rethrow', async () => {
      const dbError = new Error('Database connection failed');
      mockPrisma.order.update.mockRejectedValue(dbError);

      await expect(
        service.triggerReassignment(orderId, version),
      ).rejects.toThrow('Database connection failed');
    });
  });

  // ===== checkReassignments tests =====

  describe('checkReassignments()', () => {
    function makeActiveOrder(
      status: OrderStatusDb,
      driverLastSeen: Date | null,
      orderVersion = version,
    ) {
      return {
        id: orderId,
        customerId,
        driverId,
        status,
        driver: {
          id: driverId,
          name: 'Driver Test',
          lastSeenAt: driverLastSeen,
        },
        version: orderVersion,
        itemsJson: [],
        addressJson: {},
        totalCents: 50000,
        currency: 'IDR',
        deletedAt: null,
      };
    }

    function minutesAgo(minutes: number): Date {
      return new Date(Date.now() - minutes * 60 * 1000);
    }

    test(
      'ASSIGNED order timeout (lastSeenAt > 15 min) → reassign',
      async () => {
        const oldLastSeen = minutesAgo(20); // lebih dari 15 menit
        mockPrisma.order.findMany.mockResolvedValue([
          makeActiveOrder(OrderStatusDb.ASSIGNED, oldLastSeen),
        ]);
        mockPrisma.order.update.mockResolvedValue({
          id: orderId,
          status: OrderStatusDb.CONFIRMED,
          version: version + 1,
          itemsJson: [],
          addressJson: {},
          totalCents: 50000,
          currency: 'IDR',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await service.checkReassignments();

        expect(mockPrisma.order.update).toHaveBeenCalledWith({
          where: { id: orderId, version },
          data: expect.objectContaining({
            status: OrderStatusDb.CONFIRMED,
            driverId: null,
            cancelledBy: 'SYSTEM',
            cancelReason: 'system_timeout',
          }),
        });
      },
    );

    test(
      'ASSIGNED order with recent lastSeenAt → NOT reassign',
      async () => {
        const recentLastSeen = minutesAgo(5); // baru 5 menit yang lalu
        mockPrisma.order.findMany.mockResolvedValue([
          makeActiveOrder(OrderStatusDb.ASSIGNED, recentLastSeen),
        ]);

        await service.checkReassignments();

        expect(mockPrisma.order.update).not.toHaveBeenCalled();
      },
    );

    test(
      'OUT_FOR_DELIVERY order timeout (lastSeenAt > 50 min) → reassign',
      async () => {
        const oldLastSeen = minutesAgo(55); // lebih dari 50 menit
        mockPrisma.order.findMany.mockResolvedValue([
          makeActiveOrder(OrderStatusDb.OUT_FOR_DELIVERY, oldLastSeen),
        ]);
        mockPrisma.order.update.mockResolvedValue({
          id: orderId,
          status: OrderStatusDb.CONFIRMED,
          version: version + 1,
          itemsJson: [],
          addressJson: {},
          totalCents: 50000,
          currency: 'IDR',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await service.checkReassignments();

        expect(mockPrisma.order.update).toHaveBeenCalled();
      },
    );

    test(
      'OUT_FOR_DELIVERY with recent lastSeenAt (5 min) → NOT reassign',
      async () => {
        const recentLastSeen = minutesAgo(5);
        mockPrisma.order.findMany.mockResolvedValue([
          makeActiveOrder(OrderStatusDb.OUT_FOR_DELIVERY, recentLastSeen),
        ]);

        await service.checkReassignments();

        expect(mockPrisma.order.update).not.toHaveBeenCalled();
      },
    );

    test(
      'null lastSeenAt (driver never synced) → reassign',
      async () => {
        mockPrisma.order.findMany.mockResolvedValue([
          makeActiveOrder(OrderStatusDb.ASSIGNED, null),
        ]);
        mockPrisma.order.update.mockResolvedValue({
          id: orderId,
          status: OrderStatusDb.CONFIRMED,
          version: version + 1,
          itemsJson: [],
          addressJson: {},
          totalCents: 50000,
          currency: 'IDR',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await service.checkReassignments();

        expect(mockPrisma.order.update).toHaveBeenCalled();
      },
    );

    test(
      'PREPARING order uses preparing timeout (15 min), not delivery timeout (50 min)',
      async () => {
        const lastSeen43MinAgo = minutesAgo(43); // 43 menit yang lalu
        // 43 > 15 (preparing timeout) tapi < 50 (delivery timeout)
        // Kalau pakai delivery timeout, tidak akan reassign
        mockPrisma.order.findMany.mockResolvedValue([
          makeActiveOrder(OrderStatusDb.PREPARING, lastSeen43MinAgo),
        ]);
        mockPrisma.order.update.mockResolvedValue({
          id: orderId,
          status: OrderStatusDb.CONFIRMED,
          version: version + 1,
          itemsJson: [],
          addressJson: {},
          totalCents: 50000,
          currency: 'IDR',
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        await service.checkReassignments();

        // Harus reassign karena 43 menit > 15 menit preparing timeout
        expect(mockPrisma.order.update).toHaveBeenCalled();
      },
    );

    test('no active orders → no reassignments, no errors', async () => {
      mockPrisma.order.findMany.mockResolvedValue([]);

      // Tidak throw
      await service.checkReassignments();

      expect(mockPrisma.order.update).not.toHaveBeenCalled();
      expect(mockGateway.emitOrderAvailable).not.toHaveBeenCalled();
    });

    test('ASSIGNED at exactly 15 min boundary → NOT reassign', async () => {
      // exactly 15 menit yang lalu — boundary case
      const exactly15MinAgo = minutesAgo(15);
      mockPrisma.order.findMany.mockResolvedValue([
        makeActiveOrder(OrderStatusDb.ASSIGNED, exactly15MinAgo),
      ]);

      await service.checkReassignments();

      // Should NOT reassign — threshold adalah "lebih dari" timeout
      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('OUT_FOR_DELIVERY at exactly 50 min boundary → NOT reassign', async () => {
      const exactly50MinAgo = minutesAgo(50);
      mockPrisma.order.findMany.mockResolvedValue([
        makeActiveOrder(OrderStatusDb.OUT_FOR_DELIVERY, exactly50MinAgo),
      ]);

      await service.checkReassignments();

      expect(mockPrisma.order.update).not.toHaveBeenCalled();
    });

    test('mixed orders: one timed out, one not → only reassign timed out', async () => {
      const recentDriver = { id: 'driver-recent', name: 'Recent', lastSeenAt: minutesAgo(5) };
      const oldDriver = { id: 'driver-old', name: 'Old', lastSeenAt: minutesAgo(30) };

      mockPrisma.order.findMany.mockResolvedValue([
        { ...makeActiveOrder(OrderStatusDb.ASSIGNED, recentDriver.lastSeenAt), driver: recentDriver, id: 'order-recent' },
        { ...makeActiveOrder(OrderStatusDb.ASSIGNED, oldDriver.lastSeenAt), driver: oldDriver, id: 'order-old' },
      ]);

      mockPrisma.order.update.mockResolvedValue({
        id: 'order-old',
        status: OrderStatusDb.CONFIRMED,
        version: version + 1,
        itemsJson: [],
        addressJson: {},
        totalCents: 50000,
        currency: 'IDR',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.checkReassignments();

      // Hanya order-old yang timeout (30 menit > 15 menit)
      expect(mockPrisma.order.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'order-old' }) }),
      );
    });
  });
});
