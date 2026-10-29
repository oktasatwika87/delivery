/**
 * Tes aturan tampilan Order Saya: status yang ditampilkan dan lencana
 * sinkronisasi.
 *
 * Baris pending_actions dibuat di database Loki sungguhan karena fungsi ini
 * membaca kolom lewat _getRaw. Dekorator model tidak aktif di Jest, jadi
 * getter status, action_type, dan created_at selalu kosong.
 */

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { schema } from '../db/schema';
import { PendingActionModel } from '../db/models/PendingActionModel';
import { deriveOrderSyncView } from './orderSyncView';

// outbox mengimpor '../db' (adapter SQLite) yang gagal dimuat di Jest.
jest.mock('../db', () => ({ database: {} }));

// Waktu yang dikunci supaya umur aksi basi selalu sama.
const SEKARANG = 1_750_000_000_000;
const SEJAM = 60 * 60 * 1000;

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
    modelClasses: [PendingActionModel],
  });
}

interface IsianAksi {
  id: string;
  actionType: string;
  targetOrderId: string;
  status: string;
  payloadJson?: string;
  createdAt: number;
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

async function ambilAksi(db: Database): Promise<PendingActionModel[]> {
  return db.get<PendingActionModel>('pending_actions').query().fetch();
}

describe('deriveOrderSyncView', () => {
  let db: Database;

  beforeEach(() => {
    db = buatDatabase();
    jest.spyOn(Date, 'now').mockReturnValue(SEKARANG);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('tanpa aksi: status baris dipakai dan lencana kosong', async () => {
    const view = deriveOrderSyncView('PREPARING', await ambilAksi(db));

    expect(view.displayStatus).toBe('PREPARING');
    expect(view.syncState).toBeNull();
  });

  it('satu aksi status antre: status target tampil dan lencana menunggu', async () => {
    await seedAksi(db, {
      id: 'pa-antre',
      actionType: 'update_status',
      targetOrderId: 'order-1',
      status: 'pending',
      payloadJson: '{"status":"DELIVERED"}',
      createdAt: SEKARANG,
    });

    const view = deriveOrderSyncView('PREPARING', await ambilAksi(db));

    expect(view.displayStatus).toBe('DELIVERED');
    expect(view.syncState).toBe('pending');
  });

  it('dua aksi status: yang dibuat paling baru menang', async () => {
    await seedAksi(db, {
      id: 'pa-lama',
      actionType: 'update_status',
      targetOrderId: 'order-1',
      status: 'pending',
      payloadJson: '{"status":"OUT_FOR_DELIVERY"}',
      createdAt: SEKARANG - 1000,
    });
    await seedAksi(db, {
      id: 'pa-baru',
      actionType: 'update_status',
      targetOrderId: 'order-1',
      status: 'syncing',
      payloadJson: '{"status":"DELIVERED"}',
      createdAt: SEKARANG,
    });

    const view = deriveOrderSyncView('PREPARING', await ambilAksi(db));

    expect(view.displayStatus).toBe('DELIVERED');
    expect(view.syncState).toBe('pending');
  });

  it('ada aksi gagal: status baris dipakai, lencana dari aksi aktif lain', async () => {
    await seedAksi(db, {
      id: 'pa-gagal',
      actionType: 'reject',
      targetOrderId: 'order-1',
      status: 'failed',
      createdAt: SEKARANG,
    });
    await seedAksi(db, {
      id: 'pa-antre',
      actionType: 'update_status',
      targetOrderId: 'order-1',
      status: 'pending',
      payloadJson: '{"status":"DELIVERED"}',
      createdAt: SEKARANG,
    });

    const view = deriveOrderSyncView('PREPARING', await ambilAksi(db));

    expect(view.displayStatus).toBe('PREPARING');
    expect(view.syncState).toBe('pending');
  });

  it('COD yatim: status baris dipakai walau ada aksi status antre', async () => {
    await seedAksi(db, {
      id: 'pa-cod-yatim',
      actionType: 'collect_cod',
      targetOrderId: 'order-1',
      status: 'orphaned_needs_review',
      createdAt: SEKARANG,
    });
    await seedAksi(db, {
      id: 'pa-antre',
      actionType: 'update_status',
      targetOrderId: 'order-1',
      status: 'pending',
      payloadJson: '{"status":"DELIVERED"}',
      createdAt: SEKARANG,
    });

    const view = deriveOrderSyncView('PREPARING', await ambilAksi(db));

    expect(view.displayStatus).toBe('PREPARING');
    expect(view.syncState).toBe('pending');
  });

  it('aksi aktif basi: lencana basi', async () => {
    await seedAksi(db, {
      id: 'pa-basi',
      actionType: 'update_status',
      targetOrderId: 'order-1',
      status: 'pending',
      payloadJson: '{"status":"DELIVERED"}',
      createdAt: SEKARANG - SEJAM - 1000,
    });

    const view = deriveOrderSyncView('PREPARING', await ambilAksi(db));

    expect(view.syncState).toBe('stale');
  });

  it('aksi aktif tanpa waktu buat: lencana bukan basi', async () => {
    await seedAksi(db, {
      id: 'pa-tanpa-waktu',
      actionType: 'update_status',
      targetOrderId: 'order-1',
      status: 'pending',
      payloadJson: '{"status":"DELIVERED"}',
      createdAt: 0,
    });

    const view = deriveOrderSyncView('PREPARING', await ambilAksi(db));

    expect(view.syncState).toBe('pending');
  });

  it('hanya aksi gagal: lencana kosong', async () => {
    await seedAksi(db, {
      id: 'pa-gagal',
      actionType: 'reject',
      targetOrderId: 'order-1',
      status: 'failed',
      createdAt: SEKARANG,
    });

    const view = deriveOrderSyncView('PREPARING', await ambilAksi(db));

    expect(view.displayStatus).toBe('PREPARING');
    expect(view.syncState).toBeNull();
  });
});
