import { BadRequestException, Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaClient, OrderStatusDb } from '@prisma/client';

import {
  ORDER_ALLOWED_TRANSITIONS,
  OrderStatus,
  type CreateOrderInput,
  type Order,
} from '@delivery/shared';

import { OrdersGateway } from './orders.gateway';

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

      return this.toDomain(updated);
    } catch (err) {
      const error = err as { code?: string };
      if (error.code === 'P2025') {
        throw new ConflictException('Order was modified by another request. Please refresh and try again.');
      }
      throw err;
    }
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
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
