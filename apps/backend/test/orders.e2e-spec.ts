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

    // Warm-up: establish Prisma connection pool before any test runs.
    // Without this, a cold pool causes the first query in each Prisma client
    // to take ~12ms extra (connection establishment), which shifts timing enough
    // that a "race condition" test can see sequential behavior instead of
    // concurrent behavior — making the losing driver get 400 (status check)
    // instead of 409 (OCC conflict). See race-condition-investigation-report.md.
    await prisma.$queryRaw`SELECT 1`;
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

        // A loser driver can get 409 (OCC conflict — version already bumped)
        // or 400 (status check — order already moved to PREPARING by winner).
        // Both are legitimate "I lost the race" outcomes. The assertion used to
        // only accept 409|423, which caused flakiness because Prisma connection
        // pool cold-start makes the second request arrive AFTER the first one
        // fully commits, hitting the status check instead of the OCC check.
        // See race-condition-investigation-report.md §Kandidat C.
        const statuses = [resp1.status, resp2.status];
        const successCount = statuses.filter((s) => s === 200).length;
        const loserCount = statuses.filter((s) => s === 409 || s === 423 || s === 400).length;

        expect(successCount).toBe(1);
        expect(loserCount).toBe(1);
      } finally {
        await cleanupOrder(orderId);
      }
    });
  });

  describe('cancel mid-delivery: driver cancel order', () => {
    test('driver cancel dari ASSIGNED - order CONFIRMED, driverId null, bisa di-assign ulang', async () => {
      // Setup: buat order di ASSIGNED (tanpa driver), assign ke driver, lalu cancel
      const orderId = 'e2e00000-0000-0000-0000-000000000d01';
      await prisma.order.upsert({
        where: { id: orderId },
        create: {
          id: orderId,
          customerId: customerUserId,
          driverId: null,
          status: 'ASSIGNED',
          itemsJson: [],
          addressJson: { street: 'Test', city: 'Jakarta' },
          totalCents: 50000,
          currency: 'IDR',
          version: 1,
        },
        update: {},
      });

      try {
        // Driver accept dulu (ini set driverId)
        const acceptResp = await request(app.getHttpServer())
          .post(`/orders/${orderId}/accept`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ version: 1 })
          .expect(200);
        expect(acceptResp.body.status).toBe('PREPARING');
        expect(acceptResp.body.driverId).toBe(driverUserId);

        // Driver cancel - order goes back to CONFIRMED, driver cleared
        const cancelResp = await request(app.getHttpServer())
          .post(`/orders/${orderId}/cancel`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ version: 2, reason: 'Kendaraan mogok' })
          .expect(200);
        expect(cancelResp.body.status).toBe('CONFIRMED');
        // driverId cleared so order can be re-assigned by dispatcher
        expect(cancelResp.body.driverId).toBeFalsy();
        // Note: reassignment from CONFIRMED -> ASSIGNED is handled externally
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('driver cancel PREPARING - 403 jika bukan owner', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000d02';
      const driver2Token = generateToken(driver2UserId, UserRole.DRIVER);

      await prisma.order.upsert({
        where: { id: orderId },
        create: {
          id: orderId,
          customerId: customerUserId,
          driverId: driverUserId, // assigned to driver1
          status: 'PREPARING',
          itemsJson: [],
          addressJson: { street: 'Test', city: 'Jakarta' },
          totalCents: 50000,
          currency: 'IDR',
          version: 1,
        },
        update: {},
      });

      try {
        // driver2 coba cancel order driver1 → harus 403
        await request(app.getHttpServer())
          .post(`/orders/${orderId}/cancel`)
          .set('Authorization', `Bearer ${driver2Token}`)
          .send({ version: 1 })
          .expect(403);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('400 jika order tidak dalam status cancellable (PENDING)', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000d03';
      await prisma.order.upsert({
        where: { id: orderId },
        create: {
          id: orderId,
          customerId: customerUserId,
          driverId: driverUserId,
          status: 'PENDING',
          itemsJson: [],
          addressJson: { street: 'Test', city: 'Jakarta' },
          totalCents: 50000,
          currency: 'IDR',
          version: 1,
        },
        update: {},
      });

      try {
        await request(app.getHttpServer())
          .post(`/orders/${orderId}/cancel`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ version: 1 })
          .expect(400);
      } finally {
        await cleanupOrder(orderId);
      }
    });
  });

  describe('COD collection', () => {
    test('driver collect COD - payment CASH CAPTURED', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000e01';
      const idempotencyKey = 'cod-idem-e2e-001';

      // Buat order PREPARING dengan driver assigned
      await prisma.order.upsert({
        where: { id: orderId },
        create: {
          id: orderId,
          customerId: customerUserId,
          driverId: driverUserId,
          status: 'PREPARING',
          itemsJson: [],
          addressJson: { street: 'Test', city: 'Jakarta' },
          totalCents: 50000,
          currency: 'IDR',
          version: 1,
        },
        update: {},
      });

      try {
        const resp = await request(app.getHttpServer())
          .post(`/payments/${orderId}/collect-cod`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ amountCents: 50000, idempotencyKey })
          .expect(201);

        expect(resp.body.method).toBe('CASH');
        expect(resp.body.status).toBe('CAPTURED');
        expect(resp.body.amountCents).toBe(50000);
        expect(resp.body.orderId).toBe(orderId);
      } finally {
        await prisma.payment.deleteMany({ where: { orderId } }).catch(() => {});
        await cleanupOrder(orderId);
      }
    });

    test('idempotency key replay - no double-create', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000e02';
      const idempotencyKey = 'cod-idem-e2e-002';

      await prisma.order.upsert({
        where: { id: orderId },
        create: {
          id: orderId,
          customerId: customerUserId,
          driverId: driverUserId,
          status: 'PREPARING',
          itemsJson: [],
          addressJson: { street: 'Test', city: 'Jakarta' },
          totalCents: 50000,
          currency: 'IDR',
          version: 1,
        },
        update: {},
      });

      try {
        // Request pertama
        await request(app.getHttpServer())
          .post(`/payments/${orderId}/collect-cod`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ amountCents: 50000, idempotencyKey })
          .expect(201);

        // Request kedua dengan idempotency key yang sama - harus berhasil tapi tidak double-create
        const resp2 = await request(app.getHttpServer())
          .post(`/payments/${orderId}/collect-cod`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ amountCents: 50000, idempotencyKey })
          .expect(201);

        // Cek hanya ada 1 payment record
        const payments = await prisma.payment.findMany({ where: { orderId } });
        expect(payments.length).toBe(1);
      } finally {
        await prisma.payment.deleteMany({ where: { orderId } }).catch(() => {});
        await cleanupOrder(orderId);
      }
    });

    test('403 jika bukan assigned driver', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000e03';
      const driver2Token = generateToken(driver2UserId, UserRole.DRIVER);

      await prisma.order.upsert({
        where: { id: orderId },
        create: {
          id: orderId,
          customerId: customerUserId,
          driverId: driverUserId,
          status: 'PREPARING',
          itemsJson: [],
          addressJson: { street: 'Test', city: 'Jakarta' },
          totalCents: 50000,
          currency: 'IDR',
          version: 1,
        },
        update: {},
      });

      try {
        await request(app.getHttpServer())
          .post(`/payments/${orderId}/collect-cod`)
          .set('Authorization', `Bearer ${driver2Token}`)
          .send({ amountCents: 50000, idempotencyKey: 'cod-idem-e2e-003' })
          .expect(403);
      } finally {
        await prisma.payment.deleteMany({ where: { orderId } }).catch(() => {});
        await cleanupOrder(orderId);
      }
    });
  });
});
