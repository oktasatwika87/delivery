/**
 * Tes kinerja layar Order.
 *
 * Yang diuji: posisi GPS tidak membuat layar digambar ulang, posisi terakhir
 * yang dipakai buat asal rute, langganan lokasi ditutup saat layar
 * dilepas, dan ganti tab tidak memasang ulang kartu.
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

// Objek navigasi dijaga tetap sama, seperti aslinya. Kalau berubah tiap
// render, kartu akan digambar ulang terus.
const mockNavigasi = { navigate: jest.fn() };

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigasi,
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

// Hitungan gambar per nomor order, buat lihat kartu mana yang digambar ulang.
const mockHitunganRender = new Map<string, number>();

// Hitungan pasang per nomor order, buat lihat kartu mana yang dipasang ulang.
const mockHitunganPasang = new Map<string, number>();

jest.mock('../components/OrderCard', () => {
  const asli = jest.requireActual<typeof import('../components/OrderCard')>(
    '../components/OrderCard',
  );
  // React di-require di dalam pabrik tiruan, karena pabrik jest.mock tidak
  // boleh memakai variabel luar selain yang berawalan mock.
  const ReactMock = require('react');
  return {
    ...asli,
    OrderCard: (props: import('../components/OrderCard').OrderCardProps) => {
      const sebelumnya = mockHitunganRender.get(props.orderNumber) ?? 0;
      mockHitunganRender.set(props.orderNumber, sebelumnya + 1);
      ReactMock.useEffect(() => {
        const lama = mockHitunganPasang.get(props.orderNumber) ?? 0;
        mockHitunganPasang.set(props.orderNumber, lama + 1);
      }, []);
      return asli.OrderCard(props);
    },
  };
});

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
  raw: Record<string, unknown>;
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
    raw,
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

function makeAksi(targetOrderId: string, status: string): AksiPalsu {
  const raw: Record<string, unknown> = {
    target_order_id: targetOrderId,
    action_type: 'update_status',
    status,
    created_at: Date.now(),
    payload_json: '',
  };
  return { _getRaw: (column: string) => raw[column] };
}

// Panggil balik langganan pending_actions, buat kirim aksi baru dari tes.
let mockPanggilAksi: ((actions: AksiPalsu[]) => void) | null = null;

const mockPendingActionsCollection = {
  query: jest.fn().mockReturnValue({
    fetch: jest.fn().mockResolvedValue([]),
    fetchCount: jest.fn().mockResolvedValue(0),
    observeWithColumns: jest.fn().mockReturnValue({
      subscribe: jest.fn((onChange: (actions: AksiPalsu[]) => void) => {
        mockPanggilAksi = onChange;
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
import { formatOrderNumber } from '../formatOrderNumber';

// Respons server saat Terima berhasil.
const responsAccept = {
  id: 'pool-1',
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
};

/** Berapa kali kartu dengan nomor itu digambar. */
function hitung(orderNumber: string): number {
  return mockHitunganRender.get(orderNumber) ?? 0;
}

/** Berapa kali kartu dengan nomor itu dipasang. */
function pasang(orderNumber: string): number {
  return mockHitunganPasang.get(orderNumber) ?? 0;
}

/** Tunggu semua kerja awal layar selesai: bacaan pool dan fetch pertama. */
async function tungguAwalSelesai(): Promise<void> {
  await waitFor(() => {
    expect(fetchAvailableOrders).toHaveBeenCalled();
  });
  await act(async () => {
    await new Promise<void>((selesai) => setTimeout(selesai, 0));
  });
  await act(async () => {
    await new Promise<void>((selesai) => setTimeout(selesai, 0));
  });
}

/** Tunggu kartu pool tampil, lalu tunggu kerja awal selesai. */
async function tungguKartuPool(getAllByText: (teks: string) => readonly unknown[]): Promise<void> {
  await waitFor(() => {
    expect(getAllByText('Terima Order').length).toBeGreaterThan(0);
  });
  await tungguAwalSelesai();
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
    (acceptOrder as jest.Mock).mockResolvedValue(responsAccept);
    setBarisPool([]);
  });

  test('pembaruan lokasi dari langganan tidak menggambar ulang layar', async () => {
    setBarisPool([makeBaris({ id: 'pool-lokasi-1' })]);
    const onRender = jest.fn();

    const { getAllByText } = render(
      <Profiler id="layar-order" onRender={onRender}>
        <OrdersScreenBase
          database={mockDatabase as never}
          myOrders={[] as never}
          onLogout={jest.fn()}
        />
      </Profiler>,
    );

    await tungguKartuPool(getAllByText);

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

    const { getByText, getAllByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await tungguKartuPool(getAllByText);

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

    const { getAllByText, unmount } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await tungguKartuPool(getAllByText);

    unmount();

    expect(mockBerhentiLangganan).toHaveBeenCalledTimes(1);
  });
});

describe('kartu yang tidak berubah tidak digambar ulang', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHitunganRender.clear();
    mockHitunganPasang.clear();
    mockPanggilAksi = null;
    mockGetLastKnown.mockReset();
    mockGetLastKnown.mockResolvedValue(null);
    mockGetRoute.mockClear();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue(responsAccept);
    setBarisPool([]);
  });

  test('saat terima berjalan cuma kartu yang menerima digambar ulang', async () => {
    setBarisPool([
      makeBaris({ id: 'pool-1' }),
      makeBaris({ id: 'pool-2' }),
      makeBaris({ id: 'pool-3' }),
    ]);
    // Terima belum selesai, jadi tombolnya masih memuat.
    (acceptOrder as jest.Mock).mockImplementation(() => new Promise(() => {}));

    const { getAllByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await tungguKartuPool(getAllByText);

    const nomorSatu = formatOrderNumber('pool-1');
    const nomorDua = formatOrderNumber('pool-2');
    const nomorTiga = formatOrderNumber('pool-3');
    const sebelumSatu = hitung(nomorSatu);
    const sebelumDua = hitung(nomorDua);
    const sebelumTiga = hitung(nomorTiga);

    await act(async () => {
      fireEvent.press(getAllByText('Terima Order')[0]);
    });

    expect(hitung(nomorSatu)).toBeGreaterThan(sebelumSatu);
    expect(hitung(nomorDua)).toBe(sebelumDua);
    expect(hitung(nomorTiga)).toBe(sebelumTiga);
  });

  test('setelah terima selesai cuma kartu yang menerima digambar ulang', async () => {
    setBarisPool([
      makeBaris({ id: 'pool-1' }),
      makeBaris({ id: 'pool-2' }),
      makeBaris({ id: 'pool-3' }),
    ]);
    let selesaiAccept: (() => void) | undefined;
    (acceptOrder as jest.Mock).mockImplementation(
      () =>
        new Promise((selesai) => {
          selesaiAccept = () => selesai(responsAccept);
        }),
    );

    const { getAllByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await tungguKartuPool(getAllByText);

    const nomorSatu = formatOrderNumber('pool-1');
    const nomorDua = formatOrderNumber('pool-2');
    const nomorTiga = formatOrderNumber('pool-3');
    const sebelumSatu = hitung(nomorSatu);
    const sebelumDua = hitung(nomorDua);
    const sebelumTiga = hitung(nomorTiga);

    await act(async () => {
      fireEvent.press(getAllByText('Terima Order')[0]);
    });

    const setelahMuat = hitung(nomorSatu);
    expect(setelahMuat).toBeGreaterThan(sebelumSatu);

    await act(async () => {
      selesaiAccept?.();
      await new Promise<void>((selesai) => setTimeout(selesai, 0));
    });

    expect(hitung(nomorSatu)).toBeGreaterThan(setelahMuat);
    expect(hitung(nomorDua)).toBe(sebelumDua);
    expect(hitung(nomorTiga)).toBe(sebelumTiga);
  });

  test('aksi baru cuma menggambar ulang kartu order itu', async () => {
    const myOrders = [
      makeBaris({ id: 'order-1', status: 'PREPARING', driverId: 'driver-123' }),
      makeBaris({ id: 'order-2', status: 'PREPARING', driverId: 'driver-123' }),
      makeBaris({ id: 'order-3', status: 'PREPARING', driverId: 'driver-123' }),
    ];

    const { getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={myOrders as never}
        onLogout={jest.fn()}
      />,
    );

    await tungguAwalSelesai();

    await waitFor(() => {
      expect(getByText(/Order #ORDER-1/)).toBeTruthy();
    });

    const nomorSatu = formatOrderNumber('order-1');
    const nomorDua = formatOrderNumber('order-2');
    const nomorTiga = formatOrderNumber('order-3');
    const sebelumSatu = hitung(nomorSatu);
    const sebelumDua = hitung(nomorDua);
    const sebelumTiga = hitung(nomorTiga);

    await act(async () => {
      mockPanggilAksi?.([makeAksi('order-2', 'pending')]);
    });

    expect(hitung(nomorDua)).toBeGreaterThan(sebelumDua);
    expect(hitung(nomorSatu)).toBe(sebelumSatu);
    expect(hitung(nomorTiga)).toBe(sebelumTiga);
  });

  test('ganti tab tidak memasang ulang kartu', async () => {
    setBarisPool([
      makeBaris({ id: 'pool-1' }),
      makeBaris({ id: 'pool-2' }),
    ]);
    const myOrders = [
      makeBaris({ id: 'order-1', status: 'DELIVERED', driverId: 'driver-123' }),
    ];

    const { getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={myOrders as never}
        onLogout={jest.fn()}
      />,
    );

    await tungguAwalSelesai();

    await act(async () => {
      fireEvent.press(getByText('Order Saya'));
    });

    await act(async () => {
      fireEvent.press(getByText('Tersedia'));
    });

    // Dua daftar tetap dipasang, jadi tiap kartu dipasang tepat sekali.
    expect(pasang(formatOrderNumber('pool-1'))).toBe(1);
    expect(pasang(formatOrderNumber('pool-2'))).toBe(1);
    expect(pasang(formatOrderNumber('order-1'))).toBe(1);
  });

  test('status yang berubah di model yang sama tetap tampil di kartu', async () => {
    const baris = makeBaris({
      id: 'order-1',
      status: 'PREPARING',
      driverId: 'driver-123',
    });

    const { getByText, rerender } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[baris] as never}
        onLogout={jest.fn()}
      />,
    );

    await tungguAwalSelesai();

    expect(getByText('Diterima')).toBeTruthy();

    baris.raw.status = 'DELIVERED';

    rerender(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[baris] as never}
        onLogout={jest.fn()}
      />,
    );

    expect(getByText('Selesai')).toBeTruthy();
  });
});
