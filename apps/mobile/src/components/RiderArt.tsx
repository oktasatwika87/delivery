/**
 * Gambar orang naik motor.
 *
 * Gambar dekoratif di kiri atas lembar konfirmasi. Gambarnya digambar
 * sebagai svg, jadi tidak butuh berkas gambar, dan ukurannya tetap supaya
 * tempatnya tidak bergeser.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
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

export interface RiderArtProps {
  /** Pergeseran gambar dari posisi diam, positif ke kanan. */
  geser?: SharedValue<number>;
  /** Arah hadap gambar: 1 ke kanan, -1 ke kiri. */
  arah?: SharedValue<number>;
}

/**
 * Sudut putaran roda dalam derajat.
 *
 * Pergeseran gambar dibagi jari-jari roda jadi radian putaran, lalu diubah
 * jadi derajat. Kalau gambar dicerminkan, putaran yang sama terlihat terbalik,
 * jadi tandanya dibalik supaya roda di layar selalu berputar searah jalannya.
 */
export function sudutRoda(geser: number, arah: number): number {
  'worklet';
  const sudut = (geser / UKURAN_RIDER.jariJariRoda) * (180 / Math.PI);
  return arah < 0 ? -sudut : sudut;
}

interface JariRodaProps {
  roda: { x: number; y: number };
  geser: SharedValue<number>;
  arah: SharedValue<number>;
  warna: string;
}

/** Satu jari-jari roda, berputar mengikuti pergeseran gambar. */
function JariRoda({ roda, geser, arah, warna }: JariRodaProps): React.JSX.Element {
  const gaya = useAnimatedStyle(() => ({
    transform: [{ rotate: `${sudutRoda(geser.value, arah.value)}deg` }],
  }));

  return (
    <Animated.View
      style={[
        styles.jari,
        {
          left: roda.x * SKALA - UKURAN_RIDER.jariJariRoda,
          top: (roda.y + ATAS_VIEW_BOX) * SKALA - UKURAN_RIDER.jariJariRoda,
        },
        gaya,
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
          stroke={warna}
          strokeWidth={TEBAL_JARI}
          strokeLinecap="round"
        />
      </Svg>
    </Animated.View>
  );
}

export function RiderArt({ geser, arah }: RiderArtProps = {}): React.JSX.Element {
  const { colors } = useTheme();
  const geserBawaan = useSharedValue(0);
  const arahBawaan = useSharedValue(1);
  const nilaiGeser = geser ?? geserBawaan;
  const nilaiArah = arah ?? arahBawaan;

  const gayaGerak = useAnimatedStyle(() => ({
    transform: [
      { translateX: nilaiGeser.value },
      { scaleX: nilaiArah.value },
    ],
  }));

  return (
    <Animated.View
      testID="gambar-motor"
      style={[styles.akar, gayaGerak]}
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
        <JariRoda
          key={`jari-${roda.x}`}
          roda={roda}
          geser={nilaiGeser}
          arah={nilaiArah}
          warna={colors.textMuted}
        />
      ))}
    </Animated.View>
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
