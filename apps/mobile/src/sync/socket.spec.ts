/**
 * Unit tests untuk socket.ts, ChatSocketManager
 *
 * Approach:
 * - SATU mockSocket instance, state di-reset tiap beforeEach
 * - connect() itu ASYNC (await getCurrentToken), perlu flush microtask queue
 * - afterEach: cleanup dengan flush promise queue
 *
 * KNOWN ISSUES:
 * - chatSocket singleton listeners (this.listeners) accumulate across tests
 * - disconnect() rejection doesn't propagate cleanly via toThrow matcher
 */

var mockHandlers: Record<string, Set<Function>> = {};
// `active` mirror socket.io asli: true saat socket hidup (meskipun belum
// tersambung ke server), false setelah server menolak dengan `connect_error`
// yang tidak memiliki plan retry (auth 401). Default true supaya tes
// connect_error jaringan tetap memperlakukan socket sebagai hidup; tes
// khusus auth-error men-set false sebelum trigger connect_error.
var isActive = true;
var isConnected = false;

// Track io() call arguments, array of [url, options] pairs per call
var ioCallHistory: Array<{ url: string; options: any }> = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface MockSocket {
  readonly connected: boolean;
  readonly active: boolean;
  id: string;
  readonly handlers: Record<string, Set<Function>>;
  on: any;
  once: any;
  off: any;
  disconnect: any;
  emit: any;
}

var mockSocket: MockSocket = {
  get connected() { return isConnected; },
  get active() { return isActive; },
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

// Mock syncEvents: socket.spec memantau emit('auth-expired', ...). Mock
// dipakai lewat jest.requireMock dalam tes.
jest.mock('./syncEvents', function() {
  return {
    syncEvents: {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    },
  };
});

function trigger(event: string, ...args: any[]) {
  var handlers = mockHandlers[event];
  if (handlers) handlers.forEach(function(h) { h.apply(null, args); });
  // Simulate socket state changes for 'connect' event
  if (event === 'connect') {
    isConnected = true;
  } else if (event === 'disconnect') {
    // Seperti socket.io asli: connected jadi false setelah event disconnect.
    // Tanpa ini mockSocket.connected tetap true, jadi connect() berikutnya
    // langsung selesai dan io() tidak dipanggil lagi.
    isConnected = false;
  } else if (event === 'connect_error') {
    // Mirror socket.io: kalau server menolak tanpa retry plan (auth 401),
    // socket jadi inactive. Tes auth-error set ini ke false sebelum
    // trigger; default perilaku adalah tetap aktif (network failure).
    // (Aktualnya socket.io reset sendiri; mock ini tidak.)
  }
}

// Test helper: set socket inactive (server menolak tanpa retry).
function setActive(value: boolean): void {
  isActive = value;
}

describe('ChatSocketManager', function() {
  var chatSocket: any;
  var getCurrentTokenMock: any;

  beforeEach(function() {
    // 1. Reset module cache, ini penting karena chatSocket adalah singleton
    //    (export const chatSocket = new ChatSocketManager()). Tanpa resetModules,
    //    require('./socket') berikutnya return module cached dan singleton state
    //    (hasEverConnected, connectPromise, dll.) ikut terbawa antar test.
    jest.resetModules();

    // 2. Reset mock state SEBELUM require, mockHandlers, isConnected, dan ioCallHistory
    //    adalah variable module-level, bukan export, jadi tidak ter-reset oleh resetModules.
    isConnected = false;
    isActive = true;
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

      // io() HARUS cuma dipanggil sekali, bukan 3x
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

      // Sekarang sudah connected, connect() lagi harus resolve langsung
      // tanpa bikin socket baru
      var promise2 = chatSocket.connect();
      await expect(promise2).resolves.toBeUndefined();

      // io() tetap cuma sekali, tidak ada socket baru
      expect(ioMock).toHaveBeenCalledTimes(1);
    });

    // Dulu handler reconnect_failed dipasang dan membuat promise reject.
    // Sekarang handler itu tidak ada, jadi event reconnect_failed tidak
    // mengubah apa pun dan pemanggil tetap menunggu 'connect' berikutnya.
    test('event reconnect_failed tidak bikin connect() reject', async function() {
      var promise = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('reconnect_failed');

      // Setelah reconnect_failed, sambungan tetap bisa sukses dan promise resolve.
      trigger('connect');
      await expect(promise).resolves.toBeUndefined();
    });

    test('REJECT kalau disconnect() dipanggil sebelum connect berhasil', async function() {
      var promise = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      chatSocket.disconnect();
      await expect(promise).rejects.toThrow('Disconnected before connection established');
    });

    // Sejak koneksi pertama socket.io mencoba ulang tanpa batas. Kalau
    // jaringan gagal, promise tidak reject dan pemanggil cukup menunggu
    // 'connect' berikutnya.
    test('connect() tidak reject setelah beberapa connect_error, lalu resolve saat connect', async function() {
      var promise = chatSocket.connect();
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

    test('REJECT kalau getCurrentToken return null/undefined (no token)', async function() {
      // Override default token behavior untuk test ini saja, getCurrentTokenMock
      // di-reassign dari require() di beforeEach, jadi bisa di-override per test.
      getCurrentTokenMock.mockResolvedValueOnce(null);

      await expect(chatSocket.connect()).rejects.toThrow('No auth token available');
      // io() TIDAK boleh dipanggil kalau token missing, socket tidak dibuat
      var ioMock = require('socket.io-client').io;
      expect(ioMock).not.toHaveBeenCalled();
    });

    test('disconnect() TIDAK throw walaupun dipanggil tanpa connect() sebelumnya', function() {
      // disconnect() harus idempotent / safe, boleh dipanggil kapan saja.
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
    // Konfigurasi reconnect socket.io:
    // - Selalu reconnectionAttempts = Infinity dan reconnectionDelayMax = 10000 sejak koneksi pertama
    // - hasEverConnected tidak lagi menentukan konfigurasi awal
    //
    // Latar belakang: socket.io v4.8.3 hanya memancarkan event 'reconnect_failed'
    // dari manager, bukan dari socket. Handler lama tidak pernah jalan dan
    // socket pertama mati setelah 3 kali gagal.

    test('koneksi pertama pakai reconnectionAttempts Infinity dan reconnectionDelayMax 10000', async function() {
      var promise = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();

      var ioMock = require('socket.io-client').io;
      expect(ioMock).toHaveBeenCalledTimes(1);

      var firstCallArgs = ioCallHistory[0];
      expect(firstCallArgs.options.reconnection).toBe(true);
      expect(firstCallArgs.options.reconnectionAttempts).toBe(Infinity);
      expect(firstCallArgs.options.reconnectionDelay).toBe(100);
      expect(firstCallArgs.options.reconnectionDelayMax).toBe(10000);

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

      // Second: connect again, should use different config
      var promise2 = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise2;

      // io() was called TWICE (once per connect() call)
      var ioMock = require('socket.io-client').io;
      expect(ioMock).toHaveBeenCalledTimes(2);

      // Panggilan io() kedua juga harus Infinity dengan delayMax 10000.
      // Dulu tes ini mengharapkan 30000 untuk sambung ulang, sekarang
      // koneksi pertama dan sambung ulang pakai konfigurasi yang sama.
      var secondCallArgs = ioCallHistory[1];
      expect(secondCallArgs.options.reconnectionAttempts).toBe(Infinity);
      expect(secondCallArgs.options.reconnectionDelay).toBe(100);
      expect(secondCallArgs.options.reconnectionDelayMax).toBe(10000);
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

    // Dulu socket.once('reconnect_failed', ...) dipasang saat koneksi
    // pertama. Sekarang tidak dipasang sama sekali. Tes ini memastikan
    // handler reconnect_failed tidak pernah didaftarkan.
    test('io() tidak pernah mendaftarkan handler reconnect_failed (selalu pakai Infinity)', async function() {
      mockSocket.once.mockClear();

      // Initial connect
      var promise1 = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise1;

      var reconnectFailedCallsInitial = mockSocket.once.mock.calls.filter(
        function(call: any[]) { return call[0] === 'reconnect_failed'; }
      );
      expect(reconnectFailedCallsInitial.length).toBe(0);

      // Disconnect and reconnect
      chatSocket.disconnect();
      var promise2 = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise2;

      var reconnectFailedCallsAfter = mockSocket.once.mock.calls.filter(
        function(call: any[]) { return call[0] === 'reconnect_failed'; }
      );
      expect(reconnectFailedCallsAfter.length).toBe(0);
    });
  });

  // Socket lama harus dilepas (off + disconnect) sebelum manajer membuat
  // socket baru, supaya event dari socket lama tidak sampai ke pendengar
  // baru dan tidak ada dua socket yang sama-sama mencoba nyambung.
  describe('ganti socket saat connect() dipanggil lagi', () => {
    test('setelah disconnect, off() dan disconnect() socket lama terpanggil sebelum io() yang kedua', async () => {
      var ioMock = require('socket.io-client').io;

      // Sambungan pertama: connect lalu resolve, mockSocket jadi socket manajer.
      var p1 = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await p1;
      expect(ioMock).toHaveBeenCalledTimes(1);

      // Sambungan putus sesaat.
      trigger('disconnect', 'transport close');

      // Sambungan kedua: connect() lagi. off() dan disconnect() socket lama
      // harus terpanggil sebelum io() yang kedua.
      var p2 = chatSocket.connect();
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

  // Socket yang ditolak server (token tidak berlaku, atau penolakan
  // lain tanpa retry plan) harus ditandai berhenti dan laporan
  // auth-expired dipancarkan lewat syncEvents. socket.io v4: kalau
  // server menolak dengan `connect_error` dan middleware tidak izinkan
  // retry, socket `active` jadi false. Mock ini set `active` lewat
  // setActive() sebelum trigger 'connect_error' untuk mensimulasikan
  // penolakan.
  describe('socket ditolak server', () => {
    // Mock syncEvents dipakai di sini; requireModule memberi kita mock
    // yang dipasang oleh jest.mock factory setelah resetModules.
    function authEmit(): jest.Mock {
      return jest.requireMock('./syncEvents').syncEvents.emit;
    }

    it('getCurrentToken suspend; connect() lalu disconnect() lalu token selesai: io tidak dipanggil (generasi men-stale-kan _doConnectAsync)', async () => {
      var resolveToken: ((token: string | null) => void) | null = null;
      getCurrentTokenMock.mockImplementationOnce(function() {
        return new Promise<string | null>(function(resolve) {
          resolveToken = resolve;
        });
      });

      var promise = chatSocket.connect();
      // _doConnectAsync suspended di await token, io() belum dipanggil.
      expect(ioCallHistory.length).toBe(0);

      chatSocket.disconnect();
      // Resolve token setelah disconnect, async work bail karena generasi
      // berubah, io() TIDAK dipanggil.
      resolveToken!('test-token');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(ioCallHistory.length).toBe(0);
      await expect(promise).rejects.toThrow('Disconnected before connection established');
    });

    it('connect_error dengan message "UNAUTHORIZED" saat active=false: promise reject, auth-expired dipancarkan, connect berikutnya memanggil io lagi', async () => {
      var ioMock = require('socket.io-client').io;
      var emit = authEmit();
      emit.mockClear();

      var promise = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();

      // Socket.io v4: setelah middleware menolak (token tidak berlaku),
      // socket.active false. Mock ini meniru dengan setActive(false).
      setActive(false);
      trigger('connect_error', { message: 'UNAUTHORIZED' });

      // Promise connect() reject dengan galat UNAUTHORIZED.
      await expect(promise).rejects.toThrow('UNAUTHORIZED');

      // auth-expired dipancarkan sekali dengan source chat-socket dan
      // token yang dipakai untuk socket itu.
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(
        'auth-expired',
        { source: 'chat-socket', token: 'test-token' },
      );

      // connect() berikutnya harus membuat socket baru (io dipanggil lagi).
      // setActive(true) lagi supaya mock tidak mengacaukan test lain.
      setActive(true);
      var promise2 = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();
      trigger('connect');
      await promise2;

      expect(ioMock).toHaveBeenCalledTimes(2);
    });

    it('connect_error gagal jaringan saat active=true: promise tetap menunggu, tanpa auth-expired', async () => {
      // active default true (di-reset tiap beforeEach). connect_error
      // jaringan tidak menyebabkan reject; socket.io mencoba ulang
      // otomatis.
      var emit = authEmit();
      emit.mockClear();

      var promise = chatSocket.connect();
      await Promise.resolve();
      await Promise.resolve();

      trigger('connect_error', { message: 'network error' });
      trigger('connect_error', { message: 'network error' });
      // Promise tetap pending sampai 'connect' berikutnya.
      trigger('connect');
      await expect(promise).resolves.toBeUndefined();

      expect(emit).not.toHaveBeenCalled();
    });
  });
});

// File ini script (no top-level imports/exports) secara default ke TS2393
// duplicate function implementation bakal fire waktu ada file script
// lain di project yang declare function dengan nama sama (e.g.
// ordersSocket.spec.ts juga punya `function trigger`). export {} di
// bawah ini bikin file -> module -> function -> module-scoped, gak
// collision lagi. Test body gak berubah.
export {};
