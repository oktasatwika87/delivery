/**
 * Secure token storage menggunakan react-native-keychain.
 *
 * Data yang disimpan:
 *   { token: string, userId: string }
 *
 * Dipilih menyimpan token + userId dalam 1 object karena:
 *   - Mereka selalu bersamaan (token tanpa userId meaningless)
 *   - Kurangi jumlah keychain operation (1x save/login, 1x delete/logout)
 *   - Simpel — saat logout, hapus 1 object saja
 *
 * Keychain service: 'delivery-app' (identifier untuk app ini)
 */

import * as Keychain from 'react-native-keychain';

const SERVICE = 'delivery-app';
const KEY = 'session';

/** Shape data yang disimpan di keychain */
interface SessionData {
  token: string;
  userId: string;
}

/**
 * Simpan token + userId ke secure storage.
 * Dipanggil setelah login berhasil.
 */
export async function saveToken(token: string, userId: string): Promise<void> {
  const data: SessionData = { token, userId };
  await Keychain.setGenericPassword(KEY, JSON.stringify(data), {
    service: SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED,
  });
}

/**
 * Ambil token dari secure storage.
 * Return null kalau belum ada session (belum login).
 */
export async function getToken(): Promise<string | null> {
  try {
    const result = await Keychain.getGenericPassword({ service: SERVICE });
    if (!result) return null;
    const data: SessionData = JSON.parse(result.password);
    return data.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Ambil userId dari secure storage.
 * Return null kalau belum ada session.
 */
export async function getUserId(): Promise<string | null> {
  try {
    const result = await Keychain.getGenericPassword({ service: SERVICE });
    if (!result) return null;
    const data: SessionData = JSON.parse(result.password);
    return data.userId ?? null;
  } catch {
    return null;
  }
}

/**
 * Hapus token + userId dari secure storage.
 * Dipanggil saat logout.
 */
export async function clearToken(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE });
}
