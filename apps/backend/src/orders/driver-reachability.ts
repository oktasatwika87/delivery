import { DRIVER_UNREACHABLE_MINUTES } from '@delivery/shared';

/**
 * Kapan driver terakhir tersambung, kalau sudah lewat batas menit tanpa kontak.
 *
 * Acuan = yang lebih baru dari `lastSeenAt` driver dan `updatedAt` order.
 * Selama order masih PREPARING, `updatedAt` hanya berubah saat order diterima
 * dan saat driver melakukan aksi lewat REST, jadi itu juga termasuk kontak.
 * Kalau `lastSeenAt` kosong, acuannya `updatedAt`.
 *
 * Kembalikan `null` kalau kontak masih di dalam batas, artinya driver belum
 * bisa dianggap meninggalkan order.
 */
export function driverUnreachableSince(
  lastSeenAt: Date | null,
  orderUpdatedAt: Date,
  now: Date,
): Date | null {
  const reference =
    lastSeenAt !== null && lastSeenAt.getTime() > orderUpdatedAt.getTime()
      ? lastSeenAt
      : orderUpdatedAt;

  const tanpaKontakMs = now.getTime() - reference.getTime();
  if (tanpaKontakMs > DRIVER_UNREACHABLE_MINUTES * 60 * 1000) {
    return reference;
  }
  return null;
}
