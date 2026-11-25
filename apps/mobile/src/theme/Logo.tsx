/**
 * Komponen logo M Delivery versi 2.
 *
 * Logo berisi huruf M dan helm bogo yang digantung miring lewat tali di ujung
 * kaki kanan M. Bentuknya digambar sebagai svg, jadi tidak butuh berkas gambar.
 * Lebar selalu dihitung dari tinggi supaya proporsinya tidak berubah kalau
 * ukurannya diganti.
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';

import { useTheme } from './ThemeProvider';

const VIEW_BOX = '0 0 200 172';
const LEBAR_VIEW_BOX = 200;
const TINGGI_VIEW_BOX = 172;
const TINGGI_BAWAAN = 43;

const JALUR_HURUF_M = 'M20 108 V24 L60 78 L100 24 V108';
export const JALUR_CANGKANG =
  'M0 0 V-60 C0 -74 12 -84 28 -84 C60 -84 82 -58 82 -26 V-10 C82 -4 78 0 72 0 Z';
export const JALUR_KACA = 'M14 -60 V-14 H70';
export const JALUR_PET = 'M6 -70 L-6 -76';
const JALUR_TALI = 'M95 98 C103 90 120 92 118 116';

/** Tebal garis untuk logo besar dan logo kecil. */
const TEBAL_BESAR = {
  huruf: 14,
  cangkang: 18,
  pet: 28,
  tali: 8,
  kaca: 8,
} as const;

const TEBAL_KECIL = {
  huruf: 16,
  cangkang: 20,
  pet: 30,
  tali: 10,
  kaca: 8,
} as const;

export interface LogoProps {
  /** Tinggi logo dalam dp, bawaan 43. */
  height?: number;
}

export function Logo({ height = TINGGI_BAWAAN }: LogoProps): React.JSX.Element {
  const { colors } = useTheme();
  const lebar = (height * LEBAR_VIEW_BOX) / TINGGI_VIEW_BOX;
  const tebal = lebar >= 120 ? TEBAL_BESAR : TEBAL_KECIL;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel="M Delivery">
      <Svg width={lebar} height={height} viewBox={VIEW_BOX}>
        <Path
          d={JALUR_HURUF_M}
          fill="none"
          stroke={colors.logoM}
          strokeWidth={tebal.huruf}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d={JALUR_TALI}
          fill="none"
          stroke={colors.logoLine}
          strokeWidth={tebal.tali}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <G transform="translate(118 120) rotate(34) scale(.7)">
          <Path
            d={JALUR_CANGKANG}
            fill={colors.logoHelmet}
            stroke={colors.logoLine}
            strokeWidth={tebal.cangkang}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d={JALUR_KACA}
            fill="none"
            stroke={colors.logoVisor}
            strokeWidth={tebal.kaca}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d={JALUR_PET}
            fill="none"
            stroke={colors.logoLine}
            strokeWidth={tebal.pet}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </G>
      </Svg>
    </View>
  );
}
