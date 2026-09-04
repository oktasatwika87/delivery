/**
 * Unit tests untuk socket.ts — ChatSocketManager
 *
 * Approach:
 * - SATU mockSocket instance, state di-reset tiap beforeEach
 * - connect() itu ASYNC (await getCurrentToken) — perlu flush microtask queue
 * - afterEach: cleanup dengan flush promise queue
 *
 * KNOWN ISSUES:
 * - chatSocket singleton listeners (this.listeners) accumulate across tests
 * - disconnect() rejection doesn't propagate cleanly via toThrow matcher
 */

var mockHandlers: Record<string, Set<Function>> = {};
var isConnected = false;

// Track io() call arguments — array of [url, options] pairs per call
var ioCallHistory: Array<{ url: string; options: any }> = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface MockSocket {
  readonly connected: boolean;
  id: string;
  readonly handlers: Record<string, Set<Function>>;
  on: any;
  once: any;
  off: any;
  disconnect: any;
  emit: any;
}

// @ts-expect-error - mockSocket declared later to avoid Jest hoisting conflict
var mockSocket: MockSocket = {
  get connected() { return isConnected; },
  id: 'mock-socket-id',
  get handlers() { return mockHandlers; },
  on: jest.fn(function(event, handler) {
    if (!mockHandlers[event]) mockHandlers[event] = new Set();
    mockHandlers[event].add(handler);
  }),
  once: jest.fn(function(event, handler) {
    if (!mockHandlers[event]) mockHandlers[event] = new Set();
    mockHandlers[event].add(handler);
  }),
  off: jest.fn(function(event) {
    if (event) {
      delete mockHandlers[event];
    } else {
      Object.keys(mockHandlers).forEach(function(k) { delete mockHandlers[k]; });
    }
  }),
  disconnect: jest.fn(function() { isConnected = false; }),
  emit: jest.fn(),
};

jest.mock('socket.io-client', function() {
  return {
    io: jest.fn(function(url, options) {
      // Track every io() call with its arguments for assertion
      ioCallHistory.push({ url: url, options: options });
      return mockSocket;
    })
  };
});

var getCurrentTokenMock = jest.fn(function() {
  return Promise.resolve('test-token');
});

jest.mock('./session', function() {
  return { getCurrentToken: getCurrentTokenMock };
});

function trigger(event: string) {
  var args = Array.prototype.slice.call(arguments, 1);
  var handlers = mockHandlers[event];
  if (handlers) handlers.forEach(function(h) { h.apply(null, args); });
  // Simulate socket state changes for 'connect' event
  if (event === 'connect') {
    isConnected = true;
  }
}

describe('ChatSocketManager', function() {
  var chatSocket: any;
  var getCurrentTokenMock: any;

  beforeEach(function() {
    // 1. Reset module cache — ini penting karena chatSocket adalah singleton
    //    (export const chatSocket = new ChatSocketManager()). Tanpa resetModules,
    //    require('./socket') berikutnya return module cached dan singleton state
    //    (hasEverConnected, connectPromise, dll.) ikut terbawa antar test.
    jest.resetModules();

    // 2. Reset mock state SEBELUM require — mockHandlers, isConnected, dan ioCallHistory
    //    adalah variable module-level, bukan export, jadi tidak ter-reset oleh resetModules.
    isConnected = false;
    ioCallHistory = [];
    Object.keys(mockHandlers).forEach(function(k) { delete mockHandlers[k]; });
    jest.clearAllMocks();

    // 3. Re-require ./socket dan ./session. PENTING: getCurrentTokenMock di-reassign
    //    dari require() yang BARU, karena jest.mock('./session') factory di-top-level
    //    dieksekusi ulang tiap module di-require setelah resetModules. Variable
    //    module-level `getCurrentTokenMock` di atas menjadi stale reference.
    var socketModule = require('./socket');
    chatSocket = socketModule.chatSocket;

    var sessionModule = require('./session');
    getCurrentTokenMock = sessionModule.getCurrentToken;
    getCurrentTokenMock.mockResolvedValue('test-token');
  });

  afterEach(async function() {
    // Cleanup: flush all pending microtasks before next test
    // This prevents promise rejections from bleeding into next test
    await Promise.resolve();
    await Promise.resolve();
  });

  describe('hasEverConnected flag', function() {
    test('awalnya false', function() {
      expect(chatSocket.wasEverConnected).toBe(false);
    });

    test('menjadi true setelah connect() berhasil', async function() {
      expect(chatSocket.wasEverConnected).toBe(false);

      var promise = chatSocket.connect();
      // Flush microtask queue (token fetch + handler setup)
      await Promise.resolve();
      await Promise.resolve();

      // NOW trigger the connect event
      trigger('connect');
      await promise;

      expect(chatSocket.wasEverConnected).toBe(true);
    });

    test('tetap true setelah disconnect', async function() {
      var promise = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      chatSocket.disconnect();
      expect(chatSocket.wasEverConnected).toBe(true);
    });
  });

  describe('connect() promise behavior', function() {
    test('resolve setelah connected', async function() {
      var promise = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await expect(promise).resolves.toBeUndefined();
    });

    test('idempotent: 2x connect() sebelum resolve pertama return promise YANG SAMA', async function() {
      var ioMock = require('socket.io-client').io;

      var promise1 = chatSocket.connect();
      var promise2 = chatSocket.connect();
      var promise3 = chatSocket.connect();

      // Ketiga promise harus reference yang sama
      expect(promise2).toBe(promise1);
      expect(promise3).toBe(promise1);

      // Flush microtask queue
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise1;

      // io() HARUS cuma dipanggil sekali — bukan 3x
      expect(ioMock).toHaveBeenCalledTimes(1);
    });

    test('idempotent: connect() lagi setelah sudah connected resolve immediately', async function() {
      var ioMock = require('socket.io-client').io;

      var promise1 = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise1;

      expect(ioMock).toHaveBeenCalledTimes(1);

      // Sekarang sudah connected — connect() lagi harus resolve langsung
      // tanpa bikin socket baru
      var promise2 = chatSocket.connect();
      await expect(promise2).resolves.toBeUndefined();

      // io() tetap cuma sekali — tidak ada socket baru
      expect(ioMock).toHaveBeenCalledTimes(1);
    });

    test('REJECT kalau initial connect gagal setelah 3x retry', async function() {
      var promise = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('reconnect_failed');
      await expect(promise).rejects.toThrow('Failed to connect after retries');
    });

    test('REJECT kalau disconnect() dipanggil sebelum connect berhasil', async function() {
      var promise = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      chatSocket.disconnect();
      await expect(promise).rejects.toThrow('Disconnected before connection established');
    });

    test('REJECT kalau getCurrentToken return null/undefined (no token)', async function() {
      // Override default token behavior untuk test ini saja — getCurrentTokenMock
      // di-reassign dari require() di beforeEach, jadi bisa di-override per test.
      getCurrentTokenMock.mockResolvedValueOnce(null);

      await expect(chatSocket.connect()).rejects.toThrow('No auth token available');
      // io() TIDAK boleh dipanggil kalau token missing — socket tidak dibuat
      var ioMock = require('socket.io-client').io;
      expect(ioMock).not.toHaveBeenCalled();
    });

    test('disconnect() TIDAK throw walaupun dipanggil tanpa connect() sebelumnya', function() {
      // disconnect() harus idempotent / safe — boleh dipanggil kapan saja.
      // Pemanggil (mis. logout flow) tidak perlu cek state dulu.
      expect(function() { chatSocket.disconnect(); }).not.toThrow();
    });

    test('disconnect() TIDAK throw walaupun dipanggil 2x berturut-turut', async function() {
      var promise = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      expect(function() {
        chatSocket.disconnect();
        chatSocket.disconnect();
      }).not.toThrow();
    });
  });

  describe('isConnected', function() {
    test('false saat belum connect', function() {
      expect(chatSocket.isConnected).toBe(false);
    });
  });

  describe('event forwarding', function() {
    test('forward disconnect event', async function() {
      // Connect first to register internal handlers
      var promise = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      var h = jest.fn();
      chatSocket.on('disconnect', h);
      trigger('disconnect', 'server shutdown');
      expect(h).toHaveBeenCalledWith('server shutdown');
    });

    test('forward connect_error event', async function() {
      var promise = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      var h = jest.fn();
      chatSocket.on('connect_error', h);
      trigger('connect_error', { message: 'auth failed' });
      expect(h).toHaveBeenCalledWith('auth failed');
    });

    test('unsubscribe works', async function() {
      var promise = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise;

      var h = jest.fn();
      var unsub = chatSocket.on('disconnect', h);
      trigger('disconnect');
      expect(h).toHaveBeenCalledTimes(1);
      unsub();
      trigger('disconnect');
      expect(h).toHaveBeenCalledTimes(1);
    });
  });

  describe('adaptive reconnection config', function() {
    // Mechanism confirmed in Part A:
    // - io() is called ONCE per connect() call
    // - Config is determined by hasEverConnected flag at time of io() call
    // - hasEverConnected becomes true when 'connect' event fires
    // - Subsequent connect() calls (after disconnect) create NEW socket with Infinity attempts

    test('initial connect uses fail-fast: reconnectionAttempts = 3', async function() {
      var promise = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();

      // io() was called once with initial config
      var ioMock = require('socket.io-client').io;
      expect(ioMock).toHaveBeenCalledTimes(1);

      // Assert the first io() call used 3 attempts (fail-fast)
      var firstCallArgs = ioCallHistory[0];
      expect(firstCallArgs.options.reconnectionAttempts).toBe(3);
      expect(firstCallArgs.options.reconnectionDelay).toBe(100);
      expect(firstCallArgs.options.reconnectionDelayMax).toBe(1000);
      expect(firstCallArgs.options.reconnection).toBe(true);

      // Complete the connection
      trigger('connect');
      await promise;
    });

    test('reconnect after disconnect uses unlimited: reconnectionAttempts = Infinity', async function() {
      // First: establish initial connection
      var promise1 = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise1;

      // Verify hasEverConnected is now true
      expect(chatSocket.wasEverConnected).toBe(true);

      // Disconnect
      chatSocket.disconnect();

      // Second: connect again — should use different config
      var promise2 = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise2;

      // io() was called TWICE (once per connect() call)
      var ioMock = require('socket.io-client').io;
      expect(ioMock).toHaveBeenCalledTimes(2);

      // Assert the SECOND io() call used Infinity attempts (unlimited reconnect)
      var secondCallArgs = ioCallHistory[1];
      expect(secondCallArgs.options.reconnectionAttempts).toBe(Infinity);
      expect(secondCallArgs.options.reconnectionDelay).toBe(100);
      expect(secondCallArgs.options.reconnectionDelayMax).toBe(30000);
      expect(secondCallArgs.options.reconnection).toBe(true);
    });

    test('both calls use same token auth', async function() {
      // Initial connect
      var promise1 = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise1;

      // Disconnect and reconnect
      chatSocket.disconnect();
      var promise2 = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise2;

      // Both calls should have auth.token
      expect(ioCallHistory[0].options.auth.token).toBe('test-token');
      expect(ioCallHistory[1].options.auth.token).toBe('test-token');
    });

    test('reconnect_failed handler only registered on initial connect', async function() {
      // mockSocket is module-level, so we can access its once() mock directly
      // Clear any previous calls
      mockSocket.once.mockClear();

      // Initial connect
      var promise1 = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise1;

      // Verify once('reconnect_failed') was called during initial connect
      var reconnectFailedCallsInitial = mockSocket.once.mock.calls.filter(
        function(call) { return call[0] === 'reconnect_failed'; }
      );
      expect(reconnectFailedCallsInitial.length).toBe(1);

      // Count of once('reconnect_failed') calls so far
      var onceCallCountAfterInitial = reconnectFailedCallsInitial.length;

      // Disconnect and reconnect
      chatSocket.disconnect();
      var promise2 = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise2;

      // Count of once('reconnect_failed') calls after reconnect
      var reconnectFailedCallsAfter = mockSocket.once.mock.calls.filter(
        function(call) { return call[0] === 'reconnect_failed'; }
      );
      var onceCallCountAfterReconnect = reconnectFailedCallsAfter.length;

      // Should be same count - no new reconnect_failed handler registered
      expect(onceCallCountAfterReconnect).toBe(onceCallCountAfterInitial);
    });
  });
});
