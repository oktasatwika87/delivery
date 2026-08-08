import { Model } from '@nozbe/watermelondb';
import { field, text, date, readonly } from '@nozbe/watermelondb/decorators';

import type { PaymentMethod, PaymentStatus } from '@delivery/shared';

export class PaymentModel extends Model {
  static override table = 'payments';

  @text('order_id') orderId!: string;
  @text('idempotency_key') idempotencyKey!: string;
  @text('method') method!: PaymentMethod;
  @text('status') status!: PaymentStatus;
  @field('amount_cents') amountCents!: number;
  @text('currency') currency!: string;
  @text('kind') kind!: 'PAYMENT' | 'TIP' | 'REFUND';
  @text('external_ref') externalRef?: string;
  @field('server_version') serverVersion!: number;
  @date('deleted_at') deletedAt?: Date;
  @field('failed_sync_attempts') failedSyncAttempts!: number;

  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;
}
