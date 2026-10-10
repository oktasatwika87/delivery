import { Injectable, ForbiddenException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import type { ChatMessage } from '@delivery/shared';

import { SendChatMessageDto } from './chat.dto';

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
 * backend tidak percaya client soal roomId - harus diverifikasi bahwa:
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
   * - ChatService.send() - REST endpoint
   * - ChatGateway join_room event - WebSocket
   *
   * throws ForbiddenException jika order tidak ada atau user bukan customer/driver.
   */
  async validateRoomAccess(roomId: string, userId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: roomId },
      select: { id: true, customerId: true, driverId: true },
    });

    if (!order) {
      throw new ForbiddenException('Order tidak ditemukan');
    }

    if (order.customerId !== userId && order.driverId !== userId) {
      throw new ForbiddenException('Order ini bukan milik Anda');
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
   *
   * Mengembalikan { message, created }:
   * - created=true: baris baru dibuat
   * - created=false: id sudah ada, baris yang ada dikembalikan tanpa diubah
   */
  async send(
    input: SendChatMessageDto,
    senderId: string,
  ): Promise<{ message: ChatMessage; created: boolean }> {
    await this.validateRoomAccess(input.roomId, senderId);

    const now = new Date();

    // Tentukan clientCreatedAt: pakai dari input kalau valid, selain itu sekarang
    let clientCreatedAt = now;
    if (input.clientCreatedAt) {
      const parsed = new Date(input.clientCreatedAt);
      if (!isNaN(parsed.getTime()) && parsed <= now) {
        clientCreatedAt = parsed;
      }
    }

    // Kalau id sudah ada: cek senderId dan roomId
    if (input.id) {
      const existing = await this.prisma.chatMessage.findUnique({
        where: { id: input.id },
      });
      if (existing) {
        if (existing.senderId !== senderId || existing.roomId !== input.roomId) {
          throw new ForbiddenException('Pesan ini bukan milik Anda di room ini');
        }
        // Idempoten: kembalikan baris yang ada tanpa mengubah apa pun
        return { message: this.toDomain(existing), created: false };
      }
    }

    // Dua perangkat membuat pesan dengan id sama secara bersamaan: lempar P2002
    try {
      const row = await this.prisma.chatMessage.create({
        data: {
          id: input.id ?? undefined,
          roomId: input.roomId,
          senderId,
          body: input.body,
          attachmentJson: input.attachment ?? undefined,
          status: 'SENT',
          clientCreatedAt,
          serverCreatedAt: now,
        },
      });
      return { message: this.toDomain(row), created: true };
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.chatMessage.findUnique({
          where: { id: input.id },
        });
        if (!existing) {
          // Seharusnya tidak terjadi
          throw err;
        }
        if (existing.senderId !== senderId || existing.roomId !== input.roomId) {
          throw new ForbiddenException('Pesan ini bukan milik Anda di room ini');
        }
        return { message: this.toDomain(existing), created: false };
      }
      throw err;
    }
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
