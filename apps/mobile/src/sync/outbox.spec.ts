/**
 * Unit tests for Pending Actions Outbox: enqueue and drain logic.
 */

// Shared state
const mockState = {
  records: new Map<string, any>(),
  batchOps: [] as Array<{ type: string; row: any; fn?: (r: any) => void }>,
  // Per-test query overrides
  queryOverrides: [] as Array<{ matcher: string; results: any[] }>,
};

function clearMockState() {
  mockState.records.clear();
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
  row.destroyPermanently = async function() {
    // mockState.records keys are arbitrary test labels, not row.id, so
    // delete by reference identity rather than by row.id.
    for (const [key, val] of mockState.records) {
      if (val === row) {
        mockState.records.delete(key);
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

jest.mock('./client', () => ({
  rejectOrder: jest.fn(),
  cancelOrder: jest.fn(),
  collectCodOrder: jest.fn(),
  UnauthorizedError: class extends Error {
    constructor() { super('Unauthorized'); this.name = 'UnauthorizedError'; }
  },
}));

jest.mock('./idempotency', () => ({
  generateCodIdempotencyKey: jest.fn().mockResolvedValue('cod:test-uuid-123'),
}));

jest.mock('./syncEvents', () => ({
  syncEvents: { emit: jest.fn(), on: jest.fn(), off: jest.fn() },
}));

jest.mock('../db', () => ({
  database: {
    get(name: string) {
      if (name === 'orders') {
        return { find() { return Promise.resolve({ update() {} }); } };
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
          // record's (camelCase) JS property names — this is deliberately
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
      };
    },
    async write<T>(fn: () => Promise<T>): Promise<T> {
      for (const op of mockState.batchOps) {
        if (op.type === 'update' && op.fn) op.fn(op.row);
      }
      mockState.batchOps = [];
      return fn();
    },
    async batch(..._ops: unknown[]) {
      mockState.batchOps = [];
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
} from './outbox';
import { rejectOrder, cancelOrder, collectCodOrder } from './client';
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
      expect(actions[0].actionType).toBe('reject');
      expect(actions[0].targetOrderId).toBe('order-abc');
      expect(actions[0].expectedVersion).toBe(5);
      expect(actions[0].status).toBe('pending');
    });

    test('returns error when not authenticated', async () => {
      const { getCurrentUserId } = require('./session');
      (getCurrentUserId as jest.Mock).mockResolvedValueOnce(null);
      const result = await enqueueReject('order-xyz', 3);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not authenticated');
    });
  });

  describe('enqueueCancel()', () => {
    test('creates pending_action row with reason in payload', async () => {
      const result = await enqueueCancel('order-xyz', 7, 'Customer tidak ada di lokasi');
      expect(result.success).toBe(true);
      const actions = [...mockState.records.values()];
      expect(actions[0].actionType).toBe('cancel');
      expect(actions[0].payloadJson).toEqual({ reason: 'Customer tidak ada di lokasi' });
    });

    test('creates pending_action row without reason', async () => {
      const result = await enqueueCancel('order-no-reason', 1);
      expect(result.success).toBe(true);
      expect([...mockState.records.values()][0].payloadJson).toEqual({});
    });
  });

  describe('enqueueCollectCod()', () => {
    test('creates pending_action row with amountCents in payload', async () => {
      const result = await enqueueCollectCod('order-cod', 50000);
      expect(result.success).toBe(true);
      const actions = [...mockState.records.values()];
      expect(actions[0].actionType).toBe('collect_cod');
      expect(actions[0].payloadJson).toEqual({ amountCents: 50000 });
      expect(actions[0].idempotencyKey).toBe('cod:test-uuid-123');
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
      mockRejectOrder.mockResolvedValue({ id: 'order-success', status: 'CONFIRMED', version: 4 } as any);
      const results = await drainPendingActions();
      expect(results[0].status).toBe('success');
      expect(mockState.records.has('success-action')).toBe(false);
    });

    test('conflict: marks action failed, emits conflict event', async () => {
      const action = makeRecord({ actionType: 'reject', targetOrderId: 'order-conflict', expectedVersion: 3 });
      mockState.records.set('conflict-action', action);
      attachMethods(action);
      mockRejectOrder.mockRejectedValue({ status: 409 });
      const results = await drainPendingActions();
      expect(results[0].status).toBe('conflict');
      expect(syncEvents.emit).toHaveBeenCalledWith('orderConflict', expect.objectContaining({ orderId: 'order-conflict' }));
    });

    test('orphaned COD: marks status orphaned_needs_review, does NOT delete', async () => {
      const action = makeRecord({ actionType: 'collect_cod', targetOrderId: 'order-orphaned', idempotencyKey: 'cod:key', payloadJson: { amountCents: 30000 } });
      mockState.records.set('orphaned-action', action);
      attachMethods(action);
      mockCollectCodOrder.mockRejectedValue(new Error('Order not found'));
      const results = await drainPendingActions();
      expect(results[0].status).toBe('orphaned');
      expect(mockState.records.get('orphaned-action')!.status).toBe('orphaned_needs_review');
    });

    test('network error: marks action failed, does not delete', async () => {
      const action = makeRecord({ actionType: 'cancel', targetOrderId: 'order-network-fail', payloadJson: { reason: 'Test' }});
      mockState.records.set('network-action', action);
      attachMethods(action);
      mockCancelOrder.mockRejectedValue(new Error('Network request failed'));
      const results = await drainPendingActions();
      expect(results[0].status).toBe('failed');
      expect(mockState.records.get('network-action')!.status).toBe('failed');
    });

    test('idempotency key stability: same key used on retry', async () => {
      const action = makeRecord({ actionType: 'collect_cod', targetOrderId: 'order-idempotent', idempotencyKey: 'cod:stable-key-123', payloadJson: { amountCents: 40000 } });
      mockState.records.set('idempotent-action', action);
      attachMethods(action);
      mockCollectCodOrder.mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce({ id: 'order-idempotent', status: 'CAPTURED', version: 5 } as any);
      const results1 = await drainPendingActions();
      expect(results1[0].status).toBe('failed');
      const remaining = mockState.records.get('idempotent-action')!;
      remaining.status = 'pending';
      mockCollectCodOrder.mockClear();
      mockCollectCodOrder.mockResolvedValue({ id: 'order-idempotent', status: 'CAPTURED', version: 5 } as any);
      const results2 = await drainPendingActions();
      expect(results2[0].status).toBe('success');
      expect(mockCollectCodOrder).toHaveBeenCalledWith('order-idempotent', 40000, 'cod:stable-key-123');
    });

    test('processes actions in FIFO order (oldest first)', async () => {
      const action1 = makeRecord({ actionType: 'reject', targetOrderId: 'order-fifo', createdAt: Date.now() - 100 });
      const action2 = makeRecord({ actionType: 'cancel', targetOrderId: 'order-fifo' });
      mockState.records.set('first-action', action1);
      mockState.records.set('second-action', action2);
      attachMethods(action1);
      attachMethods(action2);
      mockRejectOrder.mockResolvedValue({ id: 'order-fifo', status: 'CONFIRMED', version: 2 } as any);
      mockCancelOrder.mockResolvedValue({ id: 'order-fifo', status: 'CANCELLED', version: 3 } as any);
      const results = await drainPendingActions();
      expect(results).toHaveLength(2);
      expect(mockRejectOrder.mock.invocationCallOrder[0]).toBeLessThan(mockCancelOrder.mock.invocationCallOrder[0]);
    });
  });
});
