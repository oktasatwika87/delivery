/**
 * Tes untuk localData.ts.
 *
 * - countUnsentData menghitung aksi pending_actions berstatus
 *   'pending'/'syncing'/'failed' dan chat_messages _status
 *   'created'/'updated' dengan failed_sync_attempts kurang dari 5.
 * - Aksi 'orphaned_needs_review', chat 'created' dengan percobaan 5,
 *   chat 'synced', dan order/payment kotor tidak dihitung.
 * - clearLocalData mengosongkan keenam tabel.
 * - startLocalSession: sama -> lewat; beda tanpa data -> clear, set
 *   pemilik, simpan token; beda dengan satu aksi pending -> ditolak.
 * - clearLocalDataForLogout: keenam tabel kosong, cursor null,
 *   pemilik kosong.
 */

import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';

import { schema } from '../db/schema';
import { OrderModel } from '../db/models/OrderModel';
import { PaymentModel } from '../db/models/PaymentModel';
import { ChatMessageModel } from '../db/models/ChatMessageModel';
import { PendingActionModel } from '../db/models/PendingActionModel';
import { UserModel } from '../db/models/UserModel';
import { RouteSnapshotModel } from '../db/models/RouteSnapshotModel';

import {
  countUnsentData,
  clearLocalData,
  startLocalSession,
  clearLocalDataForLogout,
  getLocalDataOwner,
  setLocalDataOwner,
  unsentDataBlockMessage,
} from './localData';

// AsyncStorage tiruan menyimpan string di memori.
const tokenStorageMock = {
  storage: new Map<string, string>(),
  async setItem(key: string, value: string): Promise<void> {
    tokenStorageMock.storage.set(key, value);
  },
  async getItem(key: string): Promise<string | null> {
    return tokenStorageMock.storage.get(key) ?? null;
  },
  async removeItem(key: string): Promise<void> {
    tokenStorageMock.storage.delete(key);
  },
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (key: string) => tokenStorageMock.getItem(key),
    setItem: (key: string, value: string) => tokenStorageMock.setItem(key, value),
    removeItem: (key: string) => tokenStorageMock.removeItem(key),
  },
}));

// Keychain tiruan: simpan token di memori. saveToken selalu pakai username
// 'session' (KEY di token-storage.ts); password berisi JSON {token, userId}.
const keychainStorage = new Map<string, string>();
jest.mock('react-native-keychain', () => ({
  __esModule: true,
  setGenericPassword: jest.fn(
    async (username: string, password: string) => {
      keychainStorage.set(username, password);
      return true;
    },
  ),
  getGenericPassword: jest.fn(async () => {
    if (keychainStorage.size === 0) return false;
    const [username, password] = Array.from(keychainStorage.entries())[0] as [string, string];
    return { username, password };
  }),
  resetGenericPassword: jest.fn(async () => {
    keychainStorage.clear();
    return true;
  }),
  ACCESSIBLE: { WHEN_UNLOCKED: 'WHEN_UNLOCKED' },
}));

// Bantu baca password tersimpan untuk verifikasi sesi tersimpan.
function readStoredSession(): { token: string; userId: string } | null {
  const password = keychainStorage.get('session');
  if (!password) return null;
  return JSON.parse(password) as { token: string; userId: string };
}

// Cursor tiruan: simpan di memori.
const cursorStorage = new Map<string, string>();
jest.mock('./cursor', () => ({
  saveCursor: jest.fn(async (next: string | null) => {
    if (next === null) {
      cursorStorage.clear();
    } else {
      cursorStorage.set('sync_cursor', next);
    }
  }),
  loadCursor: jest.fn(async () => cursorStorage.get('sync_cursor') ?? null),
}));

function buildTestDatabase(): Database {
  const adapter = new LokiJSAdapter({
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
    onSetUpError: (e: Error) => { throw e; },
  });
  return new Database({
    adapter,
    modelClasses: [
      OrderModel,
      PaymentModel,
      ChatMessageModel,
      PendingActionModel,
      UserModel,
      RouteSnapshotModel,
    ],
  });
}

async function seedOrderRow(db: Database, id: string): Promise<void> {
  const collection = db.get('orders');
  await db.write(async () => {
    const p = collection.prepareCreateFromDirtyRaw({
      id,
      _status: 'updated',
      _changed: '',
      customer_id: 'cust-1',
      driver_id: 'driver-1',
      status: 'ASSIGNED',
      items_json: '[]',
      address_json: '{}',
      total_cents: 50000,
      currency: 'IDR',
      notes: null,
      server_version: 1,
      deleted_at: null,
      failed_sync_attempts: 0,
      cancelled_by: null,
      cancel_reason: null,
      last_conflict_reason: null,
      last_conflict_at: null,
      created_at: 1700000000000,
      updated_at: 1700000000000,
    });
    await db.batch(p);
  });
}

async function seedPendingAction(
  db: Database,
  id: string,
  status: 'pending' | 'syncing' | 'failed' | 'orphaned_needs_review',
): Promise<void> {
  const collection = db.get('pending_actions');
  await db.write(async () => {
    const p = collection.prepareCreateFromDirtyRaw({
      id,
      _status: 'synced',
      _changed: '',
      action_type: 'collect_cod',
      target_order_id: 'some-order',
      expected_version: 1,
      idempotency_key: `cod:${id}`,
      status,
      created_at: 1700000000000,
      updated_at: 1700000000000,
    });
    await db.batch(p);
  });
}

async function seedChatMessage(
  db: Database,
  id: string,
  rawStatus: 'created' | 'updated' | 'synced',
  failedSyncAttempts: number,
): Promise<void> {
  const collection = db.get('chat_messages');
  await db.write(async () => {
    const p = collection.prepareCreateFromDirtyRaw({
      id,
      _status: rawStatus,
      _changed: '',
      room_id: 'room-1',
      sender_id: 'sender-1',
      body: 'body',
      attachment_json: null,
      status: 'SENT',
      client_created_at: 1700000000000,
      server_created_at: null,
      server_version: 1,
      deleted_at: null,
      failed_sync_attempts: failedSyncAttempts,
      created_at: 1700000000000,
      updated_at: 1700000000000,
    });
    await db.batch(p);
  });
}

describe('localData', () => {
  let db: Database;

  beforeEach(() => {
    tokenStorageMock.storage.clear();
    keychainStorage.clear();
    cursorStorage.clear();
    db = buildTestDatabase();
  });

  describe('countUnsentData', () => {
    it('aksi pending/syncing/failed dihitung; orphaned_needs_review tidak', async () => {
      await seedPendingAction(db, 'pa-pending', 'pending');
      await seedPendingAction(db, 'pa-syncing', 'syncing');
      await seedPendingAction(db, 'pa-failed', 'failed');
      await seedPendingAction(db, 'pa-orphaned', 'orphaned_needs_review');

      expect(await countUnsentData(db)).toBe(3);
    });

    it('chat _status created dengan percobaan 0 dihitung; percobaan 5 dan synced tidak', async () => {
      await seedChatMessage(db, 'chat-created', 'created', 0);
      await seedChatMessage(db, 'chat-updated', 'updated', 4);
      await seedChatMessage(db, 'chat-cap', 'created', 5);
      await seedChatMessage(db, 'chat-synced', 'synced', 0);

      expect(await countUnsentData(db)).toBe(2);
    });

    it('order _status updated tidak dihitung (push order/payment dari app selalu ditolak)', async () => {
      await seedOrderRow(db, 'order-dirty');
      expect(await countUnsentData(db)).toBe(0);
    });
  });

  describe('clearLocalData', () => {
    it('mengosongkan keenam tabel', async () => {
      // Seed masing-masing satu baris di keenam tabel.
      await db.write(async () => {
        const orders = db.get('orders').prepareCreateFromDirtyRaw({
          id: 'o1',
          _status: 'synced', _changed: '',
          customer_id: 'c', driver_id: 'd', status: 'ASSIGNED',
          items_json: '[]', address_json: '{}', total_cents: 1, currency: 'IDR',
          notes: null, server_version: 1, deleted_at: null, failed_sync_attempts: 0,
          cancelled_by: null, cancel_reason: null, last_conflict_reason: null,
          last_conflict_at: null, created_at: 1, updated_at: 1,
        });
        const payments = db.get('payments').prepareCreateFromDirtyRaw({
          id: 'p1', _status: 'synced', _changed: '',
          order_id: 'o1', idempotency_key: 'k', method: 'CASH', status: 'CAPTURED',
          amount_cents: 1, currency: 'IDR', kind: 'PAYMENT', external_ref: null,
          server_version: 1, deleted_at: null, failed_sync_attempts: 0,
          created_at: 1, updated_at: 1,
        });
        const chats = db.get('chat_messages').prepareCreateFromDirtyRaw({
          id: 'm1', _status: 'synced', _changed: '',
          room_id: 'r', sender_id: 's', body: 'b', attachment_json: null,
          status: 'SENT', client_created_at: 1, server_created_at: null,
          server_version: 1, deleted_at: null, failed_sync_attempts: 0,
          created_at: 1, updated_at: 1,
        });
        const users = db.get('users').prepareCreateFromDirtyRaw({
          id: 'u1', _status: 'synced', _changed: '',
          name: 'A', phone: '0', role: 'CUSTOMER', server_version: 1,
          created_at: 1, updated_at: 1,
        });
        const routes = db.get('route_snapshots').prepareCreateFromDirtyRaw({
          id: 'r1', _status: 'synced', _changed: '',
          origin_lat: '0', origin_lng: '0', dest_lat: '0', dest_lng: '0',
          geometry_json: '{}', fetched_at: 1, created_at: 1, updated_at: 1,
        });
        const actions = db.get('pending_actions').prepareCreateFromDirtyRaw({
          id: 'a1', _status: 'synced', _changed: '',
          action_type: 'collect_cod', target_order_id: 'o1',
          expected_version: 1, idempotency_key: 'k', status: 'pending',
          created_at: 1, updated_at: 1,
        });
        await db.batch(orders, payments, chats, users, routes, actions);
      });

      await clearLocalData(db);

      expect(await db.get('orders').query().fetchCount()).toBe(0);
      expect(await db.get('payments').query().fetchCount()).toBe(0);
      expect(await db.get('chat_messages').query().fetchCount()).toBe(0);
      expect(await db.get('users').query().fetchCount()).toBe(0);
      expect(await db.get('route_snapshots').query().fetchCount()).toBe(0);
      expect(await db.get('pending_actions').query().fetchCount()).toBe(0);
    });
  });

  describe('startLocalSession', () => {
    it('pemilik sama dengan userId: saveToken, hasil sessionSet', async () => {
      await setLocalDataOwner('user-A');
      // Cursor sudah disimpan sebelumnya, harus tetap.
      cursorStorage.set('sync_cursor', 'cursor-prev');

      const result = await startLocalSession('token-A', 'user-A', db);

      expect(result).toEqual({ ok: true });
      const stored = readStoredSession();
      expect(stored).toEqual({ token: 'token-A', userId: 'user-A' });
      // Cursor tidak disentuh.
      expect(cursorStorage.get('sync_cursor')).toBe('cursor-prev');
    });

    it('pemilik beda tanpa data belum terkirim: clear, set pemilik, simpan token', async () => {
      await setLocalDataOwner('user-old');
      cursorStorage.set('sync_cursor', 'cursor-stale');

      const result = await startLocalSession('token-new', 'user-new', db);

      expect(result).toEqual({ ok: true });
      expect(await getLocalDataOwner()).toBe('user-new');
      expect(readStoredSession()).toEqual({ token: 'token-new', userId: 'user-new' });
      // Cursor dikosongkan.
      expect(cursorStorage.has('sync_cursor')).toBe(false);
    });

    it('pemilik beda dengan satu aksi pending: ditolak, tidak ada token, baris dan aksi tetap', async () => {
      await setLocalDataOwner('user-old');
      await seedPendingAction(db, 'pa-pending', 'pending');

      const result = await startLocalSession('token-new', 'user-new', db);

      expect(result).toEqual({ ok: false, unsentCount: 1 });
      // Aksi tetap ada.
      expect(await db.get('pending_actions').query().fetchCount()).toBe(1);
      // Pemilik tetap (gagal login, data masih milik akun lama).
      expect(await getLocalDataOwner()).toBe('user-old');
      // Token TIDAK disimpan.
      expect(readStoredSession()).toBeNull();
    });

    it('pemilik kosong dengan satu aksi pending: ditolak', async () => {
      await seedPendingAction(db, 'pa-pending', 'pending');

      const result = await startLocalSession('token-new', 'user-new', db);

      expect(result).toEqual({ ok: false, unsentCount: 1 });
      expect(readStoredSession()).toBeNull();
    });
  });

  describe('clearLocalDataForLogout', () => {
    it('mengosongkan keenam tabel, cursor null, pemilik kosong', async () => {
      await setLocalDataOwner('user-A');
      cursorStorage.set('sync_cursor', 'cursor-A');
      // Seed sesuatu.
      await seedOrderRow(db, 'order-A');

      await clearLocalDataForLogout(db);

      expect(await db.get('orders').query().fetchCount()).toBe(0);
      expect(cursorStorage.has('sync_cursor')).toBe(false);
      expect(await getLocalDataOwner()).toBeNull();
    });
  });

  describe('unsentDataBlockMessage', () => {
    it('menyertakan jumlah dan instruksinya', () => {
      const msg = unsentDataBlockMessage(3);
      expect(msg).toContain('3');
      expect(msg.toLowerCase()).toContain('akun');
    });
  });
});