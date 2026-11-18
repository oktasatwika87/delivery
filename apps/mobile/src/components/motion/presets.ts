/**
 * Pola gerak yang dipakai layar.
 *
 * Setiap fungsi membuat pembangun baru, jadi pemanggil yang butuh jeda
 * atau durasi berbeda tidak saling menimpa.
 */

import {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  FadeOutUp,
  LinearTransition,
  SlideOutRight,
  ZoomOut,
} from 'react-native-reanimated';

import { motion } from '../../theme/tokens';

export const standardEasing = Easing.bezier(...motion.curve.standard);
export const exitEasing = Easing.bezier(...motion.curve.exit);

/** Masuk dari bawah: opacity naik sambil naik 25 dp ke posisi akhir. */
export function enterFromBelow(delay = 0) {
  return FadeInDown.duration(motion.duration.enter)
    .easing(standardEasing)
    .delay(delay);
}

/** Masuk dari atas: opacity naik sambil turun 25 dp ke posisi akhir. */
export function enterFromAbove(delay = 0) {
  return FadeInUp.duration(motion.duration.enter)
    .easing(standardEasing)
    .delay(delay);
}

/** Keluar ke atas: opacity turun sambil naik 25 dp. */
export function exitUp() {
  return FadeOutUp.duration(motion.duration.exit).easing(exitEasing);
}

/** Masuk dengan opacity saja. */
export function fadeIn() {
  return FadeIn.duration(motion.duration.fadeIn).easing(standardEasing);
}

/** Keluar dengan opacity saja. */
export function fadeOut() {
  return FadeOut.duration(motion.duration.fadeOut).easing(exitEasing);
}

/** Keluar sambil mengecil. */
export function shrinkOut() {
  return ZoomOut.duration(motion.duration.exit).easing(exitEasing);
}

/** Geser posisi saat tata letak berubah. */
export function shift() {
  return LinearTransition.duration(motion.duration.shift).easing(standardEasing);
}

/**
 * Keluar ke kanan: kartu hilang ke arah kanan.
 *
 * Kurvanya cepat di awal: kartu langsung menjauh, jadi tidak tertimpa baris
 * di bawahnya yang naik ke ruang yang ditinggalkan.
 */
export function exitRight() {
  return SlideOutRight.duration(motion.duration.exit).easing(standardEasing);
}

/**
 * Jeda antarbaris saat masuknya daftar.
 *
 * Jeda berhenti bertambah di batas maxDelay, jadi baris paling bawah tidak
 * menunggu terlalu lama.
 */
export function staggerDelay(index: number): number {
  return Math.min(index * motion.stagger.enter, motion.stagger.maxDelay);
}
