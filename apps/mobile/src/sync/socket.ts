/**
 * Socket.IO client manager untuk chat real-time.
 *
 * - Singleton pattern — satu instance di seluruh app
 * - connect() / disconnect() eksplisit — tidak auto-connect saat import
 * - Event listener untuk 'new_message', 'connect', 'disconnect', 'connect_error'
 *
 * Pakenya:
 *   import { chatSocket } from './socket';
 *
 *   // Connect saat app foreground / user login
 *   await chatSocket.connect();
 *
 *   // Listen untuk new message
 *   chatSocket.on('new_message', (message) => { ... });
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

  /**
   * Connect ke WebSocket server.
   * Auth token diambil dari session (getCurrentToken()).
   *
   * Throws jika socket sudah connected.
   */
  async connect(): Promise<void> {
    if (this.socket?.connected) {
      console.warn('[ChatSocket] already connected');
      return;
    }

    const token = await getCurrentToken();

    this.socket = io(`${WS_BASE}${CHAT_NAMESPACE}`, {
      auth: { token: token ?? undefined },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    // Forward socket.io events ke listener registry
    this.socket.on('connect', () => {
      this.emit('connect');
    });

    this.socket.on('disconnect', (reason) => {
      this.emit('disconnect', reason);
    });

    this.socket.on('connect_error', (err) => {
      this.emit('connect_error', err.message);
    });

    this.socket.on('new_message', (message: ChatMessage) => {
      this.emit('new_message', message);
    });

    // Connect asynchronously — socket.io akan emit 'connect' event
    // saat handshake selesai
    return new Promise((resolve) => {
      if (!this.socket) return resolve();
      if (this.socket.connected) {
        resolve();
        return;
      }
      this.socket.once('connect', () => resolve());
    });
  }

  /**
   * Disconnect dari WebSocket server.
   */
  disconnect(): void {
    if (!this.socket) return;
    this.socket.disconnect();
    this.socket = null;
  }

  /**
   * Subscribe ke event.
   *
   * @example
   *   const unsub = chatSocket.on('new_message', (msg) => { ... });
   *   // Cleanup saat component unmount:
   *   unsub();
   */
  on<T = unknown>(event: ChatSocketEvent, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback);

    // Return unsubscribe function
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
   * Emit event ke server (join_room, send_message, leave_room).
   *
   * Socket.IO acknowledgment pattern: callback dipanggil saat server membalas.
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
}

export const chatSocket = new ChatSocketManager();
