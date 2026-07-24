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
 */

import { SyncCoordinator } from './coordinator';

type SyncRecordPull = {
  entityType: string;
  id: string;
  serverVersion: number;
  serverChangedAt: string;
  deleted: boolean;
  data: Record<string, unknown>;
};

type SyncPullResponse = {
  nextCursor: string | null;
  records: SyncRecordPull[];
  serverTime: string;
};

type SyncAck = {
  entityType: string;
  id: string;
  status: 'accepted' | 'conflict';
  serverVersion: number;
  serverChangedAt: string;
  serverData?: Record<string, unknown>;
};

type SyncPushResponse = {
  acks: SyncAck[];
};

// ============ Mock WatermelonDB ============

interface MockRow {
  id: string;
  _raw: { _status: string };
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
          return [...collectionRecords.values()].filter(
            (r) => r._raw._status !== 'synced',
          );
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
  };
}

function attachModelMethods(row: MockRow): MockModel {
  (row as unknown as MockModel).prepareUpdate = function(fn: (r: MockRow) => void): MockModel {
    // DEFER execution - just store the operation for batch()
    state.batchOps.push({ type: 'update', row, fn });
    return row as MockModel;
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

// Database mock — support WatermelonDB write pattern
const mockDb = {
  get(name: string) {
    return createCollection(name);
  },
  async write<T>(fn: () => Promise<T>): Promise<T> {
    // WatermelonDB write() wraps a function that performs batch operations
    // Execute all deferred operations when batch is called
    for (const op of state.batchOps) {
      if (op.type === 'update') {
        op.fn(op.row); // Apply the update to the row
      }
    }
    return fn();
  },
  async batch(..._ops: unknown[]) {
    // Batch is called INSIDE write(), so deferred ops already executed above
    // Clear after execution
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
    test('dengan record baru dari server -> row lokal ter-create dengan _status synced', async () => {
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

      // Verifikasi: row ter-create di collection orders
      const records = state.records.get('orders');
      const created = records?.get('order-new-1');
      expect(created).toBeDefined();
      expect(created!.serverVersion).toBe(1);
      expect(created!.status).toBe('CONFIRMED');
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

    test('accept dengan payment entity -> _status synced', async () => {
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
});
