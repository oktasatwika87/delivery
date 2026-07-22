/**
 * Sync envelopes — dipakai oleh offline-first layer.
 *
 * Mobile -> Backend:  SyncPushPayload   (apa yang berubah di client)
 * Backend -> Mobile:  SyncPullResponse  (apa yang berubah di server)
 *
 * Konvensi ID & timestamp:
 *   - id selalu UUIDv4 string
 *   - semua timestamp ISO 8601 UTC ('...Z')
 *   - deletedAt !== null  => soft-delete
 */

import type { Order } from './order.js';
import type { Payment } from './payment.js';
import type { ChatMessage } from './chat.js';

/** Tipe entity yang dikenal sync layer. */
export const SYNCABLE_ENTITY_TYPES = ['order', 'payment', 'chat_message'] as const;
export type SyncableEntityType = (typeof SYNCABLE_ENTITY_TYPES)[number];

/** Satu record perubahan di client. */
export interface SyncRecordPush {
  entityType: SyncableEntityType;
  /** String id dari entity. Backend resolve ke row & lakukan upsert. */
  id: string;
  /** Full snapshot dari state yang client lihat. */
  data: Order | Payment | ChatMessage;
  /** client-side op: create | update | delete */
  op: 'create' | 'update' | 'delete';
  /** Timestamp kapan client membuat perubahan ini. */
  clientChangedAt: string;
  /** Untuk OCC: version terakhir yang client lihat dari server. Null untuk create. */
  baseVersion: number | null;
}

/** Payload dikirim dari mobile ke backend. */
export interface SyncPushPayload {
  deviceId: string;
  userId: string;
  /** Incremental cursor — null untuk first sync. */
  sinceCursor: string | null;
  records: SyncRecordPush[];
}

/** Hasil satu record dari server (satu baris per record push). */
export interface SyncRecordAck {
  id: string;
  entityType: SyncableEntityType;
  /**
   * Accepted / rejected / merged / conflict.
   * - accepted: perubahan berhasil di-apply
   * - rejected: payload invalid atau business rule violation
   * - merged: server auto-merged (rare, untuk simple scalar conflicts)
   * - conflict: OCC mismatch — client harus pull dulu, retry setelah dapat version terbaru
   */
  status: 'accepted' | 'rejected' | 'merged' | 'conflict';
  /** Bila rejected/conflict, alasannya. */
  reason?: string;
  /** Server authoritative version setelah apply. */
  serverVersion: number;
  /** Server timestamp kapan record ini ter-update. */
  serverChangedAt: string;
  /** Data server terbaru — wajib ada kalau status = 'conflict'. */
  serverData?: Order | Payment | ChatMessage;
}

/** Satu record perubahan di server yang perlu di-pull. */
export interface SyncRecordPull {
  entityType: SyncableEntityType;
  id: string;
  data: Order | Payment | ChatMessage;
  serverChangedAt: string;
  serverVersion: number;
  /** true => row soft-deleted. */
  deleted: boolean;
}

/** Response dari backend ke mobile untuk satu kali pull. */
export interface SyncPullResponse {
  /** Cursor baru untuk pull berikutnya (null jika sudah up-to-date). */
  nextCursor: string | null;
  records: SyncRecordPull[];
  /** Server time saat ini — dipakai client untuk jam-jitter correction. */
  serverTime: string;
}

/** Response untuk push — mengembalikan ack per record + opsional pull delta. */
export interface SyncPushResponse {
  acks: SyncRecordAck[];
  /** Backend boleh sisipkan pull kecil (mis. update terbaru) untuk hemat round-trip. */
  pullDelta?: SyncPullResponse;
}