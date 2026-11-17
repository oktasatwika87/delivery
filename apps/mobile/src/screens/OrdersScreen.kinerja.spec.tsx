/**
 * Tes kinerja layar Order.
 *
 * Yang diuji: posisi GPS tidak membuat layar digambar ulang, posisi terakhir
 * yang dipakai buat asal rute, dan langganan lokasi ditutup saat layar
 * dilepas.
 *
 * Database tiruan dan tiruan modul disalin dari OrdersScreen.tampilan.spec.tsx.
 */

import React, { Profiler } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@nozbe/watermelondb/react', () => ({
  withDatabase: (C: unknown) => C,
  withObservables: (_trigger: unknown, _getObs: unknown) => (C: unknown) => C,
}));

jest.mock('@nozbe/watermelondb', () => ({
  Q: {
    where: jest.fn().mockReturnValue({ _where: 'test' }),
    sortBy: jest.fn().mockReturnValue({ _sortBy: 'test' }),
  },
  Model: class Model {},
}));

jest.mock('react-native-config', () => ({
  default: { API_BASE_URL: 'http://localhost:3000' },
}));

jest.mock('../sync/session', () => ({
  getCurrentUserId: jest.fn(() => Promise.resolve('driver-123')),
}));

jest.mock('../sync/client', () => {
  class UnauthorizedError extends Error {
    constructor() {
      super('Sesi berakhir, silakan login ulang');
      this.name = 'UnauthorizedError';
    }
  }
  return {
    fetchAvailableOrders: jest.fn(),
    acceptOrder: jest.fn(),
    UnauthorizedError,
    ApiError: jest.requireActual('../sync/client').ApiError,
  };
});

jest.mock('../sync/ordersSocket', () => ({
  ordersSocket: {
    onOrderAvailable: jest.fn().mockReturnValue(jest.fn()),
    onOrderUnavailable: jest.fn().mockReturnValue(jest.fn()),
    on: jest.fn().mockReturnValue(jest.fn()),
  },
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
  }),
}));

jest.mock('../map/routing', () => ({
  GraphHopperRoutingProvider: jest.fn().mockImplementation(() => ({
    getRoute: jest.fn().mockResolvedValue({ distance: 1000, duration: 300 }),
  })),
}));

const mockGetRoute = jest.fn().mockResolvedValue({ distance: 1000, duration: 300 });

jest.mock('../map/routeService', () => ({
  RouteService: jest.fn().mockImplementation(() => ({
    getRoute: (...args: unknown[]) => mockGetRoute(...args),
  })),
}));

/** Posisi GPS yang dipakai tiruan langganan. */
interface PosisiLokasi {
  coords: { latitude: number; longitude: number };
}

const mockPendengarLokasi: Array<(posisi: PosisiLokasi) => void> = [];
const mockBerhentiLangganan = jest.fn();
const mockGetLastKnown = jest.fn();

jest.mock('../map/location', () => ({
  locationService: {
    getLastKnown: () => mockGetLastKnown(),
    subscribe: jest.fn((pendengar: (posisi: PosisiLokasi) => void) => {
      mockPendengarLokasi.push(pendengar);
      return Promise.resolve(mockBerhentiLangganan);
    }),
  },
}));

jest.mock('../map/networkMonitor', () => ({
  networkMonitor: {
    getStatus: jest.fn().mockReturnValue('online'),
    subscribe: jest.fn().mockReturnValue(jest.fn()),
  },
}));

jest.mock('../db', () => ({ database: {} }));

// Baris tiruan. Kolom dibaca layar lewat _getRaw.
interface BarisPalsu {
  id: string;
  _getRaw: (column: string) => unknown;
  prepareUpdate: jest.Mock;
  prepareDestroyPermanently: jest.Mock;
}

interface FieldsBaris {
  id: string;
  status?: string;
  totalCents?: number;
  currency?: string;
  addressJson?: string;
  createdAt?: number;
  updatedAt?: number;
  driverId?: string | null;
}

function makeBaris(fields: FieldsBaris): BarisPalsu {
  const raw: Record<string, unknown> = {
    status: fields.status ?? 'ASSIGNED',
    total_cents: fields.totalCents ?? 25000,
    currency: fields.currency ?? 'IDR',
    address_json: fields.addressJson ?? '{}',
    created_at: fields.createdAt ?? 1_600_000_000_000,
    updated_at: fields.updatedAt ?? 1_600_000_000_000,
    driver_id: fields.driverId ?? null,
    last_conflict_at: null,
    server_version: 3,
    _status: 'synced',
  };
  return {
    id: fields.id,
    _getRaw: (column: string) => raw[column],
    prepareUpdate: jest.fn((cb: (row: unknown) => void) => {
      const row = {
        _setRaw: jest.fn(),
        _raw: { _status: '', _changed: '' },
      };
      cb(row);
      return { _preparedState: 'update', _row: row };
    }),
    prepareDestroyPermanently: jest.fn().mockReturnValue({
      _preparedState: 'destroy',
      _raw: { id: fields.id },
    }),
  };
}

interface AksiPalsu {
  _getRaw: (column: string) => unknown;
}

const mockPendingActionsCollection = {
  query: jest.fn().mockReturnValue({
    fetch: jest.fn().mockResolvedValue([]),
    fetchCount: jest.fn().mockResolvedValue(0),
    observeWithColumns: jest.fn().mockReturnValue({
      subscribe: jest.fn((onChange: (actions: AksiPalsu[]) => void) => {
        onChange([]);
        return { unsubscribe: jest.fn() };
      }),
    }),
  }),
};

const mockOrdersCollection = {
  query: jest.fn().mockReturnValue({
    fetch: jest.fn().mockResolvedValue([]),
    fetchCount: jest.fn().mockResolvedValue(0),
    observe: jest.fn().mockReturnValue({
      subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
    }),
  }),
  find: jest.fn().mockRejectedValue(new Error('not found')),
  create: jest.fn().mockResolvedValue({}),
  prepareCreateFromDirtyRaw: jest.fn().mockReturnValue({
    _preparedState: 'create',
    _raw: { id: '', _status: 'synced' },
  }),
};

const mockDatabase = {
  get: jest.fn((table: string) =>
    table === 'pending_actions' ? mockPendingActionsCollection : mockOrdersCollection,
  ),
  write: jest.fn().mockImplementation(async (fn: () => Promise<void>) => fn()),
  batch: jest.fn().mockResolvedValue(undefined),
};

// Ganti baris pool yang dikembalikan layar.
function setBarisPool(rows: BarisPalsu[]): void {
  mockOrdersCollection.query = jest.fn().mockReturnValue({
    fetch: jest.fn().mockResolvedValue(rows),
    fetchCount: jest.fn().mockResolvedValue(0),
    observe: jest.fn().mockReturnValue({
      subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
    }),
  });
}

import { OrdersScreenBase } from './OrdersScreen';
import { acceptOrder, fetchAvailableOrders } from '../sync/client';

/** Tunggu semua kerja awal layar selesai: bacaan pool dan fetch pertama. */
async function tungguAwalSelesai(getByText: (teks: string) => unknown): Promise<void> {
  await waitFor(() => {
    expect(getByText('Terima Order')).toBeTruthy();
  });
  await waitFor(() => {
    expect(fetchAvailableOrders).toHaveBeenCalled();
  });
  await act(async () => {
    await new Promise<void>((selesai) => setTimeout(selesai, 0));
  });
}

describe('lokasi gps di layar Order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPendengarLokasi.length = 0;
    mockBerhentiLangganan.mockClear();
    mockGetLastKnown.mockReset();
    mockGetLastKnown.mockResolvedValue(null);
    mockGetRoute.mockClear();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue({
      id: 'pool-terima-1',
      customerId: 'cust-1',
      driverId: 'driver-123',
      status: 'PREPARING',
      items: [],
      deliveryAddress: {
        street: 'Jl. Terima 1',
        city: 'Jakarta',
        coordinates: [106.8, -6.2],
      },
      totalCents: 25000,
      currency: 'IDR',
      notes: null,
      createdAt: '2026-01-15T03:04:05.000Z',
      updatedAt: '2026-01-15T03:05:00.000Z',
      version: 4,
      cancelledBy: null,
      cancelReason: null,
    });
    setBarisPool([]);
  });

  test('pembaruan lokasi dari langganan tidak menggambar ulang layar', async () => {
    setBarisPool([makeBaris({ id: 'pool-lokasi-1' })]);
    const onRender = jest.fn();

    const { getByText } = render(
      <Profiler id="layar-order" onRender={onRender}>
        <OrdersScreenBase
          database={mockDatabase as never}
          myOrders={[] as never}
          onLogout={jest.fn()}
        />
      </Profiler>,
    );

    await tungguAwalSelesai(getByText);

    // Layar sudah tenang, jadi hitungan komit tidak berubah sendiri.
    const sebelum = onRender.mock.calls.length;
    expect(sebelum).toBeGreaterThan(0);
    await act(async () => {
      await new Promise<void>((selesai) => setTimeout(selesai, 0));
    });
    expect(onRender.mock.calls.length).toBe(sebelum);

    await act(async () => {
      mockPendengarLokasi[0]({ coords: { latitude: -6.2, longitude: 106.8 } });
    });

    expect(onRender.mock.calls.length).toBe(sebelum);
  });

  test('terima memakai posisi terakhir dari langganan buat asal rute', async () => {
    setBarisPool([makeBaris({ id: 'pool-terima-1' })]);

    const { getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await tungguAwalSelesai(getByText);

    await act(async () => {
      mockPendengarLokasi[0]({ coords: { latitude: -6.1, longitude: 106.9 } });
      mockPendengarLokasi[0]({ coords: { latitude: -6.2, longitude: 106.8 } });
    });

    await act(async () => {
      fireEvent.press(getByText('Terima Order'));
    });

    await waitFor(() => {
      expect(mockGetRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          origin: { lat: -6.2, lng: 106.8 },
        }),
      );
    });
  });

  test('posisi cache yang datang belakangan tidak menimpa posisi langganan', async () => {
    let selesaiCache: ((posisi: PosisiLokasi | null) => void) | undefined;
    mockGetLastKnown.mockImplementation(
      () =>
        new Promise<PosisiLokasi | null>((selesai) => {
          selesaiCache = selesai;
        }),
    );
    setBarisPool([makeBaris({ id: 'pool-terima-1' })]);

    const { getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    // Langganan lebih dulu memberi posisi, cache baru selesai belakangan.
    await act(async () => {
      mockPendengarLokasi[0]({ coords: { latitude: -6.2, longitude: 106.8 } });
    });
    await act(async () => {
      selesaiCache?.({ coords: { latitude: -7.1, longitude: 107.9 } });
    });

    await act(async () => {
      fireEvent.press(getByText('Terima Order'));
    });

    await waitFor(() => {
      expect(mockGetRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          origin: { lat: -6.2, lng: 106.8 },
        }),
      );
    });
  });

  test('layar dilepas berhenti langganan lokasi', async () => {
    setBarisPool([makeBaris({ id: 'pool-lokasi-2' })]);

    const { getByText, unmount } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await tungguAwalSelesai(getByText);

    unmount();

    expect(mockBerhentiLangganan).toHaveBeenCalledTimes(1);
  });
});
