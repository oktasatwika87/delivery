/**
 * Cursor persistent untuk sync incremental.
 * Stub — implementasi asli pakai MMKV atau AsyncStorage.
 */

let cursor: string | null = null;

export async function loadCursor(): Promise<string | null> {
  return cursor;
}

export async function saveCursor(next: string | null): Promise<void> {
  cursor = next;
}