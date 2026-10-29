/**
 * Komponen logo M Delivery.
 *
 * Bentuknya diambil dari logo desain dan digambar sebagai svg, jadi tidak
 * butuh berkas gambar. Lebar selalu dihitung dari tinggi supaya proporsinya
 * tidak berubah kalau ukurannya diganti.
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Polygon } from 'react-native-svg';

import { colors } from './tokens';

const VIEW_BOX = '0 -22 176 144';
const LEBAR_VIEW_BOX = 176;
const TINGGI_VIEW_BOX = 144;
const TINGGI_BAWAAN = 32;

const TITIK_HURUF_M =
  '0,100 0,0 24,0 50,52 76,0 100,0 100,100 78,100 78,42 58,82 42,82 22,42 22,100';
const JALUR_HURUF_D =
  'M58 -22H118A58 72 0 0 1 118 122H62V84H74V104H118A36 54 0 0 0 118 -4H70V8H58Z';

export type LogoVariant = 'default' | 'inverse';

export interface LogoProps {
  /** Varian warna logo, bawaan default. */
  variant?: LogoVariant;
  /** Tinggi logo dalam dp, bawaan 32. */
  height?: number;
}

export function Logo({
  variant = 'default',
  height = TINGGI_BAWAAN,
}: LogoProps): React.JSX.Element {
  const inverse = variant === 'inverse';
  const warnaM = inverse ? colors.textInverse : colors.text;
  const warnaD = inverse ? colors.brandRedInverse : colors.brandRed;
  const lebar = (height * LEBAR_VIEW_BOX) / TINGGI_VIEW_BOX;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel="M Delivery">
      <Svg width={lebar} height={height} viewBox={VIEW_BOX}>
        <Polygon points={TITIK_HURUF_M} fill={warnaM} />
        <Path d={JALUR_HURUF_D} fill={warnaD} />
      </Svg>
    </View>
  );
}
