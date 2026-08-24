import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { OrderStatus, ORDER_ALLOWED_TRANSITIONS } from '@delivery/shared';
import type {
  ChatMessage,
  Order,
  Payment,
  SyncPullResponse,
  SyncPushPayload,
  SyncPushResponse,
  SyncRecordAck,
  SyncRecordPull,
} from '@delivery/shared';

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaClient) {}

  async applyPush(payload: SyncPushPayload): Promise<SyncPushResponse> {
    const acks: SyncRecordAck[] = [];
    for (const record of payload.records) {
      const ack = await this.applyOne(record.entityType, record);
      acks.push(ack);
    }
    return { acks };
  }

  async pullSince(deviceId: string, userId: string, since: string | null): Promise<SyncPullResponse> {
    const sinceDate = since ? new Date(since) : new Date(0);

    // Dapatkan order IDs di mana user adalah customer ATAU driver
    // roomId di chat_messages merujuk ke orderId
    const userOrders = await this.prisma.order.findMany({
      where: { OR: [{ customerId: userId }, { driverId: userId }] },
      select: { id: true },
    });
    const userOrderIds = userOrders.map((o) => o.id);

    // Pull orders (customer atau driver)
    const [orders, payments, chats] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          updatedAt: { gt: sinceDate },
          OR: [{ customerId: userId }, { driverId: userId }],
        },
      }),
      // Payments visible oleh customer DAN driver (driver perlu tahu COD status sebelum antar)
      this.prisma.payment.findMany({
        where: {
          updatedAt: { gt: sinceDate },
          order: { OR: [{ customerId: userId }, { driverId: userId }] },
        },
      }),
      // Chat messages: tampilkan semua pesan di room tempat user terlibat
      // roomId = orderId, jadi filter berdasarkan userOrderIds
      this.prisma.chatMessage.findMany({
        where: {
          updatedAt: { gt: sinceDate },
          roomId: { in: userOrderIds },
        },
      }),
    ]);

    const records: SyncRecordPull[] = [
      ...orders.map((o) => ({
        entityType: 'order' as const,
        id: o.id,
        deleted: !!o.deletedAt,
        serverChangedAt: o.updatedAt.toISOString(),
        serverVersion: o.version,
        data: this.orderToDomain(o),
      })),
      ...payments.map((p) => ({
        entityType: 'payment' as const,
        id: p.id,
        deleted: !!p.deletedAt,
        serverChangedAt: p.updatedAt.toISOString(),
        serverVersion: p.version,
        data: this.paymentToDomain(p),
      })),
      ...chats.map((c) => ({
        entityType: 'chat_message' as const,
        id: c.id,
        deleted: !!c.deletedAt,
        serverChangedAt: c.updatedAt.toISOString(),
        serverVersion: c.version,
        data: this.chatToDomain(c),
      })),
    ];

    // Update cursor (last seen updatedAt per device)
    const lastUpdatedAt = records.reduce<Date | null>(
      (acc, r) =>
        !acc || new Date(r.serverChangedAt) > acc ? new Date(r.serverChangedAt) : acc,
      sinceDate,
    );
    if (lastUpdatedAt) {
      await this.prisma.syncCursor.upsert({
        where: { deviceId },
        create: {
          deviceId,
          userId,
          cursor: lastUpdatedAt.toISOString(),
        },
        update: { cursor: lastUpdatedAt.toISOString() },
      });
    }

    return {
      nextCursor: lastUpdatedAt ? lastUpdatedAt.toISOString() : since,
      records,
      serverTime: new Date().toISOString(),
    };
  }

  // ============ applyOne dengan OCC + idempotency ============

  public async applyOne(
    entityType: string,
    record: SyncPushPayload['records'][number],
  ): Promise<SyncRecordAck> {
    const { id, data, baseVersion, op } = record;
    const now = new Date().toISOString();

    // Idempotency check untuk CREATE payment saja
    if (entityType === 'payment' && op === 'create') {
      const paymentData = data as Payment;
      const existing = await this.prisma.payment.findUnique({
        where: { idempotencyKey: paymentData.idempotencyKey },
      });
      if (existing) {
        // Record sudah pernah diproses — return data lengkap supaya client
        // bisa match balugin ack ke local row yang punya `idempotencyKey`
        // sama. Tanpa serverData, client tidak punya cara match ack.id
        // (server-side UUID) ke local.id (WatermelonDB UUID) ketika ACK
        // pertama hilang dan row stuck dirty sampai retry cap.
        return {
          id: existing.id,
          entityType: 'payment',
          status: 'accepted',
          serverVersion: existing.version,
          serverChangedAt: existing.updatedAt.toISOString(),
          serverData: this.paymentToDomain(existing),
        };
      }
    }

    // OCC untuk update/delete
    if (op === 'update' || op === 'delete') {
      const row = await this.fetchDbRow(entityType, id);
      if (!row) {
        return this.nack(id, entityType, 'rejected', `Entity ${id} not found`, now);
      }
      if (row.version !== baseVersion) {
        // Conflict — server lebih baru, return data server
        return {
          id: row.id,
          entityType: entityType as SyncRecordAck['entityType'],
          status: 'conflict',
          reason: `Version mismatch: base=${baseVersion}, server=${row.version}`,
          serverVersion: row.version,
          serverChangedAt: (row.updatedAt as Date).toISOString(),
          serverData: this.rowToDomain(entityType, row),
        };
      }

      // Order business validation — transition + ownership rules
      if (entityType === 'order' && op === 'update') {
        const orderData = data as Order;
        const orderRow = row as { status: string; driverId: string | null; version: number };
        const currentStatus = orderRow.status as OrderStatus;
        const newStatus = orderData.status as OrderStatus;

        // Rule 1: status transition valid per ORDER_ALLOWED_TRANSITIONS
        // SKIP for * -> PREPARING transitions — Rule 3 will provide specific reason
        // for accept attempts from non-ACCEPTED states (CANCELLED/DELIVERED).
        // Rule 2 will catch ownership mismatches for PREPARING pushes where driverId already set.
        if (
          newStatus !== OrderStatus.PREPARING &&
          !ORDER_ALLOWED_TRANSITIONS[currentStatus]?.includes(newStatus)
        ) {
          return this.nack(id, entityType, 'rejected',
            `Tidak bisa mengubah status order dari ${currentStatus} ke ${newStatus}`,
            now, orderRow.version);
        }

        // Rule 2: ownership — driverId must match (or server driverId is null)
        const requestDriverId = orderData.driverId;
        if (requestDriverId !== undefined && orderRow.driverId !== null && orderRow.driverId !== requestDriverId) {
          return this.nack(id, entityType, 'rejected',
            'Order sudah di-reassign ke driver lain',
            now, orderRow.version);
        }

        // Rule 3B: PREPARING push tanpa driverId — reject as invariant violation.
        // ASSUMPTION: tidak ada path di codebase saat ini yang bisa push PREPARING tanpa driverId.
        // Mobile: localRowToSyncRecord() selalu menyertakan driverId (null→undefined, bukan absent).
        // REST: acceptOrder() selalu assign driverId. transitionStatus() tidak menerima PREPARING tanpa driverId.
        // Rule 3B ini defensive — pastikan invariant tidak bocor kalau fitur baru ditambahkan.
        if (newStatus === OrderStatus.PREPARING && orderData.driverId === undefined) {
          return this.nack(id, entityType, 'rejected',
            `Tidak bisa mengubah status order dari ${currentStatus} ke PREPARING tanpa driverId`,
            now, orderRow.version);
        }
        // If push PREPARING with driverId set AND server.driverId=null
        // AND server.status bukan ASSIGNED → accept tidak valid
        if (
          newStatus === OrderStatus.PREPARING &&
          orderData.driverId !== undefined &&
          orderRow.driverId === null
        ) {
          if (currentStatus !== OrderStatus.ASSIGNED) {
            return this.nack(id, entityType, 'rejected',
              'Order sudah tidak tersedia untuk di-accept',
              now, orderRow.version);
          }
        }
      }
    }

    // Apply: create/update/delete
    let serverVersion: number;
    if (op === 'delete') {
      const deleted = await this.deleteDbRow(entityType, id);
      serverVersion = deleted.version;
    } else {
      const result = await this.upsertDbRow(entityType, id, data);
      serverVersion = result.version;
    }

    return {
      id,
      entityType: entityType as SyncRecordAck['entityType'],
      status: 'accepted',
      serverVersion,
      serverChangedAt: now,
    };
  }

  private async fetchDbRow(entityType: string, id: string) {
    switch (entityType) {
      case 'order':
        return this.prisma.order.findUnique({ where: { id } });
      case 'payment':
        return this.prisma.payment.findUnique({ where: { id } });
      case 'chat_message':
        return this.prisma.chatMessage.findUnique({ where: { id } });
      default:
        return null;
    }
  }

  private async upsertDbRow(
    entityType: string,
    id: string,
    data: Order | Payment | ChatMessage,
  ) {
    switch (entityType) {
      case 'order': {
        const o = data as Order;
        return this.prisma.order.upsert({
          where: { id },
          create: {
            id,
            customerId: o.customerId,
            driverId: o.driverId ?? null,
            status: o.status,
            itemsJson: o.items as any,
            addressJson: o.deliveryAddress as any,
            totalCents: o.totalCents,
            currency: o.currency,
            notes: o.notes,
            version: 1,
          },
          update: {
            status: o.status,
            itemsJson: o.items as any,
            addressJson: o.deliveryAddress as any,
            totalCents: o.totalCents,
            currency: o.currency,
            notes: o.notes,
            driverId: o.driverId ?? null,
            version: { increment: 1 },
          },
        });
      }
      case 'payment': {
        const p = data as Payment;
        return this.prisma.payment.upsert({
          where: { id },
          create: {
            id,
            orderId: p.orderId,
            idempotencyKey: p.idempotencyKey,
            method: p.method,
            status: p.status,
            amountCents: p.amountCents,
            currency: p.currency,
            kind: p.kind,
            externalRef: p.externalRef,
            version: 1,
          },
          update: {
            method: p.method,
            status: p.status,
            amountCents: p.amountCents,
            currency: p.currency,
            kind: p.kind,
            externalRef: p.externalRef,
            version: { increment: 1 },
          },
        });
      }
      case 'chat_message': {
        const c = data as ChatMessage;
        return this.prisma.chatMessage.upsert({
          where: { id },
          create: {
            id,
            roomId: c.roomId,
            senderId: c.senderId,
            body: c.body,
            attachmentJson: c.attachment,
            status: c.status,
            clientCreatedAt: new Date(c.clientCreatedAt),
            serverCreatedAt: c.serverCreatedAt ? new Date(c.serverCreatedAt) : null,
            version: 1,
          },
          update: {
            body: c.body,
            attachmentJson: c.attachment,
            status: c.status,
            version: { increment: 1 },
          },
        });
      }
      default:
        throw new Error(`Unknown entityType: ${entityType}`);
    }
  }

  private async deleteDbRow(entityType: string, id: string) {
    switch (entityType) {
      case 'order':
        return this.prisma.order.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      case 'payment':
        return this.prisma.payment.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      case 'chat_message':
        return this.prisma.chatMessage.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      default:
        throw new Error(`Unknown entityType: ${entityType}`);
    }
  }

  private rowToDomain(entityType: string, row: Record<string, unknown>) {
    switch (entityType) {
      case 'order':
        return this.orderToDomain(row as Parameters<typeof this.orderToDomain>[0]);
      case 'payment':
        return this.paymentToDomain(row as Parameters<typeof this.paymentToDomain>[0]);
      case 'chat_message':
        return this.chatToDomain(row as Parameters<typeof this.chatToDomain>[0]);
      default:
        throw new Error(`Unknown entityType: ${entityType}`);
    }
  }

  private nack(
    id: string,
    entityType: string,
    status: 'rejected' | 'conflict',
    reason: string,
    now: string,
    serverVersion: number = 0,
  ): SyncRecordAck {
    return { id, entityType: entityType as SyncRecordAck['entityType'], status, reason, serverVersion, serverChangedAt: now };
  }

  private orderToDomain(row: {
    id: string;
    customerId: string;
    driverId: string | null;
    status: string;
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
      status: row.status as Order['status'],
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

  private paymentToDomain(row: {
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
      method: row.method as Payment['method'],
      status: row.status as Payment['status'],
      amountCents: row.amountCents,
      currency: row.currency,
      kind: row.kind as Payment['kind'],
      idempotencyKey: row.idempotencyKey,
      externalRef: row.externalRef ?? undefined,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private chatToDomain(row: {
    id: string;
    roomId: string;
    senderId: string;
    body: string;
    attachmentJson: unknown;
    status: string;
    clientCreatedAt: Date;
    serverCreatedAt: Date | null;
    version: number;
    createdAt: Date;
    updatedAt: Date;
  }): ChatMessage {
    return {
      id: row.id,
      roomId: row.roomId,
      senderId: row.senderId,
      body: row.body,
      attachment: (row.attachmentJson as ChatMessage['attachment']) ?? undefined,
      status: row.status as ChatMessage['status'],
      clientCreatedAt: row.clientCreatedAt.toISOString(),
      serverCreatedAt: row.serverCreatedAt?.toISOString(),
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}