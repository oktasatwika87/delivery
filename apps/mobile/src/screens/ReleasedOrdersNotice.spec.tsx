/**
 * Tes ReleasedOrdersNotice dan dismissReleasedOrders.
 *
 * Komponen diuji dengan data biasa, tanpa LokiJS atau withObservables.
 * dismissReleasedOrders diuji dengan LokiJSAdapter, sama seperti tes
 * coordinator.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { schema } from '../db/schema';
import { OrderModel } from '../db/models/OrderModel';
import { PendingActionModel } from '../db/models/PendingActionModel';
import {
  ReleasedOrdersNotice,
  dismissReleasedOrders,
} from './ReleasedOrdersNotice';

describe('ReleasedOrdersNotice (komponen presentasi)', () => {
  const now = Date.now();
  const withinOneHour = now - 30 * 60 * 1000;
  const oneDayAgo = now - 23 * 60 * 60 * 1000;
  const twoDaysAgo = now - 25 * 60 * 60 * 1000;

  it('menampilkan order dalam 24 jam dengan judul, baris, keterangan, dan tombol Tutup', () => {
    const onOpen = jest.fn();
    const onDismiss = jest.fn();
    const { getByText } = render(
      <ReleasedOrdersNotice
        items={[
          { id: 'order-uuid-1', lastConflictAt: withinOneHour },
        ]}
        onOpen={onOpen}
        onDismiss={onDismiss}
      />,
    );
    // Judul dan baris
    expect(getByText('Order sudah tidak ditugaskan ke Anda')).toBeTruthy();
    expect(getByText('Order #order-uu')).toBeTruthy();
    // Keterangan
    expect(
      getByText(
        'Biasanya karena HP Anda lama tidak tersambung. Ketuk order untuk melihat rinciannya.',
      ),
    ).toBeTruthy();
    // Tombol Tutup
    expect(getByText('Tutup')).toBeTruthy();
  });

  it('tidak menampilkan order yang lastConflictAt-nya lebih dari 24 jam', () => {
    const { queryByText, getByText } = render(
      <ReleasedOrdersNotice
        items={[
          { id: 'order-old', lastConflictAt: twoDaysAgo },
        ]}
        onOpen={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(queryByText('Order #order-ol')).toBeNull();
    // Judul ikut tidak tampil karena tidak ada order yang lolos syarat 24 jam
    expect(queryByText('Order sudah tidak ditugaskan ke Anda')).toBeNull();
    expect(getByText).toBeTruthy();
  });

  it('tidak menampilkan apa pun jika daftar kosong', () => {
    const { queryByText } = render(
      <ReleasedOrdersNotice items={[]} onOpen={jest.fn()} onDismiss={jest.fn()} />,
    );
    expect(queryByText('Order sudah tidak ditugaskan ke Anda')).toBeNull();
  });

  it('tidak menampilkan apa pun jika lastConflictAt null', () => {
    const { queryByText } = render(
      <ReleasedOrdersNotice
        items={[{ id: 'order-null', lastConflictAt: null }]}
        onOpen={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(queryByText('Order sudah tidak ditugaskan ke Anda')).toBeNull();
  });

  it('campuran: hanya yang dalam 24 jam yang tampil', () => {
    const { getByText, queryByText } = render(
      <ReleasedOrdersNotice
        items={[
          { id: 'order-recent', lastConflictAt: withinOneHour },
          { id: 'order-edge', lastConflictAt: oneDayAgo },
          { id: 'order-stale', lastConflictAt: twoDaysAgo },
        ]}
        onOpen={jest.fn()}
        onDismiss={jest.fn()}
      />,
    );
    expect(getByText('Order #order-re')).toBeTruthy();
    expect(getByText('Order #order-ed')).toBeTruthy();
    expect(queryByText('Order #order-st')).toBeNull();
  });

  it('mengetuk baris memanggil onOpen dengan id lengkap', () => {
    const onOpen = jest.fn();
    const onDismiss = jest.fn();
    const fullId = 'order-uuid-1234567890';
    const { getByText } = render(
      <ReleasedOrdersNotice
        items={[{ id: fullId, lastConflictAt: withinOneHour }]}
        onOpen={onOpen}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.press(getByText(`Order #${fullId.slice(0, 8)}`));
    expect(onOpen).toHaveBeenCalledWith(fullId);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('Tutup memanggil onDismiss dengan id lengkap order yang tampil', () => {
    const onOpen = jest.fn();
    const onDismiss = jest.fn();
    const idRecent = 'order-recent-uuid-1';
    const idEdge = 'order-edge-uuid-2';
    const idStale = 'order-stale-uuid-3';
    const { getByText } = render(
      <ReleasedOrdersNotice
        items={[
          { id: idRecent, lastConflictAt: withinOneHour },
          { id: idEdge, lastConflictAt: oneDayAgo },
          { id: idStale, lastConflictAt: twoDaysAgo },
        ]}
        onOpen={onOpen}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.press(getByText('Tutup'));
    // Hanya id yang lolos syarat 24 jam yang dikirim
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledWith([idRecent, idEdge]);
  });
});

// Adapter LokiJS untuk dismissReleasedOrders, sama dengan tes coordinator
function buildTestDatabase(): Database {
  const adapter = new LokiJSAdapter({
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
    onSetUpError: (e: Error) => { throw e; },
  });
  return new Database({
    adapter,
    modelClasses: [OrderModel, PendingActionModel],
  });
}

async function seedOrderRowRaw(
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

describe('dismissReleasedOrders', () => {
  let db: Database;

  beforeEach(() => {
    db = buildTestDatabase();
  });

  it('mengosongkan last_conflict_reason dan last_conflict_at untuk id yang ada, _status synced, _changed kosong', async () => {
    await seedOrderRowRaw(db, 'dismiss-1', {
      customer_id: '',
      driver_id: null,
      status: 'ASSIGNED',
      items_json: '[]',
      address_json: '{}',
      total_cents: 5000,
      currency: 'IDR',
      notes: null,
      server_version: 3,
      deleted_at: null,
      failed_sync_attempts: 0,
      cancelled_by: null,
      cancel_reason: null,
      last_conflict_reason: 'released',
      last_conflict_at: 1700000000000,
      created_at: 1_600_000_000_000,
      updated_at: 1_600_000_000_000,
    });
    await seedOrderRowRaw(db, 'dismiss-2', {
      customer_id: '',
      driver_id: null,
      status: 'ASSIGNED',
      items_json: '[]',
      address_json: '{}',
      total_cents: 5000,
      currency: 'IDR',
      notes: null,
      server_version: 3,
      deleted_at: null,
      failed_sync_attempts: 0,
      cancelled_by: null,
      cancel_reason: null,
      last_conflict_reason: 'reassigned',
      last_conflict_at: 1700000000000,
      created_at: 1_600_000_000_000,
      updated_at: 1_600_000_000_000,
    });

    await dismissReleasedOrders(db, ['dismiss-1', 'dismiss-2']);

    const row1 = await db.get<OrderModel>('orders').find('dismiss-1');
    expect(row1._getRaw('last_conflict_reason')).toBeNull();
    expect(row1._getRaw('last_conflict_at')).toBeNull();
    expect(row1._raw._status).toBe('synced');
    expect(row1._raw._changed).toBe('');

    const row2 = await db.get<OrderModel>('orders').find('dismiss-2');
    expect(row2._getRaw('last_conflict_reason')).toBeNull();
    expect(row2._getRaw('last_conflict_at')).toBeNull();
  });

  it('id yang barisnya tidak ada dilewati (tidak melempar)', async () => {
    await seedOrderRowRaw(db, 'dismiss-keep', {
      customer_id: '',
      driver_id: null,
      status: 'ASSIGNED',
      items_json: '[]',
      address_json: '{}',
      total_cents: 5000,
      currency: 'IDR',
      notes: null,
      server_version: 3,
      deleted_at: null,
      failed_sync_attempts: 0,
      cancelled_by: null,
      cancel_reason: null,
      last_conflict_reason: 'released',
      last_conflict_at: 1700000000000,
      created_at: 1_600_000_000_000,
      updated_at: 1_600_000_000_000,
    });

    // Panggil dengan id campuran: satu ada, satu tidak.
    await expect(
      dismissReleasedOrders(db, ['dismiss-keep', 'tidak-ada']),
    ).resolves.not.toThrow();

    // Baris yang ada tetap dikosongkan
    const row = await db.get<OrderModel>('orders').find('dismiss-keep');
    expect(row._getRaw('last_conflict_reason')).toBeNull();
  });

  it('daftar kosong: tidak melakukan apa-apa', async () => {
    await expect(dismissReleasedOrders(db, [])).resolves.not.toThrow();
  });
});
