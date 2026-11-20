/**
 * Pola ganti isi di tempat.
 *
 * Dipakai saat isi di satu tempat berganti tapi tempatnya tetap, misalnya isi
 * kotak tunai atau judul tombol. Yang dikembalikan adalah isi lama yang
 * sedang keluar, nomor pergantian, dan cara menutupnya.
 *
 * Cara pakai: isi lama digambar di atas dengan posisi absolut,
 * `pointerEvents="none"`, disembunyikan dari pembaca layar
 * (`accessibilityElementsHidden` dan
 * `importantForAccessibility="no-hide-descendants"`), keluar dengan geraknya
 * lalu memanggil `selesai` lewat `runOnJS`. Lapisan baru diberi `key={nomor}`
 * dan menjalankan gerak masuknya saat dipasang kalau `nomor > 0`.
 *
 * Kontrak: kunci harus berubah setiap kali isi yang tampil berubah. Isi boleh
 * objek baru di setiap render. Lapisan isi lama diberi key berawalan `lama-`
 * (misalnya `lama-` lalu nomor), supaya tidak sama dengan key lapisan baru
 * saat keduanya bersaudara, dan supaya pergantian beruntun memasang lapisan
 * lama yang baru dari awal geraknya.
 */

import { useCallback, useState } from 'react';
import { useReducedMotion } from 'react-native-reanimated';

import { useInitialWindow } from './InitialWindow';

export interface GantiIsi<T> {
  /** Isi lama yang sedang keluar, null kalau tidak ada. */
  lama: T | null;
  /** Naik satu setiap kali isi berganti dengan gerak. Dipakai sebagai key lapisan isi baru. */
  nomor: number;
  /** Dipanggil saat isi lama selesai keluar, dengan nomor pergantiannya. */
  selesai: (nomor: number) => void;
}

interface Riwayat<T> {
  /** Isi saat kunci terakhir berubah. */
  isi: T;
  /** Kunci isi terakhir. */
  kunci: string;
  /** Isi lama yang sedang keluar, null kalau tidak ada. */
  lama: T | null;
  /** Nomor pergantian terakhir. */
  nomor: number;
}

export function useGantiIsi<T>(isi: T, kunci: string): GantiIsi<T> {
  const dalamJendela = useInitialWindow();
  const kurangiGerak = useReducedMotion();
  const [riwayat, setRiwayat] = useState<Riwayat<T>>({
    isi,
    kunci,
    lama: null,
    nomor: 0,
  });

  // Pergantian dihitung saat render, bukan di efek, jadi tidak ada satu render
  // yang sudah menampilkan isi baru tanpa lapisan isinya yang lama. Yang
  // dibandingkan cuma kunci, jadi isi boleh objek baru di setiap render.
  if (riwayat.kunci !== kunci) {
    const bolehGerak = !dalamJendela && !kurangiGerak;
    setRiwayat({
      isi,
      kunci,
      lama: bolehGerak ? riwayat.isi : null,
      nomor: bolehGerak ? riwayat.nomor + 1 : riwayat.nomor,
    });
  }

  // Yang boleh menutup isi lama cuma pergantian yang nomornya masih sama.
  // Nomor yang lebih lama sudah digantikan pergantian yang lebih baru.
  const selesai = useCallback((nomor: number) => {
    setRiwayat((sekarang) =>
      sekarang.nomor === nomor ? { ...sekarang, lama: null } : sekarang,
    );
  }, []);

  return { lama: riwayat.lama, nomor: riwayat.nomor, selesai };
}
