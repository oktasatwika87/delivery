/**
 * Perhitungan posisi gulir untuk kartu Order Saya yang baru diterima.
 *
 * Fungsi murni, jadi bisa diuji tanpa layar.
 */

export interface RevealInput {
  /** Jarak kartu dari atas daftar. */
  cardTop: number;
  /** Tinggi kartu. */
  cardHeight: number;
  /** Tinggi bagian daftar yang terlihat. */
  viewportHeight: number;
  /** Jarak yang ditinggalkan di atas kartu. */
  gapAbove: number;
  /** Jarak yang ditinggalkan di bawah kartu. */
  gapBelow: number;
}

/**
 * Seberapa jauh daftar harus digulir supaya kartu terlihat penuh.
 *
 * Kalau kartu sudah terlihat penuh, daftarnya tidak digulir. Kartu yang
 * lebih tinggi dari bagian daftar yang terlihat diutamakan tepi atasnya.
 */
export function revealOffset(input: RevealInput): number {
  if (input.viewportHeight <= 0) return 0;

  const bawah = input.cardTop + input.cardHeight + input.gapBelow - input.viewportHeight;
  if (bawah <= 0) return 0;

  return Math.min(bawah, Math.max(0, input.cardTop - input.gapAbove));
}
