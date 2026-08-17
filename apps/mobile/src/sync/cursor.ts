/**
 * Cursor persistent untuk sync incremental.
 * Pakai AsyncStorage agar cursor survive app restart.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const CURSOR_KEY = 'sync_cursor';
let cachedCursor: string | null = null;
let initialized = false;

/**
 * Load cursor dari AsyncStorage.
 * Cached di module scope biar gak perlu baca AsyncStorage setiap syncTick.
 */
async function load(): Promise<string | null> {
  if (initialized) return cachedCursor;

  const stored = await AsyncStorage.getItem(CURSOR_KEY);
  cachedCursor = stored && stored.length > 0 ? stored : null;
  initialized = true;
  return cachedCursor;
}

export async function loadCursor(): Promise<string | null> {
  return load();
}

export async function saveCursor(next: string | null): Promise<void> {
  cachedCursor = next;
  await AsyncStorage.setItem(CURSOR_KEY, next ?? '');
}

/**
 * Synchronous accessor — dipakai di tempat yang sudah preload cursor.
 * Return null kalau belum di-init.
 */
export function getCursorSync(): string | null {
  return cachedCursor;
}