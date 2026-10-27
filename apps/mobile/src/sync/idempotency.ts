/**
 * Kunci idempotensi COD, format `cod:<uuid v4>`.
 *
 * Kunci dibuat sekali saat driver mengetuk tombol COD dan disimpan di aksi
 * `collect_cod` di outbox. Kiriman ulang dan Coba lagi memakai kunci yang
 * sama, jadi server hanya mencatat satu COD walau request terkirim lebih
 * dari sekali.
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
 * parameter is intentionally ignored, the UUID itself is unique enough
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
