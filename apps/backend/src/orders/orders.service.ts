import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaClient, OrderStatusDb } from '@prisma/client';

import {
  OrderStatus,
  type CreateOrderInput,
  type Order,
} from '@delivery/shared';

import { OrdersGateway } from './orders.gateway';

/**
 * Slim payload untuk GET /orders/available.
 *
 * Beda dari `Order` full: tidak ada customerId, items[], deliveryAddress{},
 * notes, version, cancelledBy, cancelReason. Driver cuma butuh preview
 * minimal untuk nge-tap card, full detail di-fetch via GET /orders/:id
 * setelah tap.
 *
 * Shape ini PARALEL dengan WebSocket broadcast `emitOrderAvailable`
 * (orders.gateway.ts), sehingga REST + WS driver pool konsisten.
 */
export interface AvailableOrderPayload {
  orderId: string;
  totalCents: number;
  currency: string;
  itemsCount: number;
  city?: string;
  createdAt: string;
  version: number;
}

export interface FindAvailableResult {
  items: AvailableOrderPayload[];
  hasMore: boolean;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ordersGateway: OrdersGateway,
  ) {}

  async findById(id: string, userId: string): Promise<Order> {
    const row = await this.prisma.order.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Order ${id} tidak ditemukan`);
    if (row.customerId !== userId && row.driverId !== userId) {
      throw new ForbiddenException('Order ini bukan milik Anda');
    }
    return this.toDomain(row);
  }

  async create(input: CreateOrderInput, userId: string): Promise<Order> {
    const totalCents = input.items.reduce(
      (sum, item) => sum + item.unitPriceCents * item.quantity,
      0,
    );
    // Order langsung masuk pool saat dibuat, born ASSIGNED + driverId null.
    // Single pool state (ASSIGNED + driverId null) berlaku untuk semua
    // release-to-pool operations (create, releaseToPool helper).
    // Setelah create kita broadcast ke pool supaya driver yang online
    // langsung lihat order baru tanpa harus pull REST.
    const row = await this.prisma.order.create({
      data: {
        customerId: userId,
        itemsJson: input.items,
        addressJson: input.deliveryAddress,
        notes: input.notes,
        totalCents,
        currency: 'IDR', // TODO: dari tenant config
        status: OrderStatusDb.ASSIGNED,
        driverId: null,
      },
    });
    this.ordersGateway.emitOrderAvailable(this.toDomain(row));
    return this.toDomain(row);
  }

  /**
   * PATCH /orders/:id/status, driver pemilik order meng-update status.
   * Hanya dua transisi yang diizinkan: PREPARING jadi OUT_FOR_DELIVERY dan
   * OUT_FOR_DELIVERY jadi DELIVERED. Role check dilakukan di controller (lihat
   * OrdersController.updateStatus).
   *
   * Urutan cek:
   * 1. Order tidak ditemukan jadi 404 NotFound
   * 2. userId !== order.driverId jadi 403 Forbidden
   * 3. nextStatus bukan OUT_FOR_DELIVERY atau DELIVERED jadi 403 Forbidden
   * 4. current.status tidak cocok dengan sumber yang diharapkan untuk
   *    nextStatus jadi 409 INVALID_TRANSITION
   *    (mis. DELIVERED diminta dari PREPARING, OUT_FOR_DELIVERY diminta
   *    saat sudah OUT_FOR_DELIVERY)
   * 5. Prisma update P2025 jadi 409 VERSION_CONFLICT
   *
   * Setelah sukses: emit order:status_updated ke customer room (satu kali).
   * Tidak ada emitOrderUnavailable, dua transisi ini tidak pernah berasal
   * dari pool, jadi order tidak pernah "leaving pool".
   *
   * Daftar transisi disimpan lokal di sini (bukan pakai
   * ORDER_ALLOWED_TRANSITIONS shared) karena tabel shared masih memetakan
   * transisi lama yang dipakai endpoint lain (accept, cancel, dll).
   */
  private static readonly PATCH_STATUS_ALLOWED_TARGETS: readonly OrderStatus[] = [
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERED,
  ];

  /**
   * Untuk setiap target yang diizinkan, sumber yang diharapkan. Disimpan
   * sebagai Readonly<Partial<...>> karena OrderStatus union termasuk status
   * yang tidak pernah jadi target PATCH (PENDING, PENDING, CONFIRMED, dll),
   * Partial<T> memungkinkan Record tanpa harus isi semua key secara literal.
   */
  private static readonly PATCH_STATUS_EXPECTED_SOURCE: Readonly<
    Partial<Record<OrderStatus, OrderStatus>>
  > = {
    [OrderStatus.OUT_FOR_DELIVERY]: OrderStatus.PREPARING,
    [OrderStatus.DELIVERED]: OrderStatus.OUT_FOR_DELIVERY,
  };

  /** Type guard: apakah s adalah salah satu target valid PATCH status. */
  private static isPatchStatusTarget(
    s: OrderStatus,
  ): s is 'OUT_FOR_DELIVERY' | 'DELIVERED' {
    return OrdersService.PATCH_STATUS_ALLOWED_TARGETS.includes(s);
  }

  async transitionStatus(
    id: string,
    nextStatus: OrderStatus,
    expectedVersion: number,
    userId: string,
  ): Promise<Order> {
    const current = await this.prisma.order.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Order ${id} tidak ditemukan`);

    // Cek 2: bukan driver order jadi 403
    if (current.driverId !== userId) {
      throw new ForbiddenException('Order ini bukan milik Anda');
    }

    // Cek 3: target bukan OUT_FOR_DELIVERY atau DELIVERED jadi 403
    if (!OrdersService.isPatchStatusTarget(nextStatus)) {
      throw new ForbiddenException(
        'Status tujuan tidak diizinkan lewat endpoint ini',
      );
    }

    // Cek 4: sumber tidak cocok dengan target jadi 409 INVALID_TRANSITION
    const expectedSource = OrdersService.PATCH_STATUS_EXPECTED_SOURCE[nextStatus];
    if (current.status !== expectedSource) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: `Tidak bisa transisi dari ${current.status} ke ${nextStatus}`,
      });
    }

    try {
      const updated = await this.prisma.order.update({
        where: { id, version: expectedVersion },
        data: {
          status: nextStatus as OrderStatusDb,
          version: { increment: 1 },
        },
      });

      // Emit ke customer, satu kali per PATCH sukses. Cek 3 di atas
      // sudah menyempitkan nextStatus ke OUT_FOR_DELIVERY | DELIVERED.
      this.ordersGateway.emitOrderStatusUpdated(current.customerId, {
        orderId: updated.id,
        status: nextStatus,
        version: updated.version,
        updatedAt: updated.updatedAt.toISOString(),
      });

      return this.toDomain(updated);
    } catch (err) {
      // Cek 5: OCC conflict jadi 409 VERSION_CONFLICT (pola sama dengan
      // releaseToPool/acceptOrder).
      const error = err as { code?: string };
      if (error.code === 'P2025') {
        throw new ConflictException({
          code: 'VERSION_CONFLICT',
          message: 'Order sudah diubah oleh permintaan lain. Muat ulang lalu coba lagi.',
        });
      }
      throw err;
    }
  }

  /**
   * Driver accept order yang sudah di-assign.
   * Validasi: DRIVER role, status ASSIGNED, belum ada driver yang accept.
   * Pakai OCC untuk handle race condition (2 driver accept bersamaan).
   */
  async acceptOrder(
    id: string,
    expectedVersion: number,
    driverId: string,
  ): Promise<Order> {
    const current = await this.prisma.order.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Order ${id} tidak ditemukan`);

    // Role check: harus DRIVER (dipastikan di controller via @CurrentUser('role'))
    // Status check: harus ASSIGNED baru bisa di-accept.
    // Order yang sudah di-unassign cron (kembali ke CONFIRMED) atau sudah
    // pindah status (PREPARING, dst.) dianggap tidak lagi tersedia untuk
    // driver yang sedang menekan Terima, kembalikan 409 ORDER_UNAVAILABLE
    // supaya client tahu pool perlu refresh, bukan pesan gagal umum.
    if (current.status !== OrderStatusDb.ASSIGNED) {
      throw new ConflictException({
        code: 'ORDER_UNAVAILABLE',
        message: `Order berstatus ${current.status} tidak bisa diterima, harus ASSIGNED.`,
      });
    }

    // Ownership: order harus belum di-accept driver lain (driverId === null berarti belum ada yang accept)
    // Kalau driverId === driverId (driver yang sama), bisa jadi retry, OCC akan handle
    if (current.driverId !== null && current.driverId !== driverId) {
      throw new ConflictException({
        code: 'ORDER_UNAVAILABLE',
        message: 'Order sudah diterima driver lain.',
      });
    }

    try {
      const updated = await this.prisma.order.update({
        where: { id, version: expectedVersion },
        data: {
          status: OrderStatusDb.PREPARING,
          driverId, // assign driver saat accept
          // Bersihkan data batal lama, order barulang ASSIGNED setelah cron
          // (cancelledBy 'SYSTEM', cancelReason 'system_timeout') akan overwrite
          // ke null di sini supaya toDomain tidak lagi bawa cancelReason saat
          // accept berikutnya.
          cancelledBy: null,
          cancelReason: null,
          version: { increment: 1 },
        },
      });

      // Emit event ke customer via WebSocket
      this.ordersGateway.emitOrderAccepted(
        current.customerId,
        id,
        driverId,
        updated.version,
      );

      // Broadcast ke drivers:available bahwa order sudah taken
      this.ordersGateway.emitOrderUnavailable(id, 'accepted');

      return this.toDomain(updated);
    } catch (err) {
      // OCC conflict: version mismatch jadi 409 VERSION_CONFLICT.
      // Body object di-pass langsung ke ConflictException supaya Nest HTTP
      // exception filter serialize { code, message } as-is, pola sama
      // dengan cancelOrder/rejectOrder.
      const error = err as { code?: string };
      if (error.code === 'P2025') {
        throw new ConflictException({
          code: 'VERSION_CONFLICT',
          message: 'Order sudah diubah oleh permintaan lain. Muat ulang lalu coba lagi.',
        });
      }
      throw err;
    }
  }

  /**
   * Driver menolak order yang ditugaskan kepadanya. Order kembali ke pool
   * (ASSIGNED, driverId null) dengan `cancelledBy` dan `cancelReason` null.
   *
   * Urutan cek:
   * 1. Order tidak ada: 404.
   * 2. Driver order bukan pemanggil: versi beda 409 ORDER_REASSIGNED (order
   *    sudah berpindah sejak aplikasi membacanya), versi sama 403
   *    ORDER_NOT_ASSIGNED.
   * 3. Status bukan ASSIGNED: 409 ORDER_NOT_CANCELLABLE.
   * 4. releaseToPool, lalu event ke customer.
   *
   * `acceptOrder` langsung memindahkan order ke PREPARING, jadi saat ini
   * tidak ada order ASSIGNED yang punya driver, dan penolakan tidak pernah
   * lolos cek 3. Berbeda dengan `cancelOrder`, kiriman ulang penolakan tidak
   * bisa dikenali karena `cancelledBy` ditulis null. Aplikasi saat ini tidak
   * mengirim penolakan.
   */
  async rejectOrder(
    id: string,
    expectedVersion: number,
    driverId: string,
  ): Promise<Order> {
    const current = await this.prisma.order.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Order ${id} tidak ditemukan`);

    // Cek 2: pemilik dulu. Versi beda berarti order sudah berpindah sejak
    // aplikasi membacanya (409, aplikasi berhenti mengirim ulang). Versi sama
    // berarti order memang bukan milik pemanggil (403).
    if (current.driverId !== driverId) {
      if (current.version !== expectedVersion) {
        throw new ConflictException({
          code: 'ORDER_REASSIGNED',
          message: 'Order ini sudah dipindahkan ke driver lain.',
        });
      }
      throw new ForbiddenException({
        code: 'ORDER_NOT_ASSIGNED',
        message: 'Order ini tidak ditugaskan ke Anda',
      });
    }

    // Cek 3: status bukan ASSIGNED -> 409.
    if (current.status !== OrderStatusDb.ASSIGNED) {
      throw new ConflictException({
        code: 'ORDER_NOT_CANCELLABLE',
        message: `Order berstatus ${current.status} tidak bisa ditolak, harus ASSIGNED.`,
      });
    }

    const updated = await this.releaseToPool({
      orderId: id,
      expectedVersion,
      // reject bukan pembatalan, kedua field ditulis null supaya tidak
      // bocor dari cancel/timeout sebelumnya.
      cancelledBy: null,
      cancelReason: null,
    });

    // Emit event ke customer via WebSocket (reject-specific payload).
    this.ordersGateway.emitOrderRejected(
      current.customerId,
      id,
      updated.version,
    );

    // NOTE: tidak ada emitOrderUnavailable() di sini, order yang di-reject
    // di sini punya driverId terisi (bukan pool item), jadi tidak pernah
    // terlihat di pool drivers:available untuk mulai dengan; releaseToPool
    // sudah memanggil emitOrderAvailable untuk broadcast availability ke
    // pool (order sekarang ASSIGNED + driverId null).

    return updated;
  }

  /**
   * Driver membatalkan order miliknya yang berstatus ASSIGNED, PREPARING,
   * atau OUT_FOR_DELIVERY. Order kembali ke pool (ASSIGNED, driverId null)
   * dengan `cancelledBy` berisi id driver.
   *
   * Urutan cek:
   * 1. Order tidak ada: 404.
   * 2. Driver order bukan pemanggil:
   *    a. order ASSIGNED, driverId null, `cancelledBy` = pemanggil, dan versi
   *       server = versi kiriman + 1: kiriman ulang pembatalan yang sudah
   *       berhasil tetapi balasannya hilang. Order dikembalikan apa adanya,
   *       tanpa menulis dan tanpa event;
   *    b. versi beda: 409 ORDER_REASSIGNED;
   *    c. versi sama: 403 ORDER_NOT_ASSIGNED.
   * 3. Status selain ASSIGNED, PREPARING, dan OUT_FOR_DELIVERY: 409
   *    ORDER_NOT_CANCELLABLE.
   * 4. releaseToPool, lalu event ke customer.
   */
  async cancelOrder(
    id: string,
    expectedVersion: number,
    driverId: string,
    reason?: string,
  ): Promise<Order> {
    const current = await this.prisma.order.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Order ${id} tidak ditemukan`);

    // Cek 2: driver order bukan pemanggil, tiga cabang seperti di komentar fungsi.
    if (current.driverId !== driverId) {
      // 2a: kiriman ulang pembatalan yang sudah berhasil. Hanya cancelOrder
      // yang menulis `cancelledBy` dengan id driver (rejectOrder menulis null,
      // cron 'SYSTEM'), dan versi harus tepat satu di atas kiriman. Kalau
      // lebih, order sudah diubah lagi setelah pembatalan itu.
      if (
        current.status === OrderStatusDb.ASSIGNED &&
        current.driverId === null &&
        current.cancelledBy === driverId &&
        current.version === expectedVersion + 1
      ) {
        return this.toDomain(current);
      }
      // 2b: versi beda -> 409 ORDER_REASSIGNED.
      if (current.version !== expectedVersion) {
        throw new ConflictException({
          code: 'ORDER_REASSIGNED',
          message: 'Order ini sudah dipindahkan ke driver lain.',
        });
      }
      // 2c: driver lain dengan versi sama -> 403.
      throw new ForbiddenException({
        code: 'ORDER_NOT_ASSIGNED',
        message: 'Order ini tidak ditugaskan ke Anda',
      });
    }

    // Cek 3: status yang bisa dibatalkan.
    const isCancellable = (
      status: OrderStatusDb,
    ): status is 'ASSIGNED' | 'PREPARING' | 'OUT_FOR_DELIVERY' =>
      status === OrderStatusDb.ASSIGNED ||
      status === OrderStatusDb.PREPARING ||
      status === OrderStatusDb.OUT_FOR_DELIVERY;

    if (!isCancellable(current.status)) {
      throw new ConflictException({
        code: 'ORDER_NOT_CANCELLABLE',
        message: `Order berstatus ${current.status} tidak bisa dibatalkan, harus ASSIGNED, PREPARING, atau OUT_FOR_DELIVERY.`,
      });
    }

    const updated = await this.releaseToPool({
      orderId: id,
      expectedVersion,
      cancelledBy: driverId,
      cancelReason: reason ?? null,
    });

    // Emit event ke customer via WebSocket (reason pass-through supaya
    // customer lihat alasan yang driver berikan, lihat OrderCancelledPayload).
    this.ordersGateway.emitOrderCancelled(
      current.customerId,
      id,
      updated.version,
      reason,
    );

    return updated;
  }

  /**
   * Lepas order kembali ke pool dengan atomic OCC update.
   *
   * Helper terpusat untuk semua "release-to-pool" operations: rejectOrder,
   * cancelOrder, dan ReassignmentService.triggerReassignment (cron reassignment)
   * semua lewat sini. Single pool state = ASSIGNED + driverId null, jadi semua
   * release berakhir di shape yang sama dan findAvailable() bisa find mereka
   * semua dengan satu query.
   *
   * Setelah sukses, broadcast ke pool (emitOrderAvailable). Untuk reject
   * dan cancel, customer juga dikabari lewat emitOrderRejected/emitOrderCancelled
   * itu tetap tanggung jawab caller, bukan releaseToPool, karena ada
   * payload spesifik per event (reason untuk cancel, dll).
   *
   * P2025 jadi ConflictException(VERSION_CONFLICT) supaya caller bisa
   * translate sesuai konteks (OrdersService.rejectOrder/cancelOrder
   * propagate ke HTTP 409, ReassignmentService tangkap dan skip silently).
   *
   * Order dengan COD tercatat (payment CASH PAYMENT CAPTURED) tidak boleh
   * dilepas, supaya COD order itu tidak bisa dicatat lagi oleh driver lain.
   * Cek COD dan penulisan order berjalan di dalam satu transaksi yang lebih
   * dulu mengunci baris order (`SELECT ... FOR UPDATE`). Tanpa kunci,
   * pembatalan dan collect-cod yang datang bersamaan bisa sama-sama lolos cek.
   */
  async releaseToPool(args: {
    orderId: string;
    expectedVersion: number;
    cancelledBy?: string | null;
    cancelReason?: string | null;
  }): Promise<Order> {
    const { orderId, expectedVersion, cancelledBy = null, cancelReason = null } = args;
    const updated = await this.prisma.$transaction(async (tx) => {
      // Kunci baris order dulu, supaya pembatalan atau collect-cod untuk order
      // yang sama menunggu sampai transaksi ini selesai. Tanpa kunci, keduanya
      // bisa sama-sama melihat belum ada COD lalu sama-sama lanjut.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const capturedCod = await tx.payment.findFirst({
        where: {
          orderId,
          method: 'CASH',
          kind: 'PAYMENT',
          status: 'CAPTURED',
          deletedAt: null,
        },
      });
      if (capturedCod) {
        throw new ConflictException({
          code: 'COD_ALREADY_CAPTURED',
          message: 'COD order ini sudah tercatat, jadi order tidak bisa dilepas.',
        });
      }
      try {
        return await tx.order.update({
          where: { id: orderId, version: expectedVersion },
          data: {
            status: OrderStatusDb.ASSIGNED,
            driverId: null,
            cancelledBy,
            cancelReason,
            version: { increment: 1 },
          },
        });
      } catch (err) {
        const error = err as { code?: string };
        if (error.code === 'P2025') {
          throw new ConflictException({
            code: 'VERSION_CONFLICT',
            message: 'Order sudah diubah oleh permintaan lain. Muat ulang lalu coba lagi.',
          });
        }
        throw err;
      }
    });
    // Kabari pool setelah transaksi selesai. Kalau dikirim lebih dulu lalu
    // transaksi gagal, pool sempat melihat order yang sebenarnya tidak lepas.
    this.ordersGateway.emitOrderAvailable(this.toDomain(updated));
    return this.toDomain(updated);
  }

  /**
   * List orders yang siap di-accept (status ASSIGNED, belum ada driver).
   * Untuk driver lihat pool. Read-only, tidak ada side effect.
   *
   * Return `{ items, hasMore }` (slim shape), BUKAN full `Order[]`.
   * Lihat type def di atas untuk rationale + parallel dengan WS broadcast.
   *
   * hasMore: ambil take+1 baris, kirim maksimal take baris, hasMore=true
   * kalau baris yang terambil lebih dari take.
   *
   * @param _driverId - userId dari JWT (untuk future audit logging, tidak untuk filter)
   * @param take - max orders (hard cap 100)
   */
  async findAvailable(_driverId: string, take: number): Promise<FindAvailableResult> {
    const rows = await this.prisma.order.findMany({
      where: {
        status: OrderStatusDb.ASSIGNED,
        driverId: null,
        deletedAt: null,
      },
      take: take + 1,
      orderBy: { createdAt: 'asc' },
    });
    const hasMore = rows.length > take;
    const items = rows.slice(0, take).map((r) => this.toAvailablePayload(r));
    return { items, hasMore };
  }

  /**
   * Map Prisma row ke slim `AvailableOrderPayload`.
   *
   * Mapping:
   * - r.id jadi orderId
   * - Array `itemsJson.length` jadi itemsCount (safe: itemsJson selalu array,
   *   schema enforced di service.create)
   * - r.addressJson?.city jadi city (optional chain karena addressJson typed
   *   sebagai `Json` di Prisma, defensif, meski schema enforce object)
   * - r.createdAt.toISOString() jadi createdAt (string format ISO 8601,
   *   sesuai `Order.createdAt` convention)
   * - r.version jadi version (kunci versi untuk accept)
   */
  private toAvailablePayload(row: {
    id: string;
    itemsJson: unknown;
    addressJson: unknown;
    totalCents: number;
    currency: string;
    createdAt: Date;
    version: number;
  }): AvailableOrderPayload {
    const items = Array.isArray(row.itemsJson) ? row.itemsJson : [];
    const address =
      row.addressJson && typeof row.addressJson === 'object'
        ? (row.addressJson as { city?: string })
        : null;

    return {
      orderId: row.id,
      totalCents: row.totalCents,
      currency: row.currency,
      itemsCount: items.length,
      city: address?.city,
      createdAt: row.createdAt.toISOString(),
      version: row.version,
    };
  }

  private toDomain(row: {
    id: string;
    customerId: string;
    driverId: string | null;
    status: OrderStatusDb;
    itemsJson: unknown;
    addressJson: unknown;
    totalCents: number;
    currency: string;
    notes: string | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
    cancelledBy: string | null;
    cancelReason: string | null;
  }): Order {
    return {
      id: row.id,
      customerId: row.customerId,
      driverId: row.driverId ?? undefined,
      status: row.status as unknown as OrderStatus,
      items: row.itemsJson as Order['items'],
      deliveryAddress: row.addressJson as Order['deliveryAddress'],
      totalCents: row.totalCents,
      currency: row.currency,
      notes: row.notes ?? undefined,
      cancelledBy: row.cancelledBy ?? undefined,
      cancelReason: row.cancelReason ?? undefined,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
