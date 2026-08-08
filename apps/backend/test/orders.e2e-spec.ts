/**
 * E2E tests untuk Orders accept/reject endpoints.
 *
 * Coverage:
 * 1. Driver accept order ASSIGNED → PREPARING
 * 2. Customer ditolak akses accept (403)
 * 3. Order tidak dalam status ASSIGNED → 400
 * 4. Order sudah di-assign driver lain → 409 Conflict
 * 5. Driver reject order ASSIGNED → CANCELLED
 * 6. Race condition: 2 driver accept bersamaan → cuma 1 sukses, 1 dapat 409
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient, OrderStatusDb } from '@prisma/client';

import { AppModule } from '../src/app.module';
import { UserRole, OrderStatus } from '@delivery/shared';

describe('Orders (e2e) - accept/reject', () => {
  let app: INestApplication;
  let driverToken: string;
  let customerToken: string;
  let prisma: PrismaClient;
  // UUID statis — deterministic, readable, dan valid sebagai @db.Uuid di Prisma.
  // Pola: prefix 'e2e00000-' (8 hex char) + '-0000-0000-' + 12 hex digit suffix.
  // Suffix mnemonic: 'd000' = driver, 'c000' = customer, suffix per-test dari nama test.
  const driverUserId = 'e2e00000-0000-0000-0000-00000000d000';
  const customerUserId = 'e2e00000-0000-0000-0000-00000000c000';
  // Additional driver IDs used in conflict/race tests
  const driver2UserId = 'e2e00000-0000-0000-0000-0000000d0002';
  const driver3UserId = 'e2e00000-0000-0000-0000-0000000d0003';

  // Helper buat generate JWT
  function generateToken(userId: string, role: UserRole): string {
    const jwtService = app.get<JwtService>(JwtService);
    return jwtService.sign({ sub: userId, role });
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    prisma = new PrismaClient();
    await prisma.$connect();

    // Seed test users — required karena Order.customerId FK ke User.id
    const testUsers = [
      { id: driverUserId, role: 'DRIVER' as const, name: 'E2E Driver 1', phone: '+628000000001' },
      { id: customerUserId, role: 'CUSTOMER' as const, name: 'E2E Customer', phone: '+628000000002' },
      { id: driver2UserId, role: 'DRIVER' as const, name: 'E2E Driver 2', phone: '+628000000003' },
      { id: driver3UserId, role: 'DRIVER' as const, name: 'E2E Driver 3', phone: '+628000000004' },
    ];
    for (const user of testUsers) {
      await prisma.user.upsert({
        where: { id: user.id },
        create: { ...user, passwordHash: null },
        update: {},
      });
    }

    driverToken = generateToken(driverUserId, UserRole.DRIVER);
    customerToken = generateToken(customerUserId, UserRole.CUSTOMER);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { id: { in: [driverUserId, customerUserId, driver2UserId, driver3UserId] } },
    });
    await app.close();
    await prisma.$disconnect();
  });

  // Helper: create order ASSIGNED untuk test
  async function createAssignedOrder(id: string, custId: string, driverId?: string) {
    return prisma.order.upsert({
      where: { id },
      create: {
        id,
        customerId: custId,
        driverId: driverId ?? null,
        status: OrderStatusDb.ASSIGNED,
        itemsJson: [],
        addressJson: { street: 'Test', city: 'Jakarta' },
        totalCents: 50000,
        currency: 'IDR',
        version: 1,
      },
      update: {},
    });
  }

  // Helper: cleanup order
  async function cleanupOrder(id: string) {
    try {
      await prisma.order.delete({ where: { id } });
    } catch {}
  }

  describe('POST /orders/:id/accept', () => {
    test('200: driver accept order ASSIGNED', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000a01';
      await createAssignedOrder(orderId, customerUserId);
      try {
        const resp = await request(app.getHttpServer())
          .post(`/orders/${orderId}/accept`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ version: 1 })
          .expect(200);

        expect(resp.body.status).toBe(OrderStatus.PREPARING);
        expect(resp.body.driverId).toBe(driverUserId);
        expect(resp.body.version).toBe(2);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('403: customer (bukan DRIVER) ditolak', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000a02';
      await createAssignedOrder(orderId, customerUserId);
      try {
        await request(app.getHttpServer())
          .post(`/orders/${orderId}/accept`)
          .set('Authorization', `Bearer ${customerToken}`)
          .send({ version: 1 })
          .expect(403);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('400: order tidak dalam status ASSIGNED', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000a03';
      await prisma.order.upsert({
        where: { id: orderId },
        create: {
          id: orderId,
          customerId: customerUserId,
          status: OrderStatusDb.PENDING,
          itemsJson: [],
          addressJson: {},
          totalCents: 10000,
          currency: 'IDR',
          version: 1,
        },
        update: {},
      });
      try {
        await request(app.getHttpServer())
          .post(`/orders/${orderId}/accept`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ version: 1 })
          .expect(400);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('409: order sudah di-assign driver lain', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000a04';
      await createAssignedOrder(orderId, customerUserId, driver2UserId);
      try {
        const resp = await request(app.getHttpServer())
          .post(`/orders/${orderId}/accept`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ version: 1 });
        expect([409, 423].includes(resp.status)).toBe(true); // 409 Conflict atau 423 Locked
      } finally {
        await cleanupOrder(orderId);
      }
    });
  });

  describe('POST /orders/:id/reject', () => {
    test('200: driver reject order ASSIGNED', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000b01';
      await createAssignedOrder(orderId, customerUserId);
      try {
        const resp = await request(app.getHttpServer())
          .post(`/orders/${orderId}/reject`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ version: 1 })
          .expect(200);

        expect(resp.body.status).toBe(OrderStatus.CANCELLED);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('403: customer (bukan DRIVER) ditolak reject', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000b02';
      await createAssignedOrder(orderId, customerUserId);
      try {
        await request(app.getHttpServer())
          .post(`/orders/${orderId}/reject`)
          .set('Authorization', `Bearer ${customerToken}`)
          .send({ version: 1 })
          .expect(403);
      } finally {
        await cleanupOrder(orderId);
      }
    });
  });

  describe('race condition: 2 driver accept bersamaan', () => {
    test('hanya 1 yang sukses, yang lain dapat 409', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000c01';
      const driver2Token = generateToken(driver2UserId, UserRole.DRIVER);

      await createAssignedOrder(orderId, customerUserId);
      try {
        // Fire 2 requests concurrently
        const [resp1, resp2] = await Promise.all([
          request(app.getHttpServer())
            .post(`/orders/${orderId}/accept`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ version: 1 }),
          request(app.getHttpServer())
            .post(`/orders/${orderId}/accept`)
            .set('Authorization', `Bearer ${driver2Token}`)
            .send({ version: 1 }),
        ]);

        const statuses = [resp1.status, resp2.status];
        const successCount = statuses.filter((s) => s === 200).length;
        const conflictCount = statuses.filter((s) => s === 409 || s === 423).length;

        expect(successCount).toBe(1);
        expect(conflictCount).toBe(1);
      } finally {
        await cleanupOrder(orderId);
      }
    });
  });
});
