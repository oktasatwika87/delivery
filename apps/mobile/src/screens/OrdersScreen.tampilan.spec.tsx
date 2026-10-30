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
import { fireEvent, render, waitFor } from '@testing-library/react-native';

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
  getCurrentUserId: () => Promise.resolve('driver-123'),
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

// Baris tiruan. Kolom dibaca layar lewat _getRaw karena dekorator model
// tidak aktif di Jest.
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

import { OrdersScreenBase } from './OrdersScreen';
import { acceptOrder, fetchAvailableOrders } from '../sync/client';
import { ApiError } from '../sync/client';
import { formatOrderTime } from '../formatOrderTime';

const WAKTU_KUNCI = 1_750_000_000_000;

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

    fireEvent.press(getByText('Terima Order'));

    await waitFor(() => {
      expect(acceptOrder).toHaveBeenCalled();
    });
    // Tab Order Saya terbuka, jadi daftar pool tidak tampil lagi.
    await waitFor(() => {
      expect(getByText('Belum ada order diterima')).toBeTruthy();
    });
    expect(queryByText('Terima Order')).toBeNull();
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
      expect(getByText('Menyinkronkan 2 perubahan')).toBeTruthy();
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
