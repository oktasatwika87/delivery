import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { SyncService } from './sync.service';
import { ChatService } from '../chat/chat.service';
import { ChatGateway } from '../chat/chat.gateway';

describe('SyncService.applyOne', () => {
  let service: SyncService;
  let prisma: PrismaClient;
  let chatService: ChatService;
  let chatGateway: ChatGateway;

  // User IDs
  const userId = 'customer-uuid';

  // Helper buat bikin record push
  const makeRecord = (overrides: Partial<Parameters<typeof SyncService.prototype.applyOne>[1]> = {}) => ({
    entityType: 'order' as const,
    id: 'test-order-uuid',
    data: {
      id: 'test-order-uuid',
      customerId: 'customer-uuid',
      driverId: undefined,
      status: 'PENDING',
      items: [],
      deliveryAddress: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: undefined,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    op: 'create' as const,
    clientChangedAt: new Date().toISOString(),
    baseVersion: null,
    ...overrides,
  });

  beforeEach(async () => {
    const mockPrisma = {
      order: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      payment: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      chatMessage: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      user: {
        updateMany: jest.fn(),
      },
    };

    const mockChatService = {
      send: jest.fn(),
    };

    const mockChatGateway = {
      emitNewMessage: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: PrismaClient, useValue: mockPrisma },
        { provide: ChatService, useValue: mockChatService },
        { provide: ChatGateway, useValue: mockChatGateway },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
    prisma = module.get(PrismaClient);
    chatService = module.get(ChatService);
    chatGateway = module.get(ChatGateway);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Order sync: semua push ditolak

  it('should reject order create via sync', async () => {
    const record = makeRecord();

    // Row belum ada di DB
    (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.order.upsert as jest.Mock).mockResolvedValue({
      id: record.id,
      version: 1,
      updatedAt: new Date(),
    });

    const ack = await service.applyOne(record.entityType, record, userId);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toBe('Order hanya bisa diubah lewat endpoint order');
    expect(prisma.order.upsert).not.toHaveBeenCalled();
  });

  // Update dengan baseVersion cocok: tetap ditolak

  it('should reject order update via sync when baseVersion matches', async () => {
    const record = makeRecord({
      op: 'update',
      baseVersion: 3,
      data: {
        ...makeRecord().data,
        status: 'ASSIGNED',
      },
    });

    // Row di DB masih versi 3
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: record.id,
      customerId: 'customer-uuid',
      driverId: null,
      status: 'CONFIRMED',
      itemsJson: [],
      addressJson: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (prisma.order.upsert as jest.Mock).mockResolvedValue({
      id: record.id,
      version: 4,
      updatedAt: new Date(),
    });

    const ack = await service.applyOne(record.entityType, record, userId);

    // Order update via sync ditolak walaupun versi cocok.
    expect(ack.status).toBe('rejected');
    expect(ack.reason).toBe('Order hanya bisa diubah lewat endpoint order');
    expect(ack.serverVersion).toBe(3);
    expect(prisma.order.upsert).not.toHaveBeenCalled();
  });

  it('should return conflict when baseVersion does not match', async () => {
    const record = makeRecord({
      op: 'update',
      baseVersion: 3, // client thinks versi 3, tapi...
    });

    // Row di DB sudah versi 4 (lebih baru dari client)
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: record.id,
      customerId: 'customer-uuid',
      driverId: null,
      status: 'CONFIRMED',
      itemsJson: [],
      addressJson: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 60000,
      currency: 'IDR',
      notes: null,
      version: 4, // SERVER LEBIH BARU
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const ack = await service.applyOne(record.entityType, record, userId);

    expect(ack.status).toBe('conflict');
    expect(ack.serverVersion).toBe(4);
    expect(ack.serverData).toBeDefined();
    expect(ack.reason).toContain('Version mismatch');
    expect(prisma.order.upsert).not.toHaveBeenCalled();
  });

  // Conflict ack membawa cancelledBy/cancelReason

  it('should include cancelledBy and cancelReason in ack.serverData on conflict', async () => {
    // Server punya order dengan data batal dari cron - saat conflict, data ini
    // harus ikut di serverData supaya client yang menarik row ini bisa melihat
    // alasan pembatalan lama.
    const record = makeRecord({
      op: 'update',
      baseVersion: 2,
    });

    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: record.id,
      customerId: 'customer-uuid',
      driverId: null,
      status: 'PENDING',
      itemsJson: [],
      addressJson: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      cancelledBy: 'SYSTEM',
      cancelReason: 'system_timeout',
      version: 3, // SERVER LEBIH BARU
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const ack = await service.applyOne(record.entityType, record, userId);

    expect(ack.status).toBe('conflict');
    expect(ack.serverData).toBeDefined();
    expect(ack.serverData?.cancelledBy).toBe('SYSTEM');
    expect(ack.serverData?.cancelReason).toBe('system_timeout');
  });

  it('should return conflict when updating a soft-deleted record with stale baseVersion', async () => {
    // Client mencoba update record yang sudah di-delete oleh proses lain
    const record = makeRecord({
      op: 'update',
      baseVersion: 2,
    });

    // Row di DB sudah di-delete (version naik ke 3)
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: record.id,
      customerId: 'customer-uuid',
      driverId: null,
      status: 'CANCELLED',
      itemsJson: [],
      addressJson: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      deletedAt: new Date(),
      version: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const ack = await service.applyOne(record.entityType, record, userId);

    expect(ack.status).toBe('conflict');
    expect(ack.serverVersion).toBe(3);
    expect(ack.serverData).toBeDefined();
    expect(ack.reason).toContain('Version mismatch');
    expect(prisma.order.upsert).not.toHaveBeenCalled();
  });

  // Payment OCC: Update dengan baseVersion cocok

  it('should reject payment update via sync when baseVersion matches', async () => {
    const paymentRecord = {
      entityType: 'payment' as const,
      id: 'payment-uuid',
      data: {
        id: 'payment-uuid',
        orderId: 'order-uuid',
        idempotencyKey: 'idem-key-456',
        method: 'CASH',
        status: 'CAPTURED',
        amountCents: 50000,
        currency: 'IDR',
        kind: 'PAYMENT',
        externalRef: undefined,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      op: 'update' as const,
      clientChangedAt: new Date().toISOString(),
      baseVersion: 2,
    };

    (prisma.payment.findUnique as jest.Mock).mockResolvedValue({
      id: 'payment-uuid',
      orderId: 'order-uuid',
      idempotencyKey: 'idem-key-456',
      method: 'CASH',
      status: 'PENDING',
      amountCents: 50000,
      currency: 'IDR',
      kind: 'PAYMENT',
      externalRef: null,
      version: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (prisma.payment.upsert as jest.Mock).mockResolvedValue({
      id: 'payment-uuid',
      version: 3,
      updatedAt: new Date(),
    });

    const ack = await service.applyOne('payment', paymentRecord, userId);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toBe('Pembayaran hanya bisa diubah lewat endpoint pembayaran');
    expect(ack.serverVersion).toBe(2);
    expect(prisma.payment.upsert).not.toHaveBeenCalled();
  });

  it('should return conflict when updating payment with stale baseVersion', async () => {
    const paymentRecord = {
      entityType: 'payment' as const,
      id: 'payment-uuid',
      data: {
        id: 'payment-uuid',
        orderId: 'order-uuid',
        idempotencyKey: 'idem-key-456',
        method: 'CASH',
        status: 'CAPTURED',
        amountCents: 50000,
        currency: 'IDR',
        kind: 'PAYMENT',
        externalRef: undefined,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      op: 'update' as const,
      clientChangedAt: new Date().toISOString(),
      baseVersion: 2, // client thinks versi 2, tapi...
    };

    // Row di DB sudah versi 5 (server lebih baru)
    (prisma.payment.findUnique as jest.Mock).mockResolvedValue({
      id: 'payment-uuid',
      orderId: 'order-uuid',
      idempotencyKey: 'idem-key-456',
      method: 'CARD',
      status: 'REFUNDED',
      amountCents: 50000,
      currency: 'IDR',
      kind: 'REFUND',
      externalRef: 'ref-123',
      version: 5, // SERVER LEBIH BARU
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const ack = await service.applyOne('payment', paymentRecord, userId);

    expect(ack.status).toBe('conflict');
    expect(ack.serverVersion).toBe(5);
    expect(ack.serverData).toBeDefined();
    expect(ack.reason).toContain('Version mismatch');
    expect(prisma.payment.upsert).not.toHaveBeenCalled();
  });

  // Payment create ditolak langsung tanpa menyentuh DB

  it('should reject payment create via sync', async () => {
    const paymentRecord = {
      entityType: 'payment' as const,
      id: 'new-payment-id',
      data: {
        id: 'new-payment-id',
        orderId: 'order-uuid',
        idempotencyKey: 'idem-key-new',
        method: 'CASH',
        status: 'PENDING',
        amountCents: 50000,
        currency: 'IDR',
        kind: 'PAYMENT',
        externalRef: undefined,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      op: 'create' as const,
      clientChangedAt: new Date().toISOString(),
      baseVersion: null,
    };

    const ack = await service.applyOne('payment', paymentRecord, userId);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toBe('Pembayaran hanya bisa diubah lewat endpoint pembayaran');
    expect(prisma.payment.findUnique).not.toHaveBeenCalled();
    expect(prisma.payment.upsert).not.toHaveBeenCalled();
  });

  // Payment delete tetap ditolak

  it('should reject payment delete with matching baseVersion', async () => {
    const paymentRecord = {
      entityType: 'payment' as const,
      id: 'payment-uuid',
      data: {
        id: 'payment-uuid',
        orderId: 'order-uuid',
        idempotencyKey: 'idem-key-456',
        method: 'CASH',
        status: 'PENDING',
        amountCents: 50000,
        currency: 'IDR',
        kind: 'PAYMENT',
        externalRef: undefined,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      op: 'delete' as const,
      clientChangedAt: new Date().toISOString(),
      baseVersion: 2,
    };

    (prisma.payment.findUnique as jest.Mock).mockResolvedValue({
      id: 'payment-uuid',
      orderId: 'order-uuid',
      idempotencyKey: 'idem-key-456',
      method: 'CASH',
      status: 'PENDING',
      amountCents: 50000,
      currency: 'IDR',
      kind: 'PAYMENT',
      externalRef: null,
      version: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const ack = await service.applyOne('payment', paymentRecord, userId);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toBe('Pembayaran hanya bisa diubah lewat endpoint pembayaran');
    expect(ack.serverVersion).toBe(2);
    expect(prisma.payment.update).not.toHaveBeenCalled();
  });

  // ============ entityType tak dikenal: nack 'rejected' ============

  it('should reject unknown entityType with "Tipe data tidak dikenal"', async () => {
    const record = {
      entityType: 'inventory_item' as const,
      id: 'unknown-uuid',
      data: { id: 'unknown-uuid', name: 'Test' } as any,
      op: 'create' as const,
      clientChangedAt: new Date().toISOString(),
      baseVersion: null,
    };

    const ack = await service.applyOne(record.entityType, record, userId);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toBe('Tipe data tidak dikenal');
  });
});

// chat_message sync push dengan validasi akses

describe('SyncService.applyOne chat_message', () => {
  let service: SyncService;
  let prisma: PrismaClient;
  let chatService: ChatService;
  let chatGateway: ChatGateway;

  const userId = 'customer-uuid';
  const orderId = 'order-uuid-123';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        {
          provide: PrismaClient,
          useValue: {
            order: { findUnique: jest.fn() },
            payment: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
            chatMessage: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
            user: { updateMany: jest.fn() },
          },
        },
        { provide: ChatService, useValue: { send: jest.fn() } },
        { provide: ChatGateway, useValue: { emitNewMessage: jest.fn() } },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
    prisma = module.get(PrismaClient);
    chatService = module.get(ChatService);
    chatGateway = module.get(ChatGateway);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    test('push create oleh bukan peserta room: rejected', async () => {
      const chatRecord = {
        entityType: 'chat_message' as const,
        id: 'new-chat-uuid',
        data: {
          id: 'new-chat-uuid',
          roomId: orderId,
          senderId: 'other-person',
          body: 'Halo',
          attachment: undefined,
          status: 'SENT' as const,
          clientCreatedAt: new Date().toISOString(),
          serverCreatedAt: undefined,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        op: 'create' as const,
        clientChangedAt: new Date().toISOString(),
        baseVersion: null,
      };

      chatService.send.mockImplementation(() =>
        Promise.reject(new ForbiddenException('Order tidak ditemukan')),
      );

      const ack = await service.applyOne('chat_message', chatRecord, userId);

      expect(ack.status).toBe('rejected');
      expect(ack.reason).toBe('Pesan ditolak: bukan peserta chat order ini atau id pesan sudah dipakai');
      expect(chatGateway.emitNewMessage).not.toHaveBeenCalled();
    });

    test('push create dengan data.senderId orang lain: tersimpan dengan senderId = userId login', async () => {
      const chatRecord = {
        entityType: 'chat_message' as const,
        id: 'chat-uuid',
        data: {
          id: 'chat-uuid',
          roomId: orderId,
          senderId: 'attacker-id',
          body: 'Halo',
          attachment: undefined,
          status: 'PENDING_SEND' as const,
          clientCreatedAt: new Date().toISOString(),
          serverCreatedAt: undefined,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        op: 'create' as const,
        clientChangedAt: new Date().toISOString(),
        baseVersion: null,
      };

      const serverMessage = {
        id: 'chat-uuid',
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

      chatService.send.mockResolvedValue({ message: serverMessage, created: true });

      const ack = await service.applyOne('chat_message', chatRecord, userId);

      expect(ack.status).toBe('accepted');
      expect(chatService.send).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'chat-uuid', roomId: orderId, body: 'Halo' }),
        userId,
      );
      expect(chatGateway.emitNewMessage).toHaveBeenCalledTimes(1);
    });

    test('push create dengan status PENDING_SEND dan serverCreatedAt null: tersimpan SENT dan serverCreatedAt terisi', async () => {
      const chatRecord = {
        entityType: 'chat_message' as const,
        id: 'chat-uuid',
        data: {
          id: 'chat-uuid',
          roomId: orderId,
          senderId: userId,
          body: 'Pesan offline',
          attachment: undefined,
          status: 'PENDING_SEND' as const, // dari klien
          clientCreatedAt: new Date().toISOString(),
          serverCreatedAt: undefined, // null di klien
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        op: 'create' as const,
        clientChangedAt: new Date().toISOString(),
        baseVersion: null,
      };

      const serverMessage = {
        id: 'chat-uuid',
        roomId: orderId,
        senderId: userId,
        body: 'Pesan offline',
        attachment: undefined,
        status: 'SENT', // server ubah jadi SENT
        clientCreatedAt: new Date().toISOString(),
        serverCreatedAt: new Date().toISOString(), // server isi
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      chatService.send.mockResolvedValue({ message: serverMessage, created: true });

      const ack = await service.applyOne('chat_message', chatRecord, userId);

      expect(ack.status).toBe('accepted');
      expect(chatService.send).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'chat-uuid' }),
        userId,
      );
    });

    test('push create id sudah ada milik orang lain: rejected, baris tidak berubah', async () => {
      const chatRecord = {
        entityType: 'chat_message' as const,
        id: 'existing-id',
        data: {
          id: 'existing-id',
          roomId: orderId,
          senderId: 'attacker',
          body: 'Ganti ini',
          attachment: undefined,
          status: 'SENT' as const,
          clientCreatedAt: new Date().toISOString(),
          serverCreatedAt: undefined,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        op: 'create' as const,
        clientChangedAt: new Date().toISOString(),
        baseVersion: null,
      };

      chatService.send.mockImplementation(() =>
        Promise.reject(new ForbiddenException('Pesan ditolak: bukan peserta chat order ini atau id pesan sudah dipakai')),
      );

      const ack = await service.applyOne('chat_message', chatRecord, userId);

      expect(ack.status).toBe('rejected');
      expect(ack.reason).toBe('Pesan ditolak: bukan peserta chat order ini atau id pesan sudah dipakai');
      expect(chatGateway.emitNewMessage).not.toHaveBeenCalled();
    });

    test('push create ulang id sendiri: accepted, emit tidak dipanggil lagi', async () => {
      const chatRecord = {
        entityType: 'chat_message' as const,
        id: 'my-idempotent-id',
        data: {
          id: 'my-idempotent-id',
          roomId: orderId,
          senderId: userId,
          body: 'Pesan saya',
          attachment: undefined,
          status: 'SENT' as const,
          clientCreatedAt: new Date().toISOString(),
          serverCreatedAt: new Date().toISOString(),
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        op: 'create' as const,
        clientChangedAt: new Date().toISOString(),
        baseVersion: null,
      };

      const existingMessage = {
        id: 'my-idempotent-id',
        roomId: orderId,
        senderId: userId,
        body: 'Pesan pertama',
        attachment: undefined,
        status: 'SENT',
        clientCreatedAt: new Date().toISOString(),
        serverCreatedAt: new Date().toISOString(),
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      chatService.send.mockResolvedValue({ message: existingMessage, created: false });

      const ack = await service.applyOne('chat_message', chatRecord, userId);

      expect(ack.status).toBe('accepted');
      expect(chatGateway.emitNewMessage).not.toHaveBeenCalled();
    });

    test('push create pesan baru: emitNewMessage dipanggil tepat sekali', async () => {
      const chatRecord = {
        entityType: 'chat_message' as const,
        id: 'brand-new-uuid',
        data: {
          id: 'brand-new-uuid',
          roomId: orderId,
          senderId: userId,
          body: 'Pesan baru',
          attachment: undefined,
          status: 'SENT' as const,
          clientCreatedAt: new Date().toISOString(),
          serverCreatedAt: undefined,
          version: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        op: 'create' as const,
        clientChangedAt: new Date().toISOString(),
        baseVersion: null,
      };

      const newMessage = {
        id: 'brand-new-uuid',
        roomId: orderId,
        senderId: userId,
        body: 'Pesan baru',
        attachment: undefined,
        status: 'SENT',
        clientCreatedAt: new Date().toISOString(),
        serverCreatedAt: new Date().toISOString(),
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      chatService.send.mockResolvedValue({ message: newMessage, created: true });

      const ack = await service.applyOne('chat_message', chatRecord, userId);

      expect(ack.status).toBe('accepted');
      expect(chatGateway.emitNewMessage).toHaveBeenCalledTimes(1);
      expect(chatGateway.emitNewMessage).toHaveBeenCalledWith(newMessage);
    });
  });

  describe('update', () => {
    test('update pesan orang lain dengan versi cocok: rejected, baris tidak berubah', async () => {
      const chatRecord = {
        entityType: 'chat_message' as const,
        id: 'chat-uuid',
        data: {
          id: 'chat-uuid',
          roomId: orderId,
          senderId: userId,
          body: 'Edit dia',
          attachment: undefined,
          status: 'SENT' as const,
          clientCreatedAt: new Date().toISOString(),
          serverCreatedAt: new Date().toISOString(),
          version: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        op: 'update' as const,
        clientChangedAt: new Date().toISOString(),
        baseVersion: 1,
      };

      // Row di DB punya senderId berbeda
      (prisma.chatMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'chat-uuid',
        roomId: orderId,
        senderId: 'other-user', // BUKAN userId
        body: 'Pesan dia',
        attachmentJson: null,
        status: 'SENT',
        clientCreatedAt: new Date(),
        serverCreatedAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const ack = await service.applyOne('chat_message', chatRecord, userId);

      expect(ack.status).toBe('rejected');
      expect(ack.reason).toBe('Pesan ini bukan milik Anda');
      expect(prisma.chatMessage.update).not.toHaveBeenCalled();
    });

    test('update versi basi: tetap conflict + serverData', async () => {
      const chatRecord = {
        entityType: 'chat_message' as const,
        id: 'chat-uuid',
        data: {
          id: 'chat-uuid',
          roomId: orderId,
          senderId: userId,
          body: 'Edit',
          attachment: undefined,
          status: 'SENT' as const,
          clientCreatedAt: new Date().toISOString(),
          serverCreatedAt: new Date().toISOString(),
          version: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        op: 'update' as const,
        clientChangedAt: new Date().toISOString(),
        baseVersion: 1, // basi
      };

      (prisma.chatMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'chat-uuid',
        roomId: orderId,
        senderId: userId,
        body: 'Pesan dia',
        attachmentJson: null,
        status: 'SENT',
        clientCreatedAt: new Date(),
        serverCreatedAt: new Date(),
        version: 3, // server lebih baru
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const ack = await service.applyOne('chat_message', chatRecord, userId);

      expect(ack.status).toBe('conflict');
      expect(ack.serverVersion).toBe(3);
      expect(ack.serverData).toBeDefined();
      expect(prisma.chatMessage.update).not.toHaveBeenCalled();
    });

    test('update pesan sendiri versi cocok: accepted, status dari klien diabaikan', async () => {
      const chatRecord = {
        entityType: 'chat_message' as const,
        id: 'chat-uuid',
        data: {
          id: 'chat-uuid',
          roomId: orderId,
          senderId: userId,
          body: 'Body baru',
          attachment: { kind: 'image' as const, url: 'http://img.new' },
          status: 'DELIVERED' as const, // klien kirim ini, tapi harus diabaikan
          clientCreatedAt: new Date().toISOString(),
          serverCreatedAt: new Date().toISOString(),
          version: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        op: 'update' as const,
        clientChangedAt: new Date().toISOString(),
        baseVersion: 1,
      };

      (prisma.chatMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'chat-uuid',
        roomId: orderId,
        senderId: userId,
        body: 'Body lama',
        attachmentJson: null,
        status: 'SENT',
        clientCreatedAt: new Date(),
        serverCreatedAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      (prisma.chatMessage.update as jest.Mock).mockResolvedValue({
        id: 'chat-uuid',
        roomId: orderId,
        senderId: userId,
        body: 'Body baru',
        attachmentJson: { kind: 'image', url: 'http://img.new' },
        status: 'SENT', // server KEEP old status, tidak pakai DELIVERED
        clientCreatedAt: new Date(),
        serverCreatedAt: new Date(),
        version: 2,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const ack = await service.applyOne('chat_message', chatRecord, userId);

      expect(ack.status).toBe('accepted');
      expect(ack.serverVersion).toBe(2);
      // status dari klien (DELIVERED) tidak dipakai; hanya body & attachment
      expect(prisma.chatMessage.update).toHaveBeenCalledWith({
        where: { id: 'chat-uuid' },
        data: expect.objectContaining({
          body: 'Body baru',
          attachmentJson: { kind: 'image', url: 'http://img.new' },
        }),
      });
    });
  });

  describe('delete', () => {
    test('delete pesan orang lain dengan versi cocok: rejected, baris tidak berubah', async () => {
      const chatRecord = {
        entityType: 'chat_message' as const,
        id: 'chat-uuid',
        data: {
          id: 'chat-uuid',
          roomId: orderId,
          senderId: userId,
          body: '',
          attachment: undefined,
          status: 'SENT' as const,
          clientCreatedAt: new Date().toISOString(),
          serverCreatedAt: new Date().toISOString(),
          version: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        op: 'delete' as const,
        clientChangedAt: new Date().toISOString(),
        baseVersion: 1,
      };

      (prisma.chatMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'chat-uuid',
        roomId: orderId,
        senderId: 'other-user',
        body: 'Pesan dia',
        attachmentJson: null,
        status: 'SENT',
        clientCreatedAt: new Date(),
        serverCreatedAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const ack = await service.applyOne('chat_message', chatRecord, userId);

      expect(ack.status).toBe('rejected');
      expect(ack.reason).toBe('Pesan ini bukan milik Anda');
      expect(prisma.chatMessage.update).not.toHaveBeenCalled();
    });

    test('delete pesan sendiri versi cocok: accepted, deletedAt terisi', async () => {
      const chatRecord = {
        entityType: 'chat_message' as const,
        id: 'my-chat-uuid',
        data: {
          id: 'my-chat-uuid',
          roomId: orderId,
          senderId: userId,
          body: '',
          attachment: undefined,
          status: 'SENT' as const,
          clientCreatedAt: new Date().toISOString(),
          serverCreatedAt: new Date().toISOString(),
          version: 2,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        op: 'delete' as const,
        clientChangedAt: new Date().toISOString(),
        baseVersion: 1,
      };

      (prisma.chatMessage.findUnique as jest.Mock).mockResolvedValue({
        id: 'my-chat-uuid',
        roomId: orderId,
        senderId: userId,
        body: 'Pesan saya',
        attachmentJson: null,
        status: 'SENT',
        clientCreatedAt: new Date(),
        serverCreatedAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      (prisma.chatMessage.update as jest.Mock).mockResolvedValue({
        id: 'my-chat-uuid',
        roomId: orderId,
        senderId: userId,
        body: 'Pesan saya',
        attachmentJson: null,
        status: 'SENT',
        clientCreatedAt: new Date(),
        serverCreatedAt: new Date(),
        version: 2,
        deletedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const ack = await service.applyOne('chat_message', chatRecord, userId);

      expect(ack.status).toBe('accepted');
      expect(ack.serverVersion).toBe(2);
      expect(prisma.chatMessage.update).toHaveBeenCalledWith({
        where: { id: 'my-chat-uuid' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      });
    });
  });
});

// Order push via sync SELALU ditolak. Untuk update/delete, OCC conflict
// masih didahulukan dari penolakan entity supaya mobile yang mengirim
// baseVersion basi tetap bisa pulih dengan data server.
describe('applyOne, order sync records (rejected)', () => {
  let service: SyncService;
  let prisma: PrismaClient;

  const userId = 'customer-uuid';

  // Helper untuk bikin order record dengan status tertentu
  const makeOrderRecord = (overrides: Partial<Parameters<typeof SyncService.prototype.applyOne>[1]> = {}) => ({
    entityType: 'order' as const,
    id: 'order-validate-uuid',
    data: {
      id: 'order-validate-uuid',
      customerId: 'customer-uuid',
      driverId: 'driver-uuid',
      status: 'PREPARING',
      items: [],
      deliveryAddress: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: undefined,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    op: 'update' as const,
    clientChangedAt: new Date().toISOString(),
    baseVersion: 5,
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        {
          provide: PrismaClient,
          useValue: {
            order: {
              findUnique: jest.fn(),
              upsert: jest.fn(),
              update: jest.fn(),
            },
            payment: {
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              upsert: jest.fn(),
              update: jest.fn(),
            },
            chatMessage: {
              findUnique: jest.fn(),
              upsert: jest.fn(),
              update: jest.fn(),
            },
            user: {
              updateMany: jest.fn(),
            },
          },
        },
        { provide: ChatService, useValue: { send: jest.fn() } },
        { provide: ChatGateway, useValue: { emitNewMessage: jest.fn() } },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
    prisma = module.get(PrismaClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Order update lewat sync SELALU ditolak, tanpa melihat status
  // transisi, ownership, atau Rule 1/2/3B apapun.

  it('rejects order update with matching baseVersion (regardless of transition)', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      customerId: 'customer-uuid',
      driverId: 'driver-uuid',
      status: 'PREPARING',
      itemsJson: [],
      addressJson: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const record = makeOrderRecord({ baseVersion: 5, data: { ...makeOrderRecord().data, status: 'OUT_FOR_DELIVERY' } });
    const ack = await service.applyOne(record.entityType, record, userId);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toBe('Order hanya bisa diubah lewat endpoint order');
    expect(ack.serverVersion).toBe(5);
    expect(prisma.order.upsert).not.toHaveBeenCalled();
  });

  // OCC conflict HARUS didahulukan dari penolakan entity. Client yang
  // mengirim baseVersion basi untuk order update harus mendapat 'conflict'
  // + serverData supaya bisa pulih. Kalau kita letakkan penolakan entity
  // sebelum OCC, mobile tidak akan pernah bisa reconciliation.

  it('returns conflict for order update with stale baseVersion (OCC fires first)', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      customerId: 'customer-uuid',
      driverId: 'driver-uuid',
      status: 'OUT_FOR_DELIVERY',
      itemsJson: [],
      addressJson: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version: 7,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // baseVersion stale: client kirim 5, server sudah 7
    const record = makeOrderRecord({ baseVersion: 5 });
    const ack = await service.applyOne(record.entityType, record, userId);

    expect(ack.status).toBe('conflict');
    expect(ack.serverVersion).toBe(7);
    expect(ack.serverData).toBeDefined();
    expect(ack.reason).toContain('Version mismatch');
    expect(prisma.order.upsert).not.toHaveBeenCalled();
  });

  it('rejects order update when entity not found (existing behavior preserved)', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);

    const record = makeOrderRecord({ baseVersion: 1 });
    const ack = await service.applyOne(record.entityType, record, userId);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toContain('not found');
    expect(prisma.order.upsert).not.toHaveBeenCalled();
  });

  it('rejects order create via sync (no OCC check)', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.order.upsert as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      version: 1,
      updatedAt: new Date(),
    });

    const record = makeOrderRecord({ op: 'create', baseVersion: null });
    const ack = await service.applyOne(record.entityType, record, userId);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toBe('Order hanya bisa diubah lewat endpoint order');
    expect(prisma.order.upsert).not.toHaveBeenCalled();
  });

  it('rejects order delete with matching baseVersion', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      customerId: 'customer-uuid',
      driverId: 'driver-uuid',
      status: 'PREPARING',
      itemsJson: [],
      addressJson: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const record = makeOrderRecord({ op: 'delete', baseVersion: 5 });
    const ack = await service.applyOne(record.entityType, record, userId);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toBe('Order hanya bisa diubah lewat endpoint order');
    expect(ack.serverVersion).toBe(5);
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('returns conflict for order delete with stale baseVersion', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      customerId: 'customer-uuid',
      driverId: 'driver-uuid',
      status: 'DELIVERED',
      itemsJson: [],
      addressJson: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version: 9,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const record = makeOrderRecord({ op: 'delete', baseVersion: 5 });
    const ack = await service.applyOne(record.entityType, record, userId);

    expect(ack.status).toBe('conflict');
    expect(ack.serverVersion).toBe(9);
    expect(ack.serverData).toBeDefined();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });
});

describe('SyncService.pullSince', () => {
  let service: SyncService;
  let prisma: PrismaClient;

  // User IDs
  const userA = 'user-a-uuid';
  const userB = 'user-b-uuid';

  // Full mock order objects (memiliki semua field yang dibutuhkan orderToDomain)
  const orderA = {
    id: 'order-a-uuid',
    customerId: userA,
    driverId: null,
    status: 'PENDING',
    itemsJson: [],
    addressJson: { recipientName: 'A', phone: '0812', street: 'Jl A', city: 'Jakarta', postalCode: '12345' },
    totalCents: 50000,
    currency: 'IDR',
    notes: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
  const orderB = {
    id: 'order-b-uuid',
    customerId: userB,
    driverId: null,
    status: 'PENDING',
    itemsJson: [],
    addressJson: { recipientName: 'B', phone: '0813', street: 'Jl B', city: 'Bandung', postalCode: '54321' },
    totalCents: 60000,
    currency: 'IDR',
    notes: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        {
          provide: PrismaClient,
          useValue: {
            order: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              upsert: jest.fn(),
              update: jest.fn(),
            },
            payment: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              upsert: jest.fn(),
              update: jest.fn(),
            },
            chatMessage: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              upsert: jest.fn(),
              update: jest.fn(),
            },
            syncCursor: {
              upsert: jest.fn(),
            },
            user: {
              updateMany: jest.fn(),
            },
          },
        },
        { provide: ChatService, useValue: { send: jest.fn() } },
        { provide: ChatGateway, useValue: { emitNewMessage: jest.fn() } },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
    prisma = module.get(PrismaClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('user isolation', () => {
    test('user A tidak bisa pull order user B yang tidak melibatkan dirinya', async () => {
      // user A punya order A, user B punya order B
      (prisma.order.findMany as jest.Mock)
        // Pertama query untuk dapat userOrderIds (orders di mana A adalah customer/driver)
        .mockResolvedValueOnce([orderA])
        // Kedua query untuk pull data dengan filter ownership
        .mockResolvedValueOnce([orderA]);
      (prisma.payment.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prisma.chatMessage.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.pullSince('device-a', userA, null);

      // order B TIDAK boleh muncul
      const orderIds = result.records
        .filter((r) => r.entityType === 'order')
        .map((r) => r.id);
      expect(orderIds).toContain('order-a-uuid');
      expect(orderIds).not.toContain('order-b-uuid');
    });

    test('user A tidak bisa pull payment user B yang tidak melibatkan dirinya', async () => {
      const paymentA = {
        id: 'payment-a-uuid',
        orderId: 'order-a-uuid',
        idempotencyKey: 'idem-a',
        method: 'CASH',
        status: 'PENDING',
        amountCents: 50000,
        currency: 'IDR',
        kind: 'PAYMENT',
        externalRef: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const paymentB = {
        id: 'payment-b-uuid',
        orderId: 'order-b-uuid',
        idempotencyKey: 'idem-b',
        method: 'CASH',
        status: 'PENDING',
        amountCents: 60000,
        currency: 'IDR',
        kind: 'PAYMENT',
        externalRef: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // user A punya payment A (terkait order A)
      (prisma.order.findMany as jest.Mock)
        .mockResolvedValueOnce([orderA])
        .mockResolvedValueOnce([orderA]);
      (prisma.payment.findMany as jest.Mock).mockResolvedValueOnce([paymentA]);
      (prisma.chatMessage.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.pullSince('device-a', userA, null);

      // payment B TIDAK boleh muncul
      const paymentIds = result.records
        .filter((r) => r.entityType === 'payment')
        .map((r) => r.id);
      expect(paymentIds).toContain('payment-a-uuid');
      expect(paymentIds).not.toContain('payment-b-uuid');
    });

    test('user A tidak bisa pull chat yang roomId-nya bukan order miliknya', async () => {
      const chatA = {
        id: 'chat-a-uuid',
        roomId: 'order-a-uuid',
        senderId: userA,
        body: 'Halo dari A',
        attachmentJson: null,
        status: 'SENT',
        clientCreatedAt: new Date(),
        serverCreatedAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const chatB = {
        id: 'chat-b-uuid',
        roomId: 'order-b-uuid',
        senderId: userB,
        body: 'Halo dari B',
        attachmentJson: null,
        status: 'SENT',
        clientCreatedAt: new Date(),
        serverCreatedAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prisma.order.findMany as jest.Mock)
        .mockResolvedValueOnce([orderA])
        .mockResolvedValueOnce([orderA]);
      (prisma.payment.findMany as jest.Mock).mockResolvedValueOnce([]);
      // chat A terkait order A (milik user A), chat B terkait order B (milik user B)
      (prisma.chatMessage.findMany as jest.Mock).mockResolvedValueOnce([chatA]);

      const result = await service.pullSince('device-a', userA, null);

      // chat B TIDAK boleh muncul
      const chatIds = result.records
        .filter((r) => r.entityType === 'chat_message')
        .map((r) => r.id);
      expect(chatIds).toContain('chat-a-uuid');
      expect(chatIds).not.toContain('chat-b-uuid');
    });
  });

  describe('cancelledBy/cancelReason propagation (Temuan 14)', () => {
    test('pullSince membawa cancelledBy & cancelReason untuk order yang punya nilai', async () => {
      // Order dengan data pembatalan lama (mis. dari cron reassign). Saat
      // customer melakukan pull, kedua field ini harus ikut agar OrderTrackingScreen
      // bisa menampilkan alasan batal yang sebenarnya (OrderTrackingScreen
      // menampilkan text dari cancelReason, lihat syncCancelledOrder handler).
      const orderWithCancel = {
        id: 'order-cancelled-uuid',
        customerId: userA,
        driverId: null,
        status: 'ASSIGNED',
        itemsJson: [],
        addressJson: { recipientName: 'A', phone: '0812', street: 'Jl A', city: 'Jakarta', postalCode: '12345' },
        totalCents: 50000,
        currency: 'IDR',
        notes: null,
        cancelledBy: 'SYSTEM',
        cancelReason: 'system_timeout',
        version: 4,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      };

      (prisma.order.findMany as jest.Mock)
        .mockResolvedValueOnce([orderWithCancel])
        .mockResolvedValueOnce([orderWithCancel]);
      (prisma.payment.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prisma.chatMessage.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.pullSince('device-a', userA, null);

      const orderRecords = result.records.filter((r) => r.entityType === 'order');
      expect(orderRecords).toHaveLength(1);
      const orderData = orderRecords[0].data;
      expect(orderData.cancelledBy).toBe('SYSTEM');
      expect(orderData.cancelReason).toBe('system_timeout');
    });

    test('pullSince: order tanpa cancelledBy/cancelReason tidak memunculkan field', async () => {
      // Order normal (belum pernah di-cancel) tidak boleh memunculkan cancelledBy/cancelReason
      (prisma.order.findMany as jest.Mock)
        .mockResolvedValueOnce([orderA])
        .mockResolvedValueOnce([orderA]);
      (prisma.payment.findMany as jest.Mock).mockResolvedValueOnce([]);
      (prisma.chatMessage.findMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.pullSince('device-a', userA, null);

      const orderRecords = result.records.filter((r) => r.entityType === 'order');
      expect(orderRecords).toHaveLength(1);
      const orderData = orderRecords[0].data;
      expect(orderData.cancelledBy).toBeUndefined();
      expect(orderData.cancelReason).toBeUndefined();
    });
  });
});
