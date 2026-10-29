/**
 * Format waktu order untuk ditampilkan ke pengguna, pakai waktu lokal HP.
 *
 * Waktu lokal dipakai supaya jam yang dilihat pengguna sama dengan jam di
 * HP-nya, bukan jam server.
 */

const BULAN_PENDEK = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

function duaDigit(nilai: number): string {
  return nilai < 10 ? `0${nilai}` : String(nilai);
}

function jamMenit(d: Date): string {
  return `${duaDigit(d.getHours())}.${duaDigit(d.getMinutes())}`;
}

function tanggalBulan(d: Date): string {
  return `${d.getDate()} ${BULAN_PENDEK[d.getMonth()]}`;
}

function samaTanggal(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Ubah waktu order (ms) jadi teks pendek.
 *
 * Hari yang sama: "14.05"
 * Kemarin: "Kemarin 14.05"
 * Tanggal lain tahun yang sama: "24 Sep 14.05"
 * Tahun berbeda: "24 Sep 2025 14.05"
 */
export function formatOrderTime(ms: number, nowMs: number): string {
  const waktu = new Date(ms);
  const sekarang = new Date(nowMs);

  if (samaTanggal(waktu, sekarang)) {
    return jamMenit(waktu);
  }

  const kemarin = new Date(
    sekarang.getFullYear(),
    sekarang.getMonth(),
    sekarang.getDate() - 1,
  );
  if (samaTanggal(waktu, kemarin)) {
    return `Kemarin ${jamMenit(waktu)}`;
  }

  if (waktu.getFullYear() === sekarang.getFullYear()) {
    return `${tanggalBulan(waktu)} ${jamMenit(waktu)}`;
  }

  return `${tanggalBulan(waktu)} ${waktu.getFullYear()} ${jamMenit(waktu)}`;
}
