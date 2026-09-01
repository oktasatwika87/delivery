/**
 * Idempotency key generation for COD sync (offline-first).
 *
 * Format: cod:${uuid} — UUID v4 (RFC 4122).
 *
 * The UUID is the single source of uniqueness for the payment. Generated
 * ONCE when the driver taps "Terima Cash COD" and stored permanently on
 * the local PaymentModel row. Stability across retries is guaranteed by
 * the fact that the key lives on the row — `collectDirty()` reads it
 * from `row.idempotencyKey` rather than regenerating.
 *
 * UI-level guards prevent double-tapping from generating duplicate keys:
 *   - Inflight mutex in `handleCollectCod()` (tier 2 EC6)
 *   - `hasCodPayment` check before showing COD button (tier 2 Task 3)
 *
 * Why not the previous `cod:${orderId}:${deviceId}:${Date.now()}`:
 *   The `Date.now()` component made the key non-deterministic if the
 *   local row was ever re-created (app reinstall, DB corruption, debug
 *   insertion). Re-creation produced a new key → server's unique
 *   constraint couldn't dedupe → duplicate payment record. UUID v4
 *   eliminates this foot-gun by making the key a single global UUID
 *   with 2^122 collision space.
 */

import reactNativeUUID from 'react-native-uuid';

/**
 * RFC 4122 v4 UUID regex. Matches a 36-character hyphenated UUID with
 * version 4 indicator ('4' in third group) and variant indicator
 * ('8' | '9' | 'a' | 'b' in fourth group).
 */
const COD_UUID_REGEX =
  /^cod:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generate a fresh idempotency key for a COD collection. The `_orderId`
 * parameter is intentionally ignored — the UUID itself is unique enough
 * to distinguish between COD collections regardless of which order,
 * device, or timestamp. Keeping the parameter in the signature preserves
 * the existing call site at `OrderDetailScreen.tsx:219`.
 */
export async function generateCodIdempotencyKey(_orderId: string): Promise<string> {
  return `cod:${reactNativeUUID.v4()}`;
}

/**
 * Validate that a string is a well-formed COD idempotency key.
 * Used by tests and (optionally) defensive checks in coordinator.
 */
export function isValidCodIdempotencyKey(key: string): boolean {
  return COD_UUID_REGEX.test(key);
}
