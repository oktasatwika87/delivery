import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Socket, Server } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

import {
  UserRole,
  type Order,
  type OrderAvailablePayload,
  type OrderUnavailablePayload,
  type OrderAcceptedPayload,
  type OrderRejectedPayload,
  type OrderCancelledPayload,
} from '@delivery/shared';

/**
 * WebSocket Gateway untuk order events.
 *
 * Dua arah emit:
 * 1. Customer-targeted: order:accepted, order:rejected, order:cancelled
 *    - room = customerId (customer socket joins own userId di handleConnection)
 * 2. Driver-targeted: order:available, order:unavailable
 *    - room = 'drivers:available' (driver socket joins di handleConnection)
 *
 * Auth: JWT diverifikasi di handleConnection (reuse pattern dari ChatGateway).
 */
@WebSocketGateway({ namespace: '/orders', cors: true })
export class OrdersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  private static readonly DRIVERS_AVAILABLE_ROOM = 'drivers:available';
  private readonly userSockets = new Map<string, Set<string>>();

  constructor(private readonly jwtService: JwtService) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify(token) as { sub: string; role: UserRole };
      if (!payload?.sub) {
        client.disconnect();
        return;
      }

      client.data['userId'] = payload.sub;
      client.data['role'] = payload.role;

      // Track per-user (cleanup on disconnect)
      const existing = this.userSockets.get(payload.sub) ?? new Set<string>();
      existing.add(client.id);
      this.userSockets.set(payload.sub, existing);

      // Driver joins global pool room (untuk order:available/unavailable events)
      if (payload.role === UserRole.DRIVER) {
        client.join(OrdersGateway.DRIVERS_AVAILABLE_ROOM);
      }

      // Customer joins own userId room (untuk order:accepted/rejected/cancelled events).
      // Emit calls pake `this.server.to(customerId)` yang cuma delivers ke socket
      // di room dengan id == customerId — tanpa ini, customer-targeted events
      // hilang diam-diam. Plumbing ini melengkapi gap Tier 6 yang setengah jadi
      // (comment bilang "room = customerId" tapi handleConnection tidak pernah
      // join customer ke room apapun).
      if (payload.role === UserRole.CUSTOMER) {
        client.join(payload.sub);
      }
    } catch {
      client.disconnect();
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
   * FIX (2026-09): status diubah dari 'CANCELLED' ke 'CONFIRMED' — mengikuti
   * fix di OrdersService.rejectOrder() (CANCELLED itu status terminal,
   * membunuh order permanen; reject sekarang balik ke CONFIRMED, sama seperti
   * cancel, supaya order bisa di-assign ulang). Lihat orders.service.ts.
   *
   * Payload sekarang di-type dari @delivery/shared (OrderRejectedPayload) —
   * ini yang bikin `status` di sini nggak bisa diam-diam balik ke 'CANCELLED'
   * lagi tanpa compile error di sisi mobile juga (lihat order-events.ts untuk
   * riwayat lengkap kenapa ini penting).
   */
  emitOrderRejected(customerId: string, orderId: string, newVersion: number): void {
    const payload: OrderRejectedPayload = {
      orderId,
      status: 'CONFIRMED',
      version: newVersion,
    };
    this.server.to(customerId).emit('order:rejected', payload);
  }

  /**
   * Emit event ke customer saat driver cancel mid-delivery.
   */
  emitOrderCancelled(customerId: string, orderId: string, newVersion: number, reason?: string): void {
    const payload: OrderCancelledPayload = {
      orderId,
      status: 'CONFIRMED',
      version: newVersion,
      reason,
    };
    this.server.to(customerId).emit('order:cancelled', payload);
  }

  // ===== Driver-targeted emits (new) =====

  /**
   * Broadcast ke semua online driver bahwa ada order baru di pool.
   * Payload SANGAT minimal — driver tap untuk lihat full detail.
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
}
