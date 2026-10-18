import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import type {
  ChatMessage,
  Order,
  Payment,
  ReleasedOrder,
  SyncPullResponse,
  SyncPushPayload,
  SyncPushResponse,
  SyncRecordAck,
  SyncRecordPull,
} from '@delivery/shared';

import { ChatGateway } from '../chat/chat.gateway';
import { ChatService } from '../chat/chat.service';

/** Bentuk UUID, huruf besar atau kecil, sama dengan id di seluruh backend. */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Batas jumlah id yang diterima dari satu kali pull. */
const HELD_ORDER_IDS_MAX = 100;

/**
 * Mengubah query `heldOrderIds` (id dipisah koma) jadi daftar id yang sah.
 * Tidak pernah melempar galat: pull tidak boleh gagal karena parameter ini,
 * walaupun HP mengirim bentuk yang salah. Dipakai untuk memberi tahu driver
 * bahwa order yang masih dipegangnya sudah bukan miliknya lagi.
 */
export function parseHeldOrderIds(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  const parts = value.split(',');
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (!UUID_REGEX.test(trimmed)) continue;
    const normalized = trimmed.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= HELD_ORDER_IDS_MAX) break;
  }
  return result;
}

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
  ) {}

  async applyPush(payload: SyncPushPayload, userId: string): Promise<SyncPushResponse> {
    const acks: SyncRecordAck[] = [];
    for (const record of payload.records) {
      const ack = await this.applyOne(record.entityType, record, userId);
      acks.push(ack);
    }
    return { acks };
  }

  async pullSince(
    deviceId: string,
    userId: string,
    since: string | null,
    heldOrderIds: string[] = [],
  ): Promise<SyncPullResponse> {
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

    // Order yang menurut HP masih dipegang pemanggil tapi di server sudah
    // bukan miliknya. Hanya id dan versi yang dikirim, karena pemanggil
    // sudah tidak berhak melihat data order itu. Disaring di kode, bukan
    // dengan NOT di Prisma: perbandingan dengan driverId null hasilnya NULL
    // di SQL, jadi order di pool ikut tersaring keluar.
    let releasedOrders: ReleasedOrder[] = [];
    if (heldOrderIds.length > 0) {
      const heldRows = await this.prisma.order.findMany({
        where: { id: { in: heldOrderIds } },
        select: { id: true, version: true, customerId: true, driverId: true },
      });
      releasedOrders = heldRows
        .filter((row) => row.driverId !== userId && row.customerId !== userId)
        .map((row) => ({ id: row.id, version: row.version }));
    }

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
      releasedOrders,
      serverTime: new Date().toISOString(),
    };
  }

  // ============ applyOne: order/payment ditolak, chat_message tidak berubah ============

  public async applyOne(
    entityType: string,
    record: SyncPushPayload['records'][number],
    userId: string,
  ): Promise<SyncRecordAck> {
    const { id, data, baseVersion, op } = record;
    const now = new Date().toISOString();

    // entityType tak dikenal - tolak segera
    if (entityType !== 'order' && entityType !== 'payment' && entityType !== 'chat_message') {
      return this.nack(id, entityType, 'rejected', 'Tipe data tidak dikenal', now);
    }

    // Order: semua push ditolak. Update/delete cek pemilik dan OCC duluan.
    if (entityType === 'order') {
      if (op === 'create') {
        // Create: langsung nack tanpa query DB
        return this.nack(id, entityType, 'rejected',
          'Order hanya bisa diubah lewat endpoint order', now);
      }
      // Update/delete: cek pemilik lebih dulu, supaya kiriman basi dari akun
      // lain tidak bisa dipakai untuk membaca data order lewat balasan
      // `conflict`. Sesudah itu OCC conflict tetap didahulukan dari penolakan
      // di bawah, supaya HP yang mengirim baseVersion basi untuk order
      // miliknya sendiri bisa pulih dengan data server.
      const row = await this.prisma.order.findUnique({ where: { id } });
      if (!row) {
        return this.nack(id, entityType, 'rejected',
          `Entity ${id} not found`, now);
      }
      if (row.customerId !== userId && row.driverId !== userId) {
        return this.nack(id, entityType, 'rejected',
          'Order ini bukan milik Anda', now);
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

    // Payment: semua push ditolak. Update/delete cek pemilik dan OCC duluan.
    if (entityType === 'payment') {
      if (op === 'create') {
        // Create: langsung nack tanpa query DB
        return this.nack(id, entityType, 'rejected',
          'Pembayaran hanya bisa diubah lewat endpoint pembayaran', now);
      }
      // Update/delete: cek pemilik lebih dulu, sebelum OCC. Pemilik
      // pembayaran adalah customer atau driver ordernya. Tanpa cek ini,
      // kiriman basi dari akun lain dibalas `conflict` dengan serverData,
      // sehingga data pembayaran orang lain bisa terbaca.
      const row = await this.prisma.payment.findUnique({
        where: { id },
        include: { order: { select: { customerId: true, driverId: true } } },
      });
      if (!row) {
        return this.nack(id, entityType, 'rejected',
          `Entity ${id} not found`, now);
      }
      if (row.order.customerId !== userId && row.order.driverId !== userId) {
        return this.nack(id, entityType, 'rejected',
          'Pembayaran ini bukan milik Anda', now);
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

    // Chat message
    if (op === 'create') {
      const c = data as ChatMessage;
      try {
        const { message, created } = await this.chatService.send(
          {
            id,
            roomId: c.roomId,
            body: c.body,
            attachment: c.attachment,
            clientCreatedAt: c.clientCreatedAt,
          },
          userId,
        );
        if (created) {
          this.chatGateway.emitNewMessage(message);
        }
        return {
          id: message.id,
          entityType: 'chat_message' as const,
          status: 'accepted',
          serverVersion: message.version,
          serverChangedAt: new Date().toISOString(),
        };
      } catch (err: unknown) {
        if (err instanceof ForbiddenException) {
          return this.nack(id, 'chat_message', 'rejected',
            'Pesan ditolak: bukan peserta chat order ini atau id pesan sudah dipakai', new Date().toISOString());
        }
        throw err;
      }
    }

    // Update/delete: OCC check dulu, lalu cek senderId
    const row = await this.prisma.chatMessage.findUnique({ where: { id } });
    if (!row) {
      return this.nack(id, 'chat_message', 'rejected', `Entity ${id} not found`, now);
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
    // Setelah OCC pass, cek sender
    if (row.senderId !== userId) {
      return this.nack(id, 'chat_message', 'rejected', 'Pesan ini bukan milik Anda', now, row.version);
    }

    if (op === 'delete') {
      const deleted = await this.prisma.chatMessage.update({
        where: { id },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      return {
        id,
        entityType: 'chat_message' as const,
        status: 'accepted',
        serverVersion: deleted.version,
        serverChangedAt: now,
      };
    }

    // op === 'update': hanya body & attachment; status dari klien diabaikan
    const c = data as ChatMessage;
    const updated = await this.prisma.chatMessage.update({
      where: { id },
      data: {
        body: c.body,
        attachmentJson: c.attachment ?? undefined,
        version: { increment: 1 },
      },
    });
    return {
      id,
      entityType: 'chat_message' as const,
      status: 'accepted',
      serverVersion: updated.version,
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