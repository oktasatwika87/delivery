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

/**
 * True kalau `token` sama dengan token yang sedang tersimpan di keychain
 * dan ada token tersimpan. False kalau tidak ada token atau beda.
 *
 * Dipakai untuk membedakan 401 lama (token sudah diganti login ulang,
 * abaikan) dari 401 untuk token yang sekarang aktif (akhiri sesi).
 */
export async function isCurrentToken(token: string): Promise<boolean> {
  const current = await getToken();
  if (!current) return false;
  return current === token;
}
