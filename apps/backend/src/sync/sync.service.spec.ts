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
            user: {
              updateMany: jest.fn(),
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
      data: {
        ...makeRecord().data,
        status: 'ASSIGNED', // valid transition CONFIRMED -> ASSIGNED
      },
    });

    // Row di DB masih versi 3
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: record.id,
      customerId: 'customer-uuid',
      driverId: null,
      status: 'CONFIRMED', // initial state
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
      createdAt: new Date(),
      orderId: 'order-uuid',
      method: 'CASH',
      status: 'PENDING',
      amountCents: 50000,
      currency: 'IDR',
      kind: 'PAYMENT',
      externalRef: null,
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
    // serverData should be included for ack-id mismatch recovery (Tier 4)
    expect(ack.serverData).toBeDefined();
    expect(ack.serverData).toMatchObject({
      idempotencyKey: 'idem-key-123',
    });
  });
});

describe('applyOne — order update validation', () => {
  let service: SyncService;
  let prisma: PrismaClient;

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
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
    prisma = module.get(PrismaClient);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('accepts valid transition PREPARING -> OUT_FOR_DELIVERY', async () => {
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
    (prisma.order.upsert as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      version: 6,
      updatedAt: new Date(),
    });

    const record = makeOrderRecord({ data: { ...makeOrderRecord().data, status: 'OUT_FOR_DELIVERY' } });
    const ack = await service.applyOne(record.entityType, record);

    expect(ack.status).toBe('accepted');
    expect(ack.serverVersion).toBe(6);
    expect(prisma.order.upsert).toHaveBeenCalled();
  });

  it('rejects invalid transition DELIVERED -> CANCELLED (terminal state)', async () => {
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
      version: 6,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const record = makeOrderRecord({ baseVersion: 6, data: { ...makeOrderRecord().data, status: 'CANCELLED' } });
    const ack = await service.applyOne(record.entityType, record);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toContain('Tidak bisa mengubah status');
    expect(ack.serverVersion).toBe(6); // harus return versi server
  });

  it('rejects invalid transition CANCELLED -> any state (terminal state)', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      customerId: 'customer-uuid',
      driverId: null,
      status: 'CANCELLED',
      itemsJson: [],
      addressJson: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // CANCELLED -> PREPARING: Rule 1 allows *->PREPARING, Rule 3 catches with accept-specific reason
    const record = makeOrderRecord({ baseVersion: 3, data: { ...makeOrderRecord().data, status: 'PREPARING' } });
    const ack = await service.applyOne(record.entityType, record);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toBe('Order sudah tidak tersedia untuk di-accept');
  });

  it('rejects when driverId request differs from server.driverId (ownership invalid)', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      customerId: 'customer-uuid',
      driverId: 'bob', // server punya bob
      status: 'OUT_FOR_DELIVERY',
      itemsJson: [],
      addressJson: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // driver 'me' mencoba push cancel
    const record = makeOrderRecord({
      data: { ...makeOrderRecord().data, driverId: 'me', status: 'CANCELLED' },
    });
    const ack = await service.applyOne(record.entityType, record);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toContain('reassign');
    expect(ack.serverVersion).toBe(5);
  });

  it('allows when server.driverId is null (reassignment to me is valid)', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      customerId: 'customer-uuid',
      driverId: null, // order tidak punya driver
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
      id: 'order-validate-uuid',
      version: 4,
      updatedAt: new Date(),
    });

    // driver 'me' assign dirinya ke order
    const record = makeOrderRecord({
      baseVersion: 3,
      data: { ...makeOrderRecord().data, driverId: 'me', status: 'ASSIGNED' },
    });
    const ack = await service.applyOne(record.entityType, record);

    expect(ack.status).toBe('accepted');
    expect(prisma.order.upsert).toHaveBeenCalled();
  });

  it('create op bypasses validation (defensive)', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.order.upsert as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      version: 1,
      updatedAt: new Date(),
    });

    const record = makeOrderRecord({ op: 'create', baseVersion: null });
    const ack = await service.applyOne(record.entityType, record);

    expect(ack.status).toBe('accepted');
    expect(ack.serverVersion).toBe(1);
    expect(prisma.order.upsert).toHaveBeenCalled();
  });

  it('rejects valid transition but ownership mismatch — ownership check is priority', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      customerId: 'customer-uuid',
      driverId: 'bob',
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

    // Transition PREPARING -> OUT_FOR_DELIVERY valid, tapi driverId mismatch
    const record = makeOrderRecord({
      data: { ...makeOrderRecord().data, driverId: 'me', status: 'OUT_FOR_DELIVERY' },
    });
    const ack = await service.applyOne(record.entityType, record);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toContain('reassign');
  });

  // ===== Rule 3: accept-specific reason =====

  it('Rule 3: push accept untuk order CANCELLED → reject dengan reason spesifik', async () => {
    // Server order CANCELLED, driver coba push accept (PREPARING, driverId=me)
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      customerId: 'customer-uuid',
      driverId: null, // order di pool (null)
      status: 'CANCELLED',
      itemsJson: [],
      addressJson: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const record = makeOrderRecord({
      baseVersion: 3,
      data: { ...makeOrderRecord().data, status: 'PREPARING', driverId: 'me' },
    });
    const ack = await service.applyOne(record.entityType, record);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toBe('Order sudah tidak tersedia untuk di-accept');
    expect(ack.serverVersion).toBe(3);
    expect(prisma.order.upsert).not.toHaveBeenCalled();
  });

  it('Rule 3: push accept untuk order DELIVERED → reject dengan reason spesifik', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      customerId: 'customer-uuid',
      driverId: null,
      status: 'DELIVERED',
      itemsJson: [],
      addressJson: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const record = makeOrderRecord({
      baseVersion: 10,
      data: { ...makeOrderRecord().data, status: 'PREPARING', driverId: 'me' },
    });
    const ack = await service.applyOne(record.entityType, record);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toBe('Order sudah tidak tersedia untuk di-accept');
    expect(ack.serverVersion).toBe(10);
    expect(prisma.order.upsert).not.toHaveBeenCalled();
  });

  it('Rule 3: push accept untuk order ASSIGNED → accept (Rule 3 pass, Rule 1 juga lolos)', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      customerId: 'customer-uuid',
      driverId: null, // order di pool
      status: 'ASSIGNED',
      itemsJson: [],
      addressJson: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    (prisma.order.upsert as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      version: 6,
      updatedAt: new Date(),
    });

    // Driver push: PREPARING, driverId=me
    const record = makeOrderRecord({
      baseVersion: 5,
      data: { ...makeOrderRecord().data, status: 'PREPARING', driverId: 'me' },
    });
    const ack = await service.applyOne(record.entityType, record);

    // ACCEPTED: server.ASSIGNED -> client.PREPARING valid (ASSIGNED->PREPARING allowed)
    // server.driverId=null -> Rule 3 condition met, currentStatus=ASSIGNED matches -> pass
    expect(ack.status).toBe('accepted');
    expect(ack.serverVersion).toBe(6);
    expect(prisma.order.upsert).toHaveBeenCalled();
  });

  it('Rule 3: push accept untuk order yang driverId sudah terisi driver lain → Rule 2 menang', async () => {
    // Server: order PREPARING, driverId=bob
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      customerId: 'customer-uuid',
      driverId: 'bob', // sudah ada driver
      status: 'PREPARING',
      itemsJson: [],
      addressJson: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version: 6,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Driver 'me' coba push accept
    const record = makeOrderRecord({
      baseVersion: 6,
      data: { ...makeOrderRecord().data, status: 'PREPARING', driverId: 'me' },
    });
    const ack = await service.applyOne(record.entityType, record);

    // DITOLAK oleh Rule 2 (ownership mismatch), BUKAN Rule 3
    // Reason harus dari Rule 2, bukan Rule 3
    expect(ack.status).toBe('rejected');
    expect(ack.reason).toBe('Order sudah di-reassign ke driver lain');
    expect(ack.serverVersion).toBe(6);
    expect(prisma.order.upsert).not.toHaveBeenCalled();
  });

  // ===== Regression: bypass Rule 1 HANYA untuk accept flow, bukan semua PREPARING =====

  it('Rule 1 regression: push PREPARING tanpa driverId dari CANCELLED → ditolak Rule 1', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      customerId: 'customer-uuid',
      driverId: null,
      status: 'CANCELLED',
      itemsJson: [],
      addressJson: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version: 3,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Push PREPARING TANPA driverId — bukan accept flow
    const record = makeOrderRecord({
      baseVersion: 3,
      data: { ...makeOrderRecord().data, status: 'PREPARING', driverId: undefined },
    });
    const ack = await service.applyOne(record.entityType, record);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toContain('Tidak bisa mengubah status');
    expect(ack.reason).toContain('CANCELLED');
    expect(ack.reason).toContain('PREPARING');
    expect(prisma.order.upsert).not.toHaveBeenCalled();
  });

  it('Rule 1 regression: push PREPARING tanpa driverId dari PENDING → ditolak Rule 1', async () => {
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({
      id: 'order-validate-uuid',
      customerId: 'customer-uuid',
      driverId: null,
      status: 'PENDING',
      itemsJson: [],
      addressJson: { recipientName: 'Test', phone: '0812', street: 'Jl Test', city: 'Jakarta', postalCode: '12345' },
      totalCents: 50000,
      currency: 'IDR',
      notes: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Push PREPARING TANPA driverId — bukan accept flow
    const record = makeOrderRecord({
      baseVersion: 1,
      data: { ...makeOrderRecord().data, status: 'PREPARING', driverId: undefined },
    });
    const ack = await service.applyOne(record.entityType, record);

    expect(ack.status).toBe('rejected');
    expect(ack.reason).toContain('Tidak bisa mengubah status');
    expect(ack.reason).toContain('PENDING');
    expect(ack.reason).toContain('PREPARING');
    expect(prisma.order.upsert).not.toHaveBeenCalled();
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
});
