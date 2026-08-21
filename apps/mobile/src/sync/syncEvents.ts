/**
 * Tiny event bus for surfacing conflict/rejected events from SyncCoordinator
 * to UI screens. Module-level singleton — same lifetime as coordinator.
 */
import { EventEmitter } from 'events';

export interface OrderConflictEvent {
  orderId: string;
  reason: 'reassigned' | 'order-status-conflict' | 'accepted-by-other' | 'rejected-oc';
  serverStatus: string;
  serverChangedAt: string;
  ackReason?: string; // dari server, kalau ada
}

export interface OrderRemovedFromViewEvent {
  orderId: string;
}

export interface OrderRejectedEvent {
  orderId: string;
  reason: string; // server-side nack reason, sudah dalam Bahasa Indonesia
}

export const syncEvents = new EventEmitter();
