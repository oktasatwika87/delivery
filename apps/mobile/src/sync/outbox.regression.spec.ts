/**
 * Regression test untuk bug prepareCreateFromDirtyRaw dengan kunci
 * camelCase. Pakai WatermelonDB LOKIJS adapter asli (bukan mock
 * collection) untuk membuktikan bahwa sanitizedRaw (RawRecord/index.js)
 * drop kunci yang tidak ada di tableSchema.columnArray. Harus GAGAL
 * terhadap kode lama (kunci camelCase di outbox.ts) dan LULUS setelah
 * perbaikan (kunci snake_case + JSON.stringify untuk payload_json).
 *
 * Catatan menjalankan spec ini sendirian: pakai --forceExit.
 * (autosave timer LokiJS bikin proses menggantung jika exit normal.)
 */

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { Q } from '@nozbe/watermelondb';

import { schema } from '../db/schema';
import { PendingActionModel } from '../db/models/PendingActionModel';
import { OrderModel } from '../db/models/OrderModel';

// Mock session untuk idempotency key.
jest.mock('./session', () => ({
  getCurrentUserId: jest.fn().mockResolvedValue('driver-regression-test'),
}));

// requireActual untuk ApiError (dipakai test drain di file lain).
// reject/cancel/collectCod/flagOrphanedCod di-override karena enqueue*
// tidak memanggilnya.
jest.mock('./client', () => {
  const actual = jest.requireActual('./client');
  return {
    ...actual,
    rejectOrder: jest.fn(),
    cancelOrder: jest.fn(),
    collectCodOrder: jest.fn(),
    flagOrphanedCod: jest.fn(),
  };
});

// Idempotency deterministik.
jest.mock('./idempotency', () => ({
  generateCodIdempotencyKey: jest.fn().mockResolvedValue('cod:regression-stable'),
}));

// syncEvents & syncCoordinator di-mock supaya tidak ikut terpicu.
jest.mock('./syncEvents', () => ({
  syncEvents: { emit: jest.fn(), on: jest.fn(), off: jest.fn() },
}));

jest.mock('./coordinator', () => ({
  syncCoordinator: {
    pullNow: jest.fn().mockResolvedValue(undefined),
  },
}));

// networkMonitor dimuat saat import coordinator.ts.
jest.mock('../map/networkMonitor', () => ({
  networkMonitor: { getStatus: () => 'offline', subscribe: () => () => {} },
}));

// Adapter LokiJS synchronous in-memory, di-instance per test untuk isolasi.
function buildTestDatabase(): Database {
  const adapter = new LokiJSAdapter({
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
    onSetUpError: (e: Error) => { throw e; },
  });
  return new Database({
    adapter,
    modelClasses: [PendingActionModel, OrderModel],
  });
}

// Pasang database ke module '../db' supaya outbox.ts membaca mock ini.
function installDatabase(db: Database): void {
  jest.doMock('../db', () => ({ database: db }));
}

describe('outbox enqueue - regression prepareCreateFromDirtyRaw with real LokiJS adapter', () => {
  let db: Database;

  beforeEach(() => {
    // resetModules supaya import { database } ulang membaca mock baru.
    jest.resetModules();
    db = buildTestDatabase();
    installDatabase(db);
  });

  it('enqueueReject menulis kolom snake_case action_type, target_order_id, expected_version, idempotency_key, status ke _raw', async () => {
    // Re-import outbox setelah reset modules agar binding database fresh.
    const { enqueueReject: enqueue } = require('./outbox');

    // Seed order dummy.
    await db.write(async () => {
      const preparedOrder = db.get<OrderModel>('orders').prepareCreateFromDirtyRaw({
        id: 'order-reject-1',
        _status: 'synced',
        _changed: '',
        customer_id: 'cust-1',
        driver_id: 'driver-1',
        status: 'ASSIGNED',
        items_json: '[]',
        address_json: '{}',
        total_cents: 25000,
        currency: 'IDR',
        server_version: 7,
        failed_sync_attempts: 0,
      });
      await db.batch(preparedOrder);
    });

    const result = await enqueue('order-reject-1', 7);
    expect(result.success).toBe(true);

    // Baca lewat handle db lokal, bukan lewat import { database } yang
    // sudah di-reset.
    const all = await db.get<PendingActionModel>('pending_actions').query().fetch();
    expect(all).toHaveLength(1);

    const action = all[0];
    expect(action.id).toBe(result.pendingActionId);
    expect(action._getRaw('action_type')).toBe('reject');
    expect(action._getRaw('target_order_id')).toBe('order-reject-1');
    expect(action._getRaw('expected_version')).toBe(7);
    expect(action._getRaw('idempotency_key')).toBe('reject:order-reject-1:driver-regression-test');
    expect(action._getRaw('status')).toBe('pending');
    expect(action._raw._status).toBe('synced');
  });

  it('enqueueCancel menulis payload_json sebagai JSON string (bukan objek)', async () => {
    const { enqueueCancel: enqueue } = require('./outbox');

    const result = await enqueue('order-cancel-1', 3, 'customer tidak ada');
    expect(result.success).toBe(true);

    const all = await db.get<PendingActionModel>('pending_actions').query().fetch();
    expect(all).toHaveLength(1);

    const action = all[0];
    expect(action._getRaw('action_type')).toBe('cancel');
    expect(action._getRaw('target_order_id')).toBe('order-cancel-1');
    expect(action._getRaw('expected_version')).toBe(3);
    // payload_json: string berisi JSON (prepareCreateFromDirtyRaw bypass
    // decorator @json).
    expect(action._getRaw('payload_json')).toBe('{"reason":"customer tidak ada"}');
    expect(typeof action._getRaw('payload_json')).toBe('string');
    expect(action._getRaw('status')).toBe('pending');
  });

  it('enqueueCancel tanpa reason -> payload_json = "{}", tetap string', async () => {
    const { enqueueCancel: enqueue } = require('./outbox');

    const result = await enqueue('order-cancel-no-reason', 1);
    expect(result.success).toBe(true);

    const all = await db.get<PendingActionModel>('pending_actions').query().fetch();
    const action = all[0];
    expect(action._getRaw('payload_json')).toBe('{}');
  });

  it('enqueueCollectCod menulis expected_version=0 (COD tidak butuh version check) dan payload_json.amountCents sebagai JSON', async () => {
    const { enqueueCollectCod: enqueue } = require('./outbox');

    const result = await enqueue('order-cod-1', 50000);
    expect(result.success).toBe(true);

    const all = await db.get<PendingActionModel>('pending_actions').query().fetch();
    const action = all[0];
    expect(action._getRaw('action_type')).toBe('collect_cod');
    expect(action._getRaw('target_order_id')).toBe('order-cod-1');
    expect(action._getRaw('expected_version')).toBe(0);
    expect(action._getRaw('idempotency_key')).toBe('cod:regression-stable');
    expect(action._getRaw('payload_json')).toBe('{"amountCents":50000}');
    expect(action._getRaw('status')).toBe('pending');
  });

  it('Query dengan Q.where("target_order_id", orderId) menemukan row yang baru di-enqueue', async () => {
    // Memastikan drain flow (Q.where('target_order_id', orderId)) match
    // terhadap row yang ditulis enqueue*.
    const { enqueueCancel: enqueue } = require('./outbox');

    await enqueue('order-q-test', 2, 'regress');

    const matched = await db
      .get<PendingActionModel>('pending_actions')
      .query(Q.where('target_order_id', 'order-q-test'))
      .fetch();
    expect(matched).toHaveLength(1);
    expect(matched[0]._getRaw('action_type')).toBe('cancel');
  });

  describe('created_at dan updated_at terisi saat enqueue', () => {
    it('enqueueReject menulis created_at dan updated_at ke _raw (kolom number, bukan undefined)', async () => {
      const { enqueueReject: enqueue } = require('./outbox');

      const before = Date.now();
      await enqueue('order-ts-reject-regress', 5);
      const after = Date.now();

      const all = await db.get<PendingActionModel>('pending_actions').query().fetch();
      const action = all.find((a) => a._getRaw('target_order_id') === 'order-ts-reject-regress');
      expect(action).toBeDefined();

      const createdAt = action!._getRaw('created_at');
      const updatedAt = action!._getRaw('updated_at');
      expect(typeof createdAt).toBe('number');
      expect(typeof updatedAt).toBe('number');
      expect(createdAt).toBeGreaterThanOrEqual(before);
      expect(createdAt).toBeLessThanOrEqual(after);
      expect(updatedAt).toBeGreaterThanOrEqual(before);
      expect(updatedAt).toBeLessThanOrEqual(after);
      // Satu nilai Date.now() untuk dua kolom.
      expect(createdAt).toBe(updatedAt);
    });

    it('enqueueCancel menulis created_at + updated_at', async () => {
      const { enqueueCancel: enqueue } = require('./outbox');

      const before = Date.now();
      await enqueue('order-ts-cancel-regress', 1, 'regress');
      const after = Date.now();

      const all = await db.get<PendingActionModel>('pending_actions').query().fetch();
      const action = all.find((a) => a._getRaw('target_order_id') === 'order-ts-cancel-regress');
      expect(action).toBeDefined();
      expect(action!._getRaw('created_at')).toBeGreaterThanOrEqual(before);
      expect(action!._getRaw('created_at')).toBeLessThanOrEqual(after);
      expect(action!._getRaw('updated_at')).toBe(action!._getRaw('created_at'));
    });

    it('enqueueCollectCod menulis created_at + updated_at', async () => {
      const { enqueueCollectCod: enqueue } = require('./outbox');

      const before = Date.now();
      await enqueue('order-ts-cod-regress', 75000);
      const after = Date.now();

      const all = await db.get<PendingActionModel>('pending_actions').query().fetch();
      const action = all.find((a) => a._getRaw('target_order_id') === 'order-ts-cod-regress');
      expect(action).toBeDefined();
      expect(action!._getRaw('created_at')).toBeGreaterThanOrEqual(before);
      expect(action!._getRaw('created_at')).toBeLessThanOrEqual(after);
      expect(action!._getRaw('updated_at')).toBe(action!._getRaw('created_at'));
    });
  });

  // Aksi update_status dipakai driver untuk Mulai antar dan Selesai diantar
  // lewat outbox. Aksi ditulis seperti enqueue* lain: kolom di _raw, dibuat
  // di dalam satu database.write, created_at terisi.
  describe('enqueueUpdateStatus', () => {
    it('menulis action_type update_status, payload_json, idempotency_key, status pending, dan created_at > 0', async () => {
      const { enqueueUpdateStatus: enqueue } = require('./outbox');

      const result = await enqueue('order-status-regress', 'OUT_FOR_DELIVERY');
      expect(result.success).toBe(true);
      expect(result.pendingActionId).toBeDefined();

      const all = await db.get<PendingActionModel>('pending_actions').query().fetch();
      const action = all.find((a) => a._getRaw('target_order_id') === 'order-status-regress');
      expect(action).toBeDefined();
      expect(action!._getRaw('action_type')).toBe('update_status');
      expect(action!._getRaw('payload_json')).toBe('{"status":"OUT_FOR_DELIVERY"}');
      expect(action!._getRaw('idempotency_key')).toBe('status:order-status-regress:OUT_FOR_DELIVERY');
      expect(action!._getRaw('status')).toBe('pending');
      expect(action!._getRaw('created_at')).toBeGreaterThan(0);
      expect(action!._raw._status).toBe('synced');
    });

    it('pemanggilan kedua dengan target sama: tidak menambah baris, kembalikan id yang sama', async () => {
      const { enqueueUpdateStatus: enqueue } = require('./outbox');

      const first = await enqueue('order-dup-status', 'DELIVERED');
      const second = await enqueue('order-dup-status', 'DELIVERED');

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(second.pendingActionId).toBe(first.pendingActionId);

      const matched = await db
        .get<PendingActionModel>('pending_actions')
        .query(Q.where('target_order_id', 'order-dup-status'))
        .fetch();
      expect(matched).toHaveLength(1);
    });

    it('target DELIVERED untuk order yang sama: membuat baris baru (idempotency_key beda)', async () => {
      const { enqueueUpdateStatus: enqueue } = require('./outbox');

      await enqueue('order-chain', 'OUT_FOR_DELIVERY');
      await enqueue('order-chain', 'DELIVERED');

      const matched = await db
        .get<PendingActionModel>('pending_actions')
        .query(Q.where('target_order_id', 'order-chain'))
        .fetch();
      expect(matched).toHaveLength(2);
      const targets = matched.map((a) => a._getRaw('idempotency_key')).sort();
      expect(targets).toEqual([
        'status:order-chain:DELIVERED',
        'status:order-chain:OUT_FOR_DELIVERY',
      ]);
    });
  });

  // Umur aksi dihitung dari created_at yang dibaca lewat getter model, jadi
  // baris aksi dibuat di database Loki sungguhan.
  describe('umur aksi dengan model asli', () => {
    // Bantu: seed satu aksi dengan waktu dibuat dan status yang dikehendaki.
    async function seedAction(
      orderId: string,
      createdAt: number,
      status: 'pending' | 'syncing' | 'failed' = 'pending',
    ): Promise<PendingActionModel> {
      const actionId = `pa-umur-${orderId}`;
      await db.write(async () => {
        const prepared = db.get<PendingActionModel>('pending_actions').prepareCreateFromDirtyRaw({
          id: actionId,
          _status: 'synced',
          _changed: '',
          action_type: 'collect_cod',
          target_order_id: orderId,
          expected_version: 0,
          idempotency_key: `cod:${orderId}`,
          payload_json: JSON.stringify({ amountCents: 50000 }),
          status,
          created_at: createdAt,
          updated_at: createdAt,
        });
        await db.batch(prepared);
      });
      return db.get<PendingActionModel>('pending_actions').find(actionId);
    }

    it('aksi baru dari enqueueCollectCod tidak basi', async () => {
      const { enqueueCollectCod: enqueue, isPendingActionStale } = require('./outbox');

      await enqueue('order-umur-baru', 50000);

      const all = await db.get<PendingActionModel>('pending_actions').query().fetch();
      const action = all.find((a) => a._getRaw('target_order_id') === 'order-umur-baru');
      expect(action).toBeDefined();
      expect(isPendingActionStale(action)).toBe(false);
    });

    it('umur tepat 60 menit belum basi, lewat 1 milidetik basi', async () => {
      const { getPendingActionAgeMs, isPendingActionStale } = require('./outbox');

      const now = 1700000000000;
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
      try {
        const tepat = await seedAction('order-umur-tepat', now - 60 * 60 * 1000);
        expect(getPendingActionAgeMs(tepat)).toBe(60 * 60 * 1000);
        expect(isPendingActionStale(tepat)).toBe(false);

        const lewat = await seedAction('order-umur-lewat', now - 60 * 60 * 1000 - 1);
        expect(getPendingActionAgeMs(lewat)).toBe(60 * 60 * 1000 + 1);
        expect(isPendingActionStale(lewat)).toBe(true);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('hasStalePendingAction: aksi lama berstatus pending atau syncing dihitung, failed tidak', async () => {
      const { hasStalePendingAction } = require('./outbox');

      const now = 1700000000000;
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
      try {
        await seedAction('order-umur-pending', now - 61 * 60 * 1000, 'pending');
        await seedAction('order-umur-syncing', now - 61 * 60 * 1000, 'syncing');
        await seedAction('order-umur-failed', now - 61 * 60 * 1000, 'failed');

        expect(await hasStalePendingAction('order-umur-pending')).toBe(true);
        expect(await hasStalePendingAction('order-umur-syncing')).toBe(true);
        expect(await hasStalePendingAction('order-umur-failed')).toBe(false);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('hasStalePendingAction: aksi yang masih baru tidak dihitung', async () => {
      const { hasStalePendingAction } = require('./outbox');

      const now = 1700000000000;
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
      try {
        await seedAction('order-umur-segar', now - 1000, 'pending');
        expect(await hasStalePendingAction('order-umur-segar')).toBe(false);
      } finally {
        nowSpy.mockRestore();
      }
    });
  });
});
