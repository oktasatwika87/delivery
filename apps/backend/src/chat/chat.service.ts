import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import type { ChatMessage, SendChatMessageInput } from '@delivery/shared';

/**
 * Chat rooms dalam delivery app adalah order-specific.
 *
 * KONTRAK DESAIN: roomId selalu berisi orderId.
 *
 * Artinya:
 *   - Setiap chat room = 1 order
 *   - roomId = orderId (exact match, bukan prefix atau format lain)
 *
 * Validasi di method send() adalah penegakan kontrak ini secara eksplisit:
 * backend tidak percaya client soal roomId — harus diverifikasi bahwa:
 *   1. order dengan roomId tersebut ada
 *   2. pengirim adalah customer ATAU driver dari order tersebut
 *
 * Jika salah satu tidak terpenuhi, chat tidak boleh dibuat (ForbiddenException).
 */
@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Validasi apakah user memiliki akses ke room (orderId).
   *
   * Dipakai oleh:
   * - ChatService.send() — REST endpoint
   * - ChatGateway join_room event — WebSocket
   *
   * throws ForbiddenException jika order tidak ada atau user bukan customer/driver.
   */
  async validateRoomAccess(roomId: string, userId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: roomId },
      select: { id: true, customerId: true, driverId: true },
    });

    if (!order) {
      throw new ForbiddenException('Order not found');
    }

    if (order.customerId !== userId && order.driverId !== userId) {
      throw new ForbiddenException('Not your order');
    }
  }

  async listByRoom(roomId: string): Promise<ChatMessage[]> {
    const rows = await this.prisma.chatMessage.findMany({
      where: { roomId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(this.toDomain);
  }

  /**
   * Kirim chat message.
   *
   * Kontrak roomId = orderId ditegakkan di sini:
   * - Cek order dengan roomId ada
   * - Cek sender adalah customer atau driver dari order tersebut
   */
  async send(input: SendChatMessageInput, senderId: string): Promise<ChatMessage> {
    await this.validateRoomAccess(input.roomId, senderId);

    const now = new Date();
    const row = await this.prisma.chatMessage.create({
      data: {
        // Use client-generated ID if provided (consistent ID across devices)
        id: input.id ?? undefined,
        roomId: input.roomId,
        senderId,
        body: input.body,
        attachmentJson: input.attachment ?? undefined,
        status: 'SENT',
        clientCreatedAt: now,
        serverCreatedAt: now,
      },
    });
    return this.toDomain(row);
  }

  private toDomain = (row: {
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
  }): ChatMessage => ({
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
  });
}
