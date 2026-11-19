import { useEffect, useState } from 'react';

import { networkMonitor } from './networkMonitor';
import type { NetworkStatus } from './networkMonitor';

/**
 * Status jaringan untuk layar.
 *
 * Nilai awal diambil dari monitor, lalu ikut berubah setiap kali monitor
 * memberi tahu status baru.
 */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>(() => networkMonitor.getStatus());
  useEffect(() => networkMonitor.subscribe(setStatus), []);
  return status;
}
