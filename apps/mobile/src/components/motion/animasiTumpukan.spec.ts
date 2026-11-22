/**
 * Tes pilihan animasi tumpukan layar driver.
 *
 * Yang diuji: kurangi gerak mematikan semua animasi, iOS memakai animasi
 * bawaan supaya gestur geser kembali jalan, dan platform lain tetap
 * memakai geser dari kanan.
 */

import { animasiTumpukan } from './animasiTumpukan';

describe('animasi tumpukan layar driver', () => {
  it('kurangi gerak mematikan semua animasi', () => {
    expect(animasiTumpukan(true, 'android')).toBe('none');
  });

  it('kurangi gerak di ios juga mematikan animasi', () => {
    expect(animasiTumpukan(true, 'ios')).toBe('none');
  });

  it('ios pakai animasi bawaan', () => {
    expect(animasiTumpukan(false, 'ios')).toBe('default');
  });

  it('platform lain tetap pakai geser dari kanan', () => {
    expect(animasiTumpukan(false, 'android')).toBe('slide_from_right');
  });
});
