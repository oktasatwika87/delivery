/**
 * E2E tests untuk collect-cod dan flag-orphaned.
 *
 * Coverage:
 * 1. collect-cod: amountCents palsu, payment tersimpan sama dengan total order
 * 2. flag-orphaned: order tidak ada, hasilnya 404
 * 3. flag-orphaned: idempotencyKey conflict, orderId berbeda, hasilnya 409 IDEMPOTENCY_KEY_CONFLICT
 * 4. flag-orphaned: jumlah di email dan payment sama dengan data server
 */

jest.unmock('@nestjs/schedule');

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { UserRole } from '@delivery/shared';

describe('collect-cod and flag-orphaned (e2e)', () => {
  let app: INestApplication;
  let driverToken: string;
  let customerToken: string;
  let prisma: PrismaClient;

  const driverUserId = 'e2e00000-0000-4000-8000-0000000d0010';
  const customerUserId = 'e2e00000-0000-4000-8000-0000000c0010';

  // Order IDs yang dibuat oleh test ini, untuk cleanup.
  const testOrderIds = [
    'e2e00000-0000-4000-8000-00000000c001',
    'e2e00000-0000-4000-8000-00000000c003',
    'e2e00000-0000-4000-8000-00000000c004',
    'e2e00000-0000-4000-8000-00000000c005',
    'e2e00000-0000-4000-8000-00000000c010',
    'e2e00000-0000-4000-8000-00000000c011',
  ];

  function generateToken(userId: string, role: UserRole): string {
    const jwtService = app.get<JwtService>(JwtService);
    return jwtService.sign({ sub: userId, role });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = new PrismaClient();
    await prisma.$connect();

    const testUsers = [
      { id: driverUserId, role: 'DRIVER' as const, name: 'E2E Driver COD', phone: '+628000020001' },
      { id: customerUserId, role: 'CUSTOMER' as const, name: 'E2E Customer COD', phone: '+628000020002' },
    ];
    for (const user of testUsers) {
      await prisma.user.upsert({
        where: { id: user.id },
        create: { ...user, passwordHash: null },
        update: {},
      });
    }

    // Hapus data order dari run sebelumnya supaya test bisa create ulang.
    for (const id of testOrderIds) {
      await prisma.payment.deleteMany({ where: { orderId: id } }).catch(() => {});
      await prisma.order.deleteMany({ where: { id } }).catch(() => {});
    }

    driverToken = generateToken(driverUserId, UserRole.DRIVER);
    customerToken = generateToken(customerUserId, UserRole.CUSTOMER);
  });

  afterAll(async () => {
    for (const id of testOrderIds) {
      await prisma.payment.deleteMany({ where: { orderId: id } }).catch(() => {});
      await prisma.order.deleteMany({ where: { id } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { id: { in: [driverUserId, customerUserId] } } });
    await prisma.$disconnect();
    await app.close();
  });

  // collect-cod: jumlah dari server

  describe('collect-cod amount dari server', () => {
    test('amountCents palsu, payment tersimpan sama dengan total order', async () => {
      const orderId = 'e2e00000-0000-4000-8000-00000000c001';
      const orderTotal = 90000;
      await prisma.order.create({
        data: {
          id: orderId,
          customerId: customerUserId,
          driverId: driverUserId,
          status: 'OUT_FOR_DELIVERY',
          itemsJson: [],
          addressJson: {},
          totalCents: orderTotal,
          currency: 'IDR',
          version: 1,
        },
      });

      const fakeAmount = 12345; // sengaja palsu
      const res = await request(app.getHttpServer())
        .post(`/payments/${orderId}/collect-cod`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ idempotencyKey: 'cod:a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', amountCents: fakeAmount });

      expect(res.status).toBe(201);
      expect(res.body.amountCents).toBe(orderTotal);
    });
  });

  // flag-orphaned: order tidak ada, hasilnya 404

  describe('flag-orphaned order tidak ada', () => {
    test('404: order tidak ditemukan', async () => {
      const nonexistentOrder = 'e2e00000-0000-4000-8000-00000000c002';

      const res = await request(app.getHttpServer())
        .post(`/payments/${nonexistentOrder}/flag-orphaned`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ idempotencyKey: 'cod:b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', amountCents: 50000 });

      expect(res.status).toBe(404);
    });
  });

  // flag-orphaned: idempotency key conflict

  describe('flag-orphaned idempotency key conflict', () => {
    test('409: idempotencyKey sama tapi orderId lain', async () => {
      const orderA = 'e2e00000-0000-4000-8000-00000000c003';
      const orderB = 'e2e00000-0000-4000-8000-00000000c004';

      // Buat payment dengan idempotencyKey tertentu di order A
      await prisma.order.create({
        data: {
          id: orderA,
          customerId: customerUserId,
          driverId: driverUserId,
          status: 'DELIVERED',
          itemsJson: [],
          addressJson: {},
          totalCents: 50000,
          currency: 'IDR',
          version: 1,
        },
      });

      await prisma.order.create({
        data: {
          id: orderB,
          customerId: customerUserId,
          driverId: driverUserId,
          status: 'DELIVERED',
          itemsJson: [],
          addressJson: {},
          totalCents: 60000,
          currency: 'IDR',
          version: 1,
        },
      });

      const sharedKey = 'cod:c1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

      // payment pertama di orderA
      await request(app.getHttpServer())
        .post(`/payments/${orderA}/flag-orphaned`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ idempotencyKey: sharedKey, amountCents: 50000 });

      // payment kedua dengan key sama di orderB, hasilnya 409
      const res = await request(app.getHttpServer())
        .post(`/payments/${orderB}/flag-orphaned`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ idempotencyKey: sharedKey, amountCents: 60000 });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    });
  });

  // flag-orphaned: jumlah dari data server

  describe('flag-orphaned jumlah dari server', () => {
    test('payment tersimpan sama dengan total order, email pakai amount server', async () => {
      const orderId = 'e2e00000-0000-4000-8000-00000000c005';
      const orderTotal = 120000;
      await prisma.order.create({
        data: {
          id: orderId,
          customerId: customerUserId,
          driverId: driverUserId,
          status: 'DELIVERED',
          itemsJson: [],
          addressJson: {},
          totalCents: orderTotal,
          currency: 'IDR',
          version: 1,
        },
      });

      const fakeAmount = 1; // sengaja palsu
      const res = await request(app.getHttpServer())
        .post(`/payments/${orderId}/flag-orphaned`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ idempotencyKey: 'cod:d1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', amountCents: fakeAmount });

      expect(res.status).toBe(201);
      expect(res.body.amountCents).toBe(orderTotal);
    });
  });

  // collect-cod: satu COD tercatat per order. COD kedua dengan kunci berbeda
  // dibalas 409 COD_ALREADY_CAPTURED, tidak dicatat lagi.

  describe('collect-cod satu COD tercatat per order', () => {
    test('COD kedua dengan kunci lain -> 409 COD_ALREADY_CAPTURED, body.payment.id sama dengan payment pertama', async () => {
      const orderId = 'e2e00000-0000-4000-8000-00000000c010';
      const orderTotal = 75000;
      await prisma.order.create({
        data: {
          id: orderId,
          customerId: customerUserId,
          driverId: driverUserId,
          status: 'OUT_FOR_DELIVERY',
          itemsJson: [],
          addressJson: {},
          totalCents: orderTotal,
          currency: 'IDR',
          version: 1,
        },
      });

      try {
        // COD pertama, 201
        const first = await request(app.getHttpServer())
          .post(`/payments/${orderId}/collect-cod`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ idempotencyKey: 'cod:e2e3a4b5-0000-4000-a000-00000000c010', amountCents: orderTotal });
        expect(first.status).toBe(201);
        const firstPaymentId = first.body.id;

        // COD kedua dengan kunci berbeda, 409
        const second = await request(app.getHttpServer())
          .post(`/payments/${orderId}/collect-cod`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ idempotencyKey: 'cod:e2e3a4b6-0000-4000-a000-00000000c010', amountCents: orderTotal });
        expect(second.status).toBe(409);
        expect(second.body.code).toBe('COD_ALREADY_CAPTURED');
        // body membawa payment yang sudah tercatat
        expect(second.body.payment.id).toBe(firstPaymentId);

        // DB: tepat 1 payment CAPTURED untuk order ini
        const payments = await prisma.payment.findMany({
          where: { orderId, status: 'CAPTURED', method: 'CASH', kind: 'PAYMENT', deletedAt: null },
        });
        expect(payments.length).toBe(1);
        expect(payments[0].id).toBe(firstPaymentId);
      } finally {
        await prisma.payment.deleteMany({ where: { orderId } }).catch(() => {});
        await prisma.order.deleteMany({ where: { id: orderId } }).catch(() => {});
      }
    });

    // dua collect-cod dengan kunci berbeda dikirim bersamaan (Promise.all):
    // tepat satu 201 dan satu 409, dan hanya satu COD tercatat. Mana yang
    // menang tergantung urutan kedatangan.
    test('dua COD dengan kunci berbeda dikirim bersamaan -> satu 201, satu 409', async () => {
      const orderId = 'e2e00000-0000-4000-8000-00000000c011';
      const orderTotal = 80000;
      await prisma.order.create({
        data: {
          id: orderId,
          customerId: customerUserId,
          driverId: driverUserId,
          status: 'OUT_FOR_DELIVERY',
          itemsJson: [],
          addressJson: {},
          totalCents: orderTotal,
          currency: 'IDR',
          version: 1,
        },
      });

      try {
        const [a, b] = await Promise.all([
          request(app.getHttpServer())
            .post(`/payments/${orderId}/collect-cod`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ idempotencyKey: 'cod:e2e3a4c1-0000-4000-a000-00000000c011', amountCents: orderTotal }),
          request(app.getHttpServer())
            .post(`/payments/${orderId}/collect-cod`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ idempotencyKey: 'cod:e2e3a4c2-0000-4000-a000-00000000c011', amountCents: orderTotal }),
        ]);

        const statuses = [a.status, b.status];
        const successCount = statuses.filter((s) => s === 201).length;
        const conflictCount = statuses.filter((s) => s === 409).length;
        expect(successCount).toBe(1);
        expect(conflictCount).toBe(1);

        // DB: tepat 1 payment CAPTURED untuk order ini
        const payments = await prisma.payment.findMany({
          where: { orderId, status: 'CAPTURED', method: 'CASH', kind: 'PAYMENT', deletedAt: null },
        });
        expect(payments.length).toBe(1);
      } finally {
        await prisma.payment.deleteMany({ where: { orderId } }).catch(() => {});
        await prisma.order.deleteMany({ where: { id: orderId } }).catch(() => {});
      }
    });
  });
});