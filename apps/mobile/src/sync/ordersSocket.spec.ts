/**
 * Unit tests untuk ordersSocket.ts, OrdersSocketManager
 *
 * Pattern: SATU mockSocket instance, state di-reset tiap beforeEach
 * connect() itu ASYNC, perlu flush microtask queue
 */

// Module-level mock state
var mockHandlers: Record<string, Set<Function>> = {};
var isConnected = false;
// `active` mirror socket.io asli: true saat socket hidup (meskipun belum
// tersambung ke server), false setelah server menolak dengan `connect_error`
// yang tidak memiliki plan retry (auth 401). Default true supaya tes
// connect_error jaringan tetap memperlakukan socket sebagai hidup; tes
// khusus auth-error men-set false sebelum trigger connect_error.
var isActive = true;
var ioCallHistory: Array<{url: string; options: any}> = [];

var mockSocket = {
  get connected() { return isConnected; },
  get active() { return isActive; },
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
    // jadi handler accumulate. Clear manual untuk mirror real behavior,
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

// Mock syncEvents: spec ini memantau emit('auth-expired', ...) di test
// "socket orders ditolak server". Mock emit mock biar bisa di-mockClear
// dan di-inspect.
jest.mock('./syncEvents', () => ({
  syncEvents: {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
  },
}));

function trigger(event: string, ...args: any[]) {
  var handlers = mockHandlers[event];
  if (handlers) handlers.forEach(function(h: Function) { h.apply(null, args); });
  if (event === 'connect') {
    isConnected = true;
  } else if (event === 'disconnect') {
    // Mirror real socket.io: socket.connected = false setelah disconnect event.
    // Tanpa reset ini, mockSocket.connected tetap true, connect() berikutnya
    // bakal early-return dan io() TIDAK dipanggil ulang, jadi test transisi
    // reconnection config (3 jadi Infinity) bakal fail.
    isConnected = false;
  }
}

// Test helper: set socket inactive (server menolak tanpa retry).
function setActive(value: boolean): void {
  isActive = value;
}

describe('OrdersSocketManager', () => {
  var ordersSocket: any;
  var getCurrentTokenMock: jest.Mock;

  beforeEach(async () => {
    // 1. Reset module cache, singleton
    jest.resetModules();

    // 2. Reset mock state
    isConnected = false;
    isActive = true;
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

    // Dulu handler reconnect_failed dipasang dan membuat promise reject.
    // Sekarang handler itu tidak ada, jadi event reconnect_failed tidak
    // mengubah apa pun dan pemanggil tetap menunggu 'connect' berikutnya.
    test('event reconnect_failed tidak bikin connect() reject', async () => {
      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('reconnect_failed');

      // Setelah reconnect_failed, sambungan tetap bisa sukses dan promise resolve.
      trigger('connect');
      await expect(promise).resolves.toBeUndefined();
    });

    test('reject kalau disconnect() dipanggil sebelum connect', async () => {
      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      ordersSocket.disconnect();
      await expect(promise).rejects.toThrow('Disconnected before connection established');
    });

    // Sejak koneksi pertama socket.io mencoba ulang tanpa batas. Kalau
    // jaringan gagal, promise tidak reject dan pemanggil cukup menunggu
    // 'connect' berikutnya.
    test('connect() tidak reject setelah beberapa connect_error, lalu resolve saat connect', async () => {
      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();

      // Picu beberapa connect_error (jaringan putus sesaat). Promise harus
      // tetap pending, tidak reject.
      trigger('connect_error', { message: 'network error' });
      trigger('connect_error', { message: 'network error' });
      trigger('connect_error', { message: 'network error' });

      // Setelah beberapa kali gagal, sambungan sukses dan promise resolve.
      trigger('connect');
      await expect(promise).resolves.toBeUndefined();
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

    // Koneksi pertama harus sudah Infinity dan delayMax 10000. Dulu koneksi
    // pertama dibatasi 3 kali percobaan dengan delayMax 1 s, dan socket
    // pertama mati setelah 3 kali gagal karena socket.io v4.8.3 tidak
    // memancarkan reconnect_failed dari socket.
    test('koneksi pertama pakai reconnectionAttempts Infinity dan reconnectionDelayMax 10000', async () => {
      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      expect(ioCallHistory[0].options.reconnection).toBe(true);
      expect(ioCallHistory[0].options.reconnectionAttempts).toBe(Infinity);
      expect(ioCallHistory[0].options.reconnectionDelay).toBe(100);
      expect(ioCallHistory[0].options.reconnectionDelayMax).toBe(10000);
    });
  });

  describe('adaptive reconnection config', () => {
    /**
     * Konfigurasi reconnect tanpa batas sama di setiap panggilan io():
     * - Koneksi pertama: reconnectionAttempts = Infinity, delayMax = 10000
     * - Sambung ulang setelah pernah tersambung: sama persis
     *
     * Dulu koneksi pertama dibatasi 3 kali percobaan (delayMax 1 s), lalu
     * pindah ke Infinity setelah pernah tersambung. Karena handler
     * reconnect_failed tidak pernah terpanggil dari socket, socket pertama
     * mati setelah 3 kali gagal. Sekarang selalu Infinity.
     */
    test('setelah disconnect lalu connect lagi, konfigurasi tetap Infinity', async () => {
      // 1. Koneksi pertama sukses
      var promise1 = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise1;

      // Syarat awal: konfigurasi pertama sudah Infinity
      expect(ordersSocket.wasEverConnected).toBe(true);
      expect(ioCallHistory[0].options.reconnectionAttempts).toBe(Infinity);
      expect(ioCallHistory[0].options.reconnectionDelayMax).toBe(10000);

      // 2. Simulasi non-intentional disconnect dari server/network
      //    (bukan manager.disconnect(), karena itu membuat this.socket null
      //    dan skip jalur reconnect yang sebenarnya)
      trigger('disconnect', 'server namespace disconnect');

      // 3. hasEverConnected harus tetap true setelah disconnect
      expect(ordersSocket.wasEverConnected).toBe(true);

      // 4. Kode lain memanggil connect() lagi setelah disconnect. io()
      //    berikutnya harus pakai konfigurasi yang sama dengan koneksi
      //    pertama, bukan delayMax 30000 seperti dulu.
      var promise2 = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise2;

      // 5. io() dipanggil 2 kali, panggilan kedua juga pakai Infinity
      var ioMock = require('socket.io-client').io;
      expect(ioMock).toHaveBeenCalledTimes(2);

      var secondCallArgs = ioCallHistory[1];
      expect(secondCallArgs.options.reconnection).toBe(true);
      expect(secondCallArgs.options.reconnectionAttempts).toBe(Infinity);
      expect(secondCallArgs.options.reconnectionDelay).toBe(100);
      expect(secondCallArgs.options.reconnectionDelayMax).toBe(10000);
    });

    // Dulu handler reconnect_failed membuat socket baru dengan konfigurasi
    // Infinity. Sekarang handler itu tidak ada, jadi event reconnect_failed
    // tidak membuat socket baru. socket.io sudah mencoba ulang sendiri tanpa
    // batas, pemanggil cukup menunggu 'connect' berikutnya di socket yang sama.
    test('reconnect_failed setelah pernah tersambung tidak membuat socket baru', async () => {
      // 1. Koneksi pertama sukses, hasEverConnected=true
      var promise1 = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise1;

      expect(ordersSocket.wasEverConnected).toBe(true);
      expect(ioCallHistory.length).toBe(1);
      expect(ioCallHistory[0].options.reconnectionAttempts).toBe(Infinity);

      // 2. Jaringan putus. Dengan Infinity, reconnect_failed tidak pernah
      //    muncul dari socket. Tes ini memastikan kalaupun mock memancarkan
      //    event itu, manajer tidak membuat socket baru.
      trigger('disconnect', 'transport close');
      trigger('reconnect_failed');

      // Tunggu microtask. Kalau handler reconnect_failed masih ada, di sini
      // dia akan memanggil this.connect().
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // io() tetap cuma sekali, tidak ada socket baru.
      expect(ioCallHistory.length).toBe(1);
    });

    test('reconnect_failed sebelum pernah tersambung tidak membuat promise reject', async () => {
      // Koneksi pertama, hasEverConnected masih false
      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();

      expect(ordersSocket.wasEverConnected).toBe(false);
      expect(ioCallHistory.length).toBe(1);
      expect(ioCallHistory[0].options.reconnectionAttempts).toBe(Infinity);

      // Dulu reconnect_failed di koneksi pertama membuat promise reject.
      // Sekarang handler itu tidak ada, jadi pemanggil tetap menunggu
      // 'connect' berikutnya.
      trigger('reconnect_failed');

      // Promise masih pending: setelah 'connect' promise resolve. Kalau tadi
      // sudah reject, 'connect' tidak mengubah hasilnya.
      trigger('connect');
      await expect(promise).resolves.toBeUndefined();

      // io() tetap cuma sekali, tidak ada socket baru
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

    test('disconnect() saat _doConnectAsync in-flight, async work bail, no socket created (race fix)', async () => {
      // Override getCurrentToken untuk delay resolution, biar _doConnectAsync
      // suspended di await token, kita bisa disconnect() di tengah-tengah.
      var resolveToken: ((token: string | null) => void) | null = null;
      getCurrentTokenMock.mockImplementation(function() {
        return new Promise<string | null>(function(resolve) {
          resolveToken = resolve;
        });
      });

      var promise = ordersSocket.connect();

      // Async work masih pending, io() belum dipanggil
      expect(ioCallHistory.length).toBe(0);

      // User disconnect saat _doConnectAsync suspended di await token.
      // Generation counter increment, connectPromise di-reject.
      ordersSocket.disconnect();

      // Resolve token, _doConnectAsync resume, gen check fails, bail
      // tanpa overwrite this.socket atau mutate state.
      resolveToken!('test-token');

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // io() HARUS gak dipanggil, _doConnectAsync bail sebelum call io()
      // karena gen !== this.generation (stale).
      expect(ioCallHistory.length).toBe(0);

      // Promise HARUS rejected (existing behavior preserved)
      await expect(promise).rejects.toThrow('Disconnected before connection established');

      // State HARUS bersih, this.socket null, this.isConnected false
      expect(ordersSocket.isConnected).toBe(false);
    });

    test('multiple connect()-disconnect()-connect() cycles, generation invalidates stale async', async () => {
      // Cycle 1: connect, disconnect mid-async, no socket created
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
      // (lanjut), async creates socket, io() called
      var promise2 = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise2;

      // io() dipanggil 1x untuk cycle 2, cycle 1 di-bail
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

  // Socket yang ditolak server (token tidak berlaku) harus ditandai
  // berhenti dan laporan auth-expired dipancarkan lewat syncEvents.
  describe('socket orders ditolak server', () => {
    function authEmit(): jest.Mock {
      return jest.requireMock('./syncEvents').syncEvents.emit;
    }

    it('connect_error dengan message "UNAUTHORIZED" saat active=false: promise reject, auth-expired dipancarkan, connect berikutnya memanggil io lagi', async () => {
      var ioMock = require('socket.io-client').io;
      var emit = authEmit();
      emit.mockClear();

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();

      // socket.io v4: setelah middleware menolak, socket.active false.
      setActive(false);
      trigger('connect_error', { message: 'UNAUTHORIZED' });

      await expect(promise).rejects.toThrow('UNAUTHORIZED');

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(
        'auth-expired',
        { source: 'orders-socket', token: 'test-token' },
      );

      setActive(true);
      var promise2 = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise2;

      expect(ioMock).toHaveBeenCalledTimes(2);
    });

    it('connect_error gagal jaringan saat active=true: promise tetap menunggu, tanpa auth-expired', async () => {
      var emit = authEmit();
      emit.mockClear();

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();

      trigger('connect_error', { message: 'network error' });
      trigger('connect_error', { message: 'network error' });
      trigger('connect');
      await expect(promise).resolves.toBeUndefined();

      expect(emit).not.toHaveBeenCalled();
    });
  });

  // ===== Customer-targeted events =====
  //
  // order:accepted, order:rejected, order:cancelled di-emit oleh OrdersGateway
  // ke room customerId. Mobile subscribe ke sini untuk live-update
  // OrderTrackingScreen.

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
        status: 'CONFIRMED',
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
      trigger('order:rejected', { orderId: 'order-def', status: 'CONFIRMED', version: 3 });

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

  describe('order:cod_collected event (customer-targeted)', () => {
    test('onOrderCodCollected callback invoked with correct payload, no status/version field', async () => {
      var cb = jest.fn();
      ordersSocket.onOrderCodCollected(cb);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      var payload = {
        orderId: 'order-jkl',
        amountCents: 50000,
        currency: 'IDR',
        collectedAt: '2026-09-02T08:00:00.000Z',
      };
      trigger('order:cod_collected', payload);

      expect(cb).toHaveBeenCalledWith(payload);
    });

    test('unsubscribe removes listener', async () => {
      var cb = jest.fn();
      var unsubscribe = ordersSocket.onOrderCodCollected(cb);

      var promise = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      unsubscribe();
      trigger('order:cod_collected', {
        orderId: 'order-jkl',
        amountCents: 50000,
        currency: 'IDR',
        collectedAt: '2026-09-02T08:00:00.000Z',
      });

      expect(cb).not.toHaveBeenCalled();
    });
  });

  // Socket lama harus dilepas (off + disconnect) sebelum manajer membuat
  // socket baru, supaya event dari socket lama tidak sampai ke pendengar
  // baru dan tidak ada dua socket yang sama-sama mencoba nyambung.
  describe('ganti socket saat connect() dipanggil lagi', () => {
    test('setelah disconnect, off() dan disconnect() socket lama terpanggil sebelum io() yang kedua', async () => {
      var ioMock = require('socket.io-client').io;

      // Sambungan pertama: connect lalu resolve, mockSocket jadi socket manajer.
      var p1 = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await p1;
      expect(ioMock).toHaveBeenCalledTimes(1);

      // Sambungan putus sesaat.
      trigger('disconnect', 'transport close');

      // Sambungan kedua: connect() lagi. off() dan disconnect() socket lama
      // harus terpanggil sebelum io() yang kedua.
      var p2 = ordersSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await p2;

      expect(ioMock).toHaveBeenCalledTimes(2);

      // Pemanggilan off() dan disconnect() pada socket lama HARUS terjadi
      // sebelum io() yang kedua dipanggil. invocationCallOrder adalah
      // nomor urut global di seluruh mock, jadi lebih kecil = lebih dulu.
      var ioSecondCallOrder = ioMock.mock.invocationCallOrder[1];
      var offCallOrder = mockSocket.off.mock.invocationCallOrder[0];
      var disconnectCallOrder = mockSocket.disconnect.mock.invocationCallOrder[0];

      expect(offCallOrder).toBeDefined();
      expect(disconnectCallOrder).toBeDefined();
      expect(offCallOrder).toBeLessThan(ioSecondCallOrder);
      expect(disconnectCallOrder).toBeLessThan(ioSecondCallOrder);
    });
  });
});

// File ini script (no top-level imports/exports) secara default -> TS2393
// duplicate function implementation bakal fire waktu ada file script
// lain di project yang declare function dengan nama sama (e.g.
// socket.spec.ts juga punya `function trigger`). export {} di bawah
// ini bikin file -> module -> function -> module-scoped, gak
// collision lagi. Test body gak berubah.
export {};
