import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import type { CreatePaymentInput, Payment } from '@delivery/shared';

import { OrdersGateway } from '../orders/orders.gateway';
import { EmailService } from '../email/email.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ordersGateway: OrdersGateway,
    private readonly emailService: EmailService,
  ) {}

  async create(input: CreatePaymentInput, userId: string): Promise<Payment> {
    // Verify user owns the order
    const order = await this.prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order || order.customerId !== userId) {
      throw new ForbiddenException('Not your order');
    }

    const row = await this.prisma.payment.create({
      data: {
        orderId: input.orderId,
        idempotencyKey: input.idempotencyKey,
        method: input.method,
        amountCents: input.amountCents,
        currency: input.currency,
        kind: 'PAYMENT',
      },
    });
    return this.toDomain(row);
  }

  async capture(orderId: string, userId: string): Promise<Payment> {
    // Verify user owns the order (customer)
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.customerId !== userId) {
      throw new ForbiddenException('Not your order');
    }

    const row = await this.prisma.payment.findFirst({ where: { orderId } });
    if (!row) throw new Error(`No payment for order ${orderId}`);
    const updated = await this.prisma.payment.update({
      where: { id: row.id },
      data: { status: 'CAPTURED', version: { increment: 1 } },
    });
    return this.toDomain(updated);
  }

  /**
   * Driver collects COD (cash on delivery) for an order.
   * Reuses the existing idempotency key pattern to prevent double-collection.
   * Creates payment with method: CASH and status: CAPTURED directly.
   */
  async collectCod(
    orderId: string,
    driverId: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<Payment> {
    // Verify driver is assigned to this order
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (order.driverId !== driverId) {
      throw new ForbiddenException('You are not assigned to this order');
    }

    // Use upsert with idempotency key to prevent double-collection
    // If idempotencyKey already exists, return the existing record
    let row: Awaited<ReturnType<PrismaClient['payment']['create']>>;
    try {
      row = await this.prisma.payment.create({
        data: {
          orderId,
          idempotencyKey,
          method: 'CASH',
          status: 'CAPTURED',
          amountCents,
          currency: order.currency,
          kind: 'PAYMENT',
        },
      });
    } catch (err) {
      // Unique constraint violation on idempotencyKey → record already exists.
      // Deliberately NOT emitting order:cod_collected here — this branch is
      // reached by an outbox retry replaying the same collection, and the
      // customer was already notified on the original successful create.
      const error = err as { code?: string };
      if (error.code === 'P2002') {
        const existing = await this.prisma.payment.findUnique({
          where: { idempotencyKey },
        });
        if (existing) {
          return this.toDomain(existing);
        }
      }
      throw err;
    }

    // Live confirmation to the customer — order status itself doesn't change
    // (see OrdersGateway.emitOrderCodCollected doc comment), so this is a
    // notify-only emit, not a state-sync one.
    this.ordersGateway.emitOrderCodCollected(order.customerId, orderId, amountCents, order.currency);

    return this.toDomain(row);
  }

  /**
   * Flag COD as orphaned — driver collected COD offline but order was reassigned
   * before sync. Finds existing pending payment record (by idempotencyKey) and
   * marks it orphaned, then notifies HSIN via email.
   *
   * This is a server-side record flag only — the mobile app already has the
   * local `orphaned_needs_review` status. This endpoint syncs that state to server
   * so HSIN gets notified automatically.
   */
  async flagOrphanedCod(
    orderId: string,
    driverId: string,
    amountCents: number,
    idempotencyKey: string,
  ): Promise<Payment> {
    // Verify driver exists and has the role
    const driver = await this.prisma.user.findUnique({ where: { id: driverId } });
    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    // Find existing payment record by idempotencyKey
    const existing = await this.prisma.payment.findUnique({
      where: { idempotencyKey },
    });

    const now = new Date();

    if (existing) {
      // Update existing record with orphanedAt
      const updated = await this.prisma.payment.update({
        where: { id: existing.id },
        data: { orphanedAt: now, version: { increment: 1 } },
      });

      // Fire-and-forget email notification to HSIN
      this.emailService.sendOrphanedCodNotification({
        orderId,
        amountCents,
        currency: existing.currency,
        driverId,
        driverName: driver.name,
        happenedAt: now,
      });

      return this.toDomain(updated);
    } else {
      // No existing payment record — create one marked as orphaned.
      // This handles the case where the outbox detected orphan before any
      // payment record was ever created (e.g., collect-cod never succeeded).
      const order = await this.prisma.order.findUnique({ where: { id: orderId } });
      const currency = order?.currency ?? 'IDR';

      const row = await this.prisma.payment.create({
        data: {
          orderId,
          idempotencyKey,
          method: 'CASH',
          status: 'PENDING',
          amountCents,
          currency,
          kind: 'PAYMENT',
          orphanedAt: now,
        },
      });

      // Fire-and-forget email notification to HSIN
      this.emailService.sendOrphanedCodNotification({
        orderId,
        amountCents,
        currency,
        driverId,
        driverName: driver.name,
        happenedAt: now,
      });

      return this.toDomain(row);
    }
  }

  private toDomain(row: {
    id: string;
    orderId: string;
    idempotencyKey: string;
    method: string;
    status: string;
    amountCents: number;
    currency: string;
    kind: string;
    externalRef: string | null;
    orphanedAt: Date | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): Payment {
    return {
      id: row.id,
      orderId: row.orderId,
      idempotencyKey: row.idempotencyKey,
      method: row.method as Payment['method'],
      status: row.status as Payment['status'],
      amountCents: row.amountCents,
      currency: row.currency,
      kind: row.kind as Payment['kind'],
      externalRef: row.externalRef ?? undefined,
      orphanedAt: row.orphanedAt?.toISOString() ?? undefined,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
