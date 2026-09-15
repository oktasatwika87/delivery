/**
 * Pending Actions Outbox — offline-first driver action queue.
 *
 * Architecture:
 * - When driver taps reject/cancel/COD collect while offline:
 *   1. Optimistically update local order state
 *   2. Insert row into pending_actions table
 *   3. Return immediately (don't wait for network)
 *
 * - When device comes online:
 *   1. Process pending_actions FIFO (oldest first)
 *   2. Submit to existing backend endpoints
 *   3. Handle response: success/conflict/orphaned
 *
 * Response handling:
 * - Success (2xx): delete pending_action row, clear pending flag on order
 * - Conflict (version mismatch): pull fresh order data, delete pending_action,
 *   emit conflict notification to UI
 * - Orphaned COD (special): mark status = 'orphaned_needs_review', don't delete,
 *   don't auto-retry (requires manual business decision per HSIN)
 */

import { Q } from '@nozbe/watermelondb';
import type { Database } from '@nozbe/watermelondb';

import { database } from '../db';
import { PendingActionModel, type CancelPayload, type CollectCodPayload } from '../db/models/PendingActionModel';
import { OrderModel } from '../db/models/OrderModel';
import { syncEvents } from './syncEvents';
import { getCurrentUserId } from './session';
import { rejectOrder, cancelOrder, collectCodOrder, flagOrphanedCod } from './client';
import { generateCodIdempotencyKey } from './idempotency';
import { syncCoordinator } from './coordinator';

export interface EnqueueResult {
  success: boolean;
  pendingActionId?: string;
  error?: string;
}

/**
 * Result of processing a single pending action.
 */
export interface ProcessResult {
  pendingActionId: string;
  status: 'success' | 'conflict' | 'orphaned' | 'failed';
  error?: string;
}

/**
 * Enqueue a reject action for an order.
 * Call this when driver taps "Tolak" while offline.
 *
 * @param orderId - The order being rejected
 * @param expectedVersion - Current serverVersion of the order
 */
export async function enqueueReject(orderId: string, expectedVersion: number): Promise<EnqueueResult> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Generate UUID dulu — prepareCreateFromDirtyRaw butuh ID yang sudah jadi.
    const pendingActionId = generateUUID();

    await database.write(async () => {
      const preparedRecord = database.get<PendingActionModel>('pending_actions').prepareCreateFromDirtyRaw({
        id: pendingActionId,
        _status: 'synced',
        _changed: '',
        actionType: 'reject',
        targetOrderId: orderId,
        expectedVersion,
        idempotencyKey: `reject:${orderId}:${userId}`,
        payloadJson: null,
        status: 'pending',
      });
      await database.batch(preparedRecord);

      // Mark order with pending action flag
      const order = await database.get<OrderModel>('orders').find(orderId);
      await order.update((o) => {
        (o as any)._raw._status = 'synced'; // not dirty, just flagging
      });
    });

    console.log(`[outbox] enqueued reject action for order ${orderId}, pendingActionId=${pendingActionId}`);
    return { success: true, pendingActionId };
  } catch (err) {
    console.error('[outbox] failed to enqueue reject:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Enqueue a cancel action for an order.
 * Call this when driver taps "Batal" while offline.
 *
 * @param orderId - The order being cancelled
 * @param expectedVersion - Current serverVersion of the order
 * @param reason - Optional cancellation reason
 */
export async function enqueueCancel(
  orderId: string,
  expectedVersion: number,
  reason?: string
): Promise<EnqueueResult> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return { success: false, error: 'Not authenticated' };
    }

    const payload: CancelPayload = reason ? { reason } : {};
    const pendingActionId = generateUUID();

    await database.write(async () => {
      const preparedRecord = database.get<PendingActionModel>('pending_actions').prepareCreateFromDirtyRaw({
        id: pendingActionId,
        _status: 'synced',
        _changed: '',
        actionType: 'cancel',
        targetOrderId: orderId,
        expectedVersion,
        idempotencyKey: `cancel:${orderId}:${userId}:${Date.now()}`,
        payloadJson: payload,
        status: 'pending',
      });
      await database.batch(preparedRecord);
    });

    console.log(`[outbox] enqueued cancel action for order ${orderId}, reason=${reason}, pendingActionId=${pendingActionId}`);
    return { success: true, pendingActionId };
  } catch (err) {
    console.error('[outbox] failed to enqueue cancel:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Enqueue a COD collection action for an order.
 * Call this when driver taps "Terima Cash COD" while offline.
 * The idempotency key is GENERATED HERE (not later during sync) to ensure
 * stability across retries.
 *
 * @param orderId - The order for which COD is collected
 * @param amountCents - Amount collected in cents
 */
export async function enqueueCollectCod(
  orderId: string,
  amountCents: number
): Promise<EnqueueResult> {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return { success: false, error: 'Not authenticated' };
    }

    // Generate idempotency key NOW — must be stable across retries
    const idempotencyKey = await generateCodIdempotencyKey(orderId);
    const payload: CollectCodPayload = { amountCents };
    const pendingActionId = generateUUID();

    await database.write(async () => {
      const preparedRecord = database.get<PendingActionModel>('pending_actions').prepareCreateFromDirtyRaw({
        id: pendingActionId,
        _status: 'synced',
        _changed: '',
        actionType: 'collect_cod',
        targetOrderId: orderId,
        expectedVersion: 0, // COD doesn't require version check
        idempotencyKey,
        payloadJson: payload,
        status: 'pending',
      });
      await database.batch(preparedRecord);
    });

    console.log(`[outbox] enqueued collect_cod action for order ${orderId}, amount=${amountCents}, idempotencyKey=${idempotencyKey}`);
    return { success: true, pendingActionId };
  } catch (err) {
    console.error('[outbox] failed to enqueue collect_cod:', err);
    return { success: false, error: String(err) };
  }
}

/**
 * Check if an order has any pending actions in the outbox.
 * Used by UI to show a badge/indicator.
 */
export async function hasPendingAction(orderId: string): Promise<boolean> {
  const pending = await database
    .get<PendingActionModel>('pending_actions')
    .query(
      Q.where('target_order_id', orderId),
      Q.where('status', Q.oneOf(['pending', 'syncing']))
    )
    .fetch();
  return pending.length > 0;
}

/**
 * Get all pending actions for an order.
 */
export async function getPendingActionsForOrder(orderId: string): Promise<PendingActionModel[]> {
  return database
    .get<PendingActionModel>('pending_actions')
    .query(Q.where('target_order_id', orderId))
    .fetch();
}

/**
 * Threshold in milliseconds after which a pending action is considered "stale".
 * 60 minutes.
 */
export const STALE_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Get the age of a pending action in milliseconds.
 * Returns 0 if action is null or has no createdAt.
 * Handles both Date objects and numeric timestamps.
 */
export function getPendingActionAgeMs(action: PendingActionModel | null): number {
  if (!action?.createdAt) return 0;
  const createdAt = action.createdAt;
  // Support both Date objects and numeric timestamps
  const timestamp = typeof createdAt.getTime === 'function' ? createdAt.getTime() : Number(createdAt);
  return Date.now() - timestamp;
}

/**
 * Check if a pending action is stale (older than STALE_THRESHOLD_MS).
 * Stale actions indicate the driver has been offline for a while — UI
 * should show a more prominent warning.
 */
export function isPendingActionStale(action: PendingActionModel | null): boolean {
  return getPendingActionAgeMs(action) > STALE_THRESHOLD_MS;
}

/**
 * Check if an order has any STALE pending actions.
 * Used by UI to show warning styling for orders with old pending actions.
 */
export async function hasStalePendingAction(orderId: string): Promise<boolean> {
  const pending = await database
    .get<PendingActionModel>('pending_actions')
    .query(
      Q.where('target_order_id', orderId),
      Q.where('status', Q.oneOf(['pending', 'syncing']))
    )
    .fetch();

  return pending.some(isPendingActionStale);
}

/**
 * Drain all pending actions — process them FIFO.
 * Called when device comes online.
 *
 * @param db - Database instance (defaults to global database)
 * @returns Array of process results
 */
export async function drainPendingActions(db: Database = database): Promise<ProcessResult[]> {
  console.log('[outbox] Starting drain of pending actions...');

  // Get all pending actions, ordered by created_at (FIFO)
  const pendingActions = await db
    .get<PendingActionModel>('pending_actions')
    .query(
      Q.where('status', 'pending'),
      Q.sortBy('created_at', Q.asc)
    )
    .fetch();

  console.log(`[outbox] Found ${pendingActions.length} pending actions to process`);

  const results: ProcessResult[] = [];

  for (const action of pendingActions) {
    const result = await processPendingAction(action, db);
    results.push(result);
  }

  console.log(`[outbox] Drain complete: ${results.length} actions processed`);
  return results;
}

/**
 * Process a single pending action.
 */
async function processPendingAction(
  action: PendingActionModel,
  db: Database
): Promise<ProcessResult> {
  console.log(`[outbox] Processing action ${action.id}: ${action.actionType} for order ${action.targetOrderId}`);

  // Mark as syncing
  await db.write(async () => {
    await action.update((row) => {
      row.status = 'syncing';
    });
  });

  try {
    switch (action.actionType) {
      case 'reject':
        return await processReject(action, db);
      case 'cancel':
        return await processCancel(action, db);
      case 'collect_cod':
        return await processCollectCod(action, db);
      default:
        console.warn(`[outbox] Unknown action type: ${(action as any).actionType}`);
        await resetActionForRetry(action, db, 'Unknown action type');
        return {
          pendingActionId: action.id,
          status: 'failed',
          error: 'Unknown action type',
        };
    }
  } catch (err) {
    console.error(`[outbox] Error processing action ${action.id}:`, err);
    await resetActionForRetry(action, db, String(err));
    return {
      pendingActionId: action.id,
      status: 'failed',
      error: String(err),
    };
  }
}

/**
 * Process a reject action.
 */
async function processReject(action: PendingActionModel, db: Database): Promise<ProcessResult> {
  try {
    const response = await rejectOrder(action.targetOrderId, action.expectedVersion);
    console.log(`[outbox] Reject succeeded for order ${action.targetOrderId}:`, response);

    // Success: delete the pending action
    await deletePendingAction(action, db);

    // Emit conflict event to refresh UI
    syncEvents.emit('orderConflict', {
      orderId: action.targetOrderId,
      reason: 'rejected-oc',
      serverStatus: response.status,
      serverChangedAt: new Date().toISOString(),
    });

    return { pendingActionId: action.id, status: 'success' };
  } catch (err: any) {
    const errorMsg = String(err);
    if (isVersionConflict(err)) {
      console.warn(`[outbox] Version conflict for reject on order ${action.targetOrderId}`);
      await handleVersionConflict(action, db, 'Order sudah berubah di server');
      return { pendingActionId: action.id, status: 'conflict', error: 'Version conflict' };
    }
    console.error(`[outbox] Reject failed for order ${action.targetOrderId}:`, errorMsg);
    await resetActionForRetry(action, db, errorMsg);
    return { pendingActionId: action.id, status: 'failed', error: errorMsg };
  }
}

/**
 * Process a cancel action.
 */
async function processCancel(action: PendingActionModel, db: Database): Promise<ProcessResult> {
  try {
    const payload = action.payloadJson as CancelPayload | null;
    const response = await cancelOrder(action.targetOrderId, action.expectedVersion, payload?.reason);
    console.log(`[outbox] Cancel succeeded for order ${action.targetOrderId}:`, response);

    // Success: delete the pending action
    await deletePendingAction(action, db);

    // Emit conflict event to refresh UI
    syncEvents.emit('orderConflict', {
      orderId: action.targetOrderId,
      reason: 'order-status-conflict',
      serverStatus: response.status,
      serverChangedAt: new Date().toISOString(),
    });

    return { pendingActionId: action.id, status: 'success' };
  } catch (err: any) {
    const errorMsg = String(err);
    if (isVersionConflict(err)) {
      console.warn(`[outbox] Version conflict for cancel on order ${action.targetOrderId}`);
      await handleVersionConflict(action, db, 'Order sudah berubah di server');
      return { pendingActionId: action.id, status: 'conflict', error: 'Version conflict' };
    }
    console.error(`[outbox] Cancel failed for order ${action.targetOrderId}:`, errorMsg);
    await resetActionForRetry(action, db, errorMsg);
    return { pendingActionId: action.id, status: 'failed', error: errorMsg };
  }
}

/**
 * Process a COD collection action.
 * Special handling for orphaned COD (order was reassigned/cancelled before sync).
 */
async function processCollectCod(action: PendingActionModel, db: Database): Promise<ProcessResult> {
  const payload = action.payloadJson as CollectCodPayload | null;
  if (!payload) {
    await resetActionForRetry(action, db, 'Missing payload');
    return { pendingActionId: action.id, status: 'failed', error: 'Missing payload' };
  }

  try {
    const response = await collectCodOrder(
      action.targetOrderId,
      payload.amountCents,
      action.idempotencyKey
    );
    console.log(`[outbox] COD collection succeeded for order ${action.targetOrderId}:`, response);

    // Success: delete the pending action
    await deletePendingAction(action, db);

    return { pendingActionId: action.id, status: 'success' };
  } catch (err: any) {
    const errorMsg = String(err);

    // Check if this is an orphaned COD situation
    // Orphaned = order was reassigned/cancelled while driver collected COD offline
    if (isOrphanedCod(err)) {
      console.warn(`[outbox] Orphaned COD detected for order ${action.targetOrderId}`);
      await markActionOrphaned(action, db);

      // Fire-and-forget: notify server so HSIN gets email
      // If this also fails, local orphan status is the fallback
      if (payload) {
        flagOrphanedCod(action.targetOrderId, payload.amountCents, action.idempotencyKey)
          .catch((e) => console.warn('[outbox] flagOrphanedCod non-fatal error:', e.message));
      }

      return { pendingActionId: action.id, status: 'orphaned', error: 'Order reassigned/cancelled' };
    }

    // Check for version conflict (treat same as orphaned for COD)
    if (isVersionConflict(err)) {
      console.warn(`[outbox] Version conflict for COD on order ${action.targetOrderId} — treating as orphaned`);
      await markActionOrphaned(action, db);

      // Fire-and-forget: notify server so HSIN gets email
      if (payload) {
        flagOrphanedCod(action.targetOrderId, payload.amountCents, action.idempotencyKey)
          .catch((e) => console.warn('[outbox] flagOrphanedCod non-fatal error:', e.message));
      }

      return { pendingActionId: action.id, status: 'orphaned', error: 'Version conflict (order changed)' };
    }

    console.error(`[outbox] COD collection failed for order ${action.targetOrderId}:`, errorMsg);
    await resetActionForRetry(action, db, errorMsg);
    return { pendingActionId: action.id, status: 'failed', error: errorMsg };
  }
}

/**
 * Check if an error indicates a version conflict (409 or message contains conflict keywords).
 */
function isVersionConflict(err: any): boolean {
  if (!err) return false;
  const msg = String(err).toLowerCase();
  return (
    err.status === 409 ||
    err.statusCode === 409 ||
    msg.includes('version') && (msg.includes('conflict') || msg.includes('mismatch') || msg.includes('stale'))
  );
}

/**
 * Check if an error indicates orphaned COD (order reassigned to another driver or cancelled).
 */
function isOrphanedCod(err: any): boolean {
  if (!err) return false;
  const msg = String(err).toLowerCase();
  return (
    msg.includes('not found') ||
    msg.includes('already assigned') ||
    msg.includes('reassign') ||
    msg.includes('cancelled') ||
    msg.includes('not your order') ||
    msg.includes('not the assigned driver')
  );
}

/**
 * Handle version conflict: pull fresh order data, delete pending action, notify UI.
 *
 * Untuk pending action bertipe 'cancel', tulis juga persisted banner signal
 * (lastConflictReason + lastConflictAt) ke order row lokal — banner
 * LastConflictBanner baca field ini untuk surface cancel-offline conflict
 * ke driver (Skenario A, Temuan 1).
 *
 * Aksi 'reject' / 'collect_cod' TIDAK menulis field ini. Reason
 * 'cancelled-by-server' spesifik untuk skenario cancel-offline (driver tap
 * Batal offline, server sudah reassign/close/cancel sebelum mobile sempat
 * sync) — bukan untuk cancel online biasa.
 */
async function handleVersionConflict(action: PendingActionModel, db: Database, reason: string): Promise<void> {
  console.log(`[outbox] Handling version conflict for action ${action.id}`);

  // Untuk pending action bertipe cancel: lookup order row lebih dulu
  // (read-only, di luar transaction) supaya bisa di-batch dengan delete
  // pending_action di bawah. Kalau order tidak ada di lokal (sangat
  // jarang — server data di-pull duluan sebelum sync berikutnya), log
  // warning dan lanjut tanpa tulis banner signal.
  let cancelOrder: OrderModel | null = null;
  if (action.actionType === 'cancel') {
    try {
      cancelOrder = await db.get<OrderModel>('orders').find(action.targetOrderId);
    } catch (err) {
      console.warn(
        `[outbox] Order ${action.targetOrderId} not found locally for cancel conflict write:`,
        err,
      );
    }
  }

  // Single batch: delete pending_action + (kalau cancel) tulis banner signal.
  // Tidak buka transaksi terpisah untuk lastConflictReason/lastConflictAt —
  // gabung dengan delete pending_action (sesuai spec Temuan 1).
  await db.write(async () => {
    const ops: any[] = [action.prepareDestroyPermanently()];
    if (cancelOrder) {
      ops.push(cancelOrder.prepareUpdate((o: any) => {
        o.lastConflictReason = 'cancelled-by-server';
        o.lastConflictAt = Date.now();
      }));
    }
    await db.batch(...ops);
  });

  // Pull fresh order data via sync coordinator (transaksi sendiri — tidak
  // bisa digabung dengan batch di atas karena syncCoordinator.pullNow()
  // mengelola batch internal applyPull-nya sendiri).
  try {
    await syncCoordinator.pullNow();
  } catch (err) {
    console.warn('[outbox] Failed to pull after conflict:', err);
  }

  // Emit conflict event
  syncEvents.emit('orderConflict', {
    orderId: action.targetOrderId,
    reason: 'order-status-conflict',
    serverStatus: 'unknown',
    serverChangedAt: new Date().toISOString(),
    ackReason: reason,
  });
}

/**
 * Mark a pending action as orphaned (COD collected but order changed).
 * Unlike regular failure, orphaned actions are kept for manual review.
 */
async function markActionOrphaned(action: PendingActionModel, db: Database): Promise<void> {
  console.log(`[outbox] Marking action ${action.id} as orphaned_needs_review`);

  await db.write(async () => {
    await action.update((row) => {
      row.status = 'orphaned_needs_review';
    });
  });

  // Emit notification for UI
  syncEvents.emit('pendingActionOrphaned', {
    pendingActionId: action.id,
    orderId: action.targetOrderId,
    actionType: action.actionType,
    message: 'COD yang sudah dikumpulkan tapi order sudah berubah. Hubungi HSIN untuk resolusi.',
  });
}

/**
 * Reset a failed action back to 'pending' so it will be retried
 * on the next drain trigger (reconnect or after enqueue).
 *
 * Outbox actions (reject/cancel/collectCod) represent physical driver actions
 * that must eventually sync — we NEVER give up on them automatically.
 * Unlike regular field sync which respects MAX_SYNC_ATTEMPTS, outbox actions
 * keep retrying indefinitely until they succeed or the device goes away.
 */
async function resetActionForRetry(action: PendingActionModel, db: Database, error: string): Promise<void> {
  console.warn(`[outbox] Action ${action.id} failed: ${error}. Will retry on next drain.`);

  await db.write(async () => {
    await action.update((row) => {
      row.status = 'pending';
    });
  });
}

/**
 * Delete a pending action from the database.
 */
async function deletePendingAction(action: PendingActionModel, db: Database): Promise<void> {
  await db.write(async () => {
    await action.destroyPermanently();
  });
}

/**
 * Simple UUID generation (without external library).
 * For pending_action IDs which are local-only (not synced to server).
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
