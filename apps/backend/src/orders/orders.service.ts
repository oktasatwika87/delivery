import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

  async findById(id: string): Promise<Order> {
    const row = await this.prisma.order.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Order ${id} not found`);
    return this.toDomain(row);
  }

  async create(input: CreateOrderInput): Promise<Order> {
    const totalCents = input.items.reduce(
      (sum, item) => sum + item.unitPriceCents * item.quantity,
      0,
    );
    const row = await this.prisma.order.create({
      data: {
        customerId: 'pending', // TODO: ambil dari auth context
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
  ): Promise<Order> {
    if (!(nextStatus in OrderStatus)) {
      throw new BadRequestException(`Invalid status ${nextStatus}`);
    }
    const current = await this.prisma.order.findUnique({ where: { id } });
    if (!current) throw new NotFoundException(`Order ${id} not found`);

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
      // Items & address di Prisma adalah Json; cast ke expected shape.
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
