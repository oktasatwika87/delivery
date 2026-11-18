/**
 * Tes posisi gulir untuk kartu Order Saya yang baru diterima.
 *
 * Daftar Order Saya diurutkan dari yang paling lama, jadi order pool yang
 * baru diterima bisa jatuh di bawah layar. Fungsi ini menghitung sejauh
 * mana daftar harus digulir supaya kartu itu terlihat penuh.
 */

import { revealOffset } from './orderListScroll';

describe('hitung posisi gulir kartu baru', () => {
  it('kartu pertama yang muat tidak digulir', () => {
    expect(
      revealOffset({
        cardTop: 0,
        cardHeight: 120,
        viewportHeight: 400,
        gapAbove: 8,
        gapBelow: 12,
      }),
    ).toBe(0);
  });

  it('kartu yang tepat menyentuh batas bawah dengan jaraknya tidak digulir', () => {
    expect(
      revealOffset({
        cardTop: 288,
        cardHeight: 100,
        viewportHeight: 400,
        gapAbove: 8,
        gapBelow: 12,
      }),
    ).toBe(0);
  });

  it('kartu di bawah layar digulir sampai jaraknya pas di batas bawah', () => {
    expect(
      revealOffset({
        cardTop: 300,
        cardHeight: 100,
        viewportHeight: 400,
        gapAbove: 8,
        gapBelow: 12,
      }),
    ).toBe(12);
  });

  it('kartu yang lebih tinggi dari daftar digulir ke tepi atasnya', () => {
    expect(
      revealOffset({
        cardTop: 50,
        cardHeight: 600,
        viewportHeight: 400,
        gapAbove: 8,
        gapBelow: 12,
      }),
    ).toBe(42);
  });

  it('tinggi daftar nol tidak digulir', () => {
    expect(
      revealOffset({
        cardTop: 0,
        cardHeight: 120,
        viewportHeight: 0,
        gapAbove: 8,
        gapBelow: 12,
      }),
    ).toBe(0);
  });
});
