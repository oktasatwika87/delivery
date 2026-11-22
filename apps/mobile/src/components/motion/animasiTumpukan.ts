/**
 * Animasi tumpukan layar driver.
 *
 * react-native-screens 3.37 menganggap 'slide_from_right' sebagai animasi
 * buatan, jadi gestur geser kembali dari tepi kiri tidak jalan di iOS.
 * Di iOS dipakai animasi bawaan (default) supaya gestur kembali jalan.
 */

import { Platform } from 'react-native';

/** Macam animasi yang boleh dipakai native-stack. */
export type AnimasiTumpukan = 'none' | 'default' | 'slide_from_right';

export function animasiTumpukan(
  kurangiGerak: boolean,
  os: typeof Platform.OS,
): AnimasiTumpukan {
  if (kurangiGerak) return 'none';
  if (os === 'ios') return 'default';
  return 'slide_from_right';
}
