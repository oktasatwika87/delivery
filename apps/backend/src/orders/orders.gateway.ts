import {
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';

/**
 * WebSocket Gateway untuk order events (accept/reject notifications).
 *
 * Concern berbeda dari ChatGateway — ini untuk push notification ke customer
 * saat order status berubah (driver accept/reject).
 *
 * Auth: JWT diverifikasi via JwtService (reuse dari AuthModule).
 * Room = customerId — customer join room untuk dapat notifications.
 */
@WebSocketGateway({ namespace: '/orders', cors: true })
export class OrdersGateway {
  @WebSocketServer() server!: Server;

  /**
   * Emit event ke customer saat order di-accept oleh driver.
   * Payload: { orderId, status, driverId, version }
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
   * Payload: { orderId, status }
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
   * Payload: { orderId, status, version, reason? }
   */
  emitOrderCancelled(customerId: string, orderId: string, newVersion: number, reason?: string): void {
    this.server.to(customerId).emit('order:cancelled', {
      orderId,
      status: 'CONFIRMED',
      version: newVersion,
      reason,
    });
  }
}
