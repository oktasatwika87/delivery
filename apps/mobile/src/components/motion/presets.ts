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
  withDelay,
  withTiming,
  ZoomOut,
} from 'react-native-reanimated';
import type {
  EntryAnimationsValues,
  ExitAnimationsValues,
  LayoutAnimation,
} from 'react-native-reanimated';

import { motion } from '../../theme/tokens';

export const standardEasing = Easing.bezier(...motion.curve.standard);
export const exitEasing = Easing.bezier(...motion.curve.exit);
/** Kurva motor meluncur: pelan di awal, lalu lancar ke titik berikutnya. */
export const motorEasing = Easing.bezier(...motion.curve.motor);

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

/** Masuk dengan opacity saja. Jedanya dipakai untuk menunda masuknya isi. */
export function fadeIn(delay = 0) {
  return FadeIn.duration(motion.duration.fadeIn)
    .easing(standardEasing)
    .delay(delay);
}

/** Keluar dengan opacity saja. */
export function fadeOut() {
  return FadeOut.duration(motion.duration.fadeOut).easing(exitEasing);
}

/**
 * Masuk sambil membesar: pudar masuk dan skala naik ke satu.
 *
 * Dipakai untuk tombol yang muncul saat isi baris berubah, jadi tombolnya
 * tumbuh bareng dengan isi baris itu.
 */
export function masukSkala(
  dari = 0.9,
): (values: EntryAnimationsValues) => LayoutAnimation {
  return () => {
    'worklet';
    return {
      initialValues: {
        opacity: 0,
        transform: [{ scale: dari }],
      },
      animations: {
        opacity: withTiming(1, {
          duration: motion.duration.fadeIn,
          easing: standardEasing,
        }),
        transform: [
          {
            scale: withTiming(1, {
              duration: motion.duration.fadeIn,
              easing: standardEasing,
            }),
          },
        ],
      },
    };
  };
}

/**
 * Keluar sambil mengecil.
 */
export function shrinkOut() {
  return ZoomOut.duration(motion.duration.exit).easing(exitEasing);
}

/** Geser posisi saat tata letak berubah. */
export function shift() {
  return LinearTransition.duration(motion.duration.shift).easing(standardEasing);
}

/**
 * Gerak tinggi: tinggi wadah ikut bergerak saat isinya berubah.
 *
 * Dipakai untuk wadah yang isinya bisa berubah tinggi, misalnya wadah judul
 * kepala dan isi lembar. Isi yang ada di bawahnya ikut bergeser dengan gerak
 * yang sama, jadi tidak melompat.
 */
export function geserTinggi() {
  return LinearTransition.duration(motion.duration.exit).easing(standardEasing);
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
 * Banner masuk: tinggi dibuka dari nol, isinya muncul belakangan.
 *
 * Tingginya bergerak dengan durasi dan kurva yang sama dengan geser, jadi isi
 * di bawahnya yang ikut bergeser tidak pernah tertimpa. Isi yang keluar
 * cepat pudar supaya potongannya tidak terlihat, dan isi yang masuk baru
 * terlihat sesudah sebagian besar tingginya terbuka.
 *
 * Pemakai wajib memberi overflow hidden.
 */
export function expandIn(): (values: EntryAnimationsValues) => LayoutAnimation {
  return (values) => {
    'worklet';
    return {
      initialValues: {
        height: 0,
        opacity: 0,
      },
      animations: {
        height: withTiming(values.targetHeight, {
          duration: motion.duration.shift,
          easing: standardEasing,
        }),
        opacity: withDelay(
          motion.duration.fadeOut,
          withTiming(1, {
            duration: motion.duration.fadeIn,
            easing: standardEasing,
          }),
        ),
      },
    };
  };
}

/**
 * Banner keluar: tingginya menyusut ke nol.
 *
 * Tingginya bergerak dengan durasi dan kurva yang sama dengan geser, jadi isi
 * di bawahnya yang ikut bergeser tidak pernah tertimpa. Banner tidak bergeser
 * ke atas atau ke bawah supaya tidak menyapu saudaranya di atasnya, dan isi
 * yang keluar cepat pudar supaya potongannya tidak terlihat.
 *
 * Pemakai wajib memberi overflow hidden.
 */
export function collapseOut(): (values: ExitAnimationsValues) => LayoutAnimation {
  return (values) => {
    'worklet';
    return {
      initialValues: {
        height: values.currentHeight,
        opacity: 1,
      },
      animations: {
        height: withTiming(0, {
          duration: motion.duration.shift,
          easing: standardEasing,
        }),
        opacity: withTiming(0, {
          duration: motion.duration.fadeOut,
          easing: standardEasing,
        }),
      },
    };
  };
}

/**
 * Keluar sambil turun: isi yang keluar turun setinggi dirinya ditambah jarak.
 *
 * Tampilan yang keluar diam di tempatnya terhadap wadah, dan di Android ia
 * digambar di atas saudaranya. Kalau wadahnya tumbuh ke atas bersamaan,
 * saudara di atasnya yang turun bisa berpapasan dengannya. Turun sejauh
 * tingginya ditambah jarak, dengan durasi dan kurva yang sama dengan geser,
 * tampilan itu selalu menjauh ke bawah.
 *
 * Tingginya tidak diubah, jadi pemakai tidak perlu overflow hidden.
 */
export function exitDown(jarak: number): (values: ExitAnimationsValues) => LayoutAnimation {
  return (values) => {
    'worklet';
    return {
      initialValues: {
        opacity: 1,
        transform: [{ translateY: 0 }],
      },
      animations: {
        transform: [
          {
            translateY: withTiming(values.currentHeight + jarak, {
              duration: motion.duration.shift,
              easing: standardEasing,
            }),
          },
        ],
        opacity: withTiming(0, {
          duration: motion.duration.fadeOut,
          easing: standardEasing,
        }),
      },
    };
  };
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
