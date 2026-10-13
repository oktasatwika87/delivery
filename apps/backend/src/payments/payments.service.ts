import { Injectable, ForbiddenException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import type { Payment } from '@delivery/shared';

import { OrdersGateway } from '../orders/orders.gateway';
import { EmailService } from '../email/email.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ordersGateway: OrdersGateway,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Driver mencatat COD (bayar di tempat) untuk order miliknya. Jumlah diambil
   * dari order.totalCents; amountCents dari aplikasi diabaikan.
   *
   * Semua cek dan penulisan berjalan di satu transaksi yang lebih dulu
   * mengunci baris order (`SELECT ... FOR UPDATE`), sama seperti
   * releaseToPool, supaya COD dan pelepasan order (pembatalan atau cron) yang
   * datang bersamaan tidak bisa sama-sama lolos:
   * 1. Order dibaca lewat tx. Tidak ada: 404. Driver bukan pemanggil: 403
   *    dengan code ORDER_NOT_ASSIGNED.
   * 2. Payment dengan idempotencyKey yang sama sudah ada: order sama berarti
   *    kiriman ulang, dikembalikan apa adanya tanpa event; order lain 409
   *    IDEMPOTENCY_KEY_CONFLICT (pesan sama dengan flagOrphanedCod).
   * 3. Sudah ada COD tercatat dengan kunci lain: 409 COD_ALREADY_CAPTURED,
   *    body membawa payment itu supaya aplikasi bisa menyimpannya.
   * 4. Payment baru dibuat: CASH, CAPTURED, kind PAYMENT.
   * Event order:cod_collected dikirim setelah transaksi selesai, hanya untuk
   * payment baru.
   *
   * P2002 (kunci yang sama dipakai dua order pada saat bersamaan) ditangani
   * di luar transaksi. Di Postgres satu perintah yang gagal membatalkan
   * seluruh transaksi, dan Prisma tidak membuat `SAVEPOINT` per perintah,
   * jadi payment dibaca ulang lewat this.prisma: order sama dikembalikan
   * tanpa event, order lain 409 IDEMPOTENCY_KEY_CONFLICT, tidak ketemu: error
   * aslinya dilempar lagi.
   */
  async collectCod(
    orderId: string,
    driverId: string,
    idempotencyKey: string,
  ): Promise<Payment> {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Kunci baris order dulu; semua cek di bawah berjalan di dalam kunci ini.
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;

        // Pemilik dicek di dalam kunci, supaya pelepasan order yang selesai tepat
        // sebelum kunci didapat ikut terlihat.
        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (!order) {
          throw new NotFoundException('Order tidak ditemukan');
        }
        if (order.driverId !== driverId) {
          throw new ForbiddenException({
            code: 'ORDER_NOT_ASSIGNED',
            message: 'Order ini tidak ditugaskan ke Anda',
          });
        }

        // Cek payment dengan kunci ini sudah ada.
        const sameKey = await tx.payment.findUnique({ where: { idempotencyKey } });
        if (sameKey) {
          if (sameKey.orderId === orderId) {
            // Kiriman ulang: dikembalikan apa adanya, tanpa event.
            return { payment: this.toDomain(sameKey), isReplay: true, order };
          }
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_CONFLICT',
            message: `Idempotency key ${idempotencyKey} sudah dipakai di order lain`,
          });
        }

        // Cek COD tercatat dengan kunci lain.
        const existing = await tx.payment.findFirst({
          where: {
            orderId,
            method: 'CASH',
            kind: 'PAYMENT',
            status: 'CAPTURED',
            deletedAt: null,
          },
        });
        if (existing) {
          throw new ConflictException({
            code: 'COD_ALREADY_CAPTURED',
            message: 'COD order ini sudah tercatat.',
            payment: this.toDomain(existing),
          });
        }

        // Buat payment baru. P2002 ditangani di luar transaksi, karena setelah
        // error itu tx sudah batal.
        const created = await tx.payment.create({
          data: {
            orderId,
            idempotencyKey,
            method: 'CASH',
            status: 'CAPTURED',
            amountCents: order.totalCents,
            currency: order.currency,
            kind: 'PAYMENT',
          },
        });
        return { payment: this.toDomain(created), isReplay: false, order };
      });

      // Event hanya untuk payment baru dan baru dikirim setelah transaksi selesai,
      // memakai data order yang dibaca di dalam kunci.
      if (!result.isReplay) {
        this.ordersGateway.emitOrderCodCollected(
          result.order.customerId,
          orderId,
          result.order.totalCents,
          result.order.currency,
        );
      }
      return result.payment;
    } catch (err) {
      const error = err as { code?: string };
      if (error.code !== 'P2002') {
        throw err;
      }
      // P2002: tx sudah batal, baca ulang lewat this.prisma.
      const winner = await this.prisma.payment.findUnique({
        where: { idempotencyKey },
      });
      if (!winner) {
        throw err;
      }
      if (winner.orderId !== orderId) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message: `Idempotency key ${idempotencyKey} sudah dipakai di order lain`,
        });
      }
      // Kunci yang sama untuk order ini: payment dikembalikan tanpa event.
      return this.toDomain(winner);
    }
  }

  /**
   * Flag COD as orphaned, driver collected COD offline but order was reassigned
   * before sync. Finds existing pending payment record (by idempotencyKey) and
   * marks it orphaned, then notifies support via email.
   *
   * Jika idempotencyKey sudah dipakai di order lain, hasilnya 409 IDEMPOTENCY_KEY_CONFLICT.
   * Jika order tidak ada, hasilnya 404.
   * Jumlah dari order.totalCents.
   */
  async flagOrphanedCod(
    orderId: string,
    driverId: string,
    idempotencyKey: string,
  ): Promise<Payment> {
    // Verify driver exists and has the role
    const driver = await this.prisma.user.findUnique({ where: { id: driverId } });
    if (!driver) {
      throw new NotFoundException('Driver tidak ditemukan');
    }

    // Order harus ada, kalau tidak, 404
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException('Order tidak ditemukan');
    }

    // Cek apakah idempotencyKey sudah dipakai di order lain
    const existing = await this.prisma.payment.findUnique({
      where: { idempotencyKey },
    });

    if (existing && existing.orderId !== orderId) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        message: `Idempotency key ${idempotencyKey} sudah dipakai di order lain`,
      });
    }

    const now = new Date();
    const amountCents = order.totalCents;
    const currency = order.currency;

    if (existing) {
      // Update existing record with orphanedAt
      const updated = await this.prisma.payment.update({
        where: { id: existing.id },
        data: { orphanedAt: now, version: { increment: 1 } },
      });

      // Fire-and-forget email notification to support
      this.emailService.sendOrphanedCodNotification({
        orderId,
        amountCents,
        currency,
        driverId,
        driverName: driver.name,
        happenedAt: now,
      });

      return this.toDomain(updated);
    } else {
      // No existing payment record, create one marked as orphaned.
      // This handles the case where the outbox detected orphan before any
      // payment record was ever created (e.g., collect-cod never succeeded).
      const row = await this.prisma.payment.create({
        data: {
          orderId,
          idempotencyKey,
          method: 'CASH',
          status: 'PENDING',
          amountCents,
          currency,
          kind: 'PAYMENT',
          orphanedAt: now,
        },
      });

      // Fire-and-forget email notification to support
      this.emailService.sendOrphanedCodNotification({
        orderId,
        amountCents,
        currency,
        driverId,
        driverName: driver.name,
        happenedAt: now,
      });

      return this.toDomain(row);
    }
  }

  private toDomain(row: {
    id: string;
    orderId: string;
    idempotencyKey: string;
    method: string;
    status: string;
    amountCents: number;
    currency: string;
    kind: string;
    externalRef: string | null;
    orphanedAt: Date | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): Payment {
    return {
      id: row.id,
      orderId: row.orderId,
      idempotencyKey: row.idempotencyKey,
      method: row.method as Payment['method'],
      status: row.status as Payment['status'],
      amountCents: row.amountCents,
      currency: row.currency,
      kind: row.kind as Payment['kind'],
      externalRef: row.externalRef ?? undefined,
      orphanedAt: row.orphanedAt?.toISOString() ?? undefined,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
