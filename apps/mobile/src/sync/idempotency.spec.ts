/**
 * Unit tests untuk idempotency key generation.
 */

import {
  generateCodIdempotencyKey,
  isValidCodIdempotencyKey,
} from './idempotency';

describe('idempotency', () => {
  describe('generateCodIdempotencyKey()', () => {
    test('returns key with cod: prefix', async () => {
      const key = await generateCodIdempotencyKey('order-123');
      expect(key.startsWith('cod:')).toBe(true);
    });

    test('key matches UUID v4 format', async () => {
      const key = await generateCodIdempotencyKey('order-123');
      expect(isValidCodIdempotencyKey(key)).toBe(true);
    });

    test('different calls produce different keys', async () => {
      const key1 = await generateCodIdempotencyKey('order-123');
      const key2 = await generateCodIdempotencyKey('order-123');
      expect(key1).not.toBe(key2);
    });

    test('orderId parameter is ignored (key does not contain orderId)', async () => {
      const key = await generateCodIdempotencyKey('order-123');
      expect(key).not.toContain('order-123');
    });

    test('deviceId is not in the key', async () => {
      const key = await generateCodIdempotencyKey('order-123');
      expect(key).not.toContain('deviceId');
    });

    test('timestamp is not in the key', async () => {
      const key = await generateCodIdempotencyKey('order-123');
      // Old format had Date.now() at the end, no longer
      const parts = key.split(':');
      expect(parts.length).toBe(2); // ['cod', 'uuid']
      // UUID part should not be all digits (which would indicate a timestamp)
      const uuidPart = parts[1];
      expect(uuidPart).not.toMatch(/^\d+$/);
    });
  });

  describe('isValidCodIdempotencyKey()', () => {
    test('accepts valid UUID v4 format', () => {
      expect(isValidCodIdempotencyKey('cod:550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    test('accepts valid key with uppercase UUID', () => {
      expect(isValidCodIdempotencyKey('cod:550E8400-E29B-41D4-A716-446655440000')).toBe(true);
    });

    test('accepts valid key with mixed case UUID', () => {
      expect(isValidCodIdempotencyKey('cod:550e8400-E29b-41D4-a716-446655440000')).toBe(true);
    });

    test('rejects old format with timestamp', () => {
      expect(isValidCodIdempotencyKey('cod:order-123:device-abc:1234567890')).toBe(false);
    });

    test('rejects key without cod: prefix', () => {
      expect(isValidCodIdempotencyKey('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });

    test('rejects key with wrong prefix', () => {
      expect(isValidCodIdempotencyKey('pay:550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });

    test('rejects malformed UUID (too short)', () => {
      expect(isValidCodIdempotencyKey('cod:550e8400-e29b-41d4-a716')).toBe(false);
    });

    test('rejects malformed UUID (invalid version digit)', () => {
      // UUID v4 must have '4' as first digit of third group
      expect(isValidCodIdempotencyKey('cod:550e8400-e29b-51d4-a716-446655440000')).toBe(false);
    });

    test('rejects empty string', () => {
      expect(isValidCodIdempotencyKey('')).toBe(false);
    });

    test('rejects null-ish values (via type, but test string behavior)', () => {
      expect(isValidCodIdempotencyKey('null')).toBe(false);
      expect(isValidCodIdempotencyKey('undefined')).toBe(false);
    });
  });

  describe('10k uniqueness', () => {
    test('10,000 generated keys are all unique', async () => {
      const keys = await Promise.all(
        Array.from({ length: 10000 }, () => generateCodIdempotencyKey('order-123')),
      );
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(10000);
    }, 30000); // 30s timeout for 10k iterations
  });
});
