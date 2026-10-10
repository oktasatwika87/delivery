/**
 * Unit tests untuk ChatController
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: jest.Mocked<ChatService>;
  let chatGateway: jest.Mocked<ChatGateway>;

  const orderId = 'order-uuid-123';
  const userId = 'user-uuid';

  beforeEach(async () => {
    const mockChatService = {
      send: jest.fn(),
      listByRoom: jest.fn(),
      validateRoomAccess: jest.fn(),
    };
    const mockChatGateway = {
      emitNewMessage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        { provide: ChatService, useValue: mockChatService },
        { provide: ChatGateway, useValue: mockChatGateway },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
    chatService = module.get(ChatService);
    chatGateway = module.get(ChatGateway);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /chat/messages', () => {
    test('memanggil emitNewMessage sekali saat created true', async () => {
      const message = {
        id: 'msg-uuid',
        roomId: orderId,
        senderId: userId,
        body: 'Halo',
        status: 'SENT' as const,
        clientCreatedAt: new Date().toISOString(),
        serverCreatedAt: new Date().toISOString(),
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      chatService.send.mockResolvedValue({ message, created: true });

      const result = await controller.send(
        { roomId: orderId, body: 'Halo' },
        userId,
      );

      expect(result).toBe(message);
      expect(chatService.send).toHaveBeenCalledWith(
        { roomId: orderId, body: 'Halo' },
        userId,
      );
      expect(chatGateway.emitNewMessage).toHaveBeenCalledTimes(1);
      expect(chatGateway.emitNewMessage).toHaveBeenCalledWith(message);
    });

    test('tidak memanggil emitNewMessage saat created false', async () => {
      const existingMessage = {
        id: 'existing-uuid',
        roomId: orderId,
        senderId: userId,
        body: 'Pesan lama',
        status: 'SENT' as const,
        clientCreatedAt: new Date().toISOString(),
        serverCreatedAt: new Date().toISOString(),
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      chatService.send.mockResolvedValue({ message: existingMessage, created: false });

      const result = await controller.send(
        { id: 'existing-uuid', roomId: orderId, body: 'Pesan lama' },
        userId,
      );

      expect(result).toBe(existingMessage);
      expect(chatGateway.emitNewMessage).not.toHaveBeenCalled();
    });
  });

  describe('GET /chat/rooms/:roomId/messages', () => {
    test('memanggil listByRoom setelah validateRoomAccess berhasil', async () => {
      const messages = [
        {
          id: 'msg-uuid',
          roomId: orderId,
          senderId: userId,
          body: 'Halo',
          status: 'SENT' as const,
          clientCreatedAt: new Date().toISOString(),
          serverCreatedAt: new Date().toISOString(),
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      chatService.validateRoomAccess.mockResolvedValue(undefined);
      chatService.listByRoom.mockResolvedValue(messages);

      const result = await controller.list(orderId, userId);

      expect(result).toBe(messages);
      expect(chatService.validateRoomAccess).toHaveBeenCalledWith(orderId, userId);
      expect(chatService.listByRoom).toHaveBeenCalledWith(orderId);
    });

    test('melemparkan ForbiddenException dan tidak memanggil listByRoom bila bukan peserta', async () => {
      chatService.validateRoomAccess.mockRejectedValue(
        new ForbiddenException('Order ini bukan milik Anda'),
      );

      await expect(controller.list(orderId, userId)).rejects.toThrow(ForbiddenException);
      expect(chatService.listByRoom).not.toHaveBeenCalled();
    });
  });
});
