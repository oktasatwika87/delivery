/**
 * User session holder.
 *
 * TODO: Ganti dengan userId dari auth session setelah auth module dibuat.
 * Saat ini stub untuk development tanpa auth.
 */

/**
 * TODO: Implementasi asli harus baca dari auth context/state.
 * Contoh: return authState.userId dari Context atau Zustand store.
 */
export async function getCurrentUserId(): Promise<string> {
  return DUMMY_USER_ID;
}

/** Stub user ID untuk development tanpa auth module. */
export const DUMMY_USER_ID = 'dev-user-001';
