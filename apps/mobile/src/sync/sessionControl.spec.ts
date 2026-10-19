/**
 * Tes untuk sessionControl.ts.
 *
 * beginSyncSession harus memulai sinkron dan menyambungkan kedua socket;
 * endSyncSession harus menghentikan semuanya. Kegagalan satu tidak
 * menggagalkan yang lain.
 */

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

describe('sessionControl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('beginSyncSession: syncCoordinator.start dengan db, ordersSocket.connect, chatSocket.connect', async () => {
    const fakeDb: unknown = { marker: 'db' };
    await beginSyncSession(fakeDb as never);

    expect(syncCoordinator.start).toHaveBeenCalledTimes(1);
    expect(syncCoordinator.start).toHaveBeenCalledWith(fakeDb);
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
    const fakeDb: unknown = { marker: 'db' };
    const err = new Error('socket refused');
    (ordersSocket.connect as jest.Mock).mockRejectedValueOnce(err);

    // Tidak boleh melempar: caller App.tsx fire-and-forget. Fungsi
    // beginSyncSession sinkron; kita tunggu microtask queue agar catch
    // di .catch() sempat jalan.
    expect(() => beginSyncSession(fakeDb as never)).not.toThrow();
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));

    // Sinkronisasi dan chat socket tetap dipanggil.
    expect(syncCoordinator.start).toHaveBeenCalledTimes(1);
    expect(chatSocket.connect).toHaveBeenCalledTimes(1);
  });
});