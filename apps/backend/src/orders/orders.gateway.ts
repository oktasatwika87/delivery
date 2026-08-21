import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Socket, Server } from 'socket.io';
import { JwtService } from '@nestjs/jwt';

import { UserRole, type Order } from '@delivery/shared';

/**
 * WebSocket Gateway untuk order events.
 *
 * Dua arah emit:
 * 1. Customer-targeted (existing): order:accepted, order:rejected, order:cancelled
 *    - room = customerId
 * 2. Driver-targeted (new): order:available, order:unavailable
 *    - room = 'drivers:available' (global, semua driver join saat connect)
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

      // Driver joins global pool room
      if (payload.role === UserRole.DRIVER) {
        client.join(OrdersGateway.DRIVERS_AVAILABLE_ROOM);
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
    this.server.to(customerId).emit('order:accepted', {
      orderId,
      driverId,
      status: 'PREPARING',
      version: newVersion,
    });
  }

  /**
   * Emit event ke customer saat order di-reject oleh driver.
   */
  emitOrderRejected(customerId: string, orderId: string, newVersion: number): void {
    this.server.to(customerId).emit('order:rejected', {
      orderId,
      status: 'CANCELLED',
      version: newVersion,
    });
  }

  /**
   * Emit event ke customer saat driver cancel mid-delivery.
   */
  emitOrderCancelled(customerId: string, orderId: string, newVersion: number, reason?: string): void {
    this.server.to(customerId).emit('order:cancelled', {
      orderId,
      status: 'CONFIRMED',
      version: newVersion,
      reason,
    });
  }

  // ===== Driver-targeted emits (new) =====

  /**
   * Broadcast ke semua online driver bahwa ada order baru di pool.
   * Payload SANGAT minimal — driver tap untuk lihat full detail.
   */
  emitOrderAvailable(order: Order): void {
    this.server.to(OrdersGateway.DRIVERS_AVAILABLE_ROOM).emit('order:available', {
      orderId: order.id,
      totalCents: order.totalCents,
      currency: order.currency,
      itemsCount: order.items.length,
      city: order.deliveryAddress?.city,
      createdAt: order.createdAt,
    });
  }

  /**
   * Broadcast ke semua driver bahwa order X sudah tidak tersedia.
   * Reason untuk analytics + future UX.
   */
  emitOrderUnavailable(
    orderId: string,
    reason: 'accepted' | 'rejected' | 'reassigned',
  ): void {
    this.server.to(OrdersGateway.DRIVERS_AVAILABLE_ROOM).emit('order:unavailable', {
      orderId,
      reason,
    });
  }
}
