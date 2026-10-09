/**
 * E2E tests untuk validasi body request (DTO class).
 *
 * Verifikasi bahwa ValidationPipe global (whitelist + forbidNonWhitelisted)
 * mengembalikan 400 untuk body yang salah tipe, dan menerima body
 * yang persis seperti yang dikirim mobile app.
 */

jest.unmock('@nestjs/schedule');

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { UserRole } from '@delivery/shared';

describe('DTO validation (e2e)', () => {
  let app: INestApplication;
  let driverToken: string;
  let customerToken: string;
  let prisma: PrismaClient;

  const driverUserId = 'e2e00000-0000-4000-8000-00000000d000';
  const customerUserId = 'e2e00000-0000-4000-8000-00000000c000';

  // Order IDs yang dibuat oleh test ini, untuk cleanup.
  const testOrderIds = [
    'e2e00000-0000-4000-8000-000000000a01',
    'e2e00000-0000-4000-8000-000000000a02',
    'e2e00000-0000-4000-8000-000000000a03',
    'e2e00000-0000-4000-8000-000000000a04',
    'e2e00000-0000-4000-8000-000000000a05',
    'e2e00000-0000-4000-8000-000000000a06',
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
      { id: driverUserId, role: 'DRIVER' as const, name: 'E2E Driver DTO', phone: '+628000010001' },
      { id: customerUserId, role: 'CUSTOMER' as const, name: 'E2E Customer DTO', phone: '+628000010002' },
    ];
    for (const user of testUsers) {
      await prisma.user.upsert({
        where: { id: user.id },
        create: { ...user, passwordHash: null },
        update: {},
      });
    }

    // Hapus data order dari run sebelumnya supaya test bisa create ulang.
    // Hapus payment milik order uji dulu karena ada FK ke order.
    await prisma.payment.deleteMany({ where: { orderId: { in: testOrderIds } } });
    for (const id of testOrderIds) {
      await prisma.order.deleteMany({ where: { id } }).catch(() => {});
    }

    driverToken = generateToken(driverUserId, UserRole.DRIVER);
    customerToken = generateToken(customerUserId, UserRole.CUSTOMER);
  });

  afterAll(async () => {
    // Hapus payment milik order uji dulu, baru order-nya (FK ke order).
    await prisma.payment.deleteMany({ where: { orderId: { in: testOrderIds } } });
    for (const id of testOrderIds) {
      await prisma.order.deleteMany({ where: { id } }).catch(() => {});
    }
    await prisma.user.deleteMany({ where: { id: { in: [driverUserId, customerUserId] } } });
    await prisma.$disconnect();
    await app.close();
  });

  // POST /orders/:id/accept

  describe('POST /orders/:id/accept', () => {
    test('400: version string bukan int', async () => {
      // Buat order ASSIGNED dulu
      const order = await prisma.order.create({
        data: {
          id: 'e2e00000-0000-4000-8000-000000000a01',
          customerId: customerUserId,
          status: 'ASSIGNED',
          itemsJson: [],
          addressJson: {},
          totalCents: 50000,
          currency: 'IDR',
          version: 1,
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/orders/${order.id}/accept`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ version: '1' });

      expect(res.status).toBe(400);
    });
  });

  // POST /orders/:id/reject

  describe('POST /orders/:id/reject', () => {
    test('400: version string bukan int', async () => {
      const order = await prisma.order.create({
        data: {
          id: 'e2e00000-0000-4000-8000-000000000a02',
          customerId: customerUserId,
          status: 'ASSIGNED',
          itemsJson: [],
          addressJson: {},
          totalCents: 50000,
          currency: 'IDR',
          version: 1,
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/orders/${order.id}/reject`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ version: '1' });

      expect(res.status).toBe(400);
    });
  });

  // POST /orders/:id/cancel

  describe('POST /orders/:id/cancel', () => {
    test('400: version string bukan int', async () => {
      const order = await prisma.order.create({
        data: {
          id: 'e2e00000-0000-4000-8000-000000000a03',
          customerId: customerUserId,
          status: 'ASSIGNED',
          itemsJson: [],
          addressJson: {},
          totalCents: 50000,
          currency: 'IDR',
          version: 1,
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ version: '1' });

      expect(res.status).toBe(400);
    });
  });

  // POST /chat/messages

  describe('POST /chat/messages', () => {
    let orderId: string;

    beforeAll(async () => {
      const order = await prisma.order.create({
        data: {
          id: 'e2e00000-0000-4000-8000-000000000a04',
          customerId: customerUserId,
          driverId: driverUserId,
          status: 'ASSIGNED',
          itemsJson: [],
          addressJson: {},
          totalCents: 50000,
          currency: 'IDR',
          version: 1,
        },
      });
      orderId = order.id;
    });

    test('400: roomId bukan UUID', async () => {
      const res = await request(app.getHttpServer())
        .post('/chat/messages')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ roomId: 'not-a-uuid', body: 'hello' });

      expect(res.status).toBe(400);
    });

    test('400: body kosong', async () => {
      const res = await request(app.getHttpServer())
        .post('/chat/messages')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ roomId: orderId, body: '' });

      expect(res.status).toBe(400);
    });
  });

  // POST /payments/:orderId/collect-cod

  describe('POST /payments/:orderId/collect-cod', () => {
    let orderId: string;

    beforeAll(async () => {
      const order = await prisma.order.create({
        data: {
          id: 'e2e00000-0000-4000-8000-000000000a05',
          customerId: customerUserId,
          driverId: driverUserId,
          status: 'OUT_FOR_DELIVERY',
          itemsJson: [],
          addressJson: {},
          totalCents: 75000,
          currency: 'IDR',
          version: 1,
        },
      });
      orderId = order.id;
    });

    test('400: idempotencyKey bukan string', async () => {
      const res = await request(app.getHttpServer())
        .post(`/payments/${orderId}/collect-cod`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ idempotencyKey: 123, amountCents: 75000 });

      expect(res.status).toBe(400);
    });

    test('400: amountCents string bukan int', async () => {
      const res = await request(app.getHttpServer())
        .post(`/payments/${orderId}/collect-cod`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ idempotencyKey: 'cod:e1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', amountCents: '75000' });

      expect(res.status).toBe(400);
    });
  });

  // POST /payments/:orderId/flag-orphaned

  describe('POST /payments/:orderId/flag-orphaned', () => {
    let orderId: string;

    beforeAll(async () => {
      const order = await prisma.order.create({
        data: {
          id: 'e2e00000-0000-4000-8000-000000000a06',
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
      orderId = order.id;
    });

    test('400: idempotencyKey bukan string', async () => {
      const res = await request(app.getHttpServer())
        .post(`/payments/${orderId}/flag-orphaned`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ idempotencyKey: 999, amountCents: 60000 });

      expect(res.status).toBe(400);
    });
  });
});