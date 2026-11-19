/**
 * Data bilah koneksi untuk layar yang tidak berlangganan semua aksi sendiri.
 *
 * Layar yang punya daftar order biasanya sudah tahu jumlah antreannya.
 * Layar lain, misalnya detail order, cuma butuh angka untuk bilah koneksi.
 */

import { useEffect, useRef, useState } from 'react';
import type { Database } from '@nozbe/watermelondb';

import { allActionsQuery } from '../db/driverQueries';
import { useNetworkStatus } from '../map/useNetworkStatus';
import type { NetworkStatus } from '../map/networkMonitor';
import { hitungAntrean } from './hitungAntrean';
import type { HitunganAntrean } from './hitungAntrean';

export interface ConnectionBarData {
  status: NetworkStatus;
  pendingCount: number;
  failedCount: number;
}

const KOSONG: HitunganAntrean = { pendingCount: 0, failedCount: 0 };

export function useConnectionBar(database: Database): ConnectionBarData {
  const status = useNetworkStatus();
  const [hitungan, setHitungan] = useState<HitunganAntrean>(KOSONG);
  // Hitungan terakhir yang sudah dipasang. Angkanya dibandingkan dengan
  // ref ini, jadi emisi dengan angka yang sama tidak menggambar ulang layar.
  const hitunganRef = useRef<HitunganAntrean>(KOSONG);

  useEffect(() => {
    const subscription = allActionsQuery(database).subscribe((actions) => {
      const baru = hitungAntrean(actions);
      const lama = hitunganRef.current;
      if (
        lama.pendingCount === baru.pendingCount &&
        lama.failedCount === baru.failedCount
      ) {
        return;
      }
      hitunganRef.current = baru;
      setHitungan(baru);
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [database]);

  return {
    status,
    pendingCount: hitungan.pendingCount,
    failedCount: hitungan.failedCount,
  };
}
