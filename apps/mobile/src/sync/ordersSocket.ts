/**
 * Socket.IO client manager untuk orders real-time.
 *
 * - Singleton pattern, satu instance di seluruh app
 * - connect() / disconnect() eksplisit, tidak auto-connect saat import
 * - Event listener untuk 'orderAvailable', 'orderUnavailable', 'connect', 'disconnect', 'connect_error'
 *
 * Reconnection strategy (offline-first):
 * - Selalu reconnectionAttempts = Infinity dengan jeda 100 ms sampai 10 s sejak koneksi pertama.
 * - socket.io mencoba ulang sendiri tanpa batas, pemanggil cukup menunggu
 *   'connect' berikutnya.
 * - connect() hanya reject kalau token tidak ada, atau disconnect() dipanggil
 *   sebelum tersambung. Gagal jaringan tidak membuat connect() reject.
 *
 * KNOWN LIMITATION: token difetch sekali saat initial connect() dan
 * dipass ke socket.io. Auto-reconnect oleh socket.io client TIDAK
 * fetch token baru, jadi kalau JWT expired selama socket idle lama,
 * reconnect akan gagal auth. Butuh token refresh mechanism terpisah
 * (belum didesain).
 *
 * Pakenya:
 *   import { ordersSocket } from './ordersSocket';
 *
 *   // Connect saat app foreground / user login
 *   await ordersSocket.connect();
 *
 *   // Listen untuk order available
 *   ordersSocket.onOrderAvailable((payload) => { ... });
 *
 *   // Disconnect saat app background / logout
 *   ordersSocket.disconnect();
 */

import { io, Socket } from 'socket.io-client';
import Config from 'react-native-config';
import type {
  OrderAvailablePayload,
  OrderUnavailablePayload,
  OrderAcceptedPayload,
  OrderRejectedPayload,
  OrderCancelledPayload,
  OrderCodCollectedPayload,
  OrderStatusUpdatedPayload,
} from '@delivery/shared';

import { getCurrentToken } from './session';
import { syncEvents } from './syncEvents';

/** Base URL dari .env (react-native-config) */
const WS_BASE = Config.API_BASE_URL;

/** Namespace untuk orders WebSocket */
const ORDERS_NAMESPACE = '/orders';

/**
 * Payload types di-import dari @delivery/shared (packages/shared/src/order-events.ts)
 * dan di-re-export di sini supaya konsumen existing (import dari './ordersSocket')
 * nggak perlu berubah. Sebelumnya 5 interface ini didefinisikan lokal DAN
 * terpisah di orders.gateway.ts (backend), duplikasi itu yang bikin literal
 * status pool-state bisa drift tanpa ketahuan compiler, lihat riwayat
 * lengkap di order-events.ts.
 */
export type {
  OrderAvailablePayload,
  OrderUnavailablePayload,
  OrderAcceptedPayload,
  OrderRejectedPayload,
  OrderCancelledPayload,
  OrderCodCollectedPayload,
  OrderStatusUpdatedPayload,
};

/** Event yang bisa di-listen */
export type OrdersSocketEvent =
  | 'orderAvailable'
  | 'orderUnavailable'
  | 'orderAccepted'
  | 'orderRejected'
  | 'orderCancelled'
  | 'orderCodCollected'
  | 'orderStatusUpdated'
  | 'connect'
  | 'disconnect'
  | 'connect_error';

/** Callback type untuk event listener */
type EventCallback<T = unknown> = (data: T) => void;

class OrdersSocketManager {
  private socket: Socket | null = null;
  private listeners = new Map<OrdersSocketEvent, Set<EventCallback>>();
  private connectPromise: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;

  /**
   * Track apakah socket pernah berhasil connect sebelumnya.
   * Hanya dipakai untuk log, tidak lagi menentukan konfigurasi reconnect
   * (lihat komentar di awal file).
   */
  private hasEverConnected = false;

  /**
   * Generation counter, incremented setiap connect() atau disconnect().
   * Async _doConnectAsync(gen) track gen-nya, dan BAIL kalo sudah stale
   * (mis. user disconnect() di tengah-tengah async token fetch).
   * Tanpa ini, _doConnectAsync yang suspended bisa resume dan overwrite
   * this.socket yang udah di-null-in oleh disconnect().
   */
  private generation = 0;

  /**
   * Connect ke WebSocket server.
   * Auth token diambil dari session (getCurrentToken()).
   *
   * Returns:
   * - Resolves when connected successfully (initial or reconnect)
   * - Reject hanya kalau token tidak ada, atau disconnect() dipanggil sebelum tersambung.
   * - Gagal jaringan tidak membuat reject. socket.io mencoba ulang sendiri tanpa
   *   batas, pemanggil cukup menunggu 'connect' berikutnya.
   *
   * Idempotent: calling connect() while already connecting/connected resolves immediately.
   *
   * Implementation note: connect() is NOT async to ensure promise identity.
   * Multiple synchronous calls to connect() return the SAME promise reference,
   * which is required for idempotency tests (expect(p1).toBe(p2)).
   * Async work is delegated to _doConnectAsync().
   */
  connect(): Promise<void> {
    // If already connecting, wait for that promise
    if (this.connectPromise) {
      return this.connectPromise;
    }

    // If already connected, resolve immediately
    if (this.socket?.connected) {
      return Promise.resolve();
    }

    // Create promise SYNCHRONOUSLY before any async work.
    // This ensures idempotency: concurrent calls get the same promise reference.
    this.connectPromise = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });

    // Increment generation dan capture untuk stale-check di async path.
    // Generation check protects dari race: kalo user disconnect() di
    // tengah-tengah async _doConnectAsync, async work akan bail instead
    // of overwriting this.socket.
    this.generation++;
    const myGen = this.generation;

    // Start async connection work (non-blocking).
    // This is called without await, so connect() returns immediately
    // with the same promise that will be resolved/rejected asynchronously.
    this._doConnectAsync(myGen);

    return this.connectPromise;
  }

  /**
   * Async connection logic, called by connect() but runs after connect() returns.
   * Separating this from connect() ensures promise identity:
   * - connect() returns synchronously with the promise
   * - Multiple connect() calls see the same in-progress promise
   * - The first connect() call "owns" the async work
   *
   * `gen` is captured from connect() at start. Checked setelah await
   * supaya stale operations (gak relevan lagi karena udah di-disconnect
   * atau di-supersede) bail tanpa overwrite this.socket / mutate state.
   */
  private async _doConnectAsync(gen: number): Promise<void> {
    try {
      const token = await getCurrentToken();

      // Stale check: kalo disconnect() dipanggil selagi await getCurrentToken,
      // atau ada connect() baru yang supersede ini, bail.
      if (gen !== this.generation) return;

      if (!token) {
        throw new Error('No auth token available');
      }

      // Lepas socket lama kalau ada: lepas semua penangkap supaya event
      // dari socket lama tidak sampai ke pendengar manajer, lalu disconnect
      // supaya socket lama berhenti mencoba sendiri.
      if (this.socket) {
        this.socket.off();
        this.socket.disconnect();
      }

      // Selalu pakai konfigurasi reconnect tanpa batas sejak koneksi pertama.
      // socket.io mencoba ulang sendiri dan percobaannya tidak pernah habis,
      // jadi pemanggil cukup menunggu 'connect' berikutnya.
      this.socket = io(`${WS_BASE}${ORDERS_NAMESPACE}`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 100,
        reconnectionDelayMax: 10000,
      });

      // Register event handlers BEFORE any events can fire
      this.socket.on('connect', () => {
        console.info('[OrdersSocket] connected:', this.socket?.id, 'hasEverConnected:', this.hasEverConnected);
        this.hasEverConnected = true;
        this.emit('connect');
        if (this.connectResolve) {
          this.connectResolve();
        }
        // Clear promise references
        this.connectPromise = null;
        this.connectResolve = null;
        this.connectReject = null;
      });

      this.socket.on('disconnect', (reason) => {
        console.warn('[OrdersSocket] disconnected:', reason);
        this.emit('disconnect', reason);
      });

      this.socket.on('connect_error', (err) => {
        console.error('[OrdersSocket] connect_error:', err.message);
        this.emit('connect_error', err.message);

        // Detect token-related auth failure
        if (err.message && /jwt|unauthorized|token expired|invalid token/i.test(err.message)) {
          console.warn('[OrdersSocket] auth-related connect_error, emitting auth-expired');
          syncEvents.emit('auth-expired', { source: 'orders-socket' });
        }
      });

      this.socket.on('order:available', (payload: OrderAvailablePayload) => {
        this.emit('orderAvailable', payload);
      });

      this.socket.on('order:unavailable', (payload: OrderUnavailablePayload) => {
        this.emit('orderUnavailable', payload);
      });

      // Customer-targeted events, delivered ke customer via
      // room = customerId. OrderTrackingScreen subscribe ke ini untuk
      // live-update status tanpa refresh manual.
      this.socket.on('order:accepted', (payload: OrderAcceptedPayload) => {
        this.emit('orderAccepted', payload);
      });

      this.socket.on('order:rejected', (payload: OrderRejectedPayload) => {
        this.emit('orderRejected', payload);
      });

      this.socket.on('order:cancelled', (payload: OrderCancelledPayload) => {
        this.emit('orderCancelled', payload);
      });

      // Live payment confirmation only, order status doesn't change, so
      // there's no version field to reconcile here (see order-events.ts).
      this.socket.on('order:cod_collected', (payload: OrderCodCollectedPayload) => {
        this.emit('orderCodCollected', payload);
      });

      // order:status_updated, customer-targeted live status update from
      // PATCH /orders/:id/status (PREPARING jadi OUT_FOR_DELIVERY, OUT_FOR_DELIVERY jadi DELIVERED).
      this.socket.on('order:status_updated', (payload: OrderStatusUpdatedPayload) => {
        this.emit('orderStatusUpdated', payload);
      });
    } catch (err) {
      // Stale check: jangan reject promise yang udah bukan punya kita.
      if (gen !== this.generation) return;

      const error = err instanceof Error ? err : new Error(String(err));
      console.warn('[OrdersSocket] connect failed:', error.message);
      // Reject pending promise (kalau caller masih menunggu) lalu clear state
      this.connectReject?.(error);
      this.connectPromise = null;
      this.connectResolve = null;
      this.connectReject = null;
      // Don't re-throw, _doConnectAsync() is called without await from connect(),
      // so throwing would become an unhandled rejection that crashes Node.
      // The promise is already rejected via connectReject, so caller await sees it.
      return;
    }
  }

  /**
   * Disconnect dari WebSocket server secara sengaja.
   * Panggil ini saat logout/unmount, akan mencegah auto-reconnect.
   *
   * Increment generation untuk invalidate any in-flight _doConnectAsync.
   * Tanpa ini, suspended async work bisa resume dan overwrite this.socket
   * yang udah di-null-in (race condition).
   */
  disconnect(): void {
    this.generation++;

    if (this.socket) {
      // 'io client disconnect' reason signals intentional disconnect
      this.socket.disconnect();
      this.socket = null;
    }
    // Clear any pending connect promise and reject if still pending
    if (this.connectPromise) {
      if (this.connectReject) {
        this.connectReject(new Error('Disconnected before connection established'));
      }
      this.connectPromise = null;
      this.connectResolve = null;
      this.connectReject = null;
    }
  }

  /**
   * Subscribe ke event.
   */
  on<T = unknown>(event: OrdersSocketEvent, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback);

    return () => {
      this.listeners.get(event)?.delete(callback as EventCallback);
    };
  }

  /**
   * Subscribe ke order available event dengan typed payload.
   */
  onOrderAvailable(callback: (payload: OrderAvailablePayload) => void): () => void {
    return this.on<OrderAvailablePayload>('orderAvailable', callback);
  }

  /**
   * Subscribe ke order unavailable event dengan typed payload.
   */
  onOrderUnavailable(callback: (payload: OrderUnavailablePayload) => void): () => void {
    return this.on<OrderUnavailablePayload>('orderUnavailable', callback);
  }

  /**
   * Subscribe ke order:accepted event (customer-side).
   * Fire ketika driver accept order customer, tracking screen update
   * status ke PREPARING + set driverId.
   */
  onOrderAccepted(callback: (payload: OrderAcceptedPayload) => void): () => void {
    return this.on<OrderAcceptedPayload>('orderAccepted', callback);
  }

  /**
   * Subscribe ke order:rejected event (customer-side).
   * Fire ketika driver reject, order balik ke pool (ASSIGNED + driverId null,
   * BUKAN CANCELLED/terminal, dan BUKAN CONFIRMED lagi, lihat order-events.ts
   * untuk riwayat lengkap kenapa).
   */
  onOrderRejected(callback: (payload: OrderRejectedPayload) => void): () => void {
    return this.on<OrderRejectedPayload>('orderRejected', callback);
  }

  /**
   * Subscribe ke order:cancelled event (customer-side).
   * Fire ketika driver cancel mid-delivery, order balik ke pool (ASSIGNED
   * + driverId null) untuk di-reassign ke driver lain.
   */
  onOrderCancelled(callback: (payload: OrderCancelledPayload) => void): () => void {
    return this.on<OrderCancelledPayload>('orderCancelled', callback);
  }

  /**
   * Subscribe ke order:cod_collected event (customer-side).
   * Fire ketika driver collect COD, order status TIDAK berubah, ini murni
   * live confirmation pembayaran (mis. tampilkan toast/receipt di tracking
   * screen), bukan sinyal untuk update status order.
   */
  onOrderCodCollected(callback: (payload: OrderCodCollectedPayload) => void): () => void {
    return this.on<OrderCodCollectedPayload>('orderCodCollected', callback);
  }

  /**
   * Subscribe ke order:status_updated event (customer-side).
   * Fire ketika driver update status order, PREPARING jadi OUT_FOR_DELIVERY
   * atau OUT_FOR_DELIVERY jadi DELIVERED.
   */
  onOrderStatusUpdated(callback: (payload: OrderStatusUpdatedPayload) => void): () => void {
    return this.on<OrderStatusUpdatedPayload>('orderStatusUpdated', callback);
  }

  /**
   * Emit event ke listener internal (dipakai oleh connect() untuk forward events).
   */
  private emit(event: OrdersSocketEvent, data?: unknown): void {
    const callbacks = this.listeners.get(event);
    if (!callbacks) return;
    callbacks.forEach((cb) => cb(data));
  }

  /** Apakah socket sedang connected */
  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  /** Apakah socket pernah connect sebelumnya */
  get wasEverConnected(): boolean {
    return this.hasEverConnected;
  }
}

export const ordersSocket = new OrdersSocketManager();
