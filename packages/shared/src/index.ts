/**
 * Shared domain & sync contract types.
 *
 * Diimpor oleh:
 *   - apps/mobile (consumer / generator WatermelonDB adapter)
 *   - apps/backend  (NestJS DTOs & Prisma model shapes)
 *
 * Konvensi:
 *   - Field ber-prefix `local_` = hanya di sisi client (WatermelonDB),
 *     field ber-prefix `server_` = authoritative state dari backend.
 *   - Semua entity domain punya `id` (UUIDv4 string), `createdAt`, `updatedAt`.
 *   - Enum distri dengan union string literal + const object (TS-friendly & runtime-safe).
 */

export * from './order.js';
export * from './payment.js';
export * from './chat.js';
export * from './sync.js';
export * from './user.js';

import type { Order } from './order.js';
import type { Payment } from './payment.js';
import type { ChatMessage } from './chat.js';
import type { User } from './user.js';

/** Branded ID helpers — bantu TypeScript membedakan ID type saat dipakai. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace DeliveryTypes {
    type Branded<TBase, TBrand extends string> = TBase & { readonly __brand: TBrand };

    type OrderId = Branded<string, 'OrderId'>;
    type PaymentId = Branded<string, 'PaymentId'>;
    type UserId = Branded<string, 'UserId'>;
    type ChatRoomId = Branded<string, 'ChatRoomId'>;
  }
}

/** Snapshot seluruh entity yang dilacak di sync layer. */
export type DomainEntity = Order | Payment | ChatMessage | User;

/** Versi schema shared — bump saat ada field/union yang breaking. */
export const SHARED_SCHEMA_VERSION = 1 as const;
