/**
 * Tiny event bus for surfacing conflict/rejected events from SyncCoordinator
 * to UI screens. Module-level singleton, same lifetime as coordinator.
 *
 * Originally used Node.js EventEmitter from 'events' module, but that module
 * is not available in React Native runtime (Metro can't resolve 'events').
 * Replaced with SimpleEventBus, same pattern as ChatSocketManager/OrdersSocketManager.
 */
export interface OrderConflictEvent {
  orderId: string;
  reason: 'reassigned' | 'order-status-conflict' | 'rejected-oc' | 'cancelled-by-server';
  serverStatus: string;
  serverChangedAt: string;
  ackReason?: string; // dari server, kalau ada
}

export interface OrderRejectedEvent {
  orderId: string;
  reason: string; // server-side nack reason, sudah dalam Bahasa Indonesia
}

/**
 * Dipancarkan saat server menolak token (HTTP 401 atau socket ditolak).
 * `source` menunjukkan jalur yang mengirim, `token` adalah token yang ditolak
 * server. Penerima bisa mengabaikan event untuk token yang sudah bukan
 * token tersimpan (mis. login ulang sambil ada permintaan lama yang
 * sedang dalam perjalanan).
 */
export interface AuthExpiredEvent {
  source: 'http' | 'orders-socket' | 'chat-socket';
  token: string;
}

/** Event names supported by syncEvents */
export type SyncEventName =
  | 'orderConflict'
  | 'orderRejected'
  | 'pool-refresh'
  | 'auth-expired';

/** Callback type, matches pattern from socket managers */
type EventCallback<T = unknown> = (data: T) => void;

/**
 * SimpleEventBus: React Native compatible event bus.
 *
 * API matches Node EventEmitter for syncEvents consumers:
 * - on(event, callback), subscribe, returns unsubscribe function
 * - off(event, callback), unsubscribe (must pass SAME function reference)
 * - emit(event, data), broadcast to all subscribers
 *
 * Type-safe: consumers pass typed callbacks and TypeScript infers the type
 * based on the event name.
 */
class SimpleEventBus {
  private listeners = new Map<string, Set<EventCallback>>();

  /**
   * Subscribe to an event.
   * Returns unsubscribe function, call it to remove the listener.
   */
  on<T = unknown>(event: string, callback: EventCallback<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback as EventCallback);

    return () => {
      this.listeners.get(event)?.delete(callback as EventCallback);
    };
  }

  /**
   * Unsubscribe from an event.
   * Note: must pass the SAME function reference that was passed to on().
   */
  off<T = unknown>(event: string, callback: EventCallback<T>): void {
    this.listeners.get(event)?.delete(callback as EventCallback);
  }

  /**
   * Emit an event to all subscribers.
   */
  emit<T = unknown>(event: string, data: T): void {
    const callbacks = this.listeners.get(event);
    if (!callbacks) return;
    callbacks.forEach((cb) => cb(data));
  }
}

export const syncEvents = new SimpleEventBus();
