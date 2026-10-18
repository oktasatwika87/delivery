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
import { PendingActionModel } from '../db/models/PendingActionModel';
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

jest.mock('./cursor', () => ({
  loadCursor: jest.fn().mockResolvedValue(null),
  saveCursor: jest.fn().mockResolvedValue(undefined),
  getCursorSync: jest.fn().mockReturnValue(null),
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

// =================================================================
// heldOrderIds dan releasedOrders
// =================================================================

// DB LokiJS untuk blok tes ini juga memuat PendingActionModel, karena
// penandaan lepas membaca dan menghapus pending_actions. Id akun yang login
// berasal dari tiruan session: 'driver-regression-pull'.

const RELEASE_TEST_USER = 'driver-regression-pull';

const RELEASED_BASE_ROW: Record<string, unknown> = {
  customer_id: 'cust-release-1',
  driver_id: RELEASE_TEST_USER,
  status: 'ASSIGNED',
  items_json: '[]',
  address_json: '{}',
  total_cents: 50000,
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
};

// Respons pull berisi releasedOrders dan, kalau perlu, records.
function makeReleasedResponse(
  released: Array<{ id: string; version: number }>,
  records: Order[] = [],
  nextCursor: string | null = 'cursor-after-release',
): SyncPullResponse {
  return {
    nextCursor,
    records: records.map((o) => ({
      entityType: 'order',
      id: o.id,
      serverVersion: o.version,
      serverChangedAt: '2026-02-15T10:00:00.000Z',
      deleted: false,
      data: o,
    })),
    releasedOrders: released,
    serverTime: '2026-02-15T10:00:00.000Z',
  };
}

describe('heldOrderIds dan releasedOrders', () => {
  let db: Database;
  let coordinator: SyncCoordinator;
  let pullBatchMock: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    const adapter = new LokiJSAdapter({
      schema,
      useWebWorker: false,
      useIncrementalIndexedDB: false,
      onSetUpError: (e: Error) => { throw e; },
    });
    db = new Database({
      adapter,
      modelClasses: [OrderModel, PaymentModel, ChatMessageModel, PendingActionModel],
    });
    const client = jest.requireMock<{ pullBatch: jest.Mock }>('./client');
    pullBatchMock = client.pullBatch;
    pullBatchMock.mockReset();
    coordinator = jest.requireActual<typeof import('./coordinator')>('./coordinator').syncCoordinator;
  });

  afterEach(() => {
    if (coordinator) coordinator.stop();
  });

  it('argumen ketiga pullBatch hanya berisi id baris aktif milik akun yang login (bukan DELIVERED, bukan milik driver lain, bukan baris pool, bukan baris terhapus)', async () => {
    // Baris aktif milik akun ini, ikut.
    await seedSnakeCaseRow(db, 'orders', 'rel-mine-1', { ...RELEASED_BASE_ROW, driver_id: RELEASE_TEST_USER, status: 'ASSIGNED' });
    await seedSnakeCaseRow(db, 'orders', 'rel-mine-2', { ...RELEASED_BASE_ROW, driver_id: RELEASE_TEST_USER, status: 'PREPARING', server_version: 7 });
    await seedSnakeCaseRow(db, 'orders', 'rel-mine-3', { ...RELEASED_BASE_ROW, driver_id: RELEASE_TEST_USER, status: 'OUT_FOR_DELIVERY', server_version: 8 });
    // Baris DELIVERED milik akun ini, tidak ikut.
    await seedSnakeCaseRow(db, 'orders', 'rel-mine-delivered', { ...RELEASED_BASE_ROW, driver_id: RELEASE_TEST_USER, status: 'DELIVERED' });
    // Baris milik driver lain, tidak ikut.
    await seedSnakeCaseRow(db, 'orders', 'rel-other', { ...RELEASED_BASE_ROW, driver_id: 'other-driver', status: 'PREPARING' });
    // Baris pool (driver_id null), tidak ikut.
    await seedSnakeCaseRow(db, 'orders', 'rel-pool', { ...RELEASED_BASE_ROW, driver_id: null, status: 'ASSIGNED' });
    // Baris milik akun ini dengan deleted_at terisi, tidak ikut.
    await seedSnakeCaseRow(db, 'orders', 'rel-mine-soft', { ...RELEASED_BASE_ROW, driver_id: RELEASE_TEST_USER, status: 'PREPARING', deleted_at: 1234 });

    pullBatchMock.mockResolvedValue(makeReleasedResponse([]));

    await coordinator.start(db);

    expect(pullBatchMock).toHaveBeenCalledTimes(1);
    const held: string[] = pullBatchMock.mock.calls[0][2];
    expect(held).toEqual(expect.arrayContaining(['rel-mine-1', 'rel-mine-2', 'rel-mine-3']));
    expect(held).not.toContain('rel-mine-delivered');
    expect(held).not.toContain('rel-other');
    expect(held).not.toContain('rel-pool');
    expect(held).not.toContain('rel-mine-soft');
  });

  it('belum login: pullBatch menerima daftar kosong', async () => {
    // Panggilan pertama getCurrentUserId mengembalikan null, seperti belum login.
    const session = jest.requireMock<{ getCurrentUserId: jest.Mock }>('./session');
    session.getCurrentUserId.mockResolvedValueOnce(null);
    // Baris ini akan ikut kalau ada akun yang login.
    await seedSnakeCaseRow(db, 'orders', 'rel-mine-1', { ...RELEASED_BASE_ROW, driver_id: RELEASE_TEST_USER, status: 'ASSIGNED' });

    pullBatchMock.mockResolvedValue(makeReleasedResponse([]));

    await coordinator.start(db);

    const held: string[] = pullBatchMock.mock.calls[0][2];
    expect(held).toEqual([]);
  });

  it('laporan lepas: kolom driver_id null, last_conflict_reason "released", last_conflict_at terisi, _status synced, _changed kosong', async () => {
    await seedSnakeCaseRow(db, 'orders', 'rel-row-1', { ...RELEASED_BASE_ROW, driver_id: RELEASE_TEST_USER, status: 'PREPARING' });

    pullBatchMock.mockResolvedValue(makeReleasedResponse([{ id: 'rel-row-1', version: 6 }]));

    await coordinator.start(db);

    const row = await db.get<OrderModel>('orders').find('rel-row-1');
    expect(row._getRaw('driver_id')).toBeNull();
    expect(row._getRaw('last_conflict_reason')).toBe('released');
    expect(typeof row._getRaw('last_conflict_at')).toBe('number');
    expect(row._raw._status).toBe('synced');
    expect(row._raw._changed).toBe('');
  });

  it('records kosong + laporan lepas: baris tetap ditandai, saveCursor tidak dipanggil', async () => {
    // Modul cursor ditiru di atas, jadi pemanggilan saveCursor bisa dicek.
    const cursor = jest.requireMock<{ saveCursor: jest.Mock }>('./cursor');
    cursor.saveCursor.mockClear();

    await seedSnakeCaseRow(db, 'orders', 'rel-row-2', { ...RELEASED_BASE_ROW, driver_id: RELEASE_TEST_USER, status: 'ASSIGNED' });

    // Respons tanpa records, hanya releasedOrders.
    pullBatchMock.mockResolvedValue({
      nextCursor: 'cursor-should-not-be-saved',
      records: [],
      releasedOrders: [{ id: 'rel-row-2', version: 7 }],
      serverTime: '2026-02-15T10:00:00.000Z',
    });

    await coordinator.start(db);

    const row = await db.get<OrderModel>('orders').find('rel-row-2');
    expect(row._getRaw('driver_id')).toBeNull();
    expect(row._getRaw('last_conflict_reason')).toBe('released');
    // saveCursor tidak dipanggil karena records kosong
    expect(cursor.saveCursor).not.toHaveBeenCalled();
  });

  it('versi lokal lebih besar dari laporan: baris tidak disentuh', async () => {
    await seedSnakeCaseRow(db, 'orders', 'rel-row-3', { ...RELEASED_BASE_ROW, driver_id: RELEASE_TEST_USER, status: 'PREPARING', server_version: 10 });

    pullBatchMock.mockResolvedValue(makeReleasedResponse([{ id: 'rel-row-3', version: 6 }]));

    await coordinator.start(db);

    const row = await db.get<OrderModel>('orders').find('rel-row-3');
    // driver_id tetap, last_conflict_reason tetap null
    expect(row._getRaw('driver_id')).toBe(RELEASE_TEST_USER);
    expect(row._getRaw('last_conflict_reason')).toBeNull();
  });

  it('baris milik driver lain: tidak disentuh', async () => {
    await seedSnakeCaseRow(db, 'orders', 'rel-row-4', { ...RELEASED_BASE_ROW, driver_id: 'someone-else', status: 'PREPARING' });

    pullBatchMock.mockResolvedValue(makeReleasedResponse([{ id: 'rel-row-4', version: 6 }]));

    await coordinator.start(db);

    const row = await db.get<OrderModel>('orders').find('rel-row-4');
    expect(row._getRaw('driver_id')).toBe('someone-else');
    expect(row._getRaw('last_conflict_reason')).toBeNull();
  });

  it('aksi update_status "pending" untuk order: baris dan aksinya tidak disentuh', async () => {
    await seedSnakeCaseRow(db, 'orders', 'rel-row-5', { ...RELEASED_BASE_ROW, driver_id: RELEASE_TEST_USER, status: 'PREPARING' });
    // Aksi update_status 'pending' untuk order ini (bukan collect_cod).
    await seedSnakeCaseRow(db, 'pending_actions', 'pa-pending-1', {
      action_type: 'update_status',
      target_order_id: 'rel-row-5',
      expected_version: 5,
      idempotency_key: 'status:rel-row-5:OUT_FOR_DELIVERY',
      payload_json: '{"status":"OUT_FOR_DELIVERY"}',
      status: 'pending',
      created_at: 1700000000000,
      updated_at: 1700000000000,
    });

    pullBatchMock.mockResolvedValue(makeReleasedResponse([{ id: 'rel-row-5', version: 6 }]));

    await coordinator.start(db);

    const row = await db.get<OrderModel>('orders').find('rel-row-5');
    // Baris tidak disentuh, driver_id tetap
    expect(row._getRaw('driver_id')).toBe(RELEASE_TEST_USER);
    expect(row._getRaw('last_conflict_reason')).toBeNull();
    // Aksi tetap ada
    const act = await db.get<PendingActionModel>('pending_actions').find('pa-pending-1');
    expect(act._getRaw('status')).toBe('pending');
  });

  it('aksi update_status "failed": baris ditandai, aksi dihapus', async () => {
    await seedSnakeCaseRow(db, 'orders', 'rel-row-6', { ...RELEASED_BASE_ROW, driver_id: RELEASE_TEST_USER, status: 'PREPARING' });
    await seedSnakeCaseRow(db, 'pending_actions', 'pa-failed-1', {
      action_type: 'update_status',
      target_order_id: 'rel-row-6',
      expected_version: 5,
      idempotency_key: 'status:rel-row-6:OUT_FOR_DELIVERY',
      payload_json: '{"status":"OUT_FOR_DELIVERY"}',
      status: 'failed',
      created_at: 1700000000000,
      updated_at: 1700000000000,
    });

    pullBatchMock.mockResolvedValue(makeReleasedResponse([{ id: 'rel-row-6', version: 6 }]));

    await coordinator.start(db);

    const row = await db.get<OrderModel>('orders').find('rel-row-6');
    expect(row._getRaw('driver_id')).toBeNull();
    expect(row._getRaw('last_conflict_reason')).toBe('released');
    // Aksi 'failed' dihapus
    const all = await db.get<PendingActionModel>('pending_actions').query().fetch();
    expect(all.find((a) => a.id === 'pa-failed-1')).toBeUndefined();
  });

  it('aksi collect_cod "pending" untuk order: baris ditandai, aksi COD tetap ada', async () => {
    await seedSnakeCaseRow(db, 'orders', 'rel-row-7', { ...RELEASED_BASE_ROW, driver_id: RELEASE_TEST_USER, status: 'OUT_FOR_DELIVERY' });
    await seedSnakeCaseRow(db, 'pending_actions', 'pa-cod-1', {
      action_type: 'collect_cod',
      target_order_id: 'rel-row-7',
      expected_version: 5,
      idempotency_key: 'cod:rel-row-7:uuid-1',
      payload_json: '{"amountCents":50000}',
      status: 'pending',
      created_at: 1700000000000,
      updated_at: 1700000000000,
    });

    pullBatchMock.mockResolvedValue(makeReleasedResponse([{ id: 'rel-row-7', version: 6 }]));

    await coordinator.start(db);

    const row = await db.get<OrderModel>('orders').find('rel-row-7');
    expect(row._getRaw('driver_id')).toBeNull();
    expect(row._getRaw('last_conflict_reason')).toBe('released');
    // Aksi collect_cod tetap ada
    const act = await db.get<PendingActionModel>('pending_actions').find('pa-cod-1');
    expect(act._getRaw('status')).toBe('pending');
  });

  it('order yang sama di records dan releasedOrders (versi laporan >= record): tidak ada galat, baris ditandai', async () => {
    // Baris lokal: PREPARING, server_version 5.
    await seedSnakeCaseRow(db, 'orders', 'rel-row-8', { ...RELEASED_BASE_ROW, driver_id: RELEASE_TEST_USER, status: 'PREPARING', server_version: 5 });
    // Record dari server versi 6, laporan juga versi 6. Versi laporan sama
    // atau lebih besar, jadi record dilewati dan baris ditandai lepas.
    const orderRecord: Order = {
      id: 'rel-row-8',
      customerId: 'cust-release-1',
      driverId: RELEASE_TEST_USER,
      status: 'PREPARING',
      items: [],
      deliveryAddress: { recipientName: 'X', phone: '0', street: 'X', city: 'X', postalCode: '0' },
      totalCents: 50000,
      currency: 'IDR',
      version: 6,
      createdAt: '2026-02-15T09:00:00.000Z',
      updatedAt: '2026-02-15T09:00:00.000Z',
    };
    pullBatchMock.mockResolvedValue(makeReleasedResponse([{ id: 'rel-row-8', version: 6 }], [orderRecord]));

    await coordinator.start(db);

    const row = await db.get<OrderModel>('orders').find('rel-row-8');
    // Baris ditandai lepas, status tidak berubah dari PREPARING
    expect(row._getRaw('driver_id')).toBeNull();
    expect(row._getRaw('last_conflict_reason')).toBe('released');
    expect(row._getRaw('status')).toBe('PREPARING');
  });

  it('order yang sama di records dan releasedOrders (record lebih baru dari laporan): pullNow tidak null, last_conflict_reason tetap null', async () => {
    // Baris lokal: PREPARING, server_version 5.
    await seedSnakeCaseRow(db, 'orders', 'rel-row-X', { ...RELEASED_BASE_ROW, driver_id: RELEASE_TEST_USER, status: 'PREPARING', server_version: 5 });

    // Pull pertama dari start() kosong; yang diuji pull berikutnya.
    pullBatchMock.mockResolvedValueOnce(makeReleasedResponse([]));
    await coordinator.start(db);

    // pullNow membawa record X versi 7 (lebih baru dari lokal 5 dan laporan
    // 6) dan laporan versi 6. Record dipakai dan laporan diabaikan. Kalau
    // baris yang sama disiapkan dua kali, write gagal dan pullNow
    // mengembalikan null.
    const orderRecord: Order = {
      id: 'rel-row-X',
      customerId: 'cust-release-1',
      driverId: RELEASE_TEST_USER,
      status: 'PREPARING',
      items: [],
      deliveryAddress: { recipientName: 'X', phone: '0', street: 'X', city: 'X', postalCode: '0' },
      totalCents: 50000,
      currency: 'IDR',
      version: 7,
      createdAt: '2026-02-15T09:00:00.000Z',
      updatedAt: '2026-02-15T09:00:00.000Z',
    };
    pullBatchMock.mockResolvedValueOnce(makeReleasedResponse([{ id: 'rel-row-X', version: 6 }], [orderRecord]));

    const result = await coordinator.pullNow();

    expect(result).not.toBeNull();
    const row = await db.get<OrderModel>('orders').find('rel-row-X');
    expect(row._getRaw('last_conflict_reason')).toBeNull();
  });

  it('pool-refresh dipancarkan sekali kalau ada yang ditandai, tidak dipancarkan kalau tidak ada', async () => {
    const syncEvents = jest.requireMock<{ syncEvents: { emit: jest.Mock } }>('./syncEvents');

    // Ada baris ditandai lepas
    await seedSnakeCaseRow(db, 'orders', 'rel-row-9', { ...RELEASED_BASE_ROW, driver_id: RELEASE_TEST_USER, status: 'PREPARING' });
    pullBatchMock.mockResolvedValue(makeReleasedResponse([{ id: 'rel-row-9', version: 6 }]));
    await coordinator.start(db);

    const poolRefreshCalls = syncEvents.syncEvents.emit.mock.calls.filter(
      ([event]) => event === 'pool-refresh',
    );
    expect(poolRefreshCalls).toHaveLength(1);
    expect(syncEvents.syncEvents.emit).toHaveBeenCalledWith('pool-refresh', { source: 'released' });

    // Bagian kedua: laporan untuk baris milik driver lain tidak memicu
    // penandaan.
    syncEvents.syncEvents.emit.mockClear();
    await seedSnakeCaseRow(db, 'orders', 'rel-row-10', { ...RELEASED_BASE_ROW, driver_id: 'someone-else', status: 'PREPARING' });
    // Hentikan dulu supaya start() berjalan lagi dari awal.
    coordinator.stop();
    const coordinator2 = jest.requireActual<typeof import('./coordinator')>('./coordinator').syncCoordinator;
    pullBatchMock.mockResolvedValue(makeReleasedResponse([{ id: 'rel-row-10', version: 6 }]));
    await coordinator2.start(db);

    const poolRefreshCalls2 = syncEvents.syncEvents.emit.mock.calls.filter(
      ([event]) => event === 'pool-refresh',
    );
    expect(poolRefreshCalls2).toHaveLength(0);
    expect(syncEvents.syncEvents.emit).not.toHaveBeenCalledWith('pool-refresh', { source: 'released' });
  });
});
