/**
 * Unit tests untuk ChatService.send()
 *
 * 2 skenario:
 * 1. send() berhasil ketika user adalah customer/driver dari order terkait
 * 2. send() gagal dengan ForbiddenException ketika user tidak terlibat di order itu
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { ChatService } from './chat.service';

describe('ChatService.send()', () => {
  let service: ChatService;
  let prisma: { order: { findUnique: jest.Mock }; chatMessage: { create: jest.Mock } };

  // Test data
  const orderId = 'order-uuid-123';
  const customerId = 'customer-uuid';
  const driverId = 'driver-uuid';
  const outsiderId = 'outsider-uuid';

  const chatInput = {
    roomId: orderId,
    body: 'Halo, pesanan sudah sampai',
    attachment: undefined,
  };

  beforeEach(async () => {
    const mockPrisma = {
      order: {
        findUnique: jest.fn(),
      },
      chatMessage: {
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: PrismaClient,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    prisma = module.get(PrismaClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('authorization', () => {
    test('berhasil ketika user adalah customer dari order', async () => {
      const mockOrder = {
        id: orderId,
        customerId,
        driverId: null,
      };
      const mockCreated = {
        id: 'chat-new-uuid',
        roomId: orderId,
        senderId: customerId,
        body: chatInput.body,
        attachmentJson: null,
        status: 'SENT',
        clientCreatedAt: new Date(),
        serverCreatedAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.chatMessage.create as jest.Mock).mockResolvedValue(mockCreated);

      const result = await service.send(chatInput, customerId);

      expect(result).toBeDefined();
      expect(result.senderId).toBe(customerId);
      expect(result.roomId).toBe(orderId);
      expect(prisma.order.findUnique).toHaveBeenCalledWith({
        where: { id: orderId },
        select: { id: true, customerId: true, driverId: true },
      });
      expect(prisma.chatMessage.create).toHaveBeenCalled();
    });

    test('berhasil ketika user adalah driver dari order', async () => {
      const mockOrder = {
        id: orderId,
        customerId,
        driverId,
      };
      const mockCreated = {
        id: 'chat-new-uuid',
        roomId: orderId,
        senderId: driverId,
        body: chatInput.body,
        attachmentJson: null,
        status: 'SENT',
        clientCreatedAt: new Date(),
        serverCreatedAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.chatMessage.create as jest.Mock).mockResolvedValue(mockCreated);

      const result = await service.send(chatInput, driverId);

      expect(result).toBeDefined();
      expect(result.senderId).toBe(driverId);
      expect(prisma.chatMessage.create).toHaveBeenCalled();
    });

    test('gagal ketika user tidak terlibat di order (outsider)', async () => {
      const mockOrder = {
        id: orderId,
        customerId,
        driverId,
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);

      await expect(service.send(chatInput, outsiderId)).rejects.toThrow(ForbiddenException);
      await expect(service.send(chatInput, outsiderId)).rejects.toThrow('Not your order');
      // Create TIDAK boleh dipanggil untuk outsider
      expect(prisma.chatMessage.create).not.toHaveBeenCalled();
    });

    test('gagal ketika order tidak ditemukan (roomId invalid)', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.send(chatInput, customerId)).rejects.toThrow(ForbiddenException);
      await expect(service.send(chatInput, customerId)).rejects.toThrow('Order not found');
      // Create TIDAK boleh dipanggil untuk order tidak ditemukan
      expect(prisma.chatMessage.create).not.toHaveBeenCalled();
    });
  });
});
