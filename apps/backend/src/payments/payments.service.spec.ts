/**
 * Unit tests untuk PaymentsService.collectCod() dan flagOrphanedCod()
 *
 * Coverage:
 * 1. collectCod: berhasil, payment CASH CAPTURED, jumlah dari order
 * 2. collectCod: kiriman ulang (kunci sama, order sama) mengembalikan payment yang ada
 *    tanpa membuat yang baru
 * 3. collectCod: bukan pemilik -> 403 dengan code ORDER_NOT_ASSIGNED
 * 4. collectCod: order tidak ditemukan -> 404
 * 5. collectCod: event order:cod_collected ke customer lewat OrdersGateway
 * 6. collectCod: kiriman ulang tidak mengirim event lagi
 * 7. collectCod: COD tercatat dengan kunci lain -> 409 COD_ALREADY_CAPTURED, body
 *    membawa payment yang lama
 * 8. collectCod: kunci sama di order lain -> 409 IDEMPOTENCY_KEY_CONFLICT
 * 9. collectCod: payment CASH PENDING (yatim) di order yang sama tidak menghalangi
 *    COD baru
 * 10. collectCod: $queryRaw (kunci baris) dipanggil sebelum payment.create
 * 11. collectCod: $queryRaw dipanggil sebelum order.findUnique
 * 12. collectCod: pemilik dicek di dalam kunci; order yang dilepas tepat sebelum
 *     kunci didapat -> 403 ORDER_NOT_ASSIGNED, tanpa payment dan tanpa event
 * 13. collectCod: P2002, kunci milik order lain -> 409 IDEMPOTENCY_KEY_CONFLICT
 * 14. collectCod: P2002, kunci milik order yang sama -> payment yang ada dikembalikan
 * 15. collectCod: P2002, bacaan ulang tidak menemukan apa-apa -> error P2002
 *     dilempar lagi
 * 16. flagOrphanedCod: berhasil, payment sudah ada
 * 17. flagOrphanedCod: berhasil, payment belum ada lalu dibuat
 * 18. flagOrphanedCod: driver tidak ditemukan -> 404
 * 19. flagOrphanedCod: order tidak ditemukan -> 404
 * 20. flagOrphanedCod: kunci milik order lain -> 409
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { PaymentsService } from './payments.service';
import { OrdersGateway } from '../orders/orders.gateway';
import { EmailService } from '../email/email.service';

type TxMock = {
  $queryRaw: jest.Mock;
  order: { findUnique: jest.Mock };
  payment: { findUnique: jest.Mock; findFirst: jest.Mock; create: jest.Mock };
};

describe('PaymentsService', () => {
  let service: PaymentsService;
  let mockPrisma: {
    order: { findUnique: jest.Mock };
    user: { findUnique: jest.Mock };
    payment: {
      create: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let mockTx: TxMock;
  let mockTxInner: TxMock;
  let mockOrdersGateway: { emitOrderCodCollected: jest.Mock };
  let mockEmailService: { sendOrphanedCodNotification: jest.Mock };

  // Test data
  const orderId = 'order-uuid-123';
  const customerId = 'customer-uuid';
  const driverId = 'driver-uuid-1';
  const anotherDriverId = 'driver-uuid-2';
  const orderTotal = 50000;
  const idempotencyKey = 'cod:idem-key-123-0000-4000-a000-000000000000';

  // Tiruan tx: begitu satu panggilan gagal, semua panggilan berikutnya di
  // transaksi yang sama ditolak dengan error 25P02 ("current transaction is
  // aborted"), seperti Postgres yang tidak membuat `SAVEPOINT` per perintah.
  // Tiap panggilan $transaction mulai dengan tanda batal yang bersih.
  const makeAbortError = () =>
    Object.assign(
      new Error(
        'current transaction is aborted, commands ignored until end of transaction block',
      ),
      { code: '25P02', name: 'PostgresError' },
    );

  const buildTx = (state: { aborted: boolean }, inner: TxMock): TxMock => {
    const wrap = (m: jest.Mock): jest.Mock =>
      jest.fn((...args: unknown[]) => {
        if (state.aborted) {
          return Promise.reject(makeAbortError());
        }
        try {
          const result: unknown = m(...args);
          if (result instanceof Promise) {
            return result.catch((e: unknown) => {
              state.aborted = true;
              throw e;
            });
          }
          return result;
        } catch (e) {
          state.aborted = true;
          throw e;
        }
      });
    return {
      $queryRaw: wrap(inner.$queryRaw),
      order: { findUnique: wrap(inner.order.findUnique) },
      payment: {
        findUnique: wrap(inner.payment.findUnique),
        findFirst: wrap(inner.payment.findFirst),
        create: wrap(inner.payment.create),
      },
    };
  };

  beforeEach(async () => {
    mockTxInner = {
      $queryRaw: jest.fn(),
      order: { findUnique: jest.fn() },
      payment: {
        findUnique: jest.fn(),
        // Bawaan: belum ada COD tercatat.
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
    };
    const state = { aborted: false };
    mockTx = buildTx(state, mockTxInner);

    mockPrisma = {
      order: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      payment: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
      $queryRaw: jest.fn(),
      // Tiruan $transaction: callback menerima tx tersendiri, dan tanda batalnya
      // dikosongkan tiap panggilan.
      $transaction: jest.fn().mockImplementation(
        (cb: (tx: TxMock) => Promise<unknown>) => {
          state.aborted = false;
          return cb(mockTx);
        },
      ),
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

    // Order terbaca milik pemanggil, baik lewat mockPrisma maupun lewat tx.
    const setupOrderOwnedByCaller = (order: typeof mockOrder = mockOrder) => {
      mockPrisma.order.findUnique.mockResolvedValue(order);
      mockTxInner.order.findUnique.mockResolvedValue(order);
    };

    test('berhasil collect COD, payment CASH CAPTURED, amount dari order', async () => {
      setupOrderOwnedByCaller();
      mockTxInner.payment.create.mockResolvedValue(mockPayment);

      const result = await service.collectCod(orderId, driverId, idempotencyKey);

      expect(result.method).toBe('CASH');
      expect(result.status).toBe('CAPTURED');
      expect(result.amountCents).toBe(orderTotal);
      expect(mockTxInner.payment.create).toHaveBeenCalledWith({
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
      setupOrderOwnedByCaller();
      mockTxInner.payment.findUnique.mockResolvedValue(mockPayment);

      const result = await service.collectCod(orderId, driverId, idempotencyKey);

      expect(result.id).toBe(mockPayment.id);
      expect(result.method).toBe('CASH');
      expect(mockTxInner.payment.create).not.toHaveBeenCalled();
      expect(mockTxInner.payment.findUnique).toHaveBeenCalledWith({
        where: { idempotencyKey },
      });
      // Replay path must NOT re-notify the customer, they were already
      // notified on the original successful collection.
      expect(mockOrdersGateway.emitOrderCodCollected).not.toHaveBeenCalled();
    });

    test('berhasil emit order:cod_collected ke customer via OrdersGateway', async () => {
      setupOrderOwnedByCaller();
      mockTxInner.payment.create.mockResolvedValue(mockPayment);

      await service.collectCod(orderId, driverId, idempotencyKey);

      expect(mockOrdersGateway.emitOrderCodCollected).toHaveBeenCalledTimes(1);
      expect(mockOrdersGateway.emitOrderCodCollected).toHaveBeenCalledWith(
        customerId,
        orderId,
        orderTotal,
        'IDR',
      );
    });

    test('gagal karena driver bukan pemilik, 403 Forbidden dengan code ORDER_NOT_ASSIGNED', async () => {
      const otherDriverOrder = { ...mockOrder, driverId: anotherDriverId };
      mockPrisma.order.findUnique.mockResolvedValue(otherDriverOrder);
      mockTxInner.order.findUnique.mockResolvedValue(otherDriverOrder);

      let caught: unknown;
      try {
        await service.collectCod(orderId, driverId, idempotencyKey);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ForbiddenException);
      const response = (caught as ForbiddenException).getResponse();
      expect(response).toMatchObject({
        code: 'ORDER_NOT_ASSIGNED',
        message: expect.stringContaining('Order ini tidak ditugaskan ke Anda'),
      });
      expect(mockTxInner.payment.create).not.toHaveBeenCalled();
    });

    test('gagal karena order tidak ditemukan, 404 NotFound', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      mockTxInner.order.findUnique.mockResolvedValue(null);

      await expect(
        service.collectCod(orderId, driverId, idempotencyKey),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.collectCod(orderId, driverId, idempotencyKey),
      ).rejects.toThrow('Order tidak ditemukan');
      expect(mockTxInner.payment.create).not.toHaveBeenCalled();
    });

    test('COD tercatat dengan kunci lain -> 409 COD_ALREADY_CAPTURED, payment.create dan emit tidak dipanggil', async () => {
      const existingPayment = {
        ...mockPayment,
        id: 'payment-existing',
        idempotencyKey: 'other-key-0000-4000-a000-000000000000',
      };
      setupOrderOwnedByCaller();
      mockTxInner.payment.findFirst.mockResolvedValue(existingPayment);

      let caught: unknown;
      try {
        await service.collectCod(orderId, driverId, idempotencyKey);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      const response = (caught as ConflictException).getResponse();
      expect(response).toMatchObject({
        code: 'COD_ALREADY_CAPTURED',
        message: expect.stringContaining('COD order ini sudah tercatat'),
      });
      // body membawa payment yang lama
      expect(response).toMatchObject({
        payment: expect.objectContaining({ id: existingPayment.id }),
      });
      expect(mockTxInner.payment.create).not.toHaveBeenCalled();
      expect(mockOrdersGateway.emitOrderCodCollected).not.toHaveBeenCalled();
    });

    test('kunci sama di order lain -> 409 IDEMPOTENCY_KEY_CONFLICT', async () => {
      const otherOrderId = 'other-order-uuid';
      setupOrderOwnedByCaller();
      mockTxInner.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        orderId: otherOrderId,
      });

      let caught: unknown;
      try {
        await service.collectCod(orderId, driverId, idempotencyKey);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      const response = (caught as ConflictException).getResponse();
      expect(response).toMatchObject({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: expect.stringContaining(`Idempotency key ${idempotencyKey} sudah dipakai di order lain`),
      });
      expect(mockTxInner.payment.create).not.toHaveBeenCalled();
      expect(mockOrdersGateway.emitOrderCodCollected).not.toHaveBeenCalled();
    });

    test('payment CASH PENDING (yatim) tidak menghalangi COD baru', async () => {
      setupOrderOwnedByCaller();
      // findFirst bawaan null (belum ada CAPTURED)
      mockTxInner.payment.create.mockResolvedValue(mockPayment);

      const result = await service.collectCod(orderId, driverId, idempotencyKey);

      expect(result.id).toBe(mockPayment.id);
      expect(mockTxInner.payment.create).toHaveBeenCalledTimes(1);
      expect(mockOrdersGateway.emitOrderCodCollected).toHaveBeenCalledTimes(1);
    });

    test('$queryRaw dipanggil sebelum payment.create', async () => {
      setupOrderOwnedByCaller();
      mockTxInner.payment.create.mockResolvedValue(mockPayment);

      const callOrder: string[] = [];
      mockTxInner.$queryRaw.mockImplementation(() => {
        callOrder.push('$queryRaw');
        return Promise.resolve([{ id: orderId }]);
      });
      const originalCreate = mockTxInner.payment.create.getMockImplementation();
      mockTxInner.payment.create.mockImplementation((...args: unknown[]) => {
        callOrder.push('payment.create');
        return originalCreate ? originalCreate(...args) : Promise.resolve(mockPayment);
      });

      await service.collectCod(orderId, driverId, idempotencyKey);

      expect(callOrder).toEqual(['$queryRaw', 'payment.create']);
    });

    // Kunci baris diambil sebelum order dibaca, supaya cek pemilik berjalan di
    // dalam kunci.
    test('$queryRaw dipanggil sebelum order.findUnique', async () => {
      setupOrderOwnedByCaller();
      mockTxInner.payment.create.mockResolvedValue(mockPayment);

      const callOrder: string[] = [];
      mockTxInner.$queryRaw.mockImplementation(() => {
        callOrder.push('$queryRaw');
        return Promise.resolve([{ id: orderId }]);
      });
      mockTxInner.order.findUnique.mockImplementation(() => {
        callOrder.push('order.findUnique');
        return Promise.resolve(mockOrder);
      });

      await service.collectCod(orderId, driverId, idempotencyKey);

      expect(callOrder.indexOf('$queryRaw')).toBeLessThan(
        callOrder.indexOf('order.findUnique'),
      );
    });

    // Cek pemilik ada di dalam kunci baris. Kalau releaseToPool melepas
    // order antara baca awal dan ambil kunci, baca dalam transaksi melihat
    // driverId null dan kode menolak dengan 403.
    test('pemilik dicek di dalam kunci: order dilepas setelah baca awal -> 403 ORDER_NOT_ASSIGNED', async () => {
      // Bacaan di luar transaksi masih melihat order milik pemanggil; bacaan di
      // dalam kunci melihat order yang sudah dilepas.
      mockPrisma.order.findUnique.mockResolvedValue(mockOrder);
      mockTxInner.order.findUnique.mockResolvedValue({
        ...mockOrder,
        driverId: null,
      });
      mockTxInner.payment.create.mockResolvedValue(mockPayment);

      let caught: unknown;
      try {
        await service.collectCod(orderId, driverId, idempotencyKey);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ForbiddenException);
      const response = (caught as ForbiddenException).getResponse();
      expect(response).toMatchObject({
        code: 'ORDER_NOT_ASSIGNED',
        message: expect.stringContaining('Order ini tidak ditugaskan ke Anda'),
      });
      expect(mockTxInner.payment.create).not.toHaveBeenCalled();
      expect(mockOrdersGateway.emitOrderCodCollected).not.toHaveBeenCalled();
    });

    // P2002 dari create, kunci ternyata milik order lain -> 409
    // IDEMPOTENCY_KEY_CONFLICT. Baca ulang dilakukan di luar transaksi
    // lewat this.prisma (tx sudah batal di Postgres setelah error).
    test('P2002 dari create, kunci ternyata milik order lain -> 409 IDEMPOTENCY_KEY_CONFLICT', async () => {
      const otherOrderId = 'other-order-uuid';
      setupOrderOwnedByCaller();
      const prismaError = Object.assign(
        new Error('Unique constraint failed'),
        { code: 'P2002', name: 'PrismaClientKnownRequestError' },
      );
      mockTxInner.payment.findUnique.mockResolvedValue(null);
      mockTxInner.payment.create.mockRejectedValueOnce(prismaError);
      mockPrisma.payment.findUnique.mockResolvedValue({
        ...mockPayment,
        orderId: otherOrderId,
      });

      let caught: unknown;
      try {
        await service.collectCod(orderId, driverId, idempotencyKey);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      const response = (caught as ConflictException).getResponse();
      expect(response).toMatchObject({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
      });
      expect(mockOrdersGateway.emitOrderCodCollected).not.toHaveBeenCalled();
    });

    // P2002 dari create, kunci ternyata milik order yang sama -> payment
    // dikembalikan, event tidak dipancarkan.
    test('P2002 dari create, kunci ternyata milik order sama -> kembalikan payment', async () => {
      setupOrderOwnedByCaller();
      const prismaError = Object.assign(
        new Error('Unique constraint failed'),
        { code: 'P2002', name: 'PrismaClientKnownRequestError' },
      );
      mockTxInner.payment.findUnique.mockResolvedValue(null);
      mockTxInner.payment.create.mockRejectedValueOnce(prismaError);
      mockPrisma.payment.findUnique.mockResolvedValue(mockPayment);

      const result = await service.collectCod(orderId, driverId, idempotencyKey);

      expect(result.id).toBe(mockPayment.id);
      expect(mockOrdersGateway.emitOrderCodCollected).not.toHaveBeenCalled();
    });

    // P2002 dari create dan baca ulang tidak menemukan apa-apa -> error
    // P2002 asli dilempar ulang.
    test('P2002 dari create, baca ulang tidak menemukan apa-apa -> error P2002 asli dilempar ulang', async () => {
      setupOrderOwnedByCaller();
      const prismaError = Object.assign(
        new Error('Unique constraint failed'),
        { code: 'P2002', name: 'PrismaClientKnownRequestError' },
      );
      mockTxInner.payment.findUnique.mockResolvedValue(null);
      mockTxInner.payment.create.mockRejectedValueOnce(prismaError);
      mockPrisma.payment.findUnique.mockResolvedValue(null);

      let caught: unknown;
      try {
        await service.collectCod(orderId, driverId, idempotencyKey);
      } catch (err) {
        caught = err;
      }

      expect(caught).toMatchObject({ code: 'P2002' });
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
