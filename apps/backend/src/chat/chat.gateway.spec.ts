/**
 * Unit tests untuk ChatGateway
 *
 * FIeld test untuk handleSendMessage menggunakan pendekatan DI mock NestJS.
 * Perilaku emitNewMessage (created=true) diuji di chat.controller.spec.ts
 * karena ChatController memanggil ChatGateway.emitNewMessage secara langsung.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { JwtService } from '@nestjs/jwt';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let mockSend: jest.Mock;

  const orderId = 'order-uuid-123';
  const userId = 'user-uuid';

  beforeEach(async () => {
    mockSend = jest.fn();
    const mockChatService = { send: mockSend };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        { provide: ChatService, useValue: mockChatService },
        { provide: JwtService, useValue: { verify: jest.fn() } },
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);
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
  });
});
