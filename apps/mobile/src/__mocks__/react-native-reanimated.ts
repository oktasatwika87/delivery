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
const SlideOutRight = buatRangkai();
const LinearTransition = buatRangkai();

/** Easing: semua varian mengembalikan fungsi (t => t). */
function fungsiEasing(t: number): number {
  return t;
}

const Easing = {
  bezier: (_x1: number, _y1: number, _x2: number, _y2: number) => fungsiEasing,
  linear: () => fungsiEasing,
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
  LinearTransition,
  ReduceMotion,
  SlideOutRight,
  createAnimatedComponent: Animated.createAnimatedComponent,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
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
