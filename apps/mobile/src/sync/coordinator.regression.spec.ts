/**
 * Tes regresi untuk jalur pull: applyPull -> buildRawRowForCreate ->
 * prepareCreateFromDirtyRaw.
 *
 * Tujuan: setelah pull, baris baru di koleksi harus menyimpan semua kolom
 * sesuai payload server (dibaca dari raw snake_case), dan created_at/
 * updated_at harus terisi.
 *
 * Sumber payload: nama dan tipe sesuai fungsi serializer
 * orderToDomain / paymentToDomain / chatToDomain di
 * apps/backend/src/sync/sync.service.ts.
 *
 * Adapter: LokiJS sinkron di memori. Mock hanya lapisan jaringan
 * (pullBatch). SyncCoordinator dipanggil lewat start() supaya seluruh
 * jalur publik (pull + applyPull) ikut berjalan.
 *
 * Catatan menjalankan spec ini sendirian: pakai --forceExit.
 * (autosave timer LokiJS bikin proses menggantung jika exit normal.)
 *
 * Catatan baca kolom: kolom dibaca lewat row._getRaw(nama kolom snake_case)
 * atau JSON.parse(row._getRaw('items_json')) untuk kolom JSON. Getter dan
 * setter Model (@text/@field/@json) tidak berfungsi di runtime Jest ini,
 * jadi akses lewat field Model biasa tidak membaca _raw.
 */

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import type { Model } from '@nozbe/watermelondb';
import type { Order, Payment, ChatMessage, SyncPullResponse } from '@delivery/shared';

import { schema } from '../db/schema';
import { OrderModel } from '../db/models/OrderModel';
import { PaymentModel } from '../db/models/PaymentModel';
import { ChatMessageModel } from '../db/models/ChatMessageModel';
import { SyncCoordinator } from './coordinator';

// Mock jaringan: pullBatch dikontrol per tes, fungsi lain memakai yang asli.
jest.mock('./client', () => {
  const actual = jest.requireActual('./client');
  return {
    ...actual,
    pullBatch: jest.fn(),
  };
});

jest.mock('./device', () => ({
  getDeviceId: jest.fn().mockResolvedValue('device-regression-pull'),
}));

jest.mock('./syncEvents', () => ({
  syncEvents: { emit: jest.fn(), on: jest.fn(), off: jest.fn() },
}));

jest.mock('./session', () => ({
  getCurrentUserId: jest.fn().mockResolvedValue('driver-regression-pull'),
  getCurrentToken: jest.fn().mockResolvedValue('fake-token'),
}));

jest.mock('../map/networkMonitor', () => ({
  networkMonitor: { getStatus: () => 'online', subscribe: () => () => {} },
}));

// Adapter LokiJS sinkron di memori, dibuat baru per tes untuk isolasi.
function buildTestDatabase(): Database {
  const adapter = new LokiJSAdapter({
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
    onSetUpError: (e: Error) => { throw e; },
  });
  return new Database({
    adapter,
    modelClasses: [OrderModel, PaymentModel, ChatMessageModel],
  });
}

// Daftar kolom per tabel, sumber kebenaran = schema.ts.
// WatermelonDB simpan kolom sebagai ColumnMap (Record) DAN columnArray.
// Pakai columnArray untuk urutan dan akses bertipe.
// isOptional = true artinya sanitizedRaw memberi null; bawaan kolom angka 0.
function getColumns(tableName: string): Array<{ name: string; type: string; isOptional: boolean }> {
  const table = schema.tables[tableName];
  if (!table) throw new Error(`Tabel ${tableName} tidak ada di schema`);
  return table.columnArray.map((c) => ({
    name: c.name,
    type: c.type,
    isOptional: c.isOptional ?? false,
  }));
}

// Bantu: seed satu baris via prepareCreateFromDirtyRaw dengan kunci
// snake_case + tipe benar, lalu mengembalikan row. Dipakai kontrol positif untuk
// membuktikan fungsi readAllSchemaColumns bisa melihat semua kolom.
async function seedSnakeCaseRow(
  db: Database,
  tableName: string,
  rowId: string,
  fields: Record<string, unknown>,
): Promise<Model> {
  const collection = db.get(tableName);
  await db.write(async () => {
    const prepared = collection.prepareCreateFromDirtyRaw({
      id: rowId,
      _status: 'synced',
      _changed: '',
      ...fields,
    });
    await db.batch(prepared);
  });
  return collection.find(rowId);
}

// Bantu: baca _raw untuk semua kolom schema tabel.
function readAllSchemaColumns(row: Model, tableName: string): Record<string, unknown> {
  const cols = getColumns(tableName);
  const out: Record<string, unknown> = {};
  for (const c of cols) {
    out[c.name] = row._getRaw(c.name);
  }
  return out;
}

// Bantu: ekstrak number dari record bertipe unknown.
function readNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

// Bantu: ubah timestamp ISO jadi epoch ms, atau null kalau tidak valid.
// Dipakai untuk memverifikasi nilai created_at yang diharapkan (di tes).
function parseIsoMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Bantu: baca satu kolom snake_case dari _raw dan parse sebagai JSON.
// Melempar kalau nilai bukan string, supaya typo nama kolom gagal cepat.
function readJsonColumn(row: { _getRaw: (name: string) => unknown }, columnName: string): unknown {
  const raw = row._getRaw(columnName);
  if (typeof raw !== 'string') {
    throw new Error(`Kolom ${columnName} di _raw bukan string: ${typeof raw}`);
  }
  return JSON.parse(raw);
}

// ===== Payload uji =====
// Bentuknya mengikuti serializer backend di sync.service.ts (orderToDomain,
// paymentToDomain, chatToDomain): nama kunci dan tipe sama seperti yang
// dikirim server ke mobile. Nilainya sengaja unik dan bukan nilai bawaan
// supaya kolom yang hilang diam-diam (jadi '' / 0 / null) kelihatan.
//
// createdAt / updatedAt memakai tanggal di masa lalu (2026-01-xx) supaya
// tes timestamp persis tidak bergantung pada jam sistem saat ini.

const ORDER_ID = 'order-regression-1';
const ORDER_PAYLOAD_DATA: Order = {
  id: ORDER_ID,
  customerId: 'cust-regression-pull-1',
  driverId: 'driver-regression-pull-1',
  status: 'CONFIRMED',
  items: [
    {
      id: 'item-regression-1',
      productId: 'prod-regression-1',
      name: 'Nasi Goreng Regression',
      quantity: 3,
      unitPriceCents: 11111,
      notes: 'regression item note',
    },
  ],
  deliveryAddress: {
    recipientName: 'Regression Customer',
    phone: '+6281200000001',
    street: 'Jl Regression No. 1',
    city: 'Kota Regression',
    postalCode: '12345',
    coordinates: [106.123, -6.456],
  },
  totalCents: 33333,
  currency: 'IDR',
  notes: 'regression order notes',
  cancelledBy: 'driver-regression-pull-1',
  cancelReason: 'regression cancel reason',
  version: 4,
  createdAt: '2026-01-15T03:04:05.678Z',
  updatedAt: '2026-01-20T10:00:00.000Z',
};

const ORDER_PULL_RESPONSE: SyncPullResponse = {
  nextCursor: '2026-01-20T10:00:00.000Z',
  records: [
    {
      entityType: 'order',
      id: ORDER_ID,
      deleted: false,
      serverVersion: 4,
      serverChangedAt: '2026-01-20T10:00:00.000Z',
      data: ORDER_PAYLOAD_DATA,
    },
  ],
  serverTime: '2026-01-20T10:00:00.000Z',
};

const PAYMENT_ID = 'payment-regression-1';
const PAYMENT_PAYLOAD_DATA: Payment = {
  id: PAYMENT_ID,
  orderId: ORDER_ID,
  idempotencyKey: 'cod:regression-payment-stable-uuid-001',
  method: 'CASH',
  status: 'CAPTURED',
  amountCents: 99999,
  currency: 'IDR',
  kind: 'PAYMENT',
  externalRef: 'regression-ext-ref-unique',
  version: 2,
  createdAt: '2026-01-15T03:04:05.678Z',
  updatedAt: '2026-01-20T10:00:00.000Z',
};

const PAYMENT_PULL_RESPONSE: SyncPullResponse = {
  nextCursor: '2026-01-20T10:00:00.000Z',
  records: [
    {
      entityType: 'payment',
      id: PAYMENT_ID,
      deleted: false,
      serverVersion: 2,
      serverChangedAt: '2026-01-20T10:00:00.000Z',
      data: PAYMENT_PAYLOAD_DATA,
    },
  ],
  serverTime: '2026-01-20T10:00:00.000Z',
};

const CHAT_ID = 'chat-regression-1';
const CHAT_PAYLOAD_DATA: ChatMessage = {
  id: CHAT_ID,
  roomId: 'room-regression-pull-1',
  senderId: 'sender-regression-pull-1',
  body: 'regression chat body unique',
  attachment: {
    kind: 'image',
    url: 'https://example.test/regression.png',
    width: 321,
    height: 654,
  },
  status: 'DELIVERED',
  clientCreatedAt: '2026-01-15T03:04:05.000Z',
  serverCreatedAt: '2026-01-15T03:04:06.500Z',
  version: 3,
  createdAt: '2026-01-15T03:04:05.678Z',
  updatedAt: '2026-01-20T10:00:00.000Z',
};

const CHAT_PULL_RESPONSE: SyncPullResponse = {
  nextCursor: '2026-01-20T10:00:00.000Z',
  records: [
    {
      entityType: 'chat_message',
      id: CHAT_ID,
      deleted: false,
      serverVersion: 3,
      serverChangedAt: '2026-01-20T10:00:00.000Z',
      data: CHAT_PAYLOAD_DATA,
    },
  ],
  serverTime: '2026-01-20T10:00:00.000Z',
};

// Nilai yang diharapkan per kolom snake_case, dihitung manual dari payload
// (tidak lewat buildRawRowForCreate, supaya tidak memakai kode yang sedang
// diuji). created_at dari server.createdAt (diurai ke ms) kalau ada, kalau
// tidak Date.now() di buildRawRowForCreate. updated_at selalu Date.now()
// saat disimpan lokal, jadi updated_at TIDAK cocok dengan nilai payload
// server; hanya created_at yang cocok persis.
const ORDERS_EXPECTED: Record<string, unknown> = {
  customer_id: 'cust-regression-pull-1',
  driver_id: 'driver-regression-pull-1',
  status: 'CONFIRMED',
  items_json: JSON.stringify(ORDER_PAYLOAD_DATA.items),
  address_json: JSON.stringify(ORDER_PAYLOAD_DATA.deliveryAddress),
  total_cents: 33333,
  currency: 'IDR',
  notes: 'regression order notes',
  server_version: 4,
  // Kolom berikut tidak diisi buildRawRowForCreate, jadi memakai bawaan schema:
  deleted_at: null,
  failed_sync_attempts: 0,
  cancelled_by: 'driver-regression-pull-1',
  cancel_reason: 'regression cancel reason',
  // v8 - tidak di-set di buildRawRowForCreate, default null:
  last_conflict_reason: null,
  last_conflict_at: null,
  // created_at dari server.createdAt; updated_at dari Date.now()
  // saat persist jadi hanya dicek > 0 (lihat it.each khusus timestamp).
  created_at: parseIsoMs(ORDER_PAYLOAD_DATA.createdAt),
  updated_at: expect.any(Number),
};

const PAYMENTS_EXPECTED: Record<string, unknown> = {
  order_id: ORDER_ID,
  idempotency_key: 'cod:regression-payment-stable-uuid-001',
  method: 'CASH',
  status: 'CAPTURED',
  amount_cents: 99999,
  currency: 'IDR',
  kind: 'PAYMENT',
  external_ref: 'regression-ext-ref-unique',
  server_version: 2,
  // Bawaan / terisi otomatis:
  deleted_at: null,
  failed_sync_attempts: 0,
  created_at: parseIsoMs(PAYMENT_PAYLOAD_DATA.createdAt),
  updated_at: expect.any(Number),
};

const CHAT_EXPECTED: Record<string, unknown> = {
  room_id: 'room-regression-pull-1',
  sender_id: 'sender-regression-pull-1',
  body: 'regression chat body unique',
  // buildRawRowForCreate tulis attachment_json sebagai string JSON.stringify,
  // karena jalur ini lewat sanitizedRaw (bukan setter Model).
  attachment_json: JSON.stringify(CHAT_PAYLOAD_DATA.attachment),
  status: 'DELIVERED',
  // buildRawRowForCreate chat_message konversi ISO -> ms epoch:
  client_created_at: new Date(CHAT_PAYLOAD_DATA.clientCreatedAt).getTime(),
  server_created_at: parseIsoMs(CHAT_PAYLOAD_DATA.serverCreatedAt),
  server_version: 3,
  // Bawaan / terisi otomatis:
  deleted_at: null,
  failed_sync_attempts: 0,
  created_at: parseIsoMs(CHAT_PAYLOAD_DATA.createdAt),
  updated_at: expect.any(Number),
};

// ===== Isi tes =====

describe('jalur pull - regresi buildRawRowForCreate dengan adapter LokiJS asli', () => {
  let db: Database;
  let coordinator: SyncCoordinator;
  let pullBatchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    db = buildTestDatabase();
    // Ambil mock pullBatch yang terpasang lewat jest.mock di atas
    // (setelah resetModules, import ulang agar binding-nya baru).
    const client = jest.requireMock<{ pullBatch: jest.Mock }>('./client');
    pullBatchMock = client.pullBatch;
    // SyncCoordinator di-require ulang agar binding-nya baru
    // tiap tes (syncInterval, flag berhenti, referensi db bersih).
    coordinator = jest.requireActual<typeof import('./coordinator')>('./coordinator').syncCoordinator;
  });

  afterEach(() => {
    // Bersihkan interval timer & reset state singleton supaya tes berikutnya
    // bisa start() lagi dengan bersih.
    if (coordinator) coordinator.stop();
  });

  // ===== Kontrol positif =====
  // Seed satu baris lewat prepareCreateFromDirtyRaw dengan kunci
  // snake_case + tipe benar. Verifikasi semua kolom skema bertahan
  // memakai fungsi bantu yang sama dengan tes utama. Ini membuktikan
  // fungsi bantunya bisa melihat semua kolom; kalau tes utama gagal,
  // masalahnya di kode produksi, bukan di helper tes.

  describe('kontrol positif: seed via prepareCreateFromDirtyRaw dengan snake_case', () => {
    it('orders: semua kolom schema terbaca sesuai nilai yang di-seed', async () => {
      const seedFields: Record<string, unknown> = {
        customer_id: 'ctrl-cust',
        driver_id: 'ctrl-driver',
        status: 'CONFIRMED',
        items_json: '[{"id":"ctrl-item"}]',
        address_json: '{"street":"ctrl"}',
        total_cents: 77777,
        currency: 'IDR',
        notes: 'ctrl-notes',
        server_version: 99,
        deleted_at: null,
        failed_sync_attempts: 0,
        cancelled_by: 'ctrl-cancelled',
        cancel_reason: 'ctrl-cancel-reason',
        last_conflict_reason: null,
        last_conflict_at: null,
        created_at: 1700000000000,
        updated_at: 1700000000000,
      };

      const row = await seedSnakeCaseRow(db, 'orders', 'order-ctrl-1', seedFields);
      const read = readAllSchemaColumns(row, 'orders');

      // Setiap kolom snake_case dari schema harus persis sama dengan
      // nilai yang di-seed (tidak difilter atau diubah oleh sanitizer).
      for (const col of getColumns('orders')) {
        expect(read[col.name]).toEqual(seedFields[col.name]);
      }
    });

    it('payments: semua kolom schema terbaca sesuai nilai yang di-seed', async () => {
      const seedFields: Record<string, unknown> = {
        order_id: 'ctrl-order',
        idempotency_key: 'ctrl-key',
        method: 'CASH',
        status: 'CAPTURED',
        amount_cents: 55555,
        currency: 'IDR',
        kind: 'PAYMENT',
        external_ref: 'ctrl-ext',
        server_version: 11,
        deleted_at: null,
        failed_sync_attempts: 0,
        created_at: 1700000000000,
        updated_at: 1700000000000,
      };

      const row = await seedSnakeCaseRow(db, 'payments', 'payment-ctrl-1', seedFields);
      const read = readAllSchemaColumns(row, 'payments');

      for (const col of getColumns('payments')) {
        expect(read[col.name]).toEqual(seedFields[col.name]);
      }
    });

    it('chat_messages: semua kolom schema terbaca sesuai nilai yang di-seed', async () => {
      const seedFields: Record<string, unknown> = {
        room_id: 'ctrl-room',
        sender_id: 'ctrl-sender',
        body: 'ctrl-body',
        attachment_json: '{"kind":"image","url":"ctrl"}',
        status: 'SENT',
        client_created_at: 1700000000000,
        server_created_at: 1700000000001,
        server_version: 22,
        deleted_at: null,
        failed_sync_attempts: 0,
        created_at: 1700000000000,
        updated_at: 1700000000000,
      };

      const row = await seedSnakeCaseRow(db, 'chat_messages', 'chat-ctrl-1', seedFields);
      const read = readAllSchemaColumns(row, 'chat_messages');

      for (const col of getColumns('chat_messages')) {
        expect(read[col.name]).toEqual(seedFields[col.name]);
      }
    });
  });

  // ===== Pull tabel orders =====

  describe('orders pull - jalur tulis applyPull lewat start()', () => {
    beforeEach(() => {
      pullBatchMock.mockResolvedValue(ORDER_PULL_RESPONSE);
    });

    it('prasyarat: setelah pull, baris dengan id order-regression-1 ada di koleksi orders', async () => {
      await coordinator.start(db);
      const found = await db.get<OrderModel>('orders')
        .find(ORDER_ID)
        .catch(() => null);
      expect(found).not.toBeNull();
    });

    it.each(getColumns('orders'))(
      'kolom $name terbaca sesuai nilai dari payload server',
      async (col) => {
        await coordinator.start(db);
        const row = await db.get<OrderModel>('orders').find(ORDER_ID);
        const actual = row._getRaw(col.name);
        const expected = ORDERS_EXPECTED[col.name];
        // updated_at diisi Date.now() saat persist, pastikan > 0 saja,
        // kecocokan persis dicek terpisah di tes "created_at sama dengan
        // waktu server".
        if (col.name === 'updated_at') {
          expect(typeof actual).toBe('number');
          expect(actual).toBeGreaterThan(0);
        } else {
          expect({ column: col.name, actual }).toEqual({
            column: col.name,
            actual: expected,
          });
        }
      },
    );

    it('items_json berisi string JSON yang di-parse jadi array sama dengan array uji', async () => {
      await coordinator.start(db);
      const row = await db.get<OrderModel>('orders').find(ORDER_ID);
      expect(readJsonColumn(row, 'items_json')).toEqual(ORDER_PAYLOAD_DATA.items);
    });

    it('address_json berisi string JSON yang di-parse jadi objek sama dengan objek uji', async () => {
      await coordinator.start(db);
      const row = await db.get<OrderModel>('orders').find(ORDER_ID);
      expect(readJsonColumn(row, 'address_json')).toEqual(ORDER_PAYLOAD_DATA.deliveryAddress);
    });

    it('created_at order sama dengan waktu server (epoch ms)', async () => {
      await coordinator.start(db);
      const row = await db.get<OrderModel>('orders').find(ORDER_ID);
      const actual = row._getRaw('created_at');
      const expected = parseIsoMs(ORDER_PAYLOAD_DATA.createdAt);
      expect(expected).not.toBeNull();
      expect(actual).toBe(expected);
    });

    it('_status row hasil pull adalah "synced"', async () => {
      await coordinator.start(db);
      const row = await db.get<OrderModel>('orders').find(ORDER_ID);
      expect(row._raw._status).toBe('synced');
    });
  });

  // ===== Pull tabel payments =====

  describe('payments pull - jalur tulis applyPull lewat start()', () => {
    beforeEach(() => {
      pullBatchMock.mockResolvedValue(PAYMENT_PULL_RESPONSE);
    });

    it('prasyarat: setelah pull, baris dengan id payment-regression-1 ada di koleksi payments', async () => {
      await coordinator.start(db);
      const found = await db.get<PaymentModel>('payments')
        .find(PAYMENT_ID)
        .catch(() => null);
      expect(found).not.toBeNull();
    });

    it.each(getColumns('payments'))(
      'kolom $name terbaca sesuai nilai dari payload server',
      async (col) => {
        await coordinator.start(db);
        const row = await db.get<PaymentModel>('payments').find(PAYMENT_ID);
        const actual = row._getRaw(col.name);
        const expected = PAYMENTS_EXPECTED[col.name];
        if (col.name === 'updated_at') {
          expect(typeof actual).toBe('number');
          expect(actual).toBeGreaterThan(0);
        } else {
          expect({ column: col.name, actual }).toEqual({
            column: col.name,
            actual: expected,
          });
        }
      },
    );

    it('created_at payment sama dengan waktu server (epoch ms)', async () => {
      await coordinator.start(db);
      const row = await db.get<PaymentModel>('payments').find(PAYMENT_ID);
      const actual = row._getRaw('created_at');
      const expected = parseIsoMs(PAYMENT_PAYLOAD_DATA.createdAt);
      expect(expected).not.toBeNull();
      expect(actual).toBe(expected);
    });

    it('_status row hasil pull adalah "synced"', async () => {
      await coordinator.start(db);
      const row = await db.get<PaymentModel>('payments').find(PAYMENT_ID);
      expect(row._raw._status).toBe('synced');
    });
  });

  // ===== Pull tabel chat_messages =====

  describe('chat_messages pull - jalur tulis applyPull lewat start()', () => {
    beforeEach(() => {
      pullBatchMock.mockResolvedValue(CHAT_PULL_RESPONSE);
    });

    it('prasyarat: setelah pull, baris dengan id chat-regression-1 ada di koleksi chat_messages', async () => {
      await coordinator.start(db);
      const found = await db.get<ChatMessageModel>('chat_messages')
        .find(CHAT_ID)
        .catch(() => null);
      expect(found).not.toBeNull();
    });

    it.each(getColumns('chat_messages'))(
      'kolom $name terbaca sesuai nilai dari payload server',
      async (col) => {
        await coordinator.start(db);
        const row = await db.get<ChatMessageModel>('chat_messages').find(CHAT_ID);
        const actual = row._getRaw(col.name);
        const expected = CHAT_EXPECTED[col.name];
        if (col.name === 'updated_at') {
          expect(typeof actual).toBe('number');
          expect(actual).toBeGreaterThan(0);
        } else {
          expect({ column: col.name, actual }).toEqual({
            column: col.name,
            actual: expected,
          });
        }
      },
    );

    it('attachment_json berisi string JSON yang di-parse jadi objek sama dengan objek uji', async () => {
      await coordinator.start(db);
      const row = await db.get<ChatMessageModel>('chat_messages').find(CHAT_ID);
      expect(readJsonColumn(row, 'attachment_json')).toEqual(CHAT_PAYLOAD_DATA.attachment);
    });

    it('created_at chat_message sama dengan waktu server (epoch ms)', async () => {
      await coordinator.start(db);
      const row = await db.get<ChatMessageModel>('chat_messages').find(CHAT_ID);
      const actual = row._getRaw('created_at');
      const expected = parseIsoMs(CHAT_PAYLOAD_DATA.createdAt);
      expect(expected).not.toBeNull();
      expect(actual).toBe(expected);
    });

    it('_status row hasil pull adalah "synced"', async () => {
      await coordinator.start(db);
      const row = await db.get<ChatMessageModel>('chat_messages').find(CHAT_ID);
      expect(row._raw._status).toBe('synced');
    });
  });

  // ===== fallback created_at/updated_at: createdAt server tidak ada atau tidak valid =====

  describe('fallback created_at/updated_at - createdAt tidak ada atau tidak valid', () => {
    it('order pull tanpa createdAt: created_at > 0 dan updated_at > 0', async () => {
      const NO_CREATED_AT_ORDER_ID = 'order-no-createdat';
      const pullResponse: SyncPullResponse = {
        nextCursor: 'cursor-no-createdat',
        records: [
          {
            entityType: 'order',
            id: NO_CREATED_AT_ORDER_ID,
            serverVersion: 1,
            serverChangedAt: new Date().toISOString(),
            deleted: false,
            // createdAt TIDAK ADA di payload (field dihilangkan -> tes fallback)
            data: {
              id: NO_CREATED_AT_ORDER_ID,
              customerId: 'cust-no-createdat',
              status: 'CONFIRMED',
              items: [],
              deliveryAddress: {
                recipientName: 'No Name',
                phone: '0',
                street: 'No Street',
                city: 'No City',
                postalCode: '0',
                coordinates: [0, 0],
              },
              totalCents: 0,
              currency: 'IDR',
              version: 1,
              updatedAt: '2026-01-20T10:00:00.000Z',
              // payload sengaja tanpa createdAt untuk tes fallback
            } as Partial<Order> as Order, // payload sengaja tanpa createdAt untuk tes fallback
          },
        ],
        serverTime: new Date().toISOString(),
      };
      pullBatchMock.mockResolvedValue(pullResponse);
      await coordinator.start(db);

      const row = await db.get<OrderModel>('orders').find(NO_CREATED_AT_ORDER_ID);
      const createdAt = readNumber(row._getRaw('created_at'));
      const updatedAt = readNumber(row._getRaw('updated_at'));
      expect(createdAt).not.toBeNull();
      expect(updatedAt).not.toBeNull();
      expect(createdAt).toBeGreaterThan(0);
      expect(updatedAt).toBeGreaterThan(0);
    });

    it('order pull dengan createdAt tidak valid (string kosong): created_at > 0 dan updated_at > 0', async () => {
      const INVALID_CREATED_AT_ORDER_ID = 'order-invalid-createdat';
      const pullResponse: SyncPullResponse = {
        nextCursor: 'cursor-invalid-createdat',
        records: [
          {
            entityType: 'order',
            id: INVALID_CREATED_AT_ORDER_ID,
            serverVersion: 1,
            serverChangedAt: new Date().toISOString(),
            deleted: false,
            // createdAt = string kosong (tidak valid)
            data: {
              id: INVALID_CREATED_AT_ORDER_ID,
              customerId: 'cust-invalid-createdat',
              status: 'CONFIRMED',
              items: [],
              deliveryAddress: {
                recipientName: 'X', phone: '0', street: 'X', city: 'X',
                postalCode: '0', coordinates: [0, 0],
              },
              totalCents: 0,
              currency: 'IDR',
              createdAt: '',
              updatedAt: '2026-01-20T10:00:00.000Z',
              version: 1,
            },
          },
        ],
        serverTime: new Date().toISOString(),
      };
      pullBatchMock.mockResolvedValue(pullResponse);
      await coordinator.start(db);

      const row = await db.get<OrderModel>('orders').find(INVALID_CREATED_AT_ORDER_ID);
      const createdAt = readNumber(row._getRaw('created_at'));
      const updatedAt = readNumber(row._getRaw('updated_at'));
      expect(createdAt).not.toBeNull();
      expect(updatedAt).not.toBeNull();
      expect(createdAt).toBeGreaterThan(0);
      expect(updatedAt).toBeGreaterThan(0);
    });

    it('order pull dengan createdAt tidak valid (string bukan tanggal): created_at > 0 dan updated_at > 0', async () => {
      const GARBAGE_CREATED_AT_ORDER_ID = 'order-garbage-createdat';
      const pullResponse: SyncPullResponse = {
        nextCursor: 'cursor-garbage-createdat',
        records: [
          {
            entityType: 'order',
            id: GARBAGE_CREATED_AT_ORDER_ID,
            serverVersion: 1,
            serverChangedAt: new Date().toISOString(),
            deleted: false,
            // createdAt = string bukan tanggal (tidak valid)
            data: {
              id: GARBAGE_CREATED_AT_ORDER_ID,
              customerId: 'cust-garbage-createdat',
              status: 'CONFIRMED',
              items: [],
              deliveryAddress: {
                recipientName: 'X', phone: '0', street: 'X', city: 'X',
                postalCode: '0', coordinates: [0, 0],
              },
              totalCents: 0,
              currency: 'IDR',
              createdAt: 'not-a-valid-date',
              updatedAt: '2026-01-20T10:00:00.000Z',
              version: 1,
            },
          },
        ],
        serverTime: new Date().toISOString(),
      };
      pullBatchMock.mockResolvedValue(pullResponse);
      await coordinator.start(db);

      const row = await db.get<OrderModel>('orders').find(GARBAGE_CREATED_AT_ORDER_ID);
      const createdAt = readNumber(row._getRaw('created_at'));
      const updatedAt = readNumber(row._getRaw('updated_at'));
      expect(createdAt).not.toBeNull();
      expect(updatedAt).not.toBeNull();
      expect(createdAt).toBeGreaterThan(0);
      expect(updatedAt).toBeGreaterThan(0);
    });

    it('payment pull tanpa createdAt: created_at > 0 dan updated_at > 0', async () => {
      const NO_CREATED_AT_PAYMENT_ID = 'payment-no-createdat';
      const pullResponse: SyncPullResponse = {
        nextCursor: 'cursor-no-createdat-payment',
        records: [
          {
            entityType: 'payment',
            id: NO_CREATED_AT_PAYMENT_ID,
            serverVersion: 1,
            serverChangedAt: new Date().toISOString(),
            deleted: false,
            // createdAt TIDAK ADA di payload
            data: {
              id: NO_CREATED_AT_PAYMENT_ID,
              orderId: 'order-for-payment',
              idempotencyKey: 'cod:no-createdat-payment',
              method: 'CASH',
              status: 'PENDING',
              amountCents: 10000,
              currency: 'IDR',
              kind: 'PAYMENT',
              version: 1,
              updatedAt: '2026-01-20T10:00:00.000Z',
              // payload sengaja tanpa createdAt untuk tes fallback
            } as Payment,
          },
        ],
        serverTime: new Date().toISOString(),
      };
      pullBatchMock.mockResolvedValue(pullResponse);
      await coordinator.start(db);

      const row = await db.get<PaymentModel>('payments').find(NO_CREATED_AT_PAYMENT_ID);
      const createdAt = readNumber(row._getRaw('created_at'));
      const updatedAt = readNumber(row._getRaw('updated_at'));
      expect(createdAt).not.toBeNull();
      expect(updatedAt).not.toBeNull();
      expect(createdAt).toBeGreaterThan(0);
      expect(updatedAt).toBeGreaterThan(0);
    });

    it('chat_message pull tanpa createdAt: created_at > 0 dan updated_at > 0', async () => {
      const NO_CREATED_AT_CHAT_ID = 'chat-no-createdat';
      const pullResponse: SyncPullResponse = {
        nextCursor: 'cursor-no-createdat-chat',
        records: [
          {
            entityType: 'chat_message',
            id: NO_CREATED_AT_CHAT_ID,
            serverVersion: 1,
            serverChangedAt: new Date().toISOString(),
            deleted: false,
            // createdAt TIDAK ADA di payload
            data: {
              id: NO_CREATED_AT_CHAT_ID,
              roomId: 'room-no-createdat',
              senderId: 'sender-no-createdat',
              body: 'test message',
              status: 'SENT',
              clientCreatedAt: '2026-01-15T03:04:05.000Z',
              serverCreatedAt: '2026-01-15T03:04:06.500Z',
              version: 1,
              updatedAt: '2026-01-20T10:00:00.000Z',
              // payload sengaja tanpa createdAt untuk tes fallback
            } as ChatMessage,
          },
        ],
        serverTime: new Date().toISOString(),
      };
      pullBatchMock.mockResolvedValue(pullResponse);
      await coordinator.start(db);

      const row = await db.get<ChatMessageModel>('chat_messages').find(NO_CREATED_AT_CHAT_ID);
      const createdAt = readNumber(row._getRaw('created_at'));
      const updatedAt = readNumber(row._getRaw('updated_at'));
      expect(createdAt).not.toBeNull();
      expect(updatedAt).not.toBeNull();
      expect(createdAt).toBeGreaterThan(0);
      expect(updatedAt).toBeGreaterThan(0);
    });
  });
});
