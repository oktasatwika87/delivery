import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import type { CreatePaymentInput, Payment } from '@delivery/shared';

@Injectable()
export class PaymentsService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreatePaymentInput): Promise<Payment> {
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

  async capture(orderId: string): Promise<Payment> {
    const row = await this.prisma.payment.findFirst({ where: { orderId } });
    if (!row) throw new Error(`No payment for order ${orderId}`);
    const updated = await this.prisma.payment.update({
      where: { id: row.id },
      data: { status: 'CAPTURED', version: { increment: 1 } },
    });
    return this.toDomain(updated);
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
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
