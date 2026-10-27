/**
 * Komponen ikon.
 *
 * Path ikon diambil dari Material Symbols gaya Rounded, berat 500, yang
 * sudah disalin ke src/theme/icons.ts. Komponen ini cuma membungkus
 * path itu jadi gambar svg yang bisa diberi warna dan ukuran.
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { iconPaths, type IconName } from './icons';
import { colors, size } from './tokens';

export interface IconProps {
  /** Nama ikon, harus salah satu kunci iconPaths. */
  name: IconName;
  /** Sisi gambar dalam dp, bawaan 24. */
  size?: number;
  /** Warna isi ikon, bawaan warna teks. */
  color?: string;
  /** Label untuk pembaca layar. Tanpa label, ikon disembunyikan. */
  accessibilityLabel?: string;
}

export function Icon({
  name,
  size: ukuran = size.icon,
  color = colors.text,
  accessibilityLabel,
}: IconProps): React.JSX.Element {
  const data = iconPaths[name];
  const adaLabel = accessibilityLabel != null && accessibilityLabel !== '';

  return (
    <View
      accessible={adaLabel}
      accessibilityRole={adaLabel ? 'image' : undefined}
      accessibilityLabel={adaLabel ? accessibilityLabel : undefined}
      importantForAccessibility={adaLabel ? 'yes' : 'no-hide-descendants'}
    >
      <Svg width={ukuran} height={ukuran} viewBox={data.viewBox}>
        <Path d={data.d} fill={color} />
      </Svg>
    </View>
  );
}
