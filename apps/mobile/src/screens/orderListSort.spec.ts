/**
 * Tes urutan daftar order.
 *
 * Baris order dan baris pending_actions dibuat di database Loki sungguhan,
 * karena pembaca kolomnya lewat _getRaw.
 */

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { schema } from '../db/schema';
import { OrderModel } from '../db/models/OrderModel';
import { PendingActionModel } from '../db/models/PendingActionModel';
import { sortMyOrders, sortPoolOrders } from './orderListSort';

// outbox mengimpor '../db' (adapter SQLite) yang gagal dimuat di Jest.
jest.mock('../db', () => ({ database: {} }));

const HARI = 24 * 60 * 60 * 1000;

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
    modelClasses: [OrderModel, PendingActionModel],
  });
}

interface IsianOrder {
  id: string;
  status: string;
  createdAt: number;
  updatedAt?: number;
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
      total_cents: 25000,
      currency: 'IDR',
      notes: null,
      server_version: 1,
      deleted_at: null,
      failed_sync_attempts: 0,
      cancelled_by: null,
      cancel_reason: null,
      last_conflict_reason: null,
      last_conflict_at: null,
      created_at: isi.createdAt,
      updated_at: isi.updatedAt ?? isi.createdAt,
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

async function ambilAksi(db: Database): Promise<PendingActionModel[]> {
  return db.get<PendingActionModel>('pending_actions').query().fetch();
}

describe('sortMyOrders', () => {
  let db: Database;

  beforeEach(() => {
    db = buatDatabase();
  });

  it('order aktif di atas walau dibuat lebih dulu', async () => {
    await seedOrder(db, { id: 'order-aktif', status: 'PREPARING', createdAt: HARI });
    await seedOrder(db, { id: 'order-selesai', status: 'DELIVERED', createdAt: 2 * HARI });
    const semua = await ambilOrder(db);

    const urut = sortMyOrders(semua, new Map());

    expect(urut.map((row) => row.id)).toEqual(['order-aktif', 'order-selesai']);
  });

  it('dalam kelompok order dibuat paling baru dulu', async () => {
    await seedOrder(db, { id: 'order-satu', status: 'DELIVERED', createdAt: HARI });
    await seedOrder(db, { id: 'order-dua', status: 'DELIVERED', createdAt: 3 * HARI });
    await seedOrder(db, { id: 'order-tiga', status: 'DELIVERED', createdAt: 2 * HARI });
    const semua = await ambilOrder(db);

    const urut = sortMyOrders(semua, new Map());

    expect(urut.map((row) => row.id)).toEqual(['order-dua', 'order-tiga', 'order-satu']);
  });

  it('waktu sama diputus id naik', async () => {
    await seedOrder(db, { id: 'order-b', status: 'DELIVERED', createdAt: HARI });
    await seedOrder(db, { id: 'order-a', status: 'DELIVERED', createdAt: HARI });
    const semua = await ambilOrder(db);

    const urut = sortMyOrders(semua, new Map());

    expect(urut.map((row) => row.id)).toEqual(['order-a', 'order-b']);
  });

  it('aksi selesai diantar yang antre memindah order ke kelompok bawah', async () => {
    await seedOrder(db, { id: 'order-aktif', status: 'PREPARING', createdAt: 2 * HARI });
    await seedOrder(db, { id: 'order-antre', status: 'PREPARING', createdAt: HARI });
    await seedOrder(db, { id: 'order-selesai', status: 'DELIVERED', createdAt: 3 * HARI });
    await seedAksi(db, {
      id: 'pa-antre',
      actionType: 'update_status',
      targetOrderId: 'order-antre',
      status: 'pending',
      payloadJson: '{"status":"DELIVERED"}',
      createdAt: HARI,
    });
    const semua = await ambilOrder(db);
    const aksi = await ambilAksi(db);
    const petaAksi = new Map<string, PendingActionModel[]>([['order-antre', aksi]]);

    const urut = sortMyOrders(semua, petaAksi);

    expect(urut.map((row) => row.id)).toEqual([
      'order-aktif',
      'order-selesai',
      'order-antre',
    ]);
  });

  it('aksi yang ditolak server mengembalikan order ke kelompok aktif', async () => {
    await seedOrder(db, { id: 'order-gagal', status: 'PREPARING', createdAt: HARI });
    await seedOrder(db, { id: 'order-selesai', status: 'DELIVERED', createdAt: 2 * HARI });
    await seedAksi(db, {
      id: 'pa-gagal',
      actionType: 'update_status',
      targetOrderId: 'order-gagal',
      status: 'failed',
      payloadJson: '{"status":"DELIVERED"}',
      createdAt: HARI,
    });
    const semua = await ambilOrder(db);
    const aksi = await ambilAksi(db);
    const petaAksi = new Map<string, PendingActionModel[]>([['order-gagal', aksi]]);

    const urut = sortMyOrders(semua, petaAksi);

    expect(urut.map((row) => row.id)).toEqual(['order-gagal', 'order-selesai']);
  });

  it('updated_at baru tidak mengubah urutan', async () => {
    await seedOrder(db, {
      id: 'order-lama',
      status: 'DELIVERED',
      createdAt: HARI,
      updatedAt: 99 * HARI,
    });
    await seedOrder(db, { id: 'order-baru', status: 'DELIVERED', createdAt: 2 * HARI });
    const semua = await ambilOrder(db);

    const urut = sortMyOrders(semua, new Map());

    expect(urut.map((row) => row.id)).toEqual(['order-baru', 'order-lama']);
  });

  it('larik masukan tidak diubah', async () => {
    await seedOrder(db, { id: 'order-aktif', status: 'PREPARING', createdAt: HARI });
    await seedOrder(db, { id: 'order-selesai', status: 'DELIVERED', createdAt: 2 * HARI });
    const semua = await ambilOrder(db);
    const masukan = [...semua];
    const salinan = [...semua];

    const urut = sortMyOrders(masukan, new Map());

    expect(masukan).toEqual(salinan);
    expect(urut).not.toBe(masukan);
  });
});

describe('sortPoolOrders', () => {
  let db: Database;

  beforeEach(() => {
    db = buatDatabase();
  });

  it('order dibuat paling baru dulu', async () => {
    await seedOrder(db, { id: 'order-lama', status: 'ASSIGNED', createdAt: HARI });
    await seedOrder(db, { id: 'order-baru', status: 'ASSIGNED', createdAt: 2 * HARI });
    const semua = await ambilOrder(db);

    const urut = sortPoolOrders(semua);

    expect(urut.map((row) => row.id)).toEqual(['order-baru', 'order-lama']);
    expect(semua.map((row) => row.id)).toEqual(['order-lama', 'order-baru']);
  });
});
