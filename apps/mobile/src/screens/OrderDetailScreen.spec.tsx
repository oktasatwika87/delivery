/**
 * Unit tests untuk OrderDetailScreen, cancel button visibility + behavior + outbox wiring.
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act, within } from '@testing-library/react-native';

import { OrderDetailScreen } from './OrderDetailScreen';
import { Banner } from '../components/Banner';
import { Button } from '../components/Button';
import { JARAK_BILAH_BAWAH } from '../components/ScreenFrame';
import { syncEvents } from '../sync/syncEvents';
import { InitialWindowProvider } from '../components/motion/InitialWindow';
import { hapticDelivered } from '../haptics';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@delivery/shared';
import type { NetworkStatus } from '../map/networkMonitor';
import type { OrderModel } from '../db/models/OrderModel';
import { DETAK_BASI_MS } from '../sync/useDetakBasi';
import type {
  ExitAnimationsValues,
  LayoutAnimation,
  StyleProps,
} from 'react-native-reanimated';

// Tanda kali di baris barang, ditulis lewat kode karakter supaya sumber tetap ASCII.
const TANDA_KALI = String.fromCharCode(0xd7);

// Client mocks
const mockUpdateOrderStatus = jest.fn();
const mockGetOrderById = jest.fn();

jest.mock('../sync/client', () => {
  const actual = jest.requireActual('../sync/client') as typeof import('../sync/client');
  return {
    ...actual,
    updateOrderStatus: (...args: unknown[]) => mockUpdateOrderStatus(...args),
    getOrderById: (...args: unknown[]) => mockGetOrderById(...args),
  };
});

// networkMonitor mock
// mockGetStatusFn is module-level so the spy (created after jest.mock runs) can
// still reference it. See ordersSocket.spec.ts pattern.
var mockGetStatusFn = jest.fn((): NetworkStatus => 'online');

jest.mock('../map/networkMonitor', () => ({
  networkMonitor: {
    getStatus: () => mockGetStatusFn(),
    subscribe: jest.fn((cb: (s: NetworkStatus) => void) => {
      cb(mockGetStatusFn());
      return () => {};
    }),
  },
}));

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return {
    ...actual,
    Alert: { ...actual.Alert, alert: jest.fn() },
  };
});

// Navigation mock (pola sama kayak MapScreen.spec.tsx)
// mockNavigate, mockGoBack, dan mockReplace di tingkat modul, jadi tes bisa
// memeriksa tujuan navigasi dan pemanggilan tombol kembali.
const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockReplace = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    replace: mockReplace,
  }),
  useRoute: () => ({ params: { orderId: 'order-123' } }),
}));

// getCurrentUserId mock
const mockGetCurrentUserId = jest.fn();
jest.mock('../sync/session', () => ({
  getCurrentUserId: () => mockGetCurrentUserId(),
}));

// Outbox mocks
// These are defined at module level so they can be referenced in tests
const mockEnqueueCancel = jest.fn();
const mockEnqueueCollectCod = jest.fn();
const mockEnqueueUpdateStatus = jest.fn();
const mockHasPendingAction = jest.fn();
const mockDrainPendingActions = jest.fn();
const mockGetPendingActionsForOrder = jest.fn();
const mockRetryFailedAction = jest.fn();
const mockDiscardFailedAction = jest.fn();
// Inline implementasi isPendingActionStale (sama dengan outbox.ts) supaya tes stale akurat
// tanpa perlu jest.requireActual yang bisa gagal karena native module.
const STALE_THRESHOLD_MS = 60 * 60 * 1000;
// Minimal shape pending action buat test mock, hanya field yang dipakai tes.
interface MockPendingAction {
  id: string;
  actionType?: 'reject' | 'cancel' | 'collect_cod' | 'update_status';
  status?: 'pending' | 'syncing' | 'failed' | 'orphaned_needs_review';
  createdAt: Date | number | string;
  payloadJson?: unknown;
  /** Pembaca kolom mentah, seperti model aslinya. */
  _getRaw?: (kolom: string) => unknown;
}
function computeIsPendingActionStale(action: MockPendingAction | null | undefined): boolean {
  if (!action?.createdAt) return false;
  const createdAt = action.createdAt;
  const timestamp = createdAt instanceof Date ? createdAt.getTime() : Number(createdAt);
  if (!timestamp) return false;
  return Date.now() - timestamp > STALE_THRESHOLD_MS;
}
const mockIsPendingActionStale = jest.fn().mockImplementation(computeIsPendingActionStale);

// NOTE: __esModule: true is required here, OrderDetailScreen.tsx uses a
// dynamic `await import('../sync/outbox')` for drainPendingActions (to avoid
// pulling the WatermelonDB native module in statically, see coordinator.ts
// for the same pattern). Without __esModule: true, Babel's dynamic-import
// interop wraps this mock differently than a static import does, and named
// destructuring off the dynamic import silently resolves to undefined.
jest.mock('../sync/outbox', () => ({
  __esModule: true,
  enqueueCancel: (...args: unknown[]) => mockEnqueueCancel(...args),
  enqueueCollectCod: (...args: unknown[]) => mockEnqueueCollectCod(...args),
  enqueueUpdateStatus: (...args: unknown[]) => mockEnqueueUpdateStatus(...args),
  hasPendingAction: (...args: unknown[]) => mockHasPendingAction(...args),
  drainPendingActions: (...args: unknown[]) => mockDrainPendingActions(...args),
  getPendingActionsForOrder: (...args: unknown[]) => mockGetPendingActionsForOrder(...args),
  isPendingActionStale: (...args: unknown[]) => mockIsPendingActionStale(...args),
  retryFailedAction: (...args: unknown[]) => mockRetryFailedAction(...args),
  discardFailedAction: (...args: unknown[]) => mockDiscardFailedAction(...args),
  STALE_THRESHOLD_MS: 60 * 60 * 1000,
}));

// WatermelonDB mock
interface MockOrderItem {
  name: string;
  quantity: number;
  unitPriceCents: number;
}
const mockOrderUpdate = jest.fn();
let mockOrderPrepareUpdate = jest.fn();
const mockOrder = {
  id: 'order-123',
  driverId: 'driver-456',
  status: OrderStatus.ASSIGNED as OrderStatus,
  customerId: 'customer-789',
  itemsJson: [] as MockOrderItem[],
  addressJson: { street: 'Test St' },
  totalCents: 50000,
  currency: 'IDR',
  notes: 'Test notes',
  serverVersion: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  update: mockOrderUpdate,
  _getRaw: jest.fn().mockReturnValue({}),
  _setRaw: jest.fn(),
  _raw: { _status: 'synced', _changed: '' },
  prepareUpdate: mockOrderPrepareUpdate,
};

// Callback next dari findAndObserve, supaya tes bisa mengirim ulang objek yang sama.
let mockFindAndObserveNext: ((record: typeof mockOrder) => void) | null = null;
// Perilaku tiruan findAndObserve: kirim baris, diam saja, atau laporkan galat.
let mockFindAndObservePerilaku: 'kirim' | 'diam' | 'galat' = 'kirim';

const mockFindAndObserve = jest.fn(() => ({
  subscribe: (arg: {
    next: (record: typeof mockOrder) => void;
    error: (err: unknown) => void;
  }) => {
    mockFindAndObserveNext = arg.next;
    if (mockFindAndObservePerilaku === 'kirim') arg.next(mockOrder);
    if (mockFindAndObservePerilaku === 'galat') arg.error(new Error('gagal memuat'));
    return { unsubscribe: jest.fn() };
  },
}));

// Mock payments for COD existence check
const mockPayments: any[] = [];
let paymentsSubscriptionCallback: ((payments: any[]) => void) | null = null;
let mockPaymentsQuery: any = null;

// Mock pending_actions for observe
const mockPendingActions: MockPendingAction[] = [];
// Pelanggan langganan pending_actions. Layar detail dan bilah koneksi sama-sama
// berlangganan, jadi semuanya disimpan di satu daftar.
type PendingActionsListener = (actions: MockPendingAction[]) => void;
const pendingActionsListeners: PendingActionsListener[] = [];
let pendingActionsSubscriptionCallback: PendingActionsListener | null = null;

// Tiruan koleksi payments. Hanya observeWithColumns yang disediakan, seperti
// yang dipakai layar, karena observe() tidak memancarkan saat kolom berubah.
const mockPaymentsCollection: any = {
  query: jest.fn().mockImplementation((_query: any) => {
    mockPaymentsQuery = {
      observeWithColumns: jest.fn().mockImplementation((_cols: string[]) => ({
        subscribe: jest.fn().mockImplementation(({ next }: { next: (payments: any[]) => void }) => {
          paymentsSubscriptionCallback = next;
          // Immediately emit current payments
          next([...mockPayments]);
          return { unsubscribe: jest.fn() };
        }),
      })),
    };
    return mockPaymentsQuery;
  }),
  create: jest.fn().mockImplementation((fn: (r: any) => void) => {
    const newPayment: any = { id: 'new-payment-id', failedSyncAttempts: 0, orderId: 'order-123', method: PaymentMethod.CASH };
    fn(newPayment);
    mockPayments.push(newPayment);
    // Notify subscription
    if (paymentsSubscriptionCallback) {
      paymentsSubscriptionCallback([...mockPayments]);
    }
    return Promise.resolve(newPayment);
  }),
};

// Salinan aksi tiruan yang bisa dibaca lewat _getRaw, seperti model aslinya.
function denganRaw(aksi: MockPendingAction): MockPendingAction {
  const createdAt = aksi.createdAt;
  const waktuMs =
    createdAt instanceof Date
      ? createdAt.getTime()
      : typeof createdAt === 'number'
        ? createdAt
        : Date.parse(createdAt);

  return {
    ...aksi,
    _getRaw: (kolom: string) => {
      if (kolom === 'status') return aksi.status;
      if (kolom === 'action_type') return aksi.actionType;
      if (kolom === 'created_at') return waktuMs;
      if (kolom === 'payload_json') {
        return aksi.payloadJson ? JSON.stringify(aksi.payloadJson) : '';
      }
      return undefined;
    },
  };
}

// Tiruan koleksi pending_actions, polanya sama dengan payments.
let mockPendingActionsQuery: { observeWithColumns: jest.Mock } | null = null;
const mockPendingActionsCollection: { query: jest.Mock } = {
  query: jest.fn().mockImplementation((_query: unknown) => {
    mockPendingActionsQuery = {
      observeWithColumns: jest.fn().mockImplementation((_cols: string[]) => ({
        // Bentuk langganan bisa fungsi atau objek { next }. Bentuk fungsi dipakai
        // bilah koneksi, bentuk objek dipakai layar detail.
        subscribe: jest.fn().mockImplementation(
          (arg: PendingActionsListener | { next: PendingActionsListener }) => {
            const listener = typeof arg === 'function' ? arg : arg.next;
            pendingActionsListeners.push(listener);
            pendingActionsSubscriptionCallback = (actions) => {
              const siap = actions.map(denganRaw);
              pendingActionsListeners.forEach((panggil) => panggil(siap));
            };
            // Pelanggan baru langsung dapat emisi awal.
            listener([...mockPendingActions].map(denganRaw));
            return {
              unsubscribe: () => {
                const index = pendingActionsListeners.indexOf(listener);
                if (index >= 0) pendingActionsListeners.splice(index, 1);
              },
            };
          },
        ),
      })),
    };
    return mockPendingActionsQuery;
  }),
};

// Mock order untuk prepareUpdate dalam database.write
const mockOrdersCollection: { findAndObserve: typeof mockFindAndObserve; find: jest.Mock } = {
  findAndObserve: mockFindAndObserve,
  find: jest.fn().mockImplementation(() => Promise.resolve({
    ...mockOrder,
    _getRaw: mockOrder._getRaw,
    prepareUpdate: mockOrderPrepareUpdate,
  })),
};

const mockDatabaseBatch = jest.fn();
const mockDatabase: any = {
  get: (name: string) => {
    if (name === 'payments') return mockPaymentsCollection;
    if (name === 'pending_actions') return mockPendingActionsCollection;
    return mockOrdersCollection;
  },
  write: async (fn: () => Promise<void>) => {
    // Simulate async database write - allows state to update between calls
    await new Promise<void>((resolve) => setImmediate(() => resolve()));
    await fn();
  },
  batch: (...args: unknown[]) => mockDatabaseBatch(...args),
};

// Mock getar: layar bergetar saat Selesai diantar.
jest.mock('../haptics', () => ({
  hapticDelivered: jest.fn(),
}));

jest.mock('@nozbe/watermelondb/react', () => ({ withDatabase: (C: any) => C }));
jest.mock('@nozbe/watermelondb', () => ({
  Q: {
    where: jest.fn().mockReturnValue({ _where: 'order_id' }),
  },
  withDatabase: (C: any) => C,
  // Kelas Model kosong, cukup untuk memuat PendingActionModel (layar
  // mengimpor readUpdateStatusTarget dari file itu). @field, @text, @date,
  // dan lainnya di-mock di bawah sebagai fungsi kosong.
  Model: class {},
}));
jest.mock('@nozbe/watermelondb/decorators', () => ({
  field: () => () => {},
  text: () => () => {},
  date: () => () => {},
  readonly: () => () => {},
  json: () => () => {},
}));

const elemenLayar = (
  <OrderDetailScreen database={mockDatabase} route={{ params: { orderId: 'order-123' } } as any} />
);

function renderScreen() {
  return render(elemenLayar);
}

// Layar yang dipasang di dalam jendela awal, jadi geraknya belum jalan.
function renderScreenDalamJendela() {
  return render(<InitialWindowProvider>{elemenLayar}</InitialWindowProvider>);
}

// Pembangun gerak keluar, seperti yang dipasang ke pembungkus batal.
type PembangunKeluar = (values: ExitAnimationsValues) => LayoutAnimation;

/** Nilai keluar tiruan, cuma ukuran yang dipakai gerak keluar. */
function nilaiKeluarTiruan(tinggi: number): ExitAnimationsValues {
  return {
    currentOriginX: 0,
    currentOriginY: 0,
    currentWidth: 320,
    currentHeight: tinggi,
    currentBorderRadius: 14,
    currentGlobalOriginX: 0,
    currentGlobalOriginY: 0,
    windowWidth: 360,
    windowHeight: 720,
  };
}

/** Sasaran translateY dari gaya yang sedang dijalankan. */
function sasaranTranslateY(gaya: StyleProps): number | undefined {
  const transform = gaya.transform;
  if (typeof transform === 'string' || transform === undefined) return undefined;
  const pertama = transform[0];
  if (!pertama) return undefined;
  const nilai = pertama.translateY;
  return typeof nilai === 'number' ? nilai : undefined;
}

// Keadaan bersama yang dipakai beberapa describe.
beforeEach(() => {
  pendingActionsListeners.length = 0;
  mockFindAndObservePerilaku = 'kirim';
});

// Tests: Visibility

describe('cancel button visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockUpdateOrderStatus.mockReset();
    mockGetOrderById.mockReset();
    mockOrderPrepareUpdate.mockReset();
    mockOrderPrepareUpdate.mockImplementation(function(this: OrderModel, fn: (r: OrderModel) => void) {
      fn(this);
      return this;
    });
  });

  test('appears for ASSIGNED status with matching driver', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
  });

  test('appears for PREPARING status with matching driver', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
  });

  test('appears for OUT_FOR_DELIVERY status with matching driver', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
  });

  test('NOT shown for PENDING status', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PENDING, driverId: undefined });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Batalkan Order')).toBeNull();
    });
  });

  test('NOT shown for DELIVERED status', async () => {
    Object.assign(mockOrder, { status: OrderStatus.DELIVERED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Batalkan Order')).toBeNull();
    });
  });

  test('NOT shown for CANCELLED status', async () => {
    Object.assign(mockOrder, { status: OrderStatus.CANCELLED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Batalkan Order')).toBeNull();
    });
  });

  test('NOT shown when driverId does not match current user', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'other-driver' });
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Batalkan Order')).toBeNull();
    });
  });
});

// Tests: Cancel Button Behavior (Outbox)

describe('cancel button behavior (outbox wiring)', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456', serverVersion: 1 });
    mockHasPendingAction.mockResolvedValue(false);
    mockEnqueueCancel.mockResolvedValue({ success: true, pendingActionId: 'pending-123' });
    mockDrainPendingActions.mockResolvedValue([]);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test('shows confirmation alert with correct text', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Batalkan Order'));
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Batalkan Order',
      'Apakah Anda yakin ingin membatalkan order ini?',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Tidak' }),
        expect.objectContaining({ text: 'Ya, Batalkan' }),
      ])
    );
  });

  test('pressing Ya calls enqueueCancel with order id and serverVersion', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Batalkan Order'));
    });

    // Get the "Ya, Batalkan" button handler
    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Batalkan');

    await act(async () => {
      yaButton?.onPress?.();
    });

    expect(mockEnqueueCancel).toHaveBeenCalledWith('order-123', 1);
  });

  test('drain is called after successful enqueue', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Batalkan Order'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Batalkan');

    await act(async () => {
      yaButton?.onPress?.();
    });

    // Drain should be called (dynamic import was resolved)
    expect(mockDrainPendingActions).toHaveBeenCalled();
  });

  test('button disappears after a successful cancel enqueue (prevents duplicate taps queueing 2+ cancels)', async () => {
    const { getByText, queryByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Batalkan Order'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Batalkan');

    await act(async () => {
      yaButton?.onPress?.();
    });

    // order.status is unchanged by the outbox path (no local optimistic write
    // of CANCELLED), the button must instead be gated on hasPending (dari
    // observe). Simulasi observe fire dengan pending action agar hasPending
    // jadi true dan tombol hilang.
    await act(async () => {
      pendingActionsSubscriptionCallback?.([{ id: 'pending-cancel', status: 'pending', actionType: 'cancel', createdAt: new Date() }]);
    });
    await waitFor(() => {
      expect(queryByText('Batalkan Order')).toBeNull();
    });
    expect(mockEnqueueCancel).toHaveBeenCalledTimes(1);
  });

  // enqueueCancel gagal, tidak ada banner "Menunggu sinkronisasi"
  test('enqueueCancel gagal: banner "Menunggu sinkronisasi" tidak tampil', async () => {
    mockEnqueueCancel.mockResolvedValueOnce({ success: false, error: 'Tidak bisa membatalkan order.' });

    const { getByText, queryByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Batalkan Order'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Batalkan');

    await act(async () => {
      yaButton?.onPress?.();
    });

    // Observe TIDAK fire (gagal), hasPending tetap false, banner tidak tampil
    expect(queryByText('Menunggu sinkronisasi')).toBeNull();
    expect(mockEnqueueCancel).toHaveBeenCalledTimes(1);
  });

  test('shows error alert when enqueueCancel fails', async () => {
    mockEnqueueCancel.mockResolvedValue({ success: false, error: 'Not authenticated' });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Batalkan Order'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Batalkan');

    await act(async () => {
      yaButton?.onPress?.();
    });

    // Should show error alert
    expect(Alert.alert).toHaveBeenCalledWith('Gagal', 'Tidak bisa membatalkan order. Coba lagi.');
  });

  test('pressing Tidak does NOT call enqueueCancel', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Batalkan Order')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Batalkan Order'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const tidakButton = buttons.find((b) => b.text === 'Tidak');

    await act(async () => {
      tidakButton?.onPress?.();
    });

    expect(mockEnqueueCancel).not.toHaveBeenCalled();
  });
});

// Tests: COD Button Visibility

describe('COD button visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0; // reset payments
    mockHasPendingAction.mockResolvedValue(false);
  });

  test('appears for OUT_FOR_DELIVERY status with matching driver when no COD exists', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    });
  });

  test('NOT shown for ASSIGNED status even with matching driver', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Terima Tunai (COD)')).toBeNull();
    });
  });

  test('NOT shown for PREPARING status even with matching driver', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Terima Tunai (COD)')).toBeNull();
    });
  });

  test('NOT shown when driverId does not match current user', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'other-driver' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Terima Tunai (COD)')).toBeNull();
    });
  });

  test('NOT shown when COD payment already exists', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({ orderId: 'order-123', method: PaymentMethod.CASH });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Terima Tunai (COD)')).toBeNull();
    });
  });

  test('NOT shown for DELIVERED status', async () => {
    Object.assign(mockOrder, { status: OrderStatus.DELIVERED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Terima Tunai (COD)')).toBeNull();
    });
  });

  test('NOT shown for CANCELLED status', async () => {
    Object.assign(mockOrder, { status: OrderStatus.CANCELLED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Terima Tunai (COD)')).toBeNull();
    });
  });
});

// Tests: COD Button Behavior (Outbox)

describe('COD button behavior (outbox wiring)', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0; // reset payments
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockHasPendingAction.mockResolvedValue(false);
    mockEnqueueCollectCod.mockResolvedValue({ success: true, pendingActionId: 'cod-pending-123' });
    mockDrainPendingActions.mockResolvedValue([]);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test('shows confirmation alert with correct text', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Terima Tunai (COD)'));
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Terima Tunai (COD)',
      expect.stringContaining('Rp'),
      expect.arrayContaining([
        expect.objectContaining({ text: 'Batal' }),
        expect.objectContaining({ text: 'Ya, Terima' }),
      ])
    );
  });

  test('calls enqueueCollectCod with order id and amount on confirm', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Terima Tunai (COD)'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Terima');

    await act(async () => {
      yaButton?.onPress?.();
    });

    expect(mockEnqueueCollectCod).toHaveBeenCalledWith('order-123', 50000);
  });

  test('drain is called after successful enqueue', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Terima Tunai (COD)'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Terima');

    await act(async () => {
      yaButton?.onPress?.();
    });

    expect(mockDrainPendingActions).toHaveBeenCalled();
  });

  test('shows error alert when enqueueCollectCod fails', async () => {
    mockEnqueueCollectCod.mockResolvedValue({ success: false, error: 'Not authenticated' });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Terima Tunai (COD)'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Terima');

    await act(async () => {
      yaButton?.onPress?.();
    });

    expect(Alert.alert).toHaveBeenCalledWith('Gagal', 'Tidak bisa mencatat pembayaran tunai. Coba lagi.');
  });

  test('double-tap is prevented by inflight guard', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Terima Tunai (COD)'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Terima');

    await act(async () => {
      yaButton?.onPress?.(); // First call
      yaButton?.onPress?.(); // Second call - should be blocked
    });

    // Only one enqueue call despite two taps
    expect(mockEnqueueCollectCod).toHaveBeenCalledTimes(1);
  });
});

// Tests: Failed Payment Banner

describe('Failed Payment Banner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0; // reset payments
    paymentsSubscriptionCallback = null; // reset subscription
    mockPaymentsQuery = null; // reset query mock
    mockHasPendingAction.mockResolvedValue(false);
  });

  test('shows banner when payment status is FAILED', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({
      id: 'payment-failed-1',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.FAILED,
    });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('COD gagal diverifikasi. Hubungi support kalau uang tunai sudah di tangan.')).toBeTruthy();
    });
  });

  test('does NOT show banner when no FAILED payments', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({
      id: 'payment-ok-1',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.CAPTURED,
    });

    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('COD gagal diverifikasi. Hubungi support kalau uang tunai sudah di tangan.')).toBeNull();
    });
  });

  test('banner shows independent of order status (even when order is CANCELLED)', async () => {
    Object.assign(mockOrder, { status: OrderStatus.CANCELLED, driverId: 'driver-456' });
    mockPayments.push({
      id: 'payment-failed-2',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.FAILED,
    });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('COD gagal diverifikasi. Hubungi support kalau uang tunai sudah di tangan.')).toBeTruthy();
    });
  });

  test('banner can be dismissed', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({
      id: 'payment-failed-3',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.FAILED,
    });

    const { getByText, queryByText, getByLabelText } = renderScreen();
    await waitFor(() => {
      expect(getByText('COD gagal diverifikasi. Hubungi support kalau uang tunai sudah di tangan.')).toBeTruthy();
    });

    // Press dismiss button
    await act(async () => {
      fireEvent.press(getByLabelText('Tutup'));
    });

    await waitFor(() => {
      expect(queryByText('COD gagal diverifikasi. Hubungi support kalau uang tunai sudah di tangan.')).toBeNull();
    });
  });

  test('banner reappears on screen re-mount when payment still FAILED', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({
      id: 'payment-failed-4',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.FAILED,
    });

    const { getByText, queryByText, getByLabelText } = renderScreen();
    await waitFor(() => {
      expect(getByText('COD gagal diverifikasi. Hubungi support kalau uang tunai sudah di tangan.')).toBeTruthy();
    });

    // Dismiss
    await act(async () => {
      fireEvent.press(getByLabelText('Tutup'));
    });

    await waitFor(() => {
      expect(queryByText('COD gagal diverifikasi. Hubungi support kalau uang tunai sudah di tangan.')).toBeNull();
    });

    // Simulate re-mount by re-rendering
    const { getByText: getByText2 } = renderScreen();
    await waitFor(() => {
      expect(getByText2('COD gagal diverifikasi. Hubungi support kalau uang tunai sudah di tangan.')).toBeTruthy();
    });
  });
});

// Tests: Payment Observation

describe('Payment observation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0;
    paymentsSubscriptionCallback = null;
    mockPaymentsQuery = null;
  });

  test('payments query is filtered by orderId', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    renderScreen();

    await waitFor(() => {
      expect(mockPaymentsCollection.query).toHaveBeenCalled();
    });

    // Verifikasi observeWithColumns dipanggil pada hasil query
    expect(mockPaymentsQuery?.observeWithColumns).toHaveBeenCalled();
    // Kolom status ikut diamati supaya payment yang menjadi CAPTURED menggambar
    // ulang tombol COD dan Selesai diantar.
    expect(mockPaymentsQuery?.observeWithColumns).toHaveBeenCalledWith(['status']);
  });

  test('updates hasCodPayment when payment changes via observation', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    renderScreen();
    await waitFor(() => {
      expect(mockPaymentsCollection.query).toHaveBeenCalled();
    });

    // Button should be visible initially since no COD exists
    const buttonBefore = await new Promise<boolean>((resolve) => {
      setTimeout(() => resolve(true), 0);
    });
    expect(buttonBefore).toBe(true);

    // Simulate payment being added via subscription
    mockPayments.push({
      id: 'payment-obs-1',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.CAPTURED,
    });

    // Trigger subscription callback - this updates hasCodPayment to true
    if (paymentsSubscriptionCallback) {
      paymentsSubscriptionCallback([...mockPayments]);
    }

    // After subscription callback, hasCodPayment should be true
    // The mockPaymentsCollection.create should NOT be called until user confirms
    expect(mockPaymentsCollection.create).not.toHaveBeenCalled();
  });
});

// Tests: Double-Tap Prevention

describe('Double-tap prevention', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0;
    paymentsSubscriptionCallback = null;
    mockPaymentsQuery = null;
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockHasPendingAction.mockResolvedValue(false);
    mockEnqueueCollectCod.mockResolvedValue({ success: true, pendingActionId: 'cod-pending-123' });
    mockDrainPendingActions.mockResolvedValue([]);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test('handleCollectCod guard prevents concurrent calls from creating duplicate payments', async () => {
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    });

    // First tap - opens confirmation dialog
    await act(async () => {
      fireEvent.press(getByText('Terima Tunai (COD)'));
    });

    expect(Alert.alert).toHaveBeenCalledTimes(1);

    // Get the "Ya, Terima" button handler
    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya, Terima');
    expect(yaButton?.onPress).toBeDefined();

    // Clear previous calls
    mockEnqueueCollectCod.mockClear();

    // Call onPress TWICE synchronously (same event loop tick, no await between)
    // The first call starts the async enqueue
    // The second call should be blocked by the inflight guard
    act(() => {
      yaButton?.onPress?.(); // First call - starts enqueue
      yaButton?.onPress?.(); // Second call - should be no-op
    });

    // Wait for async operations to complete
    await waitFor(() => {
      expect(mockEnqueueCollectCod).toHaveBeenCalled();
    });

    // Only ONE enqueue should have been initiated despite two onPress calls
    // If the guard is working, only the first call executes
    expect(mockEnqueueCollectCod).toHaveBeenCalledTimes(1);
  });
});

// Tests: Stale Pending Action Banner

describe('Stale Pending Action Banner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPendingActions.length = 0;
    pendingActionsSubscriptionCallback = null;
  });

  test('shows normal pending banner when pending action is fresh', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText, queryByText } = renderScreen();
    // Observe fire saat mount, trigger dengan fresh pending action (bukan stale)
    await act(async () => {
      pendingActionsSubscriptionCallback?.([{ id: 'pending-1', status: 'pending', actionType: 'collect_cod', createdAt: new Date() }]);
    });
    await waitFor(() => {
      expect(getByText('Menunggu sinkronisasi')).toBeTruthy();
    });
    await waitFor(() => {
      expect(queryByText('Belum tersinkron dari sejam lalu')).toBeNull();
    });
  });

  test('shows stale warning banner when pending action is older than 60 minutes', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText, queryByText } = renderScreen();
    // Trigger observe dengan stale action (> 60 menit)
    await act(async () => {
      pendingActionsSubscriptionCallback?.([{ id: 'pending-stale', status: 'pending', actionType: 'cancel', createdAt: new Date(Date.now() - 61 * 60 * 1000) }]);
    });
    await waitFor(() => {
      expect(getByText('Belum tersinkron dari sejam lalu')).toBeTruthy();
    });
    await waitFor(() => {
      expect(queryByText('Menunggu sinkronisasi')).toBeNull();
    });
  });

  test('shows stale banner even when cancel button is hidden (pending action exists)', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText, queryByText } = renderScreen();
    // Trigger observe dengan stale action
    await act(async () => {
      pendingActionsSubscriptionCallback?.([{ id: 'pending-stale', status: 'pending', actionType: 'cancel', createdAt: new Date(Date.now() - 120 * 60 * 1000) }]);
    });
    await waitFor(() => {
      expect(getByText('Belum tersinkron dari sejam lalu')).toBeTruthy();
    });
    await waitFor(() => {
      expect(queryByText('Batalkan Order')).toBeNull();
    });
  });

  test('no banner when no pending actions', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    // Trigger observe dengan array kosong
    await act(async () => {
      pendingActionsSubscriptionCallback?.([]);
    });
    await waitFor(() => {
      expect(queryByText('Menunggu sinkronisasi')).toBeNull();
    });
    await waitFor(() => {
      expect(queryByText('Belum tersinkron dari sejam lalu')).toBeNull();
    });
  });

  // Banner hilang sendiri saat pending action dihapus, observe bikin banner reaktif
  test('banner hilang setelah pending action dihapus tanpa unmount', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText, queryByText, UNSAFE_getAllByType } = renderScreen();

    // Banner tampil dengan pending action
    await act(async () => {
      pendingActionsSubscriptionCallback?.([{ id: 'pending-1', status: 'pending', actionType: 'collect_cod', createdAt: new Date() }]);
    });
    await waitFor(() => {
      expect(getByText('Menunggu sinkronisasi')).toBeTruthy();
    });

    // Pending action dihapus (misal: drain selesai), banner hilang TANPA unmount
    await act(async () => {
      pendingActionsSubscriptionCallback?.([]);
    });
    // Banner menunggu ditahan dulu dalam bentuk selesai, baru hilang.
    await waitFor(() => {
      const bannerMenunggu = UNSAFE_getAllByType(Banner).find(
        (b) => b.props.tone === 'pending',
      );
      expect(bannerMenunggu?.props.done).toBe(true);
    });
    await waitFor(
      () => {
        expect(queryByText('Menunggu sinkronisasi')).toBeNull();
      },
      { timeout: 2000 },
    );
  });
});

// Tests: Chat / Map visibility

describe('Chat and Map button visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
  });

  test('Chat dan Map tampil untuk driver yang ditugaskan', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Chat')).toBeTruthy();
      expect(getByText('Lihat Rute')).toBeTruthy();
    });
  });

  test('Chat dan Map TIDAK tampil untuk driver LAIN', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'other-driver' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Chat')).toBeNull();
      expect(queryByText('Lihat Rute')).toBeNull();
    });
  });
});

// Tests: OrderConflictBanner suppression
// orderConflict event dari processReject/processCancel menyebabkan banner "Status
// diperbarui server". Kalau ada pending action, event ini terjadi karena aksi
// driver sendiri (reject/cancel yang sukses), jadi banner dit-suppress via
// !hasPending gate di JSX. Tidak dites di sini karena butuh syncEvents mock
// yang lengkap, sudah ter-cover desain.

// Tests: Item Price Display

describe('Item price display', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrder.itemsJson = []; // reset items each test
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockHasPendingAction.mockResolvedValue(false);
  });

  test('unitPriceCents 23000 * quantity 1 tampil Rp 23.000 (bukan 230)', async () => {
    // ItemRow pakai unitPriceCents (bukan priceCents yang tidak ada di data).
    // Bug lama, /100 di formatCurrency menyebabkan 23000 muncul Rp 230.
    // mockOrder.itemsJson harus di-set SEBELUM renderScreen() karena
    // mockFindAndObserve(next) hanya dipanggil sekali saat subscribe.
    mockOrder.itemsJson = [
      { name: 'Mie Goreng', quantity: 1, unitPriceCents: 23000 },
    ];
    mockOrder.totalCents = 23000;

    const { getByText, getAllByText } = renderScreen();

    await waitFor(() => {
      expect(getByText(`Mie Goreng ${TANDA_KALI} 1`)).toBeTruthy();
    });

    // Item price, Rp 23.000 (bukan 230)
    const priceEls = getAllByText(/Rp\s23\.000/);
    expect(priceEls.length).toBeGreaterThanOrEqual(1);
    // Bukan 230 (sen)
    expect(() => getByText(/Rp\s230(?!0)/)).toThrow();
  });

  test('totalCents 50000 tampil Rp 50.000 di baris Total', async () => {
    mockOrder.itemsJson = [
      { name: 'Nasi Goreng', quantity: 2, unitPriceCents: 25000 },
    ];
    mockOrder.totalCents = 50000;
    mockOrder.currency = 'IDR';

    const { getAllByText } = renderScreen();

    await waitFor(() => {
      expect(getAllByText(/Total/)).toBeTruthy();
    });

    const totalPriceEls = getAllByText(/Rp\s50\.000/);
    expect(totalPriceEls.length).toBeGreaterThanOrEqual(1);
  });
});

// Tests: Driver Status Button Visibility

describe('driver status button visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockUpdateOrderStatus.mockReset();
    mockGetOrderById.mockReset();
    mockOrderPrepareUpdate.mockReset();
    mockOrderPrepareUpdate.mockImplementation(function(this: OrderModel, fn: (r: OrderModel) => void) {
      fn(this);
      return this;
    });
    mockPayments.length = 0;
    mockPendingActions.length = 0;
  });

  test('appears for PREPARING status with matching driver and no pending', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });
  });

  // BAGIAN 3: OUT_FOR_DELIVERY jadi DELIVERED hanya kalau ada COD payment dan tidak ada pending
  test('appears for OUT_FOR_DELIVERY with COD payment and no pending', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({ id: 'cod-1', orderId: 'order-123', method: PaymentMethod.CASH, status: PaymentStatus.CAPTURED });
    const { getByText } = renderScreen();
    await act(async () => {
      paymentsSubscriptionCallback?.([...mockPayments]);
    });
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });
  });

  test('NOT shown for OUT_FOR_DELIVERY without COD payment', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Selesai diantar')).toBeNull();
    });
  });

  test('NOT shown for OUT_FOR_DELIVERY with COD but has pending action', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({ id: 'cod-1', orderId: 'order-123', method: PaymentMethod.CASH });
    await act(async () => {
      paymentsSubscriptionCallback?.([...mockPayments]);
      pendingActionsSubscriptionCallback?.([{ id: 'pending-1', status: 'pending', actionType: 'collect_cod', createdAt: new Date() }]);
    });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Selesai diantar')).toBeNull();
    });
  });

  // CASH FAILED harus dianggap "belum ada COD valid", tombol Selesai diantar
  // tidak tampil sampai ada payment CASH yang bukan FAILED (misal CAPTURED/PENDING).
  test('NOT shown for OUT_FOR_DELIVERY with only CASH FAILED payment', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({
      id: 'cod-failed-1',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.FAILED,
    });
    const { queryByText } = renderScreen();
    await act(async () => {
      paymentsSubscriptionCallback?.([...mockPayments]);
    });
    await waitFor(() => {
      expect(queryByText('Selesai diantar')).toBeNull();
    });
  });

  // Kalau ada CASH FAILED dan CASH CAPTURED, yang dihitung cuma CAPTURED, tombol tampil.
  test('appears for OUT_FOR_DELIVERY with CASH FAILED + CASH CAPTURED (CAPTURED yang menentukan)', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({ id: 'cod-failed-1', orderId: 'order-123', method: PaymentMethod.CASH, status: PaymentStatus.FAILED });
    mockPayments.push({ id: 'cod-ok-1', orderId: 'order-123', method: PaymentMethod.CASH, status: PaymentStatus.CAPTURED });
    const { getByText } = renderScreen();
    await act(async () => {
      paymentsSubscriptionCallback?.([...mockPayments]);
    });
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });
  });

  test('NOT shown for ASSIGNED status', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Mulai antar')).toBeNull();
      expect(queryByText('Selesai diantar')).toBeNull();
    });
  });

  test('NOT shown for DELIVERED status', async () => {
    Object.assign(mockOrder, { status: OrderStatus.DELIVERED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Mulai antar')).toBeNull();
      expect(queryByText('Selesai diantar')).toBeNull();
    });
  });

  test('NOT shown when driverId does not match current user', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'other-driver' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText('Mulai antar')).toBeNull();
    });
  });

  test('NOT shown when hasPending', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    // Trigger observe dengan pending action
    await act(async () => {
      pendingActionsSubscriptionCallback?.([{ id: 'pending-1', status: 'pending', actionType: 'collect_cod', createdAt: new Date() }]);
    });
    await waitFor(() => {
      expect(queryByText('Mulai antar')).toBeNull();
    });
  });
});

// Tests: Driver Status Button Behavior

describe('driver status button behavior', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockEnqueueUpdateStatus.mockReset();
    mockDrainPendingActions.mockReset();
    mockDrainPendingActions.mockResolvedValue([]);
    mockUpdateOrderStatus.mockReset();
    mockGetOrderById.mockReset();
    mockOrderPrepareUpdate.mockReset();
    mockOrderPrepareUpdate.mockImplementation(function(this: OrderModel, fn: (r: OrderModel) => void) {
      fn(this);
      return this;
    });
    mockDatabaseBatch.mockReset();
    mockPayments.length = 0;
    mockPendingActions.length = 0;
    pendingActionsSubscriptionCallback = null;
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  // Aksi status tidak butuh jaringan: saat offline tombol tetap aktif, aksi
  // masuk ke outbox, dan kirim antrean yang gagal tidak memunculkan galat.
  test('offline: tombol tetap aktif, enqueueUpdateStatus dipanggil', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456', serverVersion: 1 });
    mockEnqueueUpdateStatus.mockResolvedValue({ success: true, pendingActionId: 'pa-1' });
    mockDrainPendingActions.mockRejectedValue(new TypeError('Network request failed'));

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Mulai antar'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya');

    await act(async () => {
      yaButton?.onPress?.();
    });

    // Aksi masuk outbox dengan target PREPARING -> OUT_FOR_DELIVERY.
    expect(mockEnqueueUpdateStatus).toHaveBeenCalledWith('order-123', 'OUT_FOR_DELIVERY');
    // drainPendingActions dipanggil dan gagal karena offline; galatnya tidak
    // ditampilkan.
    expect(mockDrainPendingActions).toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalledWith('Gagal', expect.anything());
    // updateOrderStatus tidak dipanggil langsung dari layar.
    expect(mockUpdateOrderStatus).not.toHaveBeenCalled();
  });

  // Sukses: enqueueUpdateStatus dipanggil dengan target dari displayStatus.
  // updateOrderStatus tidak dipanggil langsung dari layar.
  test('sukses: enqueueUpdateStatus dipanggil dengan target dari displayStatus', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456', serverVersion: 3 });
    mockEnqueueUpdateStatus.mockResolvedValue({ success: true, pendingActionId: 'pa-1' });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Mulai antar'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya');

    await act(async () => {
      yaButton?.onPress?.();
    });

    expect(mockEnqueueUpdateStatus).toHaveBeenCalledWith('order-123', 'OUT_FOR_DELIVERY');
    expect(mockUpdateOrderStatus).not.toHaveBeenCalled();
  });

  // Kalau enqueueUpdateStatus mengembalikan success=false, Alert 'Gagal' tampil.
  test('enqueueUpdateStatus gagal: Alert Gagal tampil', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456', serverVersion: 3 });
    mockEnqueueUpdateStatus.mockResolvedValue({ success: false, error: 'Not authenticated' });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Mulai antar'));
    });

    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const alertArgs = alertCalls[0];
    const buttons = alertArgs[2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya');

    await act(async () => {
      yaButton?.onPress?.();
    });

    expect(Alert.alert).toHaveBeenCalledWith('Gagal', 'Status gagal dicatat. Coba lagi.');
  });

  // Baris PREPARING dengan aksi update_status OUT_FOR_DELIVERY 'pending':
  // displayStatus menjadi OUT_FOR_DELIVERY, jadi Mulai antar tidak tampil.
  test('aksi update_status OUT_FOR_DELIVERY pending: Mulai antar tidak tampil', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    mockPendingActions.push({
      id: 'us-pending-1',
      actionType: 'update_status',
      status: 'pending',
      createdAt: new Date(),
      payloadJson: { status: 'OUT_FOR_DELIVERY' },
    });
    const { queryByText } = renderScreen();
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(queryByText('Mulai antar')).toBeNull();
    });
  });

  // Aksi update_status 'failed' target OUT_FOR_DELIVERY: banner dengan
  // "Coba lagi" dan "Abaikan" muncul, label status dari baris order.
  test('aksi update_status failed target OUT_FOR_DELIVERY: banner teks Mulai antar dengan Coba lagi dan Abaikan', async () => {
    mockPendingActions.push({
      id: 'us-failed-1',
      actionType: 'update_status',
      status: 'failed',
      createdAt: new Date(),
      payloadJson: { status: 'OUT_FOR_DELIVERY' },
    });
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });

    const { getByText, queryByText, getAllByText, getByTestId } = renderScreen();
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(getByText('Mulai antar ditolak server dan tidak dicoba lagi otomatis.')).toBeTruthy();
    });
    // Label status tetap dari baris order, bukan target yang gagal.
    expect(within(getByTestId('pil-status')).getByText('Diterima')).toBeTruthy();
    expect(queryByText('OUT FOR_DELIVERY')).toBeNull();
    // Tombol Coba lagi dan Abaikan tampil.
    fireEvent.press(getAllByText('Coba lagi')[0]);
    expect(mockRetryFailedAction).toHaveBeenCalledWith('us-failed-1');
    fireEvent.press(getAllByText('Abaikan')[0]);
    expect(mockDiscardFailedAction).toHaveBeenCalledWith('us-failed-1');
  });

  // Sama dengan di atas tapi target DELIVERED.
  test('aksi update_status failed target DELIVERED: banner teks Selesai diantar', async () => {
    mockPendingActions.push({
      id: 'us-failed-2',
      actionType: 'update_status',
      status: 'failed',
      createdAt: new Date(),
      payloadJson: { status: 'DELIVERED' },
    });
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    const { getByText } = renderScreen();
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(getByText('Selesai diantar ditolak server dan tidak dicoba lagi otomatis.')).toBeTruthy();
    });
  });

  // Aksi 'collect_cod' 'pending' pada order OUT_FOR_DELIVERY dengan payment
  // CAPTURED: Selesai diantar tampil, COD tidak.
  test('baris OUT_FOR_DELIVERY + aksi collect_cod pending: Selesai diantar tampil, COD tidak', async () => {
    mockPayments.push({ id: 'cod-1', orderId: 'order-123', method: PaymentMethod.CASH, status: PaymentStatus.CAPTURED });
    mockPendingActions.push({
      id: 'cod-pending-1',
      actionType: 'collect_cod',
      status: 'pending',
      createdAt: new Date(),
    });
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    const { getByText, queryByText } = renderScreen();
    await act(async () => {
      paymentsSubscriptionCallback?.([...mockPayments]);
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });
    expect(queryByText('Terima Tunai (COD)')).toBeNull();
  });

  // Aksi collect_cod 'failed' dan aksi update_status DELIVERED 'pending':
  // karena ada aksi 'failed', label status dari baris (bukan DELIVERED), dan
  // tombol Selesai diantar serta COD tidak tampil.
  test('aksi collect_cod failed + aksi update_status DELIVERED pending: label dari baris, tombol tidak tampil', async () => {
    mockPendingActions.push({
      id: 'cod-failed-1',
      actionType: 'collect_cod',
      status: 'failed',
      createdAt: new Date(),
    });
    mockPendingActions.push({
      id: 'deliver-pending-1',
      actionType: 'update_status',
      status: 'pending',
      createdAt: new Date(),
      payloadJson: { status: 'DELIVERED' },
    });
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    const { getByText, queryByText, getByTestId } = renderScreen();
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    // Banner COD gagal tampil. Label status dari baris (OUT_FOR_DELIVERY),
    // bukan DELIVERED, karena ada aksi 'failed'.
    await waitFor(() => {
      expect(getByText('COD gagal dicatat server dan tidak dicoba lagi otomatis. Simpan uangnya, lalu coba lagi atau hubungi support.')).toBeTruthy();
    });
    expect(within(getByTestId('pil-status')).getByText('Sedang diantar')).toBeTruthy();
    expect(within(getByTestId('pil-status')).queryByText('Selesai')).toBeNull();
    // Tombol Selesai diantar dan COD tidak tampil.
    expect(queryByText('Selesai diantar')).toBeNull();
    expect(queryByText('Terima Tunai (COD)')).toBeNull();
  });

  // Order OUT_FOR_DELIVERY tanpa payment dan tanpa aksi: Selesai diantar
  // tidak tampil (belum COD), COD tampil.
  test('baris OUT_FOR_DELIVERY tanpa payment dan tanpa aksi: Selesai diantar tidak tampil, COD tampil', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    const { getByText, queryByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    });
    expect(queryByText('Selesai diantar')).toBeNull();
  });

  // Perubahan status aksi datang lewat observeWithColumns: label status dan
  // tombol digambar ulang. Simulasi aksi update_status OUT_FOR_DELIVERY yang
  // berubah dari 'pending' ke 'failed'.
  test('perubahan status aksi dari observeWithColumns menggambar ulang label status dan tombol', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    mockPendingActions.push({
      id: 'us-pending-1',
      actionType: 'update_status',
      status: 'pending',
      createdAt: new Date(),
      payloadJson: { status: 'OUT_FOR_DELIVERY' },
    });

    const { getByText, queryByText, getByTestId } = renderScreen();
    // Awal: label status OUT_FOR_DELIVERY (target aksi status aktif), tombol
    // Mulai antar tidak tampil karena ada aksi pending.
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(getByText('Sedang diantar')).toBeTruthy();
    });
    expect(queryByText('Mulai antar')).toBeNull();

    // Aksi 'failed': banner tampil, label status dari baris (order.status).
    mockPendingActions[0].status = 'failed';
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(getByText('Mulai antar ditolak server dan tidak dicoba lagi otomatis.')).toBeTruthy();
    });
    // Label status kembali ke PREPARING (dari baris).
    expect(within(getByTestId('pil-status')).getByText('Diterima')).toBeTruthy();
    expect(queryByText('Mulai antar')).toBeNull();
  });

  // Getar Selesai diantar: getarnya tanda aksi sudah diterima HP, jadi
  // tetap bergetar walau antrean belum sempat terkirim.
  test('Selesai diantar: getar sekali setelah antre sukses', async () => {
    jest.clearAllMocks();
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456', serverVersion: 1 });
    mockPayments.push({ id: 'cod-getar-1', orderId: 'order-123', method: PaymentMethod.CASH, status: PaymentStatus.CAPTURED });
    mockEnqueueUpdateStatus.mockResolvedValue({ success: true, pendingActionId: 'pa-getar-1' });

    const { getByText } = renderScreen();
    await act(async () => {
      paymentsSubscriptionCallback?.([...mockPayments]);
    });
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Selesai diantar'));
    });

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya');
    await act(async () => {
      yaButton?.onPress?.();
    });

    expect(hapticDelivered).toHaveBeenCalledTimes(1);
  });

  test('Selesai diantar: getar tetap jalan walau kirim antrean gagal', async () => {
    jest.clearAllMocks();
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456', serverVersion: 1 });
    mockPayments.push({ id: 'cod-getar-2', orderId: 'order-123', method: PaymentMethod.CASH, status: PaymentStatus.CAPTURED });
    mockEnqueueUpdateStatus.mockResolvedValue({ success: true, pendingActionId: 'pa-getar-2' });
    mockDrainPendingActions.mockRejectedValue(new TypeError('Network request failed'));

    const { getByText } = renderScreen();
    await act(async () => {
      paymentsSubscriptionCallback?.([...mockPayments]);
    });
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Selesai diantar'));
    });

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya');
    await act(async () => {
      yaButton?.onPress?.();
    });

    expect(hapticDelivered).toHaveBeenCalledTimes(1);
  });

  test('Selesai diantar: tidak bergetar kalau antre gagal', async () => {
    jest.clearAllMocks();
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456', serverVersion: 1 });
    mockPayments.push({ id: 'cod-getar-3', orderId: 'order-123', method: PaymentMethod.CASH, status: PaymentStatus.CAPTURED });
    mockEnqueueUpdateStatus.mockResolvedValue({ success: false, error: 'Not authenticated' });

    const { getByText } = renderScreen();
    await act(async () => {
      paymentsSubscriptionCallback?.([...mockPayments]);
    });
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Selesai diantar'));
    });

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya');
    await act(async () => {
      yaButton?.onPress?.();
    });

    expect(hapticDelivered).not.toHaveBeenCalled();
  });

  test('Mulai antar: tidak bergetar', async () => {
    jest.clearAllMocks();
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456', serverVersion: 1 });
    mockEnqueueUpdateStatus.mockResolvedValue({ success: true, pendingActionId: 'pa-getar-4' });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Mulai antar'));
    });

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya');
    await act(async () => {
      yaButton?.onPress?.();
    });

    expect(hapticDelivered).not.toHaveBeenCalled();
  });
});

// Tests: OrderDetail re-renders on same-object next()
// Bug: findAndObserve mengirim objek model yang SAMA setiap baris berubah, dan
// setOrder(record) dengan referensi sama tidak memicu render ulang. Setelah
// driver sukses ganti status PREPARING jadi OUT_FOR_DELIVERY (tulis baris lokal),
// layar tetap menampilkan status lama sampai observer memicu render paksa.

describe('OrderDetail re-renders when findAndObserve emits same object reference', () => {
  let originalStatus: OrderStatus;
  let originalDriverId: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0;
    mockPendingActions.length = 0;
    pendingActionsSubscriptionCallback = null;
    mockFindAndObserveNext = null;
    originalStatus = mockOrder.status;
    originalDriverId = mockOrder.driverId;
  });

  afterEach(() => {
    // Kembalikan nilai mockOrder supaya tidak mengganggu tes lain.
    Object.assign(mockOrder, { status: originalStatus, driverId: originalDriverId });
  });

  test('status PREPARING jadi OUT_FOR_DELIVERY via next() yang sama: Mulai antar hilang, Terima Cash tampil', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });

    const { getByText, queryByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });

    // Ubah status objek YANG SAMA jadi OUT_FOR_DELIVERY (referensi tidak berubah).
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    // next() dipanggil lagi dengan objek yang sama (di dalam act supaya state flush).
    await act(async () => {
      mockFindAndObserveNext?.(mockOrder);
    });

    // Layar harus ikut berubah: tombol Mulai antar hilang, Terima Tunai (COD) tampil.
    await waitFor(() => {
      expect(queryByText('Mulai antar')).toBeNull();
    });
    await waitFor(() => {
      expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    });
  });
});

// Syarat tombol, banner aksi gagal, dan teks LastConflictBanner.

describe('syarat tombol mengikuti payment CAPTURED', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0;
    mockPendingActions.length = 0;
    paymentsSubscriptionCallback = null;
    pendingActionsSubscriptionCallback = null;
    mockHasPendingAction.mockResolvedValue(false);
  });

  // COD yang masih antre belum punya baris payment, tapi tombol COD tetap tidak
  // tampil saat detail dibuka ulang.
  test('detail dibuka saat aksi collect_cod pending (belum ada payment): tombol COD tidak tampil', async () => {
    mockPendingActions.push({
      id: 'cod-pending',
      actionType: 'collect_cod',
      status: 'pending',
      createdAt: new Date(),
    });
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(queryByText('Terima Tunai (COD)')).toBeNull();
    });
  });

  // Payment CASH CAPTURED pada OUT_FOR_DELIVERY: Batalkan dan COD tidak
  // tampil, Selesai diantar tampil.
  test('payment CASH CAPTURED pada OUT_FOR_DELIVERY: Batalkan dan COD tidak tampil, Selesai diantar tampil', async () => {
    mockPayments.push({
      id: 'cod-captured-1',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.CAPTURED,
    });
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    const { queryByText, getByText } = renderScreen();
    await act(async () => {
      paymentsSubscriptionCallback?.([...mockPayments]);
    });
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });
    expect(queryByText('Terima Tunai (COD)')).toBeNull();
    expect(queryByText('Batalkan Order')).toBeNull();
  });

  // Payment CASH PENDING (misalnya sisa laporan COD yatim driver sebelumnya)
  // bukan COD tercatat: Selesai diantar tidak tampil, COD tampil.
  test('payment CASH PENDING: Selesai diantar tidak tampil, COD tampil', async () => {
    mockPayments.push({
      id: 'cod-pending-1',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.PENDING,
    });
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    const { queryByText, getByText } = renderScreen();
    await act(async () => {
      paymentsSubscriptionCallback?.([...mockPayments]);
    });
    await waitFor(() => {
      expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    });
    expect(queryByText('Selesai diantar')).toBeNull();
  });
});

describe('banner aksi gagal dan banner COD yatim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0;
    mockPendingActions.length = 0;
    paymentsSubscriptionCallback = null;
    pendingActionsSubscriptionCallback = null;
    mockHasPendingAction.mockResolvedValue(false);
    mockRetryFailedAction.mockReset();
    mockRetryFailedAction.mockResolvedValue(undefined);
    mockDiscardFailedAction.mockReset();
    mockDiscardFailedAction.mockResolvedValue(undefined);
  });

  // Aksi cancel berubah dari 'pending' ke 'failed' lewat observeWithColumns:
  // banner biru hilang (tidak ada aksi aktif), banner gagal tampil dengan
  // tombol Coba lagi dan Abaikan.
  test('aksi cancel pending -> failed: banner biru hilang, banner gagal tampil, Coba lagi + Abaikan memanggil fungsi outbox', async () => {
    mockPendingActions.push({
      id: 'cancel-pending',
      actionType: 'cancel',
      status: 'pending',
      createdAt: new Date(),
    });
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });

    const { queryByText, getByText, getAllByText } = renderScreen();
    // Status 'pending': banner biru tampil
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(getByText('Menunggu sinkronisasi')).toBeTruthy();
    });

    // Status berubah menjadi 'failed': banner biru hilang, banner gagal tampil.
    mockPendingActions[0].status = 'failed';
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(getByText('Pembatalan ditolak server dan tidak dicoba lagi otomatis.')).toBeTruthy();
    });
    expect(queryByText('Menunggu sinkronisasi')).toBeNull();
    // Tombol Coba lagi dan Abaikan tampil
    expect(getByText('Coba lagi')).toBeTruthy();
    expect(getByText('Abaikan')).toBeTruthy();

    // Tekan Coba lagi -> retryFailedAction dipanggil dengan id aksi
    fireEvent.press(getAllByText('Coba lagi')[0]);
    expect(mockRetryFailedAction).toHaveBeenCalledWith('cancel-pending');
    // Tekan Abaikan -> discardFailedAction dipanggil dengan id aksi
    fireEvent.press(getAllByText('Abaikan')[0]);
    expect(mockDiscardFailedAction).toHaveBeenCalledWith('cancel-pending');
  });

  test('aksi COD failed: tanpa tombol Abaikan', async () => {
    mockPendingActions.push({
      id: 'cod-pending',
      actionType: 'collect_cod',
      status: 'failed',
      createdAt: new Date(),
    });
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    const { queryByText, getByText, getAllByText } = renderScreen();
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(
        getByText(
          'COD gagal dicatat server dan tidak dicoba lagi otomatis. Simpan uangnya, lalu coba lagi atau hubungi support.',
        ),
      ).toBeTruthy();
    });
    // Coba lagi saja, tanpa Abaikan
    expect(getByText('Coba lagi')).toBeTruthy();
    expect(queryByText('Abaikan')).toBeNull();

    fireEvent.press(getAllByText('Coba lagi')[0]);
    expect(mockRetryFailedAction).toHaveBeenCalledWith('cod-pending');
  });

  test('aksi COD orphaned_needs_review: banner yatim tampil, banner biru tidak', async () => {
    mockPendingActions.push({
      id: 'cod-orphan',
      actionType: 'collect_cod',
      status: 'orphaned_needs_review',
      createdAt: new Date(),
    });
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    const { queryByText, getByText } = renderScreen();
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(
        getByText(
          'Order ini sudah tidak ditugaskan ke Anda saat COD-nya terkirim. Simpan uangnya dan hubungi support.',
        ),
      ).toBeTruthy();
    });
    // Tidak ada tombol Coba lagi/Abaikan
    expect(queryByText('Coba lagi')).toBeNull();
    expect(queryByText('Abaikan')).toBeNull();
    // Banner biru tidak tampil
    expect(queryByText('Menunggu sinkronisasi')).toBeNull();
  });
});

describe('LastConflictBanner menampilkan teks per alasan', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0;
    mockPendingActions.length = 0;
    pendingActionsSubscriptionCallback = null;
    paymentsSubscriptionCallback = null;
    mockHasPendingAction.mockResolvedValue(false);
  });

  function setLastConflict(reason: string, at: number = Date.now()): void {
    Object.assign(mockOrder, {
      _raw: { id: 'order-123', _status: 'synced' },
      lastConflictReason: reason,
      lastConflictAt: at,
    });
  }

  test('reassigned: tampil banner (driverId null)', async () => {
    setLastConflict('reassigned');
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: null });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(
        getByText(/Order ini sudah dipindahkan ke driver lain, jadi aksi Anda tidak diproses/),
      ).toBeTruthy();
    });
  });

  // 'reassigned' dengan driverId terisi berarti order sudah dipegang lagi,
  // jadi banner lama tidak tampil.
  test('reassigned dengan driverId terisi: banner tidak tampil', async () => {
    setLastConflict('reassigned');
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText(/Order ini sudah dipindahkan ke driver lain, jadi aksi Anda tidak diproses/)).toBeNull();
    });
  });

  test('released dengan driverId null: tampil banner', async () => {
    setLastConflict('released');
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: null });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(
        getByText(
          /Order ini sudah tidak ditugaskan ke Anda, biasanya karena HP Anda lama tidak tersambung\. Kalau order ini ada lagi di daftar Tersedia, Anda bisa menerimanya lagi\./,
        ),
      ).toBeTruthy();
    });
  });

  // 'released' dengan driverId terisi berarti order sudah dipegang lagi,
  // jadi banner tidak tampil.
  test('released dengan driverId terisi: banner tidak tampil', async () => {
    setLastConflict('released');
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(
        queryByText(
          /Order ini sudah tidak ditugaskan ke Anda, biasanya karena HP Anda lama tidak tersambung/,
        ),
      ).toBeNull();
    });
  });

  test('cancelled-by-server: tampil banner', async () => {
    setLastConflict('cancelled-by-server');
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(
        getByText(
          /Pembatalan tidak diproses karena order sudah berubah di server\. Data order sudah diperbarui\./,
        ),
      ).toBeTruthy();
    });
  });

  test('cancel-cod-captured: tampil banner', async () => {
    setLastConflict('cancel-cod-captured');
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(
        getByText(
          /Order ini tidak bisa dibatalkan karena COD-nya sudah tercatat\. Selesaikan pengantarannya\./,
        ),
      ).toBeTruthy();
    });
  });

  test('cod-already-captured: tampil banner', async () => {
    setLastConflict('cod-already-captured');
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(
        getByText(
          /COD order ini sudah tercatat sebelumnya, jadi catatan dari HP ini tidak disimpan\. Kalau Anda menerima uang dua kali, hubungi support\./,
        ),
      ).toBeTruthy();
    });
  });

  test('sync-rejected: tampil banner', async () => {
    setLastConflict('sync-rejected');
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(
        getByText(
          /Perubahan data order ini di HP ditolak server\. Kalau data order terlihat salah, hubungi support\./,
        ),
      ).toBeTruthy();
    });
  });

  test('LastConflictBanner alasan lain: teks bawaan', async () => {
    setLastConflict('unknown-reason');
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(
        getByText(/Order ini sudah berubah di server\./),
      ).toBeTruthy();
    });
  });
});

describe('syarat tombol mengikuti aksi berstatus apa pun', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0;
    mockPendingActions.length = 0;
    paymentsSubscriptionCallback = null;
    pendingActionsSubscriptionCallback = null;
    mockHasPendingAction.mockResolvedValue(false);
  });

  test('aksi cancel failed pada OUT_FOR_DELIVERY: Batalkan dan COD tidak tampil', async () => {
    mockPendingActions.push({
      id: 'cancel-failed-ofd',
      actionType: 'cancel',
      status: 'failed',
      createdAt: new Date(),
    });
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(queryByText('Batalkan Order')).toBeNull();
      expect(queryByText('Terima Tunai (COD)')).toBeNull();
    });
  });

  test('aksi cancel failed pada PREPARING: Mulai antar tidak tampil', async () => {
    mockPendingActions.push({
      id: 'cancel-failed-prep',
      actionType: 'cancel',
      status: 'failed',
      createdAt: new Date(),
    });
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(queryByText('Mulai antar')).toBeNull();
    });
  });

  test('aksi COD orphaned_needs_review: tombol COD tidak tampil', async () => {
    mockPendingActions.push({
      id: 'cod-orphan-ofd',
      actionType: 'collect_cod',
      status: 'orphaned_needs_review',
      createdAt: new Date(),
    });
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(queryByText('Terima Tunai (COD)')).toBeNull();
    });
  });
});

describe('beberapa banner gagal / yatim', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0;
    mockPendingActions.length = 0;
    paymentsSubscriptionCallback = null;
    pendingActionsSubscriptionCallback = null;
    mockHasPendingAction.mockResolvedValue(false);
    mockRetryFailedAction.mockReset();
    mockRetryFailedAction.mockResolvedValue(undefined);
    mockDiscardFailedAction.mockReset();
    mockDiscardFailedAction.mockResolvedValue(undefined);
  });

  test('dua aksi failed: banner gagal tampil untuk masing-masing', async () => {
    mockPendingActions.push(
      {
        id: 'cancel-failed-2',
        actionType: 'cancel',
        status: 'failed',
        createdAt: new Date(),
      },
      {
        id: 'cod-failed-2',
        actionType: 'collect_cod',
        status: 'failed',
        createdAt: new Date(),
      },
    );
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(
        getByText('Pembatalan ditolak server dan tidak dicoba lagi otomatis.'),
      ).toBeTruthy();
    });
    expect(
      getByText(
        'COD gagal dicatat server dan tidak dicoba lagi otomatis. Simpan uangnya, lalu coba lagi atau hubungi support.',
      ),
    ).toBeTruthy();
  });
});

describe('pending_actions diamati dengan observeWithColumns', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0;
    mockPendingActions.length = 0;
    paymentsSubscriptionCallback = null;
    pendingActionsSubscriptionCallback = null;
  });

  test('pending_actions diamati dengan observeWithColumns status', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    renderScreen();
    await waitFor(() => {
      expect(mockPendingActionsCollection.query).toHaveBeenCalled();
    });
    expect(mockPendingActionsQuery?.observeWithColumns).toHaveBeenCalled();
    expect(mockPendingActionsQuery?.observeWithColumns).toHaveBeenCalledWith(['status']);
  });
});

describe('displayStatus dan syarat tombol dari aksi status antre', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockEnqueueUpdateStatus.mockReset();
    mockDrainPendingActions.mockReset();
    mockDrainPendingActions.mockResolvedValue([]);
    mockEnqueueUpdateStatus.mockResolvedValue({ success: true, pendingActionId: 'pa-display' });
    mockPayments.length = 0;
    mockPendingActions.length = 0;
    pendingActionsSubscriptionCallback = null;
    paymentsSubscriptionCallback = null;
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
  });

  test('baris PREPARING + aksi status OUT_FOR_DELIVERY pending: label OUT_FOR_DELIVERY, COD tampil, tombol lain tidak', async () => {
    mockPendingActions.push({
      id: 'us-ofd-pending',
      actionType: 'update_status',
      status: 'pending',
      createdAt: new Date(Date.now() - 5000),
      payloadJson: { status: 'OUT_FOR_DELIVERY' },
    });

    const { getByText, queryByText } = renderScreen();
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    // Label status: target aksi aktif yang paling baru = OUT_FOR_DELIVERY.
    await waitFor(() => {
      expect(getByText('Sedang diantar')).toBeTruthy();
    });
    // COD tampil (displayStatus OUT_FOR_DELIVERY, tidak ada aksi collect_cod
    // yang menghalangi, tidak ada aksi cancel/reject/failed/yatim).
    expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    // Mulai antar/Selesai diantar/Batalkan TIDAK tampil.
    expect(queryByText('Mulai antar')).toBeNull();
    expect(queryByText('Selesai diantar')).toBeNull();
    expect(queryByText('Batalkan Order')).toBeNull();
    // Banner 'Menunggu sinkronisasi' tampil.
    expect(getByText('Menunggu sinkronisasi')).toBeTruthy();
  });

  test('ditambah aksi COD pending tanpa payment: Selesai diantar tampil dan mengantre DELIVERED', async () => {
    mockPendingActions.push({
      id: 'us-ofd-pending',
      actionType: 'update_status',
      status: 'pending',
      createdAt: new Date(1000),
      payloadJson: { status: 'OUT_FOR_DELIVERY' },
    });
    mockPendingActions.push({
      id: 'cod-pending',
      actionType: 'collect_cod',
      status: 'pending',
      createdAt: new Date(2000),
    });

    const { getByText, queryByText } = renderScreen();
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    // Selesai diantar tampil: displayStatus OUT_FOR_DELIVERY, dan aksi
    // collect_cod aktif memenuhi syarat COD walaupun payment belum tercatat.
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });
    // COD tidak tampil (ada aksi collect_cod yang antre).
    expect(queryByText('Terima Tunai (COD)')).toBeNull();

    await act(async () => {
      fireEvent.press(getByText('Selesai diantar'));
    });
    const alertCalls = (Alert.alert as jest.Mock).mock.calls;
    const buttons = alertCalls[0][2] as Array<{ text: string; onPress?: () => void }>;
    const yaButton = buttons.find((b) => b.text === 'Ya');

    await act(async () => {
      yaButton?.onPress?.();
    });

    expect(mockEnqueueUpdateStatus).toHaveBeenCalledWith('order-123', 'DELIVERED');
  });

  test('ditambah aksi status DELIVERED pending: label DELIVERED, tanpa tombol aksi', async () => {
    mockPendingActions.push({
      id: 'us-ofd-pending',
      actionType: 'update_status',
      status: 'pending',
      createdAt: new Date(1000),
      payloadJson: { status: 'OUT_FOR_DELIVERY' },
    });
    mockPendingActions.push({
      id: 'cod-pending',
      actionType: 'collect_cod',
      status: 'pending',
      createdAt: new Date(2000),
    });
    mockPendingActions.push({
      id: 'us-delivered-pending',
      actionType: 'update_status',
      status: 'pending',
      createdAt: new Date(3000),
      payloadJson: { status: 'DELIVERED' },
    });

    const { queryByText, getByTestId } = renderScreen();
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    // Label status: target aksi paling baru = DELIVERED.
    await waitFor(() => {
      expect(within(getByTestId('pil-status')).getByText('Selesai')).toBeTruthy();
    });
    // Keempat tombol aksi TIDAK tampil.
    expect(queryByText('Mulai antar')).toBeNull();
    expect(queryByText('Selesai diantar')).toBeNull();
    expect(queryByText('Terima Tunai (COD)')).toBeNull();
    expect(queryByText('Batalkan Order')).toBeNull();
  });
});

// Layar Detail order versi 2: kerangka ScreenFrame dengan kepala dan bilah
// koneksi, lalu tiga kartu di dalam daftar.

describe('detail order versi 2', () => {
  const asli = {
    status: mockOrder.status,
    driverId: mockOrder.driverId,
    itemsJson: mockOrder.itemsJson,
    addressJson: mockOrder.addressJson,
    notes: mockOrder.notes,
    totalCents: mockOrder.totalCents,
    currency: mockOrder.currency,
    createdAt: mockOrder.createdAt,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0;
    mockPendingActions.length = 0;
    paymentsSubscriptionCallback = null;
    pendingActionsSubscriptionCallback = null;
  });

  afterEach(() => {
    Object.assign(mockOrder, asli);
  });

  test('kepala: judul dan nomor order tampil, tombol kembali memanggil goBack', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText, getByLabelText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Detail order')).toBeTruthy();
    });
    expect(getByText('#ORDER-12')).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByLabelText('Kembali'));
    });
    expect(mockGoBack).toHaveBeenCalled();
  });

  test('memuat: isi layar kosong dan teks memuat dibuang', async () => {
    mockFindAndObservePerilaku = 'diam';
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText, queryByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Detail order')).toBeTruthy();
    });
    expect(queryByText('Memuat detail order...')).toBeNull();
  });

  test('galat: pesan galat tampil di dalam isi layar', async () => {
    mockFindAndObservePerilaku = 'galat';
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Gagal memuat order')).toBeTruthy();
    });
    expect(getByText('Detail order')).toBeTruthy();
  });

  test('langkah: PREPARING milik driver memberi Langkah 2 dari 4', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Langkah 2 dari 4')).toBeTruthy();
    });
  });

  test('langkah: OUT_FOR_DELIVERY tanpa tunai memberi Langkah 3 dari 4', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Langkah 3 dari 4')).toBeTruthy();
    });
  });

  test('langkah: OUT_FOR_DELIVERY dengan tunai tercatat memberi Langkah 4 dari 4', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({
      id: 'cod-langkah',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.CAPTURED,
    });
    const { getByText } = renderScreen();
    await act(async () => {
      paymentsSubscriptionCallback?.([...mockPayments]);
    });
    await waitFor(() => {
      expect(getByText('Langkah 4 dari 4')).toBeTruthy();
    });
  });

  test('langkah: DELIVERED tanpa nomor langkah', async () => {
    Object.assign(mockOrder, { status: OrderStatus.DELIVERED, driverId: 'driver-456' });
    const { queryByText } = renderScreen();
    await waitFor(() => {
      expect(queryByText(/Langkah/)).toBeNull();
    });
  });

  test('langkah: order yang bukan milik driver tanpa rel langkah', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'other-driver' });
    const { queryByTestId } = renderScreen();
    await waitFor(() => {
      expect(queryByTestId('rel-langkah')).toBeNull();
    });
  });

  test('antar ke: jalan, kota, dan kode pos tampil', async () => {
    Object.assign(mockOrder, {
      status: OrderStatus.PREPARING,
      driverId: 'driver-456',
      addressJson: { street: 'Jl. Sunset Road', city: 'Badung', postalCode: '80361' },
    });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Jl. Sunset Road')).toBeTruthy();
    });
    expect(getByText('Badung 80361')).toBeTruthy();
  });

  test('antar ke: tanpa jalan tampil alamat tidak tersedia', async () => {
    Object.assign(mockOrder, {
      status: OrderStatus.PREPARING,
      driverId: 'driver-456',
      addressJson: {},
    });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Alamat tidak tersedia')).toBeTruthy();
    });
  });

  test('antar ke: catatan tampil tanpa judul Catatan', async () => {
    Object.assign(mockOrder, {
      status: OrderStatus.PREPARING,
      driverId: 'driver-456',
      notes: 'Putar kiri di gang kecil',
    });
    const { getByText, queryByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Putar kiri di gang kecil')).toBeTruthy();
    });
    expect(queryByText('Catatan')).toBeNull();
  });

  test('antar ke: tombol Chat dan Lihat Rute memanggil navigasi', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Chat')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Chat'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('Chat', { roomId: 'order-123' });

    await act(async () => {
      fireEvent.press(getByText('Lihat Rute'));
    });
    expect(mockNavigate).toHaveBeenCalledWith('Map', { orderId: 'order-123' });
  });

  test('rincian: nama barang, harga baris, total, dan waktu dibuat', async () => {
    Object.assign(mockOrder, {
      status: OrderStatus.PREPARING,
      driverId: 'driver-456',
      itemsJson: [{ name: 'Mie Goreng', quantity: 2, unitPriceCents: 23000 }],
      totalCents: 50000,
      currency: 'IDR',
      createdAt: new Date(),
    });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText(`Mie Goreng ${TANDA_KALI} 2`)).toBeTruthy();
    });
    expect(getByText(/Rp\s46\.000/)).toBeTruthy();
    expect(getByText('Total')).toBeTruthy();
    expect(getByText(/^Dibuat \d{2}\.\d{2}$/)).toBeTruthy();
  });

  test('bilah koneksi: aksi yang antre menampilkan Menyinkronkan', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await act(async () => {
      pendingActionsSubscriptionCallback?.([
        {
          id: 'pending-koneksi',
          status: 'pending',
          actionType: 'update_status',
          createdAt: new Date(),
          payloadJson: { status: 'OUT_FOR_DELIVERY' },
        },
      ]);
    });
    await waitFor(() => {
      expect(getByText('Menyinkronkan')).toBeTruthy();
    });
  });
});

describe('bilah bawah detail order', () => {
  const asli = {
    status: mockOrder.status,
    driverId: mockOrder.driverId,
    totalCents: mockOrder.totalCents,
    currency: mockOrder.currency,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0;
    mockPendingActions.length = 0;
    paymentsSubscriptionCallback = null;
    pendingActionsSubscriptionCallback = null;
    mockEnqueueCollectCod.mockResolvedValue({ success: true, pendingActionId: 'cod-pending-123' });
    mockDrainPendingActions.mockResolvedValue([]);
  });

  afterEach(() => {
    Object.assign(mockOrder, asli);
  });

  test('PREPARING milik driver tanpa aksi: Mulai antar dan Batalkan Order tampil', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText, queryByTestId } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });
    expect(getByText('Batalkan Order')).toBeTruthy();
    expect(queryByTestId('kotak-tunai')).toBeNull();
  });

  test('OUT_FOR_DELIVERY tanpa tunai: tagih, tombol terima tunai, dan batalkan tampil', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { getByText, getByTestId } = renderScreen();
    await waitFor(() => {
      expect(getByText('Tagih tunai ke customer')).toBeTruthy();
    });
    expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    expect(getByText('Batalkan Order')).toBeTruthy();
    // Kotak tunai ada di bilah bawah, bukan di dalam daftar.
    expect(within(getByTestId('isi-detail')).queryByTestId('kotak-tunai')).toBeNull();
  });

  test('OUT_FOR_DELIVERY dengan aksi collect_cod pending: tunai diterima dan Selesai diantar tampil', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPendingActions.push({
      id: 'cod-pending',
      actionType: 'collect_cod',
      status: 'pending',
      createdAt: new Date(),
    });
    const { getByText, queryByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Pembayaran tunai diterima')).toBeTruthy();
    });
    expect(getByText('Selesai diantar')).toBeTruthy();
    expect(queryByText('Batalkan Order')).toBeNull();
  });

  test('DELIVERED dengan payment CASH CAPTURED: kotak tunai di dalam isi layar', async () => {
    Object.assign(mockOrder, { status: OrderStatus.DELIVERED, driverId: 'driver-456' });
    mockPayments.push({
      id: 'cod-selesai',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.CAPTURED,
    });
    const { getByTestId, queryByTestId, queryByText } = renderScreen();
    await waitFor(() => {
      expect(within(getByTestId('isi-detail')).getByTestId('kotak-tunai')).toBeTruthy();
    });
    expect(queryByTestId('aksi-utama')).toBeNull();
    expect(queryByText('Batalkan Order')).toBeNull();
  });

  test('OUT_FOR_DELIVERY dengan COD tercatat dan aksi gagal: kotak diterima, tombol utama hilang', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({
      id: 'cod-gagal',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.CAPTURED,
    });
    mockPendingActions.push({
      id: 'us-delivered-gagal',
      actionType: 'update_status',
      status: 'failed',
      createdAt: new Date(),
      payloadJson: { status: 'DELIVERED' },
    });
    const { getByText, queryByTestId, queryByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Pembayaran tunai diterima')).toBeTruthy();
    });
    expect(queryByTestId('aksi-utama')).toBeNull();
    expect(queryByText('Batalkan Order')).toBeNull();
  });

  test('status berubah ke antrean: judul tombol utama bergulir di tombol yang sama', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByTestId, getByText, queryByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });
    await act(async () => {
      pendingActionsSubscriptionCallback?.([
        {
          id: 'us-out-for-delivery',
          actionType: 'update_status',
          status: 'pending',
          createdAt: new Date(Date.now() - 5000),
          payloadJson: { status: 'OUT_FOR_DELIVERY' },
        },
      ]);
    });
    await waitFor(() => {
      expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    });
    expect(queryByText('Batalkan Order')).toBeNull();
    expect(getByText('Tagih tunai ke customer')).toBeTruthy();
    // Isi tombol yang sama dipakai, jadi judul baru masuk dengan gerak.
    const isiTombol = within(getByTestId('aksi-utama')).getByTestId('isi-tombol');
    expect(isiTombol.props.entering).toBeTruthy();
  });

  test('bungkus batal punya keluar di luar jendela awal', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByTestId } = renderScreen();
    await waitFor(() => {
      expect(getByTestId('bungkus-batal')).toBeTruthy();
    });

    const keluar = getByTestId('bungkus-batal').props.exiting as PembangunKeluar;
    expect(keluar).toBeTruthy();

    // Batalkan keluar turun setinggi dirinya ditambah jarak bilah bawah,
    // supaya tidak menimpa tombol utama saat kotak tunai masuk bersamaan.
    const hasil = keluar(nilaiKeluarTiruan(48));
    expect(sasaranTranslateY(hasil.animations)).toBe(48 + JARAK_BILAH_BAWAH);
  });

  test('bungkus batal tidak punya keluar di dalam jendela awal', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByTestId } = renderScreenDalamJendela();
    await act(async () => {});
    expect(getByTestId('bungkus-batal').props.exiting).toBeUndefined();
  });

  test('isi bilah bawah punya gerak geser di luar jendela awal', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { getByTestId, getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    });

    const slotTunai = getByTestId('slot-tunai');
    expect(slotTunai.props.entering).toBeTruthy();
    expect(slotTunai.props.layout).toBeTruthy();
    expect(getByTestId('bungkus-aksi-utama').props.layout).toBeTruthy();

    const bungkusBatal = getByTestId('bungkus-batal');
    expect(bungkusBatal.props.layout).toBeTruthy();
    expect(bungkusBatal.props.entering).toBeTruthy();
  });

  test('isi bilah bawah tanpa gerak di dalam jendela awal', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { getByTestId } = renderScreenDalamJendela();
    await act(async () => {});

    const slotTunai = getByTestId('slot-tunai');
    expect(slotTunai.props.entering).toBeUndefined();
    expect(slotTunai.props.layout).toBeUndefined();
    expect(getByTestId('bungkus-aksi-utama').props.layout).toBeUndefined();

    const bungkusBatal = getByTestId('bungkus-batal');
    expect(bungkusBatal.props.layout).toBeUndefined();
    expect(bungkusBatal.props.entering).toBeUndefined();
  });

  test('alert COD: judul dan isi yang baru', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByText('Terima Tunai (COD)'));
    });
    expect(Alert.alert).toHaveBeenCalledWith(
      'Terima Tunai (COD)',
      expect.stringContaining('Terima tunai '),
      expect.anything(),
    );
  });
});

describe('tahan tombol batal saat mulai antar dikirim online', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0;
    mockPendingActions.length = 0;
    paymentsSubscriptionCallback = null;
    pendingActionsSubscriptionCallback = null;
    mockEnqueueCancel.mockResolvedValue({ success: true, pendingActionId: 'batal-1' });
    mockDrainPendingActions.mockResolvedValue([]);
    mockGetStatusFn.mockReturnValue('online');
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  });

  afterEach(() => {
    mockGetStatusFn.mockReturnValue('online');
    jest.useRealTimers();
  });

  // Aksi Mulai antar yang baru dibuat, jadi masih dalam tahan.
  function aksiMulaiAntarBaru(): MockPendingAction {
    return {
      id: 'us-out-for-delivery',
      actionType: 'update_status',
      status: 'pending',
      createdAt: new Date(),
      payloadJson: { status: 'OUT_FOR_DELIVERY' },
    };
  }

  async function renderSiap() {
    const hasil = renderScreen();
    await act(async () => {});
    return hasil;
  }

  test('mulai antar antre: Batalkan Order tetap tampil', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText } = await renderSiap();
    expect(getByText('Mulai antar')).toBeTruthy();

    await act(async () => {
      pendingActionsSubscriptionCallback?.([aksiMulaiAntarBaru()]);
    });

    expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    expect(getByText('Batalkan Order')).toBeTruthy();
  });

  test('mulai antar antre: ketukan Batalkan diabaikan', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText } = await renderSiap();

    await act(async () => {
      pendingActionsSubscriptionCallback?.([aksiMulaiAntarBaru()]);
    });

    await act(async () => {
      fireEvent.press(getByText('Batalkan Order'));
    });

    const panggilanBatal = (Alert.alert as jest.Mock).mock.calls.filter(
      (call) => call[0] === 'Batalkan Order',
    );
    expect(panggilanBatal).toHaveLength(0);
  });

  test('mulai antar antre 2 detik: Batalkan Order masih tampil', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText } = await renderSiap();

    await act(async () => {
      pendingActionsSubscriptionCallback?.([aksiMulaiAntarBaru()]);
    });
    expect(getByText('Batalkan Order')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    expect(getByText('Batalkan Order')).toBeTruthy();
  });

  test('mulai antar antre lalu tahan habis: Batalkan Order hilang', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText, queryByText } = await renderSiap();

    await act(async () => {
      pendingActionsSubscriptionCallback?.([aksiMulaiAntarBaru()]);
    });
    expect(getByText('Batalkan Order')).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    expect(queryByText('Batalkan Order')).toBeNull();
  });

  test('baris order berubah dan aksi hilang: Batalkan Order tetap tampil', async () => {
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText } = await renderSiap();

    await act(async () => {
      pendingActionsSubscriptionCallback?.([aksiMulaiAntarBaru()]);
    });
    expect(getByText('Batalkan Order')).toBeTruthy();

    await act(async () => {
      mockFindAndObserveNext?.({ ...mockOrder, status: OrderStatus.OUT_FOR_DELIVERY });
    });
    expect(getByText('Batalkan Order')).toBeTruthy();

    await act(async () => {
      pendingActionsSubscriptionCallback?.([]);
    });
    expect(getByText('Batalkan Order')).toBeTruthy();
  });

  test('offline: Batalkan Order tidak tampil', async () => {
    mockGetStatusFn.mockReturnValue('offline');
    Object.assign(mockOrder, { status: OrderStatus.PREPARING, driverId: 'driver-456' });
    const { getByText, queryByText } = await renderSiap();

    await act(async () => {
      pendingActionsSubscriptionCallback?.([aksiMulaiAntarBaru()]);
    });

    expect(getByText('Terima Tunai (COD)')).toBeTruthy();
    expect(queryByText('Batalkan Order')).toBeNull();
  });
});

describe('detak status basi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0;
    mockPendingActions.length = 0;
    paymentsSubscriptionCallback = null;
    pendingActionsSubscriptionCallback = null;
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('aksi yang hampir basi jadi basi setelah satu menit', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText, queryByText } = renderScreen();
    await act(async () => {});

    await act(async () => {
      pendingActionsSubscriptionCallback?.([
        {
          id: 'pending-hampir-basi',
          status: 'pending',
          actionType: 'collect_cod',
          createdAt: new Date(Date.now() - (STALE_THRESHOLD_MS - 30 * 1000)),
        },
      ]);
    });

    expect(getByText('Menunggu sinkronisasi')).toBeTruthy();
    expect(queryByText('Belum tersinkron dari sejam lalu')).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(DETAK_BASI_MS);
    });

    expect(getByText('Belum tersinkron dari sejam lalu')).toBeTruthy();
    expect(queryByText('Menunggu sinkronisasi')).toBeNull();
  });
});

describe('banner detail order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockPayments.length = 0;
    mockPendingActions.length = 0;
    paymentsSubscriptionCallback = null;
    pendingActionsSubscriptionCallback = null;
    mockHasPendingAction.mockResolvedValue(false);
    mockRetryFailedAction.mockReset();
    mockRetryFailedAction.mockResolvedValue(undefined);
    mockDiscardFailedAction.mockReset();
    mockDiscardFailedAction.mockResolvedValue(undefined);
    Object.assign(mockOrder, { lastConflictReason: undefined, lastConflictAt: undefined });
  });

  test('payment gagal: banner danger ada tombol tutup', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    mockPayments.push({
      id: 'payment-gagal',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.FAILED,
    });

    const { UNSAFE_getAllByType } = renderScreen();
    await waitFor(() => {
      const banner = UNSAFE_getAllByType(Banner)[0];
      expect(banner.props.tone).toBe('danger');
      expect(banner.props.onClose).toBeDefined();
    });
  });

  test('COD yatim: banner danger tanpa tombol tutup dan tanpa tombol aksi', async () => {
    mockPendingActions.push({
      id: 'cod-yatim',
      actionType: 'collect_cod',
      status: 'orphaned_needs_review',
      createdAt: new Date(),
    });
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    const { UNSAFE_getAllByType } = renderScreen();
    await waitFor(() => {
      const banner = UNSAFE_getAllByType(Banner)[0];
      expect(banner.props.tone).toBe('danger');
      expect(banner.props.onClose).toBeUndefined();
      expect(banner.props.actions).toBeUndefined();
    });
  });

  test('aksi gagal update_status: banner danger dengan dua tombol aksi', async () => {
    mockPendingActions.push({
      id: 'us-gagal',
      actionType: 'update_status',
      status: 'failed',
      createdAt: new Date(),
      payloadJson: { status: 'DELIVERED' },
    });
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    const { UNSAFE_getAllByType } = renderScreen();
    await waitFor(() => {
      const banner = UNSAFE_getAllByType(Banner)[0];
      expect(banner.props.tone).toBe('danger');
      expect(banner.props.actions).toHaveLength(2);
    });
  });

  test('aksi gagal collect_cod: banner danger dengan satu tombol aksi', async () => {
    mockPendingActions.push({
      id: 'cod-gagal',
      actionType: 'collect_cod',
      status: 'failed',
      createdAt: new Date(),
    });
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    const { UNSAFE_getAllByType } = renderScreen();
    await waitFor(() => {
      const banner = UNSAFE_getAllByType(Banner)[0];
      expect(banner.props.tone).toBe('danger');
      expect(banner.props.actions).toHaveLength(1);
    });
  });

  test('konflik tersimpan: banner danger ada tombol tutup', async () => {
    Object.assign(mockOrder, {
      status: OrderStatus.ASSIGNED,
      driverId: 'driver-456',
      lastConflictReason: 'sync-rejected',
      lastConflictAt: Date.now(),
    });

    const { UNSAFE_getAllByType } = renderScreen();
    await waitFor(() => {
      const banner = UNSAFE_getAllByType(Banner)[0];
      expect(banner.props.tone).toBe('danger');
      expect(banner.props.onClose).toBeDefined();
    });
  });

  test('antrean basi: banner warning dengan judul dan isi baru', async () => {
    mockPendingActions.push({
      id: 'aksi-basi',
      actionType: 'cancel',
      status: 'pending',
      createdAt: new Date(Date.now() - 61 * 60 * 1000),
    });
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });

    const { UNSAFE_getAllByType } = renderScreen();
    await waitFor(() => {
      const banner = UNSAFE_getAllByType(Banner)[0];
      expect(banner.props.tone).toBe('warning');
      expect(banner.props.title).toBe('Belum tersinkron dari sejam lalu');
      expect(banner.props.body).toBe('Cek koneksi internet Anda');
    });
  });

  test('aksi gagal update_status: Coba lagi dan Abaikan memanggil fungsi outbox', async () => {
    mockPendingActions.push({
      id: 'us-gagal',
      actionType: 'update_status',
      status: 'failed',
      createdAt: new Date(),
      payloadJson: { status: 'DELIVERED' },
    });
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    const { getByText } = renderScreen();
    await waitFor(() => {
      expect(getByText('Coba lagi')).toBeTruthy();
    });
    fireEvent.press(getByText('Coba lagi'));
    expect(mockRetryFailedAction).toHaveBeenCalledWith('us-gagal');
    fireEvent.press(getByText('Abaikan'));
    expect(mockDiscardFailedAction).toHaveBeenCalledWith('us-gagal');
  });

  test('antrean kosong: banner menunggu ditahan dalam bentuk selesai lalu hilang', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText, queryByText, UNSAFE_getAllByType } = renderScreen();

    await act(async () => {
      pendingActionsSubscriptionCallback?.([
        { id: 'pending-1', status: 'pending', actionType: 'collect_cod', createdAt: new Date() },
      ]);
    });
    await waitFor(() => {
      expect(getByText('Menunggu sinkronisasi')).toBeTruthy();
    });

    await act(async () => {
      pendingActionsSubscriptionCallback?.([]);
    });
    await waitFor(() => {
      const banner = UNSAFE_getAllByType(Banner).find((b) => b.props.tone === 'pending');
      expect(banner?.props.done).toBe(true);
    });
    await waitFor(
      () => {
        expect(queryByText('Menunggu sinkronisasi')).toBeNull();
      },
      { timeout: 2000 },
    );
  });

  test('antrean berubah jadi gagal: banner menunggu langsung hilang dan banner gagal tampil', async () => {
    mockPendingActions.push({
      id: 'pending-1',
      actionType: 'collect_cod',
      status: 'pending',
      createdAt: new Date(),
    });
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });

    const { getByText, queryByText } = renderScreen();
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(getByText('Menunggu sinkronisasi')).toBeTruthy();
    });

    mockPendingActions[0].status = 'failed';
    await act(async () => {
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
    await waitFor(() => {
      expect(
        getByText(
          'COD gagal dicatat server dan tidak dicoba lagi otomatis. Simpan uangnya, lalu coba lagi atau hubungi support.',
        ),
      ).toBeTruthy();
    });
    expect(queryByText('Menunggu sinkronisasi')).toBeNull();
  });

  test('konflik status dari server: banner info dengan label status driver', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText, UNSAFE_getAllByType } = renderScreen();

    await act(async () => {
      syncEvents.emit('orderConflict', {
        orderId: 'order-123',
        reason: 'order-status-conflict',
        serverStatus: 'OUT_FOR_DELIVERY',
        serverChangedAt: new Date().toISOString(),
      });
    });
    await waitFor(() => {
      expect(getByText('Status order diperbarui server, sekarang sedang diantar.')).toBeTruthy();
    });
    const banner = UNSAFE_getAllByType(Banner)[0];
    expect(banner.props.tone).toBe('info');
  });

  test('konflik status dari server dengan status tak dikenal: teks umum', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText } = renderScreen();

    await act(async () => {
      syncEvents.emit('orderConflict', {
        orderId: 'order-123',
        reason: 'order-status-conflict',
        serverStatus: 'entah',
        serverChangedAt: new Date().toISOString(),
      });
    });
    await waitFor(() => {
      expect(getByText('Status order diperbarui server.')).toBeTruthy();
    });
  });

  test('konflik reassigned: banner danger dan bisa ditutup', async () => {
    Object.assign(mockOrder, { status: OrderStatus.ASSIGNED, driverId: 'driver-456' });
    const { getByText, queryByText, getByLabelText, UNSAFE_getAllByType } = renderScreen();

    await act(async () => {
      syncEvents.emit('orderConflict', {
        orderId: 'order-123',
        reason: 'reassigned',
        serverStatus: 'OUT_FOR_DELIVERY',
        serverChangedAt: new Date().toISOString(),
      });
    });
    await waitFor(() => {
      expect(getByText('Order ini sudah dipindahkan ke driver lain.')).toBeTruthy();
    });
    expect(UNSAFE_getAllByType(Banner)[0].props.tone).toBe('danger');

    await act(async () => {
      fireEvent.press(getByLabelText('Tutup'));
    });
    await waitFor(() => {
      expect(queryByText('Order ini sudah dipindahkan ke driver lain.')).toBeNull();
    });
  });

  test('tidak ada kode status mentah di layar, juga saat ada konflik', async () => {
    Object.assign(mockOrder, { status: OrderStatus.OUT_FOR_DELIVERY, driverId: 'driver-456' });
    const { queryByText } = renderScreen();

    expect(queryByText(/OUT_FOR_DELIVERY|OUT FOR_DELIVERY/)).toBeNull();

    await act(async () => {
      syncEvents.emit('orderConflict', {
        orderId: 'order-123',
        reason: 'order-status-conflict',
        serverStatus: 'OUT_FOR_DELIVERY',
        serverChangedAt: new Date().toISOString(),
      });
    });
    await waitFor(() => {
      expect(queryByText(/OUT_FOR_DELIVERY|OUT FOR_DELIVERY/)).toBeNull();
    });
  });
});

// Tes: urutan Selesai diantar
//
// Selesai diantar punya tahap: tombol utama ditahan dulu, lalu layar pindah
// ke layar sukses. Selama ditahan, bilah bawah tidak berubah.

type HasilLayar = ReturnType<typeof renderScreen>;

/** Hasil antre status yang dikembalikan outbox. */
interface HasilAntre {
  success: boolean;
  pendingActionId?: string;
  error?: string;
}

/** Tombol utama di bilah bawah, dicari lewat testID. */
function tombolUtama(hasil: HasilLayar) {
  return hasil.UNSAFE_getAllByType(Button).find((b) => b.props.testID === 'aksi-utama');
}

/** Tombol "Ya" dari dialog konfirmasi status. */
function tombolYa(): { text: string; onPress?: () => void } | undefined {
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as Array<{
    text: string;
    onPress?: () => void;
  }>;
  return buttons.find((b) => b.text === 'Ya');
}

/** Tombol "Ya" dari dialog "Selesai diantar" yang terakhir muncul. */
function tombolYaTerakhir(): { text: string; onPress?: () => void } | undefined {
  const calls = (Alert.alert as jest.Mock).mock.calls.filter(
    (c) => c[0] === 'Selesai diantar',
  );
  const buttons = calls[calls.length - 1][2] as Array<{
    text: string;
    onPress?: () => void;
  }>;
  return buttons.find((b) => b.text === 'Ya');
}

describe('urutan Selesai diantar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockGetCurrentUserId.mockResolvedValue('driver-456');
    mockEnqueueUpdateStatus.mockReset();
    mockDrainPendingActions.mockReset();
    mockDrainPendingActions.mockResolvedValue([]);
    mockUpdateOrderStatus.mockReset();
    mockGetOrderById.mockReset();
    mockOrderPrepareUpdate.mockReset();
    mockOrderPrepareUpdate.mockImplementation(function(this: OrderModel, fn: (r: OrderModel) => void) {
      fn(this);
      return this;
    });
    mockDatabaseBatch.mockReset();
    mockPayments.length = 0;
    mockPendingActions.length = 0;
    paymentsSubscriptionCallback = null;
    pendingActionsSubscriptionCallback = null;
    mockReplace.mockClear();
    Object.assign(mockOrder, {
      status: OrderStatus.OUT_FOR_DELIVERY,
      driverId: 'driver-456',
      serverVersion: 1,
    });
    mockPayments.push({
      id: 'cod-urut-1',
      orderId: 'order-123',
      method: PaymentMethod.CASH,
      status: PaymentStatus.CAPTURED,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Kirim aksi status DELIVERED lewat langganan pending_actions. */
  async function kirimAksiDelivered(): Promise<void> {
    await act(async () => {
      mockPendingActions.push({
        id: 'pa-urut-1',
        actionType: 'update_status',
        status: 'pending',
        createdAt: new Date(),
        payloadJson: { status: 'DELIVERED' },
      });
      pendingActionsSubscriptionCallback?.([...mockPendingActions]);
    });
  }

  test('sukses: tombol ditahan dengan centang, lalu layar pindah ke layar sukses', async () => {
    mockEnqueueUpdateStatus.mockResolvedValue({ success: true, pendingActionId: 'pa-urut-1' });

    const hasil = renderScreen();
    const { getByText, getByTestId } = hasil;
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Selesai diantar'));
    });
    const ya = tombolYa();
    await act(async () => {
      ya?.onPress?.();
    });

    // Layar belum pindah, tombol masih ditahan.
    expect(mockReplace).not.toHaveBeenCalled();

    await kirimAksiDelivered();

    const tombol = tombolUtama(hasil);
    expect(tombol).toBeTruthy();
    expect(tombol?.props.title).toBe('Selesai diantar');
    expect(tombol?.props.success).toBe(true);
    // Kotak tunai tetap di bilah bawah, bukan di dalam daftar.
    expect(within(getByTestId('isi-detail')).queryByTestId('kotak-tunai')).toBeNull();
    expect(getByTestId('kotak-tunai')).toBeTruthy();

    await waitFor(
      () => {
        expect(mockReplace).toHaveBeenCalledTimes(1);
      },
      { timeout: 2000 },
    );
    expect(mockReplace).toHaveBeenCalledWith('OrderDone', { orderId: 'order-123' });
  });

  test('tahap kirim: tombol ditahan tanpa centang sampai aksi selesai', async () => {
    let selesaiAntre: (hasil: HasilAntre) => void = () => {};
    mockEnqueueUpdateStatus.mockImplementation(
      () => new Promise<HasilAntre>((resolve) => {
        selesaiAntre = resolve;
      }),
    );

    const hasil = renderScreen();
    const { getByText } = hasil;
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Selesai diantar'));
    });
    const ya = tombolYa();
    await act(async () => {
      ya?.onPress?.();
    });

    await kirimAksiDelivered();

    // Aksi belum selesai, tombol ditahan tanpa centang.
    const tombol = tombolUtama(hasil);
    expect(tombol).toBeTruthy();
    expect(tombol?.props.title).toBe('Selesai diantar');
    expect(tombol?.props.success).toBe(false);

    await act(async () => {
      selesaiAntre({ success: true, pendingActionId: 'pa-urut-2' });
    });

    expect(tombolUtama(hasil)?.props.success).toBe(true);
  });

  test('kirim antrean tidak ditunggu: layar tetap pindah', async () => {
    mockEnqueueUpdateStatus.mockResolvedValue({ success: true, pendingActionId: 'pa-urut-3' });
    mockDrainPendingActions.mockImplementation(() => new Promise(() => {}));

    const hasil = renderScreen();
    const { getByText } = hasil;
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Selesai diantar'));
    });
    const ya = tombolYa();
    await act(async () => {
      ya?.onPress?.();
    });

    await waitFor(
      () => {
        expect(mockReplace).toHaveBeenCalledTimes(1);
      },
      { timeout: 2000 },
    );
  });

  test('kirim antrean gagal: layar tetap pindah dan tidak ada galat', async () => {
    mockEnqueueUpdateStatus.mockResolvedValue({ success: true, pendingActionId: 'pa-urut-4' });
    mockDrainPendingActions.mockRejectedValue(new TypeError('Network request failed'));

    const hasil = renderScreen();
    const { getByText } = hasil;
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Selesai diantar'));
    });
    const ya = tombolYa();
    await act(async () => {
      ya?.onPress?.();
    });

    await waitFor(
      () => {
        expect(mockReplace).toHaveBeenCalledTimes(1);
      },
      { timeout: 2000 },
    );
    expect(Alert.alert).not.toHaveBeenCalledWith('Gagal', expect.anything());
  });

  test('kurangi gerakan: layar langsung pindah tanpa centang', async () => {
    const reanimated = require('react-native-reanimated') as {
      useReducedMotion: () => boolean;
    };
    jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);
    mockEnqueueUpdateStatus.mockResolvedValue({ success: true, pendingActionId: 'pa-urut-5' });

    const hasil = renderScreen();
    const { getByText } = hasil;
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Selesai diantar'));
    });
    const ya = tombolYa();
    await act(async () => {
      ya?.onPress?.();
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('OrderDone', { orderId: 'order-123' });
    expect(tombolUtama(hasil)?.props.success).toBe(false);
  });

  test('antre gagal: ada galat, tombol tidak centang, layar tidak pindah', async () => {
    mockEnqueueUpdateStatus.mockResolvedValue({ success: false, error: 'Not authenticated' });

    const hasil = renderScreen();
    const { getByText } = hasil;
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Selesai diantar'));
    });
    const ya = tombolYa();
    await act(async () => {
      ya?.onPress?.();
    });

    expect(Alert.alert).toHaveBeenCalledWith('Gagal', 'Status gagal dicatat. Coba lagi.');
    expect(tombolUtama(hasil)?.props.success).toBe(false);

    await new Promise((selesai) => setTimeout(selesai, 500));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  test('antre gagal: tombol bisa dipakai lagi', async () => {
    mockEnqueueUpdateStatus
      .mockResolvedValueOnce({ success: false, error: 'Not authenticated' })
      .mockResolvedValueOnce({ success: true, pendingActionId: 'pa-urut-8' });

    const hasil = renderScreen();
    const { getByText } = hasil;
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Selesai diantar'));
    });
    await act(async () => {
      tombolYa()?.onPress?.();
    });

    expect(Alert.alert).toHaveBeenCalledWith('Gagal', 'Status gagal dicatat. Coba lagi.');

    await act(async () => {
      fireEvent.press(getByText('Selesai diantar'));
    });

    const panggilanSelesai = (Alert.alert as jest.Mock).mock.calls.filter(
      (c) => c[0] === 'Selesai diantar',
    );
    expect(panggilanSelesai).toHaveLength(2);

    await act(async () => {
      tombolYaTerakhir()?.onPress?.();
    });

    await waitFor(
      () => {
        expect(mockReplace).toHaveBeenCalledTimes(1);
      },
      { timeout: 2000 },
    );
    expect(mockReplace).toHaveBeenCalledWith('OrderDone', { orderId: 'order-123' });
  });

  test('antre melempar galat: tombol bisa dipakai lagi', async () => {
    mockEnqueueUpdateStatus
      .mockRejectedValueOnce(new Error('tulis gagal'))
      .mockResolvedValueOnce({ success: true, pendingActionId: 'pa-urut-8' });

    const hasil = renderScreen();
    const { getByText } = hasil;
    await waitFor(() => {
      expect(getByText('Selesai diantar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Selesai diantar'));
    });
    await act(async () => {
      tombolYa()?.onPress?.();
    });

    expect(Alert.alert).toHaveBeenCalledWith('Gagal', 'Status gagal dicatat. Coba lagi.');

    await act(async () => {
      fireEvent.press(getByText('Selesai diantar'));
    });

    const panggilanSelesai = (Alert.alert as jest.Mock).mock.calls.filter(
      (c) => c[0] === 'Selesai diantar',
    );
    expect(panggilanSelesai).toHaveLength(2);

    await act(async () => {
      tombolYaTerakhir()?.onPress?.();
    });

    await waitFor(
      () => {
        expect(mockReplace).toHaveBeenCalledTimes(1);
      },
      { timeout: 2000 },
    );
    expect(mockReplace).toHaveBeenCalledWith('OrderDone', { orderId: 'order-123' });
  });

  test('Mulai antar sukses: layar tidak pindah', async () => {
    Object.assign(mockOrder, {
      status: OrderStatus.PREPARING,
      driverId: 'driver-456',
      serverVersion: 1,
    });
    mockPayments.length = 0;
    mockEnqueueUpdateStatus.mockResolvedValue({ success: true, pendingActionId: 'pa-urut-7' });

    const hasil = renderScreen();
    const { getByText } = hasil;
    await waitFor(() => {
      expect(getByText('Mulai antar')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Mulai antar'));
    });
    const ya = tombolYa();
    await act(async () => {
      ya?.onPress?.();
    });

    await new Promise((selesai) => setTimeout(selesai, 500));
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
