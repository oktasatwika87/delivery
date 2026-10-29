import { formatOrderTime } from './formatOrderTime';

describe('formatOrderTime', () => {
  const waktu = (y: number, m: number, d: number, h: number, min: number) =>
    new Date(y, m, d, h, min).getTime();

  it('waktu hari yang sama cuma jam dan menit', () => {
    const now = waktu(2025, 8, 24, 10, 0);
    expect(formatOrderTime(waktu(2025, 8, 24, 14, 5), now)).toBe('14.05');
  });

  it('waktu jam nol nol hari ini tetap jam dan menit', () => {
    const now = waktu(2025, 8, 24, 10, 0);
    expect(formatOrderTime(waktu(2025, 8, 24, 0, 0), now)).toBe('00.00');
  });

  it('waktu kemarin pakai kata Kemarin', () => {
    const now = waktu(2025, 8, 24, 10, 0);
    expect(formatOrderTime(waktu(2025, 8, 23, 23, 59), now)).toBe(
      'Kemarin 23.59',
    );
  });

  it('kemarin lintas batas bulan pakai kata Kemarin', () => {
    const now = waktu(2025, 10, 1, 8, 0);
    expect(formatOrderTime(waktu(2025, 9, 31, 20, 15), now)).toBe(
      'Kemarin 20.15',
    );
  });

  it('kemarin lintas batas tahun pakai kata Kemarin', () => {
    const now = waktu(2026, 0, 1, 8, 0);
    expect(formatOrderTime(waktu(2025, 11, 31, 20, 15), now)).toBe(
      'Kemarin 20.15',
    );
  });

  it('tanggal satu digit tidak dikasih nol di depan', () => {
    const now = waktu(2025, 8, 24, 10, 0);
    expect(formatOrderTime(waktu(2025, 8, 4, 9, 30), now)).toBe('4 Sep 09.30');
  });

  it('tanggal di tahun lain sama dengan tanggal hari ini', () => {
    const now = waktu(2025, 8, 24, 10, 0);
    expect(formatOrderTime(waktu(2024, 8, 24, 9, 30), now)).toBe(
      '24 Sep 2024 09.30',
    );
  });

  it('waktu di masa depan dengan tanggal lain pakai format tanggal', () => {
    const now = waktu(2025, 8, 24, 10, 0);
    expect(formatOrderTime(waktu(2025, 8, 25, 14, 5), now)).toBe(
      '25 Sep 14.05',
    );
  });
});
