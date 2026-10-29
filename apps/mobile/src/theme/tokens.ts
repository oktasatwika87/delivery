/**
 * Token desain M Delivery: warna, jarak, sudut, ukuran, bayangan, dan gaya teks.
 *
 * Komponen nanti hanya membaca nilai dari file ini, jadi tema bisa diubah
 * di satu tempat saja.
 */

import type { TextStyle } from 'react-native';

// Palet dasar. Tidak diekspor, komponen pakai nama semantik di bawah.
const ink950 = '#0b0b0c';
const ink800 = '#27272a';
const ink700 = '#3f3f46';
const ink600 = '#52525b';
const ink500 = '#71717a';
const ink400 = '#a1a1aa';
const ink200 = '#e4e4e7';
const ink100 = '#f4f4f5';
const ink50 = '#fafafa';
const white = '#ffffff';
const red500 = '#e0243f';
const red600 = '#c8102e';
const red700 = '#a30d24';
const red50 = '#fdecee';
const green800 = '#0f4a2e';
const green700 = '#155e3b';
const green50 = '#e7f3ec';
const amber700 = '#a15c07';
const amber50 = '#fef3d6';

export const colors = {
  bg: ink100,
  surface: white,
  surfaceMuted: ink50,
  surfaceInverse: ink950,
  fillNeutral: ink200,
  text: ink950,
  textMuted: ink600,
  textSubtle: ink500,
  textInverse: white,
  textInverseMuted: ink400,
  line: ink200,
  lineStrong: '#85858d',
  lineInverse: ink700,
  action: ink950,
  actionPressed: ink800,
  onAction: white,
  actionDisabled: ink200,
  onActionDisabled: ink600,
  brandRed: red600,
  brandRedInverse: red500,
  danger: red600,
  dangerStrong: red700,
  dangerSoft: red50,
  success: green700,
  successStrong: green800,
  successSoft: green50,
  warning: amber700,
  warningSoft: amber50,
  focus: ink950,
  scrim: '#0b0b0c80',
  mapRoute: ink950,
  mapRouteCasing: white,
} as const;

/** Jarak dalam dp, dipakai untuk padding dan margin. */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
} as const;

/** Jari-jari sudut dalam dp. */
export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

/** Ukuran tetap dalam dp, dipakai untuk tinggi kontrol dan ikon. */
export const size = {
  touch: 48,
  controlLg: 56,
  controlMd: 48,
  controlSm: 36,
  appbar: 56,
  connectionBar: 36,
  icon: 24,
  iconSm: 20,
} as const;

/**
 * Elevasi Android, sudah termasuk nilai shadow-1 sampai shadow-3.
 * Tidak ada properti bayangan iOS di sini.
 */
export const elevation = {
  card: 1,
  raised: 4,
  overlay: 8,
} as const;

/** Nama file huruf di assets/fonts, tanpa ekstensi. */
export const fontFamily = {
  regular: 'PlusJakartaSans-Regular',
  medium: 'PlusJakartaSans-Medium',
  semibold: 'PlusJakartaSans-SemiBold',
  bold: 'PlusJakartaSans-Bold',
  extrabold: 'PlusJakartaSans-ExtraBold',
} as const;

export type FontFamilyName = (typeof fontFamily)[keyof typeof fontFamily];

/**
 * Gaya teks siap pakai.
 *
 * Pakai fontFamily, bukan fontWeight, karena di Android fontWeight tidak
 * memilih file huruf yang dipakai.
 */
export interface TypeStyle extends TextStyle {
  fontFamily: FontFamilyName;
}

export const type = {
  display: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: fontFamily.extrabold,
    letterSpacing: -0.28,
  },
  titleLg: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: fontFamily.bold,
  },
  titleMd: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: fontFamily.bold,
  },
  titleSm: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: fontFamily.bold,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: fontFamily.regular,
  },
  bodySm: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: fontFamily.medium,
  },
  label: {
    fontSize: 16,
    lineHeight: 20,
    fontFamily: fontFamily.bold,
  },
  labelSm: {
    fontSize: 13,
    lineHeight: 16,
    fontFamily: fontFamily.bold,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.medium,
  },
  overline: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: fontFamily.bold,
    letterSpacing: 0.96,
  },
  amount: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: fontFamily.extrabold,
    fontVariant: ['tabular-nums'],
  },
} satisfies Record<string, TypeStyle>;
