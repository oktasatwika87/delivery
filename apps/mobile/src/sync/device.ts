/**
 * Device ID generator dan storage.
 *
 * Generate UUID sekali, simpan ke AsyncStorage.
 * ID konsisten sepanjang install app (survive restart).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = 'sync_device_id';

/**
 * Generate UUID v4 simple (tanpa external dependency).
 * Acceptable untuk device ID karena tidak butuh cryptographic randomness.
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let cachedDeviceId: string | null = null;

/**
 * Ambil atau generate device ID.
 * ID di-load dari AsyncStorage kalau sudah ada, otherwise di-generate dan disimpan.
 * Konsisten di setiap app launch — tidak di-generate ulang.
 */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  // Coba load dari AsyncStorage
  const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (stored) {
    cachedDeviceId = stored;
    return cachedDeviceId;
  }

  // Generate baru dan simpan
  cachedDeviceId = generateUUID();
  await AsyncStorage.setItem(DEVICE_ID_KEY, cachedDeviceId);

  return cachedDeviceId;
}
