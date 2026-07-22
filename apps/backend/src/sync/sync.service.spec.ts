import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';

import { SyncService } from './sync.service';

describe('SyncService.applyOne', () => {
  let service: SyncService;
  let prisma: PrismaClient;

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
          },
        },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
    prisma = module.get(PrismaClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============ Scenario 1: Insert record baru ============

  it('should insert new record and return version 1', async () => {
    const record = makeRecord();

    // Row belum ada di DB
    (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.order.upsert as jest.Mock).mockResolvedValue({
      id: record.id,
      version: 1,
      updatedAt: new Date(),
    });

    const ack = await service.applyOne(record.entityType, record);

    expect(ack.status).toBe('accepted');
    expect(ack.serverVersion).toBe(1);
    expect(prisma.order.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: record.id }, create: expect.objectContaining({ version: 1 }) }),
    );
  });

  // ============ Scenario 2: Update dengan baseVersion yang cocok ============

  it('should update record when baseVersion matches', async () => {
    const record = makeRecord({
      op: 'update',
      baseVersion: 3, // client punya versi 3
    });

    // Row di DB masih versi 3
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: record.id,
      version: 3,
      updatedAt: new Date(),
    });
    (prisma.order.upsert as jest.Mock).mockResolvedValue({
      id: record.id,
      version: 4, // versi naik setelah update
      updatedAt: new Date(),
    });

    const ack = await service.applyOne(record.entityType, record);

    expect(ack.status).toBe('accepted');
    expect(ack.serverVersion).toBe(4);
    expect(prisma.order.upsert).toHaveBeenCalled(); // upsert dipanggil untuk update
  });

  // ============ Scenario 3: Update dengan baseVersion tidak cocok (CONFLICT) ============

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

    const ack = await service.applyOne(record.entityType, record);

    expect(ack.status).toBe('conflict');
    expect(ack.serverVersion).toBe(4); // return versi server
    expect(ack.serverData).toBeDefined(); // wajib ada data server terbaru
    expect(ack.reason).toContain('Version mismatch');
    // upsert TIDAK boleh dipanggil
    expect(prisma.order.upsert).not.toHaveBeenCalled();
  });

  // ============ Scenario 4: Update setelah record di-delete (version sudah naik) ============

  it('should return conflict when updating a soft-deleted record with stale baseVersion', async () => {
    // Client mencoba update record yang sudah di-delete oleh proses lain
    const record = makeRecord({
      op: 'update',
      baseVersion: 2, // client thinks versi 2, tapi...
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
      deletedAt: new Date(), // record sudah di-delete
      version: 3, // VERSION SUDAH NAIK karena soft delete increment
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const ack = await service.applyOne(record.entityType, record);

    expect(ack.status).toBe('conflict');
    expect(ack.serverVersion).toBe(3);
    expect(ack.serverData).toBeDefined();
    expect(ack.reason).toContain('Version mismatch');
    // upsert TIDAK boleh dipanggil
    expect(prisma.order.upsert).not.toHaveBeenCalled();
  });

  // ============ Payment OCC: Update dengan baseVersion cocok ============

  it('should update payment record when baseVersion matches', async () => {
    const paymentRecord = {
      entityType: 'payment' as const,
      id: 'payment-uuid',
      data: {
        id: 'payment-uuid',
        orderId: 'order-uuid',
        idempotencyKey: 'idem-key-456',
        method: 'CASH',
        status: 'CAPTURED', // client mau update status
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
      baseVersion: 2, // client punya versi 2
    };

    // Row di DB masih versi 2
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
      version: 2, // server masih versi 2
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (prisma.payment.upsert as jest.Mock).mockResolvedValue({
      id: 'payment-uuid',
      version: 3, // versi naik setelah update
      updatedAt: new Date(),
    });

    const ack = await service.applyOne('payment', paymentRecord);

    expect(ack.status).toBe('accepted');
    expect(ack.serverVersion).toBe(3);
    expect(prisma.payment.upsert).toHaveBeenCalled();
  });

  // ============ Payment OCC: Update dengan baseVersion stale (CONFLICT) ============

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

    const ack = await service.applyOne('payment', paymentRecord);

    expect(ack.status).toBe('conflict');
    expect(ack.serverVersion).toBe(5);
    expect(ack.serverData).toBeDefined();
    expect(ack.reason).toContain('Version mismatch');
    // upsert TIDAK boleh dipanggil
    expect(prisma.payment.upsert).not.toHaveBeenCalled();
  });

  // ============ Bonus: Idempotency check untuk payment ============

  it('should skip duplicate payment with same idempotencyKey', async () => {
    const existingPayment = {
      id: 'existing-payment-id',
      idempotencyKey: 'idem-key-123',
      version: 2,
      updatedAt: new Date(),
    };

    const paymentRecord = {
      entityType: 'payment' as const,
      id: 'new-payment-id',
      data: {
        id: 'new-payment-id',
        orderId: 'order-uuid',
        idempotencyKey: 'idem-key-123', // sama dengan yang sudah ada
        method: 'CASH',
        status: 'PENDING',
        amountCents: 50000,
        currency: 'IDR',
        kind: 'PAYMENT',
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      op: 'create' as const,
      clientChangedAt: new Date().toISOString(),
      baseVersion: null,
    };

    (prisma.payment.findUnique as jest.Mock).mockResolvedValue(existingPayment);

    const ack = await service.applyOne('payment', paymentRecord);

    expect(ack.status).toBe('accepted');
    expect(ack.serverVersion).toBe(2); // return versi record lama
    // upsert TIDAK boleh dipanggil karena sudah ada
    expect(prisma.payment.upsert).not.toHaveBeenCalled();
  });
});
