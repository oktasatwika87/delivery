import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { ChatMessage } from '@delivery/shared';
import { JwtService } from '@nestjs/jwt';

import { ChatService } from './chat.service';
import { SendChatMessageDto } from './chat.dto';

/**
 * WebSocket Gateway untuk chat real-time.
 *
 * Auth: JWT diverifikasi di handleConnection via JwtService (reuse dari AuthModule).
 * roomId = orderId kontrak yang sama dengan ChatService.
 * Ownership validasi dilakukan via ChatService.validateRoomAccess().
 */
@WebSocketGateway({ namespace: '/chat', cors: true })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  // Track client sockets per user untuk cleanup saat disconnect
  private userSockets = new Map<string, Set<string>>();

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Verifikasi JWT saat socket connect.
   * Token dikirim via socket.handshake.auth.token.
   * Jika invalid/missing, disconnect socket.
   */
  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;

    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify(token);
      if (!payload?.sub) {
        client.disconnect();
        return;
      }

      // Simpan userId di socket data untuk dipakai di event lain
      client.data['userId'] = payload.sub;

      // Track socket per user
      const existing = this.userSockets.get(payload.sub);
      if (existing) {
        existing.add(client.id);
      } else {
        this.userSockets.set(payload.sub, new Set([client.id]));
      }
    } catch (err) {
      console.warn(
        '[ChatGateway] JWT verification failed:',
        err instanceof Error ? err.message : String(err),
      );
      client.disconnect();
    }
  }

  /**
   * Cleanup state saat client disconnect.
   */
  handleDisconnect(client: Socket): void {
    const userId = client.data['userId'] as string | undefined;
    if (userId) {
      this.userSockets.get(userId)?.delete(client.id);
      if (this.userSockets.get(userId)?.size === 0) {
        this.userSockets.delete(userId);
      }
    }
  }

  /**
   * User join ke room chat (order-specific).
   *
   * Payload: { roomId: string }
   *
   * Validasi: user harus customer atau driver dari order terkait
   * (reuse ChatService.validateRoomAccess).
   */
  @SubscribeMessage('join_room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string },
  ): Promise<{ success: boolean; error?: string }> {
    const userId = client.data['userId'] as string | undefined;
    if (!userId) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      // Ownership validation via ChatService (reuse logic dari REST endpoint)
      await this.chatService.validateRoomAccess(payload.roomId, userId);

      // Join Socket.IO room
      client.join(payload.roomId);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Pancarkan new_message ke semua client di room.
   * Harusnya dipanggil oleh pemanggil (gateway, controller, sync) setelah pesan dibuat.
   */
  emitNewMessage(message: ChatMessage): void {
    this.server.to(message.roomId).emit('new_message', message);
  }

  /**
   * Kirim chat message.
   *
   * Payload: SendChatMessageDto
   *
   * Validasi room access dilakukan di ChatService.send().
   * Setelah berhasil, broadcast ke semua socket di room yang sama.
   */
  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<{ success: boolean; error?: string; message?: ChatMessage }> {
    const userId = client.data['userId'] as string | undefined;
    if (!userId) {
      return { success: false, error: 'Not authenticated' };
    }

    const dto = plainToInstance(SendChatMessageDto, payload);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      const first = errors[0];
      const msg = Object.values(first.constraints ?? {})[0] ?? 'Payload tidak valid';
      return { success: false, error: msg };
    }

    try {
      const { message, created } = await this.chatService.send(dto, userId);

      if (created) {
        this.emitNewMessage(message);
      }

      return { success: true, message };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  /**
   * Leave room (opsional, socket auto-leave saat disconnect).
   */
  @SubscribeMessage('leave_room')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { roomId: string },
  ): void {
    client.leave(payload.roomId);
  }
}
