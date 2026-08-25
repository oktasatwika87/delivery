/**
 * Socket.IO client manager untuk orders real-time.
 *
 * - Singleton pattern — satu instance di seluruh app
 * - connect() / disconnect() eksplisit — tidak auto-connect saat import
 * - Event listener untuk 'orderAvailable', 'orderUnavailable', 'connect', 'disconnect', 'connect_error'
 *
 * Reconnection strategy (offline-first):
 * - Initial connect: fail-fast dengan retry terbatas (3x, delay 100ms-1s)
 * - Setelah pernah connect: reconnect unlimited dengan exponential backoff
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

import { getCurrentToken } from './session';
import { syncEvents } from './syncEvents';

/** Base URL dari .env (react-native-config) */
const WS_BASE = Config.API_BASE_URL;

/** Namespace untuk orders WebSocket */
const ORDERS_NAMESPACE = '/orders';

/** Payload for order available event */
export interface OrderAvailablePayload {
  orderId: string;
  totalCents: number;
  currency: string;
  itemsCount: number;
  city?: string;
  createdAt: string;
}

/** Payload for order unavailable event */
export interface OrderUnavailablePayload {
  orderId: string;
  reason: 'accepted' | 'rejected' | 'reassigned';
}

/** Event yang bisa di-listen */
export type OrdersSocketEvent = 'orderAvailable' | 'orderUnavailable' | 'connect' | 'disconnect' | 'connect_error';

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
   * Dipakai untuk bedakan initial connect vs reconnect.
   */
  private hasEverConnected = false;

  /**
   * Generation counter — incremented setiap connect() atau disconnect().
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
   * - Rejects if initial connection fails (after limited retries)
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
   * Async connection logic — called by connect() but runs after connect() returns.
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

      // Determine reconnection strategy based on connection history
      const isInitialConnect = !this.hasEverConnected;

      // Configure reconnection based on whether this is initial or reconnect
      // - Initial connect: limited retries (3x) with short delay (100ms-1s) — fail fast
      // - Reconnect: unlimited retries with exponential backoff (100ms-30s) — robust recovery
      const reconnectionConfig = isInitialConnect
        ? {
            reconnection: true,
            reconnectionAttempts: 3,
            reconnectionDelay: 100,
            reconnectionDelayMax: 1000,
          }
        : {
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 100,
            reconnectionDelayMax: 30000,
          };

      this.socket = io(`${WS_BASE}${ORDERS_NAMESPACE}`, {
        auth: { token },
        transports: ['websocket'],
        ...reconnectionConfig,
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
          console.warn('[OrdersSocket] auth-related connect_error — emitting auth-expired');
          syncEvents.emit('auth-expired', { source: 'orders-socket' });
        }
      });

      // Register reconnect_failed handler SELAMA initial connect only
      // (gak di-register di non-initial reconnect — kalau register setiap
      // io() call, ada risk double-fire karena handler accumulate).
      //
      // Branch terjadi di FIRE time berdasarkan hasEverConnected:
      // - hasEverConnected=false (initial connect gagal total) → reject promise
      // - hasEverConnected=true (network drop setelah initial success) →
      //   recreate socket dengan Infinity config, karena socket awal
      //   pake 3-attempt config (transisi fail-fast → unlimited backoff).
      //
      // Kenapa harus di-register di initial: reconnect_failed fire di socket
      // PERTAMA (yang dibuat saat initial connect). Kalau handler di-register
      // di else branch (non-initial), dia gak akan pernah ada di socket
      // pertama, jadi reconnect_failed fire tanpa handler.
      if (isInitialConnect) {
        this.socket.once('reconnect_failed', () => {
          if (!this.hasEverConnected) {
            console.error('[OrdersSocket] reconnect_failed: initial connection failed after retries');
            if (this.connectReject) {
              this.connectReject(new Error('Failed to connect after retries'));
            }
            this.connectPromise = null;
            this.connectResolve = null;
            this.connectReject = null;
          } else {
            console.warn(
              '[OrdersSocket] reconnect_failed after success: recreating socket with Infinity config',
            );
            this.socket?.disconnect();
            this.socket = null;
            void this.connect().catch((err: Error) => {
              console.warn(
                '[OrdersSocket] reconnect attempt after reconnect_failed failed:',
                err.message,
              );
            });
          }
        });
      }

      this.socket.on('order:available', (payload: OrderAvailablePayload) => {
        this.emit('orderAvailable', payload);
      });

      this.socket.on('order:unavailable', (payload: OrderUnavailablePayload) => {
        this.emit('orderUnavailable', payload);
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
      // Don't re-throw — _doConnectAsync() is called without await from connect(),
      // so throwing would become an unhandled rejection that crashes Node.
      // The promise is already rejected via connectReject, so caller await sees it.
      return;
    }
  }

  /**
   * Disconnect dari WebSocket server secara sengaja.
   * Panggil ini saat logout/unmount — akan mencegah auto-reconnect.
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
