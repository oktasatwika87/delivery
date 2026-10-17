import { Model } from '@nozbe/watermelondb';
import { field, text, date, readonly, json } from '@nozbe/watermelondb/decorators';

/**
 * Jenis aksi di outbox driver.
 *
 * - reject: driver menolak order yang ditugaskan.
 * - cancel: driver membatalkan order di tengah pengantaran.
 * - collect_cod: driver menerima uang COD.
 * - update_status: driver menaikkan status order (Mulai antar, Selesai
 *   diantar).
 *
 * Aksi update_status, cancel, dan reject untuk order yang sama dikirim
 * berurutan: aksi yang lebih baru menunggu aksi yang lebih lama selesai
 * (lihat penjaga urutan di runDrainOnce, outbox.ts). collect_cod tidak
 * ikut menunggu, karena uangnya sudah diterima driver dan server mencatat
 * COD tanpa melihat status order.
 */
export type ActionType = 'reject' | 'cancel' | 'collect_cod' | 'update_status';

/**
 * Status aksi di outbox.
 *
 * - 'pending': menunggu dikirim.
 * - 'syncing': sedang dikirim. Kalau aplikasi mati di tengah pengiriman, aksi
 *   tertinggal 'syncing' dan dikirim lagi di putaran berikutnya.
 * - 'failed': ditolak server (4xx), tidak dikirim lagi sampai driver memilih
 *   Coba lagi di layar detail.
 * - 'orphaned_needs_review': COD untuk order yang sudah tidak ditugaskan ke
 *   driver ini; diselesaikan lewat support.
 */
export type PendingActionStatus = 'pending' | 'syncing' | 'failed' | 'orphaned_needs_review';

/**
 * Payload for cancel action, includes reason.
 */
export interface CancelPayload {
  reason?: string;
}

/**
 * Payload for collect_cod action, includes amountCents.
 */
export interface CollectCodPayload {
  amountCents: number;
}

/**
 * Payload aksi update_status: status tujuan. Driver hanya memakai dua
 * transisi, PREPARING ke OUT_FOR_DELIVERY dan OUT_FOR_DELIVERY ke DELIVERED.
 */
export interface UpdateStatusPayload {
  status: 'OUT_FOR_DELIVERY' | 'DELIVERED';
}

export class PendingActionModel extends Model {
  static override table = 'pending_actions';

  @text('action_type') actionType!: ActionType;
  @text('target_order_id') targetOrderId!: string;
  @field('expected_version') expectedVersion!: number;
  @text('idempotency_key') idempotencyKey!: string;
  @json('payload_json', sanitizePayload) payloadJson!:
    CancelPayload | CollectCodPayload | UpdateStatusPayload | null;
  @text('status') status!: PendingActionStatus;

  @readonly @date('created_at') createdAt!: Date;
  @readonly @date('updated_at') updatedAt!: Date;
}

function sanitizePayload(
  raw: unknown,
): CancelPayload | CollectCodPayload | UpdateStatusPayload | null {
  return raw as CancelPayload | CollectCodPayload | UpdateStatusPayload | null;
}

/**
 * Pemeriksa bentuk payload aksi `update_status` yang sudah diantre. Dipakai
 * outbox untuk menentukan target saat mengirim, dan layar detail untuk
 * menampilkan status yang sedang antre (lihat displayStatus di
 * OrderDetailScreen).
 *
 * Tanpa cast: `status` diperiksa dengan `in`, dan nilainya harus salah satu
 * dari dua target di UpdateStatusPayload. Payload lain (bukan objek, tanpa
 * `status`, atau status di luar dua itu) mengembalikan null.
 */
export function readUpdateStatusTarget(
  payload: unknown,
): 'OUT_FOR_DELIVERY' | 'DELIVERED' | null {
  if (!payload || typeof payload !== 'object') return null;
  if (!('status' in payload)) return null;
  const status = payload.status;
  if (status === 'OUT_FOR_DELIVERY' || status === 'DELIVERED') return status;
  return null;
}
