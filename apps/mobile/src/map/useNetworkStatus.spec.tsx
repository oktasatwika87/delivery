/**
 * Tes hook status jaringan.
 *
 * Monitor jaringan dipalsukan supaya statusnya bisa diubah dari luar.
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

  beforeEach(() => {
    pendengar = new Set<Pendengar>();
    monitorTiruan().getStatus.mockReset();
    monitorTiruan().getStatus.mockReturnValue('unknown');
    monitorTiruan().subscribe.mockReset();
    monitorTiruan().subscribe.mockImplementation((listener) => {
      pendengar.add(listener);
      return () => {
        pendengar.delete(listener);
      };
    });
  });

  it('nilai awal diambil dari monitor', () => {
    monitorTiruan().getStatus.mockReturnValue('offline');

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

  it('berhenti langganan saat hook dilepas', () => {
    const { unmount } = renderHook(() => useNetworkStatus());

    unmount();

    expect(pendengar.size).toBe(0);
  });
});
