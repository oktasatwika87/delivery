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

    // Seed order dummy supaya find() tidak throw (enqueueReject juga
    // update order row).
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
});
