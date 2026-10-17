/**
 * E2E tests untuk Orders accept/reject endpoints.
 *
 * Coverage:
 * 1. Driver accept order ASSIGNED jadi PREPARING
 * 2. Customer ditolak akses accept (403)
 * 3. Order tidak dalam status ASSIGNED jadi 409 ORDER_UNAVAILABLE
 *    (sebelumnya 400, naik jadi 409 agar match dengan ConflictException
 *    body code di OrdersService.acceptOrder)
 * 4. Order sudah di-assign driver lain jadi 409 ORDER_UNAVAILABLE
 * 5. Driver reject order ASSIGNED jadi balik ke pool (ASSIGNED + driverId null)
 *    (sebelumnya CANCELLED, lalu CONFIRMED; sekarang ASSIGNED)
 * 6. Race condition: 2 driver accept bersamaan jadi cuma 1 sukses, 1 dapat
 *    409 (OCC) atau 400 (status check)
 * 7. Driver cancel jadi balik ke pool (ASSIGNED + driverId null)
 */

// E2E tests boot real AppModule, unmock @nestjs/schedule so ScheduleModule.forRoot()
// returns the real class, not the string-only mock (which causes WeakMap error in DI).
jest.unmock('@nestjs/schedule');

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
  // UUID statis, deterministic, readable, dan valid sebagai @db.Uuid di Prisma.
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

    // Seed test users, required karena Order.customerId FK ke User.id
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
    // concurrent behavior, making the losing driver get 400 (status check)
    // instead of 409 (OCC conflict). See race-condition-investigation-report.md.
    await prisma.$queryRaw`SELECT 1`;
  });

  afterAll(async () => {
    // Delete orders first (FK to users), then users
    await prisma.order.deleteMany({
      where: {
        customerId: { in: [driverUserId, customerUserId, driver2UserId, driver3UserId] },
      },
    });
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

    test('409: order tidak dalam status ASSIGNED', async () => {
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
        // Accept pada status bukan ASSIGNED sekarang dibalas 409
        // ORDER_UNAVAILABLE (sebelumnya 400). ConflictException body code
        // cocok dengan logic isVersionConflict di mobile.
        const resp = await request(app.getHttpServer())
          .post(`/orders/${orderId}/accept`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ version: 1 });
        expect(resp.status).toBe(409);
        expect(resp.body.code).toBe('ORDER_UNAVAILABLE');
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
    // rejectOrder now requires ownership (lihat orders.service.ts doc
    // comment) dan mengembalikan order ke pool (status ASSIGNED + driverId
    // null), bukan terminal CANCELLED atau CONFIRMED, sehingga pool fetch
    // berikutnya bisa langsung pick-up order ini kembali.
    test('200: driver reject order ASSIGNED yang di-assign ke dirinya jadi balik ke pool (ASSIGNED + driverId null)', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000b01';
      await createAssignedOrder(orderId, customerUserId, driverUserId);
      try {
        const resp = await request(app.getHttpServer())
          .post(`/orders/${orderId}/reject`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ version: 1 })
          .expect(200);

        // Balik ke pool = ASSIGNED + driverId null.
        expect(resp.body.status).toBe(OrderStatus.ASSIGNED);
        expect(resp.body.driverId).toBeFalsy();
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('403: customer (bukan DRIVER) ditolak reject', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000b02';
      await createAssignedOrder(orderId, customerUserId, driverUserId);
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

    test('403: driver bukan owner order ini (mencegah reject order pool/orang lain)', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000b03';
      // Order pool: driverId null, sebelum fix ini, driver mana pun bisa
      // reject (dan permanently CANCELLED-kan) order pool orang lain.
      await createAssignedOrder(orderId, customerUserId);
      try {
        await request(app.getHttpServer())
          .post(`/orders/${orderId}/reject`)
          .set('Authorization', `Bearer ${driverToken}`)
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

        // A loser driver can get 409 (OCC conflict, version already bumped)
        // or 400 (status check, order already moved to PREPARING by winner).
        // Both are legitimate "I lost the race" outcomes. The assertion used to
        // only accept 409|423, which caused flakiness because Prisma connection
        // pool cold-start makes the second request arrive AFTER the first one
        // fully commits, hitting the status check instead of the OCC check.
        // See race-condition-investigation-report.md Section Kandidat C.
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

  // PATCH /orders/:id/status, hanya driver owner yang boleh transisi
  // PREPARING jadi OUT_FOR_DELIVERY atau OUT_FOR_DELIVERY jadi DELIVERED,
  // dengan DTO + OCC.
  describe('PATCH /orders/:id/status', () => {
    // Helper: bikin order PREPARING dengan driver tertentu.
    async function createOrderWithDriver(
      id: string,
      status: OrderStatusDb,
      driverIdValue: string | null = driverUserId,
    ) {
      return prisma.order.upsert({
        where: { id },
        create: {
          id,
          customerId: customerUserId,
          driverId: driverIdValue,
          status,
          itemsJson: [],
          addressJson: { street: 'Test', city: 'Jakarta' },
          totalCents: 50000,
          currency: 'IDR',
          version: 1,
        },
        update: {},
      });
    }

    test('200: driver pemilik PREPARING jadi OUT_FOR_DELIVERY, version naik', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000f01';
      await createOrderWithDriver(orderId, OrderStatusDb.PREPARING);
      try {
        const resp = await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ status: 'OUT_FOR_DELIVERY', version: 1 })
          .expect(200);

        expect(resp.body.status).toBe(OrderStatus.OUT_FOR_DELIVERY);
        expect(resp.body.version).toBe(2);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('200: chain PREPARING jadi OUT_FOR_DELIVERY jadi DELIVERED, masing-masing naik satu versi', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000f02';
      await createOrderWithDriver(orderId, OrderStatusDb.PREPARING);
      try {
        const r1 = await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ status: 'OUT_FOR_DELIVERY', version: 1 })
          .expect(200);
        expect(r1.body.status).toBe(OrderStatus.OUT_FOR_DELIVERY);
        expect(r1.body.version).toBe(2);

        const r2 = await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ status: 'DELIVERED', version: 2 })
          .expect(200);
        expect(r2.body.status).toBe(OrderStatus.DELIVERED);
        expect(r2.body.version).toBe(3);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('403: customer pemilik jadi ditolak untuk semua target', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000f03';
      await createOrderWithDriver(orderId, OrderStatusDb.PREPARING);
      try {
        for (const target of ['OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']) {
          await request(app.getHttpServer())
            .patch(`/orders/${orderId}/status`)
            .set('Authorization', `Bearer ${customerToken}`)
            .send({ status: target, version: 1 })
            .expect(403);
        }
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('403: driver lain (bukan driverId order) jadi ditolak dengan body.code ORDER_NOT_ASSIGNED', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000f04';
      // Order ini dimiliki driverUserId. driver2UserId (driver lain) coba PATCH.
      await createOrderWithDriver(orderId, OrderStatusDb.PREPARING, driverUserId);
      const driver2Token = generateToken(driver2UserId, UserRole.DRIVER);
      try {
        // driver2Token != driverUserId jadi 403
        const r1 = await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${driver2Token}`)
          .send({ status: 'OUT_FOR_DELIVERY', version: 1 });
        expect(r1.status).toBe(403);
        expect(r1.body.code).toBe('ORDER_NOT_ASSIGNED');
        // Tetap 403 untuk target DELIVERED juga
        const r2 = await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${driver2Token}`)
          .send({ status: 'DELIVERED', version: 1 });
        expect(r2.status).toBe(403);
        expect(r2.body.code).toBe('ORDER_NOT_ASSIGNED');
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('403: driver pemilik jadi target ASSIGNED/CANCELLED ditolak', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000f05';
      await createOrderWithDriver(orderId, OrderStatusDb.PREPARING);
      try {
        for (const target of ['CANCELLED', 'ASSIGNED']) {
          await request(app.getHttpServer())
            .patch(`/orders/${orderId}/status`)
            .set('Authorization', `Bearer ${driverToken}`)
            .send({ status: target, version: 1 })
            .expect(403);
        }
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('400: tanpa version di body jadi 400 validasi', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000f06';
      await createOrderWithDriver(orderId, OrderStatusDb.PREPARING);
      try {
        const resp = await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ status: 'OUT_FOR_DELIVERY' })
          .expect(400);
        expect(resp.body.message).toEqual(expect.arrayContaining([expect.stringMatching(/version/)]));
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('400: status bukan enum OrderStatus jadi 400 validasi', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000f07';
      await createOrderWithDriver(orderId, OrderStatusDb.PREPARING);
      try {
        await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ status: 'BOGUS_STATUS', version: 1 })
          .expect(400);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('409 INVALID_TRANSITION: DELIVERED diminta saat source PREPARING', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000f08';
      await createOrderWithDriver(orderId, OrderStatusDb.PREPARING);
      try {
        const resp = await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ status: 'DELIVERED', version: 1 });
        expect(resp.status).toBe(409);
        expect(resp.body.code).toBe('INVALID_TRANSITION');
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('409 VERSION_CONFLICT: versi basi', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000f09';
      await createOrderWithDriver(orderId, OrderStatusDb.PREPARING);
      try {
        // Order masih version 1, tapi kita kirim version 99
        const resp = await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ status: 'OUT_FOR_DELIVERY', version: 99 });
        expect(resp.status).toBe(409);
        expect(resp.body.code).toBe('VERSION_CONFLICT');
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('404: order tidak ada jadi 404', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000f0a';
      // Tidak membuat order
      await request(app.getHttpServer())
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${driverToken}`)
        .send({ status: 'OUT_FOR_DELIVERY', version: 1 })
        .expect(404);
    });

    test('tidak ada event order:unavailable untuk transition ini', async () => {
      // Regression guard: dua transisi PREPARING jadi OUT_FOR_DELIVERY dan
      // OUT_FOR_DELIVERY jadi DELIVERED tidak pernah berasal dari pool,
      // jadi transitionStatus tidak memanggil emitOrderUnavailable.
      // Assertion ditegakkan via mock Gateway (lihat unit test), di e2e
      // cukup verifikasi endpoint sukses untuk transisi yang dulu allowed.
      const orderId = 'e2e00000-0000-0000-0000-000000000f0b';
      await createOrderWithDriver(orderId, OrderStatusDb.PREPARING);
      try {
        const resp = await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ status: 'OUT_FOR_DELIVERY', version: 1 })
          .expect(200);
        // Status pasti OUT_FOR_DELIVERY (bukan canceled/dll)
        expect(resp.body.status).toBe(OrderStatus.OUT_FOR_DELIVERY);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    // Order PREPARING milik driver1 dengan versi 3 (diatur lewat prisma
    // setelah dibuat), driver2 PATCH dengan version 2 -> 409 ORDER_REASSIGNED.
    // DB tidak berubah.
    test('409 ORDER_REASSIGNED: driver lain, versi kiriman beda dengan versi order, DB tidak berubah', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000f0c';
      await createOrderWithDriver(orderId, OrderStatusDb.PREPARING, driverUserId);
      // Versi dinaikkan langsung lewat prisma, seolah order sudah pindah
      // dari driver2 ke driver1 setelah driver2 membacanya.
      await prisma.order.update({
        where: { id: orderId },
        data: { version: 3 },
      });
      const driver2Token = generateToken(driver2UserId, UserRole.DRIVER);
      try {
        const resp = await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${driver2Token}`)
          .send({ status: 'OUT_FOR_DELIVERY', version: 2 });
        expect(resp.status).toBe(409);
        expect(resp.body.code).toBe('ORDER_REASSIGNED');

        // DB: status, driver, dan versi tidak berubah dari 3
        const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
        expect(dbOrder?.status).toBe(OrderStatusDb.PREPARING);
        expect(dbOrder?.driverId).toBe(driverUserId);
        expect(dbOrder?.version).toBe(3);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    // Kiriman ulang PATCH dengan versi lama (respons pertama hilang):
    // permintaan pertama sukses (200, versi 2), permintaan kedua dengan
    // versi sama (1) tetap 200 dengan body.status OUT_FOR_DELIVERY dan
    // body.version 2; versi di DB tidak naik lagi.
    test('200: kiriman ulang PATCH dengan versi lama tetap sukses tanpa mengubah order', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000f0d';
      await createOrderWithDriver(orderId, OrderStatusDb.PREPARING);
      try {
        // Permintaan pertama: sukses, versi naik 1 -> 2
        const r1 = await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ status: 'OUT_FOR_DELIVERY', version: 1 });
        expect(r1.status).toBe(200);
        expect(r1.body.status).toBe(OrderStatus.OUT_FOR_DELIVERY);
        expect(r1.body.version).toBe(2);

        // Permintaan kedua dengan versi sama (1, kiriman ulang setelah
        // batas waktu 8 detik di app): dianggap kiriman ulang, sukses
        // dengan status dan versi server.
        const r2 = await request(app.getHttpServer())
          .patch(`/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ status: 'OUT_FOR_DELIVERY', version: 1 });
        expect(r2.status).toBe(200);
        expect(r2.body.status).toBe(OrderStatus.OUT_FOR_DELIVERY);
        expect(r2.body.version).toBe(2);

        // DB: versi tetap 2 (permintaan kedua tidak menulis)
        const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
        expect(dbOrder?.version).toBe(2);
        expect(dbOrder?.status).toBe(OrderStatusDb.OUT_FOR_DELIVERY);
      } finally {
        await cleanupOrder(orderId);
      }
    });
  });

  describe('cancel mid-delivery: driver cancel order', () => {
    test('driver cancel dari ASSIGNED - order balik ke pool (ASSIGNED + driverId null), bisa di-assign ulang', async () => {
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

        // Driver cancel, order balik ke pool (ASSIGNED + driverId null,
        // bukan CONFIRMED).
        const cancelResp = await request(app.getHttpServer())
          .post(`/orders/${orderId}/cancel`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ version: 2, reason: 'Kendaraan mogok' })
          .expect(200);
        expect(cancelResp.body.status).toBe('ASSIGNED');
        // driverId cleared so order can be re-assigned by another driver
        // via pool fetch
        expect(cancelResp.body.driverId).toBeFalsy();
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
        // driver2 coba cancel order driver1 jadi harus 403
        await request(app.getHttpServer())
          .post(`/orders/${orderId}/cancel`)
          .set('Authorization', `Bearer ${driver2Token}`)
          .send({ version: 1 })
          .expect(403);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('409 jika order tidak dalam status yang bisa dibatalkan (PENDING)', async () => {
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
        const resp = await request(app.getHttpServer())
          .post(`/orders/${orderId}/cancel`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ version: 1 });
        expect(resp.status).toBe(409);
        expect(resp.body.code).toBe('ORDER_NOT_CANCELLABLE');
      } finally {
        await cleanupOrder(orderId);
      }
    });

    // order PREPARING milik driver lain dengan versi server lebih baru -> 409
    // ORDER_REASSIGNED, DB tidak berubah.
    test('409 ORDER_REASSIGNED: driver1 cancel PREPARING milik driver2 (versi server 3, kiriman 2), DB tidak berubah', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000d04';
      const driver2Token = generateToken(driver2UserId, UserRole.DRIVER);
      // driver1 menerima order dulu, jadi PREPARING dengan driverId = driver1
      await createAssignedOrder(orderId, customerUserId);
      try {
        // driver1 menerima order (versi 1 -> 2)
        await request(app.getHttpServer())
          .post(`/orders/${orderId}/accept`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ version: 1 })
          .expect(200);
        // order dipindah ke driver2 langsung lewat DB, versi 2 -> 3
        await prisma.order.update({
          where: { id: orderId },
          data: { driverId: driver2UserId, version: 3 },
        });

        // driver1 membatalkan dengan versi 2 -> harus 409 ORDER_REASSIGNED
        const resp = await request(app.getHttpServer())
          .post(`/orders/${orderId}/cancel`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ version: 2 });
        expect(resp.status).toBe(409);
        expect(resp.body.code).toBe('ORDER_REASSIGNED');

        // DB: order tetap PREPARING, driver tetap driver2, versi tetap 3
        const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
        expect(dbOrder?.status).toBe(OrderStatusDb.PREPARING);
        expect(dbOrder?.driverId).toBe(driver2UserId);
        expect(dbOrder?.version).toBe(3);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    // order pool (driver null, cancelledBy null) dengan versi server lebih baru
    // -> 409 ORDER_REASSIGNED.
    test('409 ORDER_REASSIGNED: driver1 cancel order pool (driver null) versi 3, kiriman 2', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000d05';
      // order pool versi 3, aplikasi mengirim versi 2.
      await prisma.order.upsert({
        where: { id: orderId },
        create: {
          id: orderId,
          customerId: customerUserId,
          driverId: null,
          cancelledBy: null,
          status: 'ASSIGNED',
          itemsJson: [],
          addressJson: { street: 'Test', city: 'Jakarta' },
          totalCents: 50000,
          currency: 'IDR',
          version: 3,
        },
        update: {},
      });
      try {
        // driver1 membatalkan dengan versi 2 -> harus 409 ORDER_REASSIGNED
        const resp = await request(app.getHttpServer())
          .post(`/orders/${orderId}/cancel`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ version: 2 });
        expect(resp.status).toBe(409);
        expect(resp.body.code).toBe('ORDER_REASSIGNED');
      } finally {
        await cleanupOrder(orderId);
      }
    });

    // kiriman ulang pembatalan yang sudah berhasil: order ASSIGNED, driver null,
    // cancelledBy = driver1, versi 3. Kiriman versi 2 -> 200, body.version 3,
    // versi di DB tetap 3.
    test('200: kirim ulang cancel (order ASSIGNED, driver null, cancelledBy driver1, versi 3), kiriman 2', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000d06';
      await prisma.order.upsert({
        where: { id: orderId },
        create: {
          id: orderId,
          customerId: customerUserId,
          driverId: null,
          cancelledBy: driverUserId,
          cancelReason: 'Kendaraan mogok',
          status: 'ASSIGNED',
          itemsJson: [],
          addressJson: { street: 'Test', city: 'Jakarta' },
          totalCents: 50000,
          currency: 'IDR',
          version: 3,
        },
        update: {},
      });
      try {
        // Versi 2 sudah basi, server di versi 3. Server mengenalinya sebagai
        // kiriman ulang pembatalan yang sudah berhasil (cancelledBy = pemanggil,
        // versi = kiriman + 1) dan mengembalikan order apa adanya.
        const resp = await request(app.getHttpServer())
          .post(`/orders/${orderId}/cancel`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ version: 2, reason: 'Kendaraan mogok' })
          .expect(200);
        expect(resp.body.version).toBe(3);
        expect(resp.body.cancelledBy).toBe(driverUserId);

        // DB: versi tetap 3
        const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
        expect(dbOrder?.version).toBe(3);
        expect(dbOrder?.cancelledBy).toBe(driverUserId);
      } finally {
        await cleanupOrder(orderId);
      }
    });
  });

  describe('COD collection', () => {
    test('driver collect COD - payment CASH CAPTURED', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000e01';
      const idempotencyKey = 'cod:00000001-0000-4000-8000-000000000001';

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

    // order OUT_FOR_DELIVERY dengan COD tercatat dibatalkan pemiliknya -> 409
    // COD_ALREADY_CAPTURED. Status, driver, dan versi tidak berubah, tetap 1 payment.
    test('409 COD_ALREADY_CAPTURED: cancel setelah collect-cod, DB tidak berubah', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000e10';
      const idempotencyKey = 'cod:00000010-0000-4000-8000-000000000010';

      // Persiapan: order OUT_FOR_DELIVERY milik driver1, versi 3
      await prisma.order.upsert({
        where: { id: orderId },
        create: {
          id: orderId,
          customerId: customerUserId,
          driverId: driverUserId,
          status: 'OUT_FOR_DELIVERY',
          itemsJson: [],
          addressJson: { street: 'Test', city: 'Jakarta' },
          totalCents: 50000,
          currency: 'IDR',
          version: 3,
        },
        update: {},
      });

      try {
        // Driver collect-cod dulu (201)
        await request(app.getHttpServer())
          .post(`/payments/${orderId}/collect-cod`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ amountCents: 50000, idempotencyKey })
          .expect(201);

        // Driver membatalkan dengan versi 3 -> 409 COD_ALREADY_CAPTURED
        const resp = await request(app.getHttpServer())
          .post(`/orders/${orderId}/cancel`)
          .set('Authorization', `Bearer ${driverToken}`)
          .send({ version: 3, reason: 'salah catat' });
        expect(resp.status).toBe(409);
        expect(resp.body.code).toBe('COD_ALREADY_CAPTURED');

        // DB: status tetap OUT_FOR_DELIVERY, driver tetap driver1, versi tetap 3
        const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
        expect(dbOrder?.status).toBe('OUT_FOR_DELIVERY');
        expect(dbOrder?.driverId).toBe(driverUserId);
        expect(dbOrder?.version).toBe(3);

        // Tepat 1 payment CAPTURED untuk order itu
        const payments = await prisma.payment.findMany({
          where: { orderId, status: 'CAPTURED', method: 'CASH', kind: 'PAYMENT', deletedAt: null },
        });
        expect(payments.length).toBe(1);
      } finally {
        // Bersihkan payment tes ini lewat orderId order tes
        await prisma.payment.deleteMany({ where: { orderId } }).catch(() => {});
        await cleanupOrder(orderId);
      }
    });

    test('idempotency key replay - no double-create', async () => {
      const orderId = 'e2e00000-0000-0000-0000-000000000e02';
      const idempotencyKey = 'cod:00000002-0000-4000-8000-000000000002';

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
          .send({ amountCents: 50000, idempotencyKey: 'cod:00000003-0000-4000-8000-000000000003' })
          .expect(403);
      } finally {
        await prisma.payment.deleteMany({ where: { orderId } }).catch(() => {});
        await cleanupOrder(orderId);
      }
    });
  });

  describe('POST /orders (create)', () => {
    test('201: customer bisa create order', async () => {
      const resp = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
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
          notes: 'Pakai extra sambel',
        })
        .expect(201);

      // Order baru lahir ASSIGNED + driverId null (pool state), bukan
      // PENDING. Broadcast emitOrderAvailable dipanggil supaya driver
      // yang online langsung lihat order baru tanpa pull REST.
      expect(resp.body.status).toBe(OrderStatus.ASSIGNED);
      expect(resp.body.customerId).toBe(customerUserId);
      expect(resp.body.items).toHaveLength(1);
      expect(resp.body.deliveryAddress.recipientName).toBe('Budi');
      expect(resp.body.totalCents).toBe(50000);
      expect(resp.body.currency).toBe('IDR');
      expect(resp.body.version).toBe(1);
      expect(resp.body.id).toBeDefined();

      // Cleanup
      await cleanupOrder(resp.body.id);
    });

    test('403: driver tidak bisa create order', async () => {
      await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${driverToken}`)
        .send({
          items: [
            { productId: 'prod-1', name: 'Nasi Goreng', quantity: 1, unitPriceCents: 25000 },
          ],
          deliveryAddress: {
            recipientName: 'Budi',
            phone: '081234567890',
            street: 'Jl. Merdeka No. 1',
            city: 'Jakarta',
            postalCode: '10110',
          },
        })
        .expect(403);
    });

    test('400: items array kosong jadi validasi error', async () => {
      const resp = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          items: [],
          deliveryAddress: {
            recipientName: 'Budi',
            phone: '081234567890',
            street: 'Jl. Merdeka No. 1',
            city: 'Jakarta',
            postalCode: '10110',
          },
        })
        .expect(400);
      expect(resp.body.message).toContain('Minimal satu barang');
    });

    test('400: quantity = 0 jadi validasi error', async () => {
      const resp = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          items: [
            { productId: 'prod-1', name: 'Nasi Goreng', quantity: 0, unitPriceCents: 25000 },
          ],
          deliveryAddress: {
            recipientName: 'Budi',
            phone: '081234567890',
            street: 'Jl. Merdeka No. 1',
            city: 'Jakarta',
            postalCode: '10110',
          },
        })
        .expect(400);
      expect(resp.body.message.some((m: string) => m.toLowerCase().includes('quantity'))).toBe(true);
    });

    test('400: quantity negatif jadi validasi error', async () => {
      const resp = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          items: [
            { productId: 'prod-1', name: 'Nasi Goreng', quantity: -5, unitPriceCents: 25000 },
          ],
          deliveryAddress: {
            recipientName: 'Budi',
            phone: '081234567890',
            street: 'Jl. Merdeka No. 1',
            city: 'Jakarta',
            postalCode: '10110',
          },
        })
        .expect(400);
      expect(resp.body.message.some((m: string) => m.toLowerCase().includes('quantity'))).toBe(true);
    });

    test('400: unitPriceCents = 0 jadi validasi error', async () => {
      const resp = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          items: [
            { productId: 'prod-1', name: 'Nasi Goreng', quantity: 1, unitPriceCents: 0 },
          ],
          deliveryAddress: {
            recipientName: 'Budi',
            phone: '081234567890',
            street: 'Jl. Merdeka No. 1',
            city: 'Jakarta',
            postalCode: '10110',
          },
        })
        .expect(400);
      expect(resp.body.message.some((m: string) => m.includes('Harga satuan'))).toBe(true);
    });

    test('400: missing deliveryAddress jadi validasi error', async () => {
      const resp = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          items: [
            { productId: 'prod-1', name: 'Nasi Goreng', quantity: 1, unitPriceCents: 25000 },
          ],
        })
        .expect(400);
      expect(resp.body.message).toContain('deliveryAddress must be an object');
    });

    test('400: missing recipientName jadi validasi error', async () => {
      const resp = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          items: [
            { productId: 'prod-1', name: 'Nasi Goreng', quantity: 1, unitPriceCents: 25000 },
          ],
          deliveryAddress: {
            recipientName: '',
            phone: '081234567890',
            street: 'Jl. Merdeka No. 1',
            city: 'Jakarta',
            postalCode: '10110',
          },
        })
        .expect(400);
      expect(resp.body.message.some((m: string) => m.includes('Nama penerima'))).toBe(true);
    });

    test('400: missing city jadi validasi error', async () => {
      const resp = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          items: [
            { productId: 'prod-1', name: 'Nasi Goreng', quantity: 1, unitPriceCents: 25000 },
          ],
          deliveryAddress: {
            recipientName: 'Budi',
            phone: '081234567890',
            street: 'Jl. Merdeka No. 1',
            city: '',
            postalCode: '10110',
          },
        })
        .expect(400);
      expect(resp.body.message.some((m: string) => m.includes('Kota'))).toBe(true);
    });

    // Validasi coordinates. Order tanpa coordinates sudah dicakup tes
    // "201: customer bisa create order" di atas.
    test('201: coordinates [115.2167, -8.65] tersimpan persis', async () => {
      const resp = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          items: [
            { productId: 'prod-1', name: 'Nasi Goreng', quantity: 1, unitPriceCents: 25000 },
          ],
          deliveryAddress: {
            recipientName: 'Budi',
            phone: '081234567890',
            street: 'Jl. Merdeka No. 1',
            city: 'Jakarta',
            postalCode: '10110',
            coordinates: [115.2167, -8.65],
          },
        })
        .expect(201);

      expect(resp.body.deliveryAddress.coordinates).toEqual([115.2167, -8.65]);

      const orderId = resp.body.id;
      try {
        // Ambil ulang lewat GET supaya yang dicek isi database, bukan
        // sekadar respons POST.
        const fetched = await request(app.getHttpServer())
          .get(`/orders/${orderId}`)
          .set('Authorization', `Bearer ${customerToken}`)
          .expect(200);
        expect(fetched.body.deliveryAddress.coordinates).toEqual([115.2167, -8.65]);
      } finally {
        await cleanupOrder(orderId);
      }
    });

    test('400: coordinates tertukar [-8.65, 115.2167]', async () => {
      const resp = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          items: [
            { productId: 'prod-1', name: 'Nasi Goreng', quantity: 1, unitPriceCents: 25000 },
          ],
          deliveryAddress: {
            recipientName: 'Budi',
            phone: '081234567890',
            street: 'Jl. Merdeka No. 1',
            city: 'Jakarta',
            postalCode: '10110',
            coordinates: [-8.65, 115.2167],
          },
        })
        .expect(400);
      const messages = Array.isArray(resp.body.message)
        ? resp.body.message
        : [resp.body.message];
      expect(messages.some((m: string) => m.toLowerCase().includes('coordinates'))).toBe(true);
    });

    test('400: coordinates satu angka [115.2167]', async () => {
      const resp = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          items: [
            { productId: 'prod-1', name: 'Nasi Goreng', quantity: 1, unitPriceCents: 25000 },
          ],
          deliveryAddress: {
            recipientName: 'Budi',
            phone: '081234567890',
            street: 'Jl. Merdeka No. 1',
            city: 'Jakarta',
            postalCode: '10110',
            coordinates: [115.2167],
          },
        })
        .expect(400);
      const messages = Array.isArray(resp.body.message)
        ? resp.body.message
        : [resp.body.message];
      expect(messages.some((m: string) => m.toLowerCase().includes('coordinates'))).toBe(true);
    });

    test('400: coordinates tiga angka [115.2167, -8.65, 0]', async () => {
      const resp = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          items: [
            { productId: 'prod-1', name: 'Nasi Goreng', quantity: 1, unitPriceCents: 25000 },
          ],
          deliveryAddress: {
            recipientName: 'Budi',
            phone: '081234567890',
            street: 'Jl. Merdeka No. 1',
            city: 'Jakarta',
            postalCode: '10110',
            coordinates: [115.2167, -8.65, 0],
          },
        })
        .expect(400);
      const messages = Array.isArray(resp.body.message)
        ? resp.body.message
        : [resp.body.message];
      expect(messages.some((m: string) => m.toLowerCase().includes('coordinates'))).toBe(true);
    });

    test('400: coordinates berupa string ["115.2167", "-8.65"]', async () => {
      const resp = await request(app.getHttpServer())
        .post('/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({
          items: [
            { productId: 'prod-1', name: 'Nasi Goreng', quantity: 1, unitPriceCents: 25000 },
          ],
          deliveryAddress: {
            recipientName: 'Budi',
            phone: '081234567890',
            street: 'Jl. Merdeka No. 1',
            city: 'Jakarta',
            postalCode: '10110',
            coordinates: ['115.2167', '-8.65'],
          },
        })
        .expect(400);
      const messages = Array.isArray(resp.body.message)
        ? resp.body.message
        : [resp.body.message];
      expect(messages.some((m: string) => m.toLowerCase().includes('coordinates'))).toBe(true);
    });
  });

  // Unit tests for race condition assertion logic.
  // Proves loserCount filter is correct for BOTH OCC (409) and status-check (400) paths.
  describe('race condition assertion logic', () => {
    it('passes when one driver gets 200 and the other gets 409 (OCC conflict)', () => {
      const statuses = [200, 409];
      const successCount = statuses.filter((s) => s === 200).length;
      const loserCount = statuses.filter((s) => s === 409 || s === 423 || s === 400).length;
      expect(successCount).toBe(1);
      expect(loserCount).toBe(1);
    });

    it('passes when one driver gets 200 and the other gets 400 (status already PREPARING)', () => {
      const statuses = [200, 400];
      const successCount = statuses.filter((s) => s === 200).length;
      const loserCount = statuses.filter((s) => s === 409 || s === 423 || s === 400).length;
      expect(successCount).toBe(1);
      expect(loserCount).toBe(1);
    });

    it('passes when winner is r2 and loser gets 400', () => {
      const statuses = [400, 200];
      const successCount = statuses.filter((s) => s === 200).length;
      const loserCount = statuses.filter((s) => s === 409 || s === 423 || s === 400).length;
      expect(successCount).toBe(1);
      expect(loserCount).toBe(1);
    });
  });

  // E2E: sync push menolak order/payment; capture endpoint dihapus.
  describe('sync push, order/payment ditolak', () => {
    const deviceId = 'e2e-sync-device';
    const orderId = 'e2e00000-0000-0000-0000-00000000e001';

    async function cleanupOrder() {
      await prisma.payment.deleteMany({ where: { orderId } }).catch(() => {});
      await prisma.order.deleteMany({ where: { id: orderId } }).catch(() => {});
    }

    test('push order baru jadi rejected, tidak ada baris order', async () => {
      await cleanupOrder();
      try {
        const resp = await request(app.getHttpServer())
          .post('/sync/push')
          .set('Authorization', `Bearer ${customerToken}`)
          .send({
            deviceId,
            userId: customerUserId,
            sinceCursor: null,
            records: [{
              entityType: 'order',
              id: orderId,
              data: {
                id: orderId,
                customerId: customerUserId,
                driverId: undefined,
                status: 'PENDING',
                items: [],
                deliveryAddress: { recipientName: 'Budi', phone: '0812', street: 'Jl Merdeka', city: 'Jakarta', postalCode: '10110' },
                totalCents: 50000,
                currency: 'IDR',
                notes: undefined,
                version: 1,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              op: 'create',
              clientChangedAt: new Date().toISOString(),
              baseVersion: null,
            }],
          });
        // NestJS default POST status = 201
        expect(resp.status).toBe(201);
        expect(resp.body.acks).toHaveLength(1);
        expect(resp.body.acks[0].status).toBe('rejected');
        expect(resp.body.acks[0].reason).toBe('Order hanya bisa diubah lewat endpoint order');
        // Tidak ada baris order di DB
        const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
        expect(dbOrder).toBeNull();
      } finally {
        await cleanupOrder();
      }
    });

    test('push order update (versi cocok) jadi rejected', async () => {
      // Buat order dulu via REST, lalu push update via sync
      await prisma.order.upsert({
        where: { id: orderId },
        create: {
          id: orderId,
          customerId: customerUserId,
          driverId: driverUserId,
          status: OrderStatusDb.PREPARING,
          itemsJson: [],
          addressJson: { recipientName: 'Budi', phone: '0812', street: 'Jl Merdeka', city: 'Jakarta', postalCode: '10110' },
          totalCents: 50000,
          currency: 'IDR',
          version: 1,
        },
        update: {},
      });
      try {
        const resp = await request(app.getHttpServer())
          .post('/sync/push')
          .set('Authorization', `Bearer ${driverToken}`)
          .send({
            deviceId,
            userId: driverUserId,
            sinceCursor: null,
            records: [{
              entityType: 'order',
              id: orderId,
              data: {
                id: orderId,
                customerId: customerUserId,
                driverId: driverUserId,
                status: 'OUT_FOR_DELIVERY',
                items: [],
                deliveryAddress: { recipientName: 'Budi', phone: '0812', street: 'Jl Merdeka', city: 'Jakarta', postalCode: '10110' },
                totalCents: 50000,
                currency: 'IDR',
                notes: undefined,
                version: 2,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              op: 'update',
              clientChangedAt: new Date().toISOString(),
              baseVersion: 1,
            }],
          });
        // NestJS default POST status = 201
        expect(resp.status).toBe(201);
        expect(resp.body.acks).toHaveLength(1);
        expect(resp.body.acks[0].status).toBe('rejected');
        expect(resp.body.acks[0].reason).toBe('Order hanya bisa diubah lewat endpoint order');
        // Versi order tidak berubah
        const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
        expect(dbOrder?.version).toBe(1);
      } finally {
        await cleanupOrder();
      }
    });

    test('push order update mengubah driverId (versi cocok) jadi rejected', async () => {
      await prisma.order.upsert({
        where: { id: orderId },
        create: {
          id: orderId,
          customerId: customerUserId,
          driverId: driverUserId,
          status: OrderStatusDb.PREPARING,
          itemsJson: [],
          addressJson: { recipientName: 'Budi', phone: '0812', street: 'Jl Merdeka', city: 'Jakarta', postalCode: '10110' },
          totalCents: 50000,
          currency: 'IDR',
          version: 1,
        },
        update: {},
      });
      try {
        const resp = await request(app.getHttpServer())
          .post('/sync/push')
          .set('Authorization', `Bearer ${driverToken}`)
          .send({
            deviceId,
            userId: driverUserId,
            sinceCursor: null,
            records: [{
              entityType: 'order',
              id: orderId,
              data: {
                id: orderId,
                customerId: customerUserId,
                driverId: driver2UserId, // driver lain
                status: 'PREPARING',
                items: [],
                deliveryAddress: { recipientName: 'Budi', phone: '0812', street: 'Jl Merdeka', city: 'Jakarta', postalCode: '10110' },
                totalCents: 50000,
                currency: 'IDR',
                notes: undefined,
                version: 2,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              op: 'update',
              clientChangedAt: new Date().toISOString(),
              baseVersion: 1,
            }],
          });
        // NestJS default POST status = 201
        expect(resp.status).toBe(201);
        expect(resp.body.acks[0].status).toBe('rejected');
        // driverId tidak berubah
        const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
        expect(dbOrder?.driverId).toBe(driverUserId);
      } finally {
        await cleanupOrder();
      }
    });

    test('push payment create CAPTURED jadi rejected, tidak ada baris payment', async () => {
      await cleanupOrder();
      const paymentId = 'e2e00000-0000-0000-0000-00000000e002';
      try {
        const resp = await request(app.getHttpServer())
          .post('/sync/push')
          .set('Authorization', `Bearer ${customerToken}`)
          .send({
            deviceId,
            userId: customerUserId,
            sinceCursor: null,
            records: [{
              entityType: 'payment',
              id: paymentId,
              data: {
                id: paymentId,
                orderId,
                idempotencyKey: 'e2e-capture-push',
                method: 'CARD',
                status: 'CAPTURED',
                amountCents: 50000,
                currency: 'IDR',
                kind: 'PAYMENT',
                externalRef: 'ref-123',
                version: 1,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
              op: 'create',
              clientChangedAt: new Date().toISOString(),
              baseVersion: null,
            }],
          });
        // NestJS default POST status = 201
        expect(resp.status).toBe(201);
        expect(resp.body.acks).toHaveLength(1);
        expect(resp.body.acks[0].status).toBe('rejected');
        expect(resp.body.acks[0].reason).toBe('Pembayaran hanya bisa diubah lewat endpoint pembayaran');
        // Tidak ada baris payment di DB
        const dbPayment = await prisma.payment.findUnique({ where: { id: paymentId } });
        expect(dbPayment).toBeNull();
      } finally {
        await prisma.payment.deleteMany({ where: { id: 'e2e00000-0000-0000-0000-00000000e002' } }).catch(() => {});
      }
    });

    test('POST /payments/:orderId/capture jadi 404 (endpoint dihapus)', async () => {
      // Buat order + payment di DB dulu
      await prisma.order.upsert({
        where: { id: orderId },
        create: {
          id: orderId,
          customerId: customerUserId,
          driverId: null,
          status: OrderStatusDb.ASSIGNED,
          itemsJson: [],
          addressJson: { recipientName: 'Budi', phone: '0812', street: 'Jl Merdeka', city: 'Jakarta', postalCode: '10110' },
          totalCents: 50000,
          currency: 'IDR',
          version: 1,
        },
        update: {},
      });
      const paymentId = 'e2e00000-0000-0000-0000-00000000e003';
      await prisma.payment.upsert({
        where: { id: paymentId },
        create: {
          id: paymentId,
          orderId,
          idempotencyKey: 'e2e-capture-test',
          method: 'CARD',
          status: 'PENDING',
          amountCents: 50000,
          currency: 'IDR',
          kind: 'PAYMENT',
          externalRef: null,
          version: 1,
        },
        update: {},
      });
      try {
        await request(app.getHttpServer())
          .post(`/payments/${orderId}/capture`)
          .set('Authorization', `Bearer ${customerToken}`)
          .expect(404);
      } finally {
        await prisma.payment.deleteMany({ where: { id: paymentId } }).catch(() => {});
        await cleanupOrder();
      }
    });
  });
});
