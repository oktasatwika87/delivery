/**
 * Tes untuk ChatScreen. join_room dikirim ulang setiap connect, dan
 * tidak ada join_room kalau layar ditutup sebelum chatSocket.connect() resolve.
 *
 * Pola render sama dengan OrderDetailScreen.spec.tsx: withDatabase diganti
 * fungsi yang mengembalikan komponen apa adanya, database lewat prop,
 * useRoute memakai mock, tanpa `any`.
 */

import React from 'react';
import { render, waitFor, act } from '@testing-library/react-native';

// --- Mock withDatabase: kembalikan komponen apa adanya ---
// Ditulis langsung di dalam factory karena variabel tingkat modul tidak
// selalu terbaca dengan benar dari jest.mock factory di jest@29 + babel.
// Tipe komponennya ComponentType<object>.
jest.mock('@nozbe/watermelondb/react', () => ({
  withDatabase: (Component: React.ComponentType<object>) => Component,
}));

// --- Mock Q dari @nozbe/watermelondb ---
jest.mock('@nozbe/watermelondb', () => ({
  Q: {
    where: jest.fn().mockReturnValue({ _where: 'test' }),
    sortBy: jest.fn().mockReturnValue({ _sortBy: 'test' }),
  },
}));

// --- Mock react-native-config ---
jest.mock('react-native-config', () => ({
  default: { API_BASE_URL: 'http://localhost:3000' },
}));

// --- Mock navigasi ---
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn() }),
  useRoute: () => ({ params: { roomId: 'room-abc' } }),
}));

// --- Mock session ---
const mockGetCurrentUserId = jest.fn().mockResolvedValue('user-driver-1');
jest.mock('../sync/session', () => ({
  getCurrentUserId: () => mockGetCurrentUserId(),
}));

// --- Mock koleksi pesan chat, diam saja, supaya observe tidak error ---
const mockCollectionQuery = jest.fn().mockReturnValue({
  observe: jest.fn().mockReturnValue({
    subscribe: jest.fn().mockImplementation((observer: { next: (records: unknown[]) => void }) => {
      observer.next([]);
      return { unsubscribe: jest.fn() };
    }),
  }),
});

// --- Mock chatSocket ---
// chatSocket itu singleton, jadi dikendalikan penuh supaya tes bisa (a)
// menunggu join_room setelah connect, dan (b) unmount sebelum connect
// resolve. Semua emit join_room dicatat di mockSocketState.joinRoomCalls,
// dan connect bisa ditahan lewat connectImpl untuk tes unmount.
//
// Daftar listener bertipe Array<(...args: unknown[]) => void> supaya tidak
// perlu type cast. Cast dengan nama parameter di tipe fungsi membuat jest
// salah mengira `reason` sebagai variabel luar.
interface MockChatSocketState {
  isConnected: boolean;
  joinRoomCalls: Array<{ roomId: string }>;
  leaveRoomCalls: Array<{ roomId: string }>;
  onCalls: Array<{ event: string }>;
  unsubscribes: jest.Mock<unknown[], []>[];
  connectImpl: () => Promise<void>;
  fireConnect: () => void;
  fireDisconnect: (disconnectReason?: string) => void;
}

const mockSocketState: MockChatSocketState = {
  isConnected: false,
  joinRoomCalls: [],
  leaveRoomCalls: [],
  onCalls: [],
  unsubscribes: [],
  connectImpl: () => Promise.resolve(),
  fireConnect: () => {
    /* diisi di bawah */
  },
  fireDisconnect: () => {
    /* diisi di bawah */
  },
};

const mockUnsubFn = jest.fn();
// Pakai Array<(...args: unknown[]) => void> supaya tidak perlu type cast
// di mock factory. Cast dengan nama parameter di tipe fungsi membuat jest
// salah mengira nama parameter itu sebagai variabel luar.
const mockConnectListeners: Array<(...args: unknown[]) => void> = [];
const mockDisconnectListeners: Array<(...args: unknown[]) => void> = [];
const mockNewMessageListeners: Array<(...args: unknown[]) => void> = [];
const mockConnectErrorListeners: Array<(...args: unknown[]) => void> = [];

// Kosongkan state sebelum require ulang modul (untuk tes yang butuh
// state bersih).
function resetMockSocketState(): void {
  mockSocketState.isConnected = false;
  mockSocketState.joinRoomCalls = [];
  mockSocketState.leaveRoomCalls = [];
  mockSocketState.onCalls = [];
  mockSocketState.unsubscribes = [];
  mockSocketState.connectImpl = () => Promise.resolve();
  mockConnectListeners.length = 0;
  mockDisconnectListeners.length = 0;
  mockNewMessageListeners.length = 0;
  mockConnectErrorListeners.length = 0;
  mockUnsubFn.mockClear();
}

jest.mock('../sync/socket', () => ({
  chatSocket: {
    get isConnected(): boolean {
      return mockSocketState.isConnected;
    },
    connect: () => mockSocketState.connectImpl(),
    on: (event: string, cb: (...args: unknown[]) => void): (() => void) => {
      mockSocketState.onCalls.push({ event });
      if (event === 'connect') {
        mockConnectListeners.push(cb);
      } else if (event === 'disconnect') {
        mockDisconnectListeners.push(cb);
      } else if (event === 'new_message') {
        mockNewMessageListeners.push(cb);
      } else if (event === 'connect_error') {
        mockConnectErrorListeners.push(cb);
      }
      const unsub = jest.fn();
      mockSocketState.unsubscribes.push(unsub);
      return unsub;
    },
    emitToServer: (event: string, payload: { roomId: string }, ack?: (response: unknown) => void): void => {
      if (event === 'join_room') {
        mockSocketState.joinRoomCalls.push({ roomId: payload.roomId });
        if (ack) ack({ success: true });
      } else if (event === 'leave_room') {
        mockSocketState.leaveRoomCalls.push({ roomId: payload.roomId });
      }
    },
  },
}));

// Isi fungsi fire* setelah mock dibuat, supaya bisa memanggil semua
// listener yang terdaftar.
mockSocketState.fireConnect = (): void => {
  mockConnectListeners.forEach((cb) => cb());
};
mockSocketState.fireDisconnect = (disconnectReason = 'transport close'): void => {
  mockDisconnectListeners.forEach((cb) => cb(disconnectReason));
};

// --- Mock database: observe() kosong untuk koleksi pesan ---
const mockDatabase = {
  get: jest.fn((name: string) => {
    if (name === 'chat_messages') {
      return { query: mockCollectionQuery };
    }
    return { query: jest.fn().mockReturnValue({ fetch: jest.fn().mockResolvedValue([]) }) };
  }),
  write: jest.fn().mockImplementation(async (fn: () => Promise<void>) => fn()),
  batch: jest.fn(),
};

// --- Import setelah semua mock ---
import { ChatScreen } from './ChatScreen';

// Fungsi bantu untuk render dengan database tiruan.
function renderChatScreen() {
  return render(<ChatScreen database={mockDatabase as never} />);
}

describe('ChatScreen: join_room saat connect berulang', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMockSocketState();
    // Bawaan: connect langsung resolve
    mockSocketState.connectImpl = () => Promise.resolve();
    mockSocketState.isConnected = false;
  });

  test('connect kedua setelah join pertama mengirim join_room lagi', async () => {
    renderChatScreen();

    // Tunggu sampai setupSocket selesai: connect() resolve dan join_room
    // pertama terkirim.
    await waitFor(() => {
      expect(mockSocketState.joinRoomCalls.length).toBe(1);
      expect(mockSocketState.joinRoomCalls[0]).toEqual({ roomId: 'room-abc' });
    });

    // Simulasi socket disconnect lalu connect lagi.
    // Pada kode lama, callback 'connect' hanya mengubah state isSocketConnected,
    // join_room TIDAK dikirim ulang. Pada kode baru, callback 'connect' yang
    // datang setelah join pertama akan mengirim ulang join_room.
    await act(async () => {
      mockSocketState.fireDisconnect('transport close');
    });
    await act(async () => {
      mockSocketState.fireConnect();
    });

    // join_room HARUS terkirim lagi (1 dari awal + 1 dari reconnect = 2).
    await waitFor(() => {
      expect(mockSocketState.joinRoomCalls.length).toBe(2);
    });
    expect(mockSocketState.joinRoomCalls[1]).toEqual({ roomId: 'room-abc' });
  });

  test('unmount sebelum connect() resolve berarti tidak ada join_room sama sekali', async () => {
    // Persiapan: connect() tidak langsung resolve, pakai deferred yang
    // dikendalikan tes supaya unmount bisa terjadi sebelum connect selesai.
    let resolveConnect: (() => void) | null = null;
    mockSocketState.connectImpl = () =>
      new Promise<void>((resolve) => {
        resolveConnect = resolve;
      });

    const { unmount } = renderChatScreen();

    // Beri waktu supaya effect jalan dan tertahan di await chatSocket.connect().
    // connect masih belum resolve.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // unmount SEBELUM connect resolve.
    unmount();

    // Sekarang connect resolve dan setupSocket yang tertahan jalan lagi.
    // Pada kode lama, dia akan lanjut emit join_room dan subscribe new_message
    // walaupun layar sudah ditutup. Pada kode baru, ada penjaga unmount yang
    // membuat langkah-langkah ini dilewati.
    await act(async () => {
      if (resolveConnect) resolveConnect();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // join_room tidak boleh terkirim sama sekali.
    expect(mockSocketState.joinRoomCalls.length).toBe(0);
  });
});
