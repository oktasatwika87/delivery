/**
 * Urutan daftar order.
 *
 * Order aktif dulu, lalu sisanya. Di dalam tiap kelompok, order yang dibuat
 * paling baru dulu. Urutannya memakai created_at karena jam di kartu juga
 * dari created_at, jadi kartu tidak melompat tempat hanya karena server
 * mengisi updated_at baru.
 */

import { OrderStatus } from '@delivery/shared';

import { OrderModel } from '../db/models/OrderModel';
import { PendingActionModel } from '../db/models/PendingActionModel';
import { deriveOrderSyncView } from '../sync/orderSyncView';
import { readOrderStatus, readWaktu } from './orderRowRead';

/** Status order yang masih dikerjakan driver. */
export function isActiveStatus(status: OrderStatus): boolean {
  return status === OrderStatus.PREPARING || status === OrderStatus.OUT_FOR_DELIVERY;
}

/** created_at terbaru dulu, seri diputus id naik. */
function bandingkanBaris(a: OrderModel, b: OrderModel): number {
  const selisihWaktu = readWaktu(b, 'created_at') - readWaktu(a, 'created_at');
  if (selisihWaktu !== 0) return selisihWaktu;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** Status yang tampil di kartu untuk sebuah order. */
function statusTampil(row: OrderModel, actions: PendingActionModel[]): OrderStatus {
  const { displayStatus } = deriveOrderSyncView(readOrderStatus(row), actions);
  return displayStatus;
}

/**
 * Urutan Order Saya: order aktif di atas, sisanya di bawah.
 *
 * Status yang dipakai adalah status yang tampil di kartu, jadi order yang
 * statusnya sudah selesai tapi masih punya aksi Selesai diantar yang antre
 * ikut ke kelompok bawah.
 */
export function sortMyOrders(
  orders: OrderModel[],
  actionsByOrderId: ReadonlyMap<string, PendingActionModel[]>,
): OrderModel[] {
  const aktif: OrderModel[] = [];
  const lain: OrderModel[] = [];
  for (const row of orders) {
    const actions = actionsByOrderId.get(row.id) ?? [];
    if (isActiveStatus(statusTampil(row, actions))) {
      aktif.push(row);
    } else {
      lain.push(row);
    }
  }
  return [...aktif.sort(bandingkanBaris), ...lain.sort(bandingkanBaris)];
}

/**
 * Jumlah order yang masih dikerjakan.
 *
 * Dihitung dari status yang sama dengan urutan daftar, jadi pil tidak
 * menghitung order yang aksinya sudah selesai tapi belum terkirim.
 */
export function countActiveOrders(
  orders: OrderModel[],
  actionsByOrderId: ReadonlyMap<string, PendingActionModel[]>,
): number {
  let jumlah = 0;
  for (const row of orders) {
    const actions = actionsByOrderId.get(row.id) ?? [];
    if (isActiveStatus(statusTampil(row, actions))) jumlah += 1;
  }
  return jumlah;
}

/** Urutan Tersedia: order yang dibuat paling baru dulu. */
export function sortPoolOrders(orders: OrderModel[]): OrderModel[] {
  return [...orders].sort(bandingkanBaris);
}
