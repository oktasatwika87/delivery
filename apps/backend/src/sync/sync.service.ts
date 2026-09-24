import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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

    // Update driver lastSeenAt setiap kali device berhasil sync.
    // Ini yang dipakai ReassignmentService untuk deteksi driver macet.
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: { lastSeenAt: new Date() },
    });

    return {
      nextCursor: lastUpdatedAt ? lastUpdatedAt.toISOString() : since,
      records,
      serverTime: new Date().toISOString(),
    };
  }

  // ============ applyOne: order/payment ditolak, chat_message tidak berubah ============

  public async applyOne(
    entityType: string,
    record: SyncPushPayload['records'][number],
  ): Promise<SyncRecordAck> {
    const { id, data, baseVersion, op } = record;
    const now = new Date().toISOString();

    // entityType tak dikenal — tolak segera
    if (entityType !== 'order' && entityType !== 'payment' && entityType !== 'chat_message') {
      return this.nack(id, entityType, 'rejected', 'Tipe data tidak dikenal', now);
    }

    // Order: semua push ditolak. Update/delete cek OCC duluan.
    if (entityType === 'order') {
      if (op === 'create') {
        // Create: langsung nack tanpa query DB
        return this.nack(id, entityType, 'rejected',
          'Order hanya bisa diubah lewat endpoint order', now);
      }
      // Update/delete: OCC conflict harus didahulukan dari penolakan
      const row = await this.prisma.order.findUnique({ where: { id } });
      if (!row) {
        return this.nack(id, entityType, 'rejected',
          `Entity ${id} not found`, now);
      }
      if (row.version !== baseVersion) {
        return {
          id: row.id,
          entityType: 'order',
          status: 'conflict',
          reason: `Version mismatch: base=${baseVersion}, server=${row.version}`,
          serverVersion: row.version,
          serverChangedAt: row.updatedAt.toISOString(),
          serverData: this.orderToDomain(row),
        };
      }
      return this.nack(id, entityType, 'rejected',
        'Order hanya bisa diubah lewat endpoint order', now, row.version);
    }

    // Payment: semua push ditolak. Update/delete cek OCC duluan.
    if (entityType === 'payment') {
      if (op === 'create') {
        // Create: langsung nack tanpa query DB
        return this.nack(id, entityType, 'rejected',
          'Pembayaran hanya bisa diubah lewat endpoint pembayaran', now);
      }
      // Update/delete: OCC conflict harus didahulukan dari penolakan
      const row = await this.prisma.payment.findUnique({ where: { id } });
      if (!row) {
        return this.nack(id, entityType, 'rejected',
          `Entity ${id} not found`, now);
      }
      if (row.version !== baseVersion) {
        return {
          id: row.id,
          entityType: 'payment',
          status: 'conflict',
          reason: `Version mismatch: base=${baseVersion}, server=${row.version}`,
          serverVersion: row.version,
          serverChangedAt: row.updatedAt.toISOString(),
          serverData: this.paymentToDomain(row),
        };
      }
      return this.nack(id, entityType, 'rejected',
        'Pembayaran hanya bisa diubah lewat endpoint pembayaran', now, row.version);
    }

    // Chat message: tidak berubah — masih dipakai untuk offline-first chat
    if (op === 'update' || op === 'delete') {
      const row = await this.prisma.chatMessage.findUnique({ where: { id } });
      if (!row) {
        return this.nack(id, entityType, 'rejected', `Entity ${id} not found`, now);
      }
      if (row.version !== baseVersion) {
        return {
          id: row.id,
          entityType: 'chat_message',
          status: 'conflict',
          reason: `Version mismatch: base=${baseVersion}, server=${row.version}`,
          serverVersion: row.version,
          serverChangedAt: row.updatedAt.toISOString(),
          serverData: this.chatToDomain(row),
        };
      }
    }

    // Apply: create/update/delete untuk chat_message
    let serverVersion: number;
    if (op === 'delete') {
      const deleted = await this.prisma.chatMessage.update({
        where: { id },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      serverVersion = deleted.version;
    } else {
      const c = data as ChatMessage;
      const result = await this.prisma.chatMessage.upsert({
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
      serverVersion = result.version;
    }

    return {
      id,
      entityType: 'chat_message' as const,
      status: 'accepted',
      serverVersion,
      serverChangedAt: now,
    };
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
    // Kolom pembatalan: null jadi undefined sama seperti toDomain di
    // OrdersService (orders.service.ts:446-447) supaya shape konsisten
    // antara pull REST dan respons endpoint order.
    cancelledBy: string | null;
    cancelReason: string | null;
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
      cancelledBy: row.cancelledBy ?? undefined,
      cancelReason: row.cancelReason ?? undefined,
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