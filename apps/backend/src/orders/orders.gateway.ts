import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

import {
  UserRole,
  type Order,
  type OrderAvailablePayload,
  type OrderUnavailablePayload,
  type OrderAcceptedPayload,
  type OrderRejectedPayload,
  type OrderCancelledPayload,
  type OrderCodCollectedPayload,
  type OrderStatusUpdatedPayload,
} from '@delivery/shared';

import { createSocketAuthMiddleware, isUserRole } from '../auth/socket-auth';

/**
 * WebSocket Gateway untuk order events.
 *
 * Dua arah emit:
 * 1. Customer-targeted: order:accepted, order:rejected, order:cancelled
 *    - room = customerId (customer socket joins own userId di handleConnection)
 * 2. Driver-targeted: order:available, order:unavailable
 *    - room = 'drivers:available' (driver socket joins di handleConnection)
 *
 * Auth: JWT diverifikasi di middleware namespace (lihat socket-auth.ts)
 * yang dipasang lewat afterInit. handleConnection membaca userId dan role
 * dari socket.data (middleware sudah menolak koneksi yang tokennya
 * tidak sah sebelum klien sempat melihat connect).
 */
@WebSocketGateway({ namespace: '/orders', cors: true })
export class OrdersGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  private static readonly DRIVERS_AVAILABLE_ROOM = 'drivers:available';
  private readonly userSockets = new Map<string, Set<string>>();

  constructor(private readonly jwtService: JwtService) {}

  /**
   * Dipanggil NestJS tepat setelah server namespace siap. Di sinilah
   * middleware auth dipasang sebelum ada soket yang mencoba tersambung.
   */
  afterInit(server: Pick<Server, 'use'>): void {
    server.use(createSocketAuthMiddleware(this.jwtService, '/orders'));
  }

  async handleConnection(client: Socket): Promise<void> {
    const userId: unknown = client.data['userId'];
    const role: unknown = client.data['role'];

    if (typeof userId !== 'string' || userId.length === 0 || !isUserRole(role)) {
      client.disconnect();
      return;
    }

    // Track per-user (cleanup on disconnect)
    const existing = this.userSockets.get(userId) ?? new Set<string>();
    existing.add(client.id);
    this.userSockets.set(userId, existing);

    // Driver joins global pool room (untuk order:available/unavailable events)
    if (role === UserRole.DRIVER) {
      client.join(OrdersGateway.DRIVERS_AVAILABLE_ROOM);
    }

    // Customer joins own userId room (untuk order:accepted/rejected/cancelled events).
    // Emit calls pake `this.server.to(customerId)` yang cuma delivers ke socket
    // di room dengan id == customerId, tanpa ini customer-targeted events
    // hilang diam-diam. HandleConnection dulu pernah tidak join customer ke
    // room apapun, jadi emit-nya nyasar.
    if (role === UserRole.CUSTOMER) {
      client.join(userId);
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = client.data['userId'] as string | undefined;
    if (userId) {
      this.userSockets.get(userId)?.delete(client.id);
      if (this.userSockets.get(userId)?.size === 0) {
        this.userSockets.delete(userId);
      }
    }
  }

  // ===== Customer-targeted emits (existing) =====

  /**
   * Emit event ke customer saat order di-accept oleh driver.
   */
  emitOrderAccepted(customerId: string, orderId: string, driverId: string, newVersion: number): void {
    const payload: OrderAcceptedPayload = {
      orderId,
      driverId,
      status: 'PREPARING',
      version: newVersion,
    };
    this.server.to(customerId).emit('order:accepted', payload);
  }

  /**
   * Emit event ke customer saat order di-reject oleh driver.
   *
   * Status 'ASSIGNED' dipakai karena pool state adalah ASSIGNED + driverId null
   * (lihat OrdersService.releaseToPool & create yang born ASSIGNED). Order
   * yang di-reject kembali ke pool, jadi status yang benar untuk customer
   * adalah 'ASSIGNED' (= "Mencari driver"), bukan 'CONFIRMED' (yang sebenarnya
   * bukan pool state lagi).
   *
   * Payload sekarang di-type dari @delivery/shared (OrderRejectedPayload), jadi
   * `status` di sini nggak bisa diam-diam balik ke status literal lain tanpa
   * compile error di sisi mobile juga.
   */
  emitOrderRejected(customerId: string, orderId: string, newVersion: number): void {
    const payload: OrderRejectedPayload = {
      orderId,
      status: 'ASSIGNED',
      version: newVersion,
    };
    this.server.to(customerId).emit('order:rejected', payload);
  }

  /**
   * Mengabari customer saat driver membatalkan order atau saat cron melepas
   * order yang driver-nya lama tidak tersambung.
   *
   * Status 'ASSIGNED', order balik ke pool, single pool state sekarang ASSIGNED
   * + driverId null (lihat releaseToPool). Customer lihat "Mencari driver",
   * bukan "Dikonfirmasi".
   */
  emitOrderCancelled(customerId: string, orderId: string, newVersion: number, reason?: string): void {
    const payload: OrderCancelledPayload = {
      orderId,
      status: 'ASSIGNED',
      version: newVersion,
      reason,
    };
    this.server.to(customerId).emit('order:cancelled', payload);
  }

  /**
   * Emit event ke customer saat driver collect COD (cash on delivery).
   *
   * Beda dari accept/reject/cancel: order status TIDAK berubah saat COD
   * di-collect, jadi payload ini sengaja tidak punya `status`/`version`,
   * ini murni live confirmation pembayaran, bukan state-sync event. Lihat
   * PaymentsService.collectCod() (dipanggil hanya di successful-create
   * branch, tidak di idempotency-replay branch, supaya retry outbox
   * offline-first tidak double-notify customer untuk collection yang sama).
   */
  emitOrderCodCollected(
    customerId: string,
    orderId: string,
    amountCents: number,
    currency: string,
  ): void {
    const payload: OrderCodCollectedPayload = {
      orderId,
      amountCents,
      currency,
      collectedAt: new Date().toISOString(),
    };
    this.server.to(customerId).emit('order:cod_collected', payload);
  }

  // ===== Driver-targeted emits (new) =====

  /**
   * Broadcast ke semua online driver bahwa ada order baru di pool.
   * Payload SANGAT minimal, driver tap untuk lihat full detail.
   */
  emitOrderAvailable(order: Order): void {
    const payload: OrderAvailablePayload = {
      orderId: order.id,
      totalCents: order.totalCents,
      currency: order.currency,
      itemsCount: order.items.length,
      city: order.deliveryAddress?.city,
      createdAt: order.createdAt,
    };
    this.server.to(OrdersGateway.DRIVERS_AVAILABLE_ROOM).emit('order:available', payload);
  }

  /**
   * Broadcast ke semua driver bahwa order X sudah tidak tersedia.
   * Reason untuk analytics + future UX.
   */
  emitOrderUnavailable(
    orderId: string,
    reason: 'accepted' | 'rejected' | 'reassigned',
  ): void {
    const payload: OrderUnavailablePayload = { orderId, reason };
    this.server.to(OrdersGateway.DRIVERS_AVAILABLE_ROOM).emit('order:unavailable', payload);
  }

  /**
   * Emit event ke customer saat driver pemilik melakukan transisi status
   * sempit via PATCH /orders/:id/status.
   *
   * Hanya dua transisi yang dipancarkan:
   * PREPARING jadi OUT_FOR_DELIVERY dan OUT_FOR_DELIVERY jadi DELIVERED.
   * Dipanggil tepat sekali per PATCH sukses (lihat OrdersService.transitionStatus).
   */
  emitOrderStatusUpdated(customerId: string, payload: OrderStatusUpdatedPayload): void {
    this.server.to(customerId).emit('order:status_updated', payload);
  }
}
