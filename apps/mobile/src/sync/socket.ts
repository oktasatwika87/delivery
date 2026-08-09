/**
 * Socket.IO client manager untuk chat real-time.
 *
 * - Singleton pattern — satu instance di seluruh app
 * - connect() / disconnect() eksplisit — tidak auto-connect saat import
 * - Event listener untuk 'new_message', 'connect', 'disconnect', 'connect_error'
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
 *   import { chatSocket } from './socket';
 *
 *   // Connect saat app foreground / user login
 *   await chatSocket.connect();
 *
 *   // Listen untuk new message
 *   chatSocket.on('new_message', (msg) => { ... });
 *
 *   // Disconnect saat app background / logout
 *   chatSocket.disconnect();
 */

import { io, Socket } from 'socket.io-client';
import Config from 'react-native-config';
import type { ChatMessage } from '@delivery/shared';

import { getCurrentToken } from './session';

/** Base URL dari .env (react-native-config) */
const WS_BASE = Config.API_BASE_URL;

/** Namespace untuk chat WebSocket */
const CHAT_NAMESPACE = '/chat';

/** Event yang bisa di-listen */
export type ChatSocketEvent = 'new_message' | 'connect' | 'disconnect' | 'connect_error';

/** Callback type untuk event listener */
type EventCallback<T = unknown> = (data: T) => void;

class ChatSocketManager {
  private socket: Socket | null = null;
  private listeners = new Map<ChatSocketEvent, Set<EventCallback>>();
  private connectPromise: Promise<void> | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((err: Error) => void) | null = null;

  /**
   * Track apakah socket pernah berhasil connect sebelumnya.
   * Dipakai untuk bedakan initial connect vs reconnect.
   */
  private hasEverConnected = false;

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

    // Start async connection work (non-blocking).
    // This is called without await, so connect() returns immediately
    // with the same promise that will be resolved/rejected asynchronously.
    this._doConnectAsync();

    return this.connectPromise;
  }

  /**
   * Async connection logic — called by connect() but runs after connect() returns.
   * Separating this from connect() ensures promise identity:
   * - connect() returns synchronously with the promise
   * - Multiple connect() calls see the same in-progress promise
   * - The first connect() call "owns" the async work
   */
  private async _doConnectAsync(): Promise<void> {
    try {
      const token = await getCurrentToken();

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

      this.socket = io(`${WS_BASE}${CHAT_NAMESPACE}`, {
        auth: { token },
        transports: ['websocket'],
        ...reconnectionConfig,
      });

      // Register event handlers BEFORE any events can fire
      this.socket.on('connect', () => {
        console.info('[ChatSocket] connected:', this.socket?.id, 'hasEverConnected:', this.hasEverConnected);
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
        console.warn('[ChatSocket] disconnected:', reason);
        this.emit('disconnect', reason);

        // Clear any pending connect promise on unexpected disconnect
        // (intentional disconnect via .disconnect() won't trigger this because we null socket first)
        if (this.connectReject && reason !== 'io client disconnect') {
          // Don't reject - let reconnection handle it
        }
      });

      this.socket.on('connect_error', (err) => {
        console.error('[ChatSocket] connect_error:', err.message);
        this.emit('connect_error', err.message);
      });

      // Handle initial connect failure (only for initial connect, not for reconnect after first success)
      // After reconnectionAttempts exhausted for initial connect, socket.io emits 'reconnect_failed'
      if (isInitialConnect) {
        this.socket.once('reconnect_failed', () => {
          console.error('[ChatSocket] reconnect_failed: initial connection failed after retries');
          if (this.connectReject) {
            this.connectReject(new Error('Failed to connect after retries'));
          }
          this.connectPromise = null;
          this.connectResolve = null;
          this.connectReject = null;
        });
      }

      this.socket.on('new_message', (message: ChatMessage) => {
        this.emit('new_message', message);
      });

      // Socket.io v3 auto-connects when io() is called
      // If reconnection is enabled, it will automatically attempt reconnection
      // The 'connect' or 'connect_error' event above will fire
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.warn('[ChatSocket] connect failed:', error.message);
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
   */
  disconnect(): void {
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
  on<T = unknown>(event: ChatSocketEvent, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback);

    return () => {
      this.listeners.get(event)?.delete(callback as EventCallback);
    };
  }

  /**
   * Emit event ke listener internal (dipakai oleh connect() untuk forward events).
   */
  private emit(event: ChatSocketEvent, data?: unknown): void {
    const callbacks = this.listeners.get(event);
    if (!callbacks) return;
    callbacks.forEach((cb) => cb(data));
  }

  /**
   * Emit event ke server.
   */
  emitToServer<T = unknown, R = unknown>(
    event: string,
    payload: T,
    acknowledgment?: (response: R) => void,
  ): void {
    if (!this.socket?.connected) {
      console.warn('[ChatSocket] not connected — cannot emit', event);
      return;
    }
    this.socket.emit(event, payload, acknowledgment);
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

export const chatSocket = new ChatSocketManager();
