/**
 * Tes pola gerak: jeda antarbaris dan pembangun yang dipakai tiap layar.
 */

import {
  collapseOut,
  enterFromAbove,
  enterFromBelow,
  exitEasing,
  exitRight,
  exitUp,
  expandIn,
  fadeIn,
  fadeOut,
  shift,
  shrinkOut,
  staggerDelay,
  standardEasing,
} from './presets';
import { motion } from '../../theme/tokens';
import { SlideOutRight } from 'react-native-reanimated';
import * as reanimated from 'react-native-reanimated';
import type { EntryAnimationsValues, ExitAnimationsValues } from 'react-native-reanimated';

/** Nilai masuk lengkap: semua kolom target dan ukuran jendela. */
function nilaiMasuk(): EntryAnimationsValues {
  return {
    targetOriginX: 0,
    targetOriginY: 0,
    targetWidth: 320,
    targetHeight: 60,
    targetBorderRadius: 14,
    targetGlobalOriginX: 0,
    targetGlobalOriginY: 0,
    windowWidth: 360,
    windowHeight: 720,
  };
}

/** Nilai keluar lengkap: semua kolom current dan ukuran jendela. */
function nilaiKeluar(): ExitAnimationsValues {
  return {
    currentOriginX: 0,
    currentOriginY: 0,
    currentWidth: 320,
    currentHeight: 80,
    currentBorderRadius: 14,
    currentGlobalOriginX: 0,
    currentGlobalOriginY: 0,
    windowWidth: 360,
    windowHeight: 720,
  };
}

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
    expect(exitRight()).toBeDefined();
  });

  it('keluar ke kanan memakai SlideOutRight', () => {
    expect(exitRight()).toBe(SlideOutRight);
  });

  it('keluar ke kanan memakai kurva cepat di awal', () => {
    const spy = jest.spyOn(SlideOutRight, 'easing');

    try {
      exitRight();

      expect(spy).toHaveBeenCalledWith(standardEasing);
      expect(standardEasing).not.toBe(exitEasing);
    } finally {
      spy.mockRestore();
    }
  });

  it('banner masuk: tinggi dari nol ke tinggi akhir, isinya muncul belakangan', () => {
    const timing = jest.spyOn(reanimated, 'withTiming');
    const delay = jest.spyOn(reanimated, 'withDelay');

    try {
      const hasil = expandIn()(nilaiMasuk());

      expect(hasil.initialValues.height).toBe(0);
      expect(hasil.initialValues.opacity).toBe(0);
      expect(hasil.animations.height).toBe(60);
      expect(hasil.animations.opacity).toBe(1);
      expect(timing).toHaveBeenCalledWith(60, {
        duration: motion.duration.shift,
        easing: standardEasing,
      });
      expect(timing).toHaveBeenCalledWith(1, {
        duration: motion.duration.fadeIn,
        easing: standardEasing,
      });
      expect(delay).toHaveBeenCalledWith(motion.duration.fadeOut, expect.anything());
    } finally {
      timing.mockRestore();
      delay.mockRestore();
    }
  });

  it('banner keluar: tinggi menyusut ke nol, isinya cepat pudar', () => {
    const timing = jest.spyOn(reanimated, 'withTiming');

    try {
      const hasil = collapseOut()(nilaiKeluar());

      expect(hasil.initialValues.height).toBe(80);
      expect(hasil.initialValues.opacity).toBe(1);
      expect(hasil.animations.height).toBe(0);
      expect(hasil.animations.opacity).toBe(0);
      expect(timing).toHaveBeenCalledWith(0, {
        duration: motion.duration.shift,
        easing: standardEasing,
      });
      expect(timing).toHaveBeenCalledWith(0, {
        duration: motion.duration.fadeOut,
        easing: standardEasing,
      });
    } finally {
      timing.mockRestore();
    }
  });
});
