/**
 * Ringkasan hari ini untuk driver.
 *
 * Tunai dihitung dari payment, bukan dari order selesai: uang yang sudah
 * ditagih tapi ordernya belum ditandai selesai adalah uang yang sedang
 * dipegang driver.
 */

import { OrderStatus } from '@delivery/shared';

import { OrderModel } from '../db/models/OrderModel';
import { PaymentModel } from '../db/models/PaymentModel';
import { PendingActionModel } from '../db/models/PendingActionModel';
import { deriveOrderSyncView, queuedDeliveredAt } from '../sync/orderSyncView';
import { readOrderStatus, readTotalCents, readWaktu } from './orderRowRead';

export interface DaySummaryValues {
  doneCount: number;
  cashAmount: number;
}

// Jumlah tunai menggabungkan banyak baris payment, dan server selalu mengisi
// mata uang IDR.
export const MATA_UANG_TUNAI = 'IDR';

function readText(row: PaymentModel, column: string): string {
  const raw = row._getRaw(column);
  return typeof raw === 'string' ? raw : '';
}

function readNumber(row: PaymentModel, column: string): number {
  const raw = row._getRaw(column);
  return typeof raw === 'number' ? raw : 0;
}

// Waktu payment yang dihapus. Kosong berarti payment masih hidup.
function readDeletedAt(row: PaymentModel): number | null {
  const raw = row._getRaw('deleted_at');
  return typeof raw === 'number' ? raw : null;
}

function readActionText(action: PendingActionModel, column: string): string {
  const raw = action._getRaw(column);
  return typeof raw === 'string' ? raw : '';
}

function readActionCreatedAt(action: PendingActionModel): number {
  const raw = action._getRaw('created_at');
  return typeof raw === 'number' ? raw : 0;
}

/** Aksi dikelompokkan per order, supaya tiap order cuma lihat aksinya. */
function groupActions(actions: PendingActionModel[]): Map<string, PendingActionModel[]> {
  const grouped = new Map<string, PendingActionModel[]>();
  for (const action of actions) {
    const orderId = action._getRaw('target_order_id');
    if (typeof orderId !== 'string' || orderId.length === 0) continue;
    const list = grouped.get(orderId);
    if (list) {
      list.push(action);
    } else {
      grouped.set(orderId, [action]);
    }
  }
  return grouped;
}

/**
 * Jumlah order selesai dan tunai tercatat hari ini.
 *
 * Batas hari memakai tengah malam jam HP, jadi yang dihitung adalah yang
 * benar-benar dikerjakan hari ini menurut jam yang dilihat driver.
 */
export function deriveDaySummary(
  orders: OrderModel[],
  payments: PaymentModel[],
  actions: PendingActionModel[],
  now: number,
): DaySummaryValues {
  const awal = new Date(now);
  awal.setHours(0, 0, 0, 0);
  const akhir = new Date(awal);
  akhir.setDate(akhir.getDate() + 1);
  const mulaiHari = awal.getTime();
  const selesaiHari = akhir.getTime();
  const diHariIni = (waktu: number): boolean =>
    waktu >= mulaiHari && waktu < selesaiHari;

  const actionsByOrderId = groupActions(actions);
  const orderIds = new Set<string>();
  for (const row of orders) {
    orderIds.add(row.id);
  }

  let doneCount = 0;
  for (const row of orders) {
    const aksi = actionsByOrderId.get(row.id) ?? [];
    const statusBaris = readOrderStatus(row);
    const { displayStatus } = deriveOrderSyncView(statusBaris, aksi);
    if (displayStatus !== OrderStatus.DELIVERED) continue;
    // Waktu selesai diambil dari baris order kalau server sudah menandainya
    // selesai, kalau tidak dari aksi Selesai diantar yang masih antre.
    const waktu =
      statusBaris === OrderStatus.DELIVERED
        ? readWaktu(row, 'updated_at')
        : queuedDeliveredAt(aksi);
    if (waktu === null) continue;
    if (diHariIni(waktu)) doneCount += 1;
  }

  // Payment yang sudah tercatat, untuk order milik driver ini.
  let cashAmount = 0;
  const orderIdsDenganTunai = new Set<string>();
  for (const payment of payments) {
    if (readText(payment, 'method') !== 'CASH') continue;
    if (readText(payment, 'status') !== 'CAPTURED') continue;
    if (readDeletedAt(payment) !== null) continue;
    const orderId = readText(payment, 'order_id');
    if (!orderIds.has(orderId)) continue;
    orderIdsDenganTunai.add(orderId);
    if (!diHariIni(readNumber(payment, 'created_at'))) continue;
    cashAmount += readNumber(payment, 'amount_cents');
  }

  // Uang yang sudah diterima tapi payment-nya belum sampai dari server,
  // dihitung dari aksi COD yang masih antre.
  for (const row of orders) {
    if (orderIdsDenganTunai.has(row.id)) continue;
    const aksi = actionsByOrderId.get(row.id) ?? [];
    for (const action of aksi) {
      if (readActionText(action, 'action_type') !== 'collect_cod') continue;
      const status = readActionText(action, 'status');
      if (status !== 'pending' && status !== 'syncing') continue;
      if (!diHariIni(readActionCreatedAt(action))) continue;
      cashAmount += readTotalCents(row);
      break;
    }
  }

  return { doneCount, cashAmount };
}
