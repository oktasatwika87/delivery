/**
 * Unit tests untuk ordersSocket.ts — OrdersSocketManager
 *
 * Pattern: SATU mockSocket instance, state di-reset tiap beforeEach
 * connect() itu ASYNC — perlu flush microtask queue
 */

// Module-level mock state
var mockHandlers: Record<string, Set<Function>> = {};
var isConnected = false;
var ioCallHistory: Array<{url: string; options: any}> = [];

var mockSocket = {
  get connected() { return isConnected; },
  id: 'mock-socket-id',
  get handlers() { return mockHandlers; },
  on: jest.fn(function(event: string, handler: Function) {
    if (!mockHandlers[event]) mockHandlers[event] = new Set();
    mockHandlers[event].add(handler);
  }),
  once: jest.fn(function(event: string, handler: Function) {
    if (!mockHandlers[event]) mockHandlers[event] = new Set();
    mockHandlers[event].add(handler);
  }),
  off: jest.fn(function(event: string) {
    if (event) {
      delete mockHandlers[event];
    } else {
      Object.keys(mockHandlers).forEach(function(k) { delete mockHandlers[k]; });
    }
  }),
  disconnect: jest.fn(function() { isConnected = false; }),
  emit: jest.fn(),
};

jest.mock('socket.io-client', () => ({
  io: jest.fn(function(url: string, options: any) {
    // Clear handlers dari socket instance sebelumnya. Real socket.io
    // punya handlers per-instance (ter-isolasi), tapi mock ini singleton
    // jadi handler accumulate. Clear manual untuk mirror real behavior —
    // supaya handler dari old socket gak fire di new socket (yang sebelumnya
    // bug Limitation 1: saat reconnect_failed trigger recreate, handler
    // 'connect' dari old socket masih di Set dan bakal clear connectResolve
    // yang baru).
    Object.keys(mockHandlers).forEach(function(k) { delete mockHandlers[k]; });
    ioCallHistory.push({ url, options });
    return mockSocket;
  }),
}));

var getCurrentTokenMock = jest.fn(() => Promise.resolve('test-token'));

jest.mock('./session', () => ({
  getCurrentToken: getCurrentTokenMock,
}));

function trigger(event: string, ...args: any[]) {
  var handlers = mockHandlers[event];
  if (handlers) handlers.forEach(function(h: Function) { h.apply(null, args); });
  if (event === 'connect') {
    isConnected = true;
  } else if (event === 'disconnect') {
    // Mirror real socket.io: socket.connected = false setelah disconnect event.
    // Tanpa reset ini, mockSocket.connected tetap true → connect() berikutnya
    // bakal early-return dan io() TIDAK dipanggil ulang, jadi test transisi
    // reconnection config (3 → Infinity) bakal fail.
    isConnected = false;
  }
}

describe('OrdersSocketManager', () => {
  var ordersSocket: any;
  var getCurrentTokenMock: jest.Mock;

  beforeEach(async () => {
    // 1. Reset module cache — singleton
    jest.resetModules();

    // 2. Reset mock state
    isConnected = false;
    ioCallHistory = [];
    Object.keys(mockHandlers).forEach((k) => delete mockHandlers[k]);
    jest.clearAllMocks();

    // 3. Re-require
    var socketModule = require('./ordersSocket');
    ordersSocket = socketModule.ordersSocket;

    var sessionModule = require('./session');
    getCurrentTokenMock = sessionModule.getCurrentToken;
    getCurrentTokenMock.mockResolvedValue('test-token');
  });

  afterEach(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  describe('connect() promise behavior', () => {
    test('resolve setelah connected', async () => {
      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await expect(promise).resolves.toBeUndefined();
    });

    test('idempotent: multiple connect() calls return same promise', async () => {
      var io = require('socket.io-client') as any;

      var p1 = ordersSocket.connect();
      var p2 = ordersSocket.connect();
      var p3 = ordersSocket.connect();

      expect(p2).toBe(p1);
      expect(p3).toBe(p1);

      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await p1;

      expect(io.io).toHaveBeenCalledTimes(1);
    });

    test('reject kalau no token', async () => {
      getCurrentTokenMock.mockResolvedValue(null);

      await expect(ordersSocket.connect()).rejects.toThrow('No auth token available');
      expect(require('socket.io-client').io).not.toHaveBeenCalled();
    });

    test('reject kalau getCurrentToken rejects', async () => {
      getCurrentTokenMock.mockRejectedValue(new Error('Token fetch failed'));

      await expect(ordersSocket.connect()).rejects.toThrow('Token fetch failed');
    });

    test('reject kalau reconnect_failed (initial connect failed after retries)', async () => {
      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('reconnect_failed');
      await expect(promise).rejects.toThrow('Failed to connect after retries');
    });

    test('reject kalau disconnect() dipanggil sebelum connect', async () => {
      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      ordersSocket.disconnect();
      await expect(promise).rejects.toThrow('Disconnected before connection established');
    });
  });

  describe('connect() success', () => {
    test('socket connects dengan auth token', async () => {
      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      expect(ioCallHistory[0].options.auth).toEqual({ token: 'test-token' });
      expect(ioCallHistory[0].url).toContain('/orders');
    });

    test('socket connects dengan reconnection config (initial)', async () => {
      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      expect(ioCallHistory[0].options.reconnection).toBe(true);
      expect(ioCallHistory[0].options.reconnectionAttempts).toBe(3);
    });
  });

  describe('adaptive reconnection config', () => {
    /**
     * Coverage untuk transisi initial fail-fast → reconnect unlimited.
     *
     * Mirroring design contract dari ChatSocketManager:
     * - Initial connect (hasEverConnected=false): reconnectionAttempts = 3
     * - Reconnect setelah pernah connect: reconnectionAttempts = Infinity
     *
     * Catatan desain (sama seperti ChatSocketManager):
     * socket.io pakai config yang sama sepanjang lifetime socket,
     * jadi transisi 3 → Infinity cuma terjadi kalau ada code yang
     * panggil connect() lagi setelah disconnect — yang akan bikin
     * io() baru dengan config berdasarkan hasEverConnected yang true.
     * Auto-reconnect internal socket.io dari network drop pake config
     * awal (3 attempts), bukan Infinity.
     */
    test('reconnect setelah non-intentional disconnect pakai Infinity (bukan 3)', async () => {
      // 1. Initial connect sukses — hasEverConnected jadi true, config fail-fast
      var promise1 = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise1;

      // Precondition: initial config adalah 3 (fail-fast)
      expect(ordersSocket.wasEverConnected).toBe(true);
      expect(ioCallHistory[0].options.reconnectionAttempts).toBe(3);

      // 2. Simulasi non-intentional disconnect dari server/network
      //    (BUKAN manager.disconnect() — itu bakal null this.socket
      //    dan skip jalur reconnect yang sebenarnya)
      trigger('disconnect', 'server namespace disconnect');

      // 3. Precondition: hasEverConnected HARUS tetap true setelah
      //    disconnect. Kalau flag ini ke-reset ke false, config
      //    berikutnya bakal balik ke 3 (fail-fast) lagi.
      expect(ordersSocket.wasEverConnected).toBe(true);

      // 4. External code / retry mechanism panggil connect() lagi
      //    setelah disconnect. Karena hasEverConnected=true, io()
      //    berikutnya harus pake unlimited reconnect config.
      var promise2 = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise2;

      // 5. io() dipanggil 2x total — call ke-2 harus pake Infinity
      var ioMock = require('socket.io-client').io;
      expect(ioMock).toHaveBeenCalledTimes(2);

      var secondCallArgs = ioCallHistory[1];
      expect(secondCallArgs.options.reconnection).toBe(true);
      expect(secondCallArgs.options.reconnectionAttempts).toBe(Infinity);
      expect(secondCallArgs.options.reconnectionDelay).toBe(100);
      expect(secondCallArgs.options.reconnectionDelayMax).toBe(30000);
    });

    test('manager auto-recreate socket Infinity saat reconnect_failed setelah initial success', async () => {
      // 1. Initial connect sukses — hasEverConnected=true, io() config 3
      var promise1 = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise1;

      expect(ordersSocket.wasEverConnected).toBe(true);
      expect(ioCallHistory.length).toBe(1);
      expect(ioCallHistory[0].options.reconnectionAttempts).toBe(3);

      // 2. Network drop → socket.io auto-retry 3x (pake config awal 3 attempts).
      //    Semua retry gagal → 'reconnect_failed' emit. Ini menandakan
      //    initial socket-nya sudah DEAD — gak ada auto-reconnect lagi
      //    dari socket.io.
      trigger('disconnect', 'transport close');
      trigger('reconnect_failed');

      // 3. Manager harus respond ke reconnect_failed dengan recreate
      //    socket baru via io() — config baru Infinity karena
      //    hasEverConnected=true. Flush microtasks karena handler
      //    panggil void this.connect() yang async.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // 4. io() dipanggil 2x — call ke-2 dengan Infinity config
      expect(ioCallHistory.length).toBe(2);
      var secondCallArgs = ioCallHistory[1];
      expect(secondCallArgs.options.reconnection).toBe(true);
      expect(secondCallArgs.options.reconnectionAttempts).toBe(Infinity);
      expect(secondCallArgs.options.reconnectionDelay).toBe(100);
      expect(secondCallArgs.options.reconnectionDelayMax).toBe(30000);
    });

    test('reconnect_failed saat initial connect (hasEverConnected=false) tetap reject promise, gak recreate', async () => {
      // Initial connect — hasEverConnected masih false
      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();

      expect(ordersSocket.wasEverConnected).toBe(false);
      expect(ioCallHistory.length).toBe(1);
      expect(ioCallHistory[0].options.reconnectionAttempts).toBe(3);

      // Simulasi socket.io retry 3x gagal di initial
      trigger('reconnect_failed');

      // Handler harus reject promise (existing behavior) — JANGAN
      // recreate socket karena hasEverConnected=false
      await expect(promise).rejects.toThrow('Failed to connect after retries');

      // io() tetap cuma 1x — gak ada socket baru
      expect(ioCallHistory.length).toBe(1);
    });
  });

  describe('event handlers', () => {
    test('handlers registered BEFORE connect event fires', async () => {
      var availableCb = jest.fn();
      var unavailableCb = jest.fn();
      var connectCb = jest.fn();

      ordersSocket.onOrderAvailable(availableCb);
      ordersSocket.onOrderUnavailable(unavailableCb);
      ordersSocket.on('connect', connectCb);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      // Simulate server events
      trigger('order:available', {
        orderId: 'order-123',
        totalCents: 50000,
        currency: 'IDR',
        itemsCount: 2,
        city: 'Denpasar',
        createdAt: '2026-08-20T10:00:00Z',
      });
      trigger('order:unavailable', {
        orderId: 'order-456',
        reason: 'accepted',
      });

      expect(availableCb).toHaveBeenCalled();
      expect(unavailableCb).toHaveBeenCalled();
      expect(connectCb).toHaveBeenCalled();
    });

    test('onOrderAvailable callback invoked with correct payload', async () => {
      var cb = jest.fn();
      ordersSocket.onOrderAvailable(cb);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      var payload = {
        orderId: 'order-123',
        totalCents: 50000,
        currency: 'IDR',
        itemsCount: 3,
        city: 'Badung',
        createdAt: '2026-08-20T10:00:00Z',
      };
      trigger('order:available', payload);

      expect(cb).toHaveBeenCalledWith(payload);
    });

    test('onOrderUnavailable callback invoked with reason=accepted', async () => {
      var cb = jest.fn();
      ordersSocket.onOrderUnavailable(cb);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      trigger('order:unavailable', { orderId: 'order-789', reason: 'accepted' });

      expect(cb).toHaveBeenCalledWith({ orderId: 'order-789', reason: 'accepted' });
    });

    test('onOrderUnavailable callback invoked with reason=rejected', async () => {
      var cb = jest.fn();
      ordersSocket.onOrderUnavailable(cb);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      trigger('order:unavailable', { orderId: 'order-abc', reason: 'rejected' });

      expect(cb).toHaveBeenCalledWith({ orderId: 'order-abc', reason: 'rejected' });
    });

    test('onOrderUnavailable callback invoked with reason=reassigned', async () => {
      var cb = jest.fn();
      ordersSocket.onOrderUnavailable(cb);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      trigger('order:unavailable', { orderId: 'order-xyz', reason: 'reassigned' });

      expect(cb).toHaveBeenCalledWith({ orderId: 'order-xyz', reason: 'reassigned' });
    });

    test('unsubscribe removes listener', async () => {
      var cb = jest.fn();
      var unsubscribe = ordersSocket.onOrderAvailable(cb);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      unsubscribe();
      trigger('order:available', { orderId: 'order-123', totalCents: 50000, currency: 'IDR', itemsCount: 2, createdAt: '2026-08-20T10:00:00Z' });

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('disconnect()', () => {
    test('disconnect() clears socket state', async () => {
      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      expect(ordersSocket.isConnected).toBe(true);

      ordersSocket.disconnect();

      expect(mockSocket.disconnect).toHaveBeenCalled();
      expect(ordersSocket.isConnected).toBe(false);
    });

    test('disconnect() safe tanpa connect() sebelumnya', () => {
      expect(() => ordersSocket.disconnect()).not.toThrow();
    });

    test('disconnect() saat _doConnectAsync in-flight — async work bail, no socket created (race fix)', async () => {
      // Override getCurrentToken untuk delay resolution — biar _doConnectAsync
      // suspended di await token, kita bisa disconnect() di tengah-tengah.
      var resolveToken: ((token: string | null) => void) | null = null;
      getCurrentTokenMock.mockImplementation(function() {
        return new Promise<string | null>(function(resolve) {
          resolveToken = resolve;
        });
      });

      var promise = ordersSocket.connect();

      // Async work masih pending — io() belum dipanggil
      expect(ioCallHistory.length).toBe(0);

      // User disconnect saat _doConnectAsync suspended di await token.
      // Generation counter increment, connectPromise di-reject.
      ordersSocket.disconnect();

      // Resolve token — _doConnectAsync resume, gen check fails, bail
      // tanpa overwrite this.socket atau mutate state.
      resolveToken!('test-token');

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // io() HARUS gak dipanggil — _doConnectAsync bail sebelum call io()
      // karena gen !== this.generation (stale).
      expect(ioCallHistory.length).toBe(0);

      // Promise HARUS rejected (existing behavior preserved)
      await expect(promise).rejects.toThrow('Disconnected before connection established');

      // State HARUS bersih — this.socket null, this.isConnected false
      expect(ordersSocket.isConnected).toBe(false);
    });

    test('multiple connect()-disconnect()-connect() cycles — generation invalidates stale async', async () => {
      // Cycle 1: connect → disconnect mid-async → no socket created
      var resolveToken1: ((token: string | null) => void) | null = null;
      getCurrentTokenMock.mockImplementationOnce(function() {
        return new Promise<string | null>(function(resolve) {
          resolveToken1 = resolve;
        });
      });
      var promise1 = ordersSocket.connect();
      ordersSocket.disconnect();
      resolveToken1!('test-token');
      await Promise.resolve();
      await Promise.resolve();
      await expect(promise1).rejects.toThrow('Disconnected before connection established');
      expect(ioCallHistory.length).toBe(0);

      // Cycle 2: connect (token now resolves normally via beforeEach setup)
      // → async creates socket → io() called
      var promise2 = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise2;

      // io() dipanggil 1x untuk cycle 2 — cycle 1 di-bail
      expect(ioCallHistory.length).toBe(1);
      expect(ordersSocket.wasEverConnected).toBe(true);
    });
  });

  describe('isConnected / wasEverConnected', () => {
    test('isConnected returns socket state', async () => {
      expect(ordersSocket.isConnected).toBe(false);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      expect(ordersSocket.isConnected).toBe(true);
    });

    test('wasEverConnected tracks history', async () => {
      expect(ordersSocket.wasEverConnected).toBe(false);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      expect(ordersSocket.wasEverConnected).toBe(true);

      ordersSocket.disconnect();

      expect(ordersSocket.wasEverConnected).toBe(true);
    });
  });

  // ===== Customer-targeted events (Tier 3) =====
  //
  // order:accepted, order:rejected, order:cancelled di-emit oleh OrdersGateway
  // ke room customerId (lihat commit backend sebelumnya). Mobile subscribe
  // ke sini untuk live-update OrderTrackingScreen.

  describe('order:accepted event (customer-targeted)', () => {
    test('onOrderAccepted callback invoked with correct payload', async () => {
      var cb = jest.fn();
      ordersSocket.onOrderAccepted(cb);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      var payload = {
        orderId: 'order-abc',
        driverId: 'driver-xyz',
        status: 'PREPARING',
        version: 2,
      };
      trigger('order:accepted', payload);

      expect(cb).toHaveBeenCalledWith(payload);
    });

    test('unsubscribe removes listener', async () => {
      var cb = jest.fn();
      var unsubscribe = ordersSocket.onOrderAccepted(cb);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      unsubscribe();
      trigger('order:accepted', {
        orderId: 'order-abc',
        driverId: 'driver-xyz',
        status: 'PREPARING',
        version: 2,
      });

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('order:rejected event (customer-targeted)', () => {
    test('onOrderRejected callback invoked with correct payload', async () => {
      var cb = jest.fn();
      ordersSocket.onOrderRejected(cb);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      var payload = {
        orderId: 'order-def',
        status: 'CANCELLED',
        version: 3,
      };
      trigger('order:rejected', payload);

      expect(cb).toHaveBeenCalledWith(payload);
    });

    test('unsubscribe removes listener', async () => {
      var cb = jest.fn();
      var unsubscribe = ordersSocket.onOrderRejected(cb);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      unsubscribe();
      trigger('order:rejected', { orderId: 'order-def', status: 'CANCELLED', version: 3 });

      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('order:cancelled event (customer-targeted)', () => {
    test('onOrderCancelled callback invoked with correct payload + reason', async () => {
      var cb = jest.fn();
      ordersSocket.onOrderCancelled(cb);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      var payload = {
        orderId: 'order-ghi',
        status: 'CONFIRMED',
        version: 4,
        reason: 'Kendaraan mogok',
      };
      trigger('order:cancelled', payload);

      expect(cb).toHaveBeenCalledWith(payload);
    });

    test('onOrderCancelled works when reason is omitted', async () => {
      var cb = jest.fn();
      ordersSocket.onOrderCancelled(cb);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      trigger('order:cancelled', {
        orderId: 'order-ghi',
        status: 'CONFIRMED',
        version: 4,
      });

      expect(cb).toHaveBeenCalledWith({
        orderId: 'order-ghi',
        status: 'CONFIRMED',
        version: 4,
      });
    });

    test('unsubscribe removes listener', async () => {
      var cb = jest.fn();
      var unsubscribe = ordersSocket.onOrderCancelled(cb);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      unsubscribe();
      trigger('order:cancelled', { orderId: 'order-ghi', status: 'CONFIRMED', version: 4 });

      expect(cb).not.toHaveBeenCalled();
    });
  });
});
