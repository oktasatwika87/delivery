/**
 * Tes aturan langkah order driver.
 */

import { OrderStatus } from '@delivery/shared';

import { langkahOrder } from './langkahOrder';

const KASUS: {
  status: OrderStatus;
  tunaiTercatat: boolean;
  hasil: number | null;
}[] = [
  { status: OrderStatus.PREPARING, tunaiTercatat: false, hasil: 1 },
  { status: OrderStatus.PREPARING, tunaiTercatat: true, hasil: 1 },
  { status: OrderStatus.OUT_FOR_DELIVERY, tunaiTercatat: false, hasil: 2 },
  { status: OrderStatus.OUT_FOR_DELIVERY, tunaiTercatat: true, hasil: 3 },
  { status: OrderStatus.DELIVERED, tunaiTercatat: false, hasil: 4 },
  { status: OrderStatus.DELIVERED, tunaiTercatat: true, hasil: 4 },
  { status: OrderStatus.PENDING, tunaiTercatat: false, hasil: null },
  { status: OrderStatus.PENDING, tunaiTercatat: true, hasil: null },
  { status: OrderStatus.CONFIRMED, tunaiTercatat: false, hasil: null },
  { status: OrderStatus.CONFIRMED, tunaiTercatat: true, hasil: null },
  { status: OrderStatus.ASSIGNED, tunaiTercatat: false, hasil: null },
  { status: OrderStatus.ASSIGNED, tunaiTercatat: true, hasil: null },
  { status: OrderStatus.CANCELLED, tunaiTercatat: false, hasil: null },
  { status: OrderStatus.CANCELLED, tunaiTercatat: true, hasil: null },
];

describe('langkah order', () => {
  it.each(KASUS)(
    'status $status dengan tunai $tunaiTercatat jadi $hasil',
    (kasus) => {
      expect(langkahOrder(kasus.status, kasus.tunaiTercatat)).toBe(kasus.hasil);
    },
  );
});
