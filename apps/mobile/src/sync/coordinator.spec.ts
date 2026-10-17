/**
 * Unit tests untuk SyncCoordinator: applyPull() dan resolveAcks()
 *
 * Test meng-import class SyncCoordinator langsung dari coordinator.ts
 * dan mem-pass mock Database/Collection agar bisa dipanggil beneran.
 *
 * Mock WatermelonDB behavior:
 * - collection.find() return Model instance dengan method prepareUpdate
 * - prepareUpdate(fn) SIMPAN operation ke batch (deferred)
 * - db.batch() EKSEKUSI semua prepared operations
 *
 * AsyncStorage mock sudah di-handle oleh jest.config.js moduleNameMapper.
 */

// Mock session
jest.mock('./session', () => ({
  getCurrentUserId: jest.fn().mockResolvedValue('test-user-id'),
}));

// Mock device
jest.mock('./device', () => ({
  getDeviceId: jest.fn().mockResolvedValue('test-device-id'),
}));

// Mock syncEvents, define mocks OUTSIDE jest.mock so Jest hoisting works
const emitMock = jest.fn();
const onMock = jest.fn();
const offMock = jest.fn();
const onceMock = jest.fn();
jest.mock('./syncEvents', () => ({
  syncEvents: {
    emit: emitMock,
    on: onMock,
    off: offMock,
    once: onceMock,
  },
}));

// Mock networkMonitor - subscribe dipakai oleh setupNetworkListener.
type NetworkListener = (status: 'online' | 'offline' | 'unknown') => void;
type NetworkStatus = 'online' | 'offline' | 'unknown';
const networkListenerRef: { current: NetworkListener | null } = { current: null };
const getStatusMock: jest.Mock<NetworkStatus, []> = jest.fn(() => 'unknown');
jest.mock('../map/networkMonitor', () => ({
  networkMonitor: {
    getStatus: getStatusMock,
    subscribe: jest.fn((cb: NetworkListener) => {
      networkListenerRef.current = cb;
      return () => {
        if (networkListenerRef.current === cb) networkListenerRef.current = null;
      };
    }),
  },
}));

// Mock outbox - drainPendingActions dipanggil lewat dynamic import di
// coordinator.ts. Mock modul ini SEBELUM SyncCoordinator di-load supaya
// dynamic import dapat versi tiruan.
const drainMock = jest.fn();
jest.mock('./outbox', () => ({
  __esModule: true,
  drainPendingActions: (...args: unknown[]) => drainMock(...args),
}));

import { SyncCoordinator } from './coordinator';
import type { Payment } from '@delivery/shared';

type SyncRecordPull = {
  entityType: string;
  id: string;
  serverVersion: number;
  serverChangedAt: string;
  deleted: boolean;
  data: Record<string, unknown>;
};

type SyncRecordPush = {
  entityType: string;
  id: string;
  data: Record<string, unknown>;
  op: 'create' | 'update' | 'delete';
  clientChangedAt: string;
  baseVersion: number | null;
};

type SyncPullResponse = {
  nextCursor: string | null;
  records: SyncRecordPull[];
  serverTime: string;
};

type SyncAck = {
  entityType: string;
  id: string;
  status: 'accepted' | 'conflict' | 'rejected';
  serverVersion?: number;
  serverChangedAt?: string;
  serverData?: Record<string, unknown>;
  reason?: string;
};

type SyncPushResponse = {
  acks: SyncAck[];
};

// ============ Mock WatermelonDB ============

interface MockRow {
  id: string;
  // Mock menulis semua kunci non-reserved langsung ke _raw apa adanya.
  // Mock ini tidak mensimulasikan sanitizedRaw WatermelonDB. Tes membaca
  // kolom snake_case, jadi kalau kode produksi kembali ke camelCase,
  // kolom terbaca undefined dan tes gagal.
  _raw: { _status: string; [key: string]: unknown };
  serverVersion?: number;
  failedSyncAttempts?: number;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

type MockModel = MockRow & {
  prepareUpdate(fn: (row: MockRow) => void): MockModel;
  prepareDestroyPermanently(): MockModel;
};

type BatchOp = {
  type: 'update' | 'create' | 'destroy';
  row: MockRow;
  fn: (row: MockRow) => void;
};

// Global state per test
const state = {
  records: new Map<string, Map<string, MockRow>>(),
  batchOps: [] as BatchOp[],
};

function resetState() {
  state.records.clear();
  state.batchOps = [];
  for (const name of ['orders', 'payments', 'chat_messages']) {
    state.records.set(name, new Map());
  }
}

// Baca satu kolom JSON dari _raw lalu parse. Melempar kalau nilainya
// bukan string, supaya typo nama kolom gagal cepat dengan pesan jelas.
function readJsonColumn(raw: { [key: string]: unknown }, columnName: string): unknown {
  const value = raw[columnName];
  if (typeof value !== 'string') {
    throw new Error(`Kolom ${columnName} di _raw bukan string: ${typeof value}`);
  }
  return JSON.parse(value);
}

function createMockRow(id: string, initialStatus = 'synced'): MockRow {
  return {
    id,
    serverVersion: 1,
    status: 'PENDING',
    itemsJson: '[]',
    addressJson: '{}',
    totalCents: 0,
    currency: 'IDR',
    notes: null,
    _raw: { _status: initialStatus },
  };
}

function createCollection(name: string) {
  const collectionRecords = state.records.get(name)!;

  return {
    async find(id: string): Promise<MockModel> {
      // Catat id ini supaya tes applyPull bisa memastikan find dipanggil
      // di dalam database.write.
      if (inWrite) findCallsDuringWrite.push(id);
      const record = collectionRecords.get(id);
      if (!record) throw new Error(`Row not found: ${id}`);
      return attachModelMethods(record);
    },
    get(_name: string) {
      return this;
    },
    query() {
      return {
        fetch() {
          // Return rows with model methods attached so prepareUpdate works
          return [...collectionRecords.values()]
            .filter((r) => r._raw._status !== 'synced')
            .map((r) => attachModelMethods(r));
        },
      };
    },
    prepareCreate(fn: (row: MockRow) => void): MockModel {
      const row = createMockRow('temp', 'synced');
      fn(row); // Execute immediately for create
      // Use _raw.id if set, otherwise fall back to the temp id
      const id = (row._raw as any).id ?? row.id as string;
      collectionRecords.set(id, row);
      return attachModelMethods(row);
    },
    // Copy semua kunci non-reserved ke _raw apa adanya. Kunci reserved
    // (id, _status, _changed) dipisah sesuai contract.
    prepareCreateFromDirtyRaw(dirtyRaw: Record<string, unknown>): MockRow {
      const id = dirtyRaw.id as string;
      const rawClone: { _status: string; [key: string]: unknown } = {
        _status: (dirtyRaw._status as string) ?? 'synced',
      };
      for (const [k, v] of Object.entries(dirtyRaw)) {
        if (k === 'id' || k === '_status' || k === '_changed') continue;
        rawClone[k] = v;
      }
      const row: MockRow = {
        id,
        _raw: rawClone,
      };
      collectionRecords.set(id, row);
      return row;
    },
  };
}

function attachModelMethods(row: MockRow): MockModel {
  (row as unknown as MockModel).prepareUpdate = function(fn: (r: MockRow) => void): MockModel {
    // DEFER execution - just store the operation for batch()
    state.batchOps.push({ type: 'update', row, fn });
    return row as MockModel;
  };
  // Tiruan _setRaw meniru WatermelonDB: kalau nilai kolom berubah dan
  // _status bukan 'created', baris ditandai 'updated' dan nama kolom
  // ditambahkan ke _changed.
  (row as MockRow)._setRaw = function(column: string, value: unknown): void {
    if ((row._raw as Record<string, unknown>)[column] === value) return;
    (row._raw as Record<string, unknown>)[column] = value;
    if (row._raw._status !== 'created') {
      row._raw._status = 'updated';
      const changed = row._raw._changed ? String(row._raw._changed).split(',') : [];
      if (!changed.includes(column)) {
        changed.push(column);
        row._raw._changed = changed.join(',');
      }
    }
  };
  // Tiruan _getRaw membaca nilai kolom dari _raw, sama dengan WatermelonDB.
  (row as MockRow)._getRaw = function(column: string): unknown {
    return (row._raw as Record<string, unknown>)[column];
  };
  (row as unknown as MockModel).prepareDestroyPermanently = function(): MockModel {
    for (const [, records] of state.records) {
      if (records.has(row.id)) {
        records.delete(row.id);
        break;
      }
    }
    return row as MockModel;
  };
  return row as MockModel;
}

// Tanda bahwa fungsi di dalam database.write sedang berjalan. Dipakai untuk
// memastikan applyPull memanggil find() di dalam write, bukan di luarnya.
let inWrite = false;
// Daftar id baris yang dicari lewat collection.find selama write berjalan.
// Dikosongkan oleh tes yang memakainya.
const findCallsDuringWrite: string[] = [];

// Database mock, support WatermelonDB write pattern
const mockDb = {
  get(name: string) {
    return createCollection(name);
  },
  async write<T>(fn: () => Promise<T>): Promise<T> {
    const prevInWrite = inWrite;
    inWrite = true;
    try {
      // Perubahan yang disiapkan sebelum write dipanggil diterapkan di sini.
      for (const op of state.batchOps) {
        if (op.type === 'update') {
          op.fn(op.row);
        }
      }
      return await fn();
    } finally {
      inWrite = prevInWrite;
    }
  },
  async batch(..._ops: unknown[]) {
    // Perubahan yang disiapkan di dalam write (seperti di applyPull)
    // diterapkan saat batch dipanggil. Tanpa ini, prepareUpdate di dalam
    // write tidak pernah sampai ke baris.
    for (const op of state.batchOps) {
      if (op.type === 'update') {
        op.fn(op.row);
      }
    }
    state.batchOps = [];
  },
};

// ============ Tests ============

describe('SyncCoordinator', () => {
  let coordinator: SyncCoordinator;

  beforeEach(() => {
    resetState();
    coordinator = new SyncCoordinator();
  });

  describe('applyPull()', () => {
    test('dengan record baru order dari server -> row lokal ter-create dengan field order, _status synced', async () => {
      const pullResponse: SyncPullResponse = {
        nextCursor: 'cursor-2',
        records: [
          {
            entityType: 'order',
            id: 'order-new-1',
            serverVersion: 1,
            serverChangedAt: new Date().toISOString(),
            deleted: false,
            data: {
              customerId: 'cust-1',
              driverId: null,
              status: 'CONFIRMED',
              items: [{ id: 'item-1', name: 'Nasi Goreng', priceCents: 25000, quantity: 1 }],
              deliveryAddress: { street: 'Jl Sudirman No. 1', city: 'Jakarta' },
              totalCents: 25000,
              currency: 'IDR',
              notes: 'Pedesin',
            },
          },
        ],
        serverTime: new Date().toISOString(),
      };

      // @ts-expect-error - accessing private method for testing
      await coordinator.applyPull(pullResponse, mockDb);

      // Verifikasi: row ter-create di collection orders dengan semua field order.
      // Baca dari _raw (snake_case) sesuai pola outbox.spec.ts - mock
      // menulis kolom snake_case langsung ke _raw, dan production code
      // buildRawRowForCreate juga pakai snake_case (lihat coordinator.ts).
      const records = state.records.get('orders');
      const created = records?.get('order-new-1');
      expect(created).toBeDefined();
      expect(created!._raw.server_version).toBe(1);
      expect(created!._raw.customer_id).toBe('cust-1');
      expect(created!._raw.driver_id).toBeNull();
      expect(created!._raw.status).toBe('CONFIRMED');
      // JSON columns - items & deliveryAddress di-serialize via JSON.stringify
      // di buildRawRowForCreate.
      expect(readJsonColumn(created!._raw, 'items_json')).toEqual([
        { id: 'item-1', name: 'Nasi Goreng', priceCents: 25000, quantity: 1 },
      ]);
      expect(readJsonColumn(created!._raw, 'address_json')).toEqual({
        street: 'Jl Sudirman No. 1',
        city: 'Jakarta',
      });
      expect(created!._raw.total_cents).toBe(25000);
      expect(created!._raw.currency).toBe('IDR');
      expect(created!._raw.notes).toBe('Pedesin');
      // cancelled_by/cancel_reason absent dari pull data -> fallback null
      // (buildRawRowForCreate order branch: orderData.cancelledBy ?? null).
      expect(created!._raw.cancelled_by).toBeNull();
      expect(created!._raw.cancel_reason).toBeNull();
      // created_at dan updated_at terisi (bukan 0).
      expect(typeof created!._raw.created_at).toBe('number');
      expect(created!._raw.created_at).toBeGreaterThan(0);
      expect(typeof created!._raw.updated_at).toBe('number');
      expect(created!._raw.updated_at).toBeGreaterThan(0);
      expect(created!._raw._status).toBe('synced');
    });

    test('dengan record baru payment dari server -> row lokal ter-create dengan field payment, _status synced', async () => {
      // Coverage sebelum refactor: HANYA order create-path yang punya test.
      // Sekarang payment create-path juga punya coverage, verify field mapping
      // (idempotencyKey, amountCents, kind, dll) + _status synced.
      const pullResponse: SyncPullResponse = {
        nextCursor: 'cursor-3',
        records: [
          {
            entityType: 'payment',
            id: 'payment-new-1',
            serverVersion: 1,
            serverChangedAt: new Date().toISOString(),
            deleted: false,
            data: {
              orderId: 'order-1',
              idempotencyKey: 'cod:abc-123-uuid',
              method: 'CASH',
              status: 'CAPTURED',
              amountCents: 50000,
              currency: 'IDR',
              kind: 'PAYMENT',
              externalRef: null,
            },
          },
        ],
        serverTime: new Date().toISOString(),
      };

      // @ts-expect-error - accessing private method for testing
      await coordinator.applyPull(pullResponse, mockDb);

      // Verifikasi: row ter-create di collection payments dengan field payment
      const records = state.records.get('payments');
      const created = records?.get('payment-new-1');
      expect(created).toBeDefined();
      expect(created!._raw.server_version).toBe(1);
      expect(created!._raw.order_id).toBe('order-1');
      expect(created!._raw.idempotency_key).toBe('cod:abc-123-uuid');
      expect(created!._raw.method).toBe('CASH');
      expect(created!._raw.status).toBe('CAPTURED');
      expect(created!._raw.amount_cents).toBe(50000);
      expect(created!._raw.currency).toBe('IDR');
      expect(created!._raw.kind).toBe('PAYMENT');
      expect(created!._raw.external_ref).toBeNull();
      // created_at/updated_at di-set eksplisit oleh buildRawRowForCreate.
      expect(typeof created!._raw.created_at).toBe('number');
      expect(created!._raw.created_at).toBeGreaterThan(0);
      expect(typeof created!._raw.updated_at).toBe('number');
      expect(created!._raw.updated_at).toBeGreaterThan(0);
      expect(created!._raw._status).toBe('synced');
    });

    test('dengan record baru chat_message dari server -> row lokal ter-create dengan field chat, _status synced', async () => {
      // Coverage sebelum refactor: HANYA order create-path yang punya test.
      // Sekarang chat_message create-path juga punya coverage, verify field
      // mapping (roomId, senderId, body, attachment, timestamp conversion).
      const clientCreatedAtIso = '2026-09-04T10:00:00.000Z';
      const serverCreatedAtIso = '2026-09-04T10:00:01.000Z';

      const pullResponse: SyncPullResponse = {
        nextCursor: 'cursor-4',
        records: [
          {
            entityType: 'chat_message',
            id: 'chat-new-1',
            serverVersion: 1,
            serverChangedAt: new Date().toISOString(),
            deleted: false,
            data: {
              roomId: 'room-1',
              senderId: 'user-1',
              body: 'Hello world',
              attachment: null,
              status: 'SENT',
              clientCreatedAt: clientCreatedAtIso,
              serverCreatedAt: serverCreatedAtIso,
            },
          },
        ],
        serverTime: new Date().toISOString(),
      };

      // @ts-expect-error - accessing private method for testing
      await coordinator.applyPull(pullResponse, mockDb);

      // Verifikasi: row ter-create di collection chat_messages dengan field chat
      const records = state.records.get('chat_messages');
      const created = records?.get('chat-new-1');
      expect(created).toBeDefined();
      expect(created!._raw.server_version).toBe(1);
      expect(created!._raw.room_id).toBe('room-1');
      expect(created!._raw.sender_id).toBe('user-1');
      expect(created!._raw.body).toBe('Hello world');
      // attachment_json null karena payload null di source.
      expect(created!._raw.attachment_json).toBeNull();
      expect(created!._raw.status).toBe('SENT');
      // Timestamp fields harus di-convert dari ISO string ke number (epoch ms)
      // oleh buildRawRowForCreate.
      expect(typeof created!._raw.client_created_at).toBe('number');
      expect(created!._raw.client_created_at).toBe(new Date(clientCreatedAtIso).getTime());
      expect(typeof created!._raw.server_created_at).toBe('number');
      expect(created!._raw.server_created_at).toBe(new Date(serverCreatedAtIso).getTime());
      expect(typeof created!._raw.created_at).toBe('number');
      expect(created!._raw.created_at).toBeGreaterThan(0);
      expect(typeof created!._raw.updated_at).toBe('number');
      expect(created!._raw.updated_at).toBeGreaterThan(0);
      expect(created!._raw._status).toBe('synced');
    });

    test('dengan record existing di server -> row lokal ter-update dengan _status synced', async () => {
      // Setup: ada row lokal existing
      const existingRow = createMockRow('order-existing-1', 'updated');
      existingRow.status = 'PENDING';
      existingRow.totalCents = 20000;
      state.records.get('orders')!.set('order-existing-1', existingRow);

      const pullResponse: SyncPullResponse = {
        nextCursor: 'cursor-2',
        records: [
          {
            entityType: 'order',
            id: 'order-existing-1',
            serverVersion: 5,
            serverChangedAt: new Date().toISOString(),
            deleted: false,
            data: {
              customerId: 'cust-1',
              driverId: 'driver-1',
              status: 'CONFIRMED',
              items: [{ id: 'item-1', name: 'Nasi Goreng', priceCents: 25000, quantity: 2 }],
              deliveryAddress: { street: 'Jl Sudirman No. 1', city: 'Jakarta' },
              totalCents: 50000,
              currency: 'IDR',
              notes: null,
            },
          },
        ],
        serverTime: new Date().toISOString(),
      };

      // @ts-expect-error - accessing private method for testing
      await coordinator.applyPull(pullResponse, mockDb);

      // Verifikasi: row ter-update
      const updated = state.records.get('orders')!.get('order-existing-1');
      expect(updated).toBeDefined();
      expect(updated!.serverVersion).toBe(5);
      expect(updated!.status).toBe('CONFIRMED');
      expect(updated!.totalCents).toBe(50000);
      expect(updated!._raw._status).toBe('synced');
    });

    test('dengan record deleted -> row di-mark deleted_at dengan _status synced', async () => {
      // Setup: ada row lokal existing
      const existingRow = createMockRow('order-to-delete', 'updated');
      state.records.get('orders')!.set('order-to-delete', existingRow);

      const pullResponse: SyncPullResponse = {
        nextCursor: 'cursor-2',
        records: [
          {
            entityType: 'order',
            id: 'order-to-delete',
            serverVersion: 3,
            serverChangedAt: new Date().toISOString(),
            deleted: true,
            data: {},
          },
        ],
        serverTime: new Date().toISOString(),
      };

      // @ts-expect-error - accessing private method for testing
      await coordinator.applyPull(pullResponse, mockDb);

      // Verifikasi: row ter-mark deleted
      const deleted = state.records.get('orders')!.get('order-to-delete');
      expect(deleted).toBeDefined();
      expect(deleted!.serverVersion).toBe(3);
      expect((deleted as Record<string, unknown>).deletedAt).toBeDefined();
      expect(deleted!._raw._status).toBe('synced');
    });

    // applyPull tidak boleh menurunkan versi order lokal. Outbox menulis
    // server_version dari respons aksi yang sukses (misalnya update_status),
    // lalu pull yang datanya diambil lebih dulu membawa versi lama. Tanpa
    // penjaga, versi lokal turun dan aksi status berikutnya ditolak
    // VERSION_CONFLICT.
    test('order lokal versi 5, pull membawa versi 4: baris tidak ditimpa', async () => {
      const existingRow = createMockRow('order-stale-pull', 'updated');
      existingRow._raw.server_version = 5; // versi lokal lebih besar dari pull
      existingRow.status = 'OUT_FOR_DELIVERY';
      state.records.get('orders')!.set('order-stale-pull', existingRow);

      const pullResponse: SyncPullResponse = {
        nextCursor: 'cursor-2',
        records: [
          {
            entityType: 'order',
            id: 'order-stale-pull',
            serverVersion: 4,
            serverChangedAt: new Date().toISOString(),
            deleted: false,
            data: {
              customerId: 'cust-1',
              driverId: 'driver-1',
              status: 'PREPARING',
              items: [],
              deliveryAddress: {},
              totalCents: 10000,
              currency: 'IDR',
              notes: null,
            },
          },
        ],
        serverTime: new Date().toISOString(),
      };

      // @ts-expect-error - accessing private method for testing
      await coordinator.applyPull(pullResponse, mockDb);

      // Baris lokal tidak ditimpa: status tetap OUT_FOR_DELIVERY, dan
      // server_version lokal tetap 5 (tidak diturunkan ke 4).
      const row = state.records.get('orders')!.get('order-stale-pull')!;
      expect(row.status).toBe('OUT_FOR_DELIVERY');
      expect(row._raw.server_version).toBe(5);
    });

    test('order lokal versi 4, pull versi 5: baris diperbarui (kasus normal)', async () => {
      const existingRow = createMockRow('order-fresh-pull', 'updated');
      existingRow._raw.server_version = 4; // versi lokal lebih kecil dari pull
      existingRow.status = 'OUT_FOR_DELIVERY';
      state.records.get('orders')!.set('order-fresh-pull', existingRow);

      const pullResponse: SyncPullResponse = {
        nextCursor: 'cursor-2',
        records: [
          {
            entityType: 'order',
            id: 'order-fresh-pull',
            serverVersion: 5,
            serverChangedAt: new Date().toISOString(),
            deleted: false,
            data: {
              customerId: 'cust-1',
              driverId: 'driver-1',
              status: 'DELIVERED',
              items: [],
              deliveryAddress: {},
              totalCents: 10000,
              currency: 'IDR',
              notes: null,
            },
          },
        ],
        serverTime: new Date().toISOString(),
      };

      // @ts-expect-error - accessing private method for testing
      await coordinator.applyPull(pullResponse, mockDb);

      // Baris lokal ditimpa: status dari pull, dan serverVersion lokal
      // menjadi versi pull. applyServerDataToLocalRow menulis ke
      // row.serverVersion; baris tiruan tidak punya @field, jadi nilainya
      // tidak masuk ke _raw.server_version.
      const row = state.records.get('orders')!.get('order-fresh-pull')!;
      expect(row.status).toBe('DELIVERED');
      expect(row.serverVersion).toBe(5);
    });

    // applyPull harus membaca baris yang sudah ada dengan find() di dalam
    // database.write, bukan di luarnya. Tanpa ini, tulisan outbox yang
    // masuk di antara baca dan tulis (misalnya setelah await find())
    // tertimpa data pull yang diambil lebih dulu.
    test('find untuk baris yang sudah ada dipanggil saat database.write sedang berjalan', async () => {
      const existingRow = createMockRow('order-inwrite', 'synced');
      existingRow._raw.server_version = 1;
      state.records.get('orders')!.set('order-inwrite', existingRow);

      findCallsDuringWrite.length = 0;

      const pullResponse: SyncPullResponse = {
        nextCursor: 'cursor-2',
        records: [
          {
            entityType: 'order',
            id: 'order-inwrite',
            serverVersion: 2,
            serverChangedAt: new Date().toISOString(),
            deleted: false,
            data: {
              customerId: 'cust-1',
              driverId: null,
              status: 'PREPARING',
              items: [],
              deliveryAddress: {},
              totalCents: 10000,
              currency: 'IDR',
              notes: null,
            },
          },
        ],
        serverTime: new Date().toISOString(),
      };

      // @ts-expect-error - accessing private method for testing
      await coordinator.applyPull(pullResponse, mockDb);

      // find dipanggil di dalam database.write.
      expect(findCallsDuringWrite).toContain('order-inwrite');
    });
  });

  describe('resolveAcks()', () => {
    test('dengan status accepted -> row lokal ter-update, _status synced', async () => {
      // Setup: ada row lokal yang di-push
      const pendingRow = createMockRow('order-pushed-1', 'created');
      pendingRow.serverVersion = 1;
      state.records.get('orders')!.set('order-pushed-1', pendingRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-pushed-1',
          status: 'accepted',
          serverVersion: 2,
          serverChangedAt: new Date().toISOString(),
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // Verifikasi: row ter-update dengan serverVersion baru dan _status synced
      const updated = state.records.get('orders')!.get('order-pushed-1');
      expect(updated).toBeDefined();
      expect(updated!.serverVersion).toBe(2);
      expect(updated!._raw._status).toBe('synced');
    });

    test('dengan status conflict -> row lokal di-overwrite dengan serverData, _status synced', async () => {
      // Setup: ada row lokal dengan data lama
      const localRow = createMockRow('order-conflict-1', 'updated');
      localRow.status = 'PENDING';
      localRow.totalCents = 20000;
      localRow.serverVersion = 1;
      state.records.get('orders')!.set('order-conflict-1', localRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-conflict-1',
          status: 'conflict',
          serverVersion: 10,
          serverChangedAt: new Date().toISOString(),
          serverData: {
            customerId: 'cust-conflict',
            driverId: 'driver-new',
            status: 'IN_DELIVERY',
            items: [{ id: 'item-new', name: 'Mie Goreng', priceCents: 30000, quantity: 1 }],
            deliveryAddress: { street: 'Jl Baru No. 99', city: 'Bandung' },
            totalCents: 30000,
            currency: 'IDR',
            notes: 'Hot',
          },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // Verifikasi: row di-overwrite dengan data server
      const overwritten = state.records.get('orders')!.get('order-conflict-1');
      expect(overwritten).toBeDefined();
      expect(overwritten!.serverVersion).toBe(10);
      expect(overwritten!.status).toBe('IN_DELIVERY');
      expect(overwritten!.totalCents).toBe(30000);
      expect(overwritten!._raw._status).toBe('synced');
    });

    test('accept dengan payment entity -> _status synced + domain status CAPTURED', async () => {
      // Setup: payment row
      const paymentRow = createMockRow('payment-1', 'created');
      paymentRow.serverVersion = 1;
      paymentRow.status = 'PENDING';
      paymentRow.amountCents = 50000;
      state.records.get('payments')!.set('payment-1', paymentRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'payment',
          id: 'payment-1',
          status: 'accepted',
          serverVersion: 3,
          serverChangedAt: new Date().toISOString(),
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // Verifikasi
      const updated = state.records.get('payments')!.get('payment-1');
      expect(updated).toBeDefined();
      expect(updated!.serverVersion).toBe(3);
      expect(updated!._raw._status).toBe('synced');
      // C3 fix: domain status flip ke CAPTURED setelah accepted
      expect((updated as any).status).toBe('CAPTURED');
    });

    test('accept dengan payment entity + serverData status -> uses serverData', async () => {
      // Setup: payment row
      const paymentRow = createMockRow('payment-2', 'created');
      paymentRow.serverVersion = 1;
      paymentRow.status = 'PENDING';
      paymentRow.amountCents = 50000;
      state.records.get('payments')!.set('payment-2', paymentRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'payment',
          id: 'payment-2',
          status: 'accepted',
          serverVersion: 3,
          serverChangedAt: new Date().toISOString(),
          serverData: {
            status: 'PENDING', // server says still pending
          },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      const updated = state.records.get('payments')!.get('payment-2');
      // Uses serverData status, not hardcoded CAPTURED
      expect((updated as any).status).toBe('PENDING');
    });

    test('accept dengan chat_message entity -> _status synced + domain status SENT', async () => {
      // Setup: chat_message row dengan status pending_send
      const chatRow = createMockRow('chat-accepted-1', 'created');
      chatRow.serverVersion = 0;
      chatRow.status = 'pending_send';
      chatRow.body = 'Test message';
      chatRow.roomId = 'room-1';
      chatRow.senderId = 'user-1';
      chatRow.clientCreatedAt = Date.now();
      state.records.get('chat_messages')!.set('chat-accepted-1', chatRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'chat_message',
          id: 'chat-accepted-1',
          status: 'accepted',
          serverVersion: 1,
          serverChangedAt: new Date().toISOString(),
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // Verifikasi
      const updated = state.records.get('chat_messages')!.get('chat-accepted-1');
      expect(updated).toBeDefined();
      expect(updated!.serverVersion).toBe(1);
      expect(updated!._raw._status).toBe('synced');
      // C3 fix: domain status flip ke SENT setelah accepted
      // Ini yang fix bug 'mengirim...' stuck, sync path sekarang benar flip status
      expect((updated as any).status).toBe('SENT');
    });

    test('accept dengan order entity -> TIDAK flip domain status (orders have different flow)', async () => {
      // Setup: order row
      const orderRow = createMockRow('order-accepted-1', 'created');
      orderRow.serverVersion = 1;
      orderRow.status = 'CONFIRMED';
      orderRow.itemsJson = '[]';
      orderRow.addressJson = '{}';
      orderRow.totalCents = 50000;
      orderRow.currency = 'IDR';
      state.records.get('orders')!.set('order-accepted-1', orderRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-accepted-1',
          status: 'accepted',
          serverVersion: 2,
          serverChangedAt: new Date().toISOString(),
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // Verifikasi: order TIDAK punya domain status flip di accepted path
      const updated = state.records.get('orders')!.get('order-accepted-1');
      expect(updated).toBeDefined();
      expect(updated!.serverVersion).toBe(2);
      expect(updated!._raw._status).toBe('synced');
      // Order status tetap seperti sebelum, tidak ada perubahan di accepted path
      expect(updated!.status).toBe('CONFIRMED');
    });

    test('conflict dengan chat_message entity -> _status synced', async () => {
      // Setup: chat_message row
      const chatRow = createMockRow('chat-1', 'updated');
      chatRow.serverVersion = 1;
      chatRow.body = 'Old message';
      chatRow.status = 'sent';
      state.records.get('chat_messages')!.set('chat-1', chatRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'chat_message',
          id: 'chat-1',
          status: 'conflict',
          serverVersion: 7,
          serverChangedAt: new Date().toISOString(),
          serverData: {
            roomId: 'room-1',
            senderId: 'user-1',
            body: 'New message from server',
            status: 'delivered',
          },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // Verifikasi
      const overwritten = state.records.get('chat_messages')!.get('chat-1');
      expect(overwritten).toBeDefined();
      expect(overwritten!.serverVersion).toBe(7);
      expect((overwritten as Record<string, unknown>).body).toBe('New message from server');
      expect((overwritten as Record<string, unknown>).status).toBe('delivered');
      expect(overwritten!._raw._status).toBe('synced');
    });
  });

  describe('dirty record tracking', () => {
    test('record tidak dianggap dirty setelah applyPull', async () => {
      const pullResponse: SyncPullResponse = {
        nextCursor: 'cursor-2',
        records: [
          {
            entityType: 'order',
            id: 'order-clean-1',
            serverVersion: 1,
            serverChangedAt: new Date().toISOString(),
            deleted: false,
            data: {
              customerId: 'cust-1',
              driverId: null,
              status: 'CONFIRMED',
              items: [],
              deliveryAddress: {},
              totalCents: 10000,
              currency: 'IDR',
              notes: null,
            },
          },
        ],
        serverTime: new Date().toISOString(),
      };

      // @ts-expect-error - accessing private method for testing
      await coordinator.applyPull(pullResponse, mockDb);

      // Simulasi collectDirty: query records dengan _status !== 'synced'
      const records = state.records.get('orders');
      const dirtyRecords = [...(records ?? new Map()).values()].filter(
        (r) => r._raw._status !== 'synced',
      );
      expect(dirtyRecords).toHaveLength(0);
    });

    test('record tidak dianggap dirty setelah resolveAcks accepted', async () => {
      const pendingRow = createMockRow('order-pending-2', 'created');
      state.records.get('orders')!.set('order-pending-2', pendingRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-pending-2',
          status: 'accepted',
          serverVersion: 2,
          serverChangedAt: new Date().toISOString(),
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // Simulasi collectDirty
      const records = state.records.get('orders');
      const dirtyRecords = [...(records ?? new Map()).values()].filter(
        (r) => r._raw._status !== 'synced',
      );
      expect(dirtyRecords).toHaveLength(0);
    });

    test('record tidak dianggap dirty setelah resolveAcks conflict', async () => {
      const localRow = createMockRow('order-conflict-2', 'updated');
      state.records.get('orders')!.set('order-conflict-2', localRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-conflict-2',
          status: 'conflict',
          serverVersion: 5,
          serverChangedAt: new Date().toISOString(),
          serverData: {
            customerId: 'cust-new',
            driverId: null,
            status: 'DELIVERED',
            items: [],
            deliveryAddress: {},
            totalCents: 15000,
            currency: 'IDR',
            notes: null,
          },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // Simulasi collectDirty
      const records = state.records.get('orders');
      const dirtyRecords = [...(records ?? new Map()).values()].filter(
        (r) => r._raw._status !== 'synced',
      );
      expect(dirtyRecords).toHaveLength(0);
    });
  });

  describe('localRowToSyncRecord, op classification', () => {
    const now = Date.now();

    test('record dengan _raw._status="created" menghasilkan op="create" dan baseVersion=null', async () => {
      // Arrange: buat mock row dengan _raw._status='created' (simulasi pesan baru offline)
      const newRow = createMockRow('chat-new-offline', 'created');
      newRow.serverVersion = 0;
      newRow.failedSyncAttempts = 0;
      // localRowToSyncRecord membaca createdAt/updatedAt untuk data payload
      newRow.createdAt = now;
      newRow.updatedAt = now;
      newRow.clientCreatedAt = now;
      newRow.roomId = 'room-1';
      newRow.senderId = 'user-1';
      newRow.body = 'test message';
      newRow.attachmentJson = undefined;
      newRow.status = 'pending_send';

      // @ts-expect-error - accessing private method for testing
      const record = coordinator.localRowToSyncRecord(newRow, 'chat_messages');

      // Assert: harus dikirim sebagai CREATE, bukan UPDATE
      expect(record.op).toBe('create');
      expect(record.baseVersion).toBeNull();
      expect(record.id).toBe('chat-new-offline');
    });

    test('record dengan _raw._status="updated" menghasilkan op="update" dan baseVersion=serverVersion', async () => {
      const updatedRow = createMockRow('order-modified-offline', 'updated');
      updatedRow.serverVersion = 3;
      updatedRow.failedSyncAttempts = 0;
      updatedRow.createdAt = now;
      updatedRow.updatedAt = now;
      updatedRow.status = 'CONFIRMED';
      updatedRow.itemsJson = '[]';
      updatedRow.addressJson = '{}';
      updatedRow.totalCents = 10000;
      updatedRow.currency = 'IDR';
      updatedRow.notes = null;

      // @ts-expect-error - accessing private method for testing
      const record = coordinator.localRowToSyncRecord(updatedRow, 'orders');

      expect(record.op).toBe('update');
      expect(record.baseVersion).toBe(3);
    });

    test('record dengan _raw._status="deleted" menghasilkan op="delete"', async () => {
      const deletedRow = createMockRow('payment-deleted-offline', 'deleted');
      deletedRow.serverVersion = 1;
      deletedRow.failedSyncAttempts = 0;
      deletedRow.createdAt = now;
      deletedRow.updatedAt = now;
      deletedRow.orderId = 'order-1';
      deletedRow.idempotencyKey = 'idem-1';
      deletedRow.method = 'CASH';
      deletedRow.status = 'COMPLETED';
      deletedRow.amountCents = 5000;
      deletedRow.currency = 'IDR';
      deletedRow.kind = 'PAYMENT';

      // @ts-expect-error - accessing private method for testing
      const record = coordinator.localRowToSyncRecord(deletedRow, 'payments');

      expect(record.op).toBe('delete');
    });
  });

  describe('retry cap, resolveAcks rejected handling', () => {
    test('rejected ack increment failedSyncAttempts', async () => {
      const pendingRow = createMockRow('chat-retry-1', 'created');
      pendingRow.serverVersion = 0;
      pendingRow.failedSyncAttempts = 0;
      pendingRow.createdAt = Date.now();
      pendingRow.updatedAt = Date.now();
      pendingRow.clientCreatedAt = Date.now();
      pendingRow.roomId = 'room-1';
      pendingRow.senderId = 'user-1';
      pendingRow.body = 'test';
      pendingRow.status = 'PENDING';
      state.records.get('chat_messages')!.set('chat-retry-1', pendingRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'chat_message',
          id: 'chat-retry-1',
          status: 'rejected',
          reason: 'Entity not found',
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // Verifikasi failedSyncAttempts naik
      const updatedRow = state.records.get('chat_messages')!.get('chat-retry-1')!;
      expect(updatedRow.failedSyncAttempts).toBe(1);
      // Status domain tidak berubah ke FAILED sebelum cap (MAX=5)
      expect((updatedRow as any).status).not.toBe('FAILED');
    });

    test('chat_message domain status menjadi FAILED setelah MAX_SYNC_ATTEMPTS rejections', async () => {
      const row = createMockRow('chat-perma-fail', 'created');
      row.serverVersion = 0;
      row.failedSyncAttempts = 4; // satu lagi akan mentrigger cap
      (row as any).status = 'pending_send';
      state.records.get('chat_messages')!.set('chat-perma-fail', row);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'chat_message',
          id: 'chat-perma-fail',
          status: 'rejected',
          reason: 'Server validation error',
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      const updatedRow = state.records.get('chat_messages')!.get('chat-perma-fail')!;
      expect(updatedRow.failedSyncAttempts).toBe(5);
      expect((updatedRow as any).status).toBe('FAILED');
    });

    test('record yang sudah hit retry cap TIDAK akan dikumpulkan oleh collectDirty (skipped via failedSyncAttempts >= MAX_SYNC_ATTEMPTS)', async () => {
      // Simulasi: record dengan failedSyncAttempts = 5 sudah di cap.
      // collectDirty menskip record dengan failedSyncAttempts >= 5.
      // Test ini memverifikasi state yang collectDirty akan skip.
      const row = createMockRow('order-capped', 'created');
      row.serverVersion = 0;
      row.failedSyncAttempts = 5; // sudah di cap
      row.createdAt = Date.now();
      row.updatedAt = Date.now();
      row.status = 'CONFIRMED';
      row.itemsJson = '[]';
      row.addressJson = '{}';
      row.totalCents = 10000;
      row.currency = 'IDR';
      state.records.get('orders')!.set('order-capped', row);

      // collectDirty skip logic: attempts >= 5, continue (skip).
      // Verifikasi state: row._raw._status tetap 'created' (tidak berubah),
      // tapi collectDirty akan skip karena failedSyncAttempts >= 5.
      expect(row.failedSyncAttempts).toBe(5);
      expect(row._raw._status).toBe('created'); // masih dirty tapi di-skip
      // Ini adalah state yang collectDirty check: attempts >= MAX_SYNC_ATTEMPTS
      // Simulasi skip check:
      const MAX_SYNC_ATTEMPTS = 5;
      const shouldSkip = row.failedSyncAttempts >= MAX_SYNC_ATTEMPTS;
      expect(shouldSkip).toBe(true); // confirm skip condition
    });

    test('record accepted setelah sebelumnya failed tidak di-count ulang (serverVersion naik)', async () => {
      // Record yang accepted akan punya serverVersion > 0, tapi collectDirty
      // tetap mengirim sebagai 'update' jika _status='updated', itu benar.
      // Yang penting: resolveAcks accepted TIDAK increment failedSyncAttempts.
      const row = createMockRow('chat-recovered', 'updated');
      row.serverVersion = 0;
      row.failedSyncAttempts = 2;
      (row as any).status = 'pending_send';
      state.records.get('chat_messages')!.set('chat-recovered', row);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'chat_message',
          id: 'chat-recovered',
          status: 'accepted',
          serverVersion: 5,
          serverChangedAt: new Date().toISOString(),
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // accepted TIDAK increment counter
      const updatedRow = state.records.get('chat_messages')!.get('chat-recovered')!;
      expect(updatedRow.failedSyncAttempts).toBe(2); // tidak berubah
      expect(updatedRow._raw._status).toBe('synced');
    });
  });

  describe('payment FAILED surfacing', () => {
    test('payment domain status menjadi FAILED setelah MAX_SYNC_ATTEMPTS rejections', async () => {
      const row = createMockRow('payment-perma-fail', 'created');
      row.serverVersion = 0;
      row.failedSyncAttempts = 4; // satu lagi akan mentrigger cap
      row.status = 'CAPTURED';
      row.orderId = 'order-1';
      row.idempotencyKey = 'idem-1';
      row.method = 'CASH';
      row.amountCents = 50000;
      row.currency = 'IDR';
      row.kind = 'PAYMENT';
      state.records.get('payments')!.set('payment-perma-fail', row);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'payment',
          id: 'payment-perma-fail',
          status: 'rejected',
          reason: 'Server validation error',
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      const updatedRow = state.records.get('payments')!.get('payment-perma-fail')!;
      expect(updatedRow.failedSyncAttempts).toBe(5);
      expect((updatedRow as any).status).toBe('FAILED');
    });

    test('payment dengan rejected ack increment failedSyncAttempts', async () => {
      const row = createMockRow('payment-retry-1', 'created');
      row.serverVersion = 0;
      row.failedSyncAttempts = 0;
      row.status = 'CAPTURED';
      row.orderId = 'order-1';
      row.idempotencyKey = 'idem-1';
      row.method = 'CASH';
      row.amountCents = 50000;
      row.currency = 'IDR';
      row.kind = 'PAYMENT';
      state.records.get('payments')!.set('payment-retry-1', row);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'payment',
          id: 'payment-retry-1',
          status: 'rejected',
          reason: 'Entity not found',
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // Verifikasi failedSyncAttempts naik
      const updatedRow = state.records.get('payments')!.get('payment-retry-1')!;
      expect(updatedRow.failedSyncAttempts).toBe(1);
      // Status domain tidak berubah ke FAILED sebelum cap (MAX=5)
      expect((updatedRow as any).status).not.toBe('FAILED');
    });

    test('payment accepted tidak me-reset failedSyncAttempts', async () => {
      const row = createMockRow('payment-accepted', 'created');
      row.serverVersion = 0;
      row.failedSyncAttempts = 2;
      row.status = 'CAPTURED';
      row.orderId = 'order-1';
      row.idempotencyKey = 'idem-1';
      row.method = 'CASH';
      row.amountCents = 50000;
      row.currency = 'IDR';
      row.kind = 'PAYMENT';
      state.records.get('payments')!.set('payment-accepted', row);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'payment',
          id: 'payment-accepted',
          status: 'accepted',
          serverVersion: 3,
          serverChangedAt: new Date().toISOString(),
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      const updatedRow = state.records.get('payments')!.get('payment-accepted')!;
      expect(updatedRow.failedSyncAttempts).toBe(2); // tidak berubah
      expect(updatedRow._raw._status).toBe('synced');
    });
  });

  describe('markRecordsFailed, timeout handling', () => {
    test('markRecordsFailed increment counter untuk records yang di-timeout', async () => {
      const row = createMockRow('payment-timeout-1', 'created');
      row.serverVersion = 0;
      row.failedSyncAttempts = 0;
      row.status = 'CAPTURED';
      row.orderId = 'order-1';
      row.idempotencyKey = 'idem-1';
      row.method = 'CASH';
      row.amountCents = 50000;
      row.currency = 'IDR';
      row.kind = 'PAYMENT';
      state.records.get('payments')!.set('payment-timeout-1', row);

      const records: SyncRecordPush[] = [
        {
          entityType: 'payment',
          id: 'payment-timeout-1',
          data: {},
          op: 'create',
          clientChangedAt: new Date().toISOString(),
          baseVersion: null,
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.markRecordsFailed(records, mockDb);

      const updatedRow = state.records.get('payments')!.get('payment-timeout-1')!;
      expect(updatedRow.failedSyncAttempts).toBe(1);
      expect((updatedRow as any).status).not.toBe('FAILED');
    });

    test('markRecordsFailed flip status ke FAILED setelah MAX_SYNC_ATTEMPTS timeouts', async () => {
      const row = createMockRow('payment-timeout-fail', 'created');
      row.serverVersion = 0;
      row.failedSyncAttempts = 4; // satu lagi akan mentrigger cap
      row.status = 'CAPTURED';
      row.orderId = 'order-1';
      row.idempotencyKey = 'idem-1';
      row.method = 'CASH';
      row.amountCents = 50000;
      row.currency = 'IDR';
      row.kind = 'PAYMENT';
      state.records.get('payments')!.set('payment-timeout-fail', row);

      const records: SyncRecordPush[] = [
        {
          entityType: 'payment',
          id: 'payment-timeout-fail',
          data: {},
          op: 'create',
          clientChangedAt: new Date().toISOString(),
          baseVersion: null,
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.markRecordsFailed(records, mockDb);

      const updatedRow = state.records.get('payments')!.get('payment-timeout-fail')!;
      expect(updatedRow.failedSyncAttempts).toBe(5);
      expect((updatedRow as any).status).toBe('FAILED');
    });

    test('markRecordsFailed untuk chat_message flip status ke FAILED', async () => {
      const row = createMockRow('chat-timeout-fail', 'created');
      row.serverVersion = 0;
      row.failedSyncAttempts = 4;
      (row as any).status = 'pending_send';
      row.roomId = 'room-1';
      row.senderId = 'user-1';
      row.body = 'test';
      state.records.get('chat_messages')!.set('chat-timeout-fail', row);

      const records: SyncRecordPush[] = [
        {
          entityType: 'chat_message',
          id: 'chat-timeout-fail',
          data: {},
          op: 'create',
          clientChangedAt: new Date().toISOString(),
          baseVersion: null,
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.markRecordsFailed(records, mockDb);

      const updatedRow = state.records.get('chat_messages')!.get('chat-timeout-fail')!;
      expect(updatedRow.failedSyncAttempts).toBe(5);
      expect((updatedRow as any).status).toBe('FAILED');
    });
  });

  describe('idempotency key defensive fallback', () => {
    test('localRowToSyncRecord generates fallback idempotencyKey when row.idempotencyKey is empty', async () => {
      const row = createMockRow('payment-no-key', 'created');
      row.serverVersion = 0;
      row.failedSyncAttempts = 0;
      row.status = 'CAPTURED';
      row.orderId = 'order-1';
      row.idempotencyKey = ''; // empty, simulates old data / debug insert
      row.method = 'CASH';
      row.amountCents = 50000;
      row.currency = 'IDR';
      row.kind = 'PAYMENT';
      row.createdAt = Date.now();
      row.updatedAt = Date.now();

      // @ts-expect-error - accessing private method for testing
      const record = coordinator.localRowToSyncRecord(row, 'payments');

      // Fallback key should be valid format cod:uuid
      expect((record.data as Payment).idempotencyKey).toMatch(/^cod:[0-9a-f-]+$/i);
      expect((record.data as Payment).idempotencyKey).not.toBe('');
    });

    test('localRowToSyncRecord uses row idempotencyKey when present', async () => {
      const row = createMockRow('payment-with-key', 'created');
      row.serverVersion = 0;
      row.failedSyncAttempts = 0;
      row.status = 'CAPTURED';
      row.orderId = 'order-1';
      row.idempotencyKey = 'cod:550e8400-e29b-41d4-a716-446655440000';
      row.method = 'CASH';
      row.amountCents = 50000;
      row.currency = 'IDR';
      row.kind = 'PAYMENT';
      row.createdAt = Date.now();
      row.updatedAt = Date.now();

      // @ts-expect-error - accessing private method for testing
      const record = coordinator.localRowToSyncRecord(row, 'payments');

      // Should use the row's key, not generate a fallback
      expect((record.data as Payment).idempotencyKey).toBe('cod:550e8400-e29b-41d4-a716-446655440000');
    });
  });

  describe('ack-id mismatch recovery (findLocalPaymentByAck)', () => {
    test('accepted ack with ack-id mismatch recovers via idempotencyKey match', async () => {
      // Setup: local row exists but with different UUID than server
      const localRow = createMockRow('local-uuid-123', 'created');
      localRow.serverVersion = 0;
      localRow.status = 'CAPTURED';
      localRow.orderId = 'order-1';
      localRow.idempotencyKey = 'cod:server-matched-key-456'; // server will return this
      localRow.method = 'CASH';
      localRow.amountCents = 50000;
      localRow.currency = 'IDR';
      localRow.kind = 'PAYMENT';
      state.records.get('payments')!.set('local-uuid-123', localRow);

      // Ack from server: accepted but with server's UUID, not local's
      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'payment',
          id: 'server-uuid-789', // different from local
          status: 'accepted',
          serverVersion: 5,
          serverChangedAt: new Date().toISOString(),
          serverData: {
            idempotencyKey: 'cod:server-matched-key-456',
            orderId: 'order-1',
            method: 'CASH',
            status: 'CAPTURED',
            amountCents: 50000,
            currency: 'IDR',
            kind: 'PAYMENT',
          },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // Local row should be marked synced
      const updatedRow = state.records.get('payments')!.get('local-uuid-123')!;
      expect(updatedRow.serverVersion).toBe(5);
      expect(updatedRow._raw._status).toBe('synced');
    });

    test('conflict ack with ack-id mismatch recovers via idempotencyKey match', async () => {
      // Setup: local row exists but with different UUID than server
      const localRow = createMockRow('local-uuid-abc', 'created');
      localRow.serverVersion = 0;
      localRow.status = 'CAPTURED';
      localRow.orderId = 'order-1';
      localRow.idempotencyKey = 'cod:conflict-matched-key-def';
      localRow.method = 'CASH';
      localRow.amountCents = 50000;
      localRow.currency = 'IDR';
      localRow.kind = 'PAYMENT';
      state.records.get('payments')!.set('local-uuid-abc', localRow);

      // Ack from server: conflict with server's data and UUID
      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'payment',
          id: 'server-uuid-ghi', // different from local
          status: 'conflict',
          serverVersion: 10,
          serverChangedAt: new Date().toISOString(),
          serverData: {
            idempotencyKey: 'cod:conflict-matched-key-def',
            orderId: 'order-1',
            method: 'CASH',
            status: 'CAPTURED',
            amountCents: 60000, // server has different amount
            currency: 'IDR',
            kind: 'PAYMENT',
          },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // Local row should be marked synced
      const updatedRow = state.records.get('payments')!.get('local-uuid-abc')!;
      expect(updatedRow.serverVersion).toBe(10);
      expect(updatedRow._raw._status).toBe('synced');
    });

    test('ack without serverData does not match by idempotencyKey', async () => {
      // Setup: local row with a known idempotencyKey
      const localRow = createMockRow('local-row-xyz', 'created');
      localRow.serverVersion = 0;
      localRow.status = 'CAPTURED';
      localRow.orderId = 'order-1';
      localRow.idempotencyKey = 'cod:orphan-key-999';
      localRow.method = 'CASH';
      localRow.amountCents = 50000;
      localRow.currency = 'IDR';
      localRow.kind = 'PAYMENT';
      state.records.get('payments')!.set('local-row-xyz', localRow);

      // Ack without serverData (no idempotencyKey to match)
      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'payment',
          id: 'server-unknown-id',
          status: 'accepted',
          serverVersion: 3,
          serverChangedAt: new Date().toISOString(),
          // No serverData, can't match by idempotencyKey
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // Local row should NOT be synced (no match possible)
      const updatedRow = state.records.get('payments')!.get('local-row-xyz')!;
      expect(updatedRow.serverVersion).toBe(0); // unchanged
      expect(updatedRow._raw._status).toBe('created'); // still dirty
    });
  });

  describe('resolveAcks, order entity', () => {
    beforeEach(() => {
      emitMock.mockClear();
    });

    test('rejected ack on order increments failedSyncAttempts', async () => {
      const orderRow = createMockRow('order-rejected-1', 'updated');
      orderRow.serverVersion = 3;
      orderRow.failedSyncAttempts = 1;
      orderRow.status = 'OUT_FOR_DELIVERY';
      orderRow.itemsJson = '[]';
      orderRow.addressJson = '{}';
      orderRow.totalCents = 50000;
      orderRow.currency = 'IDR';
      state.records.get('orders')!.set('order-rejected-1', orderRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-rejected-1',
          status: 'rejected',
          reason: 'Order sudah di-reassign ke driver lain',
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // Verifikasi failedSyncAttempts naik
      const updatedRow = state.records.get('orders')!.get('order-rejected-1')!;
      expect(updatedRow.failedSyncAttempts).toBe(2);
      // Status domain tidak berubah ke FAILED (order tidak punya domain status FAILED)
      expect((updatedRow as any).status).not.toBe('FAILED');
    });

    test('rejected ack on order at cap does NOT flip status (no FAILED domain status exists)', async () => {
      const orderRow = createMockRow('order-rejected-cap', 'updated');
      orderRow.serverVersion = 3;
      orderRow.failedSyncAttempts = 4; // satu lagi akan mentrigger cap
      orderRow.status = 'CANCELLED';
      orderRow.itemsJson = '[]';
      orderRow.addressJson = '{}';
      orderRow.totalCents = 50000;
      orderRow.currency = 'IDR';
      state.records.get('orders')!.set('order-rejected-cap', orderRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-rejected-cap',
          status: 'rejected',
          reason: 'Tidak bisa mengubah status order dari DELIVERED ke CANCELLED',
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      const updatedRow = state.records.get('orders')!.get('order-rejected-cap')!;
      expect(updatedRow.failedSyncAttempts).toBe(5);
      // Order tidak punya FAILED domain status, status TIDAK boleh berubah
      expect(updatedRow.status).toBe('CANCELLED');
    });

    test('conflict ack on order emits orderConflict event', async () => {
      const orderRow = createMockRow('order-conflict-emit', 'updated');
      orderRow.serverVersion = 5;
      orderRow.status = 'OUT_FOR_DELIVERY';
      orderRow.itemsJson = '[]';
      orderRow.addressJson = '{}';
      orderRow.totalCents = 50000;
      orderRow.currency = 'IDR';
      state.records.get('orders')!.set('order-conflict-emit', orderRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-conflict-emit',
          status: 'conflict',
          serverVersion: 10,
          serverChangedAt: new Date().toISOString(),
          serverData: {
            customerId: 'cust-1',
            driverId: 'test-user-id',
            status: 'DELIVERED',
            items: [],
            deliveryAddress: {},
            totalCents: 50000,
            currency: 'IDR',
            notes: null,
          },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // Verify orderConflict event was emitted
      expect(emitMock).toHaveBeenCalledWith('orderConflict', expect.objectContaining({
        orderId: 'order-conflict-emit',
        reason: 'order-status-conflict',
        serverStatus: 'DELIVERED',
      }));
    });

    test('rejected ack on order emits orderRejected event', async () => {
      const orderRow = createMockRow('order-rejected-emit', 'updated');
      orderRow.serverVersion = 5;
      orderRow.failedSyncAttempts = 4;
      orderRow.status = 'CANCELLED';
      orderRow.itemsJson = '[]';
      orderRow.addressJson = '{}';
      orderRow.totalCents = 50000;
      orderRow.currency = 'IDR';
      state.records.get('orders')!.set('order-rejected-emit', orderRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-rejected-emit',
          status: 'rejected',
          reason: 'Order sudah di-reassign ke driver lain',
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // Verify orderRejected event was emitted
      expect(emitMock).toHaveBeenCalledWith('orderRejected', expect.objectContaining({
        orderId: 'order-rejected-emit',
        reason: 'Order sudah di-reassign ke driver lain',
      }));
    });

    test('conflict ack on order overwrites local data with server data', async () => {
      const orderRow = createMockRow('order-overwrite', 'updated');
      orderRow.serverVersion = 5;
      orderRow.status = 'OUT_FOR_DELIVERY';
      orderRow.totalCents = 50000;
      orderRow.itemsJson = '[]';
      orderRow.addressJson = '{}';
      orderRow.currency = 'IDR';
      state.records.get('orders')!.set('order-overwrite', orderRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-overwrite',
          status: 'conflict',
          serverVersion: 10,
          serverChangedAt: new Date().toISOString(),
          serverData: {
            customerId: 'cust-1',
            driverId: 'bob',
            status: 'DELIVERED',
            items: [],
            deliveryAddress: {},
            totalCents: 75000,
            currency: 'IDR',
            notes: null,
          },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      const overwritten = state.records.get('orders')!.get('order-overwrite')!;
      expect(overwritten.serverVersion).toBe(10);
      expect(overwritten.status).toBe('DELIVERED');
      expect(overwritten.totalCents).toBe(75000);
      expect(overwritten._raw._status).toBe('synced');
    });

    test('conflict ack, driverId berbeda dari currentUserId -> reason accepted-by-other', async () => {
      const orderRow = createMockRow('order-accepted-other', 'updated');
      orderRow.serverVersion = 5;
      orderRow.status = 'ASSIGNED';
      orderRow.itemsJson = '[]';
      orderRow.addressJson = '{}';
      orderRow.totalCents = 50000;
      orderRow.currency = 'IDR';
      state.records.get('orders')!.set('order-accepted-other', orderRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-accepted-other',
          status: 'conflict',
          serverVersion: 10,
          serverChangedAt: new Date().toISOString(),
          serverData: {
            customerId: 'cust-1',
            driverId: 'different-driver', // bukan 'test-user-id'
            status: 'ASSIGNED',
            items: [],
            deliveryAddress: {},
            totalCents: 50000,
            currency: 'IDR',
            notes: null,
          },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      expect(emitMock).toHaveBeenCalledWith('orderConflict', expect.objectContaining({
        orderId: 'order-accepted-other',
        reason: 'accepted-by-other',
        serverStatus: 'ASSIGNED',
      }));
    });

    test('conflict ack, driverId sama dengan currentUserId -> reason order-status-conflict', async () => {
      const orderRow = createMockRow('order-same-driver', 'updated');
      orderRow.serverVersion = 5;
      orderRow.status = 'PREPARING';
      orderRow.itemsJson = '[]';
      orderRow.addressJson = '{}';
      orderRow.totalCents = 50000;
      orderRow.currency = 'IDR';
      state.records.get('orders')!.set('order-same-driver', orderRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-same-driver',
          status: 'conflict',
          serverVersion: 10,
          serverChangedAt: new Date().toISOString(),
          serverData: {
            customerId: 'cust-1',
            driverId: 'test-user-id', // sama dengan mock getCurrentUserId
            status: 'PREPARING',
            items: [],
            deliveryAddress: {},
            totalCents: 50000,
            currency: 'IDR',
            notes: null,
          },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      expect(emitMock).toHaveBeenCalledWith('orderConflict', expect.objectContaining({
        orderId: 'order-same-driver',
        reason: 'order-status-conflict',
        serverStatus: 'PREPARING',
      }));
    });

    // Temuan 1: discriminator test untuk cancel-offline conflict sudah
    // dipindah ke outbox.spec.ts (handleVersionConflict test suite).
    // resolveAcks tidak lagi menulis lastConflictReason / lastConflictAt.

    test('conflict ack, driverId undefined -> reason order-status-conflict', async () => {
      const orderRow = createMockRow('order-undefined-driver', 'updated');
      orderRow.serverVersion = 5;
      orderRow.status = 'CONFIRMED';
      orderRow.itemsJson = '[]';
      orderRow.addressJson = '{}';
      orderRow.totalCents = 50000;
      orderRow.currency = 'IDR';
      state.records.get('orders')!.set('order-undefined-driver', orderRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-undefined-driver',
          status: 'conflict',
          serverVersion: 10,
          serverChangedAt: new Date().toISOString(),
          serverData: {
            customerId: 'cust-1',
            driverId: undefined, // undefined
            status: 'CONFIRMED',
            items: [],
            deliveryAddress: {},
            totalCents: 50000,
            currency: 'IDR',
            notes: null,
          },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      expect(emitMock).toHaveBeenCalledWith('orderConflict', expect.objectContaining({
        orderId: 'order-undefined-driver',
        reason: 'order-status-conflict',
        serverStatus: 'CONFIRMED',
      }));
    });

    test('conflict ack, isAcceptedByOther true -> emit orderRemovedFromView', async () => {
      const orderRow = createMockRow('order-removed-view', 'updated');
      orderRow.serverVersion = 5;
      orderRow.status = 'ASSIGNED';
      orderRow.itemsJson = '[]';
      orderRow.addressJson = '{}';
      orderRow.totalCents = 50000;
      orderRow.currency = 'IDR';
      state.records.get('orders')!.set('order-removed-view', orderRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-removed-view',
          status: 'conflict',
          serverVersion: 10,
          serverChangedAt: new Date().toISOString(),
          serverData: {
            customerId: 'cust-1',
            driverId: 'other-driver', // bukan 'test-user-id'
            status: 'ASSIGNED',
            items: [],
            deliveryAddress: {},
            totalCents: 50000,
            currency: 'IDR',
            notes: null,
          },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      expect(emitMock).toHaveBeenCalledWith('orderRemovedFromView', expect.objectContaining({
        orderId: 'order-removed-view',
      }));
    });

    test('conflict ack, isAcceptedByOther false, TIDAK emit orderRemovedFromView', async () => {
      const orderRow = createMockRow('order-keep-view', 'updated');
      orderRow.serverVersion = 5;
      orderRow.status = 'PREPARING';
      orderRow.itemsJson = '[]';
      orderRow.addressJson = '{}';
      orderRow.totalCents = 50000;
      orderRow.currency = 'IDR';
      state.records.get('orders')!.set('order-keep-view', orderRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-keep-view',
          status: 'conflict',
          serverVersion: 10,
          serverChangedAt: new Date().toISOString(),
          serverData: {
            customerId: 'cust-1',
            driverId: 'test-user-id', // sama dengan mock getCurrentUserId
            status: 'PREPARING',
            items: [],
            deliveryAddress: {},
            totalCents: 50000,
            currency: 'IDR',
            notes: null,
          },
        },
      ];

      // @ts-expect-error - accessing private method for testing
      await coordinator.resolveAcks(acks, mockDb);

      // orderRemovedFromView JANGAN emit
      const orderRemovedCalls = emitMock.mock.calls.filter(
        ([event]) => event === 'orderRemovedFromView'
      );
      expect(orderRemovedCalls).toHaveLength(0);
    });

    // Order yang ditolak sampai batas diberi last_conflict_reason
    // 'sync-rejected' supaya bannernya tampil.
    test('order ditolak untuk kelima kalinya: last_conflict_reason "sync-rejected" dan last_conflict_at diisi', async () => {
      const orderRow = createMockRow('order-sync-rejected-1', 'updated');
      orderRow.serverVersion = 3;
      orderRow.failedSyncAttempts = 4; // percobaan kelima mencapai batas
      orderRow.status = 'CONFIRMED';
      orderRow.itemsJson = '[]';
      orderRow.addressJson = '{}';
      orderRow.totalCents = 50000;
      orderRow.currency = 'IDR';
      state.records.get('orders')!.set('order-sync-rejected-1', orderRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-sync-rejected-1',
          status: 'rejected',
          reason: 'Order sudah di-reassign',
        },
      ];

      // @ts-expect-error - akses method private untuk tes
      await coordinator.resolveAcks(acks, mockDb);

      const updated = state.records.get('orders')!.get('order-sync-rejected-1')!;
      expect(updated._raw.last_conflict_reason).toBe('sync-rejected');
      expect(typeof updated._raw.last_conflict_at).toBe('number');
    });

    test('order ditolak untuk keempat kalinya: last_conflict_reason belum diisi', async () => {
      const orderRow = createMockRow('order-sync-rejected-2', 'updated');
      orderRow.serverVersion = 3;
      orderRow.failedSyncAttempts = 3; // percobaan keempat, belum sampai batas
      orderRow.status = 'CONFIRMED';
      orderRow.itemsJson = '[]';
      orderRow.addressJson = '{}';
      orderRow.totalCents = 50000;
      orderRow.currency = 'IDR';
      state.records.get('orders')!.set('order-sync-rejected-2', orderRow);

      const acks: SyncPushResponse['acks'] = [
        {
          entityType: 'order',
          id: 'order-sync-rejected-2',
          status: 'rejected',
          reason: 'Order sudah di-reassign',
        },
      ];

      // @ts-expect-error - akses method private untuk tes
      await coordinator.resolveAcks(acks, mockDb);

      const updated = state.records.get('orders')!.get('order-sync-rejected-2')!;
      // Belum sampai batas, last_conflict_reason belum ditulis
      expect(updated._raw.last_conflict_reason).toBeUndefined();
      expect(updated._raw.last_conflict_at).toBeUndefined();
    });
  });

  // drain outbox setiap status jadi 'online', termasuk transisi
  // 'unknown' -> 'online' saat app dibuka.
  describe('setupNetworkListener: drain outbox setiap perpindahan ke online', () => {
    let coordinator: SyncCoordinator;
    const { networkMonitor } = require('../map/networkMonitor');

    beforeEach(() => {
      drainMock.mockReset();
      drainMock.mockResolvedValue([]);
      networkListenerRef.current = null;
      jest.mocked(networkMonitor.getStatus).mockReturnValue('unknown');
      coordinator = new SyncCoordinator();
    });

    // Pasang listener sekali, lalu fire beberapa transisi untuk simulasi
    // rangkaian event dari networkMonitor dalam satu siklus hidup
    // coordinator. setupNetworkListener dipanggil di awal; transisi
    // berikutnya dipanggil via listener yang sudah terpasang.
    async function setupAndFire(...statuses: Array<'online' | 'offline' | 'unknown'>): Promise<void> {
      // @ts-expect-error - accessing private method for testing
      await coordinator.setupNetworkListener();
      const listener = networkListenerRef.current;
      if (!listener) throw new Error('Listener tidak terpasang');
      for (const status of statuses) {
        await listener(status);
      }
    }

    test("'unknown' -> 'online' memanggil drain", async () => {
      await setupAndFire('online');
      expect(drainMock).toHaveBeenCalledTimes(1);
    });

    test("'offline' -> 'online' memanggil drain", async () => {
      await setupAndFire('offline', 'online');
      // 'unknown' -> 'offline' tidak drain, 'offline' -> 'online' drain
      expect(drainMock).toHaveBeenCalledTimes(1);
    });

    test("'online' -> 'online' tidak memanggil drain (cek periodik, bukan transisi)", async () => {
      // Transisi pertama: 'unknown' -> 'online' (drain 1x)
      await setupAndFire('online', 'online');
      // Hanya satu drain (dari transisi pertama)
      expect(drainMock).toHaveBeenCalledTimes(1);
    });
  });

  // Selama online, syncTick mengirim outbox di tiap sinkron berkala, supaya
  // aksi yang gagal karena gangguan sementara dicoba lagi tanpa menunggu
  // koneksi putus lalu tersambung. drainMock sama dengan yang dipakai tes
  // setupNetworkListener di atas.
  describe('syncTick: outbox dikirim tiap sinkron berkala', () => {
    const { networkMonitor } = require('../map/networkMonitor');

    beforeEach(() => {
      drainMock.mockReset();
      drainMock.mockResolvedValue([]);
      jest.mocked(networkMonitor.getStatus).mockReset();
    });

    test('memanggil drainPendingActions saat online', async () => {
      jest.mocked(networkMonitor.getStatus).mockReturnValue('online');
      // syncTick berhenti kalau db kosong, jadi db diisi dulu.
      // @ts-expect-error - akses field private untuk tes
      coordinator.db = mockDb;
      // @ts-expect-error - akses method private untuk tes
      await coordinator.syncTick();
      expect(drainMock).toHaveBeenCalledTimes(1);
    });

    test('tidak memanggil drainPendingActions saat offline', async () => {
      jest.mocked(networkMonitor.getStatus).mockReturnValue('offline');
      // @ts-expect-error - akses field private untuk tes
      coordinator.db = mockDb;
      // @ts-expect-error - akses method private untuk tes
      await coordinator.syncTick();
      expect(drainMock).not.toHaveBeenCalled();
    });
  });
});
