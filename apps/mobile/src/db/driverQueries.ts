/**
 * Kueri bersama untuk layar driver.
 *
 * Kueri ini dikumpulkan di satu tempat supaya layar lain (misalnya Detail
 * order) bisa memakai penyaringan yang sama dengan layar Order.
 */

import { Q } from '@nozbe/watermelondb';
import type { Database } from '@nozbe/watermelondb';

import type { OrderModel } from './models/OrderModel';
import type { PaymentModel } from './models/PaymentModel';
import type { PendingActionModel } from './models/PendingActionModel';

/** Semua aksi outbox, berubah saat kolom status berubah. */
export function allActionsQuery(database: Database) {
  return database
    .get<PendingActionModel>('pending_actions')
    .query()
    .observeWithColumns(['status']);
}

/** Order milik driver yang belum dihapus. */
export function driverOrdersQuery(database: Database, driverId: string) {
  return database
    .get<OrderModel>('orders')
    .query(Q.where('driver_id', driverId), Q.where('deleted_at', null))
    .observeWithColumns(['status', 'updated_at']);
}

/** Payment tunai yang belum dihapus. */
export function cashPaymentsQuery(database: Database) {
  return database
    .get<PaymentModel>('payments')
    .query(Q.where('method', 'CASH'), Q.where('deleted_at', null))
    .observeWithColumns(['status']);
}
