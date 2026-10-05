/**
 * Unit tests untuk ChatService.send()
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { ChatService } from './chat.service';

describe('ChatService.send()', () => {
  let service: ChatService;
  let prisma: { order: { findUnique: jest.Mock }; chatMessage: { create: jest.Mock; findUnique: jest.Mock } };

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
        findUnique: jest.fn(),
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

      expect(result.created).toBe(true);
      expect(result.message.senderId).toBe(customerId);
      expect(result.message.roomId).toBe(orderId);
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

      expect(result.created).toBe(true);
      expect(result.message.senderId).toBe(driverId);
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
      expect(prisma.chatMessage.create).not.toHaveBeenCalled();
    });

    test('gagal ketika order tidak ditemukan (roomId invalid)', async () => {
      (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.send(chatInput, customerId)).rejects.toThrow(ForbiddenException);
      await expect(service.send(chatInput, customerId)).rejects.toThrow('Order not found');
      expect(prisma.chatMessage.create).not.toHaveBeenCalled();
    });
  });

  describe('idempotency', () => {
    test('send dengan id sudah ada milik pengirim lain: Forbidden, baris tidak berubah', async () => {
      const mockOrder = {
        id: orderId,
        customerId,
        driverId,
      };
      const existingRow = {
        id: 'existing-id',
        roomId: orderId,
        senderId: driverId,
        body: 'Pesan driver',
        attachmentJson: null,
        status: 'SENT',
        clientCreatedAt: new Date(),
        serverCreatedAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.chatMessage.findUnique as jest.Mock).mockResolvedValue(existingRow);

      const input = { ...chatInput, id: 'existing-id', roomId: orderId };
      await expect(service.send(input, customerId)).rejects.toThrow(ForbiddenException);
      await expect(service.send(input, customerId)).rejects.toThrow('Pesan ini bukan milik Anda di room ini');
      expect(prisma.chatMessage.create).not.toHaveBeenCalled();
    });

    test('send ulang id sendiri di room sama: created false, tidak ada create kedua', async () => {
      const mockOrder = {
        id: orderId,
        customerId,
        driverId,
      };
      const existingRow = {
        id: 'my-idempotent-id',
        roomId: orderId,
        senderId: customerId,
        body: 'Pesan pertama',
        attachmentJson: null,
        status: 'SENT',
        clientCreatedAt: new Date(),
        serverCreatedAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.chatMessage.findUnique as jest.Mock).mockResolvedValue(existingRow);

      const input = { ...chatInput, id: 'my-idempotent-id', roomId: orderId };
      const result = await service.send(input, customerId);

      expect(result.created).toBe(false);
      expect(result.message.id).toBe('my-idempotent-id');
      expect(result.message.body).toBe('Pesan pertama');
      expect(prisma.chatMessage.create).not.toHaveBeenCalled();
    });

    test('send ulang id sendiri di room berbeda: Forbidden', async () => {
      const mockOrderCustomer = { id: orderId, customerId, driverId };
      const otherOrderId = 'order-uuid-456';
      const mockOrderOther = { id: otherOrderId, customerId: 'other-customer', driverId };
      const existingRow = {
        id: 'my-id',
        roomId: orderId,
        senderId: customerId,
        body: 'Pesan di room A',
        attachmentJson: null,
        status: 'SENT',
        clientCreatedAt: new Date(),
        serverCreatedAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.order.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockOrderOther)
        .mockResolvedValueOnce(mockOrderCustomer);
      (prisma.chatMessage.findUnique as jest.Mock).mockResolvedValue(existingRow);

      const input = { ...chatInput, id: 'my-id', roomId: otherOrderId };
      await expect(service.send(input, customerId)).rejects.toThrow(ForbiddenException);
    });

    test('create lempar P2002 untuk id yang sudah ada: kalau baris milik pengirim sama, created false', async () => {
      const mockOrder = { id: orderId, customerId, driverId };
      const existingRow = {
        id: 'race-id',
        roomId: orderId,
        senderId: customerId,
        body: 'Pesan pertama',
        attachmentJson: null,
        status: 'SENT',
        clientCreatedAt: new Date(),
        serverCreatedAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique constraint', 'P2002', 'ChatMessage');

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.chatMessage.create as jest.Mock).mockRejectedValue(p2002Error);
      (prisma.chatMessage.findUnique as jest.Mock).mockResolvedValue(existingRow);

      const input = { ...chatInput, id: 'race-id', roomId: orderId };
      const result = await service.send(input, customerId);

      expect(result.created).toBe(false);
      expect(result.message.id).toBe('race-id');
      expect(result.message.body).toBe('Pesan pertama');
    });

    test('create lempar P2002 untuk id yang sudah ada: kalau baris milik pengirim lain, Forbidden', async () => {
      const mockOrder = { id: orderId, customerId, driverId };
      const existingRow = {
        id: 'race-id',
        roomId: orderId,
        senderId: driverId,
        body: 'Pesan driver',
        attachmentJson: null,
        status: 'SENT',
        clientCreatedAt: new Date(),
        serverCreatedAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const p2002Error = new Prisma.PrismaClientKnownRequestError('Unique constraint', 'P2002', 'ChatMessage');

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.chatMessage.create as jest.Mock).mockRejectedValue(p2002Error);
      (prisma.chatMessage.findUnique as jest.Mock).mockResolvedValue(existingRow);

      const input = { ...chatInput, id: 'race-id', roomId: orderId };
      await expect(service.send(input, customerId)).rejects.toThrow(ForbiddenException);
    });

    test('status SENT dan serverCreatedAt terisi', async () => {
      const mockOrder = { id: orderId, customerId, driverId };
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

      expect(result.created).toBe(true);
      expect(result.message.status).toBe('SENT');
      expect(result.message.serverCreatedAt).toBeDefined();
      expect(prisma.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'SENT' }) }),
      );
    });

    test('clientCreatedAt dari input dipakai bila valid; masa depan diganti waktu server', async () => {
      const mockOrder = { id: orderId, customerId, driverId };
      const now = new Date();
      const pastDate = new Date(now.getTime() - 60000);
      const futureDate = new Date(now.getTime() + 100000);

      (prisma.order.findUnique as jest.Mock).mockResolvedValue(mockOrder);
      (prisma.chatMessage.create as jest.Mock).mockImplementation(({ data }: { data: { clientCreatedAt: Date } }) =>
        Promise.resolve({
          id: 'new-id',
          roomId: orderId,
          senderId: customerId,
          body: chatInput.body,
          attachmentJson: null,
          status: 'SENT',
          clientCreatedAt: data.clientCreatedAt,
          serverCreatedAt: now,
          version: 1,
          createdAt: now,
          updatedAt: now,
        }),
      );

      const inputPast = { ...chatInput, clientCreatedAt: pastDate.toISOString() };
      const resultPast = await service.send(inputPast, customerId);
      expect(resultPast.created).toBe(true);
      expect(new Date(resultPast.message.clientCreatedAt).getTime()).toBeCloseTo(pastDate.getTime(), -3);

      const inputFuture = { ...chatInput, clientCreatedAt: futureDate.toISOString() };
      const resultFuture = await service.send(inputFuture, customerId);
      expect(resultFuture.created).toBe(true);
      expect(new Date(resultFuture.message.clientCreatedAt).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });
});
