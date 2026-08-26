import { BadRequestException, Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaClient, OrderStatusDb } from '@prisma/client';

import {
  ORDER_ALLOWED_TRANSITIONS,
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
 * minimal untuk nge-tap card — full detail di-fetch via GET /orders/:id
 * setelah tap.
 *
 * Shape ini PARALEL dengan WebSocket broadcast `emitOrderAvailable`
 * (orders.gateway.ts) — sehingga REST + WS driver pool konsisten.
 * Lihat catatan desain Tier 6 untuk origin spec.
 */
export interface AvailableOrderPayload {
  orderId: string;
  totalCents: number;
  currency: string;
  itemsCount: number;
  city?: string;
  createdAt: string;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ordersGateway: OrdersGateway,
  ) {}

  async findById(id: string, userId: string): Promise<Order> {
    const row = await this.prisma.order.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Order ${id} not found`);
    if (row.customerId !== userId && row.driverId !== userId) {
      throw new ForbiddenException('Not your order');
    }
    return this.toDomain(row);
  }

  async create(input: CreateOrderInput, userId: string): Promise<Order> {
    const totalCents = input.items.reduce(
      (sum, item) => sum + item.unitPriceCents * item.quantity,
      0,
    );
    const row = await this.prisma.order.create({
      data: {
        customerId: userId,
        itemsJson: input.items,
        addressJson: input.deliveryAddress,
        notes: input.notes,
        totalCents,
        currency: 'IDR', // TODO: dari tenant config
      },
    });
    return this.toDomain(row);
  }

  async transitionStatus(
    id: string,
    nextStatus: string,
    expectedVersion: number,
    userId: string,
  ): Promise<Order> {
    if (!(nextStatus in OrderStatus)) {
      throw new BadRequestException(`Invalid status ${nextStatus}`);
    }
    const current = await this.prisma.order.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Order ${id} not found`);

    // Validate ownership: customer atau driver boleh transition
    if (current.customerId !== userId && current.driverId !== userId) {
      throw new ForbiddenException('Not your order');
    }

    // Track pool state SEBELUM update
    const wasInPool = current.status === OrderStatusDb.ASSIGNED && current.driverId === null;

    const allowed = ORDER_ALLOWED_TRANSITIONS[current.status as unknown as OrderStatus];
    if (!allowed.includes(nextStatus as OrderStatus)) {
      throw new BadRequestException(
        `Transition ${current.status} -> ${nextStatus} not allowed`,
      );
    }

    const updated = await this.prisma.order.update({
      where: { id, version: expectedVersion },
      data: {
        status: nextStatus as OrderStatusDb,
        version: { increment: 1 },
      },
    });

    // Track pool state SETELAH update
    const isNowInPool = updated.status === OrderStatusDb.ASSIGNED && updated.driverId === null;

    if (isNowInPool && !wasInPool) {
      // Order baru masuk pool
      this.ordersGateway.emitOrderAvailable(this.toDomain(updated));
    } else if (wasInPool && !isNowInPool) {
      // Order keluar dari pool (di-assign driver, atau status berubah keluar ASSIGNED)
      this.ordersGateway.emitOrderUnavailable(id, 'reassigned');
    }

    return this.toDomain(updated);
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
    if (!current) throw new NotFoundException(`Order ${id} not found`);

    // Role check: harus DRIVER (dipastikan di controller via @CurrentUser('role'))
    // Status check: harus ASSIGNED baru bisa di-accept
    if (current.status !== OrderStatusDb.ASSIGNED) {
      throw new BadRequestException(
        `Cannot accept order in status ${current.status}. Expected ASSIGNED.`,
      );
    }

    // Ownership: order harus belum di-accept driver lain (driverId === null berarti belum ada yang accept)
    // Kalau driverId === driverId (driver yang sama), bisa jadi retry — OCC akan handle
    if (current.driverId !== null && current.driverId !== driverId) {
      throw new ConflictException('Order already accepted by another driver');
    }

    try {
      const updated = await this.prisma.order.update({
        where: { id, version: expectedVersion },
        data: {
          status: OrderStatusDb.PREPARING,
          driverId, // assign driver saat accept
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
      // OCC conflict: version mismatch → 409 Conflict
      // Check code directly since instanceof may fail with mocks
      const error = err as { code?: string };
      if (error.code === 'P2025') {
        throw new ConflictException('Order was modified by another request. Please refresh and try again.');
      }
      throw err;
    }
  }

  /**
   * Driver reject order yang sudah di-assign.
   * Validasi: DRIVER role, status ASSIGNED.
   * Setelah reject, order bisa di-assign ke driver lain.
   */
  async rejectOrder(
    id: string,
    expectedVersion: number,
  ): Promise<Order> {
    const current = await this.prisma.order.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Order ${id} not found`);

    // Status check: harus ASSIGNED baru bisa di-reject
    if (current.status !== OrderStatusDb.ASSIGNED) {
      throw new BadRequestException(
        `Cannot reject order in status ${current.status}. Expected ASSIGNED.`,
      );
    }

    try {
      const updated = await this.prisma.order.update({
        where: { id, version: expectedVersion },
        data: {
          status: OrderStatusDb.CANCELLED,
          version: { increment: 1 },
        },
      });

      // Emit event ke customer via WebSocket
      this.ordersGateway.emitOrderRejected(
        current.customerId,
        id,
        updated.version,
      );

      // Broadcast ke drivers:available bahwa order sudah di-reject
      this.ordersGateway.emitOrderUnavailable(id, 'rejected');

      return this.toDomain(updated);
    } catch (err) {
      const error = err as { code?: string };
      if (error.code === 'P2025') {
        throw new ConflictException('Order was modified by another request. Please refresh and try again.');
      }
      throw err;
    }
  }

  /**
   * Driver cancel order yang sudah di-assign.
   * Validasi: DRIVER role, status ASSIGNED/PREPARING/OUT_FOR_DELIVERY,
   * driver adalah owner dari order ini.
   * Setelah cancel, order kembali ke CONFIRMED dan bisa di-assign ulang.
   */
  async cancelOrder(
    id: string,
    expectedVersion: number,
    driverId: string,
    reason?: string,
  ): Promise<Order> {
    const current = await this.prisma.order.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Order ${id} not found`);

    // Driver ownership: hanya driver yang sedang assigned yang boleh cancel
    if (current.driverId !== driverId) {
      throw new ForbiddenException('You are not assigned to this order');
    }

    // Status check: harus ASSIGNED, PREPARING, atau OUT_FOR_DELIVERY
    const isCancellable = (
      status: OrderStatusDb,
    ): status is 'ASSIGNED' | 'PREPARING' | 'OUT_FOR_DELIVERY' =>
      status === OrderStatusDb.ASSIGNED ||
      status === OrderStatusDb.PREPARING ||
      status === OrderStatusDb.OUT_FOR_DELIVERY;

    if (!isCancellable(current.status)) {
      throw new BadRequestException(
        `Cannot cancel order in status ${current.status}. Must be ASSIGNED, PREPARING, or OUT_FOR_DELIVERY.`,
      );
    }

    try {
      const updated = await this.prisma.order.update({
        where: { id, version: expectedVersion },
        data: {
          status: OrderStatusDb.CONFIRMED,
          driverId: null,
          cancelledBy: driverId,
          cancelReason: reason,
          version: { increment: 1 },
        },
      });

      // Emit event ke customer via WebSocket
      this.ordersGateway.emitOrderCancelled(
        current.customerId,
        id,
        updated.version,
        reason,
      );

      return this.toDomain(updated);
    } catch (err) {
      const error = err as { code?: string };
      if (error.code === 'P2025') {
        throw new ConflictException('Order was modified by another request. Please refresh and try again.');
      }
      throw err;
    }
  }

  /**
   * List orders yang siap di-accept (status ASSIGNED, belum ada driver).
   * Untuk driver lihat pool. Read-only, tidak ada side effect.
   *
   * Return `AvailableOrderPayload[]` (slim shape), BUKAN full `Order[]`.
   * Lihat type def di atas untuk rationale + parallel dengan WS broadcast.
   *
   * @param _driverId - userId dari JWT (untuk future audit logging, tidak untuk filter)
   * @param take - max orders (hard cap 100)
   */
  async findAvailable(_driverId: string, take: number): Promise<AvailableOrderPayload[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        status: OrderStatusDb.ASSIGNED,
        driverId: null,
        deletedAt: null,
      },
      take,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toAvailablePayload(r));
  }

  /**
   * Map Prisma row ke slim `AvailableOrderPayload`.
   *
   * Mapping:
   * - r.id → orderId
   * - Array `itemsJson.length` → itemsCount (safe: itemsJson selalu array,
   *   schema enforced di service.create)
   * - r.addressJson?.city → city (optional chain karena addressJson typed
   *   sebagai `Json` di Prisma — defensif, meski schema enforce object)
   * - r.createdAt.toISOString() → createdAt (string format ISO 8601,
   *   sesuai `Order.createdAt` convention)
   */
  private toAvailablePayload(row: {
    id: string;
    itemsJson: unknown;
    addressJson: unknown;
    totalCents: number;
    currency: string;
    createdAt: Date;
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
