/**
 * Unit tests untuk ChatGateway
 *
 * FIeld test untuk handleSendMessage menggunakan pendekatan DI mock NestJS.
 * Perilaku emitNewMessage (created=true) diuji di chat.controller.spec.ts
 * karena ChatController memanggil ChatGateway.emitNewMessage secara langsung.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { Server } from 'socket.io';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { JwtService } from '@nestjs/jwt';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let mockSend: jest.Mock;
  let emitNewMessageSpy: jest.SpyInstance;
  let toMock: jest.Mock;
  let emitMock: jest.Mock;

  const orderId = 'order-uuid-123';
  const userId = 'user-uuid';

  beforeEach(async () => {
    mockSend = jest.fn();
    const mockChatService = { send: mockSend };

    // Mock server: to() mengembalikan objek dengan emit() mock
    emitMock = jest.fn();
    toMock = jest.fn().mockReturnValue({ emit: emitMock });
    const mockServer = { to: toMock };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: ChatService, useValue: mockChatService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: Server, useValue: mockServer },
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);
    // Override server yang di-assign NestJS dengan mock yang bisa kita akses
    gateway.server = mockServer;
    // Simpan referensi ke fungsi asli sebelum dispy supaya bisa dipanggil
    // tanpa infinite recursion
    const realEmitNewMessage = gateway.emitNewMessage;
    emitNewMessageSpy = jest.spyOn(gateway, 'emitNewMessage').mockImplementation(
      (msg: Parameters<typeof realEmitNewMessage>[0]) => realEmitNewMessage.call(gateway, msg),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleSendMessage', () => {
    test('ack {success: false, error} saat chatService.send throw', async () => {
      mockSend.mockRejectedValue(new Error('Not your order'));

      const mockClient = { data: { userId }, join: jest.fn() };
      const r = await gateway.handleSendMessage(mockClient as Parameters<typeof gateway.handleSendMessage>[0], {
        id: 'msg-uuid', roomId: orderId, body: 'Halo',
      });

      expect(r.success).toBe(false);
      expect(r.error).toBe('Not your order');
    });

    test('ack {success: false, error: Not authenticated} bila userId kosong', async () => {
      const mockClient = { data: {}, join: jest.fn() };
      const r = await gateway.handleSendMessage(mockClient as Parameters<typeof gateway.handleSendMessage>[0], {
        id: 'msg-uuid', roomId: orderId, body: 'Halo',
      });

      expect(r.success).toBe(false);
      expect(r.error).toBe('Not authenticated');
      expect(mockSend).not.toHaveBeenCalled();
    });

    test('created true: emitNewMessage dipanggil, ack {success:true,message}', async () => {
      const sentMessage = {
        id: 'msg-uuid',
        roomId: orderId,
        senderId: userId,
        body: 'Halo',
        attachment: undefined,
        status: 'SENT',
        clientCreatedAt: new Date().toISOString(),
        serverCreatedAt: new Date().toISOString(),
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockSend.mockResolvedValue({ message: sentMessage, created: true });

      const mockClient = { data: { userId }, join: jest.fn() };
      const r = await gateway.handleSendMessage(mockClient as Parameters<typeof gateway.handleSendMessage>[0], {
        id: 'msg-uuid', roomId: orderId, body: 'Halo',
      });

      expect(r.success).toBe(true);
      expect(r.message).toBe(sentMessage);
      expect(emitNewMessageSpy).toHaveBeenCalledTimes(1);
      expect(emitNewMessageSpy).toHaveBeenCalledWith(sentMessage);
      // Verifikasi server.to(roomId).emit('new_message', message) dipanggil
      expect(toMock).toHaveBeenCalledWith(orderId);
      expect(emitMock).toHaveBeenCalledTimes(1);
      expect(emitMock).toHaveBeenCalledWith('new_message', sentMessage);
    });

    test('created false: emitNewMessage tidak dipanggil, ack {success:true,message}', async () => {
      const existingMessage = {
        id: 'msg-uuid',
        roomId: orderId,
        senderId: userId,
        body: 'Halo',
        attachment: undefined,
        status: 'SENT',
        clientCreatedAt: new Date().toISOString(),
        serverCreatedAt: new Date().toISOString(),
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockSend.mockResolvedValue({ message: existingMessage, created: false });

      const mockClient = { data: { userId }, join: jest.fn() };
      const r = await gateway.handleSendMessage(mockClient as Parameters<typeof gateway.handleSendMessage>[0], {
        id: 'msg-uuid', roomId: orderId, body: 'Halo',
      });

      expect(r.success).toBe(true);
      expect(r.message).toBe(existingMessage);
      expect(emitNewMessageSpy).not.toHaveBeenCalled();
      // created=false: emit tidak dipanggil
      expect(toMock).not.toHaveBeenCalled();
      expect(emitMock).not.toHaveBeenCalled();
    });
  });
});
