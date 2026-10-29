/**
 * Peta label status order untuk tampilan driver.
 *
 * Berbeda dari `src/orderStatusLabel.ts` yang dipakai tampilan customer,
 * di sini ASSIGNED berarti order ada di daftar Tersedia (baris pool, belum
 * punya driver), jadi teksnya "Tersedia", bukan "Mencari driver" seperti di
 * customer.
 */

import type { OrderStatus } from '@delivery/shared';

const STATUS_DRIVER: Record<OrderStatus, string> = {
  PENDING: 'Menunggu konfirmasi',
  CONFIRMED: 'Menunggu konfirmasi',
  ASSIGNED: 'Tersedia',
  PREPARING: 'Diterima',
  OUT_FOR_DELIVERY: 'Sedang diantar',
  DELIVERED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

export function driverStatusLabel(status: OrderStatus): string {
  return STATUS_DRIVER[status];
}
