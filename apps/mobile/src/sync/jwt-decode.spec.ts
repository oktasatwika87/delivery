/**
 * Unit tests for JWT decode utility.
 *
 * Tests cover:
 * 1. Valid token with CUSTOMER role
 * 2. Valid token with DRIVER role
 * 3. Token without role (legacy token)
 * 4. Token with invalid role
 * 5. Malformed token
 */

import { decodeToken, getRoleFromToken, isValidRole, InvalidTokenError } from './jwt-decode';
import { UserRole } from '@delivery/shared';

/**
 * Manual base64 encode for Node.js test environment.
 * React Native provides atob() natively; Node.js does not.
 * Handles UTF-8 strings and proper padding.
 */
function base64Encode(str: string): string {
  // Convert string to UTF-8 bytes
  const utf8Bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i);
    if (charCode < 0x80) {
      utf8Bytes.push(charCode);
    } else if (charCode < 0x800) {
      utf8Bytes.push(0xc0 | (charCode >> 6), 0x80 | (charCode & 0x3f));
    } else if (charCode < 0x10000) {
      utf8Bytes.push(0xe0 | (charCode >> 12), 0x80 | ((charCode >> 6) & 0x3f), 0x80 | (charCode & 0x3f));
    }
  }

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';

  for (let i = 0; i < utf8Bytes.length; i += 3) {
    const a = utf8Bytes[i];
    const b = i + 1 < utf8Bytes.length ? utf8Bytes[i + 1] : 0;
    const c = i + 2 < utf8Bytes.length ? utf8Bytes[i + 2] : 0;

    result += chars[a >> 2];
    result += chars[((a & 0x03) << 4) | (b >> 4)];
    result += i + 1 < utf8Bytes.length ? chars[((b & 0x0f) << 2) | (c >> 6)] : '=';
    result += i + 2 < utf8Bytes.length ? chars[c & 0x3f] : '=';
  }

  return result;
}

/**
 * Helper to create a mock JWT with the given payload.
 * JWT format: base64(header).base64(payload).signature
 * We don't need real signing since we only decode (not verify).
 */
function createMockJwt(payload: Record<string, unknown>): string {
  const header = base64Encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Encode(JSON.stringify(payload));
  const signature = base64Encode('mock-signature');
  return `${header}.${body}.${signature}`;
}

describe('decodeToken', () => {
  test('decodes valid token with CUSTOMER role', () => {
    const token = createMockJwt({ sub: 'user-123', role: UserRole.CUSTOMER });
    const payload = decodeToken(token);

    expect(payload.sub).toBe('user-123');
    expect(payload.role).toBe(UserRole.CUSTOMER);
  });

  test('decodes valid token with DRIVER role', () => {
    const token = createMockJwt({ sub: 'driver-456', role: UserRole.DRIVER });
    const payload = decodeToken(token);

    expect(payload.sub).toBe('driver-456');
    expect(payload.role).toBe(UserRole.DRIVER);
  });

  test('throws InvalidTokenError for token without sub', () => {
    const token = createMockJwt({ role: UserRole.CUSTOMER });

    expect(() => decodeToken(token)).toThrow(InvalidTokenError);
    expect(() => decodeToken(token)).toThrow('Token missing sub claim');
  });

  test('throws InvalidTokenError for malformed token', () => {
    const malformedToken = 'not-a-valid-jwt';

    expect(() => decodeToken(malformedToken)).toThrow(InvalidTokenError);
    expect(() => decodeToken(malformedToken)).toThrow('Failed to decode token');
  });

  test('throws InvalidTokenError for token with invalid base64', () => {
    const invalidBase64Token = '!!!.###.$$$';

    expect(() => decodeToken(invalidBase64Token)).toThrow(InvalidTokenError);
  });
});

describe('isValidRole', () => {
  test('returns true for CUSTOMER', () => {
    expect(isValidRole(UserRole.CUSTOMER)).toBe(true);
  });

  test('returns true for DRIVER', () => {
    expect(isValidRole(UserRole.DRIVER)).toBe(true);
  });

  test('returns false for undefined', () => {
    expect(isValidRole(undefined)).toBe(false);
  });

  test('returns false for null', () => {
    expect(isValidRole(null)).toBe(false);
  });

  test('returns false for unknown string', () => {
    expect(isValidRole('ADMIN')).toBe(false);
    expect(isValidRole('unknown')).toBe(false);
    expect(isValidRole('')).toBe(false);
  });

  test('returns false for non-string values', () => {
    expect(isValidRole(123)).toBe(false);
    expect(isValidRole({ role: 'CUSTOMER' })).toBe(false);
  });
});

describe('getRoleFromToken', () => {
  test('returns CUSTOMER for valid token with CUSTOMER role', () => {
    const token = createMockJwt({ sub: 'user-123', role: UserRole.CUSTOMER });
    const role = getRoleFromToken(token);

    expect(role).toBe(UserRole.CUSTOMER);
  });

  test('returns DRIVER for valid token with DRIVER role', () => {
    const token = createMockJwt({ sub: 'driver-456', role: UserRole.DRIVER });
    const role = getRoleFromToken(token);

    expect(role).toBe(UserRole.DRIVER);
  });

  test('returns null for token without role (legacy token)', () => {
    const token = createMockJwt({ sub: 'user-789' });
    const role = getRoleFromToken(token);

    expect(role).toBeNull();
  });

  test('returns null for token with undefined role', () => {
    const token = createMockJwt({ sub: 'user-789', role: undefined });
    const role = getRoleFromToken(token);

    expect(role).toBeNull();
  });

  test('returns null for token with invalid role value', () => {
    const token = createMockJwt({ sub: 'user-789', role: 'ADMIN' });
    const role = getRoleFromToken(token);

    expect(role).toBeNull();
  });

  test('returns null for malformed token', () => {
    const role = getRoleFromToken('not-a-valid-jwt');

    expect(role).toBeNull();
  });
});
