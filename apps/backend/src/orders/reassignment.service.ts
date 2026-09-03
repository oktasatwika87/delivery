import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient, OrderStatusDb } from '@prisma/client';

import { Order, OrderStatus } from '@delivery/shared';
import { OrdersGateway } from './orders.gateway';

const SYSTEM_DRIVER_ID = 'SYSTEM';

/**
 * Timeout reassignment service.
 *
 * Cron job ini mendeteksi order yang "macet" — driver tidak ada kontak ke server
 * setelah durasi tertentu — dan otomatis melepas order tersebut kembali ke pool
 * supaya bisa di-assign driver lain.
 *
 * Timeout diukur dari `User.lastSeenAt` (terakhir kali device driver sync ke server),
 * BUKAN dari `Order.updatedAt` (terakhir kali order diubah).
 *
 * Ini memastikan:
 * - ASSIGNED/PREPARING (belum bawa barang, belum ada kontak fisik ke customer):
 *   timeout 15 menit tanpa kontak server → reassign
 * - OUT_FOR_DELIVERY (driver udah bawa barang, COD bisa collect kapan saja):
 *   timeout lebih lama (50 menit) karena driver mungkin di area sinyal buruk
 *
 * Pattern OCC (Optimistic Concurrency Control): atomic update dengan composite
 * key `{id, version}` — kalau version berubah antara check dan update, skip silently.
 * Ini aman untuk multi-instance deployment dan race condition dengan acceptOrder().
 */
@Injectable()
export class ReassignmentService {
  private readonly logger = new Logger(ReassignmentService.name);

  private readonly timeoutPreparingMinutes: number;
  private readonly timeoutDeliveryMinutes: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly configService: ConfigService,
    private readonly ordersGateway: OrdersGateway,
  ) {
    this.timeoutPreparingMinutes = this.configService.get<number>(
      'REASSIGN_TIMEOUT_PREPARING_MINUTES',
      15,
    );
    this.timeoutDeliveryMinutes = this.configService.get<number>(
      'REASSIGN_TIMEOUT_DELIVERY_MINUTES',
      50,
    );
  }

  /**
   * Trigger reassignment untuk satu order secara atomik.
   *
   * Pakai OCC: update WHERE id=X AND version=Y. Kalau version berubah
   * (acceptOrder/modifikasi lain), Prisma P2025 → skip silently.
   *
   * @returns true kalau reassign berhasil, false kalau skipped/conflict
   */
  async triggerReassignment(
    orderId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    try {
      const updated = await this.prisma.order.update({
        where: { id: orderId, version: expectedVersion },
        data: {
          status: OrderStatusDb.CONFIRMED,
          driverId: null,
          cancelledBy: SYSTEM_DRIVER_ID,
          cancelReason: 'system_timeout',
          version: { increment: 1 },
        },
      });

      this.logger.log(
        `[reassign] Order ${orderId} timeout → reassigned to pool (v${expectedVersion}→${updated.version})`,
      );

      // Emit event supaya pool tahu order udah tersedia lagi
      const orderDomain: Order = {
        id: updated.id,
        customerId: updated.customerId,
        status: updated.status as OrderStatus,
        items: updated.itemsJson as unknown as Order['items'],
        deliveryAddress: updated.addressJson as unknown as Order['deliveryAddress'],
        totalCents: updated.totalCents,
        currency: updated.currency,
        version: updated.version,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
      this.ordersGateway.emitOrderAvailable(orderDomain);

      return true;
    } catch (err) {
      const error = err as { code?: string };
      if (error.code === 'P2025') {
        // OCC conflict — order sudah dimodifikasi (acceptOrder atau cancelOrder),
        // skip silently. Ini normal di multi-instance atau race condition.
        this.logger.debug(
          `[reassign] Order ${orderId} skipped — version changed (OCC conflict)`,
        );
        return false;
      }
      // Error lain — log dan rethrow
      this.logger.error(`[reassign] Order ${orderId} error:`, err);
      throw err;
    }
  }

  /**
   * Cron job: cek setiap 1 menit untuk order macet.
   *
   * Ambil order dengan driverId != null (sedang di-assign),
   * status ASSIGNED/PREPARING/OUT_FOR_DELIVERY,
   * lalu cek apakah lastSeenAt driver udah lebih dari timeout.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkReassignments(): Promise<void> {
    const now = new Date();

    // Timeout untuk ASSIGNED/PREPARING (driver belum bawa barang)
    const preparingThreshold = new Date(
      now.getTime() - this.timeoutPreparingMinutes * 60 * 1000,
    );

    // Timeout untuk OUT_FOR_DELIVERY (driver udah bawa barang)
    const deliveryThreshold = new Date(
      now.getTime() - this.timeoutDeliveryMinutes * 60 * 1000,
    );

    // Ambil semua order aktif yang punya driver
    const activeOrders = await this.prisma.order.findMany({
      where: {
        status: {
          in: [OrderStatusDb.ASSIGNED, OrderStatusDb.PREPARING, OrderStatusDb.OUT_FOR_DELIVERY],
        },
        driverId: { not: null },
        deletedAt: null,
      },
      include: {
        driver: {
          select: { id: true, lastSeenAt: true, name: true },
        },
      },
    });

    let reassigned = 0;
    let skipped = 0;

    for (const order of activeOrders) {
      const driver = order.driver;
      if (!driver) continue;

      // Tentukan threshold berdasarkan status
      const threshold =
        order.status === OrderStatusDb.OUT_FOR_DELIVERY
          ? deliveryThreshold
          : preparingThreshold;

      // Kalau driver belum pernah sync (lastSeenAt = null) ATAU
      // lastSeenAt udah lebih lama dari threshold → reassign
      const driverLastSeen = driver.lastSeenAt;
      const isTimedOut: boolean =
        driverLastSeen === null || driverLastSeen < threshold;

      if (!isTimedOut) {
        skipped++;
        continue;
      }

      const success = await this.triggerReassignment(order.id, order.version);
      if (success) {
        reassigned++;
      } else {
        skipped++;
      }
    }

    if (reassigned > 0) {
      this.logger.log(
        `[cron] Reassignment check done: ${reassigned} order(s) reassigned, ${skipped} skipped`,
      );
    }
  }
}
