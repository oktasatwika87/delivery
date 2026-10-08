/**
 * Tests for CustomerHomeScreen.
 *
 * Daftar order customer login. Sumber data: tabel orders lokal yang
 * di-pull dari server (lihat SyncCoordinator). Sumber reaktivitas:
 * withObservables + observeWithColumns(['status', 'total_cents']) -
 * mutasi kolom status atau total_cents pada baris yang sama akan
 * memicu re-emit nilai yang sama (WatermelonDB idiom), jadi baris
 * render ulang saat status berubah dari pull berikutnya.
 *
 * Pola mock HOC (withDatabase identity, withObservables subscribe-and-
 * re-render) dibutuhkan supaya test (a) dan (c) bisa memverifikasi
 * argumen query/observeWithColumns dan mendorong nilai lewat Subject.
 */

import React from 'react';
import {
  act,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import { Subject } from 'rxjs';

// --- Mock Q (where, sortBy, desc) -------------------------------------------------------------------------
const mockQWhere = jest.fn((col: string, val: unknown) => ({
  __type: 'where',
  col,
  val,
}));
const mockQSortBy = jest.fn((col: string, dir: unknown) => ({
  __type: 'sortBy',
  col,
  dir,
}));

jest.mock('@nozbe/watermelondb', () => ({
  Q: {
    where: (col: string, val: unknown) => mockQWhere(col, val),
    sortBy: (col: string, dir: unknown) => mockQSortBy(col, dir),
    desc: 'desc',
  },
}));

// --- Mock Subject + database collection ---------------------------------------------------------------
const ordersSubject = new Subject<unknown[]>();

const mockObserveWithColumns = jest.fn(() => ordersSubject);
const mockQuery = jest.fn(() => ({ observeWithColumns: mockObserveWithColumns }));
const mockCollection = { query: mockQuery };
const mockDatabaseGet = jest.fn(() => mockCollection);
const mockDatabase = { get: mockDatabaseGet };

// --- Mock @nozbe/watermelondb/react ----------------------------------------------------------------
jest.mock('@nozbe/watermelondb/react', () => {
  // eslint-disable-next-line @typescript-eslint/no-shadow
  const { createElement, useState, useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    withDatabase: (Component: React.ComponentType<Record<string, unknown>>) =>
      (props: Record<string, unknown>) => createElement(Component, { ...props, database: mockDatabase }),
    withObservables: (
      triggerProps: string[],
      getObs: (
        props: Record<string, unknown>,
      ) => Record<
        string,
        { subscribe: (cb: (v: unknown) => void) => { unsubscribe: () => void } }
      >,
    ): ((
      Base: React.ComponentType<Record<string, unknown>>,
    ) => React.ComponentType<Record<string, unknown>>) => {
      return (
        Base: React.ComponentType<Record<string, unknown>>,
      ): React.ComponentType<Record<string, unknown>> => {
        function HOCWrapper(props: Record<string, unknown>): React.JSX.Element {
          const [obsValues, setObsValues] = useState<Record<string, unknown>>({});
          const triggerKey = triggerProps
            .map((p) => String(props[p]))
            .join('|');
          useEffect(() => {
            const observables = getObs(props);
            const subs: Array<{ unsubscribe: () => void }> = [];
            for (const [key, value] of Object.entries(observables)) {
              if (value && typeof value.subscribe === 'function') {
                const sub = value.subscribe((v: unknown) => {
                  setObsValues((prev) => ({ ...prev, [key]: v }));
                });
                subs.push(sub);
              }
            }
            return () => {
              for (const s of subs) s.unsubscribe();
            };
          }, [triggerKey]);
          return createElement(Base, { ...props, ...obsValues });
        }
        HOCWrapper.displayName = 'WithObservablesHOC';
        return HOCWrapper;
      };
    },
  };
});

// --- Mock session.getCurrentUserId --------------------------------------------------------------
const mockGetCurrentUserId = jest.fn();
jest.mock('../sync/session', () => ({
  getCurrentUserId: () => mockGetCurrentUserId(),
}));

// Impor komponen setelah mocks
import { CustomerHomeScreen } from './CustomerHomeScreen';

// --- Helpers --------------------------------------------------------------------------------------
function makeOrder(
  overrides: Partial<{
    id: string;
    customerId: string;
    status: string;
    totalCents: number;
    currency: string;
  }> = {},
): {
  id: string;
  customerId: string;
  status: string;
  totalCents: number;
  currency: string;
} {
  return {
    id: 'order-uuid-1a2b3c4d',
    customerId: 'user-1',
    status: 'ASSIGNED',
    totalCents: 50000,
    currency: 'IDR',
    ...overrides,
  };
}

function renderScreen(): { mockNavigate: jest.Mock; getByText: (text: string | RegExp) => ReturnType<ReturnType<typeof render>['getByText']>; queryByText: (text: string | RegExp) => ReturnType<ReturnType<typeof render>['queryByText']> } {
  const mockNavigate = jest.fn();
  const mockNavigation = { navigate: mockNavigate };
  const result = render(
    <CustomerHomeScreen
      onLogout={jest.fn()}
      navigation={mockNavigation}
    />,
  );
  return {
    mockNavigate,
    getByText: result.getByText,
    queryByText: result.queryByText,
  };
}

beforeEach(() => {
  mockQWhere.mockClear();
  mockQSortBy.mockClear();
  mockObserveWithColumns.mockClear();
  mockQuery.mockClear();
  mockDatabaseGet.mockClear();
  mockGetCurrentUserId.mockReset();
  mockGetCurrentUserId.mockResolvedValue('user-1');
});

describe('CustomerHomeScreen', () => {
  it('(a) query dibuat dengan where customer_id = id user login dan sort created_at desc', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1');

    renderScreen();

    await waitFor(() => {
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    expect(mockQWhere).toHaveBeenCalledWith('customer_id', 'user-1');
    expect(mockQSortBy).toHaveBeenCalledWith('created_at', 'desc');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ __type: 'where', col: 'customer_id', val: 'user-1' }),
      expect.objectContaining({ __type: 'sortBy', col: 'created_at' }),
    );
  });

  it('(b) baris menampilkan id pendek, "Mencari driver" untuk ASSIGNED, dan total Rp', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1');
    const order = makeOrder({
      id: 'order-abcdef1234567890',
      status: 'ASSIGNED',
      totalCents: 50000,
      currency: 'IDR',
    });

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(mockObserveWithColumns).toHaveBeenCalledTimes(1);
    });
    act(() => {
      ordersSubject.next([order]);
    });

    await waitFor(() => {
      expect(getByText('#ORDER-AB')).toBeTruthy();
    });
    expect(getByText('Mencari driver...')).toBeTruthy();
    expect(getByText('Rp 50.000')).toBeTruthy();
  });

  it('(c) observeWithColumns dipanggil dengan kolom status dan total_cents; emit record termutasi memperbarui label', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1');
    const order = makeOrder({ status: 'ASSIGNED' });

    const { getByText, queryByText } = renderScreen();

    await waitFor(() => {
      expect(mockObserveWithColumns).toHaveBeenCalledTimes(1);
    });
    expect(mockObserveWithColumns).toHaveBeenCalledWith(['status', 'total_cents']);

    act(() => {
      ordersSubject.next([order]);
    });

    await waitFor(() => {
      expect(getByText('Mencari driver...')).toBeTruthy();
    });

    // Ubah objek record YANG SAMA ke PREPARING, lalu kirim ulang.
    order.status = 'PREPARING';
    act(() => {
      ordersSubject.next([order]);
    });

    await waitFor(() => {
      expect(getByText('Driver sedang menyiapkan')).toBeTruthy();
    });
    expect(queryByText('Mencari driver...')).toBeNull();
  });

  it('(d) ketuk baris memanggil navigasi ke tracking dengan id order', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1');
    const order = makeOrder({ id: 'order-trackme-1' });

    const { mockNavigate, getByText } = renderScreen();

    await waitFor(() => {
      expect(mockObserveWithColumns).toHaveBeenCalledTimes(1);
    });
    act(() => {
      ordersSubject.next([order]);
    });

    const orderTitleEl = await waitFor(() => getByText('#ORDER-TR'));

    fireEvent.press(orderTitleEl);

    expect(mockNavigate).toHaveBeenCalledWith('OrderTracking', { orderId: 'order-trackme-1' });
  });

  it('(e) daftar kosong menampilkan "Belum ada order."', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1');

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(mockObserveWithColumns).toHaveBeenCalledTimes(1);
    });
    act(() => {
      ordersSubject.next([]);
    });

    await waitFor(() => {
      expect(getByText('Belum ada order.')).toBeTruthy();
    });
    expect(getByText('Order saya')).toBeTruthy();
  });

  it('(f) userId kosong: tidak ada query', async () => {
    mockGetCurrentUserId.mockResolvedValue(null);

    const { getByText } = renderScreen();

    // Tunggu sampai wrapper resolve userId = null dan HOC re-run
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockQWhere).not.toHaveBeenCalled();
    expect(mockQSortBy).not.toHaveBeenCalled();
    expect(getByText('Belum ada order.')).toBeTruthy();
  });

  it('(g) tombol Logout tampil; ditekan memanggil onLogout', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1');
    const onLogout = jest.fn();
    const mockNavigate = jest.fn();
    const mockNavigation = { navigate: mockNavigate };
    const { getByText } = render(
      <CustomerHomeScreen onLogout={onLogout} navigation={mockNavigation} />,
    );

    const logoutBtn = getByText('Logout');
    fireEvent.press(logoutBtn);

    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('(h) tombol Buat Order Baru ditekan memanggil navigate(OrderCreate)', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1');
    const onLogout = jest.fn();
    const mockNavigate = jest.fn();
    const mockNavigation = { navigate: mockNavigate };
    const { getByText } = render(
      <CustomerHomeScreen onLogout={onLogout} navigation={mockNavigation} />,
    );

    await waitFor(() => {
      expect(mockObserveWithColumns).toHaveBeenCalledTimes(1);
    });
    act(() => {
      ordersSubject.next([]);
    });

    fireEvent.press(getByText('Buat Order Baru'));
    expect(mockNavigate).toHaveBeenCalledWith('OrderCreate');
  });

  it('(i) 15 order di daftar: ke-15 baris tampil dan tombol Logout serta Buat Order Baru tetap ada', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-1');
    // id unik di 8 char pertama supaya slice(0,8) tiap order beda
    const orders = Array.from({ length: 15 }, (_, i) =>
      makeOrder({ id: `ordr${String(i).padStart(4, '0')}xyz` }),
    );

    const { getByText } = renderScreen();

    await waitFor(() => {
      expect(mockObserveWithColumns).toHaveBeenCalledTimes(1);
    });
    act(() => {
      ordersSubject.next(orders);
    });

    // Semua 15 id order muncul (slice(0,8) di komponen)
    for (let i = 0; i < 15; i++) {
      const shortId = `#ORDR${String(i).padStart(4, '0')}`.toUpperCase();
      await waitFor(() => {
        expect(getByText(new RegExp(shortId))).toBeTruthy();
      });
    }

    // Tombol tetap ada
    expect(getByText('Logout')).toBeTruthy();
    expect(getByText('Buat Order Baru')).toBeTruthy();
  });
});
