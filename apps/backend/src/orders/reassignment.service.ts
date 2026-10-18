import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient, OrderStatusDb } from '@prisma/client';

import { OrdersService } from './orders.service';
import { OrdersGateway } from './orders.gateway';

const SYSTEM_DRIVER_ID = 'SYSTEM';

/**
 * Timeout reassignment service.
 *
 * Cron job ini mendeteksi order yang "macet", driver tidak ada kontak ke server
 * setelah durasi tertentu, dan otomatis melepas order tersebut kembali ke pool
 * supaya bisa di-assign driver lain.
 *
 * Timeout diukur dari `User.lastSeenAt` (terakhir kali device driver sync ke server),
 * BUKAN dari `Order.updatedAt` (terakhir kali order diubah).
 *
 * Ini memastikan:
 * - ASSIGNED/PREPARING (belum bawa barang, belum ada kontak fisik ke customer):
 *   timeout 15 menit tanpa kontak server jadi reassign
 * - OUT_FOR_DELIVERY (driver udah bawa barang, COD bisa collect kapan saja):
 *   timeout lebih lama (50 menit) karena driver mungkin di area sinyal buruk
 *
 * Pattern OCC (Optimistic Concurrency Control): atomic update dengan composite
 * key `{id, version}`, kalau version berubah antara check dan update, skip silently.
 * Ini aman untuk multi-instance deployment dan race condition dengan acceptOrder().
 *
 * Release path didelegasikan ke OrdersService.releaseToPool, satu helper
 * untuk semua "back to pool" operations (reject, cancel, reassign).
 * Kalau helper itu melemparkan ConflictException(VERSION_CONFLICT), cron skip
 * silently seperti biasa (P2025 semantics).
 */
@Injectable()
export class ReassignmentService {
  private readonly logger = new Logger(ReassignmentService.name);

  private readonly timeoutPreparingMinutes: number;
  private readonly timeoutDeliveryMinutes: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly configService: ConfigService,
    private readonly ordersService: OrdersService,
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
   * Pakai OCC via OrdersService.releaseToPool: update WHERE id=X AND version=Y.
   * Kalau version berubah (acceptOrder/modifikasi lain), helper melemparkan
   * ConflictException(VERSION_CONFLICT) jadi kita tangkap dan return false
   * (skip silently, normal untuk multi-instance).
   *
   * ConflictException(COD_ALREADY_CAPTURED) dari releaseToPool juga
   * dilewati tanpa error. Query cron sudah tidak memilih order dengan COD
   * tercatat, jadi ini hanya terjadi kalau COD tercatat di sela query dan
   * pelepasan; di putaran berikutnya order itu tidak terpilih lagi.
   *
   * @returns true kalau reassign berhasil, false kalau skipped/conflict
   */
  async triggerReassignment(
    orderId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    try {
      const updated = await this.ordersService.releaseToPool({
        orderId,
        expectedVersion,
        cancelledBy: SYSTEM_DRIVER_ID,
        cancelReason: 'system_timeout',
      });

      this.logger.log(
        `[reassign] Order ${orderId} timed out, released to pool (v${expectedVersion} -> v${updated.version})`,
      );

      // releaseToPool sudah memberi tahu pool (emitOrderAvailable). Customer
      // dikabari di sini supaya layar tracking langsung kembali ke "Mencari
      // driver", sama seperti saat driver membatalkan order.
      this.ordersGateway.emitOrderCancelled(
        updated.customerId,
        updated.id,
        updated.version,
        updated.cancelReason,
      );

      return true;
    } catch (err) {
      if (err instanceof ConflictException) {
        const response = err.getResponse() as { code?: string };
        if (response?.code === 'VERSION_CONFLICT' || response?.code === 'COD_ALREADY_CAPTURED') {
          // Versi berubah, atau COD tercatat di sela query dan pelepasan.
          // Dua-duanya bukan galat: order yang versinya berubah dinilai lagi
          // di putaran berikutnya, order dengan COD tidak terpilih lagi.
          this.logger.debug(
            `[reassign] Order ${orderId} skipped, code=${response?.code}`,
          );
          return false;
        }
      }
      // Error lain, log dan rethrow
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

    // Ambil order aktif yang punya driver dan belum punya COD tercatat.
    // Order dengan COD tercatat tidak boleh dilepas (releaseToPool akan
    // menolaknya), jadi tidak perlu dicoba tiap menit.
    const activeOrders = await this.prisma.order.findMany({
      where: {
        status: {
          in: [OrderStatusDb.ASSIGNED, OrderStatusDb.PREPARING, OrderStatusDb.OUT_FOR_DELIVERY],
        },
        driverId: { not: null },
        deletedAt: null,
        payments: {
          none: {
            method: 'CASH',
            kind: 'PAYMENT',
            status: 'CAPTURED',
            deletedAt: null,
          },
        },
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
      // lastSeenAt udah lebih lama dari threshold jadi reassign
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
