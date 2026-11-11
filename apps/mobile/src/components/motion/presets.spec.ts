/**
 * Tes pola gerak: jeda antarbaris dan pembangun yang dipakai tiap layar.
 */

import {
  enterFromAbove,
  enterFromBelow,
  exitUp,
  fadeIn,
  fadeOut,
  shift,
  shrinkOut,
  staggerDelay,
} from './presets';

describe('pola gerak', () => {
  it('jeda baris pertama nol', () => {
    expect(staggerDelay(0)).toBe(0);
  });

  it('jeda baris kedua 50 milidetik', () => {
    expect(staggerDelay(1)).toBe(50);
  });

  it('jeda baris kedelapan 350 milidetik', () => {
    expect(staggerDelay(7)).toBe(350);
  });

  it('jeda baris kesembilan tetap 350 milidetik', () => {
    expect(staggerDelay(8)).toBe(350);
  });

  it('jeda baris kedua puluh tetap 350 milidetik', () => {
    expect(staggerDelay(20)).toBe(350);
  });

  it('semua pola gerak mengembalikan pembangun', () => {
    expect(enterFromBelow()).toBeDefined();
    expect(enterFromAbove()).toBeDefined();
    expect(exitUp()).toBeDefined();
    expect(fadeIn()).toBeDefined();
    expect(fadeOut()).toBeDefined();
    expect(shrinkOut()).toBeDefined();
    expect(shift()).toBeDefined();
  });
});
