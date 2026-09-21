/**
 * Buat baris pool baru untuk prepareCreateFromDirtyRaw.
 *
 * Isi baris (snake_case sesuai skema):
 *   id, _status, _changed, status, total_cents, currency, server_version,
 *   items_json, address_json, customer_id, driver_id, created_at, updated_at
 *
 * Tidak mengakses database dan tidak memanggil Date.now(). Waktu sekarang
 * (nowMs) diberikan dari luar oleh fetchPool.
 */

/**
 * Ubah teks ISO jadi milidetik. Hasilnya null kalau teksnya tidak valid.
 */
function parseIsoMsOrNull(value: unknown): number | null {
  if (typeof value === 'string' && value.length > 0) {
    const ms = Date.parse(value);
    if (!isNaN(ms)) return ms;
  }
  return null;
}

export interface PoolItem {
  orderId: string;
  totalCents: number;
  currency: string;
  createdAt: string;
  version: number;
}

export function buildPoolRow(item: PoolItem, nowMs: number): Record<string, unknown> {
  const createdAtMs = parseIsoMsOrNull(item.createdAt) ?? nowMs;
  return {
    id: item.orderId,
    _status: 'synced',
    _changed: '',
    status: 'ASSIGNED',
    total_cents: item.totalCents,
    currency: item.currency,
    server_version: item.version,
    items_json: '[]',
    address_json: '{}',
    customer_id: '',
    driver_id: null,
    created_at: createdAtMs,
    updated_at: nowMs,
  };
}
