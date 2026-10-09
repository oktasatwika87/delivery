import { Model } from '@nozbe/watermelondb';
import { field, text, date, readonly, json } from '@nozbe/watermelondb/decorators';

import type { OrderStatus } from '@delivery/shared';

export class OrderModel extends Model {
  static override table = 'orders';

  @text('customer_id') customerId!: string;
  @text('driver_id') driverId?: string;
  @text('status') status!: OrderStatus;
  @json('items_json', sanitizeItems) itemsJson!: unknown;
  @json('address_json', sanitizeAddress) addressJson!: unknown;
  @field('total_cents') totalCents!: number;
  @text('currency') currency!: string;
  @text('notes') notes?: string;
  @field('server_version') serverVersion!: number;
  @date('deleted_at') deletedAt?: Date;
  @field('failed_sync_attempts') failedSyncAttempts!: number;
  @text('cancelled_by') cancelledBy?: string;
  @text('cancel_reason') cancelReason?: string;

  // v8, Skenario A: persisted banner signal untuk cancel-offline conflict
  @text('last_conflict_reason') lastConflictReason?: string;
  @date('last_conflict_at') lastConflictAt?: Date;

  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;
}

function sanitizeItems(raw: unknown): unknown {
  // Items adalah JSON array, sanitize saat read/write dari WatermelonDB.
  return raw;
}

function sanitizeAddress(raw: unknown): unknown {
  return raw;
}
