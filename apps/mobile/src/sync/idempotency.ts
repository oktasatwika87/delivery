/**
 * Idempotency key generation for offline-first sync.
 *
 * Format: cod:${orderId}:${deviceId}:${timestamp}
 *
 * - cod: prefix to distinguish from other entity types
 * - orderId: identifies which order this payment is for
 * - deviceId: ensures uniqueness across devices
 * - timestamp: ensures uniqueness across time on same device
 *
 * Combined with server-side idempotency check (unique constraint on idempotency_key),
 * this guarantees:
 * - Same driver can retry on network failure without double-charging
 * - Different devices can't collide even if they somehow share orderId
 */

import { getDeviceId } from './device';

/**
 * Generate idempotency key for COD collection.
 * Must be called after user authentication (needs deviceId from AsyncStorage).
 */
export async function generateCodIdempotencyKey(orderId: string): Promise<string> {
  const deviceId = await getDeviceId();
  const timestamp = Date.now();
  return `cod:${orderId}:${deviceId}:${timestamp}`;
}
