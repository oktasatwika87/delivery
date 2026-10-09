/**
 * Unit tests untuk PaymentsService.collectCod() dan flagOrphanedCod()
 *
 * Coverage:
 * 1. collectCod: driver berhasil collect COD, payment CASH CAPTURED, amount dari order
 * 2. collectCod: idempotency key replay, return existing record, no double-create
 * 3. collectCod: gagal karena driver bukan owner, 403 Forbidden
 * 4. collectCod: gagal karena order tidak ditemukan, 404 NotFound
 * 5. collectCod: berhasil emit order:cod_collected ke customer via OrdersGateway
 * 6. collectCod: idempotency replay TIDAK emit ulang, no duplicate customer notification
 * 7. flagOrphanedCod: berhasil flag dengan payment existing
 * 8. flagOrphanedCod: berhasil flag tanpa payment existing, create baru
 * 9. flagOrphanedCod: gagal karena driver tidak ditemukan, 404
 * 10. flagOrphanedCod: gagal karena order tidak ditemukan, 404
 * 11. flagOrphanedCod: idempotency key conflict order lain, 409 ConflictException
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { PaymentsService } from './payments.service';
import { OrdersGateway } from '../orders/orders.gateway';
import { EmailService } from '../email/email.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let mockPrisma: {
    order: {
      findUnique: jest.Mock;
    };
    user: {
      findUnique: jest.Mock;
    };
    payment: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let mockOrdersGateway: { emitOrderCodCollected: jest.Mock };
  let mockEmailService: { sendOrphanedCodNotification: jest.Mock };

  // Test data
  const orderId = 'order-uuid-123';
  const customerId = 'customer-uuid';
  const driverId = 'driver-uuid-1';
  const anotherDriverId = 'driver-uuid-2';
  const orderTotal = 50000;
  const idempotencyKey = 'cod:idem-key-123-0000-4000-a000-000000000000';

  beforeEach(async () => {
    mockPrisma = {
      order: {
        findUnique: jest.fn(),
      },
      user: {
        findUnique: jest.fn(),
      },
      payment: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    mockOrdersGateway = {
      emitOrderCodCollected: jest.fn(),
    };
    mockEmailService = {
      sendOrphanedCodNotification: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: PrismaClient,
          useValue: mockPrisma,
        },
        {
          provide: OrdersGateway,
          useValue: mockOrdersGateway,
        },
        {
          provide: EmailService,
          useValue: mockEmailService,
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('collectCod()', () => {
    const mockOrder = {
      id: orderId,
      customerId,
      driverId,
      totalCents: orderTotal,
      currency: 'IDR',
    };

    const mockPayment = {
      id: 'payment-uuid',
      orderId,
      idempotencyKey,
      method: 'CASH',
      status: 'CAPTURED',
      amountCents: orderTotal,
      currency: 'IDR',
      kind: 'PAYMENT',
      externalRef: null,
      orphanedAt: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    test('berhasil collect COD, payment CASH CAPTURED, amount dari order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.payment.create.mockResolvedValue(mockPayment);

      const result = await service.collectCod(orderId, driverId, idempotencyKey);

      expect(result.method).toBe('CASH');
      expect(result.status).toBe('CAPTURED');
      expect(result.amountCents).toBe(orderTotal);
      expect(mockPrisma.payment.create).toHaveBeenCalledWith({
        data: {
          orderId,
          idempotencyKey,
          method: 'CASH',
          status: 'CAPTURED',
          amountCents: orderTotal,
          currency: 'IDR',
          kind: 'PAYMENT',
        },
      });
    });

    test('idempotency key replay: return existing record, no double-create', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      // Simulate unique constraint violation (P2002) on idempotencyKey
      const prismaError = Object.assign(
        new Error('Unique constraint failed'),
        { code: 'P2002', name: 'PrismaClientKnownRequestError' }
      );
      mockPrisma.payment.create.mockRejectedValue(prismaError);
      mockPrisma.payment.findUnique.mockResolvedValue(mockPayment);

      const result = await service.collectCod(orderId, driverId, idempotencyKey);

      expect(result.id).toBe(mockPayment.id);
      expect(result.method).toBe('CASH');
      // create should have been called once (and failed), findUnique called once to get existing
      expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.payment.findUnique).toHaveBeenCalledTimes(1);
      // Replay path must NOT re-notify the customer — they were already
      // notified on the original successful collection.
      expect(mockOrdersGateway.emitOrderCodCollected).not.toHaveBeenCalled();
    });

    test('berhasil emit order:cod_collected ke customer via OrdersGateway', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.payment.create.mockResolvedValue(mockPayment);

      await service.collectCod(orderId, driverId, idempotencyKey);

      expect(mockOrdersGateway.emitOrderCodCollected).toHaveBeenCalledTimes(1);
      expect(mockOrdersGateway.emitOrderCodCollected).toHaveBeenCalledWith(
        customerId,
        orderId,
        orderTotal,
        'IDR',
      );
    });

    test('gagal karena driver bukan owner, 403 Forbidden', async () => {
      mockPrisma.order.findUnique.mockResolvedValue({
        ...mockOrder,
        driverId: anotherDriverId,
      });

      await expect(
        service.collectCod(orderId, driverId, idempotencyKey),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.collectCod(orderId, driverId, idempotencyKey),
      ).rejects.toThrow('You are not assigned to this order');
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });

    test('gagal karena order tidak ditemukan, 404 NotFound', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.collectCod(orderId, driverId, idempotencyKey),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.collectCod(orderId, driverId, idempotencyKey),
      ).rejects.toThrow('Order tidak ditemukan');
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('flagOrphanedCod()', () => {
    const mockDriver = {
      id: driverId,
      name: 'Driver Test',
      role: 'DRIVER',
    };

    const mockOrder = {
      id: orderId,
      customerId,
      driverId,
      totalCents: orderTotal,
      currency: 'IDR',
    };

    const mockOrphanedPayment = {
      id: 'payment-orphan-uuid',
      orderId,
      idempotencyKey,
      method: 'CASH',
      status: 'CAPTURED',
      amountCents: orderTotal,
      currency: 'IDR',
      kind: 'PAYMENT',
      externalRef: null,
      orphanedAt: new Date(),
      version: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    test('berhasil flag orphaned, payment existing, update', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockDriver);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.payment.findUnique.mockResolvedValue(mockOrphanedPayment);
      mockPrisma.payment.update.mockResolvedValue(mockOrphanedPayment);

      const result = await service.flagOrphanedCod(orderId, driverId, idempotencyKey);

      expect(result.orphanedAt).toBeDefined();
      expect(mockPrisma.payment.update).toHaveBeenCalledWith({
        where: { id: mockOrphanedPayment.id },
        data: expect.objectContaining({
          orphanedAt: expect.any(Date),
          version: { increment: 1 },
        }),
      });
      expect(mockEmailService.sendOrphanedCodNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId,
          amountCents: orderTotal,
          driverId,
          driverName: mockDriver.name,
        }),
      );
    });

    test('berhasil flag orphaned, tidak ada payment existing, create baru', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockDriver);
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockPrisma.payment.findUnique.mockResolvedValue(null);
      mockPrisma.payment.create.mockResolvedValue(mockOrphanedPayment);

      const result = await service.flagOrphanedCod(orderId, driverId, idempotencyKey);

      expect(result.orphanedAt).toBeDefined();
      expect(mockPrisma.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId,
          idempotencyKey,
          method: 'CASH',
          status: 'PENDING',
          amountCents: orderTotal,
          currency: 'IDR',
          kind: 'PAYMENT',
          orphanedAt: expect.any(Date),
        }),
      });
      expect(mockEmailService.sendOrphanedCodNotification).toHaveBeenCalled();
    });

    test('gagal karena driver tidak ditemukan, 404', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.flagOrphanedCod(orderId, driverId, idempotencyKey),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
      expect(mockEmailService.sendOrphanedCodNotification).not.toHaveBeenCalled();
    });

    test('gagal karena order tidak ditemukan, 404', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockDriver);
      mockPrisma.order.findUnique.mockResolvedValue(null);

      await expect(
        service.flagOrphanedCod(orderId, driverId, idempotencyKey),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.payment.create).not.toHaveBeenCalled();
      expect(mockEmailService.sendOrphanedCodNotification).not.toHaveBeenCalled();
    });

    test('gagal karena idempotency key conflict order lain, 409', async () => {
      const anotherOrderId = 'another-order-uuid';
      mockPrisma.user.findUnique.mockResolvedValue(mockDriver);
      mockPrisma.order.findUnique.mockResolvedValue({ ...mockOrder, id: orderId });
      mockPrisma.payment.findUnique.mockResolvedValue({
        ...mockOrphanedPayment,
        orderId: anotherOrderId,
      });

      await expect(
        service.flagOrphanedCod(orderId, driverId, idempotencyKey),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.flagOrphanedCod(orderId, driverId, idempotencyKey),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          code: 'IDEMPOTENCY_KEY_CONFLICT',
        }),
      });
    });
  });
});
