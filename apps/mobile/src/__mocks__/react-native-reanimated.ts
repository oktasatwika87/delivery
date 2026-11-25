/**
 * Tiruan sederhana react-native-reanimated untuk tes komponen.
 *
 * Pustaka aslinya butuh modul native dan plugin babel, jadi di jest repo ini
 * dipetakan ke file ini lewat moduleNameMapper di jest.config.js.
 *
 * Yang ditiru cuma API yang sudah dipakai. Kalau sebuah komponen baru
 * butuh API lain, tinggal ditambah di sini.
 *
 * Tiruan resmi reanimated tidak dipakai karena mengimpor seluruh isi
 * reanimated asli yang butuh Animated dan processColor dari react-native,
 * sedangkan tiruan react-native di repo ini tidak punya keduanya.
 *
 * Polanya sama dengan tiruan react-native-svg di src/__mocks__/.
 */

declare const module: { exports: unknown };

import type { ReactElement, ReactNode } from 'react';

const React = require('react');
const ReactNative = require('react-native');

/** Nilai bersama: objek dengan satu properti value yang bisa diubah. */
interface NilaiBersama {
  value: unknown;
}

function useSharedValue(nilaiAwal: unknown): NilaiBersama {
  const ref = React.useRef(null);
  if (ref.current === null) {
    ref.current = { value: nilaiAwal };
  }
  return ref.current;
}

/** Hook gaya: memanggil fungsinya lalu mengembalikan hasilnya. */
function useAnimatedStyle(
  fungsi: () => unknown,
  _dependensi?: unknown[],
): unknown {
  return fungsi();
}

/** Hook props: memanggil fungsinya lalu mengembalikan hasilnya. */
function useAnimatedProps(
  fungsi: () => unknown,
  _dependensi?: unknown[],
): unknown {
  return fungsi();
}

function withTiming(
  nilaiAkhir: unknown,
  _konfigurasi?: unknown,
  callback?: (selesai: boolean) => void,
): unknown {
  callback?.(true);
  return nilaiAkhir;
}

function withSpring(
  nilaiAkhir: unknown,
  _konfigurasi?: unknown,
  callback?: (selesai: boolean) => void,
): unknown {
  callback?.(true);
  return nilaiAkhir;
}

function withDelay(
  _jeda: number,
  animasi: unknown,
  _reduceMotion?: unknown,
): unknown {
  return animasi;
}

/** Rangkaian animasi: yang dipakai adalah animasi terakhir. */
function withSequence(...animasi: unknown[]): unknown {
  return animasi[animasi.length - 1];
}

/** Pengulangan: yang dipakai adalah animasi itu sendiri. */
function withRepeat(
  animasi: unknown,
  _jumlah?: number,
  _balik?: boolean,
  _callback?: unknown,
): unknown {
  return animasi;
}

/** Panggilan balik JS dari worklet: di luar worklet fungsinya apa adanya. */
function runOnJS<T>(fungsi: T): T {
  return fungsi;
}

/** Membatalkan animasi: di luar worklet tidak ada yang dibatalkan. */
function cancelAnimation(_animasi: unknown): void {
  // Tidak ada apa-apa.
}

/**
 * Pembangun entering/exiting/layout. Semua method mengembalikan pembangun itu
 * sendiri supaya bisa dirangkai, dan pembangun dipakai apa adanya kalau
 * ditulis langsung sebagai props.
 */
type Rangkai = Record<string, unknown>;

const METODE_RANGKAI = [
  'delay',
  'duration',
  'easing',
  'springify',
  'damping',
  'mass',
  'stiffness',
  'dampingRatio',
  'overshootClamping',
  'clamp',
  'reduceMotion',
  'withInitialValues',
  'withCallback',
  'rotate',
  'build',
];

function buatRangkai(): Rangkai {
  const rangkai: Rangkai = {};
  METODE_RANGKAI.forEach((nama) => {
    rangkai[nama] = () => rangkai;
  });
  return rangkai;
}

const FadeIn = buatRangkai();
const FadeInDown = buatRangkai();
const FadeInUp = buatRangkai();
const FadeOut = buatRangkai();
const FadeOutUp = buatRangkai();
const SlideOutRight = buatRangkai();
const LinearTransition = buatRangkai();
const ZoomOut = buatRangkai();

/** Easing dasar: mengembalikan nilai input apa adanya. */
function fungsiEasing(t: number): number {
  return t;
}

/**
 * Kurva bezier dibuat baru tiap dipanggil, jadi kurva yang berbeda bisa
 * dibedakan di tes.
 */
function easingBezierBaru(): (t: number) => number {
  return (t: number) => t;
}

const Easing = {
  bezier: (_x1: number, _y1: number, _x2: number, _y2: number) => easingBezierBaru(),
  linear: fungsiEasing,
  in: () => fungsiEasing,
  out: () => fungsiEasing,
  inOut: () => fungsiEasing,
};

const ReduceMotion = {
  System: 'system',
  Always: 'always',
  Never: 'never',
};

function useReducedMotion(): boolean {
  return false;
}

/**
 * Pembungkus konfigurasi gerak tata letak.
 *
 * Anak yang dipasang bersamaan dengan pembungkusnya bisa dilewati gerak
 * masuknya, jadi anak itu tidak masuk dua kali.
 */
function LayoutAnimationConfig(props: {
  children?: ReactNode;
  skipEntering?: boolean;
}): ReactElement {
  return React.createElement(React.Fragment, null, props.children);
}

/** Komponen Animated: meneruskan ke komponen react-native yang sama. */
const Animated = {
  View: ReactNative.View,
  Text: ReactNative.Text,
  FlatList: ReactNative.FlatList,
  ScrollView: ReactNative.ScrollView,
  Image: ReactNative.Image,
  createAnimatedComponent: (komponen: unknown) => komponen,
};

const isi = {
  Animated,
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  FadeOutUp,
  LayoutAnimationConfig,
  LinearTransition,
  ReduceMotion,
  SlideOutRight,
  ZoomOut,
  cancelAnimation,
  createAnimatedComponent: Animated.createAnimatedComponent,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
};

module.exports = {
  __esModule: true,
  default: Animated,
  ...isi,
};

// Supaya file ini jadi modul, bukan skrip global yang menabrak variabel
// module bawaan Node.
export {};
