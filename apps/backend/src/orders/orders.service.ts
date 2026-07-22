import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaClient, OrderStatusDb } from '@prisma/client';

import {
  ORDER_ALLOWED_TRANSITIONS,
  OrderStatus,
  type CreateOrderInput,
  type Order,
} from '@delivery/shared';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaClient) {}

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
