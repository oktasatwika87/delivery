/**
 * Unit tests for Pending Actions Outbox: enqueue and drain logic.
 */

// Shared state
const mockState = {
  records: new Map<string, any>(),
  // Orders collection, track state untuk assertions lastConflictReason/lastConflictAt
  orders: new Map<string, any>(),
  // Koleksi payments, untuk memeriksa baris payment dari COD sukses dan 409 COD_ALREADY_CAPTURED
  payments: new Map<string, any>(),
  batchOps: [] as Array<{ type: string; row: any; fn?: (r: any) => void }>,
  // Per-test query overrides
  queryOverrides: [] as Array<{ matcher: string; results: any[] }>,
};

function clearMockState() {
  mockState.records.clear();
  mockState.orders.clear();
  mockState.payments.clear();
  mockState.batchOps = [];
  mockState.queryOverrides = [];
}

function attachMethods(row: any) {
  row.prepareUpdate = function(fn: (r: any) => void) {
    mockState.batchOps.push({ type: 'update', row, fn });
    return row;
  };
  row.update = async function(fn: (r: any) => void) {
    fn(row);
    return row;
  };
  // Tiruan _setRaw meniru WatermelonDB: kalau nilai kolom berubah dan
  // _status bukan 'created', baris ditandai 'updated' dan nama kolom
  // ditambahkan ke _changed. Tanpa ini, tes "baris tidak kotor" akan
  // lolos walaupun _status dan _changed tidak ditutup setelah _setRaw.
  row._setRaw = function(column: string, value: unknown) {
    if (!row._raw) row._raw = {};
    if (row._raw[column] === value) return;
    row._raw[column] = value;
    if (row._raw._status !== 'created') {
      row._raw._status = 'updated';
      const changed = row._raw._changed ? String(row._raw._changed).split(',') : [];
      if (!changed.includes(column)) {
        changed.push(column);
        row._raw._changed = changed.join(',');
      }
    }
  };
  row.prepareDestroyPermanently = function() {
    // Prepared destroy op, batch() detects _isDestroy dan remove from map.
    return { _isDestroy: true, _targetRow: row, id: row.id };
  };
  row.destroyPermanently = async function() {
    // mockState.records keys are arbitrary test labels, not row.id, so
    // delete by reference identity rather than by row.id.
    for (const [key, val] of mockState.records) {
      if (val === row) {
        mockState.records.delete(key);
        break;
      }
    }
    // Also remove from orders collection if applicable
    for (const [key, val] of mockState.orders) {
      if (val === row) {
        mockState.orders.delete(key);
        break;
      }
    }
    return row;
  };
  return row;
}

// Create simple record for testing
function makeRecord(overrides: any = {}) {
  return {
    id: 'test-' + Math.random().toString(36).slice(2),
    _raw: { id: 'test-raw', _status: 'synced' },
    actionType: 'reject',
    targetOrderId: 'order-test',
    expectedVersion: 1,
    idempotencyKey: 'key-test',
    payloadJson: null,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// Mocks
jest.mock('./session', () => ({
  getCurrentUserId: jest.fn().mockResolvedValue('driver-123'),
}));

jest.mock('./client', () => {
  // requireActual untuk preserve class identity, dipakai test isVersionConflict
  // untuk instantiate ApiError langsung. rejectOrder/cancelOrder/collectCodOrder
  // /flagOrphanedCod di-override dengan jest.fn() karena outbox.ts cuma butuh
  // side effect-nya, bukan implementasinya.
  const actual = jest.requireActual('./client');
  return {
    ...actual,
    rejectOrder: jest.fn(),
    cancelOrder: jest.fn(),
    collectCodOrder: jest.fn(),
    flagOrphanedCod: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock('./idempotency', () => ({
  generateCodIdempotencyKey: jest.fn().mockResolvedValue('cod:test-uuid-123'),
}));

jest.mock('./syncEvents', () => ({
  syncEvents: { emit: jest.fn(), on: jest.fn(), off: jest.fn() },
}));

jest.mock('./coordinator', () => ({
  syncCoordinator: { pullNow: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../db', () => ({
  database: {
    get(name: string) {
      if (name === 'orders') {
        // Orders collection, track state via mockState.orders untuk
        // assertions di handleVersionConflict tests (lastConflictReason,
        // lastConflictAt). Method mirror pending_actions pattern supaya
        // find/prepareUpdate/prepareDestroyPermanently seragam.
        //
        // Backward compat: kalau order belum ada di mockState.orders,
        // auto-create stub supaya existing tests (enqueueReject/Cancel/
        // CollectCod yang tidak pre-populate order) tetap jalan. Tests
        // baru di handleVersionConflict suite pre-populate order secara
        // eksplisit sebelum drain.
        return {
          async find(id: string) {
            let r = mockState.orders.get(id);
            if (!r) {
              r = {
                id,
                _raw: { id, _status: 'synced' },
              };
              mockState.orders.set(id, r);
            }
            return attachMethods(r);
          },
          prepareCreateFromDirtyRaw(dirtyRaw: any) {
            const row = {
              id: dirtyRaw.id,
              _raw: { id: dirtyRaw.id, _status: dirtyRaw._status ?? 'synced' },
              ...dirtyRaw,
            };
            return row;
          },
        };
      }
      if (name === 'payments') {
        // Koleksi payments, polanya sama dengan orders. Tes bisa mengisi baris
        // lebih dulu untuk kasus payment yang sudah dibawa pull.
        return {
          async find(id: string) {
            let r = mockState.payments.get(id);
            if (!r) throw new Error(`Payment ${id} not found`);
            return attachMethods(r);
          },
          prepareCreateFromDirtyRaw(dirtyRaw: any) {
            // Semua kunci snake_case masuk ke _raw seperti di WatermelonDB.
            // Tiruan batch memakai kolom method, amount_cents, atau kind untuk
            // mengenali baris payment.
            const raw: any = {
              id: dirtyRaw.id,
              _status: dirtyRaw._status ?? 'synced',
              _changed: dirtyRaw._changed ?? '',
            };
            for (const [k, v] of Object.entries(dirtyRaw)) {
              if (k === 'id' || k === '_status' || k === '_changed') continue;
              raw[k] = v;
            }
            const row = { id: dirtyRaw.id, _raw: raw, ...dirtyRaw };
            return row;
          },
        };
      }
      // pending_actions collection with query that filters
      return {
        async find(id: string) {
          const r = mockState.records.get(id);
          if (!r) throw new Error('Not found');
          return attachMethods(r);
        },
        query(...args: any[]) {
          // outbox.ts only ever queries pending_actions with two column
          // patterns: Q.where('target_order_id', ...) and
          // Q.where('status', ...). Map those DB column names to the
          // record's (camelCase) JS property names, this is deliberately
          // NOT a general-purpose Q parser, just these two known patterns.
          const columnToProp: Record<string, string> = {
            target_order_id: 'targetOrderId',
            status: 'status',
          };
          // Parse Q.where conditions: { type: 'where', left: 'col', comparison: { operator, right: { value } }
          const conds = args.filter((a: any) => a?.type === 'where');
          function match(rec: any): boolean {
            if (conds.length === 0) return true; // no conditions = return all
            for (const c of conds) {
              const col = c.left;
              const comp = c.comparison;
              if (!col || !comp) continue;
              const prop = columnToProp[col] ?? col;
              const vals = comp.right?.values ?? comp.right?.value;
              const recVal = rec[prop];
              if (Array.isArray(vals)) { if (!vals.includes(recVal)) return false; }
              else if (vals !== undefined) { if (recVal !== vals) return false; }
            }
            return true;
          }
          return {
            fetch() { return [...mockState.records.values()].filter(match).map(attachMethods); },
            fetchCount() { return [...mockState.records.values()].filter(match).length; },
            extend() { return this; },
          };
        },
        async create(fn: (row: any) => void) {
          const row = makeRecord();
          fn(row);
          mockState.records.set(row.id, row);
          return attachMethods(row);
        },
        prepareCreateFromDirtyRaw(dirtyRaw: any) {
          // Baca kunci snake_case saja - sesuai tableSchema.columnArray
          // yang diiterasi sanitizedRaw. Kunci tak dikenal di-drop,
          // jadi camelCase dari caller bikin isi _raw undefined.
          const row = {
            id: dirtyRaw.id,
            _raw: {
              id: dirtyRaw.id,
              _status: dirtyRaw._status,
              action_type: dirtyRaw.action_type,
              target_order_id: dirtyRaw.target_order_id,
              expected_version: dirtyRaw.expected_version,
              idempotency_key: dirtyRaw.idempotency_key,
              payload_json: dirtyRaw.payload_json,
              status: dirtyRaw.status,
              // disalin supaya tes bisa memeriksa created_at dan updated_at dari enqueue*.
              created_at: dirtyRaw.created_at,
              updated_at: dirtyRaw.updated_at,
            },
            status: dirtyRaw.status,
          };
          return row;
        },
      };
    },
    async write<T>(fn: () => Promise<T>): Promise<T> {
      for (const op of mockState.batchOps) {
        if (op.type === 'update' && op.fn) op.fn(op.row);
      }
      mockState.batchOps = [];
      return fn();
    },
    async batch(...ops: unknown[]) {
      // Process prepared records, store them in records map.
      // Also handle _isDestroy prepared ops (delete by reference identity).
      //
      // Backward compat: process pending batchOps yang di-queue via
      // prepareUpdate. Pola lama: prepareUpdate jadi db.write (yang
      // pre-iterate batchOps di mock). Pola baru: prepareUpdate
      // di dalam writer fn ke db.batch (yang process batchOps di sini).
      // Handle keduanya supaya single-batch pattern handleVersionConflict
      // (yang call prepareUpdate sebelum db.batch) jalan benar.
      for (const op of mockState.batchOps) {
        if (op.type === 'update' && op.fn) op.fn(op.row);
      }
      mockState.batchOps = [];

      for (const op of ops) {
        const prepared = op as any;
        if (prepared && prepared._isDestroy && prepared._targetRow) {
          // Hapus permanen: baris dibuang dari records, orders, atau payments.
          for (const [key, val] of mockState.records) {
            if (val === prepared._targetRow) {
              mockState.records.delete(key);
              break;
            }
          }
          for (const [key, val] of mockState.orders) {
            if (val === prepared._targetRow) {
              mockState.orders.delete(key);
              break;
            }
          }
          for (const [key, val] of mockState.payments) {
            if (val === prepared._targetRow) {
              mockState.payments.delete(key);
              break;
            }
          }
        } else if (prepared && prepared.id) {
          // Baris dimasukkan ke koleksinya berdasarkan kolom di _raw:
          // action_type atau target_order_id untuk pending_actions; method,
          // amount_cents, atau kind untuk payments; sisanya orders. Baris
          // payment baru dengan id yang sudah ada ditolak, seperti database
          // sungguhan.
          const raw = prepared._raw ?? {};
          if ('action_type' in raw || 'target_order_id' in raw) {
            mockState.records.set(prepared.id, prepared);
          } else if ('method' in raw || 'amount_cents' in raw || 'kind' in raw) {
            const existing = mockState.payments.get(prepared.id);
            if (existing && existing !== prepared) {
              throw new Error(`Payment ${prepared.id} already exists`);
            }
            mockState.payments.set(prepared.id, prepared);
          } else {
            mockState.orders.set(prepared.id, prepared);
          }
        }
      }
    },
  },
}));

// Imports
import {
  enqueueReject,
  enqueueCancel,
  enqueueCollectCod,
  hasPendingAction,
  drainPendingActions,
  getPendingActionsForOrder,
  isPendingActionStale,
  getPendingActionAgeMs,
  hasStalePendingAction,
  isVersionConflict,
  retryFailedAction,
  discardFailedAction,
  STALE_THRESHOLD_MS,
} from './outbox';
import { rejectOrder, cancelOrder, collectCodOrder, ApiError, UnauthorizedError } from './client';
import { syncEvents } from './syncEvents';

const mockRejectOrder = rejectOrder as jest.MockedFunction<typeof rejectOrder>;
const mockCancelOrder = cancelOrder as jest.MockedFunction<typeof cancelOrder>;
const mockCollectCodOrder = collectCodOrder as jest.MockedFunction<typeof collectCodOrder>;

describe('outbox', () => {
  beforeEach(() => { clearMockState(); jest.clearAllMocks(); });

  describe('enqueueReject()', () => {
    test('creates pending_action row with correct fields', async () => {
      const result = await enqueueReject('order-abc', 5);
      expect(result.success).toBe(true);
      expect(result.pendingActionId).toBeDefined();
      const actions = [...mockState.records.values()];
      expect(actions).toHaveLength(1);
      expect(actions[0]._raw.action_type).toBe('reject');
      expect(actions[0]._raw.target_order_id).toBe('order-abc');
      expect(actions[0]._raw.expected_version).toBe(5);
      expect(actions[0]._raw.status).toBe('pending');
    });

    test('returns error when not authenticated', async () => {
      const { getCurrentUserId } = require('./session');
      (getCurrentUserId as jest.Mock).mockResolvedValueOnce(null);
      const result = await enqueueReject('order-xyz', 3);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not authenticated');
    });

    test('sets created_at and updated_at to the same current timestamp', async () => {
      const before = Date.now();
      await enqueueReject('order-ts-reject', 1);
      const after = Date.now();

      const actions = [...mockState.records.values()];
      expect(actions).toHaveLength(1);
      const raw = actions[0]._raw;
      expect(raw.created_at).toBeGreaterThanOrEqual(before);
      expect(raw.created_at).toBeLessThanOrEqual(after);
      expect(raw.updated_at).toBeGreaterThanOrEqual(before);
      expect(raw.updated_at).toBeLessThanOrEqual(after);
      // Satu nilai Date.now() berlaku untuk dua kolom ini.
      expect(raw.created_at).toBe(raw.updated_at);
    });
  });

  describe('enqueueCancel()', () => {
    test('creates pending_action row with reason in payload', async () => {
      const result = await enqueueCancel('order-xyz', 7, 'Customer tidak ada di lokasi');
      expect(result.success).toBe(true);
      const actions = [...mockState.records.values()];
      // payload_json: string berisi JSON (prepareCreateFromDirtyRaw bypass @json decorator).
      expect(actions[0]._raw.action_type).toBe('cancel');
      expect(actions[0]._raw.payload_json).toBe('{"reason":"Customer tidak ada di lokasi"}');
    });

    test('creates pending_action row without reason', async () => {
      const result = await enqueueCancel('order-no-reason', 1);
      expect(result.success).toBe(true);
      // payload_json: '{}' saat tanpa reason.
      expect([...mockState.records.values()][0]._raw.payload_json).toBe('{}');
    });

    test('sets created_at and updated_at to the same current timestamp', async () => {
      const before = Date.now();
      await enqueueCancel('order-ts-cancel', 1);
      const after = Date.now();

      const actions = [...mockState.records.values()];
      expect(actions).toHaveLength(1);
      const raw = actions[0]._raw;
      expect(raw.created_at).toBeGreaterThanOrEqual(before);
      expect(raw.created_at).toBeLessThanOrEqual(after);
      expect(raw.updated_at).toBeGreaterThanOrEqual(before);
      expect(raw.updated_at).toBeLessThanOrEqual(after);
      expect(raw.created_at).toBe(raw.updated_at);
    });
  });

  describe('enqueueCollectCod()', () => {
    test('creates pending_action row with amountCents in payload', async () => {
      const result = await enqueueCollectCod('order-cod', 50000);
      expect(result.success).toBe(true);
      const actions = [...mockState.records.values()];
      // payload_json: JSON.stringify dari payload - string, bukan objek.
      expect(actions[0]._raw.action_type).toBe('collect_cod');
      expect(actions[0]._raw.payload_json).toBe('{"amountCents":50000}');
      expect(actions[0]._raw.idempotency_key).toBe('cod:test-uuid-123');
    });

    test('sets created_at and updated_at to the same current timestamp', async () => {
      const before = Date.now();
      await enqueueCollectCod('order-ts-cod', 50000);
      const after = Date.now();

      const actions = [...mockState.records.values()];
      expect(actions).toHaveLength(1);
      const raw = actions[0]._raw;
      expect(raw.created_at).toBeGreaterThanOrEqual(before);
      expect(raw.created_at).toBeLessThanOrEqual(after);
      expect(raw.updated_at).toBeGreaterThanOrEqual(before);
      expect(raw.updated_at).toBeLessThanOrEqual(after);
      expect(raw.created_at).toBe(raw.updated_at);
    });
  });

  describe('REGRESSION: prepareCreateFromDirtyRaw pattern', () => {
    test('enqueueReject creates record with id from prepareCreateFromDirtyRaw', async () => {
      const result = await enqueueReject('order-reg-reject', 3);

      expect(result.success).toBe(true);
      expect(result.pendingActionId).toBeDefined();

      // Record should be in mockState.records with the returned pendingActionId
      const actions = [...mockState.records.values()];
      expect(actions.some(a => a.id === result.pendingActionId)).toBe(true);
      // Baca _raw langsung - mock prepareCreateFromDirtyRaw hanya isi snake_case.
      expect(actions.some(a => a._raw.action_type === 'reject')).toBe(true);
    });

    test('enqueueCancel creates record with id from prepareCreateFromDirtyRaw', async () => {
      const result = await enqueueCancel('order-reg-cancel', 7, 'Alasan test');

      expect(result.success).toBe(true);
      expect(result.pendingActionId).toBeDefined();

      // Record should be in mockState.records with the returned pendingActionId
      const actions = [...mockState.records.values()];
      expect(actions.some(a => a.id === result.pendingActionId)).toBe(true);
      expect(actions.some(a => a._raw.action_type === 'cancel')).toBe(true);
    });

    test('enqueueCollectCod creates record with id from prepareCreateFromDirtyRaw', async () => {
      const result = await enqueueCollectCod('order-reg-cod', 75000);

      expect(result.success).toBe(true);
      expect(result.pendingActionId).toBeDefined();

      // Record should be in mockState.records with the returned pendingActionId
      const actions = [...mockState.records.values()];
      expect(actions.some(a => a.id === result.pendingActionId)).toBe(true);
      expect(actions.some(a => a._raw.action_type === 'collect_cod')).toBe(true);
    });

    test('enqueueReject pendingActionId is valid UUID format', async () => {
      const result = await enqueueReject('order-uuid-check', 1);

      expect(result.success).toBe(true);
      expect(result.pendingActionId).toBeDefined();
      // UUID v4 format
      expect(result.pendingActionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

      // The record in mockState should have this exact UUID as id
      const record = mockState.records.get(result.pendingActionId!);
      expect(record).toBeDefined();
      expect(record.id).toBe(result.pendingActionId);
    });

    test('enqueueCancel pendingActionId is valid UUID format', async () => {
      const result = await enqueueCancel('order-uuid-check-2', 2);

      expect(result.success).toBe(true);
      expect(result.pendingActionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    test('enqueueCollectCod pendingActionId is valid UUID format', async () => {
      const result = await enqueueCollectCod('order-uuid-check-3', 100000);

      expect(result.success).toBe(true);
      expect(result.pendingActionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
  });

  describe('hasPendingAction()', () => {
    test('returns true when pending actions exist', async () => {
      mockState.records.set('pending-1', makeRecord({ targetOrderId: 'order-pending', status: 'pending' }));
      const result = await hasPendingAction('order-pending');
      expect(result).toBe(true);
    });

    test('returns false when no pending actions', async () => {
      const result = await hasPendingAction('order-none');
      expect(result).toBe(false);
    });

    test('returns false for orphaned_needs_review actions', async () => {
      mockState.records.set('orphaned-action', makeRecord({ targetOrderId: 'order-orphaned', status: 'orphaned_needs_review' }));
      const result = await hasPendingAction('order-orphaned');
      expect(result).toBe(false);
    });
  });

  describe('getPendingActionsForOrder()', () => {
    test('returns all pending actions for an order', async () => {
      mockState.records.set('multi-1', makeRecord({ actionType: 'reject', targetOrderId: 'order-multi' }));
      mockState.records.set('multi-2', makeRecord({ actionType: 'cancel', targetOrderId: 'order-multi' }));
      const actions = await getPendingActionsForOrder('order-multi');
      expect(actions).toHaveLength(2);
    });
  });

  describe('drainPendingActions()', () => {
    test('success: deletes pending_action after successful sync', async () => {
      const action = makeRecord({ actionType: 'reject', targetOrderId: 'order-success', expectedVersion: 3 });
      mockState.records.set('success-action', action);
      attachMethods(action);
      mockRejectOrder.mockResolvedValue({ id: 'order-success', status: 'ASSIGNED', version: 4 } as any);
      const results = await drainPendingActions();
      expect(results[0].status).toBe('success');
      expect(mockState.records.has('success-action')).toBe(false);
    });

    test('conflict: marks action failed, emits conflict event', async () => {
      const action = makeRecord({ actionType: 'reject', targetOrderId: 'order-conflict', expectedVersion: 3 });
      mockState.records.set('conflict-action', action);
      attachMethods(action);
      mockRejectOrder.mockRejectedValue(
        new ApiError(
          'rejectOrder failed: 409 - body',
          409,
          'VERSION_CONFLICT',
          { code: 'VERSION_CONFLICT', message: 'm' },
        ),
      );
      const results = await drainPendingActions();
      expect(results[0].status).toBe('conflict');
      expect(syncEvents.emit).toHaveBeenCalledWith('orderConflict', expect.objectContaining({ orderId: 'order-conflict' }));
    });

    test('orphaned COD: marks status orphaned_needs_review, does NOT delete', async () => {
      const action = makeRecord({ actionType: 'collect_cod', targetOrderId: 'order-orphaned', idempotencyKey: 'cod:key', payloadJson: { amountCents: 30000 } });
      mockState.records.set('orphaned-action', action);
      attachMethods(action);
      mockCollectCodOrder.mockRejectedValue(
        new ApiError(
          'collectCodOrder failed: 404 - body',
          404,
          undefined,
          { message: 'not found' },
        ),
      );
      const results = await drainPendingActions();
      expect(results[0].status).toBe('orphaned');
      expect(mockState.records.get('orphaned-action')!.status).toBe('orphaned_needs_review');
    });

    test('network error: keeps action as pending for retry (never gives up)', async () => {
      const action = makeRecord({ actionType: 'cancel', targetOrderId: 'order-network-fail', payloadJson: { reason: 'Test' }});
      mockState.records.set('network-action', action);
      attachMethods(action);
      mockCancelOrder.mockRejectedValue(new Error('Network request failed'));
      const results = await drainPendingActions();
      expect(results[0].status).toBe('failed');
      // CRITICAL: action must stay as 'pending' so it retries on next drain
      expect(mockState.records.get('network-action')!.status).toBe('pending');
    });

    test('retry persists indefinitely: action is still picked up after multiple drain cycles', async () => {
      const action = makeRecord({ actionType: 'reject', targetOrderId: 'order-retry', expectedVersion: 3 });
      mockState.records.set('retry-action', action);
      attachMethods(action);

      // First drain: fail
      mockRejectOrder.mockRejectedValue(new Error('fail'));
      const results1 = await drainPendingActions();
      expect(results1[0].status).toBe('failed');

      // Simulate reconnect - drain again WITHOUT manually resetting status
      mockRejectOrder.mockClear();
      mockRejectOrder.mockRejectedValue(new Error('still failing'));
      const results2 = await drainPendingActions();
      expect(results2[0].status).toBe('failed');

      // Third try - now succeed
      mockRejectOrder.mockClear();
      mockRejectOrder.mockResolvedValue({ id: 'order-retry', status: 'ASSIGNED', version: 4 } as any);
      const results3 = await drainPendingActions();
      expect(results3[0].status).toBe('success');
      // Action should now be deleted
      expect(mockState.records.has('retry-action')).toBe(false);
    });

    test('idempotency key stability: same key used on retry', async () => {
      const action = makeRecord({ actionType: 'collect_cod', targetOrderId: 'order-idempotent', idempotencyKey: 'cod:stable-key-123', payloadJson: { amountCents: 40000 } });
      mockState.records.set('idempotent-action', action);
      attachMethods(action);
      // First try fails - action stays pending automatically
      mockCollectCodOrder.mockRejectedValueOnce(new Error('fail'));
      const results1 = await drainPendingActions();
      expect(results1[0].status).toBe('failed');
      // Status was reset to 'pending' automatically by resetActionForRetry
      expect(mockState.records.get('idempotent-action')!.status).toBe('pending');

      // Second try succeeds - no manual status reset needed
      mockCollectCodOrder.mockClear();
      mockCollectCodOrder.mockResolvedValue({ id: 'order-idempotent', status: 'CAPTURED', version: 5 } as any);
      const results2 = await drainPendingActions();
      expect(results2[0].status).toBe('success');
      expect(mockCollectCodOrder).toHaveBeenCalledWith('order-idempotent', 40000, 'cod:stable-key-123');
    });

    // Setelah reject/cancel sukses, server kembalikan
    // response { status:'ASSIGNED', driverId:null, version, ... } dan
    // baris lokal order harus ter-update dari response (single batch
    // dengan delete pending_action). Tanpa ini, pool fetch berikutnya
    // filter status=ASSIGNED + driverId null, jadi order tidak muncul
    // lagi di pool setelah reject offline.
    test('reject success, tulis baris lokal dari response (status=ASSIGNED, driverId null)', async () => {
      // Setup order lokal dengan status ASSIGNED + driverId terisi
      // (driver sudah accept, lalu offline, tap reject)
      const order = {
        id: 'order-k15-reject',
        _raw: { id: 'order-k15-reject', _status: 'synced' },
        status: 'PREPARING',
        serverVersion: 3,
        driverId: 'driver-123',
      };
      mockState.orders.set('order-k15-reject', order);

      const action = makeRecord({
        actionType: 'reject',
        targetOrderId: 'order-k15-reject',
        expectedVersion: 3,
      });
      mockState.records.set('k15-reject-action', action);
      attachMethods(action);

      // Server response setelah releaseToPool: status ASSIGNED,
      // driverId null, version incremented
      mockRejectOrder.mockResolvedValue({
        id: 'order-k15-reject',
        status: 'ASSIGNED',
        driverId: null,
        version: 4,
      } as any);

      await drainPendingActions();

      // Pending action harus ter-delete
      expect(mockState.records.has('k15-reject-action')).toBe(false);

      // Order row harus reflect response: status ASSIGNED, driver_id null,
      // server_version baru. _setRaw mock menulis ke _raw[column].
      const updatedOrder = mockState.orders.get('order-k15-reject')!;
      expect(updatedOrder._raw.status).toBe('ASSIGNED');
      expect(updatedOrder._raw.driver_id).toBeNull();
      expect(updatedOrder._raw.server_version).toBe(4);
      // Reject bukan pembatalan, cancelled_by/cancel_reason harus null
      expect(updatedOrder._raw.cancelled_by).toBeNull();
      expect(updatedOrder._raw.cancel_reason).toBeNull();

      // pool-refresh harus ter-emit supaya OrdersScreen fetch ulang
      expect(syncEvents.emit).toHaveBeenCalledWith(
        'pool-refresh',
        expect.objectContaining({ orderId: 'order-k15-reject' }),
      );
    });

    test('cancel success, tulis baris lokal (ASSIGNED + cancelledBy/cancelReason dari response)', async () => {
      const order = {
        id: 'order-k15-cancel',
        _raw: { id: 'order-k15-cancel', _status: 'synced' },
        status: 'PREPARING',
        serverVersion: 5,
        driverId: 'driver-123',
      };
      mockState.orders.set('order-k15-cancel', order);

      const action = makeRecord({
        actionType: 'cancel',
        targetOrderId: 'order-k15-cancel',
        expectedVersion: 5,
        payloadJson: { reason: 'Customer tidak ada di lokasi' },
      });
      mockState.records.set('k15-cancel-action', action);
      attachMethods(action);

      // Server response: status ASSIGNED (pool state), driverId null,
      // version incremented, cancelledBy + cancelReason diset oleh server
      mockCancelOrder.mockResolvedValue({
        id: 'order-k15-cancel',
        status: 'ASSIGNED',
        driverId: null,
        version: 6,
        cancelledBy: 'driver-123',
        cancelReason: 'Customer tidak ada di lokasi',
      } as any);

      await drainPendingActions();

      expect(mockState.records.has('k15-cancel-action')).toBe(false);

      const updatedOrder = mockState.orders.get('order-k15-cancel')!;
      expect(updatedOrder._raw.status).toBe('ASSIGNED');
      expect(updatedOrder._raw.driver_id).toBeNull();
      expect(updatedOrder._raw.server_version).toBe(6);
      // Cancel menyimpan cancelledBy/cancelReason untuk UI banner
      expect(updatedOrder._raw.cancelled_by).toBe('driver-123');
      expect(updatedOrder._raw.cancel_reason).toBe('Customer tidak ada di lokasi');

      expect(syncEvents.emit).toHaveBeenCalledWith(
        'pool-refresh',
        expect.objectContaining({ orderId: 'order-k15-cancel' }),
      );
    });

    test('reject success tapi order tidak ada lokal, no crash, hanya delete pending_action', async () => {
      // Order TIDAK ada di mockState.orders (kasus langka: server data
      // belum di-pull sebelum sync berikutnya). Pastikan processReject
      // skip update order row tanpa throw.
      const action = makeRecord({
        actionType: 'reject',
        targetOrderId: 'order-not-local',
        expectedVersion: 1,
      });
      mockState.records.set('k15-orphan-action', action);
      attachMethods(action);

      mockRejectOrder.mockResolvedValue({
        id: 'order-not-local',
        status: 'ASSIGNED',
        driverId: null,
        version: 2,
      } as any);

      const results = await drainPendingActions();
      expect(results[0].status).toBe('success');

      // Pending action tetap ter-delete
      expect(mockState.records.has('k15-orphan-action')).toBe(false);

      // pool-refresh tetap ter-emit, server tahu order ada lagi
      expect(syncEvents.emit).toHaveBeenCalledWith(
        'pool-refresh',
        expect.objectContaining({ orderId: 'order-not-local' }),
      );
    });

    test('processes actions in FIFO order (oldest first)', async () => {
      const action1 = makeRecord({ actionType: 'reject', targetOrderId: 'order-fifo', createdAt: Date.now() - 100 });
      const action2 = makeRecord({ actionType: 'cancel', targetOrderId: 'order-fifo' });
      mockState.records.set('first-action', action1);
      mockState.records.set('second-action', action2);
      attachMethods(action1);
      attachMethods(action2);
      mockRejectOrder.mockResolvedValue({ id: 'order-fifo', status: 'ASSIGNED', version: 2 } as any);
      mockCancelOrder.mockResolvedValue({ id: 'order-fifo', status: 'ASSIGNED', version: 3 } as any);
      const results = await drainPendingActions();
      expect(results).toHaveLength(2);
      expect(mockRejectOrder.mock.invocationCallOrder[0]).toBeLessThan(mockCancelOrder.mock.invocationCallOrder[0]);
    });

    // drainPendingActions berjalan berurutan: panggilan kedua menunggu yang
    // pertama selesai, lalu membaca ulang pending_actions. Tanpa antrean, dua
    // panggilan yang mulai bersamaan sama-sama melihat aksi itu dan
    // mengirimnya dua kali.
    test('dua drainPendingActions bersamaan: API terpanggil sekali', async () => {
      const action = makeRecord({ actionType: 'reject', targetOrderId: 'order-dedup', expectedVersion: 1 });
      mockState.records.set('dedup-action', action);
      attachMethods(action);
      let concurrentCalls = 0;
      let release: () => void = () => {};
      const blocker = new Promise<void>((resolve) => { release = resolve; });
      mockRejectOrder.mockImplementation(async () => {
        concurrentCalls += 1;
        await blocker;
        concurrentCalls -= 1;
        return { id: 'order-dedup', status: 'ASSIGNED', version: 2 };
      });

      const firstDrain = drainPendingActions();
      // Panggilan kedua dimulai sebelum yang pertama sempat menandai aksi
      // 'syncing'.
      const secondDrain = drainPendingActions();

      // Lepas tiruan API supaya panggilan pertama selesai.
      release();
      await firstDrain;
      // Panggilan kedua jalan sesudahnya dan tidak menemukan aksi (sudah
      // dihapus), jadi API tidak dipanggil lagi.
      await secondDrain;

      expect(mockRejectOrder).toHaveBeenCalledTimes(1);
    });

    // Aksi yang tertinggal 'syncing' karena aplikasi mati di tengah pengiriman
    // harus ikut dikirim.
    test('aksi syncing sisa pengiriman yang terputus ikut dikirim', async () => {
      const action = makeRecord({ actionType: 'reject', targetOrderId: 'order-stuck-syncing', expectedVersion: 1, status: 'syncing' });
      mockState.records.set('stuck-syncing', action);
      attachMethods(action);
      mockRejectOrder.mockResolvedValue({ id: 'order-stuck-syncing', status: 'ASSIGNED', version: 2 });

      const results = await drainPendingActions();

      // Dikirim walaupun statusnya 'syncing', bukan 'pending'.
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('success');
      expect(mockRejectOrder).toHaveBeenCalledTimes(1);
    });
  });

  // Temuan 1 (Skenario A): handleVersionConflict di outbox.ts menulis
  // persisted banner signal (lastConflictReason + lastConflictAt) HANYA
  // untuk pending action bertipe 'cancel'. Aksi 'reject' / 'collect_cod'
  // TIDAK menulis field ini, diverifikasi via integration drain flow.
  describe('handleVersionConflict(), cancel-offline banner signal', () => {
    test('cancel conflict, tulis lastConflictReason=cancelled-by-server + lastConflictAt', async () => {
      // Setup order lokal (mockState.orders)
      const order = {
        id: 'order-cancel-banner-test',
        _raw: { id: 'order-cancel-banner-test', _status: 'synced' },
        status: 'PENDING',
        serverVersion: 5,
      };
      mockState.orders.set('order-cancel-banner-test', order);

      // Setup pending action bertipe cancel
      const action = makeRecord({
        actionType: 'cancel',
        targetOrderId: 'order-cancel-banner-test',
        expectedVersion: 5,
        payloadJson: { reason: 'customer tidak ada' },
      });
      mockState.records.set('cancel-banner-action', action);
      attachMethods(action);

      // cancelOrder ditolak 409 VERSION_CONFLICT
      mockCancelOrder.mockRejectedValue(
        new ApiError(
          'cancelOrder failed: 409 - body',
          409,
          'VERSION_CONFLICT',
          { code: 'VERSION_CONFLICT', message: 'm' },
        ),
      );

      await drainPendingActions();

      // Order row harus ter-update dengan reason cancelled-by-server
      const updatedOrder = mockState.orders.get('order-cancel-banner-test')!;
      expect(updatedOrder._raw.last_conflict_reason).toBe('cancelled-by-server');
      expect(updatedOrder._raw.last_conflict_at).toBeDefined();
      expect(typeof updatedOrder._raw.last_conflict_at).toBe('number');
      // Baris ditutup _status 'synced' dan _changed kosong, jadi tidak ikut push.
      expect(updatedOrder._raw._status).toBe('synced');
      expect(updatedOrder._raw._changed).toBe('');

      // Pending action harus ter-delete
      expect(mockState.records.has('cancel-banner-action')).toBe(false);

      // Untuk cancel, orderConflict tidak dipancarkan; banner tersimpan sudah
      // cukup.
      const orderConflictCalls = (syncEvents.emit as jest.Mock).mock.calls.filter(
        ([event]) => event === 'orderConflict',
      );
      expect(orderConflictCalls).toHaveLength(0);
    });

    test('reject 409 VERSION_CONFLICT: last_conflict_reason tidak ditulis', async () => {
      // Setup order lokal
      const order = {
        id: 'order-reject-banner-test',
        _raw: { id: 'order-reject-banner-test', _status: 'synced' },
        status: 'ASSIGNED',
        serverVersion: 3,
      };
      mockState.orders.set('order-reject-banner-test', order);

      // Setup pending action bertipe reject
      const action = makeRecord({
        actionType: 'reject',
        targetOrderId: 'order-reject-banner-test',
        expectedVersion: 3,
      });
      mockState.records.set('reject-banner-action', action);
      attachMethods(action);

      // rejectOrder ditolak 409 VERSION_CONFLICT
      mockRejectOrder.mockRejectedValue(
        new ApiError(
          'rejectOrder failed: 409 - body',
          409,
          'VERSION_CONFLICT',
          { code: 'VERSION_CONFLICT', message: 'm' },
        ),
      );

      await drainPendingActions();

      // last_conflict_reason dan last_conflict_at tidak ditulis
      const updatedOrder = mockState.orders.get('order-reject-banner-test')!;
      expect(updatedOrder._raw.last_conflict_reason).toBeUndefined();
      expect(updatedOrder._raw.last_conflict_at).toBeUndefined();

      // Pending action tetap ter-delete (handleVersionConflict tetap berjalan)
      expect(mockState.records.has('reject-banner-action')).toBe(false);
    });

    test('collect_cod 409 bukan yatim, TIDAK tulis last_conflict_reason', async () => {
      // Setup order lokal
      const order = {
        id: 'order-cod-banner-test',
        _raw: { id: 'order-cod-banner-test', _status: 'synced' },
        status: 'DELIVERED',
        serverVersion: 10,
      };
      mockState.orders.set('order-cod-banner-test', order);

      // Setup pending action bertipe collect_cod
      const action = makeRecord({
        actionType: 'collect_cod',
        targetOrderId: 'order-cod-banner-test',
        idempotencyKey: 'cod:banner-test-key',
        payloadJson: { amountCents: 50000 },
      });
      mockState.records.set('cod-banner-action', action);
      attachMethods(action);

      // 409 VERSION_CONFLICT pada COD bukan yatim, jadi 'failed'.
      mockCollectCodOrder.mockRejectedValue(
        new ApiError(
          'collectCodOrder failed: 409 - body',
          409,
          'VERSION_CONFLICT',
          { code: 'VERSION_CONFLICT', message: 'm' },
        ),
      );

      await drainPendingActions();

      // last_conflict_reason tidak ditulis
      const updatedOrder = mockState.orders.get('order-cod-banner-test')!;
      expect(updatedOrder._raw.last_conflict_reason).toBeUndefined();
      // Status 'failed', bukan 'orphaned_needs_review'
      expect(mockState.records.get('cod-banner-action')!.status).toBe('failed');
    });
  });

  describe('stale tracking', () => {
    const STALE_MS = STALE_THRESHOLD_MS;

    test('isPendingActionStale: returns false for recent action', () => {
      const recentAction = { createdAt: new Date() } as any;
      expect(isPendingActionStale(recentAction)).toBe(false);
    });

    test('isPendingActionStale: returns true for action older than 60 minutes', () => {
      const staleAction = { createdAt: new Date(Date.now() - STALE_MS - 1000) } as any;
      expect(isPendingActionStale(staleAction)).toBe(true);
    });

    test('isPendingActionStale: returns false for null', () => {
      expect(isPendingActionStale(null)).toBe(false);
    });

    test('getPendingActionAgeMs: returns 0 for null', () => {
      expect(getPendingActionAgeMs(null)).toBe(0);
    });

    test('getPendingActionAgeMs: returns correct age in ms', () => {
      const oldDate = new Date(Date.now() - 300000); // 5 minutes ago
      const action = { createdAt: oldDate } as any;
      const age = getPendingActionAgeMs(action);
      expect(age).toBeGreaterThanOrEqual(300000);
      expect(age).toBeLessThan(310000);
    });

    test('hasStalePendingAction: returns true for order with stale pending action', async () => {
      const staleAction = makeRecord({
        targetOrderId: 'order-stale',
        status: 'pending',
        createdAt: Date.now() - STALE_MS - 1000,
      });
      mockState.records.set('stale-action', staleAction);
      const result = await hasStalePendingAction('order-stale');
      expect(result).toBe(true);
    });

    test('hasStalePendingAction: returns false for order with fresh pending action', async () => {
      const freshAction = makeRecord({
        targetOrderId: 'order-fresh',
        status: 'pending',
        createdAt: Date.now(),
      });
      mockState.records.set('fresh-action', freshAction);
      const result = await hasStalePendingAction('order-fresh');
      expect(result).toBe(false);
    });

    test('hasStalePendingAction: returns false for order with no pending actions', async () => {
      const result = await hasStalePendingAction('order-none');
      expect(result).toBe(false);
    });
  });

  // Unit test isVersionConflict, kontrak typed error ApiError dari client.ts
  // memungkinkan deteksi 409 tanpa parse pesan. Tests ini verifikasi:
  // (a) status === 409 di ApiError cukup, walaupun pesan tidak memuat 'version'
  //     (kasus yang dulu gagal dengan regex parse);
  // (b) ApiError non-409 tidak match;
  // (c) error network biasa tidak match.
  describe('isVersionConflict()', () => {
    test('ApiError 409 tanpa kata "version" di pesan, true', () => {
      // Persis pola backend baru: status 409, code VERSION_CONFLICT,
      // message "Order was modified by another request..." (TIDAK ada
      // kata "version" atau "conflict" di pesan, itulah yang dulu
      // bikin handleVersionConflict tidak terpanggil).
      const err = new ApiError(
        'cancelOrder failed: 409 - {"code":"VERSION_CONFLICT","message":"Order was modified by another request. Please refresh and try again."}',
        409,
        'VERSION_CONFLICT',
        { code: 'VERSION_CONFLICT', message: 'Order was modified by another request. Please refresh and try again.' },
      );
      expect(isVersionConflict(err)).toBe(true);
    });

    test('ApiError 409 dengan code undefined, tetap true via status', () => {
      // Defensive: kalau backend somehow tidak kirim `code` field, status 409
      // saja sudah cukup untuk trigger handleVersionConflict.
      const err = new ApiError('cancelOrder failed: 409 - some body', 409);
      expect(isVersionConflict(err)).toBe(true);
    });

    test('ApiError 403, false (bukan version conflict, itu ownership check)', () => {
      const err = new ApiError(
        'rejectOrder failed: 403 - {"code":"ORDER_NOT_ASSIGNED","message":"You are not assigned to this order"}',
        403,
        'ORDER_NOT_ASSIGNED',
        { code: 'ORDER_NOT_ASSIGNED', message: 'You are not assigned to this order' },
      );
      expect(isVersionConflict(err)).toBe(false);
    });

    test('Error network biasa (status undefined, code undefined), false', () => {
      const err = new Error('Network request failed');
      expect(isVersionConflict(err)).toBe(false);
    });

    test('Error dengan pesan "version mismatch", true (backward compat string check)', () => {
      // Backward compat, error lama dengan pesan generic masih ke-detect.
      const err = new Error('version mismatch detected');
      expect(isVersionConflict(err)).toBe(true);
    });

    test('Error null/undefined, false', () => {
      expect(isVersionConflict(null)).toBe(false);
      expect(isVersionConflict(undefined)).toBe(false);
    });

    // Regression lock: clause regex `\b409\b` pernah ada di isVersionConflict
    // tapi rentan false-positive, body response apapun yang memuat angka 409
    // berdiri sendiri (mis. `{"amount":409}` dari endpoint yang tidak terkait)
    // akan lolos sebagai version conflict. Setelah clause dihapus,
    // ApiError 403 dengan body mengandung "409" HARUS return false.
    test('ApiError 403 dengan body yang memuat angka 409, false (lock: jangan parse pesan untuk 409)', () => {
      const err = new ApiError(
        'cancelOrder failed: 403 - {"code":"ORDER_NOT_ASSIGNED","message":"You are not assigned to this order","debug":{"requestId":409}}',
        403,
        'ORDER_NOT_ASSIGNED',
        { code: 'ORDER_NOT_ASSIGNED', message: 'You are not assigned to this order', debug: { requestId: 409 } },
      );
      expect(isVersionConflict(err)).toBe(false);
    });
  });

  // Integration test: processCancel dengan client yang melempar ApiError 409
  // (kasus riil dari Skenario A, driver cancel offline, server sudah
  // reassign/complete, mobile sync dapat 409). handleVersionConflict harus
  // terpanggil, pending_action terhapus, dan order lokal punya banner signal.
  describe('processCancel + ApiError 409, handleVersionConflict + banner signal', () => {
    test('cancel conflict via ApiError 409, tulis banner signal cancelled-by-server', async () => {
      // Setup order lokal
      const order = {
        id: 'order-cancel-apierror-test',
        _raw: { id: 'order-cancel-apierror-test', _status: 'synced' },
        status: 'ASSIGNED',
        serverVersion: 5,
      };
      mockState.orders.set('order-cancel-apierror-test', order);

      // Setup pending action cancel
      const action = makeRecord({
        actionType: 'cancel',
        targetOrderId: 'order-cancel-apierror-test',
        expectedVersion: 5,
        payloadJson: { reason: 'customer tidak ada' },
      });
      mockState.records.set('cancel-apierror-action', action);
      attachMethods(action);

      // Mock cancelOrder, reject dengan ApiError 409 (real instance, sama
      // dengan yang akan dilempar client.ts setelah fix). Pesan TIDAK
      // memuat 'version' atau 'conflict', sehingga isVersionConflict
      // hanya match via status === 409 atau code === 'VERSION_CONFLICT'.
      mockCancelOrder.mockRejectedValue(
        new ApiError(
          'cancelOrder failed: 409 - {"code":"VERSION_CONFLICT","message":"Order was modified by another request. Please refresh and try again."}',
          409,
          'VERSION_CONFLICT',
          { code: 'VERSION_CONFLICT', message: 'Order was modified by another request. Please refresh and try again.' },
        ),
      );

      await drainPendingActions();

      // handleVersionConflict terpanggil:
      // - pending_action terhapus
      // - order._raw.last_conflict_reason = 'cancelled-by-server'
      // - order._raw.last_conflict_at terisi
      expect(mockState.records.has('cancel-apierror-action')).toBe(false);

      const updatedOrder = mockState.orders.get('order-cancel-apierror-test')!;
      expect(updatedOrder._raw.last_conflict_reason).toBe('cancelled-by-server');
      expect(updatedOrder._raw.last_conflict_at).toBeDefined();
      expect(typeof updatedOrder._raw.last_conflict_at).toBe('number');
      // Baris ditutup _status 'synced' dan _changed kosong
      expect(updatedOrder._raw._status).toBe('synced');
      expect(updatedOrder._raw._changed).toBe('');
    });
  });

  // Regression: processReject/processCancel dulu hardcoded 'ASSIGNED',
  // response.status seharusnya tertulis apa adanya. Juga regresi: cancel
  // network failure tidak tulis baris, 409 konflik tidak lewat sukses path.
  describe('regression: response.status written as-is, network failure / 409 tidak write baris', () => {
    // Respons sukses dengan status non-ASSIGNED (mis. backend mengembalikan
    // status lain seperti 'X') harus tertulis apa adanya, merah di kode
    // lama yang hardcode 'ASSIGNED'.
    test('reject success dengan status X, tulis response.status (bukan hardcoded ASSIGNED)', async () => {
      const order = {
        id: 'order-reject-status-x',
        _raw: { id: 'order-reject-status-x', _status: 'synced' },
        status: 'PREPARING',
        serverVersion: 1,
      };
      mockState.orders.set('order-reject-status-x', order);

      const action = makeRecord({
        actionType: 'reject',
        targetOrderId: 'order-reject-status-x',
        expectedVersion: 1,
      });
      mockState.records.set('reject-status-x-action', action);
      attachMethods(action);

      // Server kembalikan status non-ASSIGNED, harus tertulis apa adanya.
      mockRejectOrder.mockResolvedValue({
        id: 'order-reject-status-x',
        status: 'X',
        driverId: null,
        version: 2,
      } as any);

      await drainPendingActions();

      expect(mockState.records.has('reject-status-x-action')).toBe(false);
      const updatedOrder = mockState.orders.get('order-reject-status-x')!;
      expect(updatedOrder._raw.status).toBe('X'); // bukan 'ASSIGNED'
    });

    test('cancel success dengan status Y, tulis response.status (bukan hardcoded ASSIGNED)', async () => {
      const order = {
        id: 'order-cancel-status-y',
        _raw: { id: 'order-cancel-status-y', _status: 'synced' },
        status: 'PREPARING',
        serverVersion: 1,
      };
      mockState.orders.set('order-cancel-status-y', order);

      const action = makeRecord({
        actionType: 'cancel',
        targetOrderId: 'order-cancel-status-y',
        expectedVersion: 1,
      });
      mockState.records.set('cancel-status-y-action', action);
      attachMethods(action);

      mockCancelOrder.mockResolvedValue({
        id: 'order-cancel-status-y',
        status: 'Y',
        driverId: null,
        version: 2,
        cancelledBy: 'driver-123',
        cancelReason: 'test',
      } as any);

      await drainPendingActions();

      expect(mockState.records.has('cancel-status-y-action')).toBe(false);
      const updatedOrder = mockState.orders.get('order-cancel-status-y')!;
      expect(updatedOrder._raw.status).toBe('Y'); // bukan 'ASSIGNED'
    });

    // Cancel gagal jaringan: baris order tidak ditulis, pending action tetap ada
    // (retry di next drain).
    test('cancel network failure, baris order TIDAK ditulis, pending action tetap pending', async () => {
      const order = {
        id: 'order-cancel-netfail',
        _raw: { id: 'order-cancel-netfail', _status: 'synced', status: 'PREPARING', driver_id: 'driver-123' },
        status: 'PREPARING',
        serverVersion: 5,
      };
      mockState.orders.set('order-cancel-netfail', order);

      const action = makeRecord({
        actionType: 'cancel',
        targetOrderId: 'order-cancel-netfail',
        expectedVersion: 5,
      });
      mockState.records.set('cancel-netfail-action', action);
      attachMethods(action);

      mockCancelOrder.mockRejectedValue(new Error('Network request failed'));

      const results = await drainPendingActions();
      expect(results[0].status).toBe('failed');
      // Pending action masih ada (status kembali ke 'pending')
      expect(mockState.records.get('cancel-netfail-action')!.status).toBe('pending');
      // Baris order TIDAK berubah
      const unchangedOrder = mockState.orders.get('order-cancel-netfail')!;
      expect(unchangedOrder._raw.status).toBe('PREPARING');
      expect(unchangedOrder._raw.driver_id).toBe('driver-123');
    });

    // Cancel 409: handleVersionConflict jalan, TIDAK menulis baris order
    // (jalur sukses write dari response tidak boleh terpanggil).
    test('cancel 409 conflict, baris order TIDAK ditulis (handleVersionConflict, bukan success path)', async () => {
      const order = {
        id: 'order-cancel-409',
        _raw: { id: 'order-cancel-409', _status: 'synced', status: 'PREPARING', driver_id: 'driver-123' },
        status: 'PREPARING',
        serverVersion: 5,
      };
      mockState.orders.set('order-cancel-409', order);

      const action = makeRecord({
        actionType: 'cancel',
        targetOrderId: 'order-cancel-409',
        expectedVersion: 5,
      });
      mockState.records.set('cancel-409-action', action);
      attachMethods(action);

      mockCancelOrder.mockRejectedValue(new ApiError(
          'cancelOrder failed: 409 - body',
          409,
          'VERSION_CONFLICT',
          { code: 'VERSION_CONFLICT', message: 'm' },
        ));

      const results = await drainPendingActions();
      expect(results[0].status).toBe('conflict');
      // Pending action terhapus (handleVersionConflict delete)
      expect(mockState.records.has('cancel-409-action')).toBe(false);
      // last_conflict_reason ditulis
      const updatedOrder = mockState.orders.get('order-cancel-409')!;
      expect(updatedOrder._raw.last_conflict_reason).toBe('cancelled-by-server');
      // status dan driver_id tidak diubah: handleVersionConflict hanya menulis
      // last_conflict_reason.
      expect(updatedOrder._raw.status).toBe('PREPARING');
      expect(updatedOrder._raw.driver_id).toBe('driver-123');
    });

    // ============ pemilahan hasil kirim ============

    describe('409 ORDER_REASSIGNED dan COD_ALREADY_CAPTURED: aksi dihapus, alasan ditulis ke order', () => {
      test('reject 409 ORDER_REASSIGNED: aksi dihapus, order dapat last_conflict_reason "reassigned"', async () => {
        const order = {
          id: 'order-reassigned-reject',
          _raw: { id: 'order-reassigned-reject', _status: 'synced' },
          status: 'PREPARING',
          serverVersion: 3,
        };
        mockState.orders.set('order-reassigned-reject', order);

        const action = makeRecord({
          actionType: 'reject',
          targetOrderId: 'order-reassigned-reject',
          expectedVersion: 3,
        });
        mockState.records.set('reassigned-reject-action', action);
        attachMethods(action);

        mockRejectOrder.mockRejectedValue(new ApiError(
          'rejectOrder failed: 409 - body',
          409,
          'ORDER_REASSIGNED',
          { code: 'ORDER_REASSIGNED', message: 'Order reassigned' },
        ));

        const results = await drainPendingActions();
        expect(results[0].status).toBe('conflict');
        // Aksi dihapus
        expect(mockState.records.has('reassigned-reject-action')).toBe(false);
        // Order dapat last_conflict_reason
        const updated = mockState.orders.get('order-reassigned-reject')!;
        expect(updated._raw.last_conflict_reason).toBe('reassigned');
        expect(typeof updated._raw.last_conflict_at).toBe('number');
        // Baris ditutup _status synced dan _changed kosong
        expect(updated._raw._status).toBe('synced');
        expect(updated._raw._changed).toBe('');
      });

      test('cancel 409 ORDER_REASSIGNED: aksi dihapus, order dapat last_conflict_reason "reassigned"', async () => {
        const order = {
          id: 'order-reassigned-cancel',
          _raw: { id: 'order-reassigned-cancel', _status: 'synced' },
          status: 'OUT_FOR_DELIVERY',
          serverVersion: 7,
        };
        mockState.orders.set('order-reassigned-cancel', order);

        const action = makeRecord({
          actionType: 'cancel',
          targetOrderId: 'order-reassigned-cancel',
          expectedVersion: 7,
          payloadJson: { reason: 'test' },
        });
        mockState.records.set('reassigned-cancel-action', action);
        attachMethods(action);

        mockCancelOrder.mockRejectedValue(new ApiError(
          'cancelOrder failed: 409 - body',
          409,
          'ORDER_REASSIGNED',
          { code: 'ORDER_REASSIGNED', message: 'm' },
        ));

        const results = await drainPendingActions();
        expect(results[0].status).toBe('conflict');
        expect(mockState.records.has('reassigned-cancel-action')).toBe(false);
        const updated = mockState.orders.get('order-reassigned-cancel')!;
        expect(updated._raw.last_conflict_reason).toBe('reassigned');
        expect(typeof updated._raw.last_conflict_at).toBe('number');
      });

      test('cancel 409 COD_ALREADY_CAPTURED: last_conflict_reason "cancel-cod-captured"', async () => {
        const order = {
          id: 'order-cancel-cod-captured',
          _raw: { id: 'order-cancel-cod-captured', _status: 'synced' },
          status: 'OUT_FOR_DELIVERY',
          serverVersion: 8,
        };
        mockState.orders.set('order-cancel-cod-captured', order);

        const action = makeRecord({
          actionType: 'cancel',
          targetOrderId: 'order-cancel-cod-captured',
          expectedVersion: 8,
          payloadJson: { reason: 'test' },
        });
        mockState.records.set('cancel-cod-captured-action', action);
        attachMethods(action);

        mockCancelOrder.mockRejectedValue(new ApiError(
          'cancelOrder failed: 409 - body',
          409,
          'COD_ALREADY_CAPTURED',
          { code: 'COD_ALREADY_CAPTURED', message: 'm' },
        ));

        const results = await drainPendingActions();
        expect(results[0].status).toBe('conflict');
        expect(mockState.records.has('cancel-cod-captured-action')).toBe(false);
        const updated = mockState.orders.get('order-cancel-cod-captured')!;
        expect(updated._raw.last_conflict_reason).toBe('cancel-cod-captured');
        expect(typeof updated._raw.last_conflict_at).toBe('number');
      });

      test('reject 409 COD_ALREADY_CAPTURED: aksi dihapus, order dapat last_conflict_reason "cancel-cod-captured"', async () => {
        const order = {
          id: 'order-reject-cod-captured',
          _raw: { id: 'order-reject-cod-captured', _status: 'synced' },
          status: 'OUT_FOR_DELIVERY',
          serverVersion: 8,
        };
        mockState.orders.set('order-reject-cod-captured', order);

        const action = makeRecord({
          actionType: 'reject',
          targetOrderId: 'order-reject-cod-captured',
          expectedVersion: 8,
        });
        mockState.records.set('reject-cod-captured-action', action);
        attachMethods(action);

        mockRejectOrder.mockRejectedValue(new ApiError(
          'rejectOrder failed: 409 - body',
          409,
          'COD_ALREADY_CAPTURED',
          { code: 'COD_ALREADY_CAPTURED', message: 'm' },
        ));

        const results = await drainPendingActions();
        expect(results[0].status).toBe('conflict');
        expect(mockState.records.has('reject-cod-captured-action')).toBe(false);
        const updated = mockState.orders.get('order-reject-cod-captured')!;
        expect(updated._raw.last_conflict_reason).toBe('cancel-cod-captured');
        expect(typeof updated._raw.last_conflict_at).toBe('number');
        expect(updated._raw._status).toBe('synced');
        expect(updated._raw._changed).toBe('');
      });
    });

    describe('4xx non-409: status failed, tidak dikirim ulang', () => {
      test('cancel 400: status failed, aksi tidak dihapus dan tidak dikirim lagi di putaran berikutnya', async () => {
        const action = makeRecord({ actionType: 'cancel', targetOrderId: 'order-cancel-400', payloadJson: { reason: 'r' } });
        mockState.records.set('cancel-400-action', action);
        attachMethods(action);

        mockCancelOrder.mockRejectedValue(new ApiError(
          'cancelOrder failed: 400 - body',
          400,
          'VALIDATION',
          { code: 'VALIDATION', message: 'bad' },
        ));

        const results = await drainPendingActions();
        expect(results[0].status).toBe('failed');
        expect(mockState.records.get('cancel-400-action')!.status).toBe('failed');

        await drainPendingActions();
        expect(mockCancelOrder).toHaveBeenCalledTimes(1);
      });

      test('cancel 403 tanpa code: failed, bukan yatim, dan tidak dikirim lagi di putaran berikutnya', async () => {
        const action = makeRecord({ actionType: 'cancel', targetOrderId: 'order-cancel-403', payloadJson: { reason: 'r' } });
        mockState.records.set('cancel-403-action', action);
        attachMethods(action);

        mockCancelOrder.mockRejectedValue(new ApiError(
          'cancelOrder failed: 403 - body',
          403,
          undefined,
          { message: 'forbidden' },
        ));

        const results = await drainPendingActions();
        expect(results[0].status).toBe('failed');
        expect(mockState.records.get('cancel-403-action')!.status).toBe('failed');

        await drainPendingActions();
        expect(mockCancelOrder).toHaveBeenCalledTimes(1);
      });

      test('cancel 403 ORDER_NOT_ASSIGNED: failed, bukan yatim', async () => {
        const action = makeRecord({ actionType: 'cancel', targetOrderId: 'order-cancel-403-own', payloadJson: { reason: 'r' } });
        mockState.records.set('cancel-403-own-action', action);
        attachMethods(action);

        mockCancelOrder.mockRejectedValue(new ApiError(
          'cancelOrder failed: 403 - body',
          403,
          'ORDER_NOT_ASSIGNED',
          { code: 'ORDER_NOT_ASSIGNED', message: 'not assigned' },
        ));

        const results = await drainPendingActions();
        expect(results[0].status).toBe('failed');
        expect(mockState.records.get('cancel-403-own-action')!.status).toBe('failed');
      });

      test('cancel 401: aksi kembali pending dan putaran berhenti', async () => {
        const action1 = makeRecord({ actionType: 'cancel', targetOrderId: 'order-cancel-401', payloadJson: { reason: 'r' } });
        const action2 = makeRecord({ actionType: 'reject', targetOrderId: 'order-reject-401', expectedVersion: 1 });
        mockState.records.set('cancel-401-action', action1);
        mockState.records.set('reject-401-action', action2);
        attachMethods(action1);
        attachMethods(action2);

        mockCancelOrder.mockRejectedValue(new UnauthorizedError('Sesi berakhir, silakan login ulang'));

        const results = await drainPendingActions();
        expect(results[0].status).toBe('failed');
        expect(results[0].stopDrain).toBe(true);
        expect(mockRejectOrder).not.toHaveBeenCalled();
        expect(mockState.records.get('reject-401-action')!.status).toBe('pending');
        expect(mockState.records.get('cancel-401-action')!.status).toBe('pending');
      });
    });

    describe('gangguan sementara: kembali pending', () => {
      test('cancel 503: aksi kembali pending', async () => {
        const action = makeRecord({ actionType: 'cancel', targetOrderId: 'order-cancel-503', payloadJson: { reason: 'r' } });
        mockState.records.set('cancel-503-action', action);
        attachMethods(action);

        mockCancelOrder.mockRejectedValue(new ApiError(
          'cancelOrder failed: 503 - body',
          503,
          undefined,
          { message: 'unavailable' },
        ));

        const results = await drainPendingActions();
        expect(results[0].status).toBe('failed');
        expect(mockState.records.get('cancel-503-action')!.status).toBe('pending');
      });

      test('galat jaringan pada aksi pertama: aksi kedua tidak dikirim di putaran itu', async () => {
        const action1 = makeRecord({ actionType: 'cancel', targetOrderId: 'order-net-1', payloadJson: { reason: 'r' } });
        const action2 = makeRecord({ actionType: 'reject', targetOrderId: 'order-net-2', expectedVersion: 1 });
        mockState.records.set('net-1-action', action1);
        mockState.records.set('net-2-action', action2);
        attachMethods(action1);
        attachMethods(action2);

        mockCancelOrder.mockRejectedValue(new Error('Network request failed'));

        const results = await drainPendingActions();
        // Aksi pertama failed dengan stopDrain
        expect(results[0].status).toBe('failed');
        expect(results[0].stopDrain).toBe(true);
        // Aksi kedua TIDAK diproses (stopDrain)
        expect(mockRejectOrder).not.toHaveBeenCalled();
        // Aksi kedua tetap 'pending' untuk putaran berikutnya
        expect(mockState.records.get('net-2-action')!.status).toBe('pending');
      });
    });

    describe('COD sukses: baris payment ditulis dari respons', () => {
      test('baris payment dibuat dari respons dengan _status synced dan _changed kosong, aksi hilang di batch yang sama', async () => {
        const action = makeRecord({
          actionType: 'collect_cod',
          targetOrderId: 'order-cod-success',
          idempotencyKey: 'cod:stable',
          payloadJson: { amountCents: 50000 },
        });
        mockState.records.set('cod-success-action', action);
        attachMethods(action);

        mockCollectCodOrder.mockResolvedValue({
          id: 'payment-new-1',
          orderId: 'order-cod-success',
          idempotencyKey: 'cod:stable',
          method: 'CASH',
          status: 'CAPTURED',
          amountCents: 50000,
          currency: 'IDR',
          kind: 'PAYMENT',
          createdAt: '2026-10-17T10:00:00.000Z',
          updatedAt: '2026-10-17T10:00:00.000Z',
          version: 1,
        });

        await drainPendingActions();
        // Aksi hilang
        expect(mockState.records.has('cod-success-action')).toBe(false);
        // Baris payment dibuat
        const payment = mockState.payments.get('payment-new-1');
        expect(payment).toBeDefined();
        expect(payment._raw.id).toBe('payment-new-1');
        expect(payment._raw.order_id).toBe('order-cod-success');
        expect(payment._raw.status).toBe('CAPTURED');
        expect(payment._raw.method).toBe('CASH');
        expect(payment._raw.amount_cents).toBe(50000);
        expect(payment._raw._status).toBe('synced');
        expect(payment._raw._changed).toBe('');
      });

      test('kalau baris payment sudah ada, diperbarui (tidak duplikat)', async () => {
        const action = makeRecord({
          actionType: 'collect_cod',
          targetOrderId: 'order-cod-dup',
          idempotencyKey: 'cod:stable',
          payloadJson: { amountCents: 50000 },
        });
        mockState.records.set('cod-dup-action', action);
        attachMethods(action);

        // Payment sudah ada di mockState.payments
        const existing = {
          id: 'payment-existing-1',
          _raw: { id: 'payment-existing-1', _status: 'synced', _changed: '', status: 'PENDING' },
        };
        mockState.payments.set('payment-existing-1', existing);
        attachMethods(existing);

        mockCollectCodOrder.mockResolvedValue({
          id: 'payment-existing-1',
          orderId: 'order-cod-dup',
          idempotencyKey: 'cod:stable',
          method: 'CASH',
          status: 'CAPTURED',
          amountCents: 50000,
          currency: 'IDR',
          kind: 'PAYMENT',
          createdAt: '2026-10-17T10:00:00.000Z',
          updatedAt: '2026-10-17T10:00:00.000Z',
          version: 2,
        });

        await drainPendingActions();
        // Aksi hilang
        expect(mockState.records.has('cod-dup-action')).toBe(false);
        // Baris yang sama diperbarui dari respons, tidak dibuat baru
        const payment = mockState.payments.get('payment-existing-1')!;
        expect(payment).toBe(existing);
        expect(payment._raw.status).toBe('CAPTURED');
        expect(payment._raw.server_version).toBe(2);
        expect(payment._raw._status).toBe('synced');
        expect(payment._raw._changed).toBe('');
        // Map.size masih 1 untuk payments
        expect(mockState.payments.size).toBe(1);
      });
    });

    describe('COD 409 COD_ALREADY_CAPTURED: tulis payment dari body, last_conflict_reason "cod-already-captured"', () => {
      test('dengan payment di body: payment ditulis, aksi hilang, order ditandai cod-already-captured', async () => {
        const order = {
          id: 'order-cod-already',
          _raw: { id: 'order-cod-already', _status: 'synced' },
          status: 'OUT_FOR_DELIVERY',
          serverVersion: 9,
        };
        mockState.orders.set('order-cod-already', order);

        const action = makeRecord({
          actionType: 'collect_cod',
          targetOrderId: 'order-cod-already',
          idempotencyKey: 'cod:late',
          payloadJson: { amountCents: 50000 },
        });
        mockState.records.set('cod-already-action', action);
        attachMethods(action);

        mockCollectCodOrder.mockRejectedValue(new ApiError(
          'collectCodOrder failed: 409 - body',
          409,
          'COD_ALREADY_CAPTURED',
          {
            code: 'COD_ALREADY_CAPTURED',
            message: 'm',
            payment: {
              id: 'payment-server-1',
              orderId: 'order-cod-already',
              idempotencyKey: 'cod:server-key',
              method: 'CASH',
              status: 'CAPTURED',
              amountCents: 50000,
              currency: 'IDR',
              kind: 'PAYMENT',
              externalRef: null,
              createdAt: '2026-10-17T10:00:00.000Z',
              updatedAt: '2026-10-17T10:00:00.000Z',
              version: 1,
            },
          },
        ));

        const results = await drainPendingActions();
        expect(results[0].status).toBe('conflict');
        // Aksi hilang
        expect(mockState.records.has('cod-already-action')).toBe(false);
        // Baris payment ditulis dari body
        const payment = mockState.payments.get('payment-server-1');
        expect(payment).toBeDefined();
        expect(payment._raw.order_id).toBe('order-cod-already');
        // Order ditandai
        const updated = mockState.orders.get('order-cod-already')!;
        expect(updated._raw.last_conflict_reason).toBe('cod-already-captured');
        expect(typeof updated._raw.last_conflict_at).toBe('number');
      });

      test('COD 409 COD_ALREADY_CAPTURED saat baris payment sudah ada: baris diperbarui, aksi hilang, order ditandai cod-already-captured', async () => {
        const order = {
          id: 'order-cod-already-existing-pay',
          _raw: { id: 'order-cod-already-existing-pay', _status: 'synced' },
          status: 'OUT_FOR_DELIVERY',
          serverVersion: 9,
        };
        mockState.orders.set('order-cod-already-existing-pay', order);

        const action = makeRecord({
          actionType: 'collect_cod',
          targetOrderId: 'order-cod-already-existing-pay',
          idempotencyKey: 'cod:late',
          payloadJson: { amountCents: 50000 },
        });
        mockState.records.set('cod-already-existing-pay-action', action);
        attachMethods(action);

        const existing = {
          id: 'payment-server-1',
          _raw: { id: 'payment-server-1', _status: 'synced', _changed: '', status: 'PENDING' },
        };
        mockState.payments.set('payment-server-1', existing);
        attachMethods(existing);

        mockCollectCodOrder.mockRejectedValue(new ApiError(
          'collectCodOrder failed: 409 - body',
          409,
          'COD_ALREADY_CAPTURED',
          {
            code: 'COD_ALREADY_CAPTURED',
            message: 'm',
            payment: {
              id: 'payment-server-1',
              orderId: 'order-cod-already-existing-pay',
              idempotencyKey: 'cod:server-key',
              method: 'CASH',
              status: 'CAPTURED',
              amountCents: 50000,
              currency: 'IDR',
              kind: 'PAYMENT',
              externalRef: null,
              createdAt: '2026-10-17T10:00:00.000Z',
              updatedAt: '2026-10-17T10:00:00.000Z',
              version: 3,
            },
          },
        ));

        const results = await drainPendingActions();
        expect(results[0].status).toBe('conflict');
        expect(mockState.records.has('cod-already-existing-pay-action')).toBe(false);
        const payment = mockState.payments.get('payment-server-1')!;
        expect(payment).toBe(existing);
        expect(payment._raw.status).toBe('CAPTURED');
        expect(payment._raw.server_version).toBe(3);
        expect(payment._raw._status).toBe('synced');
        expect(payment._raw._changed).toBe('');
        expect(mockState.payments.size).toBe(1);
        const updated = mockState.orders.get('order-cod-already-existing-pay')!;
        expect(updated._raw.last_conflict_reason).toBe('cod-already-captured');
        expect(typeof updated._raw.last_conflict_at).toBe('number');
      });

      test('tanpa payment di body: aksi hilang, tanpa baris payment', async () => {
        const order = {
          id: 'order-cod-already-no-pay',
          _raw: { id: 'order-cod-already-no-pay', _status: 'synced' },
          status: 'OUT_FOR_DELIVERY',
          serverVersion: 9,
        };
        mockState.orders.set('order-cod-already-no-pay', order);

        const action = makeRecord({
          actionType: 'collect_cod',
          targetOrderId: 'order-cod-already-no-pay',
          idempotencyKey: 'cod:no-pay',
          payloadJson: { amountCents: 50000 },
        });
        mockState.records.set('cod-already-no-pay-action', action);
        attachMethods(action);

        mockCollectCodOrder.mockRejectedValue(new ApiError(
          'collectCodOrder failed: 409 - body',
          409,
          'COD_ALREADY_CAPTURED',
          { code: 'COD_ALREADY_CAPTURED', message: 'm' },
        ));

        const results = await drainPendingActions();
        expect(results[0].status).toBe('conflict');
        // Aksi hilang
        expect(mockState.records.has('cod-already-no-pay-action')).toBe(false);
        // Tidak ada baris payment ditulis
        expect(mockState.payments.size).toBe(0);
        // Order tetap ditandai
        const updated = mockState.orders.get('order-cod-already-no-pay')!;
        expect(updated._raw.last_conflict_reason).toBe('cod-already-captured');
      });
    });

    describe('COD 403/404: yatim', () => {
      test('COD 403 dengan code ORDER_NOT_ASSIGNED: orphaned_needs_review', async () => {
        const action = makeRecord({
          actionType: 'collect_cod',
          targetOrderId: 'order-cod-403',
          idempotencyKey: 'cod:403',
          payloadJson: { amountCents: 50000 },
        });
        mockState.records.set('cod-403-action', action);
        attachMethods(action);

        mockCollectCodOrder.mockRejectedValue(new ApiError(
          'collectCodOrder failed: 403 - body',
          403,
          'ORDER_NOT_ASSIGNED',
          { code: 'ORDER_NOT_ASSIGNED', message: 'not assigned' },
        ));

        const results = await drainPendingActions();
        expect(results[0].status).toBe('orphaned');
        expect(mockState.records.get('cod-403-action')!.status).toBe('orphaned_needs_review');
      });

      test('COD 403 tanpa code: failed (bukan yatim)', async () => {
        const action = makeRecord({
          actionType: 'collect_cod',
          targetOrderId: 'order-cod-403nc',
          idempotencyKey: 'cod:403nc',
          payloadJson: { amountCents: 50000 },
        });
        mockState.records.set('cod-403nc-action', action);
        attachMethods(action);

        mockCollectCodOrder.mockRejectedValue(new ApiError(
          'collectCodOrder failed: 403 - body',
          403,
          undefined,
          { message: 'forbidden' },
        ));

        const results = await drainPendingActions();
        expect(results[0].status).toBe('failed');
        expect(mockState.records.get('cod-403nc-action')!.status).toBe('failed');
      });

      test('COD 404: orphaned_needs_review', async () => {
        const action = makeRecord({
          actionType: 'collect_cod',
          targetOrderId: 'order-cod-404',
          idempotencyKey: 'cod:404',
          payloadJson: { amountCents: 50000 },
        });
        mockState.records.set('cod-404-action', action);
        attachMethods(action);

        mockCollectCodOrder.mockRejectedValue(new ApiError(
          'collectCodOrder failed: 404 - body',
          404,
          undefined,
          { message: 'not found' },
        ));

        const results = await drainPendingActions();
        expect(results[0].status).toBe('orphaned');
        expect(mockState.records.get('cod-404-action')!.status).toBe('orphaned_needs_review');
      });

      test('COD 400: failed', async () => {
        const action = makeRecord({
          actionType: 'collect_cod',
          targetOrderId: 'order-cod-400',
          idempotencyKey: 'cod:400',
          payloadJson: { amountCents: 50000 },
        });
        mockState.records.set('cod-400-action', action);
        attachMethods(action);

        mockCollectCodOrder.mockRejectedValue(new ApiError(
          'collectCodOrder failed: 400 - body',
          400,
          'VALIDATION',
          { code: 'VALIDATION', message: 'bad' },
        ));

        const results = await drainPendingActions();
        expect(results[0].status).toBe('failed');
        expect(mockState.records.get('cod-400-action')!.status).toBe('failed');
      });
    });

    describe('sukses cancel/reject: orderConflict TIDAK dipancarkan', () => {
      test('reject sukses: pool-refresh tetap, orderConflict TIDAK dipancarkan', async () => {
        const order = {
          id: 'order-reject-success-noconflict',
          _raw: { id: 'order-reject-success-noconflict', _status: 'synced' },
          status: 'PREPARING',
          serverVersion: 1,
        };
        mockState.orders.set('order-reject-success-noconflict', order);

        const action = makeRecord({
          actionType: 'reject',
          targetOrderId: 'order-reject-success-noconflict',
          expectedVersion: 1,
        });
        mockState.records.set('reject-success-noconflict-action', action);
        attachMethods(action);

        mockRejectOrder.mockResolvedValue({
          id: 'order-reject-success-noconflict',
          status: 'ASSIGNED',
          version: 2,
        });

        await drainPendingActions();
        // pool-refresh tetap
        expect(syncEvents.emit).toHaveBeenCalledWith('pool-refresh', expect.objectContaining({
          orderId: 'order-reject-success-noconflict',
        }));
        // orderConflict TIDAK dipancarkan
        const orderConflictCalls = (syncEvents.emit as jest.Mock).mock.calls.filter(
          ([event]) => event === 'orderConflict',
        );
        expect(orderConflictCalls).toHaveLength(0);
      });

      test('cancel sukses: pool-refresh tetap, orderConflict TIDAK dipancarkan', async () => {
        const order = {
          id: 'order-cancel-success-noconflict',
          _raw: { id: 'order-cancel-success-noconflict', _status: 'synced' },
          status: 'PREPARING',
          serverVersion: 1,
        };
        mockState.orders.set('order-cancel-success-noconflict', order);

        const action = makeRecord({
          actionType: 'cancel',
          targetOrderId: 'order-cancel-success-noconflict',
          expectedVersion: 1,
          payloadJson: { reason: 'r' },
        });
        mockState.records.set('cancel-success-noconflict-action', action);
        attachMethods(action);

        mockCancelOrder.mockResolvedValue({
          id: 'order-cancel-success-noconflict',
          status: 'ASSIGNED',
          version: 2,
          cancelledBy: 'driver-123',
          cancelReason: 'r',
        });

        await drainPendingActions();
        expect(syncEvents.emit).toHaveBeenCalledWith('pool-refresh', expect.objectContaining({
          orderId: 'order-cancel-success-noconflict',
        }));
        const orderConflictCalls = (syncEvents.emit as jest.Mock).mock.calls.filter(
          ([event]) => event === 'orderConflict',
        );
        expect(orderConflictCalls).toHaveLength(0);
      });
    });

    describe('retryFailedAction / discardFailedAction', () => {
      // retryFailedAction mengubah aksi ke 'pending' lalu memanggil
      // drainPendingActions, jadi yang diperiksa adalah aksi itu ikut dikirim.
      test('retryFailedAction: aksi failed dikirim lagi', async () => {
        const action = makeRecord({ id: 'retry-action-id', actionType: 'cancel', targetOrderId: 'order-retry', payloadJson: { reason: 'r' }, status: 'failed' });
        mockState.records.set('retry-action-id', action);
        attachMethods(action);

        // cancelOrder sukses supaya pengiriman selesai.
        mockCancelOrder.mockResolvedValue({ id: 'order-retry', status: 'ASSIGNED', version: 2 });

        await retryFailedAction('retry-action-id');

        // cancelOrder terpanggil: aksi ini ikut dikirim.
        expect(mockCancelOrder).toHaveBeenCalled();
        // Aksi sudah terhapus (sukses).
        expect(mockState.records.has('retry-action-id')).toBe(false);
      });

      test('retryFailedAction: aksi yang bukan failed tidak diubah dan tidak dikirim', async () => {
        const action = makeRecord({ id: 'retry-noop-id', actionType: 'cancel', targetOrderId: 'order-retry-noop', payloadJson: { reason: 'r' }, status: 'pending' });
        mockState.records.set('retry-noop-id', action);
        attachMethods(action);

        await retryFailedAction('retry-noop-id');

        // cancelOrder tidak terpanggil
        expect(mockCancelOrder).not.toHaveBeenCalled();
        // Aksi tetap 'pending', tidak diubah
        expect(mockState.records.get('retry-noop-id')!.status).toBe('pending');
      });

      test('discardFailedAction: aksi failed cancel -> dihapus', async () => {
        const action = makeRecord({ id: 'discard-action-id', actionType: 'cancel', targetOrderId: 'order-discard', payloadJson: { reason: 'r' }, status: 'failed' });
        mockState.records.set('discard-action-id', action);
        attachMethods(action);

        await discardFailedAction('discard-action-id');

        expect(mockState.records.has('discard-action-id')).toBe(false);
      });

      test('discardFailedAction: aksi failed reject -> dihapus', async () => {
        const action = makeRecord({ id: 'discard-reject-id', actionType: 'reject', targetOrderId: 'order-discard-reject', expectedVersion: 1, status: 'failed' });
        mockState.records.set('discard-reject-id', action);
        attachMethods(action);

        await discardFailedAction('discard-reject-id');

        expect(mockState.records.has('discard-reject-id')).toBe(false);
      });

      test('discardFailedAction: aksi COD failed TIDAK dihapus', async () => {
        const action = makeRecord({
          id: 'cod-discard-id',
          actionType: 'collect_cod',
          targetOrderId: 'order-cod-discard',
          idempotencyKey: 'cod:x',
          payloadJson: { amountCents: 1000 },
          status: 'failed',
        });
        mockState.records.set('cod-discard-id', action);
        attachMethods(action);

        await discardFailedAction('cod-discard-id');

        // COD TIDAK bisa dibuang
        expect(mockState.records.has('cod-discard-id')).toBe(true);
      });
    });

    describe('payloadJson kosong: failed', () => {
      test('COD dengan payloadJson null: failed (tidak diulang terus)', async () => {
        const action = makeRecord({
          actionType: 'collect_cod',
          targetOrderId: 'order-cod-no-payload',
          idempotencyKey: 'cod:nopayload',
          payloadJson: null,
        });
        mockState.records.set('cod-no-payload-action', action);
        attachMethods(action);

        const results = await drainPendingActions();
        expect(results[0].status).toBe('failed');
        expect(mockState.records.get('cod-no-payload-action')!.status).toBe('failed');
      });
    });
  });
});
