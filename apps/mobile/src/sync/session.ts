/**
 * User session holder.
 *
 * Baca token & userId dari secure storage (keychain).
 * Diisi saat login, di-clear saat logout.
 */

import { getToken, getUserId } from './token-storage';

/**
 * Get userId dari session.
 * Return null kalau belum login.
 */
export async function getCurrentUserId(): Promise<string | null> {
  return getUserId();
}

/**
 * Get JWT token dari session.
 * Return null kalau belum login.
 */
export async function getCurrentToken(): Promise<string | null> {
  return getToken();
}
