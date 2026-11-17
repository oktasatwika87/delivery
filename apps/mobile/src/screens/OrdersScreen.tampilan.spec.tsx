/**
 * Tes tampilan layar Order yang baru.
 *
 * Yang diuji: tab Tersedia dan Order Saya, kepala daftar, keadaan kosong,
 * ConnectionBar, tombol keluar, dan kotak order lepas.
 *
 * Database tiruan, sama seperti OrdersScreen.spec.tsx: layar membaca baris
 * pool dari koleksi orders dan daftar aksi antre dari pending_actions.
 */

import React from 'react';
import { ActivityIndicator, FlatList, StatusBar, StyleSheet } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { trigger } from 'react-native-haptic-feedback';

jest.mock('@nozbe/watermelondb/react', () => ({
  withDatabase: (C: unknown) => C,
  withObservables: (_trigger: unknown, _getObs: unknown) => (C: unknown) => C,
}));

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  return {
    ...RN,
    Alert: {
      alert: jest.fn(),
    },
  };
});

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
  NavigationContainer: ({ children }: { children: React.ReactNode }) => children,
  useNavigation: () => ({
    navigate: jest.fn(),
  }),
}));

jest.mock('../map/routing', () => ({
  GraphHopperRoutingProvider: jest.fn().mockImplementation(() => ({
    getRoute: jest.fn().mockResolvedValue({ distance: 1000, duration: 300 }),
  })),
}));

jest.mock('../map/location', () => ({
  locationService: {
    getLastKnown: jest.fn().mockResolvedValue(null),
    subscribe: jest.fn().mockResolvedValue(jest.fn()),
  },
}));

jest.mock('../map/networkMonitor', () => ({
  networkMonitor: {
    getStatus: jest.fn().mockReturnValue('online'),
    subscribe: jest.fn().mockReturnValue(jest.fn()),
  },
}));

jest.mock('../db', () => ({ database: {} }));
jest.mock('../sync/outbox', () => ({
  ...jest.requireActual('../sync/outbox'),
}));

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
  lastConflictAt?: number | null;
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
    last_conflict_at: fields.lastConflictAt ?? null,
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

interface FieldsPayment {
  orderId: string;
  amountCents?: number;
  createdAt: number;
  method?: string;
  status?: string;
  deletedAt?: number | null;
}

function makePayment(fields: FieldsPayment): AksiPalsu {
  const raw: Record<string, unknown> = {
    order_id: fields.orderId,
    method: fields.method ?? 'CASH',
    status: fields.status ?? 'CAPTURED',
    amount_cents: fields.amountCents ?? 120000,
    currency: 'IDR',
    kind: 'PAYMENT',
    deleted_at: fields.deletedAt ?? null,
    created_at: fields.createdAt,
    updated_at: fields.createdAt,
  };
  return { _getRaw: (column: string) => raw[column] };
}

let mockPendingActions: AksiPalsu[] = [];

function makeAksi(targetOrderId: string, status: string): AksiPalsu {
  const raw: Record<string, unknown> = {
    target_order_id: targetOrderId,
    action_type: 'update_status',
    status,
    created_at: 1_700_000_000_000,
    payload_json: '',
  };
  return { _getRaw: (column: string) => raw[column] };
}

const mockPendingActionsCollection = {
  query: jest.fn().mockReturnValue({
    fetch: jest.fn().mockResolvedValue([]),
    fetchCount: jest.fn().mockResolvedValue(0),
    observeWithColumns: jest.fn().mockReturnValue({
      subscribe: jest.fn((onChange: (actions: AksiPalsu[]) => void) => {
        onChange(mockPendingActions);
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

const mockBatch = jest.fn().mockResolvedValue(undefined);

const mockDatabase = {
  get: jest.fn((table: string) =>
    table === 'pending_actions' ? mockPendingActionsCollection : mockOrdersCollection,
  ),
  write: jest.fn().mockImplementation(async (fn: () => Promise<void>) => fn()),
  batch: mockBatch,
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

import { OrdersScreen, OrdersScreenBase } from './OrdersScreen';
import { acceptOrder, fetchAvailableOrders } from '../sync/client';
import { ApiError } from '../sync/client';
import { formatOrderTime } from '../formatOrderTime';
import { formatCurrency } from '../formatCurrency';
import { getCurrentUserId } from '../sync/session';
import { syncEvents } from '../sync/syncEvents';
import { ConnectionBar } from '../components/ConnectionBar';
import { DaySummary } from '../components/DaySummary';
import { MainHeader } from '../components/AppBar';
import { Tabs } from '../components/Tabs';
import { ListEnterRow } from '../components/motion/listEnter';
import { InitialWindowProvider } from '../components/motion/InitialWindow';
import { SlideOutRight } from 'react-native-reanimated';
import { Icon } from '../theme/Icon';
import { motion, size, space, themes, type } from '../theme/tokens';

const WAKTU_KUNCI = 1_750_000_000_000;

/** Elemen pohon uji. Cuma bagian yang dipakai di berkas ini. */
interface Instansi {
  parent: Instansi | null;
  children: Array<Instansi | string>;
  props: Record<string, unknown>;
  type: unknown;
}

/** Ancestor sebuah elemen, dari yang paling dekat sampai akar pohon. */
function leluhur(term: Instansi): Instansi[] {
  const hasil: Instansi[] = [];
  let sekarang: Instansi | null = term.parent;
  while (sekarang) {
    hasil.push(sekarang);
    sekarang = sekarang.parent;
  }
  return hasil;
}

/** Anak elemen, tanpa teks. */
function anak(term: Instansi): Instansi[] {
  return term.children.filter(
    (child): child is Instansi => typeof child !== 'string',
  );
}

/** Id order dari data yang dikirim ke FlatList. */
function idDariDaftar(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const hasil: string[] = [];
  for (const item of data) {
    if (typeof item === 'object' && item !== null && 'id' in item) {
      const id = item.id;
      if (typeof id === 'string') hasil.push(id);
    }
  }
  return hasil;
}

/** Jumlah pada pil satu tab. */
function jumlahPil(tabs: unknown, label: string): number | undefined {
  if (!Array.isArray(tabs)) return undefined;
  for (const tab of tabs) {
    if (typeof tab !== 'object' || tab === null) continue;
    if (!('label' in tab) || tab.label !== label) continue;
    if (!('count' in tab)) continue;
    const count = tab.count;
    if (typeof count === 'number') return count;
  }
  return undefined;
}

// Status jaringan dibalas ke nilai awal tiap tes, soalnya nilai mock
// tidak direset oleh clearAllMocks.
beforeEach(() => {
  const { networkMonitor } = require('../map/networkMonitor');
  networkMonitor.getStatus.mockReturnValue('online');
});

describe('tab layar Order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue({
      id: 'pool-terima-1',
      customerId: 'cust-1',
      driverId: 'driver-123',
      status: 'PREPARING',
      items: [],
      deliveryAddress: { street: 'Jl. Terima 1', city: 'Jakarta' },
      totalCents: 25000,
      currency: 'IDR',
      notes: null,
      createdAt: '2026-01-15T03:04:05.000Z',
      updatedAt: '2026-01-15T03:05:00.000Z',
      version: 4,
      cancelledBy: null,
      cancelReason: null,
    });
    mockPendingActions = [];
    setBarisPool([]);
  });

  test('tab awal Order Saya kalau ada order yang sedang dikerjakan', async () => {
    const myOrders = [makeBaris({ id: 'order-kerja-1', status: 'PREPARING', driverId: 'driver-123' })];
    setBarisPool([makeBaris({ id: 'pool-1' })]);

    const { getByText, queryByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={myOrders as never}
        onLogout={jest.fn()}
      />,
    );

    // Kartu Order Saya yang tampil, bukan kartu pool.
    await waitFor(() => {
      expect(getByText('Diterima')).toBeTruthy();
    });
    expect(queryByText('Terima Order')).toBeNull();
  });

  test('tab awal Tersedia kalau tidak ada order yang sedang dikerjakan', async () => {
    const myOrders = [makeBaris({ id: 'order-selesai-1', status: 'DELIVERED', driverId: 'driver-123' })];
    setBarisPool([makeBaris({ id: 'pool-2' })]);

    const { getByText, queryByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={myOrders as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });
    expect(queryByText('Selesai')).toBeNull();
  });

  test('terima sukses pindah ke tab Order Saya', async () => {
    jest.useFakeTimers();
    try {
      setBarisPool([makeBaris({ id: 'pool-terima-1' })]);

      const { getByText, queryByText } = render(
        <OrdersScreenBase
          database={mockDatabase as never}
          myOrders={[] as never}
          onLogout={jest.fn()}
        />,
      );

      await waitFor(() => {
        expect(getByText('Terima Order')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByText('Terima Order'));
      });

      await act(async () => {
        jest.advanceTimersByTime(motion.duration.drawLine);
      });

      await act(async () => {
        jest.advanceTimersByTime(motion.duration.exit);
      });

      // Tab Order Saya terbuka, jadi daftar pool tidak tampil lagi.
      expect(getByText('Belum ada order diterima')).toBeTruthy();
      expect(queryByText('Terima Order')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('terima gagal 409 tetap di tab Tersedia', async () => {
    (acceptOrder as jest.Mock).mockRejectedValue(
      new ApiError('Order sudah diambil driver lain', 409, 'ORDER_UNAVAILABLE'),
    );
    setBarisPool([makeBaris({ id: 'pool-konflik-1' })]);

    const { getByText, queryByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    fireEvent.press(getByText('Terima Order'));

    await waitFor(() => {
      expect(acceptOrder).toHaveBeenCalled();
    });
    // Tab tidak berganti, masih di Tersedia.
    expect(queryByText('Belum ada order diterima')).toBeNull();
    expect(getByText('Terima Order')).toBeTruthy();
  });
});

describe('ganti tab di layar Order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue({});
    mockPendingActions = [];
    setBarisPool([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('penanda tab langsung pindah di render yang sama dengan ketukan', async () => {
    const { getByText, UNSAFE_getByType } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Tersedia')).toBeTruthy();
    });

    fireEvent.press(getByText('Order Saya'));

    expect(UNSAFE_getByType(Tabs).props.activeKey).toBe('mine');
  });

  test('kurangi gerakan: isi daftar langsung berganti tanpa pudar', async () => {
    const reanimated = require('react-native-reanimated') as {
      useReducedMotion: () => boolean;
    };
    jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);
    setBarisPool([makeBaris({ id: 'pool-kurang-1' })]);

    const { getByText, UNSAFE_getByType } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    fireEvent.press(getByText('Order Saya'));

    // Isi Order Saya sudah tampil, tidak menunggu pudar.
    expect(idDariDaftar(UNSAFE_getByType(FlatList).props.data)).toEqual([]);
    expect(getByText('Belum ada order diterima')).toBeTruthy();
  });
});

describe('gerak kartu daftar Order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue({});
    mockPendingActions = [];
    setBarisPool([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('kartu Tersedia keluar ke kanan, kartu Order Saya tidak keluar', async () => {
    setBarisPool([makeBaris({ id: 'pool-gerak-1' })]);
    const myOrders = [
      makeBaris({ id: 'order-gerak-1', status: 'DELIVERED', driverId: 'driver-123' }),
    ];

    const { UNSAFE_getAllByType, getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={myOrders as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    const barisTersedia = UNSAFE_getAllByType(ListEnterRow);
    expect(barisTersedia).toHaveLength(1);
    expect(barisTersedia[0].props.exiting).toBe(SlideOutRight);

    fireEvent.press(getByText('Order Saya'));

    await waitFor(() => {
      expect(getByText(/Order #ORDER-GE/)).toBeTruthy();
    });

    const barisSaya = UNSAFE_getAllByType(ListEnterRow);
    expect(barisSaya).toHaveLength(1);
    expect(barisSaya[0].props.exiting).toBeUndefined();
  });

  test('di dalam jendela awal tidak ada gerak keluar dan tidak ada geser baris', async () => {
    setBarisPool([makeBaris({ id: 'pool-jendela-1' })]);

    const { UNSAFE_getAllByType, UNSAFE_getByType, getByText } = render(
      <InitialWindowProvider>
        <OrdersScreenBase
          database={mockDatabase as never}
          myOrders={[] as never}
          onLogout={jest.fn()}
        />
      </InitialWindowProvider>,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    expect(UNSAFE_getAllByType(ListEnterRow)[0].props.exiting).toBeUndefined();
    expect(UNSAFE_getByType(FlatList).props.itemLayoutAnimation).toBeUndefined();
  });

  test('di luar jendela awal baris lain bergeser saat kartu masuk atau keluar', async () => {
    setBarisPool([makeBaris({ id: 'pool-geser-1' })]);

    const { UNSAFE_getByType, getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    expect(UNSAFE_getByType(FlatList).props.itemLayoutAnimation).toBeDefined();
  });
});

describe('urutan Terima di layar Order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue({
      id: 'pool-terima-urutan',
      customerId: 'cust-1',
      driverId: 'driver-123',
      status: 'PREPARING',
      items: [],
      deliveryAddress: { street: 'Jl. Terima 1', city: 'Jakarta' },
      totalCents: 25000,
      currency: 'IDR',
      notes: null,
      createdAt: '2026-01-15T03:04:05.000Z',
      updatedAt: '2026-01-15T03:05:00.000Z',
      version: 4,
      cancelledBy: null,
      cancelReason: null,
    });
    mockPendingActions = [];
    setBarisPool([makeBaris({ id: 'pool-terima-urutan' })]);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('sesudah Terima sukses tab masih Tersedia dan tombolnya jadi centang', async () => {
    const { getByText, getByLabelText, getByTestId, UNSAFE_queryAllByType } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Terima Order'));
    });

    // Tab belum berganti, masih di Tersedia.
    expect(getByText('Terima Order')).toBeTruthy();
    expect(StyleSheet.flatten(getByTestId('judul-tombol').props.style).opacity).toBe(0);
    const tombol = getByLabelText('Terima Order');
    const spinner = UNSAFE_queryAllByType(ActivityIndicator).filter((indikator) =>
      leluhur(indikator).includes(tombol),
    );
    expect(spinner).toHaveLength(0);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('impactMedium');
  });

  test('sesudah waktu centang kartu hilang dari Tersedia tapi tab belum pindah', async () => {
    const { getByText, queryByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Terima Order'));
    });

    await act(async () => {
      jest.advanceTimersByTime(motion.duration.drawLine);
    });

    expect(queryByText('Terima Order')).toBeNull();
    expect(queryByText('Belum ada order diterima')).toBeNull();
  });

  test('sesudah waktu keluar isi Order Saya tampil', async () => {
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

    await act(async () => {
      fireEvent.press(getByText('Terima Order'));
    });

    await act(async () => {
      jest.advanceTimersByTime(motion.duration.drawLine);
    });

    await act(async () => {
      jest.advanceTimersByTime(motion.duration.exit);
    });

    expect(getByText('Belum ada order diterima')).toBeTruthy();
  });

  test('pengguna pindah tab sendiri di tengah centang, urutan dipotong', async () => {
    const { getByText, queryByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Terima Order'));
    });

    await act(async () => {
      fireEvent.press(getByText('Order Saya'));
    });

    // Order Saya langsung tampil.
    expect(getByText('Belum ada order diterima')).toBeTruthy();

    // Kembali ke Tersedia, kartunya sudah dibuang.
    await act(async () => {
      fireEvent.press(getByText('Tersedia'));
    });
    expect(queryByText('Terima Order')).toBeNull();
    expect(getByText('Belum ada order')).toBeTruthy();

    // Timer lama tidak memindah tab lagi.
    await act(async () => {
      jest.advanceTimersByTime(motion.duration.drawLine + motion.duration.exit);
    });
    expect(getByText('Belum ada order')).toBeTruthy();
  });

  test('kartu dibuang daftar server di tengah centang, tab pindah setelah waktu keluar saja', async () => {
    const { getByText, queryByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Terima Order'));
    });

    // Server sudah tidak punya order itu, jadi daftar diperbarui.
    setBarisPool([]);
    await act(async () => {
      syncEvents.emit('pool-refresh', {});
    });

    expect(queryByText('Terima Order')).toBeNull();

    // Baru lewat waktu keluar, tanpa menunggu waktu centang.
    await act(async () => {
      jest.advanceTimersByTime(motion.duration.exit);
    });
    expect(getByText('Belum ada order diterima')).toBeTruthy();
  });

  test('kurangi gerakan: kartu langsung hilang dan tab langsung pindah', async () => {
    const reanimated = require('react-native-reanimated') as {
      useReducedMotion: () => boolean;
    };
    jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);

    const { getByText, queryByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Terima Order'));
    });

    expect(queryByText('Terima Order')).toBeNull();
    expect(getByText('Belum ada order diterima')).toBeTruthy();
  });

  test('layar dilepas di tengah urutan tidak bikin peringatan state', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { getByText, unmount } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Terima Order'));
    });

    errorSpy.mockClear();
    unmount();

    await act(async () => {
      jest.advanceTimersByTime(motion.duration.drawLine + motion.duration.exit);
    });

    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('sorotan order yang baru diterima', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue({
      id: 'pool-terima-urutan',
      customerId: 'cust-1',
      driverId: 'driver-123',
      status: 'PREPARING',
      items: [],
      deliveryAddress: { street: 'Jl. Terima 1', city: 'Jakarta' },
      totalCents: 25000,
      currency: 'IDR',
      notes: null,
      createdAt: '2026-01-15T03:04:05.000Z',
      updatedAt: '2026-01-15T03:05:00.000Z',
      version: 4,
      cancelledBy: null,
      cancelReason: null,
    });
    mockPendingActions = [];
    setBarisPool([makeBaris({ id: 'pool-terima-urutan' })]);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('kartu di Order Saya disorot lalu sorotannya hilang', async () => {
    const myOrders = [
      makeBaris({ id: 'pool-terima-urutan', status: 'ASSIGNED', driverId: 'driver-123' }),
    ];

    const { getByText, getByTestId, queryByTestId } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={myOrders as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Terima Order'));
    });

    await act(async () => {
      jest.advanceTimersByTime(motion.duration.drawLine);
    });

    await act(async () => {
      jest.advanceTimersByTime(motion.duration.exit);
    });

    expect(getByTestId('sorotan-kartu')).toBeTruthy();

    // Sorotannya cuma sekali, jadi hilang sendiri setelah waktunya lewat.
    await act(async () => {
      jest.advanceTimersByTime(motion.duration.fadeOut + motion.duration.highlight);
    });

    expect(queryByTestId('sorotan-kartu')).toBeNull();
  });

  test('kurangi gerakan tidak ada sorotan', async () => {
    const reanimated = require('react-native-reanimated') as {
      useReducedMotion: () => boolean;
    };
    jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);

    const myOrders = [
      makeBaris({ id: 'pool-terima-urutan', status: 'ASSIGNED', driverId: 'driver-123' }),
    ];

    const { getByText, queryByTestId } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={myOrders as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Terima Order')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Terima Order'));
    });

    expect(queryByTestId('sorotan-kartu')).toBeNull();
  });
});

describe('kepala daftar Tersedia', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue({});
    mockPendingActions = [];
    jest.spyOn(Date, 'now').mockReturnValue(WAKTU_KUNCI);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('online: Tarik ke bawah untuk menyegarkan', async () => {
    setBarisPool([makeBaris({ id: 'pool-online-1' })]);

    const { getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Tarik ke bawah untuk menyegarkan')).toBeTruthy();
    });
  });

  test('bukan online: Daftar terakhir diperbarui dengan waktu baris pool terbaru', async () => {
    const { networkMonitor } = require('../map/networkMonitor');
    networkMonitor.getStatus.mockReturnValue('offline');
    const terbaru = WAKTU_KUNCI - 60000;
    setBarisPool([
      makeBaris({ id: 'pool-lama-1', updatedAt: WAKTU_KUNCI - 120000 }),
      makeBaris({ id: 'pool-baru-1', updatedAt: terbaru }),
    ]);

    const { getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        getByText(`Daftar terakhir diperbarui ${formatOrderTime(terbaru, WAKTU_KUNCI)}`),
      ).toBeTruthy();
    });
  });

  test('bukan online: tombol Terima nonaktif dan baris bantu tampil', async () => {
    const { networkMonitor } = require('../map/networkMonitor');
    networkMonitor.getStatus.mockReturnValue('offline');
    setBarisPool([makeBaris({ id: 'pool-offline-1' })]);

    const { getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Butuh koneksi internet untuk menerima order')).toBeTruthy();
    });

    // Tombol nonaktif, jadi menekan tidak mengirim apa pun ke server.
    fireEvent.press(getByText('Terima Order'));
    expect(acceptOrder).not.toHaveBeenCalled();
  });
});

describe('keadaan kosong', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue({});
    mockPendingActions = [];
    setBarisPool([]);
  });

  test('online: Belum ada order', async () => {
    const { getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Belum ada order')).toBeTruthy();
    });
    expect(
      getByText('Order baru muncul di sini otomatis. Tarik ke bawah untuk menyegarkan.'),
    ).toBeTruthy();
  });

  test('bukan online: Belum ada daftar order tersimpan', async () => {
    const { networkMonitor } = require('../map/networkMonitor');
    networkMonitor.getStatus.mockReturnValue('offline');

    const { getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Belum ada daftar order tersimpan')).toBeTruthy();
    });
    expect(getByText('Sambungkan internet untuk melihat order baru.')).toBeTruthy();
  });

  test('tab Order Saya kosong: Belum ada order diterima', async () => {
    const { getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Tersedia')).toBeTruthy();
    });

    fireEvent.press(getByText('Order Saya'));

    await waitFor(() => {
      expect(getByText('Belum ada order diterima')).toBeTruthy();
    });
    expect(getByText('Order yang diterima muncul di sini.')).toBeTruthy();
  });

  test('EmptyState tidak tampil selama fetch pertama belum selesai', async () => {
    // Fetch pertama tidak pernah selesai, jadi layar belum tahu daftar kosong.
    (fetchAvailableOrders as jest.Mock).mockReturnValue(new Promise(() => {}));

    const { queryByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(fetchAvailableOrders).toHaveBeenCalled();
    });

    expect(queryByText('Belum ada order')).toBeNull();
  });
});

describe('ConnectionBar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue({});
    mockPendingActions = [];
    setBarisPool([]);
  });

  test('teks offline saat status offline', async () => {
    const { networkMonitor } = require('../map/networkMonitor');
    networkMonitor.getStatus.mockReturnValue('offline');

    const { getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText(/Offline/)).toBeTruthy();
    });
  });

  test('Menyinkronkan 2 perubahan saat online dengan dua aksi pending', async () => {
    mockPendingActions = [
      makeAksi('order-aksi-1', 'pending'),
      makeAksi('order-aksi-2', 'pending'),
    ];

    const { getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Menyinkronkan')).toBeTruthy();
      expect(getByText('2')).toBeTruthy();
      expect(getByText('perubahan')).toBeTruthy();
    });
  });

  test('bilah menerima jumlah aksi gagal dan COD yatim saja', async () => {
    mockPendingActions = [
      makeAksi('order-aksi-1', 'pending'),
      makeAksi('order-aksi-2', 'syncing'),
      makeAksi('order-aksi-3', 'failed'),
      makeAksi('order-aksi-4', 'orphaned_needs_review'),
    ];

    const { UNSAFE_getByType } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(UNSAFE_getByType(ConnectionBar).props.failedCount).toBe(2);
    });
  });
});

describe('lencana kartu Order Saya', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue({});
    mockPendingActions = [];
    setBarisPool([]);
  });

  test('satu aksi gagal menampilkan lencana ditolak server', async () => {
    mockPendingActions = [makeAksi('order-gagal-1', 'failed')];
    const myOrders = [
      makeBaris({ id: 'order-gagal-1', status: 'PREPARING', driverId: 'driver-123' }),
    ];

    const { getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={myOrders as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Ditolak server')).toBeTruthy();
    });
  });
});

describe('urutan daftar di layar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue({});
    mockPendingActions = [];
    setBarisPool([]);
  });

  test('kartu Order Saya urut order aktif dulu lalu yang dibuat paling baru', async () => {
    const myOrders = [
      makeBaris({
        id: 'order-selesai-1',
        status: 'DELIVERED',
        driverId: 'driver-123',
        createdAt: 2_000,
      }),
      makeBaris({
        id: 'order-aktif-1',
        status: 'PREPARING',
        driverId: 'driver-123',
        createdAt: 1_000,
      }),
    ];

    const { UNSAFE_getByType } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={myOrders as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(idDariDaftar(UNSAFE_getByType(FlatList).props.data)).toEqual([
        'order-aktif-1',
        'order-selesai-1',
      ]);
    });
  });

  test('kartu Tersedia urut order yang dibuat paling baru dulu', async () => {
    setBarisPool([
      makeBaris({ id: 'pool-lama-1', createdAt: 1_000 }),
      makeBaris({ id: 'pool-baru-1', createdAt: 2_000 }),
    ]);

    const { UNSAFE_getByType } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(idDariDaftar(UNSAFE_getByType(FlatList).props.data)).toEqual([
        'pool-baru-1',
        'pool-lama-1',
      ]);
    });
  });
});

describe('pil tab Order Saya', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue({});
    mockPendingActions = [];
    setBarisPool([]);
  });

  test('jumlahnya cuma order yang masih dikerjakan', async () => {
    const myOrders = [
      makeBaris({
        id: 'order-aktif-1',
        status: 'PREPARING',
        driverId: 'driver-123',
      }),
      makeBaris({
        id: 'order-selesai-1',
        status: 'DELIVERED',
        driverId: 'driver-123',
      }),
    ];

    const { UNSAFE_getByType } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={myOrders as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(jumlahPil(UNSAFE_getByType(Tabs).props.tabs, 'Order Saya')).toBe(1);
    });
  });

  test('nol saat semua order sudah selesai', async () => {
    const myOrders = [
      makeBaris({
        id: 'order-selesai-1',
        status: 'DELIVERED',
        driverId: 'driver-123',
      }),
    ];

    const { UNSAFE_getByType } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={myOrders as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(jumlahPil(UNSAFE_getByType(Tabs).props.tabs, 'Order Saya')).toBe(0);
    });
  });
});

describe('ringkasan hari ini di layar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue({});
    mockPendingActions = [];
    setBarisPool([]);
  });

  test('angka ikut dari data hari ini dan tetap ada di tab Tersedia', async () => {
    const sekarang = Date.now();
    const myOrders = [
      makeBaris({
        id: 'order-aktif-1',
        status: 'PREPARING',
        driverId: 'driver-123',
      }),
      makeBaris({
        id: 'order-selesai-1',
        status: 'DELIVERED',
        driverId: 'driver-123',
        updatedAt: sekarang,
      }),
    ];
    const payments = [
      makePayment({ orderId: 'order-selesai-1', amountCents: 120000, createdAt: sekarang }),
    ];

    const { getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={myOrders as never}
        payments={payments as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('1 selesai')).toBeTruthy();
      expect(getByText(formatCurrency(120000, 'IDR'))).toBeTruthy();
    });

    // Ringkasan ada di luar daftar, jadi tetap tampil di tab lain.
    fireEvent.press(getByText('Tersedia'));

    await waitFor(() => {
      expect(getByText('1 selesai')).toBeTruthy();
      expect(getByText(formatCurrency(120000, 'IDR'))).toBeTruthy();
    });
  });

  test('tanpa data angkanya nol', async () => {
    const { getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('0 selesai')).toBeTruthy();
      expect(getByText(formatCurrency(0, 'IDR'))).toBeTruthy();
    });
  });
});

describe('tombol keluar di kepala layar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue({});
    mockPendingActions = [];
    setBarisPool([]);
  });

  test('memanggil onLogout', async () => {
    const onLogout = jest.fn();

    const { getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={onLogout}
      />,
    );

    await waitFor(() => {
      expect(getByText('Keluar')).toBeTruthy();
    });

    fireEvent.press(getByText('Keluar'));
    expect(onLogout).toHaveBeenCalled();
  });
});

describe('kotak order lepas', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue({});
    mockPendingActions = [];
    setBarisPool([]);
    jest.spyOn(Date, 'now').mockReturnValue(WAKTU_KUNCI);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('tampil di tab Order Saya dan tidak di Tersedia', async () => {
    const releasedOrders = [
      makeBaris({ id: 'order-lepas-1', lastConflictAt: WAKTU_KUNCI - 1000 }),
    ];

    const { getByText, queryByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        releasedOrders={releasedOrders as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Tersedia')).toBeTruthy();
    });

    // Di tab Tersedia kotak ini tidak ada.
    expect(queryByText('Order sudah tidak ditugaskan ke Anda')).toBeNull();

    fireEvent.press(getByText('Order Saya'));

    await waitFor(() => {
      expect(getByText('Order sudah tidak ditugaskan ke Anda')).toBeTruthy();
    });
  });
});

describe('tema dan tata letak layar Order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchAvailableOrders as jest.Mock).mockResolvedValue({ items: [], hasMore: false });
    (acceptOrder as jest.Mock).mockResolvedValue({});
    mockPendingActions = [];
    setBarisPool([]);
  });

  test('latar layar memakai warna tema', () => {
    const { toJSON } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    const gayaLayar = StyleSheet.flatten(toJSON().props.style);
    expect(gayaLayar.backgroundColor).toBe(themes.gelap.bg);
  });

  test('status bar memakai warna kepala tema gelap', () => {
    const { UNSAFE_getAllByType } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    const statusBar = UNSAFE_getAllByType(StatusBar)[0];
    expect(statusBar.props.barStyle).toBe('light-content');
    expect(statusBar.props.backgroundColor).toBe(themes.gelap.header);
  });

  test('bilah koneksi di luar isi layar, tab dan daftar di dalam', () => {
    const { UNSAFE_getByType } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    // Kepala layar tidak lagi memuat anak apa pun.
    const kepala = UNSAFE_getByType(MainHeader);
    expect(kepala.props.children).toBeUndefined();

    // Isi layar adalah pembungkus yang punya prop layout.
    const isiLayar = leluhur(UNSAFE_getByType(FlatList)).find(
      (node) => node.props.layout !== undefined,
    );
    expect(isiLayar).toBeDefined();

    // Bilah bukan turunan kepala dan bukan turunan isi layar.
    const leluhurBilah = leluhur(UNSAFE_getByType(ConnectionBar));
    expect(leluhurBilah.includes(kepala)).toBe(false);
    expect(leluhurBilah.includes(isiLayar!)).toBe(false);
  });

  test('isi layar urutannya kepala, ringkasan, wadah tab, lalu daftar', () => {
    const { UNSAFE_getByType } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    const isiLayar = leluhur(UNSAFE_getByType(FlatList)).find(
      (node) => node.props.layout !== undefined,
    );
    const urutan = anak(isiLayar!);

    expect(urutan[0].type).toBe(MainHeader);
    expect(urutan[1].props.style).toBe(UNSAFE_getByType(DaySummary).parent?.props.style);
    expect(urutan[2].props.style).toBe(UNSAFE_getByType(Tabs).parent?.props.style);
    // Daftar dibungkus lapisan yang bisa pudar, jadi FlatList ada di dalam
    // lapisan itu, bukan langsung jadi anak isi layar.
    expect(leluhur(UNSAFE_getByType(FlatList)).includes(urutan[3])).toBe(true);
  });

  test('kepala daftar memakai tinggi 28, ikon kecil, dan warna teks halus', async () => {
    setBarisPool([makeBaris({ id: 'pool-kepala-1' })]);

    const { UNSAFE_getAllByType, getByText } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(getByText('Tarik ke bawah untuk menyegarkan')).toBeTruthy();
    });

    const ikon = UNSAFE_getAllByType(Icon).find((item) => item.props.name === 'refresh');
    expect(ikon?.props.size).toBe(size.iconXs);
    expect(ikon?.props.color).toBe(themes.gelap.textSubtle);

    const gayaKepala = StyleSheet.flatten(ikon?.parent?.props.style);
    expect(gayaKepala.height).toBe(28);
    expect(gayaKepala.justifyContent).toBe('center');

    const gayaTeks = StyleSheet.flatten(
      getByText('Tarik ke bawah untuk menyegarkan').props.style,
    );
    expect(gayaTeks.color).toBe(themes.gelap.textSubtle);
    expect(gayaTeks.fontSize).toBe(type.bodyXs.fontSize);
  });

  test('daftar memakai padding dan ruang bawah versi 2', () => {
    const { UNSAFE_getByType } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    const gayaDaftar = StyleSheet.flatten(
      UNSAFE_getByType(FlatList).props.contentContainerStyle,
    );
    expect(gayaDaftar.paddingTop).toBe(space[2]);
    expect(gayaDaftar.paddingHorizontal).toBe(space[4]);
    expect(gayaDaftar.gap).toBe(space[3]);
    expect(gayaDaftar.paddingBottom).toBe(space[10]);
  });

  test('wadah tab punya margin atas dan sisi', () => {
    const { UNSAFE_getByType } = render(
      <OrdersScreenBase
        database={mockDatabase as never}
        myOrders={[] as never}
        onLogout={jest.fn()}
      />,
    );

    const gayaWadahTab = StyleSheet.flatten(
      UNSAFE_getByType(Tabs).parent?.props.style,
    );
    expect(gayaWadahTab.marginTop).toBe(space[3]);
    expect(gayaWadahTab.marginHorizontal).toBe(space[4]);
  });

  test('layar tunggu kosong tanpa tulisan Loading', () => {
    // Sesi belum selesai, jadi layar menunggu identitas pengguna.
    (getCurrentUserId as jest.Mock).mockReturnValueOnce(new Promise(() => {}));

    const { queryByText, toJSON } = render(
      <OrdersScreen database={mockDatabase as never} onLogout={jest.fn()} />,
    );

    expect(queryByText('Loading...')).toBeNull();
    const gayaTunggu = StyleSheet.flatten(toJSON().props.style);
    expect(gayaTunggu.backgroundColor).toBe(themes.gelap.bg);
  });
});
