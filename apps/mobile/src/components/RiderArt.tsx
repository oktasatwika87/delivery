/**
 * Gambar orang naik motor.
 *
 * Gambar dekoratif di kiri atas lembar konfirmasi. Gambarnya digambar
 * sebagai svg, jadi tidak butuh berkas gambar, dan ukurannya tetap supaya
 * tempatnya tidak bergeser.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import { JALUR_CANGKANG, JALUR_KACA, JALUR_PET } from '../theme/Logo';
import { useTheme } from '../theme/ThemeProvider';

/** Area gambar dalam satuan viewBox. */
const VIEW_BOX = '0 -8 160 104';
const LEBAR_VIEW_BOX = 160;
const TINGGI_VIEW_BOX = 104;
/** Jarak paling atas gambar dari titik asal viewBox. */
const ATAS_VIEW_BOX = 8;
/** Skala gambar dari satuan viewBox ke dp. */
const SKALA = 122 / LEBAR_VIEW_BOX;

/**
 * Ukuran gambar dan titik penting di dalamnya.
 *
 * Semua angka dihitung dari satuan viewBox, jadi ukurannya tetap dan
 * posisinya bisa dipakai komponen lain untuk menaruh gambar tepat.
 */
export const UKURAN_RIDER = {
  skala: SKALA,
  lebar: 122,
  tinggi: TINGGI_VIEW_BOX * SKALA,
  dasarRodaY: (76 + 12 + ATAS_VIEW_BOX) * SKALA,
  ujungRodaDepanX: 124 * SKALA,
  jariJariRoda: 12 * SKALA,
} as const;

/** Tebal garis gambar utama. */
const TEBAL_GARIS = 4;
/** Tebal cangkang helm. */
const TEBAL_CANGKANG = 13.33;
/** Tebal kaca helm. */
const TEBAL_KACA = 8;
/** Tebal pet helm. */
const TEBAL_PET = 20;
/** Tebal jari-jari roda. */
const TEBAL_JARI = 2.5;
/** Bentuk jari-jari roda. */
const JALUR_JARI = 'M0 -9 V9 M-9 0 H9';
/** Ukuran gambar jari-jari roda dalam satuan viewBox. */
const UKURAN_JARI = 24;

/** Tutup kotak barang di belakang orang. */
const JALUR_KOTAK = 'M18 36 H48';
/** Badan motor dan orangnya. */
const JALUR_BADAN =
  'M22 70 C20 58 28 50 42 50 H74 C79 55 78 67 70 72 H100 C104 62 108 48 112 38 M106 36 H122 M112 40 L124 76';
/** Orang yang naik motor. */
const JALUR_ORANG = 'M64 46 L74 22 M74 24 C86 30 98 34 114 36 M64 46 L84 48 L88 70';

/** Posisi kedua roda dalam satuan viewBox. */
const RODA: { x: number; y: number }[] = [
  { x: 40, y: 76 },
  { x: 124, y: 76 },
];

export function RiderArt(): React.JSX.Element {
  const { colors } = useTheme();

  return (
    <View
      testID="gambar-motor"
      style={styles.akar}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg
        width={UKURAN_RIDER.lebar}
        height={UKURAN_RIDER.tinggi}
        viewBox={VIEW_BOX}
      >
        <G
          fill="none"
          stroke={colors.textMuted}
          strokeWidth={TEBAL_GARIS}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <Rect x={18} y={28} width={30} height={22} rx={5} />
          <Path d={JALUR_KOTAK} />
          <Path d={JALUR_BADAN} />
          <Path d={JALUR_ORANG} />
          {RODA.map((roda) => (
            <Circle key={`roda-${roda.x}`} cx={roda.x} cy={roda.y} r={12} />
          ))}
        </G>
        <G transform="translate(86 21) scale(-.3 .3)">
          <Path
            d={JALUR_CANGKANG}
            fill={colors.accent}
            stroke={colors.accent}
            strokeWidth={TEBAL_CANGKANG}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d={JALUR_KACA}
            fill="none"
            stroke={colors.logoVisor}
            strokeWidth={TEBAL_KACA}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path
            d={JALUR_PET}
            fill="none"
            stroke={colors.accent}
            strokeWidth={TEBAL_PET}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </G>
      </Svg>
      {RODA.map((roda) => (
        <View
          key={`jari-${roda.x}`}
          style={[
            styles.jari,
            {
              left: roda.x * SKALA - UKURAN_RIDER.jariJariRoda,
              top: (roda.y + ATAS_VIEW_BOX) * SKALA - UKURAN_RIDER.jariJariRoda,
            },
          ]}
        >
          <Svg
            width={UKURAN_JARI * SKALA}
            height={UKURAN_JARI * SKALA}
            viewBox="-12 -12 24 24"
          >
            <Path
              d={JALUR_JARI}
              fill="none"
              stroke={colors.textMuted}
              strokeWidth={TEBAL_JARI}
              strokeLinecap="round"
            />
          </Svg>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  akar: {
    width: UKURAN_RIDER.lebar,
    height: UKURAN_RIDER.tinggi,
  },
  jari: {
    position: 'absolute',
  },
});
