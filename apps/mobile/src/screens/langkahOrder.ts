/**
 * Aturan langkah order driver.
 */

import { OrderStatus } from '@delivery/shared';

/**
 * Jumlah langkah order driver yang sudah selesai (Diterima, Diantar, Tunai,
 * Selesai), 1 sampai 4, atau null kalau status order di luar jalur antar.
 */
export function langkahOrder(status: OrderStatus, tunaiTercatat: boolean): number | null {
  if (status === OrderStatus.PREPARING) {
    return 1;
  }
  if (status === OrderStatus.OUT_FOR_DELIVERY) {
    return tunaiTercatat ? 3 : 2;
  }
  if (status === OrderStatus.DELIVERED) {
    return 4;
  }
  return null;
}
