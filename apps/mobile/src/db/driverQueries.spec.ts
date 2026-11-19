/**
 * Tes kueri bersama driver.
 *
 * Baris order, payment, dan pending_actions dibuat di database Loki
 * sungguhan, jadi penyaringannya diuji pada baris yang sama seperti di
 * aplikasi.
 */

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { firstValueFrom } from 'rxjs';

import { schema } from './schema';
import { OrderModel } from './models/OrderModel';
import { PaymentModel } from './models/PaymentModel';
import { PendingActionModel } from './models/PendingActionModel';
import {
  allActionsQuery,
  cashPaymentsQuery,
  driverOrdersQuery,
} from './driverQueries';

function buatDatabase(): Database {
  const adapter = new LokiJSAdapter({
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
    onSetUpError: (e: Error) => {
      throw e;
    },
  });
  return new Database({
    adapter,
    modelClasses: [OrderModel, PaymentModel, PendingActionModel],
  });
}

interface IsianOrder {
  id: string;
  driverId?: string | null;
  deletedAt?: number | null;
}

interface IsianPayment {
  id: string;
  method?: string;
  deletedAt?: number | null;
}

interface IsianAksi {
  id: string;
  status: string;
}

async function seedOrder(db: Database, isi: IsianOrder): Promise<void> {
  await db.write(async () => {
    const prepared = db.get<OrderModel>('orders').prepareCreateFromDirtyRaw({
      id: isi.id,
      _status: 'synced',
      _changed: '',
      customer_id: 'cust-1',
      driver_id: isi.driverId ?? null,
      status: 'PREPARING',
      items_json: '[]',
      address_json: '{}',
      total_cents: 25000,
      currency: 'IDR',
      notes: null,
      server_version: 1,
      deleted_at: isi.deletedAt ?? null,
      failed_sync_attempts: 0,
      cancelled_by: null,
      cancel_reason: null,
      last_conflict_reason: null,
      last_conflict_at: null,
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_000,
    });
    await db.batch(prepared);
  });
}

async function seedPayment(db: Database, isi: IsianPayment): Promise<void> {
  await db.write(async () => {
    const prepared = db.get<PaymentModel>('payments').prepareCreateFromDirtyRaw({
      id: isi.id,
      _status: 'synced',
      _changed: '',
      order_id: 'order-1',
      idempotency_key: isi.id,
      method: isi.method ?? 'CASH',
      status: 'CAPTURED',
      amount_cents: 120000,
      currency: 'IDR',
      kind: 'PAYMENT',
      external_ref: null,
      server_version: 1,
      deleted_at: isi.deletedAt ?? null,
      failed_sync_attempts: 0,
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_000,
    });
    await db.batch(prepared);
  });
}

async function seedAksi(db: Database, isi: IsianAksi): Promise<void> {
  await db.write(async () => {
    const prepared = db
      .get<PendingActionModel>('pending_actions')
      .prepareCreateFromDirtyRaw({
        id: isi.id,
        _status: 'synced',
        _changed: '',
        action_type: 'update_status',
        target_order_id: 'order-1',
        expected_version: 1,
        idempotency_key: isi.id,
        payload_json: '',
        status: isi.status,
        created_at: 1_700_000_000_000,
        updated_at: 1_700_000_000_000,
      });
    await db.batch(prepared);
  });
}

describe('kueri bersama driver', () => {
  let db: Database;

  beforeEach(() => {
    db = buatDatabase();
  });

  it('order milik driver yang belum dihapus saja yang ikut', async () => {
    await seedOrder(db, { id: 'order-saya', driverId: 'driver-1' });
    await seedOrder(db, { id: 'order-driver-lain', driverId: 'driver-2' });
    await seedOrder(db, { id: 'order-dihapus', driverId: 'driver-1', deletedAt: 1_700_000_000_000 });

    const orders = await firstValueFrom(driverOrdersQuery(db, 'driver-1'));

    expect(orders.map((row) => row.id)).toEqual(['order-saya']);
  });

  it('payment tunai yang belum dihapus saja yang ikut', async () => {
    await seedPayment(db, { id: 'pay-tunai' });
    await seedPayment(db, { id: 'pay-kartu', method: 'CARD' });
    await seedPayment(db, { id: 'pay-dihapus', deletedAt: 1_700_000_000_000 });

    const payments = await firstValueFrom(cashPaymentsQuery(db));

    expect(payments.map((row) => row.id)).toEqual(['pay-tunai']);
  });

  it('semua aksi ikut apa pun statusnya', async () => {
    await seedAksi(db, { id: 'pa-antre', status: 'pending' });
    await seedAksi(db, { id: 'pa-dikirim', status: 'syncing' });
    await seedAksi(db, { id: 'pa-gagal', status: 'failed' });

    const actions = await firstValueFrom(allActionsQuery(db));

    expect(actions.map((row) => row.id).sort()).toEqual([
      'pa-antre',
      'pa-dikirim',
      'pa-gagal',
    ]);
  });
});
