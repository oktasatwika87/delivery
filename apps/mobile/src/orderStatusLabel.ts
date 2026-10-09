/**
 * Peta label status order untuk tampilan customer.
 *
 * Dipakai bersama oleh OrderTrackingScreen dan CustomerHomeScreen supaya
 * status yang sama punya teks yang sama di semua tempat - lihat
 * `orderStatusLabel()`.
 *
 * Teks label adalah keputusan produk. Untuk sekarang hanya layar customer
 * yang memakai modul ini. Kalau driver butuh label yang sama, modul ini
 * bisa naik level.
 */

import type { OrderStatus } from '@delivery/shared';

const STATUS_DISPLAY: Record<OrderStatus, string> = {
  PENDING: 'Menunggu konfirmasi',
  CONFIRMED: 'Dikonfirmasi, mencari driver...',
  // ASSIGNED = pool state (Mencari driver), bukan "Driver ditugaskan"
  // lagi. Order boleh di-broadcast sebagai ASSIGNED + driverId null
  // yang artinya customer melihatnya lagi mencari driver setelah
  // reject/cancel/timeout. Backend emit status 'ASSIGNED' untuk
  // order:rejected dan order:cancelled, lihat OrderRejectedPayload/
  // OrderCancelledPayload.
  ASSIGNED: 'Mencari driver...',
  PREPARING: 'Driver sedang menyiapkan',
  OUT_FOR_DELIVERY: 'Dalam perjalanan',
  DELIVERED: 'Terkirim',
  CANCELLED: 'Dibatalkan',
};

/**
 * Teks label status order untuk tampilan. Menggantikan underscore
 * dengan spasi sebagai fallback kalau status tidak dikenal - supaya
 * tidak pernah undefined di UI.
 */
export function orderStatusLabel(status: OrderStatus): string {
  return STATUS_DISPLAY[status] ?? status.replace('_', ' ');
}
