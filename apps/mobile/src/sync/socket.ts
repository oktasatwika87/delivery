/**
 * Socket.IO client manager untuk chat real-time.
 *
 * - Singleton pattern, satu instance di seluruh app
 * - connect() / disconnect() eksplisit, tidak auto-connect saat import
 * - Event listener untuk 'new_message', 'connect', 'disconnect', 'connect_error'
 *
 * Reconnection strategy (offline-first):
 * - Selalu reconnectionAttempts = Infinity dengan jeda 100 ms sampai 10 s sejak koneksi pertama.
 * - socket.io mencoba ulang sendiri tanpa batas, pemanggil cukup menunggu
 *   'connect' berikutnya.
 * - connect() hanya reject kalau token tidak ada, atau disconnect() dipanggil
 *   sebelum tersambung. Gagal jaringan tidak membuat connect() reject.
 *
 * Token dibaca saat connect(): setiap kali manajer perlu membuat socket,
 * getCurrentToken() dipanggil. Login yang menukar token TIDAK langsung
 * memicu nyambungan ulang di socket yang sedang idle, tapi login flow
 * memutus (disconnect()) lalu menyambung lagi (connect()) lewat App.tsx,
 * jadi socket baru selalu membawa token yang sekarang berlaku.
 *
 * Token yang ditolak server dilaporkan lewat 'auth-expired' dengan token
 * yang dipakai, lalu socket itu dihentikan (socket.active jadi false),
 * supaya App.tsx bisa membedakan 401 dari token lama (abaikan) dan 401
 * dari token sekarang (akhiri sesi).
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
import { syncEvents, type AuthExpiredEvent } from './syncEvents';

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
   * Generation counter, dinaikkan di connect() atau disconnect().
   * Async _doConnectAsync(gen) track gen-nya, dan BAIL kalo sudah stale
   * (mis. disconnect() di tengah-tengah await token, atau connect()
   * baru men-supersede yang lama). Tanpa ini, _doConnectAsync yang
   * suspended bisa resume dan overwrite this.socket yang sudah di-null
   * oleh disconnect(), atau emit auth-expired dari socket yang bukan
   * milik sesi ini.
   */
  private generation = 0;

  /**
   * Connect ke WebSocket server.
   * Auth token diambil dari session (getCurrentToken()).
   *
   * Returns:
   * - Resolves when connected successfully (initial or reconnect)
   * - Reject hanya kalau token tidak ada, disconnect() dipanggil sebelum
   *   tersambung, atau server menolak (mis. token tidak berlaku).
   * - Gagal jaringan tidak membuat reject. socket.io mencoba ulang sendiri
   *   tanpa batas, pemanggil cukup menunggu 'connect' berikutnya.
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

    // Increment generasi dan capture untuk _doConnectAsync. Generation
    // protects dari race: disconnect() di tengah-tengah async token fetch,
    // atau connect() baru men-supersede, di-bail oleh stale check.
    this.generation++;
    const myGen = this.generation;

    // Start async connection work (non-blocking).
    this._doConnectAsync(myGen);

    return this.connectPromise;
  }

  /**
   * Async connection logic, called by connect() but runs after connect() returns.
   * `gen` adalah generation yang diambil di connect(); dicek setelah await
   * supaya operasi stale (sudah di-disconnect atau superseded) bail
   * tanpa overwrite this.socket atau emit event dari socket lama.
   */
  private async _doConnectAsync(gen: number): Promise<void> {
    try {
      const token = await getCurrentToken();

      // Stale check: disconnect() dipanggil selagi await getCurrentToken,
      // atau connect() baru men-supersede, bail.
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
      const socket = io(`${WS_BASE}${CHAT_NAMESPACE}`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 100,
        reconnectionDelayMax: 10000,
      });

      // Assign ke instance TEPAT setelah socket dibuat, supaya penangkap
      // di bawah memakai referensi lokal `socket` dan `token`, bukan
      // this.socket (yang bisa di-null-kan disconnect() concurrent).
      this.socket = socket;

      // Register event handlers BEFORE any events can fire. Penangkap
      // memakai `socket` dan `token` lokal untuk konsistensi.
      socket.on('connect', () => {
        console.info('[ChatSocket] connected:', socket.id, 'hasEverConnected:', this.hasEverConnected);
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

      socket.on('disconnect', (reason) => {
        console.warn('[ChatSocket] disconnected:', reason);
        this.emit('disconnect', reason);

        // Clear any pending connect promise on unexpected disconnect
        // (intentional disconnect via .disconnect() won't trigger this because we null socket first)
        if (this.connectReject && reason !== 'io client disconnect') {
          // Don't reject - let reconnection handle it
        }
      });

      socket.on('connect_error', (err) => {
        console.error('[ChatSocket] connect_error:', err.message);
        this.emit('connect_error', err.message);

        // Server menolak dengan `connect_error` dan `socket.active` jadi
        // false (socket.io tidak akan mencoba ulang). Tolak janji
        // connect() yang masih menunggu supaya pemanggil tidak menggantung,
        // dan kosongkan field janji supaya connect() berikutnya bisa
        // membuat socket baru.
        if (socket.active === false) {
          const message = (err as { message?: string })?.message ?? 'connect_error';
          const rejectedError = err instanceof Error ? err : new Error(message);
          if (this.connectReject) {
            this.connectReject(rejectedError);
          }
          this.connectPromise = null;
          this.connectResolve = null;
          this.connectReject = null;
          if (err.message === 'UNAUTHORIZED') {
            console.warn('[ChatSocket] auth-related connect_error, emitting auth-expired');
            const event: AuthExpiredEvent = { source: 'chat-socket', token };
            syncEvents.emit<AuthExpiredEvent>('auth-expired', event);
          }
        }
        // socket.active true: socket.io sedang mencoba ulang sendiri,
        // jangan reject; pemanggil akan mendapat 'connect' berikutnya
        // atau 'connect_error' lain yang juga active=false.
      });

      socket.on('new_message', (message: ChatMessage) => {
        this.emit('new_message', message);
      });

      // Socket.io v3 auto-connects when io() is called
      // If reconnection is enabled, it will automatically attempt reconnection
      // The 'connect' or 'connect_error' event above will fire
    } catch (err) {
      // Stale check: jangan reject promise yang bukan punya kita.
      if (gen !== this.generation) return;

      const error = err instanceof Error ? err : new Error(String(err));
      console.warn('[ChatSocket] connect failed:', error.message);
      // Reject pending promise (kalau caller masih menunggu) lalu clear state
      if (this.connectReject) {
        this.connectReject(error);
      }
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
      console.warn('[ChatSocket] not connected, cannot emit', event);
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