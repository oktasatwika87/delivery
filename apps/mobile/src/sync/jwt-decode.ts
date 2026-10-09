/**
 * JWT decode utility.
 *
 * Decodes JWT payload to extract user role for navigation decisions.
 * Does NOT verify signature, verification is handled by backend on each request.
 * This is intentional: mobile only needs to read claims for UX decisions.
 */

import { jwtDecode, type JwtPayload as JwtDecodePayload } from 'jwt-decode';

import { UserRole } from '@delivery/shared';

/** Shape of the JWT payload from our auth backend. */
export interface TokenPayload {
  /** User ID (UUID), `sub` claim */
  sub: string;
  /** User role: CUSTOMER or DRIVER */
  role: UserRole;
}

/** Extended JWT payload type from jwt-decode (includes generic claims). */
interface DecodedJwt extends JwtDecodePayload {
  sub?: string;
  role?: string;
}

/**
 * Decode JWT token and extract payload.
 *
 * @param token - JWT string (base64 encoded header.payload.signature)
 * @returns Decoded payload with role
 * @throws InvalidTokenError if token is malformed
 */
export function decodeToken(token: string): TokenPayload {
  let decoded: DecodedJwt;
  try {
    decoded = jwtDecode<DecodedJwt>(token);
  } catch (err) {
    throw new InvalidTokenError('Failed to decode token');
  }

  if (!decoded.sub) {
    throw new InvalidTokenError('Token missing sub claim');
  }

  return {
    sub: decoded.sub,
    role: decoded.role as UserRole,
  };
}

/**
 * Check if a role value is valid.
 *
 * @param role - Raw role value from JWT
 * @returns true if role is CUSTOMER or DRIVER
 */
export function isValidRole(role: unknown): role is UserRole {
  return role === UserRole.CUSTOMER || role === UserRole.DRIVER;
}

/**
 * Extract and validate role from a JWT token.
 *
 * @param token - JWT string
 * @returns Valid UserRole or null if role is missing/invalid
 */
export function getRoleFromToken(token: string): UserRole | null {
  try {
    const payload = decodeToken(token);
    if (!isValidRole(payload.role)) {
      return null;
    }
    return payload.role;
  } catch {
    return null;
  }
}

/** Error thrown when JWT token is invalid or malformed. */
export class InvalidTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTokenError';
  }
}
