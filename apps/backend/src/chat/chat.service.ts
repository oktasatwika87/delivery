import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import type { ChatMessage, SendChatMessageInput } from '@delivery/shared';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaClient) {}

  async listByRoom(roomId: string): Promise<ChatMessage[]> {
    const rows = await this.prisma.chatMessage.findMany({
      where: { roomId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(this.toDomain);
  }

  async send(input: SendChatMessageInput): Promise<ChatMessage> {
    const now = new Date();
    const row = await this.prisma.chatMessage.create({
      data: {
        roomId: input.roomId,
        senderId: 'pending', // TODO: dari auth context
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
