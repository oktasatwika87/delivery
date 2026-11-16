/**
 * Token desain M Delivery versi 2.
 *
 * Warna ada dua tema dengan nama kunci yang sama: `gelap` untuk semua layar
 * driver, Masuk, Daftar, dan splash; `terang` untuk layar customer. Komponen
 * membaca warna lewat `useTheme()` di ThemeProvider, tidak pernah mengimpor
 * satu tema langsung. Sisanya (teks, jarak, sudut, ukuran, garis, gerak)
 * tidak bergantung tema.
 */

import type { TextStyle } from 'react-native';

/** Palet dasar. Hanya sumber nilai dan bahan gambar peta, bukan dipakai komponen. */
export const palette = {
  charcoal950: '#121319',
  charcoal900: '#181A22',
  charcoal800: '#1E2029',
  charcoal750: '#21232E',
  charcoal600: '#2B2E3B',
  charcoal500: '#3A3E4D',
  slate300: '#B6BAC8',
  slate400: '#9499AC',
  slate600: '#646A7D',
  mist50: '#F2F3F7',
  mist100: '#F4F5F8',
  mist200: '#EEF0F4',
  white: '#FFFFFF',
  tangerine500: '#FE8500',
  royal600: '#105BFF',
  sky400: '#6F9BFF',
  red600: '#C8102E',
  red300: '#FF8F8F',
  yellow300: '#F5C451',
  amber800: '#7A5000',
} as const;

export type ThemeName = 'gelap' | 'terang';

const gelap = {
  bg: '#121319',
  surface: '#1E2029',
  surfaceRaised: '#2B2E3B',
  surfaceMuted: '#F2F3F70A',
  surfaceLift: '#232631',
  fillNeutral: '#F2F3F714',
  header: '#121319',
  headerEnd: '#121319',
  textLabel: '#B6BAC8',
  text: '#F2F3F7',
  textMuted: '#B6BAC8',
  textSubtle: '#9499AC',
  line: '#F2F3F714',
  lineCard: '#F2F3F70F',
  lineControl: '#F2F3F71A',
  lineStrong: '#6B7085',
  edgeHighlight: '#F2F3F71C',
  action: '#FE8500',
  actionPressed: '#EA7A00',
  onAction: '#21232E',
  actionDisabled: '#2B2E3B',
  onActionDisabled: '#9499AC',
  actionSecondary: '#2B2E3B',
  onActionSecondary: '#F2F3F7',
  accent: '#FE8500',
  onAccent: '#21232E',
  accentSoft: '#FE850024',
  onAccentSoft: '#FE8500',
  accentLine: '#FE850059',
  info: '#6F9BFF',
  infoSoft: '#6F9BFF24',
  onInfoSoft: '#6F9BFF',
  infoFill: '#6F9BFF',
  onInfoFill: '#21232E',
  infoWash: '#6F9BFF1A',
  infoLine: '#6F9BFF4D',
  syncSoft: '#6F9BFF29',
  danger: '#FF8F8F',
  dangerSoft: '#FF8F8F1F',
  onDanger: '#21232E',
  warning: '#F5C451',
  warningStripe: '#F5C45126',
  warningStripeAlt: '#F5C45112',
  pendingLine: '#F2F3F773',
  focus: '#6F9BFF',
  focusHalo: '#6F9BFF00',
  scrim: '#000000A3',
  rail: '#3A3E4D',
  brandGlow: '#105BFF',
  brandRoute: '#6F9BFF',
  logoM: '#F2F3F7',
  logoHelmet: '#FE8500',
  logoLine: '#FE8500',
  logoVisor: '#21232E',
  mapRoute: '#105BFF',
  mapCasing: '#FFFFFF',
  mapPin: '#FE8500',
  mapPinLine: '#21232E',
  mapDriver: '#105BFF',
  mapDriverHalo: '#105BFF33',
} as const;

/** Nama warna yang wajib ada di setiap tema. */
export type ThemeColors = Record<keyof typeof gelap, string>;

const terang: ThemeColors = {
  bg: '#F4F5F8',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceMuted: '#F4F5F8',
  surfaceLift: '#FFFFFF',
  fillNeutral: '#EEF0F4',
  header: '#21232E',
  headerEnd: '#181A22',
  textLabel: '#21232E',
  text: '#21232E',
  textMuted: '#646A7D',
  textSubtle: '#646A7D',
  line: '#21232E14',
  lineCard: '#21232E0F',
  lineControl: '#21232E1F',
  lineStrong: '#868B9C',
  edgeHighlight: '#21232E0F',
  action: '#105BFF',
  actionPressed: '#0F54EB',
  onAction: '#FFFFFF',
  actionDisabled: '#EEF0F4',
  onActionDisabled: '#646A7D',
  actionSecondary: '#FFFFFF',
  onActionSecondary: '#21232E',
  accent: '#FE8500',
  onAccent: '#21232E',
  accentSoft: '#FE850029',
  onAccentSoft: '#21232E',
  accentLine: '#FE850059',
  info: '#105BFF',
  infoSoft: '#105BFF14',
  onInfoSoft: '#105BFF',
  infoFill: '#105BFF',
  onInfoFill: '#FFFFFF',
  infoWash: '#105BFF0F',
  infoLine: '#105BFF40',
  syncSoft: '#105BFF1A',
  danger: '#C8102E',
  dangerSoft: '#C8102E14',
  onDanger: '#FFFFFF',
  warning: '#7A5000',
  warningStripe: '#F5C45140',
  warningStripeAlt: '#F5C45121',
  pendingLine: '#21232E99',
  focus: '#105BFF',
  focusHalo: '#105BFF24',
  scrim: '#1213197A',
  rail: '#DCDFE6',
  brandGlow: '#105BFF',
  brandRoute: '#6F9BFF',
  logoM: '#21232E',
  logoHelmet: '#FE8500',
  logoLine: '#21232E',
  logoVisor: '#FFFFFF',
  mapRoute: '#105BFF',
  mapCasing: '#FFFFFF',
  mapPin: '#FE8500',
  mapPinLine: '#21232E',
  mapDriver: '#105BFF',
  mapDriverHalo: '#105BFF33',
};

export const themes = { gelap, terang } satisfies Record<ThemeName, ThemeColors>;

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

/** Jari-jari sudut dalam dp. `xl2` adalah radius-2xl di design system. */
export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  xl2: 18,
  sheet: 24,
  full: 9999,
} as const;

/** Ukuran tetap dalam dp, dipakai untuk tinggi kontrol dan ikon. */
export const size = {
  touch: 48,
  controlLg: 56,
  controlCard: 52,
  controlMd: 48,
  controlSm: 44,
  header: 64,
  appbar: 48,
  connectionBar: 36,
  status: 28,
  cashbox: 64,
  stepDot: 22,
  icon: 24,
  iconMd: 22,
  iconSm: 18,
  iconXs: 16,
} as const;

/** Tebal garis dalam dp. */
export const stroke = {
  hairline: 1,
  pending: 1.5,
  ring: 2,
  route: 4,
  check: 2.6,
} as const;

/**
 * Elevasi Android, hanya dipakai tema terang. Tema gelap mengambil
 * kedalaman dari langkah warna permukaan dan tepi atas `edgeHighlight`.
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
} as const;

export type FontFamilyName = (typeof fontFamily)[keyof typeof fontFamily];

/**
 * Token gerak: durasi, jeda, kurva, dan angka kecil lain yang dipakai
 * komponen gerak. Semua dalam milidetik kecuali yang disebut lain.
 */
export const motion = {
  duration: {
    press: 120,
    release: 180,
    enter: 380,
    exit: 260,
    shift: 300,
    fadeIn: 180,
    fadeOut: 120,
    tabIndicator: 420,
    drawLine: 320,
    rollNumber: 400,
    fieldShake: 300,
    holdDone: 700,
    highlight: 1400,
    motorStep: 900,
  },
  stagger: {
    enter: 50,
    exit: 25,
    maxDelay: 350,
  },
  /** Titik kurva cubic-bezier, empat angka. */
  curve: {
    standard: [0.22, 1, 0.36, 1],
    exit: [0.64, 0, 0.78, 0],
    motor: [0.45, 0, 0.2, 1],
  },
  pressScale: 0.97,
  shakeDistance: 6,
  initialWindow: 500,
} as const;

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
  display: { fontSize: 28, lineHeight: 34, fontFamily: fontFamily.bold },
  headline: { fontSize: 26, lineHeight: 32, fontFamily: fontFamily.semibold },
  titleXl: { fontSize: 24, lineHeight: 32, fontFamily: fontFamily.semibold },
  titleLg: { fontSize: 22, lineHeight: 28, fontFamily: fontFamily.semibold },
  titleMd: { fontSize: 20, lineHeight: 24, fontFamily: fontFamily.semibold },
  titleSm: { fontSize: 17, lineHeight: 24, fontFamily: fontFamily.semibold },
  titleXs: { fontSize: 16, lineHeight: 22, fontFamily: fontFamily.semibold },
  body: { fontSize: 16, lineHeight: 24, fontFamily: fontFamily.regular },
  bodyMd: { fontSize: 15, lineHeight: 22, fontFamily: fontFamily.regular },
  bodyMdMedium: { fontSize: 15, lineHeight: 22, fontFamily: fontFamily.medium },
  bodySm: { fontSize: 14, lineHeight: 20, fontFamily: fontFamily.regular },
  bodySmMedium: { fontSize: 14, lineHeight: 20, fontFamily: fontFamily.medium },
  bodyXs: { fontSize: 13, lineHeight: 18, fontFamily: fontFamily.regular },
  labelLg: { fontSize: 17, lineHeight: 22, fontFamily: fontFamily.semibold },
  label: { fontSize: 16, lineHeight: 20, fontFamily: fontFamily.semibold },
  labelMd: { fontSize: 15, lineHeight: 20, fontFamily: fontFamily.semibold },
  labelSm: { fontSize: 13, lineHeight: 18, fontFamily: fontFamily.semibold },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: fontFamily.medium },
  amountLg: {
    fontSize: 22,
    lineHeight: 28,
    fontFamily: fontFamily.bold,
    fontVariant: ['tabular-nums'],
  },
  amount: {
    fontSize: 20,
    lineHeight: 26,
    fontFamily: fontFamily.bold,
    fontVariant: ['tabular-nums'],
  },
  stat: {
    fontSize: 18,
    lineHeight: 24,
    fontFamily: fontFamily.semibold,
    fontVariant: ['tabular-nums'],
  },
} satisfies Record<string, TypeStyle>;
