/**
 * Device ID generator dan storage.
 *
 * Generate UUID sekali, simpan persistent.
 * TODO: Ganti storage ke MMKV atau AsyncStorage setelah installed.
 */

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
 * ID sama di setiap app launch — tidak di-generate ulang.
 */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  // TODO: Ganti dengan storage persistence
  // Contoh MMKV: const stored = mmkv.getString('sync_device_id')
  // Contoh AsyncStorage: const stored = await AsyncStorage.getItem('sync_device_id')

  cachedDeviceId = generateUUID();

  // TODO: Ganti dengan storage persistence
  // Contoh MMKV: mmkv.set('sync_device_id', cachedDeviceId)
  // Contoh AsyncStorage: await AsyncStorage.setItem('sync_device_id', cachedDeviceId)

  return cachedDeviceId;
}
