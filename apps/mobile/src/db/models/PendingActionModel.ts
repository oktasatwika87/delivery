import { Model } from '@nozbe/watermelondb';
import { field, text, date, readonly, json } from '@nozbe/watermelondb/decorators';

/**
 * Action types for pending actions outbox.
 * - reject: driver rejects an assigned order
 * - cancel: driver cancels order mid-delivery
 * - collect_cod: driver collects COD payment
 */
export type ActionType = 'reject' | 'cancel' | 'collect_cod';

/**
 * Status of a pending action in the outbox.
 * - pending: waiting to be processed
 * - syncing: currently being sent to server
 * - failed: permanent failure (version conflict, etc.)
 * - orphaned_needs_review: COD collected but order was reassigned/cancelled
 *   before the collection was synced (requires manual resolution)
 */
export type PendingActionStatus = 'pending' | 'syncing' | 'failed' | 'orphaned_needs_review';

/**
 * Payload for cancel action, includes reason.
 */
export interface CancelPayload {
  reason?: string;
}

/**
 * Payload for collect_cod action, includes amountCents.
 */
export interface CollectCodPayload {
  amountCents: number;
}

export class PendingActionModel extends Model {
  static override table = 'pending_actions';

  @text('action_type') actionType!: ActionType;
  @text('target_order_id') targetOrderId!: string;
  @field('expected_version') expectedVersion!: number;
  @text('idempotency_key') idempotencyKey!: string;
  @json('payload_json', sanitizePayload) payloadJson!: CancelPayload | CollectCodPayload | null;
  @text('status') status!: PendingActionStatus;

  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;
}

function sanitizePayload(raw: unknown): CancelPayload | CollectCodPayload | null {
  return raw as CancelPayload | CollectCodPayload | null;
}
