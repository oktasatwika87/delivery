/**
 * Tes layar sukses order selesai diantar.
 *
 * Baris order, payment, dan pending_actions dibuat di database Loki
 * sungguhan, karena pembaca kolomnya lewat _getRaw.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { schema } from '../db/schema';
import { OrderModel } from '../db/models/OrderModel';
import { PaymentModel } from '../db/models/PaymentModel';
import { PendingActionModel } from '../db/models/PendingActionModel';
import { OrderDoneBase } from './OrderDoneScreen';
import { DrawnStroke } from '../components/motion/DrawnPath';
import { formatTunai } from '../components/DaySummary';
import { motion } from '../theme/tokens';
import type { NetworkStatus } from '../map/networkMonitor';

// outbox mengimpor '../db' (adapter SQLite) yang gagal dimuat di Jest.
jest.mock('../db', () => ({ database: {} }));

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn(), replace: jest.fn() }),
  useRoute: () => ({ params: { orderId: 'order-123' } }),
}));

// Status jaringan, bisa diubah tiap tes.
let mockStatus: NetworkStatus = 'online';

jest.mock('../map/networkMonitor', () => ({
  networkMonitor: {
    getStatus: () => mockStatus,
    subscribe: jest.fn((cb: (s: NetworkStatus) => void) => {
      cb(mockStatus);
      return () => {};
    }),
  },
}));

jest.mock('../sync/session', () => ({
  getCurrentUserId: jest.fn().mockResolvedValue('driver-1'),
}));

jest.mock('@nozbe/watermelondb/react', () => ({
  withDatabase: (komponen: unknown) => komponen,
  withObservables: () => (komponen: unknown) => komponen,
}));

// Waktu patokan: hari ini menurut jam HP.
const SEKARANG = Date.now();
const AWAL_HARI = new Date(SEKARANG).setHours(0, 0, 0, 0);
const HARI_INI = AWAL_HARI + 60 * 60 * 1000;

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
  amountCents?: number;
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
      method: 'CASH',
      status: 'CAPTURED',
      amount_cents: isi.amountCents ?? 50000,
      currency: 'IDR',
      kind: 'PAYMENT',
      external_ref: null,
      server_version: 1,
      deleted_at: null,
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

async function renderLayar(db: Database) {
  const myOrders = await db.get<OrderModel>('orders').query().fetch();
  const payments = await db.get<PaymentModel>('payments').query().fetch();
  const actions = await db.get<PendingActionModel>('pending_actions').query().fetch();
  return render(
    <OrderDoneBase myOrders={myOrders} payments={payments} actions={actions} />,
  );
}

describe('layar sukses order selesai diantar', () => {
  let db: Database;

  beforeEach(() => {
    db = buatDatabase();
    mockStatus = 'online';
    mockGoBack.mockClear();
  });

  // Tiruan kurangi gerakan dari satu tes tidak boleh bocor ke tes berikutnya.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('teks utama, nomor order, tombol kembali, dan panel ringkasan tampil', async () => {
    await seedOrder(db, { id: 'order-a', status: 'DELIVERED', updatedAt: HARI_INI });

    const { getByText, getByTestId } = await renderLayar(db);

    expect(getByText('Order selesai diantar')).toBeTruthy();
    expect(getByText('Order #ORDER-12')).toBeTruthy();
    expect(getByText('Kembali ke daftar order')).toBeTruthy();
    expect(getByTestId('panel-ringkasan')).toBeTruthy();
  });

  test('angka selesai bergulir dari satu ke dua, tunai tetap', async () => {
    await seedOrder(db, { id: 'order-a', status: 'DELIVERED', updatedAt: HARI_INI });
    await seedOrder(db, { id: 'order-b', status: 'OUT_FOR_DELIVERY', updatedAt: AWAL_HARI });
    await seedAksi(db, {
      id: 'pa-1',
      actionType: 'update_status',
      targetOrderId: 'order-b',
      status: 'pending',
      payloadJson: '{"status":"DELIVERED"}',
      createdAt: HARI_INI,
    });
    await seedPayment(db, {
      id: 'pay-1',
      orderId: 'order-b',
      amountCents: 50000,
      createdAt: HARI_INI,
    });

    const { getByText } = await renderLayar(db);

    expect(getByText('1 selesai')).toBeTruthy();
    expect(getByText(formatTunai(50000, 'IDR'))).toBeTruthy();

    await waitFor(
      () => {
        expect(getByText('2 selesai')).toBeTruthy();
      },
      { timeout: 2000 },
    );

    // Tunai tidak ikut bergulir, nilainya sama saja.
    expect(getByText(formatTunai(50000, 'IDR'))).toBeTruthy();
  });

  test('angka selesai paling kecil nol', async () => {
    await seedOrder(db, { id: 'order-b', status: 'OUT_FOR_DELIVERY', updatedAt: AWAL_HARI });
    await seedAksi(db, {
      id: 'pa-1',
      actionType: 'update_status',
      targetOrderId: 'order-b',
      status: 'pending',
      payloadJson: '{"status":"DELIVERED"}',
      createdAt: HARI_INI,
    });

    const { getByText } = await renderLayar(db);

    expect(getByText('0 selesai')).toBeTruthy();

    await waitFor(
      () => {
        expect(getByText('1 selesai')).toBeTruthy();
      },
      { timeout: 2000 },
    );
  });

  test('kurangi gerakan: angka langsung nilai akhir dan centang tidak digambar', async () => {
    const reanimated = require('react-native-reanimated') as {
      useReducedMotion: () => boolean;
    };
    jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);

    await seedOrder(db, { id: 'order-a', status: 'DELIVERED', updatedAt: HARI_INI });
    await seedOrder(db, { id: 'order-b', status: 'OUT_FOR_DELIVERY', updatedAt: AWAL_HARI });
    await seedAksi(db, {
      id: 'pa-1',
      actionType: 'update_status',
      targetOrderId: 'order-b',
      status: 'pending',
      payloadJson: '{"status":"DELIVERED"}',
      createdAt: HARI_INI,
    });

    const { getByText, queryByText, UNSAFE_getAllByType } = await renderLayar(db);

    expect(getByText('2 selesai')).toBeTruthy();
    expect(queryByText('1 selesai')).toBeNull();

    await new Promise((selesai) => setTimeout(selesai, 1000));
    expect(queryByText('1 selesai')).toBeNull();

    const centang = UNSAFE_getAllByType(DrawnStroke);
    expect(centang.length).toBeGreaterThan(0);
    expect(centang[0].props.animate).toBe(false);
  });

  test('centang digambar setelah layar selesai memudar masuk', async () => {
    const { UNSAFE_getAllByType } = await renderLayar(db);

    const centang = UNSAFE_getAllByType(DrawnStroke);
    expect(centang.length).toBeGreaterThan(0);
    expect(centang[0].props.animate).toBe(true);
    expect(centang[0].props.delay).toBe(motion.duration.enter);
  });

  test('tombol kembali ke daftar order memanggil navigasi kembali', async () => {
    const { getByText } = await renderLayar(db);

    fireEvent.press(getByText('Kembali ke daftar order'));

    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });

  test('bilah koneksi menampilkan antrean saat online dan offline saat offline', async () => {
    await seedOrder(db, { id: 'order-a', status: 'DELIVERED', updatedAt: HARI_INI });
    await seedAksi(db, {
      id: 'pa-1',
      actionType: 'collect_cod',
      targetOrderId: 'order-a',
      status: 'pending',
      payloadJson: '{"amountCents":25000}',
      createdAt: HARI_INI,
    });

    const online = await renderLayar(db);
    expect(online.getByText('Menyinkronkan')).toBeTruthy();
    online.unmount();

    mockStatus = 'offline';
    const offline = await renderLayar(db);
    expect(offline.getByText(/^Offline/)).toBeTruthy();
  });
});
