/**
 * Domain: ChatMessage
 *
 * Chat per-room (order-scoped atau driver<->customer scoped).
 * Disimpan offline di WatermelonDB, sync incremental ke backend.
 */

export const ChatMessageStatus = {
  /** Baru dibuat di client, belum terkirim. */
  PENDING_SEND: 'PENDING_SEND',
  /** Sudah dikirim, menunggu ack server. */
  SENT: 'SENT',
  /** Server confirm. */
  DELIVERED: 'DELIVERED',
  /** Receiver sudah baca. */
  READ: 'READ',
  /** Gagal kirim — akan di-retry oleh sync layer. */
  FAILED: 'FAILED',
} as const;

export type ChatMessageStatus =
  (typeof ChatMessageStatus)[keyof typeof ChatMessageStatus];

export interface ChatMessage {
  id: string;
  roomId: string; // bisa OrderId atau conversation id
  senderId: string;

  body: string;
  /** Optional attachment (image url, location, etc). */
  attachment?: ChatAttachment;

  status: ChatMessageStatus;

  /** Client-generated timestamp (server akan override saat ack). */
  clientCreatedAt: string;
  /** Server authoritative timestamp. Null sampai ack. */
  serverCreatedAt?: string;

  createdAt: string;
  updatedAt: string;
  version: number;
}

export type ChatAttachment =
  | { kind: 'image'; url: string; width?: number; height?: number }
  | { kind: 'location'; lng: number; lat: number; label?: string }
  | { kind: 'file'; url: string; mimeType: string; sizeBytes: number };

export interface SendChatMessageInput {
  /** Optional client-generated UUID. Server uses this if provided (consistent ID across devices). */
  id?: string;
  roomId: string;
  body: string;
  attachment?: ChatAttachment;
  /** Timestamp buatan client. Server memakainya kalau nilainya valid dan tidak di masa depan. */
  clientCreatedAt?: string;
}