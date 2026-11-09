/**
 * Tes untuk ChatScreen. join_room dikirim ulang setiap connect, dan
 * tidak ada join_room kalau layar ditutup sebelum chatSocket.connect() resolve.
 *
 * Pola render sama dengan OrderDetailScreen.spec.tsx: withDatabase diganti
 * fungsi yang mengembalikan komponen apa adanya, database lewat prop,
 * useRoute memakai mock, tanpa `any`.
 */

import React from 'react';
import { render, waitFor, act, fireEvent } from '@testing-library/react-native';
import { Database, appSchema, tableSchema } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { ChatMessageModel } from '../db/models/ChatMessageModel';

// --- Mock withDatabase: kembalikan komponen apa adanya ---
// Ditulis langsung di dalam factory karena variabel tingkat modul tidak
// selalu terbaca dengan benar dari jest.mock factory di jest@29 + babel.
// Tipe komponennya ComponentType<object>.
jest.mock('@nozbe/watermelondb/react', () => ({
  withDatabase: (Component: React.ComponentType<object>) => Component,
}));

// --- WatermelonDB asli dipakai semua, termasuk Q dan Model ---
// Model asli dipakai supaya model chat bisa diwarisi, dan tes status pesan
// butuh observe yang benar-benar memancarkan ulang saat kolom status
// berubah.
jest.mock('@nozbe/watermelondb', () => {
  const asli = jest.requireActual('@nozbe/watermelondb');
  return { __esModule: true, ...asli };
});

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

// --- Mock API client, dipakai jalur kirim lewat REST ---
const mockSendChatMessage = jest.fn();
jest.mock('../sync/client', () => ({
  sendChatMessage: (...args: unknown[]) => mockSendChatMessage(...args),
}));

// --- Mock koleksi pesan chat, diam saja, supaya observe tidak error ---
const mockCollectionQuery = jest.fn().mockReturnValue({
  observe: jest.fn().mockReturnValue({
    subscribe: jest.fn().mockImplementation((observer: { next: (records: unknown[]) => void }) => {
      observer.next([]);
      return { unsubscribe: jest.fn() };
    }),
  }),
  observeWithColumns: jest.fn().mockReturnValue({
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
  sendMessageCalls: Array<{ id: string; roomId: string; body: string }>;
  sendMessageSuccess: boolean;
  onCalls: Array<{ event: string }>;
  unsubscribes: jest.Mock<unknown[], []>[];
  connectImpl: () => Promise<void>;
  fireConnect: () => void;
  fireDisconnect: (disconnectReason?: string) => void;
  fireNewMessage: (message: unknown) => void;
}

const mockSocketState: MockChatSocketState = {
  isConnected: false,
  joinRoomCalls: [],
  leaveRoomCalls: [],
  sendMessageCalls: [],
  sendMessageSuccess: true,
  onCalls: [],
  unsubscribes: [],
  connectImpl: () => Promise.resolve(),
  fireConnect: () => {
    /* diisi di bawah */
  },
  fireDisconnect: () => {
    /* diisi di bawah */
  },
  fireNewMessage: () => {
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
  mockSocketState.sendMessageCalls = [];
  mockSocketState.sendMessageSuccess = true;
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
    emitToServer: (
      event: string,
      payload: { roomId: string; id?: string; body?: string },
      ack?: (response: unknown) => void,
    ): void => {
      if (event === 'join_room') {
        mockSocketState.joinRoomCalls.push({ roomId: payload.roomId });
        if (ack) ack({ success: true });
      } else if (event === 'leave_room') {
        mockSocketState.leaveRoomCalls.push({ roomId: payload.roomId });
      } else if (event === 'send_message') {
        const id = payload.id ?? '';
        mockSocketState.sendMessageCalls.push({
          id,
          roomId: payload.roomId,
          body: payload.body ?? '',
        });
        if (ack) {
          ack({
            success: mockSocketState.sendMessageSuccess,
            message: {
              id,
              roomId: payload.roomId,
              body: payload.body,
              senderId: 'user-driver-1',
              version: 3,
              clientCreatedAt: new Date().toISOString(),
              serverCreatedAt: new Date().toISOString(),
            },
          });
        }
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
mockSocketState.fireNewMessage = (message: unknown): void => {
  mockNewMessageListeners.forEach((cb) => cb(message));
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

// --- Database WatermelonDB sungguhan untuk tes status pesan ---
// Tes label dan penanda kirim butuh observe yang benar-benar memancarkan
// ulang saat kolom status berubah, jadi dipakai database in-memory LokiJS
// dengan model chat yang asli.
const schemaChat = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'chat_messages',
      columns: [
        { name: 'room_id', type: 'string', isIndexed: true },
        { name: 'sender_id', type: 'string' },
        { name: 'body', type: 'string' },
        { name: 'attachment_json', type: 'string', isOptional: true },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'client_created_at', type: 'number' },
        { name: 'server_created_at', type: 'number', isOptional: true },
        { name: 'server_version', type: 'number' },
        { name: 'deleted_at', type: 'number', isOptional: true },
        { name: 'failed_sync_attempts', type: 'number' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
  ],
});

function buatDatabase(): Database {
  const adapter = new LokiJSAdapter({
    schema: schemaChat,
    useWebWorker: false,
    useIncrementalIndexedDB: true,
    dbName: 'tes-chat',
  });
  return new Database({ adapter, modelClasses: [ChatMessageModel] });
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

describe('ChatScreen: banner koneksi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMockSocketState();
  });

  test('socket sudah tersambung saat layar dibuka: banner terputus tidak tampil', async () => {
    // Socket chat bisa sudah tersambung sebelum layar ini dibuka, jadi event
    // connect tidak datang lagi untuk layar ini.
    mockSocketState.isConnected = true;

    const { queryByText } = renderChatScreen();

    await waitFor(() => {
      expect(mockSocketState.joinRoomCalls.length).toBe(1);
    });

    expect(queryByText(/Koneksi real-time terputus/)).toBeNull();
  });

  test('socket sudah tersambung lalu putus: banner tampil', async () => {
    mockSocketState.isConnected = true;

    const { findByText } = renderChatScreen();

    await waitFor(() => {
      expect(mockSocketState.joinRoomCalls.length).toBe(1);
    });

    await act(async () => {
      mockSocketState.isConnected = false;
      mockSocketState.fireDisconnect('transport close');
    });

    expect(await findByText(/Koneksi real-time terputus/)).toBeTruthy();
  });
});

// Label status pesan berubah tanpa layar ditutup
describe('ChatScreen: label status pesan', () => {
  let db: Database;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockSocketState();
    mockSocketState.isConnected = false;
    db = buatDatabase();
  });

  test('status PENDING_SEND lalu SENT: label terkirim tampil tanpa unmount', async () => {
    const { findByText } = render(<ChatScreen database={db} />);

    // Pesan dibuat dengan status PENDING_SEND.
    await act(async () => {
      await db.write(async () => {
        await db.get<ChatMessageModel>('chat_messages').create((m) => {
          m.roomId = 'room-abc';
          m.senderId = 'user-driver-1';
          m.body = 'halo';
          m.status = 'PENDING_SEND';
          m.clientCreatedAt = Date.now();
          m.serverVersion = 0;
        });
      });
    });

    expect(await findByText(/mengirim/)).toBeTruthy();

    // Status diubah ke SENT lewat database.write, layar tidak ditutup.
    const baris = await db.get<ChatMessageModel>('chat_messages').query().fetch();
    await act(async () => {
      await db.write(async () => {
        await baris[0].update((m) => {
          m.status = 'SENT';
        });
      });
    });

    expect(await findByText(/terkirim/)).toBeTruthy();
  });
});

// Baris pesan tidak boleh dikirim ulang sinkron setelah terkirim
describe('ChatScreen: penanda kirim di baris pesan', () => {
  let db: Database;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMockSocketState();
    mockSocketState.isConnected = false;
    db = buatDatabase();
  });

  async function kirimPesan(): Promise<void> {
    const { getByPlaceholderText, getByText } = render(<ChatScreen database={db} />);
    await waitFor(() => {
      expect(mockSocketState.joinRoomCalls.length).toBe(1);
    });
    await act(async () => {
      fireEvent.changeText(getByPlaceholderText('Ketik pesan...'), 'halo');
    });
    await act(async () => {
      fireEvent.press(getByText('Kirim'));
    });
  }

  async function barisPesan(): Promise<ChatMessageModel[]> {
    return db.get<ChatMessageModel>('chat_messages').query().fetch();
  }

  test('ack socket sukses: baris synced dan changed kosong', async () => {
    mockSocketState.isConnected = true;

    await kirimPesan();

    await waitFor(async () => {
      const baris = await barisPesan();
      expect(baris).toHaveLength(1);
      expect(baris[0]._raw._status).toBe('synced');
      expect(baris[0]._raw._changed).toBe('');
    });
  });

  test('kirim lewat REST sukses: baris synced dan changed kosong', async () => {
    mockSocketState.isConnected = false;
    mockSendChatMessage.mockResolvedValue({ id: 'pesan-rest', version: 5 });

    await kirimPesan();

    await waitFor(async () => {
      const baris = await barisPesan();
      expect(baris).toHaveLength(1);
      expect(baris[0]._raw._status).toBe('synced');
      expect(baris[0]._raw._changed).toBe('');
    });
  });

  test('pesan sendiri dari new_message: baris synced dan changed kosong', async () => {
    mockSocketState.isConnected = false;
    // REST gagal, jadi baris masih PENDING_SEND saat echo new_message datang.
    mockSendChatMessage.mockRejectedValue(new Error('jaringan mati'));

    await kirimPesan();

    await waitFor(() => {
      expect(mockSendChatMessage).toHaveBeenCalledTimes(1);
    });
    const payload = mockSendChatMessage.mock.calls[0][0] as { id: string };
    const idPesan = payload.id;

    await act(async () => {
      mockSocketState.fireNewMessage({
        id: idPesan,
        roomId: 'room-abc',
        senderId: 'user-driver-1',
        body: 'halo',
        version: 3,
        clientCreatedAt: new Date().toISOString(),
        serverCreatedAt: new Date().toISOString(),
      });
    });

    await waitFor(async () => {
      const baris = await barisPesan();
      expect(baris).toHaveLength(1);
      expect(baris[0]._raw._status).toBe('synced');
      expect(baris[0]._raw._changed).toBe('');
    });
  });
});
