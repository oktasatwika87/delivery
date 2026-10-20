/**
 * Tes untuk sessionControl.ts.
 *
 * beginSyncSession harus memulai sinkron dan menyambungkan kedua socket;
 * endSyncSession harus menghentikan semuanya. Kegagalan satu tidak
 * menggagalkan yang lain.
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

jest.mock('./coordinator', () => ({
  syncCoordinator: {
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn(),
  },
}));

jest.mock('./ordersSocket', () => ({
  ordersSocket: {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  },
}));

jest.mock('./socket', () => ({
  chatSocket: {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  },
}));

import { beginSyncSession, endSyncSession } from './sessionControl';
import { syncCoordinator } from './coordinator';
import { ordersSocket } from './ordersSocket';
import { chatSocket } from './socket';

function buildTestDatabase(): Database {
  const adapter = new LokiJSAdapter({
    schema,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
    onSetUpError: (e: Error) => { throw e; },
  });
  return new Database({
    adapter,
    modelClasses: [OrderModel, PaymentModel, ChatMessageModel, PendingActionModel, UserModel, RouteSnapshotModel],
  });
}

describe('sessionControl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('beginSyncSession: syncCoordinator.start dengan db, ordersSocket.connect, chatSocket.connect', () => {
    const db = buildTestDatabase();
    beginSyncSession(db);

    expect(syncCoordinator.start).toHaveBeenCalledTimes(1);
    expect(syncCoordinator.start).toHaveBeenCalledWith(db);
    expect(ordersSocket.connect).toHaveBeenCalledTimes(1);
    expect(chatSocket.connect).toHaveBeenCalledTimes(1);
  });

  it('endSyncSession: syncCoordinator.stop, ordersSocket.disconnect, chatSocket.disconnect', () => {
    endSyncSession();

    expect(syncCoordinator.stop).toHaveBeenCalledTimes(1);
    expect(ordersSocket.disconnect).toHaveBeenCalledTimes(1);
    expect(chatSocket.disconnect).toHaveBeenCalledTimes(1);
  });

  it('connect yang gagal tidak membuat beginSyncSession melempar dan tidak menyisakan janji yang tidak ditangani', async () => {
    const db = buildTestDatabase();
    const err = new Error('socket refused');
    jest.mocked(ordersSocket.connect).mockRejectedValueOnce(err);

    // beginSyncSession tidak boleh melempar, karena App.tsx tidak
    // menunggunya. Microtask ditunggu supaya .catch() sempat jalan.
    expect(() => beginSyncSession(db)).not.toThrow();
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));

    // Sinkronisasi dan chat socket tetap dipanggil.
    expect(syncCoordinator.start).toHaveBeenCalledTimes(1);
    expect(chatSocket.connect).toHaveBeenCalledTimes(1);
  });
});