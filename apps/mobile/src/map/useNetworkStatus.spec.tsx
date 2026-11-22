/**
 * Tes hook status jaringan.
 *
 * Monitor jaringan dipalsukan supaya statusnya bisa diubah dari luar.
 * Tiruan punya status sendiri: begitu pendengar dipanggil, status tiruan
 * ikut berubah, jadi getStatus selalu membaca status terbaru.
 */

import { act, renderHook } from '@testing-library/react-native';

import type { NetworkStatus } from './networkMonitor';
import { useNetworkStatus } from './useNetworkStatus';

jest.mock('./networkMonitor', () => ({
  networkMonitor: {
    getStatus: jest.fn(),
    subscribe: jest.fn(),
  },
}));

type Pendengar = (status: NetworkStatus) => void;

interface MonitorTiruan {
  getStatus: jest.Mock<NetworkStatus, []>;
  subscribe: jest.Mock<() => void, [Pendengar]>;
}

function monitorTiruan(): MonitorTiruan {
  const modul = jest.requireMock('./networkMonitor') as { networkMonitor: MonitorTiruan };
  return modul.networkMonitor;
}

describe('status jaringan jadi hook sendiri', () => {
  let pendengar: Set<Pendengar>;
  /** Status tiruan saat ini. */
  let status: NetworkStatus;
  /** Status yang dipasang tiruan tepat saat subscribe dipanggil. */
  let statusSaatSubscribe: NetworkStatus | undefined;

  beforeEach(() => {
    pendengar = new Set<Pendengar>();
    status = 'unknown';
    statusSaatSubscribe = undefined;
    monitorTiruan().getStatus.mockReset();
    monitorTiruan().getStatus.mockImplementation(() => status);
    monitorTiruan().subscribe.mockReset();
    monitorTiruan().subscribe.mockImplementation((listener) => {
      // Pendengar yang tersimpan mengubah status tiruan dulu, baru panggil
      // pendengar asli, supaya getStatus selalu baca status terbaru.
      const bungkus: Pendengar = (baru) => {
        status = baru;
        listener(baru);
      };
      pendengar.add(bungkus);
      if (statusSaatSubscribe !== undefined) {
        status = statusSaatSubscribe;
      }
      return () => {
        pendengar.delete(bungkus);
      };
    });
  });

  it('nilai awal diambil dari monitor', () => {
    status = 'offline';

    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current).toBe('offline');
  });

  it('nilai ikut berubah saat monitor memberi tahu status baru', () => {
    const { result } = renderHook(() => useNetworkStatus());

    act(() => {
      pendengar.forEach((panggil) => panggil('offline'));
    });

    expect(result.current).toBe('offline');
  });

  it('status yang berubah tepat saat subscribe dipanggil tetap terbaca', () => {
    // Di iOS monitor bisa berubah dari 'unknown' ke 'online' di antara
    // render dan efek, tanpa sempat memberi tahu pendengar.
    statusSaatSubscribe = 'online';

    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current).toBe('online');
  });

  it('berhenti langganan saat hook dilepas', () => {
    const { unmount } = renderHook(() => useNetworkStatus());

    unmount();

    expect(pendengar.size).toBe(0);
  });
});
