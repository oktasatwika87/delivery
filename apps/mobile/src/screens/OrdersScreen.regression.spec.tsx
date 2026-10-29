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
import { Alert } from 'react-native';
import { render, waitFor } from '@testing-library/react-native';
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import type { Model } from '@nozbe/watermelondb';

import { schema } from '../db/schema';
import { OrderModel } from '../db/models/OrderModel';
import { PendingActionModel } from '../db/models/PendingActionModel';
import { OrdersScreenBase } from './OrdersScreen';
import { ApiError } from '../sync/client';
import type { AvailableOrderItem } from '../sync/client';

// yang ditiru: jaringan dan modul pendukung layar (database tetap asli)
// fetchAvailableOrders ditiru supaya isinya bisa diatur per tes.
// UnauthorizedError dipakai untuk instanceof di catch, jadi kelasnya harus asli.
// acceptOrder juga di-mock di level modul untuk tes handleAccept.
jest.mock('../sync/client', () => {
  const actual = jest.requireActual('../sync/client');
  return {
    ...actual,
    fetchAvailableOrders: jest.fn(),
    acceptOrder: jest.fn(),
  };
});

// navigasi: layar memanggil useNavigation() saat dirender.
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: { children: React.ReactNode }) => children,
  useNavigation: () => ({
    navigate: jest.fn(),
  }),
}));

// Alert: dipanggil handleAccept saat perlu minta koneksi atau error.
jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native') as Record<string, any>;
  return {
    ...RN,
    Alert: {
      alert: jest.fn(),
    },
  };
});

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

// syncEvents: dipakai layar untuk pool-refresh.
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
    modelClasses: [OrderModel, PendingActionModel],
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

// harapan per kolom, diturunkan dari item dan skema, bukan dari keluaran kode. customer_id dan driver_id kosong karena order pool belum punya customer dan driver. items_json '[]' karena item pool tidak membawa daftar barang. address_json hanya berisi kota dari server, tanpa alamat lengkap. server_version diambil dari version pada item.
const POOL_ROW_EXPECTED: Record<string, unknown> = {
  customer_id: '',
  driver_id: null,
  status: 'ASSIGNED',
  items_json: '[]',
  address_json: JSON.stringify({ city: 'Kota Uji' }),
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
// hasMore default false (pool habis setelah fetch ini).
async function renderAndAwaitPool(
  db: Database,
  poolItems: AvailableOrderItem[],
  hasMore = false,
): Promise<void> {
  const client = jest.requireMock('../sync/client') as { fetchAvailableOrders: jest.Mock };
  client.fetchAvailableOrders.mockResolvedValue({ items: poolItems, hasMore });

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

    it('address_json berisi JSON yang bisa diurai jadi objek dengan kota saja dari server (item pool tidak membawa alamat lengkap)', async () => {
      const row = await db.get<OrderModel>('orders').find(POOL_ID);
      expect(readJsonColumn(row, 'address_json')).toEqual({ city: 'Kota Uji' });
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

  describe('fetchPool dengan kota yang tidak ada atau spasi saja', () => {
    it('item tanpa city: address_json tetap objek kosong', async () => {
      const item: AvailableOrderItem = {
        orderId: 'pool-tanpa-kota',
        totalCents: 12000,
        currency: 'IDR',
        itemsCount: 1,
        createdAt: '2026-03-01T00:00:00.000Z',
        version: 1,
      };
      await renderAndAwaitPool(db, [item]);

      const row = await db.get<OrderModel>('orders').find('pool-tanpa-kota');
      expect(readJsonColumn(row, 'address_json')).toEqual({});
    });

    it('item dengan city spasi saja: address_json tetap objek kosong', async () => {
      const item: AvailableOrderItem = {
        orderId: 'pool-kota-spasi',
        totalCents: 13000,
        currency: 'IDR',
        itemsCount: 1,
        city: '   ',
        createdAt: '2026-03-02T00:00:00.000Z',
        version: 1,
      };
      await renderAndAwaitPool(db, [item]);

      const row = await db.get<OrderModel>('orders').find('pool-kota-spasi');
      expect(readJsonColumn(row, 'address_json')).toEqual({});
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
    it('tidak membuat baris duplikat; data baris lama tetap; baris non-pool tidak disentuh', async () => {
      // Seed baris NON-pool (driver_id terisi): fetchPool tidak menyentuh baris non-pool
      // sama sekali (pool row = driver_id kosong, _status synced, tanpa pending action).
      await seedOrderRow(db, POOL_ID, {
        customer_id: 'preexisting-cust',
        driver_id: 'preexisting-driver', // bukan pool row
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

      // Server mengirim data pool untuk id yang sama.
      const poolItem: AvailableOrderItem = {
        orderId: POOL_ID,
        totalCents: 99000,
        currency: 'IDR',
        itemsCount: 1,
        city: 'Kota Server',
        createdAt: POOL_CREATED_AT,
        version: 7,
      };
      await renderAndAwaitPool(db, [poolItem]);

      const all = await db.get<OrderModel>('orders').query().fetch();
      expect(all).toHaveLength(1);
      const row = all[0];
      expect(row.id).toBe(POOL_ID);
      // Data lama TIDAK ditimpa (perilaku baru: non-pool rows tidak disentuh).
      expect(row._getRaw('customer_id')).toBe('preexisting-cust');
      expect(row._getRaw('driver_id')).toBe('preexisting-driver');
      expect(row._getRaw('total_cents')).toBe(88000);
      expect(row._getRaw('server_version')).toBe(5);
      // alamat dan barang baris lama tidak ditulis ulang dari kota server
      expect(row._getRaw('address_json')).toBe('{"street":"preexisting"}');
      expect(row._getRaw('items_json')).toBe('[{"id":"preexisting-item"}]');
      // _status tidak berubah (tetap seeded value, fetchPool tidak menyentuh non-pool).
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

// Tujuh tes regresi untuk fetchPool dengan hasMore
// Pola: seed baris pool lama, panggil fetchPool, assert hasil.
// Pakai Loki adapter asli (sama dengan tes regresi yang sudah ada).
describe('fetchPool -tes regresi dengan hasMore', () => {
  let db: Database;

  beforeEach(() => {
    db = buildTestDatabase();
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Helper: seed satu baris pool ke DB lokal.
  async function seedPoolRow(
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

  // Helper: seed satu baris order milik driver (bukan pool).
  async function seedDriverRow(
    rowId: string,
    driverId: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    await db.write(async () => {
      const prepared = db.get<OrderModel>('orders').prepareCreateFromDirtyRaw({
        id: rowId,
        _status: 'synced',
        _changed: '',
        driver_id: driverId,
        ...fields,
      });
      await db.batch(prepared);
    });
  }

  // Helper: cek apakah baris ada di adapter (cek dirty records).
  async function rowExistsInAdapter(rowId: string): Promise<boolean> {
    try {
      await db.get<OrderModel>('orders').find(rowId);
      return true;
    } catch {
      return false;
    }
  }

  // Helper: cek apakah baris akan di-push oleh collectDirty.
  // Baris dengan _status 'synced' dan _changed '' tidak akan di-push.
  async function willBePushed(rowId: string): Promise<boolean> {
    try {
      const row = await db.get<OrderModel>('orders').find(rowId);
      return row._raw._status !== 'synced' || row._raw._changed !== '';
    } catch {
      return false;
    }
  }

  const defaultRowFields = {
    customer_id: '',
    driver_id: null,
    status: 'ASSIGNED',
    items_json: '[]',
    address_json: '{}',
    total_cents: 55000,
    currency: 'IDR',
    notes: null,
    server_version: 3,
    deleted_at: null,
    failed_sync_attempts: 0,
    cancelled_by: null,
    cancel_reason: null,
    last_conflict_reason: null,
    last_conflict_at: null,
    created_at: 1_600_000_000_000,
    updated_at: 1_600_000_000_000,
  };

  // Tes 1: baris pool versi lama diperbarui oleh server data baru.
  describe('tes 1: baris pool versi lama diperbarui dari data server', () => {
    it('server_version, total_cents, currency, status, updated_at diperbarui; created_at tidak berubah; _status synced dan _changed kosong', async () => {
      const rowId = 'pool-t1-1';
      await seedPoolRow(rowId, {
        ...defaultRowFields,
        total_cents: 55000,
        currency: 'IDR',
        server_version: 3,
        created_at: 1_600_000_000_000,
        updated_at: 1_600_000_000_000,
      });

      const updatedItem: AvailableOrderItem = {
        orderId: rowId,
        totalCents: 77000,
        currency: 'SGD',
        itemsCount: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        version: 9,
      };
      await renderAndAwaitPool(db, [updatedItem]);

      const row = await db.get<OrderModel>('orders').find(rowId);
      // Kolom yang boleh berubah
      expect(row._getRaw('server_version')).toBe(9);
      expect(row._getRaw('total_cents')).toBe(77000);
      expect(row._getRaw('currency')).toBe('SGD');
      expect(row._getRaw('status')).toBe('ASSIGNED');
      expect(row._getRaw('updated_at')).toBe(FIXED_NOW_MS);
      // created_at TIDAK berubah
      expect(row._getRaw('created_at')).toBe(1_600_000_000_000);
      // _status synced dan _changed kosong
      expect(row._raw._status).toBe('synced');
      expect(row._raw._changed).toBe('');
      // Tidak di-push
      expect(await willBePushed(rowId)).toBe(false);
    });
  });

  // Tes 1b: baris pool yang sudah ada ditulis ulang dari kota server.
  // Alamat lengkap dan barang lama harus hilang, created_at dan customer_id tetap.
  describe('tes 1b: baris pool yang sudah ada ditulis ulang dari kota server', () => {
    it('address_json jadi hanya kota dari server, items_json jadi [], created_at dan customer_id tetap', async () => {
      const rowId = 'pool-t1b-1';
      await seedPoolRow(rowId, {
        ...defaultRowFields,
        customer_id: 'cust-tetap',
        address_json: '{"street":"Jl. Lama 1","city":"Badung"}',
        items_json: '[{"name":"Lama"}]',
        created_at: 1_600_000_000_000,
        updated_at: 1_600_000_000_000,
      });

      const updatedItem: AvailableOrderItem = {
        orderId: rowId,
        totalCents: 77000,
        currency: 'IDR',
        itemsCount: 1,
        city: 'Denpasar',
        createdAt: '2026-01-01T00:00:00.000Z',
        version: 9,
      };
      await renderAndAwaitPool(db, [updatedItem]);

      const row = await db.get<OrderModel>('orders').find(rowId);
      expect(readJsonColumn(row, 'address_json')).toEqual({ city: 'Denpasar' });
      expect(readJsonColumn(row, 'items_json')).toEqual([]);
      expect(row._getRaw('created_at')).toBe(1_600_000_000_000);
      expect(row._getRaw('customer_id')).toBe('cust-tetap');
      // baris pool hasil tulis ulang tetap synced dan tidak akan di-push
      expect(row._raw._status).toBe('synced');
      expect(row._raw._changed).toBe('');
    });
  });

  // Tes 2: baris pool yang hilang dari daftar (hasMore false) terhapus permanen.
  describe('tes 2: baris pool yang hilang dari daftar (hasMore false) dihapus permanen', () => {
    it('baris tidak ada di adapter setelah fetchPool dan tidak akan di-push', async () => {
      const existingRowId = 'pool-t2-existing';
      const goneRowId = 'pool-t2-gone';
      await seedPoolRow(existingRowId, defaultRowFields);
      await seedPoolRow(goneRowId, defaultRowFields);

      // Server hanya kirim existingRowId, goneRowId tidak ada di daftar
      const serverItems: AvailableOrderItem[] = [
        {
          orderId: existingRowId,
          totalCents: 55000,
          currency: 'IDR',
          itemsCount: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          version: 5,
        },
      ];
      await renderAndAwaitPool(db, serverItems, false);

      // existingRowId masih ada
      expect(await rowExistsInAdapter(existingRowId)).toBe(true);
      // goneRowId tidak ada (destroyPermanently, bukan soft delete)
      expect(await rowExistsInAdapter(goneRowId)).toBe(false);
    });
  });

  // Tes 3: baris milik driver ini (driver_id terisi) tidak disentuh fetchPool.
  describe('tes 3: baris milik driver lain tidak disentuh oleh fetchPool', () => {
    it('baris driver_id terisi tidak berubah meskipun id-nya tidak ada di daftar server', async () => {
      const driverRowId = 'driver-t3-1';
      const driverRowFields = {
        ...defaultRowFields,
        driver_id: 'driver-456',
        total_cents: 99000,
        status: 'PREPARING',
        server_version: 11,
        created_at: 1_700_000_000_000,
        updated_at: 1_700_000_000_000,
      };
      await seedDriverRow(driverRowId, 'driver-456', driverRowFields);

      // Server kirim daftar kosong (pool habis), hasMore false
      await renderAndAwaitPool(db, [], false);

      // Baris driver tetap persis seperti sebelumnya
      const row = await db.get<OrderModel>('orders').find(driverRowId);
      expect(row._getRaw('driver_id')).toBe('driver-456');
      expect(row._getRaw('total_cents')).toBe(99000);
      expect(row._getRaw('status')).toBe('PREPARING');
      expect(row._getRaw('server_version')).toBe(11);
      expect(row._getRaw('created_at')).toBe(1_700_000_000_000);
      expect(row._getRaw('updated_at')).toBe(1_700_000_000_000);
      expect(row._raw._status).toBe('synced');
    });
  });

  // Tes 4: baris pool dengan pending action tidak disentuh.
  describe('tes 4: baris pool dengan pending action tidak disentuh', () => {
    it('baris pool dengan pending action tidak diperbarui dan tidak dihapus', async () => {
      const pendingRowId = 'pool-t4-pending';
      await seedPoolRow(pendingRowId, {
        ...defaultRowFields,
        total_cents: 33000,
        address_json: '{"street":"Jl. Lama 1","city":"Badung"}',
        items_json: '[{"name":"Lama"}]',
        server_version: 2,
        created_at: 1_500_000_000_000,
        updated_at: 1_500_000_000_000,
      });

      // Satu aksi 'pending' untuk baris ini di pending_actions. fetchPool
      // tidak menyentuh baris yang punya aksi outbox berstatus apa pun.
      await db.write(async () => {
        const prepared = db
          .get<PendingActionModel>('pending_actions')
          .prepareCreateFromDirtyRaw({
            id: 'pa-t4-pending',
            _status: 'synced',
            _changed: '',
            action_type: 'update_status',
            target_order_id: pendingRowId,
            expected_version: 2,
            idempotency_key: 'status:t4-pending:OUT_FOR_DELIVERY',
            payload_json: '{"status":"OUT_FOR_DELIVERY"}',
            status: 'pending',
            created_at: 1_500_000_000_000,
            updated_at: 1_500_000_000_000,
          });
        await db.batch(prepared);
      });

      // Server kirim data baru untuk row ini
      const serverItems: AvailableOrderItem[] = [
        {
          orderId: pendingRowId,
          totalCents: 77000,
          currency: 'IDR',
          itemsCount: 1,
          city: 'Denpasar',
          createdAt: '2026-01-01T00:00:00.000Z',
          version: 8,
        },
      ];
      await renderAndAwaitPool(db, serverItems, false);

      // Baris pool tetap seperti data lama (tidak diperbarui)
      const row = await db.get<OrderModel>('orders').find(pendingRowId);
      expect(row._getRaw('total_cents')).toBe(33000); // tidak berubah
      expect(row._getRaw('server_version')).toBe(2);  // tidak berubah
      expect(row._getRaw('updated_at')).toBe(1_500_000_000_000); // tidak berubah
      // alamat dan barang lama tidak ditulis ulang
      expect(row._getRaw('address_json')).toBe('{"street":"Jl. Lama 1","city":"Badung"}');
      expect(row._getRaw('items_json')).toBe('[{"name":"Lama"}]');
      expect(row._raw._status).toBe('synced');
    });
  });

  // Tes 5: baris belum tersinkron tidak dipaksa synced dan tidak ditimpa datanya.
  describe('tes 5: baris _status bukan synced tidak dipaksa synced dan tidak ditimpa', () => {
    it('baris pool dengan _status updated tidak dipaksa synced dan total_cents tidak berubah', async () => {
      const dirtyRowId = 'pool-t5-dirty';
      await db.write(async () => {
        const prepared = db.get<OrderModel>('orders').prepareCreateFromDirtyRaw({
          id: dirtyRowId,
          _status: 'updated',  // BUKAN synced, ada perubahan lokal
          _changed: '',
          ...defaultRowFields,
          total_cents: 44000,   // nilai lokal yang berbeda
          address_json: '{"street":"Jl. Lama 1","city":"Badung"}',
          items_json: '[{"name":"Lama"}]',
          server_version: 2,
          created_at: 1_500_000_000_000,
          updated_at: 1_500_000_000_000,
        });
        await db.batch(prepared);
      });

      const serverItems: AvailableOrderItem[] = [
        {
          orderId: dirtyRowId,
          totalCents: 88000,  // nilai server berbeda
          currency: 'IDR',
          itemsCount: 1,
          city: 'Denpasar',
          createdAt: '2026-01-01T00:00:00.000Z',
          version: 7,
        },
      ];
      await renderAndAwaitPool(db, serverItems, false);

      const row = await db.get<OrderModel>('orders').find(dirtyRowId);
      // _status TIDAK berubah jadi synced
      expect(row._raw._status).toBe('updated');
      // total_cents lokal TIDAK ditimpa server
      expect(row._getRaw('total_cents')).toBe(44000);
      // alamat dan barang lokal TIDAK ditulis ulang dari kota server
      expect(row._getRaw('address_json')).toBe('{"street":"Jl. Lama 1","city":"Badung"}');
      expect(row._getRaw('items_json')).toBe('[{"name":"Lama"}]');
    });
  });

  // Tes 6: fetch gagal tidak mengubah apa pun.
  describe('tes 6: fetch gagal tidak mengubah baris pool', () => {
    it('fetch yang gagal (network error) tidak mengubah, tidak menghapus, tidak menambah baris', async () => {
      const existingRowId = 'pool-t6-1';
      const anotherRowId = 'pool-t6-2';
      await seedPoolRow(existingRowId, defaultRowFields);
      await seedPoolRow(anotherRowId, defaultRowFields);

      // Mock fetchAvailableOrders melempar error
      const client = jest.requireMock('../sync/client') as { fetchAvailableOrders: jest.Mock };
      client.fetchAvailableOrders.mockRejectedValue(new Error('Network error'));

      render(<OrdersScreenBase database={db} myOrders={[]} />);
      // fetchPool gagal di catch, tidak ada batch. Tapi tetap tunggu 1 tick agar efek cleanup selesai.
      await new Promise<void>((resolve) => { setImmediate(resolve); });

      // Semua baris pool tetap ada dan tidak berubah
      expect(await rowExistsInAdapter(existingRowId)).toBe(true);
      expect(await rowExistsInAdapter(anotherRowId)).toBe(true);
      const row = await db.get<OrderModel>('orders').find(existingRowId);
      expect(row._getRaw('total_cents')).toBe(55000);
      expect(row._getRaw('server_version')).toBe(3);
      expect(row._raw._status).toBe('synced');
    });
  });

  // Tes 7: hasMore true, baris yang hilang dari daftar TIDAK dihapus.
  describe('tes 7: hasMore true, baris pool yang tidak ada di daftar server tidak dihapus', () => {
    it('hasMore true: baris pool yang hilang TIDAK dihapus; baris yang ada diperbarui; baris baru ditambahkan', async () => {
      const existingRowId = 'pool-t7-existing';
      const goneRowId = 'pool-t7-gone';
      const newRowId = 'pool-t7-new';
      await seedPoolRow(existingRowId, {
        ...defaultRowFields,
        total_cents: 33000,
        server_version: 2,
        created_at: 1_500_000_000_000,
        updated_at: 1_500_000_000_000,
      });
      await seedPoolRow(goneRowId, defaultRowFields);

      // Server kirim: existingRowId (harus diperbarui) + newRowId (baru ditambahkan)
      // goneRowId TIDAK ada di daftar, hasMore true, jadi TIDAK dihapus
      const serverItems: AvailableOrderItem[] = [
        {
          orderId: existingRowId,
          totalCents: 88000,
          currency: 'IDR',
          itemsCount: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          version: 7,
        },
        {
          orderId: newRowId,
          totalCents: 22000,
          currency: 'IDR',
          itemsCount: 2,
          createdAt: '2026-02-01T00:00:00.000Z',
          version: 1,
        },
      ];
      await renderAndAwaitPool(db, serverItems, true);

      // existingRowId diperbarui
      const existingRow = await db.get<OrderModel>('orders').find(existingRowId);
      expect(existingRow._getRaw('total_cents')).toBe(88000);
      expect(existingRow._getRaw('server_version')).toBe(7);
      expect(existingRow._raw._status).toBe('synced');

      // goneRowId MASIH ADA (tidak dihapus karena hasMore true)
      expect(await rowExistsInAdapter(goneRowId)).toBe(true);

      // newRowId ditambahkan
      expect(await rowExistsInAdapter(newRowId)).toBe(true);
      const newRow = await db.get<OrderModel>('orders').find(newRowId);
      expect(newRow._getRaw('total_cents')).toBe(22000);
      expect(newRow._raw._status).toBe('synced');
    });
  });

  // Tes 8: baris driver_id kosong tapi status BUKAN ASSIGNED (misal CONFIRMED) tidak disentuh.
  describe('tes 8: baris driver_id kosong tapi status CONFIRMED tidak disentuh oleh fetchPool', () => {
    it('baris dengan driver_id null dan status CONFIRMED tidak diperbarui dan tidak dihapus', async () => {
      const confirmedRowId = 'pool-t8-confirmed';
      const confirmedRowFields = {
        ...defaultRowFields,
        driver_id: null,
        status: 'CONFIRMED', // BUKAN ASSIGNED
        total_cents: 44000,
        server_version: 4,
        created_at: 1_500_000_000_000,
        updated_at: 1_500_000_000_000,
      };
      await seedPoolRow(confirmedRowId, confirmedRowFields);

      // Server kirim daftar kosong (hasMore false, jika baris ini dianggap pool, akan dihapus).
      await renderAndAwaitPool(db, [], false);

      // Baris tetap persis sama (tidak disentuh)
      const row = await db.get<OrderModel>('orders').find(confirmedRowId);
      expect(row._getRaw('driver_id')).toBe(null);
      expect(row._getRaw('status')).toBe('CONFIRMED');
      expect(row._getRaw('total_cents')).toBe(44000);
      expect(row._getRaw('server_version')).toBe(4);
      expect(row._getRaw('created_at')).toBe(1_500_000_000_000);
      expect(row._getRaw('updated_at')).toBe(1_500_000_000_000);
      expect(row._raw._status).toBe('synced');
      expect(await rowExistsInAdapter(confirmedRowId)).toBe(true);
    });
  });
});

// Regresi fetchPool: Terima yang selesai berbarengan dengan fetchPool (server
// memancarkan order:unavailable hampir bersamaan dengan respons Terima) tidak
// boleh membuat order yang baru diterima terhapus atau tertimpa.
// Caranya: tiruan fetchAvailableOrders mengubah X jadi milik driver lewat
// database.write sebelum mengembalikan daftar, jadi saat fetchPool menulis,
// X sudah bukan baris pool. fetchPool harus membiarkan X apa adanya.
describe('fetchPool - terima serentak tidak menghapus atau menimpa order', () => {
  let db: Database;

  beforeEach(() => {
    db = buildTestDatabase();
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const defaultRowFields = {
    customer_id: '',
    driver_id: null,
    status: 'ASSIGNED',
    items_json: '[]',
    address_json: '{}',
    total_cents: 55000,
    currency: 'IDR',
    notes: null,
    server_version: 3,
    deleted_at: null,
    failed_sync_attempts: 0,
    cancelled_by: null,
    cancel_reason: null,
    last_conflict_reason: null,
    last_conflict_at: null,
    created_at: 1_600_000_000_000,
    updated_at: 1_600_000_000_000,
  };

  // Simulasikan handleAccept menulis baris lokal dari hasil terima server.
  async function acceptX(): Promise<void> {
    await db.write(async () => {
      const row = await db.get<OrderModel>('orders').find('race-X');
      await row.update((r) => {
        r._setRaw('status', 'PREPARING');
        r._setRaw('driver_id', 'driver-racer');
        r._setRaw('server_version', 5);
        r._raw._status = 'synced';
        r._raw._changed = '';
      });
    });
  }

  it('tidak menghapus order yang baru diterima saat daftar server sudah kosong', async () => {
    // X mula-mula baris pool (status ASSIGNED, driver_id null, synced).
    await db.write(async () => {
      const prepared = db.get<OrderModel>('orders').prepareCreateFromDirtyRaw({
        id: 'race-X',
        _status: 'synced',
        _changed: '',
        ...defaultRowFields,
      });
      await db.batch(prepared);
    });

    const client = jest.requireMock<{ fetchAvailableOrders: jest.Mock }>('../sync/client');
    // Sebelum daftar dikembalikan: handleAccept selesai duluan, X bukan baris pool lagi.
    // Daftar server sudah tidak memuat X.
    client.fetchAvailableOrders.mockImplementation(async () => {
      await acceptX();
      return { items: [], hasMore: false };
    });

    render(<OrdersScreenBase database={db} myOrders={[]} />);
    await waitFor(() => {
      expect(client.fetchAvailableOrders).toHaveBeenCalled();
    });
    await new Promise<void>((resolve) => { setTimeout(resolve, 30); });

    // X harus masih ada sebagai baris milik driver dengan versi baru.
    const all = await db.get<OrderModel>('orders').query().fetch();
    const x = all.find((r) => r.id === 'race-X');
    expect(x).toBeDefined();
    expect(x!._getRaw('status')).toBe('PREPARING');
    expect(x!._getRaw('driver_id')).toBe('driver-racer');
    expect(x!._getRaw('server_version')).toBe(5);
  });

  it('tidak menimpa order yang baru diterima saat daftar server masih memuat versi lama', async () => {
    // X mula-mula baris pool (status ASSIGNED, driver_id null, synced).
    await db.write(async () => {
      const prepared = db.get<OrderModel>('orders').prepareCreateFromDirtyRaw({
        id: 'race-X',
        _status: 'synced',
        _changed: '',
        ...defaultRowFields,
      });
      await db.batch(prepared);
    });

    const client = jest.requireMock<{ fetchAvailableOrders: jest.Mock }>('../sync/client');
    // Sebelum daftar dikembalikan: handleAccept selesai duluan, X bukan baris pool lagi.
    // Daftar server masih memuat X dengan versi lama (3).
    client.fetchAvailableOrders.mockImplementation(async () => {
      await acceptX();
      return {
        items: [
          {
            orderId: 'race-X',
            totalCents: 55000,
            currency: 'IDR',
            itemsCount: 1,
            createdAt: new Date(1_600_000_000_000).toISOString(),
            version: 3,
          },
        ],
        hasMore: false,
      };
    });

    render(<OrdersScreenBase database={db} myOrders={[]} />);
    await waitFor(() => {
      expect(client.fetchAvailableOrders).toHaveBeenCalled();
    });
    await new Promise<void>((resolve) => { setTimeout(resolve, 30); });

    // X harus tetap PREPARING milik driver dengan versi baru (5),
    // bukan tertimpa jadi ASSIGNED atau versi lama (3).
    const row = await db.get<OrderModel>('orders').find('race-X');
    expect(row._getRaw('status')).toBe('PREPARING');
    expect(row._getRaw('driver_id')).toBe('driver-racer');
    expect(row._getRaw('server_version')).toBe(5);
  });
});

// fetchPool untuk baris lepas yang sudah ada di DB: baris dengan driver_id
// null, 'synced', dan tanpa aksi dijadikan baris pool kalau ordernya ada lagi
// di daftar Tersedia. Baris dengan driver_id terisi tetap tidak disentuh.
describe('fetchPool - baris lepas (driver_id null, last_conflict_reason terisi) jadi baris pool', () => {
  let db: Database;
  let releaseClient: { fetchAvailableOrders: jest.Mock };
  let releaseOutbox: { hasPendingAction: jest.Mock };

  beforeEach(() => {
    db = buildTestDatabase();
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS);
    releaseClient = jest.requireMock('../sync/client') as { fetchAvailableOrders: jest.Mock };
    releaseOutbox = jest.requireMock('../sync/outbox') as { hasPendingAction: jest.Mock };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function seedOrderRowRaw(
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

  async function seedPendingActionRaw(
    rowId: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    await db.write(async () => {
      const prepared = db
        .get<PendingActionModel>('pending_actions')
        .prepareCreateFromDirtyRaw({
          id: rowId,
          _status: 'synced',
          _changed: '',
          ...fields,
        });
      await db.batch(prepared);
    });
  }

  it('baris lepas (driver_id null, PREPARING, synced, tanpa aksi) jadi baris pool dengan data server, last_conflict_reason tetap', async () => {
    const releasedRowId = 'pool-released-1';
    await seedOrderRowRaw(releasedRowId, {
      customer_id: 'cust-rel-1',
      driver_id: null,
      status: 'PREPARING',
      items_json: '[{"name":"Lama"}]',
      address_json: '{"street":"Jl. Lama 1","city":"Badung"}',
      total_cents: 12000,
      currency: 'IDR',
      notes: null,
      server_version: 6,
      deleted_at: null,
      failed_sync_attempts: 0,
      cancelled_by: null,
      cancel_reason: null,
      last_conflict_reason: 'released',
      last_conflict_at: 1700000000000,
      created_at: 1_600_000_000_000,
      updated_at: 1_600_000_000_000,
    });

    releaseOutbox.hasPendingAction.mockResolvedValue(false);
    releaseClient.fetchAvailableOrders.mockResolvedValue({
      items: [
        {
          orderId: releasedRowId,
          totalCents: 25000,
          currency: 'SGD',
          itemsCount: 2,
          city: 'Ubud',
          createdAt: '2026-02-01T08:00:00.000Z',
          version: 9,
        },
      ],
      hasMore: true,
    });

    render(<OrdersScreenBase database={db} myOrders={[]} />);
    await waitFor(() => {
      expect(releaseClient.fetchAvailableOrders).toHaveBeenCalled();
    });
    await new Promise<void>((resolve) => { setTimeout(resolve, 30); });

    const row = await db.get<OrderModel>('orders').find(releasedRowId);
    // Kolom pool: status ASSIGNED, server_version, total_cents, currency dari server
    expect(row._getRaw('status')).toBe('ASSIGNED');
    expect(row._getRaw('server_version')).toBe(9);
    expect(row._getRaw('total_cents')).toBe(25000);
    expect(row._getRaw('currency')).toBe('SGD');
    // alamat lengkap dan barang lama hilang, diganti kota dari server
    expect(readJsonColumn(row, 'address_json')).toEqual({ city: 'Ubud' });
    expect(readJsonColumn(row, 'items_json')).toEqual([]);
    // _status synced, _changed kosong
    expect(row._raw._status).toBe('synced');
    expect(row._raw._changed).toBe('');
    // last_conflict_reason tidak diubah (banner masih tampil)
    expect(row._getRaw('last_conflict_reason')).toBe('released');
  });

  it('baris lepas dengan aksi cancel berstatus failed: tidak disentuh', async () => {
    const releasedRowId = 'pool-released-pending';
    await seedOrderRowRaw(releasedRowId, {
      customer_id: 'cust-rel-2',
      driver_id: null,
      status: 'PREPARING',
      items_json: '[]',
      address_json: '{}',
      total_cents: 12000,
      currency: 'IDR',
      notes: null,
      server_version: 6,
      deleted_at: null,
      failed_sync_attempts: 0,
      cancelled_by: null,
      cancel_reason: null,
      last_conflict_reason: 'released',
      last_conflict_at: 1700000000000,
      created_at: 1_600_000_000_000,
      updated_at: 1_600_000_000_000,
    });
    // Ada aksi cancel berstatus 'failed' untuk order ini.
    await seedPendingActionRaw('pa-failed-rel', {
      action_type: 'cancel',
      target_order_id: releasedRowId,
      expected_version: 6,
      idempotency_key: 'cancel:rel-2:uuid',
      payload_json: '{}',
      status: 'failed',
      created_at: 1700000000000,
      updated_at: 1700000000000,
    });

    releaseOutbox.hasPendingAction.mockResolvedValue(false);
    releaseClient.fetchAvailableOrders.mockResolvedValue({
      items: [
        {
          orderId: releasedRowId,
          totalCents: 25000,
          currency: 'SGD',
          itemsCount: 2,
          createdAt: '2026-02-01T08:00:00.000Z',
          version: 9,
        },
      ],
      hasMore: true,
    });

    render(<OrdersScreenBase database={db} myOrders={[]} />);
    await waitFor(() => {
      expect(releaseClient.fetchAvailableOrders).toHaveBeenCalled();
    });
    await new Promise<void>((resolve) => { setTimeout(resolve, 30); });

    const row = await db.get<OrderModel>('orders').find(releasedRowId);
    // status tidak jadi ASSIGNED, total_cents tidak ditimpa
    expect(row._getRaw('status')).toBe('PREPARING');
    expect(row._getRaw('total_cents')).toBe(12000);
    expect(row._getRaw('server_version')).toBe(6);
    expect(row._getRaw('last_conflict_reason')).toBe('released');
  });

  it('baris lepas dengan aksi collect_cod berstatus orphaned_needs_review: tidak disentuh', async () => {
    // COD yatim: server menolak COD karena order sudah bukan milik driver,
    // padahal uangnya sudah diterima. Order ini tidak dijadikan baris pool,
    // karena uangnya masih harus diselesaikan.
    const releasedRowId = 'pool-released-orphaned-cod';
    await seedOrderRowRaw(releasedRowId, {
      customer_id: 'cust-rel-cod',
      driver_id: null,
      status: 'OUT_FOR_DELIVERY',
      items_json: '[]',
      address_json: '{}',
      total_cents: 18000,
      currency: 'IDR',
      notes: null,
      server_version: 6,
      deleted_at: null,
      failed_sync_attempts: 0,
      cancelled_by: null,
      cancel_reason: null,
      last_conflict_reason: 'released',
      last_conflict_at: 1700000000000,
      created_at: 1_600_000_000_000,
      updated_at: 1_600_000_000_000,
    });
    await seedPendingActionRaw('pa-orphaned-cod', {
      action_type: 'collect_cod',
      target_order_id: releasedRowId,
      expected_version: 6,
      idempotency_key: 'cod:rel-cod:uuid',
      payload_json: '{"amountCents":18000}',
      status: 'orphaned_needs_review',
      created_at: 1700000000000,
      updated_at: 1700000000000,
    });

    releaseOutbox.hasPendingAction.mockResolvedValue(false);
    releaseClient.fetchAvailableOrders.mockResolvedValue({
      items: [
        {
          orderId: releasedRowId,
          totalCents: 30000,
          currency: 'SGD',
          itemsCount: 2,
          createdAt: '2026-02-01T08:00:00.000Z',
          version: 9,
        },
      ],
      hasMore: true,
    });

    render(<OrdersScreenBase database={db} myOrders={[]} />);
    await waitFor(() => {
      expect(releaseClient.fetchAvailableOrders).toHaveBeenCalled();
    });
    await new Promise<void>((resolve) => { setTimeout(resolve, 30); });

    const row = await db.get<OrderModel>('orders').find(releasedRowId);
    // status tidak jadi ASSIGNED, total_cents tidak ditimpa
    expect(row._getRaw('status')).toBe('OUT_FOR_DELIVERY');
    expect(row._getRaw('total_cents')).toBe(18000);
    expect(row._getRaw('server_version')).toBe(6);
    expect(row._getRaw('last_conflict_reason')).toBe('released');
  });

  it('baris lepas dengan _status "updated": tidak disentuh', async () => {
    const releasedRowId = 'pool-released-updated';
    await db.write(async () => {
      const prepared = db.get<OrderModel>('orders').prepareCreateFromDirtyRaw({
        id: releasedRowId,
        _status: 'updated',
        _changed: 'total_cents',
        customer_id: 'cust-rel-3',
        driver_id: null,
        status: 'PREPARING',
        items_json: '[]',
        address_json: '{}',
        total_cents: 12000,
        currency: 'IDR',
        notes: null,
        server_version: 6,
        deleted_at: null,
        failed_sync_attempts: 0,
        cancelled_by: null,
        cancel_reason: null,
        last_conflict_reason: 'released',
        last_conflict_at: 1700000000000,
        created_at: 1_600_000_000_000,
        updated_at: 1_600_000_000_000,
      });
      await db.batch(prepared);
    });

    releaseOutbox.hasPendingAction.mockResolvedValue(false);
    releaseClient.fetchAvailableOrders.mockResolvedValue({
      items: [
        {
          orderId: releasedRowId,
          totalCents: 25000,
          currency: 'SGD',
          itemsCount: 2,
          createdAt: '2026-02-01T08:00:00.000Z',
          version: 9,
        },
      ],
      hasMore: true,
    });

    render(<OrdersScreenBase database={db} myOrders={[]} />);
    await waitFor(() => {
      expect(releaseClient.fetchAvailableOrders).toHaveBeenCalled();
    });
    await new Promise<void>((resolve) => { setTimeout(resolve, 30); });

    const row = await db.get<OrderModel>('orders').find(releasedRowId);
    // Tidak disentuh: status tetap PREPARING, _status tetap 'updated'
    expect(row._getRaw('status')).toBe('PREPARING');
    expect(row._getRaw('total_cents')).toBe(12000);
    expect(row._raw._status).toBe('updated');
    expect(row._getRaw('last_conflict_reason')).toBe('released');
  });

  it('baris bukan pool (driver_id terisi, status PREPARING) tidak disentuh', async () => {
    // Baris bukan pool, driver_id terisi. fetchPool tidak menyentuh baris
    // ini (syarat pool: driver_id null).
    const ownedRowId = 'pool-not-mine';
    await seedOrderRowRaw(ownedRowId, {
      customer_id: 'cust-not-mine',
      driver_id: 'driver-other',
      status: 'PREPARING',
      items_json: '[]',
      address_json: '{}',
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
      created_at: 1_700_000_000_000,
      updated_at: 1_700_000_000_000,
    });

    releaseOutbox.hasPendingAction.mockResolvedValue(false);
    releaseClient.fetchAvailableOrders.mockResolvedValue({
      items: [
        {
          orderId: ownedRowId,
          totalCents: 99000,
          currency: 'IDR',
          itemsCount: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          version: 7,
        },
      ],
      hasMore: true,
    });

    render(<OrdersScreenBase database={db} myOrders={[]} />);
    await waitFor(() => {
      expect(releaseClient.fetchAvailableOrders).toHaveBeenCalled();
    });
    await new Promise<void>((resolve) => { setTimeout(resolve, 30); });

    const row = await db.get<OrderModel>('orders').find(ownedRowId);
    // Tidak disentuh, total_cents tetap
    expect(row._getRaw('driver_id')).toBe('driver-other');
    expect(row._getRaw('total_cents')).toBe(88000);
    expect(row._getRaw('server_version')).toBe(5);
  });

  it('baris status CONFIRMED dengan driver_id null tidak disentuh (bukan pool)', async () => {
    // Baris CONFIRMED dengan driver_id null bukan baris pool, jadi fetchPool
    // tidak mengubah atau menghapusnya.
    const confirmedRowId = 'pool-confirmed-rel';
    await seedOrderRowRaw(confirmedRowId, {
      customer_id: 'cust-conf-rel',
      driver_id: null,
      status: 'CONFIRMED',
      items_json: '[]',
      address_json: '{}',
      total_cents: 44000,
      currency: 'IDR',
      notes: null,
      server_version: 4,
      deleted_at: null,
      failed_sync_attempts: 0,
      cancelled_by: null,
      cancel_reason: null,
      last_conflict_reason: null,
      last_conflict_at: null,
      created_at: 1_500_000_000_000,
      updated_at: 1_500_000_000_000,
    });

    releaseOutbox.hasPendingAction.mockResolvedValue(false);
    releaseClient.fetchAvailableOrders.mockResolvedValue({
      items: [],
      hasMore: false,
    });

    render(<OrdersScreenBase database={db} myOrders={[]} />);
    await waitFor(() => {
      expect(releaseClient.fetchAvailableOrders).toHaveBeenCalled();
    });
    await new Promise<void>((resolve) => { setTimeout(resolve, 30); });

    const row = await db.get<OrderModel>('orders').find(confirmedRowId);
    // Tetap persis seperti sebelumnya, tidak dihapus (status bukan ASSIGNED)
    expect(row._getRaw('status')).toBe('CONFIRMED');
    expect(row._getRaw('total_cents')).toBe(44000);
    expect(row._getRaw('server_version')).toBe(4);
    expect(await rowExistsInAdapterLocal(confirmedRowId, db)).toBe(true);
  });
});

async function rowExistsInAdapterLocal(rowId: string, db: Database): Promise<boolean> {
  const all = await db.get<OrderModel>('orders').query().fetch();
  return all.some((r) => r.id === rowId);
}

// handleAccept sukses pada baris yang punya last_conflict_reason:
// last_conflict_reason dan last_conflict_at jadi null (banner hilang).
describe('handleAccept - last_conflict_reason dan last_conflict_at dikosongkan pada sukses', () => {
  let db: Database;
  let releaseClient: { fetchAvailableOrders: jest.Mock; acceptOrder: jest.Mock };
  let releaseSession: { getCurrentUserId: jest.Mock };

  beforeEach(() => {
    db = buildTestDatabase();
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS);
    releaseClient = jest.requireMock('../sync/client') as {
      fetchAvailableOrders: jest.Mock;
      acceptOrder: jest.Mock;
    };
    releaseSession = jest.requireMock('../sync/session') as { getCurrentUserId: jest.Mock };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('acceptOrder sukses: last_conflict_reason dan last_conflict_at jadi null', async () => {
    const rowId = 'pool-accept-rel';
    await db.write(async () => {
      const prepared = db.get<OrderModel>('orders').prepareCreateFromDirtyRaw({
        id: rowId,
        _status: 'synced',
        _changed: '',
        customer_id: 'cust-AC-rel',
        driver_id: null,
        status: 'ASSIGNED',
        items_json: '[]',
        address_json: '{}',
        total_cents: 23000,
        currency: 'IDR',
        notes: null,
        server_version: 3,
        deleted_at: null,
        failed_sync_attempts: 0,
        cancelled_by: null,
        cancel_reason: null,
        // Baris yang sudah ditandai lepas oleh pull.
        last_conflict_reason: 'released',
        last_conflict_at: 1700000000000,
        created_at: 1_600_000_000_000,
        updated_at: 1_600_000_000_000,
      });
      await db.batch(prepared);
    });

    releaseClient.fetchAvailableOrders.mockResolvedValue({
      items: [
        {
          orderId: rowId,
          totalCents: 23000,
          currency: 'IDR',
          itemsCount: 1,
          createdAt: new Date(1_600_000_000_000).toISOString(),
          version: 3,
        },
      ],
      hasMore: true,
    });
    releaseClient.acceptOrder = jest.fn().mockResolvedValue({
      id: rowId,
      customerId: 'cust-AC-rel',
      driverId: 'driver-AC-rel',
      status: 'PREPARING',
      items: [
        { id: 'item-AC-rel', productId: 'prod-AC-rel', name: 'Nasi Goreng', quantity: 1, unitPriceCents: 23000 },
      ],
      deliveryAddress: {
        recipientName: 'Citra',
        phone: '081234567890',
        street: 'Jl. Sudirman No. 1',
        city: 'Jakarta',
        postalCode: '10110',
        coordinates: [106.85, -6.2],
      },
      totalCents: 23000,
      currency: 'IDR',
      notes: null,
      createdAt: '2026-01-15T03:04:05.678Z',
      updatedAt: '2026-01-15T03:05:00.000Z',
      version: 4,
      cancelledBy: null,
      cancelReason: null,
    });
    releaseSession.getCurrentUserId.mockResolvedValue('driver-AC-rel');

    const { handleAcceptRef } = require('../screens/OrdersScreen') as {
      handleAcceptRef: { current: ((order: OrderModel) => Promise<void>) | null };
    };

    render(<OrdersScreenBase database={db} myOrders={[]} />);
    await waitFor(() => {
      expect(handleAcceptRef.current).not.toBeNull();
    });

    const order = await db.get<OrderModel>('orders').find(rowId);
    await handleAcceptRef.current!(order);

    const updatedRow = await db.get<OrderModel>('orders').find(rowId);
    // last_conflict_reason dan last_conflict_at jadi null
    expect(updatedRow._getRaw('last_conflict_reason')).toBeNull();
    expect(updatedRow._getRaw('last_conflict_at')).toBeNull();
    // Status dari respons server
    expect(updatedRow._getRaw('status')).toBe('PREPARING');
    expect(updatedRow._getRaw('driver_id')).toBe('driver-AC-rel');
  });
});

// Regresi handleAccept: accept order lewat REST, bukan cuma lokal
// Sebelum diperbaiki, handleAccept hanya menulis WatermelonDB lokal tanpa memanggil
// POST /orders/:id/accept. acceptOrder tidak pernah dipanggil, tes MERAH.
// Sesudah diperbaiki: acceptOrder dipanggil, baris ditulis dari respons server,
// _status='synced'+_changed='' pada sukses; 409 memicu fetchPool; error tidak mengubah baris lokal.
describe('handleAccept - accept order lewat REST', () => {
  let db: Database;

  // Mock fetchAvailableOrders: kembalikan seeded row agar fetchPool onMount tidak menghapusnya.
  // Row seeded dengan driver_id=null, status=ASSIGNED, jadi masuk pool query, ada di server list
  // (lanjut), tidak di-delete; juga tidak di-create (sudah ada).
  function buildFetchPoolMock(rowId: string, rowFields: Record<string, unknown>) {
    const client = jest.requireMock('../sync/client') as { fetchAvailableOrders: jest.Mock };
    client.fetchAvailableOrders.mockResolvedValue({
      items: [
        {
          orderId: rowId,
          totalCents: (rowFields.total_cents as number) ?? 55000,
          currency: (rowFields.currency as string) ?? 'IDR',
          itemsCount: 1,
          createdAt: new Date(rowFields.created_at as number).toISOString(),
          version: (rowFields.server_version as number) ?? 3,
        },
      ],
      hasMore: true,
    });
  }

  beforeEach(() => {
    db = buildTestDatabase();
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW_MS);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // defaultRowFields yang sama dengan tes fetchPool
  const defaultRowFields = {
    customer_id: '',
    driver_id: null,
    status: 'ASSIGNED',
    items_json: '[]',
    address_json: '{}',
    total_cents: 55000,
    currency: 'IDR',
    notes: null,
    server_version: 3,
    deleted_at: null,
    failed_sync_attempts: 0,
    cancelled_by: null,
    cancel_reason: null,
    last_conflict_reason: null,
    last_conflict_at: null,
  };

  // Seed baris pool dengan server_version=3
  const poolAcceptFields = {
    ...defaultRowFields,
    server_version: 3,
    total_cents: 55000,
    created_at: 1_600_000_000_000,
    updated_at: 1_600_000_000_000,
  };

  // seedPoolRow: alias ke seedOrderRow (pool rows pakai seed yang sama)
  async function seedPoolRow(rowId: string, fields: Record<string, unknown>): Promise<void> {
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

  // rowExistsInAdapter: cek apakah baris ada di adapter (lokijs)
  async function rowExistsInAdapter(rowId: string): Promise<boolean> {
    const all = await db.get<OrderModel>('orders').query().fetch();
    return all.some((r) => r.id === rowId);
  }

  // Tes 1: accept sukses, acceptOrder dipanggil, baris ditulis dari respons server
  it('acceptOrder dipanggil dengan order.id dan serverVersion; baris lokal ditulis dari respons server', async () => {
    const client = jest.requireMock('../sync/client') as { acceptOrder: jest.Mock };
    const session = jest.requireMock('../sync/session') as { getCurrentUserId: jest.Mock };
    // Respons penuh dari backend (toDomain Order).
    client.acceptOrder = jest.fn().mockResolvedValue({
      id: 'pool-accept-1',
      customerId: 'customer-AC21',
      driverId: 'driver-AC21',
      status: 'PREPARING',
      items: [
        { id: 'item-AC21', productId: 'prod-AC21', name: 'Nasi Goreng', quantity: 1, unitPriceCents: 23000 },
      ],
      deliveryAddress: {
        recipientName: 'Citra',
        phone: '081234567890',
        street: 'Jl. Sudirman No. 1',
        city: 'Jakarta',
        postalCode: '10110',
        coordinates: [106.85, -6.2],
      },
      totalCents: 23000,
      currency: 'IDR',
      notes: null,
      createdAt: '2026-01-15T03:04:05.678Z',
      updatedAt: '2026-01-15T03:05:00.000Z',
      version: 4,
      cancelledBy: null,
      cancelReason: null,
    });
    session.getCurrentUserId.mockResolvedValue('driver-AC21');

    const { handleAcceptRef } = require('../screens/OrdersScreen') as {
      handleAcceptRef: { current: ((order: OrderModel) => Promise<void>) | null };
    };
    const rowId = 'pool-accept-1';
    await seedPoolRow(rowId, { ...poolAcceptFields, id: rowId });
    buildFetchPoolMock(rowId, poolAcceptFields);

    render(<OrdersScreenBase database={db} myOrders={[]} />);
    await waitFor(() => {
      expect(handleAcceptRef.current).not.toBeNull();
    });

    const order = await db.get<OrderModel>('orders').find(rowId);
    await handleAcceptRef.current!(order);

    expect(client.acceptOrder).toHaveBeenCalledWith(rowId, 3);
    const updatedRow = await db.get<OrderModel>('orders').find(rowId);
    expect(updatedRow._getRaw('status')).toBe('PREPARING');
    expect(updatedRow._getRaw('driver_id')).toBe('driver-AC21');
    expect(updatedRow._getRaw('server_version')).toBe(4);
    expect(updatedRow._raw._status).toBe('synced');
    expect(updatedRow._raw._changed).toBe('');
  });

  // Tes 2: 409 conflict, syncEvents.emit dipanggil, baris lama TIDAK dihapus manual
  it('409 Conflict, syncEvents.emit("pool-refresh") dipanggil; baris pool TIDAK berubah/hapus manual', async () => {
    const client = jest.requireMock('../sync/client') as { acceptOrder: jest.Mock };
    const session = jest.requireMock('../sync/session') as { getCurrentUserId: jest.Mock };
    const syncEvents = jest.requireMock('../sync/syncEvents') as { syncEvents: { emit: jest.Mock } };
    // ApiError dengan status 409: pakai kelas ApiError asli
    const apiError409 = new ApiError(
      'acceptOrder failed: 409 - order conflict',
      409,
      'ORDER_UNAVAILABLE',
      { code: 'ORDER_UNAVAILABLE', message: 'order conflict' },
    );
    client.acceptOrder = jest.fn().mockRejectedValue(apiError409);
    session.getCurrentUserId.mockResolvedValue('driver-AC21');
    syncEvents.syncEvents.emit = jest.fn();

    const { handleAcceptRef } = require('../screens/OrdersScreen') as {
      handleAcceptRef: { current: ((order: OrderModel) => Promise<void>) | null };
    };
    const rowId = 'pool-accept-409';
    await seedPoolRow(rowId, { ...poolAcceptFields, id: rowId });
    buildFetchPoolMock(rowId, poolAcceptFields);

    render(<OrdersScreenBase database={db} myOrders={[]} />);
    await waitFor(() => {
      expect(handleAcceptRef.current).not.toBeNull();
    });

    const order = await db.get<OrderModel>('orders').find(rowId);
    await handleAcceptRef.current!(order);

    // syncEvents.emit('pool-refresh') dipanggil saat 409
    expect(syncEvents.syncEvents.emit).toHaveBeenCalledWith('pool-refresh', {});
    // Baris pool TIDAK dihapus manual oleh handleAccept
    expect(await rowExistsInAdapter(rowId)).toBe(true);
  });

  // Tes 4: 409 ORDER_UNAVAILABLE (cron melepas order ke CONFIRMED), Alert + pool-refresh
  it('409 ORDER_UNAVAILABLE, Alert muncul + syncEvents.emit("pool-refresh")', async () => {
    const client = jest.requireMock('../sync/client') as { acceptOrder: jest.Mock };
    const session = jest.requireMock('../sync/session') as { getCurrentUserId: jest.Mock };
    const syncEventsMod = jest.requireMock('../sync/syncEvents') as { syncEvents: { emit: jest.Mock } };
    // Backend throw ConflictException({ code: 'ORDER_UNAVAILABLE', message: 'Cannot accept order in status CONFIRMED. Expected ASSIGNED.' })
    const apiError = new ApiError(
      'acceptOrder failed: 409 - ' +
        JSON.stringify({
          code: 'ORDER_UNAVAILABLE',
          message: 'Cannot accept order in status CONFIRMED. Expected ASSIGNED.',
        }),
      409,
      'ORDER_UNAVAILABLE',
      {
        code: 'ORDER_UNAVAILABLE',
        message: 'Cannot accept order in status CONFIRMED. Expected ASSIGNED.',
      },
    );
    client.acceptOrder = jest.fn().mockRejectedValue(apiError);
    session.getCurrentUserId.mockResolvedValue('driver-AC21');
    syncEventsMod.syncEvents.emit = jest.fn();
    (Alert.alert as jest.Mock).mockClear();

    const { handleAcceptRef } = require('../screens/OrdersScreen') as {
      handleAcceptRef: { current: ((order: OrderModel) => Promise<void>) | null };
    };
    const rowId = 'pool-accept-409-unavail';
    await seedPoolRow(rowId, { ...poolAcceptFields, id: rowId });
    buildFetchPoolMock(rowId, poolAcceptFields);

    render(<OrdersScreenBase database={db} myOrders={[]} />);
    await waitFor(() => {
      expect(handleAcceptRef.current).not.toBeNull();
    });

    const order = await db.get<OrderModel>('orders').find(rowId);
    await handleAcceptRef.current!(order);

    // Alert dipanggil dengan satu argumen (title-only Alert.alert(message))
    expect(Alert.alert as jest.Mock).toHaveBeenCalledWith(
      'Order sudah berubah atau diambil driver lain. Daftar diperbarui.',
    );
    // syncEvents.emit('pool-refresh') dipicu oleh 409
    expect(syncEventsMod.syncEvents.emit).toHaveBeenCalledWith('pool-refresh', {});
  });

  // Tes 5: 409 VERSION_CONFLICT (OCC version mismatch), Alert + pool-refresh
  it('409 VERSION_CONFLICT, Alert muncul + syncEvents.emit("pool-refresh")', async () => {
    const client = jest.requireMock('../sync/client') as { acceptOrder: jest.Mock };
    const session = jest.requireMock('../sync/session') as { getCurrentUserId: jest.Mock };
    const syncEventsMod = jest.requireMock('../sync/syncEvents') as { syncEvents: { emit: jest.Mock } };
    // Backend throw ConflictException({ code: 'VERSION_CONFLICT', message: 'Order was modified by another request...' })
    const apiError = new ApiError(
      'acceptOrder failed: 409 - ' +
        JSON.stringify({
          code: 'VERSION_CONFLICT',
          message: 'Order was modified by another request. Please refresh and try again.',
        }),
      409,
      'VERSION_CONFLICT',
      {
        code: 'VERSION_CONFLICT',
        message: 'Order was modified by another request. Please refresh and try again.',
      },
    );
    client.acceptOrder = jest.fn().mockRejectedValue(apiError);
    session.getCurrentUserId.mockResolvedValue('driver-AC21');
    syncEventsMod.syncEvents.emit = jest.fn();
    (Alert.alert as jest.Mock).mockClear();

    const { handleAcceptRef } = require('../screens/OrdersScreen') as {
      handleAcceptRef: { current: ((order: OrderModel) => Promise<void>) | null };
    };
    const rowId = 'pool-accept-409-version';
    await seedPoolRow(rowId, { ...poolAcceptFields, id: rowId });
    buildFetchPoolMock(rowId, poolAcceptFields);

    render(<OrdersScreenBase database={db} myOrders={[]} />);
    await waitFor(() => {
      expect(handleAcceptRef.current).not.toBeNull();
    });

    const order = await db.get<OrderModel>('orders').find(rowId);
    await handleAcceptRef.current!(order);

    expect(Alert.alert as jest.Mock).toHaveBeenCalledWith(
      'Order sudah berubah atau diambil driver lain. Daftar diperbarui.',
    );
    expect(syncEventsMod.syncEvents.emit).toHaveBeenCalledWith('pool-refresh', {});
  });

  // Tes 6: 400 dengan pesan "conflict" + "already accepted", TIDAK pool-refresh, Alert gagal umum
  // (handler lama cocok-teks pada err.message sehingga akan menganggap ini konflik dan
  // memancarkan pool-refresh, perubahan ini memastikan pool-refresh HANYA dipicu oleh 409.)
  it('400 dengan pesan "conflict" dan "already accepted", TIDAK pool-refresh; Alert gagal umum', async () => {
    const client = jest.requireMock('../sync/client') as { acceptOrder: jest.Mock };
    const session = jest.requireMock('../sync/session') as { getCurrentUserId: jest.Mock };
    const syncEventsMod = jest.requireMock('../sync/syncEvents') as { syncEvents: { emit: jest.Mock } };
    const apiError = new ApiError(
      'acceptOrder failed: 400 - conflict: order already accepted by another driver',
      400,
      'BAD_REQUEST',
      { message: 'conflict: order already accepted by another driver' },
    );
    client.acceptOrder = jest.fn().mockRejectedValue(apiError);
    session.getCurrentUserId.mockResolvedValue('driver-AC21');
    syncEventsMod.syncEvents.emit = jest.fn();
    (Alert.alert as jest.Mock).mockClear();

    const { handleAcceptRef } = require('../screens/OrdersScreen') as {
      handleAcceptRef: { current: ((order: OrderModel) => Promise<void>) | null };
    };
    const rowId = 'pool-accept-400-textmatch';
    await seedPoolRow(rowId, { ...poolAcceptFields, id: rowId });
    buildFetchPoolMock(rowId, poolAcceptFields);

    render(<OrdersScreenBase database={db} myOrders={[]} />);
    await waitFor(() => {
      expect(handleAcceptRef.current).not.toBeNull();
    });

    const order = await db.get<OrderModel>('orders').find(rowId);
    await handleAcceptRef.current!(order);

    // pool-refresh TIDAK dipancarkan, handler baru hanya merespons status 409
    expect(syncEventsMod.syncEvents.emit).not.toHaveBeenCalledWith('pool-refresh', expect.anything());
    // Alert gagal umum dipanggil dengan judul 'Gagal' dan pesan 'Terima order gagal. Coba lagi.'
    expect(Alert.alert as jest.Mock).toHaveBeenCalledWith('Gagal', 'Terima order gagal. Coba lagi.');
  });

  // Tes 3: error jaringan/5xx, baris lokal TIDAK diubah sama sekali
  it('network error / 5xx, baris lokal TIDAK diubah; status tetap ASSIGNED', async () => {
    const client = jest.requireMock('../sync/client') as { acceptOrder: jest.Mock };
    const session = jest.requireMock('../sync/session') as { getCurrentUserId: jest.Mock };
    client.acceptOrder = jest.fn().mockRejectedValue(new Error('Network error'));
    session.getCurrentUserId.mockResolvedValue('driver-AC21');

    const { handleAcceptRef } = require('../screens/OrdersScreen') as {
      handleAcceptRef: { current: ((order: OrderModel) => Promise<void>) | null };
    };
    const rowId = 'pool-accept-err';
    await seedPoolRow(rowId, { ...poolAcceptFields, id: rowId });
    buildFetchPoolMock(rowId, poolAcceptFields);

    render(<OrdersScreenBase database={db} myOrders={[]} />);
    await waitFor(() => {
      expect(handleAcceptRef.current).not.toBeNull();
    });

    const order = await db.get<OrderModel>('orders').find(rowId);
    await handleAcceptRef.current!(order);

    // Baris pool TIDAK berubah
    const row = await db.get<OrderModel>('orders').find(rowId);
    expect(row._getRaw('status')).toBe('ASSIGNED');
    expect(row._getRaw('driver_id')).toBe(null);
    expect(row._getRaw('server_version')).toBe(3);
  });
});