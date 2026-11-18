/**
 * Pembaca kolom baris order.
 *
 * Kolom dibaca lewat _getRaw, jadi pembaca ini bisa dipakai di mana saja
 * tanpa dekorator WatermelonDB aktif.
 */

import { OrderStatus } from '@delivery/shared';

import { OrderModel } from '../db/models/OrderModel';

const ORDER_STATUS_VALUES: readonly string[] = Object.values(OrderStatus);

export function isOrderStatus(value: string): value is OrderStatus {
  return ORDER_STATUS_VALUES.includes(value);
}

export function readOrderStatus(row: OrderModel): OrderStatus {
  const raw = row._getRaw('status');
  if (typeof raw === 'string' && isOrderStatus(raw)) return raw;
  return OrderStatus.PENDING;
}

export function readTotalCents(row: OrderModel): number {
  const raw = row._getRaw('total_cents');
  return typeof raw === 'number' ? raw : 0;
}

export function readCurrency(row: OrderModel): string {
  const raw = row._getRaw('currency');
  return typeof raw === 'string' ? raw : '';
}

export function readWaktu(row: OrderModel, column: 'created_at' | 'updated_at'): number {
  const raw = row._getRaw(column);
  return typeof raw === 'number' ? raw : 0;
}
