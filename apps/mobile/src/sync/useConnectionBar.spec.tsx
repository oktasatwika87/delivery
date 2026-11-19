/**
 * Tes hook data bilah koneksi.
 *
 * Database-nya Loki sungguhan, jadi perubahan status aksi benar-benar
 * membuat angka pada hook ikut berubah.
 */

import { act, renderHook } from '@testing-library/react-native';
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { Observable } from 'rxjs';
import type { Subscription } from 'rxjs';

import * as driverQueries from '../db/driverQueries';
import { schema } from '../db/schema';
import { PendingActionModel } from '../db/models/PendingActionModel';
import type { NetworkStatus } from '../map/networkMonitor';
import { useConnectionBar } from './useConnectionBar';

jest.mock('../map/networkMonitor', () => ({
  networkMonitor: {
    getStatus: jest.fn(),
    subscribe: jest.fn(),
  },
}));

const allActionsQueryAsli = driverQueries.allActionsQuery;

const SEKARANG = 1_750_000_000_000;

interface MonitorTiruan {
  getStatus: jest.Mock<NetworkStatus, []>;
  subscribe: jest.Mock<() => void, [(status: NetworkStatus) => void]>;
}

function monitorTiruan(): MonitorTiruan {
  const modul = jest.requireMock('../map/networkMonitor') as { networkMonitor: MonitorTiruan };
  return modul.networkMonitor;
}

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
  status: string;
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
        created_at: SEKARANG,
        updated_at: SEKARANG,
      });
    await db.batch(prepared);
  });
}

async function ubahStatusAksi(db: Database, id: string, status: string): Promise<void> {
  await db.write(async () => {
    const model = await db.get<PendingActionModel>('pending_actions').find(id);
    const prepared = model.prepareUpdate((row) => {
      row._setRaw('status', status);
    });
    await db.batch(prepared);
  });
}

// Beri waktu database selesai memberi tahu perubahan ke langganan.
async function tungguEmisi(): Promise<void> {
  await act(async () => {
    await new Promise((selesai) => setTimeout(selesai, 50));
  });
}

describe('hook data bilah koneksi', () => {
  let db: Database;
  let langgananTertangkap: Subscription | null;

  beforeEach(() => {
    db = buatDatabase();
    langgananTertangkap = null;
    monitorTiruan().getStatus.mockReset();
    monitorTiruan().getStatus.mockReturnValue('online');
    monitorTiruan().subscribe.mockReset();
    monitorTiruan().subscribe.mockImplementation(() => () => {});
    // Kueri asli dibungkus supaya langganannya bisa dicek saat hook dilepas.
    jest
      .spyOn(driverQueries, 'allActionsQuery')
      .mockImplementation((database: Database) =>
        new Observable<PendingActionModel[]>((observer) => {
          const subscription = allActionsQueryAsli(database).subscribe({
            next: (actions) => observer.next(actions),
            error: (galat) => observer.error(galat),
            complete: () => observer.complete(),
          });
          langgananTertangkap = subscription;
          return () => {
            subscription.unsubscribe();
          };
        }),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('hitungan mengikuti aksi di database', async () => {
    await seedAksi(db, { id: 'pa-1', status: 'pending' });
    await seedAksi(db, { id: 'pa-2', status: 'pending' });
    await seedAksi(db, { id: 'pa-3', status: 'failed' });

    const { result } = renderHook(() => useConnectionBar(db));
    await tungguEmisi();

    expect(result.current.pendingCount).toBe(2);
    expect(result.current.failedCount).toBe(1);
  });

  it('angka ikut berubah saat aksi ditolak server', async () => {
    await seedAksi(db, { id: 'pa-1', status: 'pending' });
    await seedAksi(db, { id: 'pa-2', status: 'pending' });
    await seedAksi(db, { id: 'pa-3', status: 'failed' });

    const { result } = renderHook(() => useConnectionBar(db));
    await tungguEmisi();

    await act(async () => {
      await ubahStatusAksi(db, 'pa-1', 'failed');
    });
    await tungguEmisi();

    expect(result.current.pendingCount).toBe(1);
    expect(result.current.failedCount).toBe(2);
  });

  it('hook tidak digambar ulang saat angkanya tetap sama', async () => {
    await seedAksi(db, { id: 'pa-1', status: 'pending' });

    let jumlahRender = 0;
    const { result } = renderHook(() => {
      jumlahRender += 1;
      return useConnectionBar(db);
    });
    await tungguEmisi();

    const renderSebelum = jumlahRender;

    await act(async () => {
      await ubahStatusAksi(db, 'pa-1', 'syncing');
    });
    await tungguEmisi();

    expect(result.current.pendingCount).toBe(1);
    expect(jumlahRender).toBe(renderSebelum);
  });

  it('status mengikuti monitor jaringan', () => {
    monitorTiruan().getStatus.mockReturnValue('offline');

    const { result } = renderHook(() => useConnectionBar(db));

    expect(result.current.status).toBe('offline');
  });

  it('langganan ditutup saat hook dilepas', async () => {
    await seedAksi(db, { id: 'pa-1', status: 'pending' });

    const { unmount } = renderHook(() => useConnectionBar(db));
    await tungguEmisi();

    unmount();

    expect(langgananTertangkap?.closed).toBe(true);

    // Perubahan setelah hook dilepas tidak boleh menyentuh apa pun.
    await ubahStatusAksi(db, 'pa-1', 'failed');
    await tungguEmisi();

    expect(langgananTertangkap?.closed).toBe(true);
  });
});
