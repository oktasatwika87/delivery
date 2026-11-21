/**
 * Detak untuk menghitung ulang status basi.
 *
 * Status basi dihitung dari waktu sekarang saat layar digambar ulang. Kalau
 * tidak ada gambar ulang, misalnya offline tanpa data baru, kartu dan detail
 * tidak pernah berubah jadi basi. Detak ini menggambar ulang layar tiap menit
 * selama masih ada antrean.
 */

import { useEffect, useState } from 'react';

/** Jarak antar detak, satu menit. */
export const DETAK_BASI_MS = 60 * 1000;

/**
 * Angka yang naik tiap menit selama aktif.
 *
 * Nilainya dipakai layar sebagai pemicu gambar ulang, bukan ditampilkan.
 */
export function useDetakBasi(aktif: boolean): number {
  const [detak, setDetak] = useState(0);

  useEffect(() => {
    if (!aktif) return;
    const pewaktu = setInterval(() => {
      setDetak((nilai) => nilai + 1);
    }, DETAK_BASI_MS);
    return () => clearInterval(pewaktu);
  }, [aktif]);

  return detak;
}
