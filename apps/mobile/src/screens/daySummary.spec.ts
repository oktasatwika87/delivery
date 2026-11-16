/**
 * Tes ringkasan hari ini.
 *
 * Baris order, payment, dan pending_actions dibuat di database Loki
 * sungguhan, karena pembaca kolomnya lewat _getRaw.
 */

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { schema } from '../db/schema';
import { OrderModel } from '../db/models/OrderModel';
import { PaymentModel } from '../db/models/PaymentModel';
import { PendingActionModel } from '../db/models/PendingActionModel';
import { deriveDaySummary } from './daySummary';

// outbox mengimpor '../db' (adapter SQLite) yang gagal dimuat di Jest.
jest.mock('../db', () => ({ database: {} }));

// Waktu patokan: 16 November 2026 pukul 10.00 waktu lokal.
const SEKARANG = new Date(2026, 10, 16, 10, 0).getTime();
const AWAL_HARI = new Date(2026, 10, 16, 0, 0).getTime();
const HARI_INI_0900 = new Date(2026, 10, 16, 9, 0).getTime();
const HARI_INI_1000 = new Date(2026, 10, 16, 10, 0).getTime();
const KEMARIN_2359 = new Date(2026, 10, 15, 23, 59).getTime();
const KEMARIN_0800 = new Date(2026, 10, 15, 8, 0).getTime();

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
  status: string;
  totalCents?: number;
  updatedAt: number;
}

interface IsianPayment {
  id: string;
  orderId: string;
  method?: string;
  status?: string;
  amountCents?: number;
  deletedAt?: number | null;
  createdAt: number;
}

interface IsianAksi {
  id: string;
  actionType: string;
  targetOrderId: string;
  status: string;
  payloadJson?: string;
  createdAt: number;
}

async function seedOrder(db: Database, isi: IsianOrder): Promise<void> {
  await db.write(async () => {
    const prepared = db.get<OrderModel>('orders').prepareCreateFromDirtyRaw({
      id: isi.id,
      _status: 'synced',
      _changed: '',
      customer_id: 'cust-1',
      driver_id: 'driver-1',
      status: isi.status,
      items_json: '[]',
      address_json: '{}',
      total_cents: isi.totalCents ?? 25000,
      currency: 'IDR',
      notes: null,
      server_version: 1,
      deleted_at: null,
      failed_sync_attempts: 0,
      cancelled_by: null,
      cancel_reason: null,
      last_conflict_reason: null,
      last_conflict_at: null,
      created_at: AWAL_HARI,
      updated_at: isi.updatedAt,
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
      order_id: isi.orderId,
      idempotency_key: isi.id,
      method: isi.method ?? 'CASH',
      status: isi.status ?? 'CAPTURED',
      amount_cents: isi.amountCents ?? 120000,
      currency: 'IDR',
      kind: 'PAYMENT',
      external_ref: null,
      server_version: 1,
      deleted_at: isi.deletedAt ?? null,
      failed_sync_attempts: 0,
      created_at: isi.createdAt,
      updated_at: isi.createdAt,
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
        action_type: isi.actionType,
        target_order_id: isi.targetOrderId,
        expected_version: 1,
        idempotency_key: isi.id,
        payload_json: isi.payloadJson ?? '',
        status: isi.status,
        created_at: isi.createdAt,
        updated_at: isi.createdAt,
      });
    await db.batch(prepared);
  });
}

async function ambilOrder(db: Database): Promise<OrderModel[]> {
  return db.get<OrderModel>('orders').query().fetch();
}

async function ambilPayment(db: Database): Promise<PaymentModel[]> {
  return db.get<PaymentModel>('payments').query().fetch();
}

async function ambilAksi(db: Database): Promise<PendingActionModel[]> {
  return db.get<PendingActionModel>('pending_actions').query().fetch();
}

describe('jumlah order selesai hari ini', () => {
  let db: Database;

  beforeEach(() => {
    db = buatDatabase();
  });

  it('order selesai hari ini dihitung', async () => {
    await seedOrder(db, { id: 'order-1', status: 'DELIVERED', updatedAt: HARI_INI_0900 });

    const hasil = deriveDaySummary(
      await ambilOrder(db),
      await ambilPayment(db),
      await ambilAksi(db),
      SEKARANG,
    );

    expect(hasil.doneCount).toBe(1);
  });

  it('order selesai kemarin tidak dihitung', async () => {
    await seedOrder(db, { id: 'order-1', status: 'DELIVERED', updatedAt: KEMARIN_2359 });

    const hasil = deriveDaySummary(
      await ambilOrder(db),
      await ambilPayment(db),
      await ambilAksi(db),
      SEKARANG,
    );

    expect(hasil.doneCount).toBe(0);
  });

  it('order selesai tepat tengah malam dihitung', async () => {
    await seedOrder(db, { id: 'order-1', status: 'DELIVERED', updatedAt: AWAL_HARI });

    const hasil = deriveDaySummary(
      await ambilOrder(db),
      await ambilPayment(db),
      await ambilAksi(db),
      SEKARANG,
    );

    expect(hasil.doneCount).toBe(1);
  });

  it('order dengan aksi selesai diantar yang antre hari ini dihitung', async () => {
    await seedOrder(db, { id: 'order-1', status: 'PREPARING', updatedAt: AWAL_HARI });
    await seedAksi(db, {
      id: 'pa-1',
      actionType: 'update_status',
      targetOrderId: 'order-1',
      status: 'pending',
      payloadJson: '{"status":"DELIVERED"}',
      createdAt: HARI_INI_1000,
    });

    const hasil = deriveDaySummary(
      await ambilOrder(db),
      await ambilPayment(db),
      await ambilAksi(db),
      SEKARANG,
    );

    expect(hasil.doneCount).toBe(1);
  });

  it('aksi selesai diantar yang dibuat kemarin tidak dihitung', async () => {
    await seedOrder(db, { id: 'order-1', status: 'PREPARING', updatedAt: AWAL_HARI });
    await seedAksi(db, {
      id: 'pa-1',
      actionType: 'update_status',
      targetOrderId: 'order-1',
      status: 'pending',
      payloadJson: '{"status":"DELIVERED"}',
      createdAt: KEMARIN_0800,
    });

    const hasil = deriveDaySummary(
      await ambilOrder(db),
      await ambilPayment(db),
      await ambilAksi(db),
      SEKARANG,
    );

    expect(hasil.doneCount).toBe(0);
  });

  it('aksi selesai diantar yang ditolak server tidak dihitung', async () => {
    await seedOrder(db, { id: 'order-1', status: 'PREPARING', updatedAt: AWAL_HARI });
    await seedAksi(db, {
      id: 'pa-1',
      actionType: 'update_status',
      targetOrderId: 'order-1',
      status: 'failed',
      payloadJson: '{"status":"DELIVERED"}',
      createdAt: HARI_INI_1000,
    });

    const hasil = deriveDaySummary(
      await ambilOrder(db),
      await ambilPayment(db),
      await ambilAksi(db),
      SEKARANG,
    );

    expect(hasil.doneCount).toBe(0);
  });
});

describe('jumlah tunai hari ini', () => {
  let db: Database;

  beforeEach(() => {
    db = buatDatabase();
  });

  it('payment tunai hari ini dijumlahkan', async () => {
    await seedOrder(db, { id: 'order-1', status: 'DELIVERED', updatedAt: HARI_INI_0900 });
    await seedPayment(db, {
      id: 'pay-1',
      orderId: 'order-1',
      amountCents: 120000,
      createdAt: HARI_INI_0900,
    });

    const hasil = deriveDaySummary(
      await ambilOrder(db),
      await ambilPayment(db),
      await ambilAksi(db),
      SEKARANG,
    );

    expect(hasil.cashAmount).toBe(120000);
  });

  it('payment kemarin tidak dihitung', async () => {
    await seedOrder(db, { id: 'order-1', status: 'DELIVERED', updatedAt: HARI_INI_0900 });
    await seedPayment(db, {
      id: 'pay-1',
      orderId: 'order-1',
      amountCents: 120000,
      createdAt: KEMARIN_0800,
    });

    const hasil = deriveDaySummary(
      await ambilOrder(db),
      await ambilPayment(db),
      await ambilAksi(db),
      SEKARANG,
    );

    expect(hasil.cashAmount).toBe(0);
  });

  it('payment yang gagal tidak dihitung', async () => {
    await seedOrder(db, { id: 'order-1', status: 'DELIVERED', updatedAt: HARI_INI_0900 });
    await seedPayment(db, {
      id: 'pay-1',
      orderId: 'order-1',
      status: 'FAILED',
      amountCents: 120000,
      createdAt: HARI_INI_0900,
    });

    const hasil = deriveDaySummary(
      await ambilOrder(db),
      await ambilPayment(db),
      await ambilAksi(db),
      SEKARANG,
    );

    expect(hasil.cashAmount).toBe(0);
  });

  it('payment yang sudah dihapus tidak dihitung', async () => {
    await seedOrder(db, { id: 'order-1', status: 'DELIVERED', updatedAt: HARI_INI_0900 });
    await seedPayment(db, {
      id: 'pay-1',
      orderId: 'order-1',
      amountCents: 120000,
      deletedAt: HARI_INI_1000,
      createdAt: HARI_INI_0900,
    });

    const hasil = deriveDaySummary(
      await ambilOrder(db),
      await ambilPayment(db),
      await ambilAksi(db),
      SEKARANG,
    );

    expect(hasil.cashAmount).toBe(0);
  });

  it('payment milik order yang bukan milik driver ini tidak dihitung', async () => {
    await seedOrder(db, { id: 'order-1', status: 'DELIVERED', updatedAt: HARI_INI_0900 });
    await seedPayment(db, {
      id: 'pay-1',
      orderId: 'order-lain',
      amountCents: 120000,
      createdAt: HARI_INI_0900,
    });

    const hasil = deriveDaySummary(
      await ambilOrder(db),
      await ambilPayment(db),
      await ambilAksi(db),
      SEKARANG,
    );

    expect(hasil.cashAmount).toBe(0);
  });

  it('aksi COD yang antre menambah jumlah order', async () => {
    await seedOrder(db, {
      id: 'order-1',
      status: 'DELIVERED',
      totalCents: 25000,
      updatedAt: HARI_INI_0900,
    });
    await seedAksi(db, {
      id: 'pa-cod',
      actionType: 'collect_cod',
      targetOrderId: 'order-1',
      status: 'pending',
      createdAt: HARI_INI_1000,
    });

    const hasil = deriveDaySummary(
      await ambilOrder(db),
      await ambilPayment(db),
      await ambilAksi(db),
      SEKARANG,
    );

    expect(hasil.cashAmount).toBe(25000);
  });

  it('aksi COD yang ditolak server tidak dihitung', async () => {
    await seedOrder(db, {
      id: 'order-1',
      status: 'DELIVERED',
      totalCents: 25000,
      updatedAt: HARI_INI_0900,
    });
    await seedAksi(db, {
      id: 'pa-cod',
      actionType: 'collect_cod',
      targetOrderId: 'order-1',
      status: 'failed',
      createdAt: HARI_INI_1000,
    });

    const hasil = deriveDaySummary(
      await ambilOrder(db),
      await ambilPayment(db),
      await ambilAksi(db),
      SEKARANG,
    );

    expect(hasil.cashAmount).toBe(0);
  });

  it('aksi COD yatim tidak dihitung', async () => {
    await seedOrder(db, {
      id: 'order-1',
      status: 'DELIVERED',
      totalCents: 25000,
      updatedAt: HARI_INI_0900,
    });
    await seedAksi(db, {
      id: 'pa-cod',
      actionType: 'collect_cod',
      targetOrderId: 'order-1',
      status: 'orphaned_needs_review',
      createdAt: HARI_INI_1000,
    });

    const hasil = deriveDaySummary(
      await ambilOrder(db),
      await ambilPayment(db),
      await ambilAksi(db),
      SEKARANG,
    );

    expect(hasil.cashAmount).toBe(0);
  });

  it('aksi COD tidak ditambah lagi kalau payment tunai sudah ada', async () => {
    await seedOrder(db, {
      id: 'order-1',
      status: 'DELIVERED',
      totalCents: 25000,
      updatedAt: HARI_INI_0900,
    });
    await seedPayment(db, {
      id: 'pay-1',
      orderId: 'order-1',
      amountCents: 120000,
      createdAt: HARI_INI_0900,
    });
    await seedAksi(db, {
      id: 'pa-cod',
      actionType: 'collect_cod',
      targetOrderId: 'order-1',
      status: 'pending',
      createdAt: HARI_INI_1000,
    });

    const hasil = deriveDaySummary(
      await ambilOrder(db),
      await ambilPayment(db),
      await ambilAksi(db),
      SEKARANG,
    );

    expect(hasil.cashAmount).toBe(120000);
  });

  it('tanpa data angkanya nol', async () => {
    const hasil = deriveDaySummary([], [], [], SEKARANG);

    expect(hasil.doneCount).toBe(0);
    expect(hasil.cashAmount).toBe(0);
  });
});
