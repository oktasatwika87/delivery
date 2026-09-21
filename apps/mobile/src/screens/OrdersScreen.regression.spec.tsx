/**
 * Tes regresi fetchPool di OrdersScreen.
 *
 * Sebelum diperbaiki, fetchPool menulis baris pool dengan kunci camelCase
 * (totalCents, customerId, dst.), padahal kolom skema orders snake_case.
 * sanitizedRaw WatermelonDB hanya menyalin kunci yang namanya sama dengan
 * kolom, jadi sisanya terbuang diam-diam: total_cents, created_at, dan
 * updated_at jadi 0, items_json dan address_json jadi '', sedangkan
 * server_version tidak pernah ditulis. Pola yang benar ada di
 * buildRawRowForCreate (coordinator.ts).
 *
 * Database Loki asli (sinkron, di memori). Yang ditiru hanya jaringan dan
 * modul pendukung layar. Kolom dibaca lewat _getRaw karena dekorator model
 * tidak aktif di Jest. Jalankan dengan --forceExit (timer simpan otomatis Loki).
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import type { Model } from '@nozbe/watermelondb';

import { schema } from '../db/schema';
import { OrderModel } from '../db/models/OrderModel';
import { OrdersScreenBase } from './OrdersScreen';
import type { AvailableOrderItem } from '../sync/client';

// yang ditiru: jaringan dan modul pendukung layar (database tetap asli)
// fetchAvailableOrders ditiru supaya isinya bisa diatur per tes.
// UnauthorizedError dipakai untuk instanceof di catch, jadi kelasnya harus asli.
jest.mock('../sync/client', () => {
  const actual = jest.requireActual('../sync/client');
  return {
    ...actual,
    fetchAvailableOrders: jest.fn(),
  };
});

// navigasi: layar memanggil useNavigation() saat dirender.
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: { children: React.ReactNode }) => children,
  useNavigation: () => ({
    navigate: jest.fn(),
  }),
}));

// lokasi: dipanggil di useEffect saat layar tampil (getLastKnown dan subscribe).
jest.mock('../map/location', () => ({
  locationService: {
    getLastKnown: jest.fn().mockResolvedValue(null),
    subscribe: jest.fn().mockResolvedValue(jest.fn()),
  },
}));

// status jaringan: getStatus() dipanggil saat state dibuat, subscribe di useEffect.
jest.mock('../map/networkMonitor', () => ({
  networkMonitor: {
    getStatus: jest.fn().mockReturnValue('online'),
    subscribe: jest.fn().mockReturnValue(jest.fn()),
  },
}));

// rute: useMemo membuat GraphHopperRoutingProvider. routeService ditiru supaya routeSnapshotService tidak ikut terpanggil.
jest.mock('../map/routing', () => ({
  GraphHopperRoutingProvider: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../map/routeService', () => ({
  RouteService: jest.fn().mockImplementation(() => ({
    getRoute: jest.fn().mockResolvedValue({}),
  })),
}));

// ordersSocket: useEffect berlangganan order:available dan order:unavailable.
jest.mock('../sync/ordersSocket', () => ({
  ordersSocket: {
    onOrderAvailable: jest.fn().mockReturnValue(jest.fn()),
    onOrderUnavailable: jest.fn().mockReturnValue(jest.fn()),
    on: jest.fn().mockReturnValue(jest.fn()),
  },
}));

// syncEvents: useEffect berlangganan orderRemovedFromView.
jest.mock('../sync/syncEvents', () => ({
  syncEvents: {
    emit: jest.fn(),
    on: jest.fn().mockReturnValue(jest.fn()),
    off: jest.fn(),
  },
}));

// outbox: dipakai lewat hasPendingAction dan hasStalePendingAction. Meski tidak dipanggil saat myOrders kosong, mengimpor outbox menarik '../db' (adapter SQLite) yang gagal di Jest, jadi ditiru.
jest.mock('../sync/outbox', () => ({
  hasPendingAction: jest.fn().mockResolvedValue(false),
  hasStalePendingAction: jest.fn().mockResolvedValue(false),
}));

// session: getCurrentUserId diimpor walau tidak dipanggil di tes ini (myOrders kosong). Ditiru supaya token-storage tidak ikut termuat.
jest.mock('../sync/session', () => ({
  getCurrentUserId: jest.fn().mockResolvedValue(null),
  getCurrentToken: jest.fn().mockResolvedValue(null),
}));

// withDatabase dan withObservables dipakai OrdersScreen yang terbungkus. Yang dirender OrdersScreenBase langsung, tapi modul OrdersScreen tetap diimpor dan ekspor terbungkusnya ikut dievaluasi, jadi keduanya ditiru sebagai fungsi identitas supaya tidak butuh konteks.
jest.mock('@nozbe/watermelondb/react', () => ({
  withDatabase: (C: unknown) => C,
  withObservables: (_trigger: unknown, _getObs: unknown) => (C: unknown) => C,
}));

// adapter Loki asli, sinkron di memori (sama seperti spec coordinator)
function buildTestDatabase(): Database {
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
    modelClasses: [OrderModel],
  });
}

// baca kolom snake_case langsung dari _raw
function getColumns(
  tableName: string,
): Array<{ name: string; type: string; isOptional: boolean }> {
  const table = schema.tables[tableName];
  if (!table) throw new Error(`Tabel ${tableName} tidak ada di skema`);
  return table.columnArray.map((c) => ({
    name: c.name,
    type: c.type,
    isOptional: c.isOptional ?? false,
  }));
}

// ubah teks ISO jadi milidetik (null kalau tidak valid).
function parseIsoMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// baca kolom sebagai JSON; melempar galat kalau isinya bukan teks, supaya salah ketik nama kolom langsung ketahuan.
function readJsonColumn(row: Model, columnName: string): unknown {
  const raw = row._getRaw(columnName);
  if (typeof raw !== 'string') {
    throw new Error(`Kolom ${columnName} di _raw bukan string: ${typeof raw}`);
  }
  return JSON.parse(raw);
}

// satu item pool dari server. Nilainya sengaja khas di setiap kolom (totalCents 23000, version 7, createdAt tertentu) supaya kolom yang terbuang diam-diam pasti gagal.
const POOL_ID = 'pool-regression-1';
const POOL_CREATED_AT = '2026-01-15T03:04:05.678Z';
const POOL_ITEM: AvailableOrderItem = {
  orderId: POOL_ID,
  totalCents: 23000,
  currency: 'IDR',
  itemsCount: 2,
  city: 'Kota Uji',
  createdAt: POOL_CREATED_AT,
  version: 7,
};

// waktu yang dikunci untuk Date.now() selama tes: harapan updated_at, dan pengganti created_at kalau createdAt tidak valid.
const FIXED_NOW_MS = 1_750_000_000_000;

// harapan per kolom, diturunkan dari item dan skema, bukan dari keluaran kode. customer_id dan driver_id kosong karena order pool belum punya customer dan driver. items_json '[]' dan address_json '{}' karena item pool tidak membawa daftar barang dan alamat. server_version diambil dari version pada item.
const POOL_ROW_EXPECTED: Record<string, unknown> = {
  customer_id: '',
  driver_id: null,
  status: 'ASSIGNED',
  items_json: '[]',
  address_json: '{}',
  total_cents: 23000,
  currency: 'IDR',
  notes: null,
  server_version: 7,
  deleted_at: null,
  failed_sync_attempts: 0,
  cancelled_by: null,
  cancel_reason: null,
  last_conflict_reason: null,
  last_conflict_at: null,
  created_at: parseIsoMs(POOL_CREATED_AT),
  updated_at: FIXED_NOW_MS,
};

// render OrdersScreenBase dengan item pool tertentu, lalu tunggu fetchPool selesai.
async function renderAndAwaitPool(
  db: Database,
  poolItems: AvailableOrderItem[],
): Promise<void> {
  const client = jest.requireMock('../sync/client') as { fetchAvailableOrders: jest.Mock };
  client.fetchAvailableOrders.mockResolvedValue(poolItems);

  render(<OrdersScreenBase database={db} myOrders={[]} />);
  await waitFor(() => {
    expect(client.fetchAvailableOrders).toHaveBeenCalled();
  });
  if (poolItems.length > 0) {
    await waitFor(async () => {
      const all = await db.get<OrderModel>('orders').query().fetch();
      expect(all.length).toBeGreaterThanOrEqual(poolItems.length);
    });
  } else {
    // tunggu fetchPool selesai (beberapa putaran kosong, lalu muat ulang query).
    await new Promise<void>((resolve) => {
      setTimeout(() => { resolve(); }, 30);
    });
  }
}

// isi baris orders dengan kunci snake_case (untuk kontrol positif dan tes baris yang sudah ada).
async function seedOrderRow(
  db: Database,
  rowId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await db.write(async () => {
    const prepared = db.get<OrderModel>('orders').prepareCreateFromDirtyRaw({
      id: rowId,
      _status: 'synced',
      _changed: '',
      ...fields,
    });
    await db.batch(prepared);
  });
}

describe('OrdersScreen fetchPool - regresi kunci camelCase di prepareCreateFromDirtyRaw', () => {
  let db: Database;

  beforeEach(() => {
    db = buildTestDatabase();
    // kunci Date.now() supaya updated_at dan pengganti created_at pasti.
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // kontrol positif: isi satu baris dengan kunci snake_case dan tipe yang benar, lalu pastikan semua kolom terbaca. Kalau tes utama merah, penyebabnya kode produksi, bukan fungsi pembacanya.
  describe('kontrol positif: isi awal via prepareCreateFromDirtyRaw dengan snake_case', () => {
    it('semua kolom orders terbaca sesuai nilai yang diisi', async () => {
      const seedFields: Record<string, unknown> = {
        customer_id: 'ctrl-cust',
        driver_id: 'ctrl-driver',
        status: 'ASSIGNED',
        items_json: '[]',
        address_json: '{}',
        total_cents: 77000,
        currency: 'IDR',
        notes: null,
        server_version: 0,
        deleted_at: null,
        failed_sync_attempts: 0,
        cancelled_by: null,
        cancel_reason: null,
        last_conflict_reason: null,
        last_conflict_at: null,
        created_at: FIXED_NOW_MS,
        updated_at: FIXED_NOW_MS,
      };

      await seedOrderRow(db, 'order-ctrl-1', seedFields);

      const row = await db.get<OrderModel>('orders').find('order-ctrl-1');
      for (const col of getColumns('orders')) {
        expect(row._getRaw(col.name)).toEqual(seedFields[col.name]);
      }
    });
  });

  describe('fetchPool tulis baris baru untuk satu item', () => {
    beforeEach(async () => {
      await renderAndAwaitPool(db, [POOL_ITEM]);
    });

    it('prasyarat: baris dengan id pool-regression-1 ada di koleksi orders', async () => {
      const found = await db.get<OrderModel>('orders').find(POOL_ID).catch(() => null);
      expect(found).not.toBeNull();
    });

    it.each(getColumns('orders'))(
      'kolom $name terbaca sesuai nilai yang diharapkan',
      async (col) => {
        const row = await db.get<OrderModel>('orders').find(POOL_ID);
        const actual = row._getRaw(col.name);
        const expected = POOL_ROW_EXPECTED[col.name];
        expect({ column: col.name, actual }).toEqual({
          column: col.name,
          actual: expected,
        });
      },
    );

    it('items_json berisi JSON yang bisa diurai jadi daftar kosong (item pool tidak membawa daftar barang)', async () => {
      const row = await db.get<OrderModel>('orders').find(POOL_ID);
      expect(readJsonColumn(row, 'items_json')).toEqual([]);
    });

    it('address_json berisi JSON yang bisa diurai jadi objek kosong (item pool tidak membawa alamat)', async () => {
      const row = await db.get<OrderModel>('orders').find(POOL_ID);
      expect(readJsonColumn(row, 'address_json')).toEqual({});
    });

    it('created_at sama dengan parseIsoMs(createdAt) dari data item server', async () => {
      const row = await db.get<OrderModel>('orders').find(POOL_ID);
      const actual = row._getRaw('created_at');
      const expected = parseIsoMs(POOL_CREATED_AT);
      expect(expected).not.toBeNull();
      expect(actual).toBe(expected);
    });

    it('_status baris hasil fetchPool adalah "synced" dan _changed kosong', async () => {
      const row = await db.get<OrderModel>('orders').find(POOL_ID);
      expect(row._raw._status).toBe('synced');
      expect(row._raw._changed).toBe('');
    });
  });

  describe('fetchPool dengan banyak item sekaligus', () => {
    it('dua item menghasilkan dua baris dengan kolom tidak tercampur', async () => {
      const itemA: AvailableOrderItem = {
        orderId: 'pool-multi-a',
        totalCents: 33000,
        currency: 'IDR',
        itemsCount: 1,
        city: 'Kota A',
        createdAt: '2026-02-01T08:00:00.000Z',
        version: 7,
      };
      const itemB: AvailableOrderItem = {
        orderId: 'pool-multi-b',
        totalCents: 55000,
        currency: 'IDR',
        itemsCount: 3,
        city: 'Kota B',
        createdAt: '2026-02-02T09:30:00.000Z',
        version: 9,
      };
      await renderAndAwaitPool(db, [itemA, itemB]);

      const rowA = await db.get<OrderModel>('orders').find('pool-multi-a');
      const rowB = await db.get<OrderModel>('orders').find('pool-multi-b');

      expect(rowA._getRaw('total_cents')).toBe(33000);
      expect(rowB._getRaw('total_cents')).toBe(55000);
      expect(rowA._getRaw('created_at')).toBe(parseIsoMs('2026-02-01T08:00:00.000Z'));
      expect(rowB._getRaw('created_at')).toBe(parseIsoMs('2026-02-02T09:30:00.000Z'));
      // server_version tidak tercampur antar baris
      expect(rowA._getRaw('server_version')).toBe(7);
      expect(rowB._getRaw('server_version')).toBe(9);
    });
  });

  describe('fetchPool dengan daftar kosong', () => {
    it('tidak menulis baris apa pun ke koleksi orders', async () => {
      await renderAndAwaitPool(db, []);
      const all = await db.get<OrderModel>('orders').query().fetch();
      expect(all).toHaveLength(0);
    });
  });

  describe('fetchPool dengan item id yang sudah ada di DB lokal', () => {
    it('tidak membuat baris duplikat; data baris lama tetap', async () => {
      // isi baris awal dengan data khas.
      await seedOrderRow(db, POOL_ID, {
        customer_id: 'preexisting-cust',
        driver_id: 'preexisting-driver',
        status: 'PREPARING',
        items_json: '[{"id":"preexisting-item"}]',
        address_json: '{"street":"preexisting"}',
        total_cents: 88000,
        currency: 'IDR',
        notes: null,
        server_version: 5,
        deleted_at: null,
        failed_sync_attempts: 0,
        cancelled_by: null,
        cancel_reason: null,
        last_conflict_reason: null,
        last_conflict_at: null,
        created_at: 1700000000000,
        updated_at: 1700000000000,
      });

      // item pool membawa data berbeda. Untuk baris yang sudah ada, kode hanya mengubah _status dan tidak menimpa kolom data.
      const poolItem: AvailableOrderItem = {
        orderId: POOL_ID,
        totalCents: 99000,
        currency: 'IDR',
        itemsCount: 1,
        createdAt: POOL_CREATED_AT,
        version: 7,
      };
      await renderAndAwaitPool(db, [poolItem]);

      const all = await db.get<OrderModel>('orders').query().fetch();
      expect(all).toHaveLength(1);
      const row = all[0];
      expect(row.id).toBe(POOL_ID);
      // data lama tidak ditimpa.
      expect(row._getRaw('customer_id')).toBe('preexisting-cust');
      expect(row._getRaw('driver_id')).toBe('preexisting-driver');
      expect(row._getRaw('total_cents')).toBe(88000);
      expect(row._getRaw('server_version')).toBe(5);
      // _status diubah jadi 'synced' oleh cabang baris yang sudah ada.
      expect(row._raw._status).toBe('synced');
    });
  });

  describe('createdAt tidak valid ("bukan-tanggal") menghasilkan created_at = waktu yang dikunci (mengikuti pola coordinator)', () => {
    it('created_at dan updated_at sama dengan waktu yang dikunci', async () => {
      const item: AvailableOrderItem = {
        orderId: 'pool-invalid-createdat',
        totalCents: 11000,
        currency: 'IDR',
        itemsCount: 1,
        createdAt: 'bukan-tanggal',
        version: 7,
      };
      await renderAndAwaitPool(db, [item]);

      const row = await db.get<OrderModel>('orders').find('pool-invalid-createdat');
      expect(row._getRaw('created_at')).toBe(FIXED_NOW_MS);
      expect(row._getRaw('updated_at')).toBe(FIXED_NOW_MS);
    });
  });
});
