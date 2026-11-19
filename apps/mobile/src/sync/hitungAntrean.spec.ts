/**
 * Tes hitungan antrean untuk bilah koneksi.
 *
 * Baris pending_actions dibuat di database Loki sungguhan karena statusnya
 * dibaca lewat _getRaw.
 */

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { schema } from '../db/schema';
import { PendingActionModel } from '../db/models/PendingActionModel';
import { hitungAntrean } from './hitungAntrean';

// outbox mengimpor '../db' (adapter SQLite) yang gagal dimuat di Jest.
jest.mock('../db', () => ({ database: {} }));

const SEKARANG = 1_750_000_000_000;

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
        payload_json: '',
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

describe('hitungan antrean bilah koneksi', () => {
  let db: Database;

  beforeEach(() => {
    db = buatDatabase();
  });

  it('tanpa aksi jumlahnya nol', async () => {
    const hasil = hitungAntrean(await ambilAksi(db));

    expect(hasil.pendingCount).toBe(0);
    expect(hasil.failedCount).toBe(0);
  });

  it('aksi antre dan aksi ditolak dihitung terpisah', async () => {
    await seedAksi(db, {
      id: 'pa-antre',
      actionType: 'update_status',
      targetOrderId: 'order-1',
      status: 'pending',
      createdAt: SEKARANG,
    });
    await seedAksi(db, {
      id: 'pa-masih-dikirim',
      actionType: 'update_status',
      targetOrderId: 'order-1',
      status: 'syncing',
      createdAt: SEKARANG,
    });
    await seedAksi(db, {
      id: 'pa-gagal',
      actionType: 'reject',
      targetOrderId: 'order-1',
      status: 'failed',
      createdAt: SEKARANG,
    });
    await seedAksi(db, {
      id: 'pa-cod-yatim',
      actionType: 'collect_cod',
      targetOrderId: 'order-1',
      status: 'orphaned_needs_review',
      createdAt: SEKARANG,
    });

    const hasil = hitungAntrean(await ambilAksi(db));

    expect(hasil.pendingCount).toBe(2);
    expect(hasil.failedCount).toBe(2);
  });
});
