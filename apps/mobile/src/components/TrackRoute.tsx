/**
 * Rute langkah order.
 *
 * Menempatkan order di antara empat langkah yang dihubungkan lewat satu rute
 * melengkung. Yang digambar di sini diam: rel, progres, riak, titik, dan
 * motor.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { Icon } from '../theme/Icon';
import { useTheme } from '../theme/ThemeProvider';
import { size, stroke, type ThemeColors } from '../theme/tokens';

/** Langkah order di rute. Null berarti order dibatalkan. */
export type LangkahRute = 1 | 2 | 3 | 4 | null;

interface Titik {
  x: number;
  y: number;
}

/** Ukuran gambar dalam satuan viewBox. */
const LEBAR_VB = 360;
const TINGGI_VB = 88;

/** Empat titik rute, dari awal sampai akhir. */
const TITIK: Titik[] = [
  { x: 45, y: 52 },
  { x: 135, y: 32 },
  { x: 225, y: 60 },
  { x: 315, y: 38 },
];

/** Tiga lengkung kubik, masing-masing dari satu titik ke titik berikutnya. */
const LENGKUNG: Titik[][] = [
  [TITIK[0], { x: 80, y: 52 }, { x: 100, y: 30 }, TITIK[1]],
  [TITIK[1], { x: 172, y: 34 }, { x: 190, y: 62 }, TITIK[2]],
  [TITIK[2], { x: 260, y: 58 }, { x: 280, y: 36 }, TITIK[3]],
];

/** Jumlah potong garis lurus per lengkung saat panjangnya dihitung. */
const POTONG = 64;

/** Titik pada lengkung kubik untuk nilai t tertentu. */
function titikKubik(
  awal: Titik,
  kendali1: Titik,
  kendali2: Titik,
  akhir: Titik,
  t: number,
): Titik {
  const u = 1 - t;
  return {
    x:
      u * u * u * awal.x +
      3 * u * u * t * kendali1.x +
      3 * u * t * t * kendali2.x +
      t * t * t * akhir.x,
    y:
      u * u * u * awal.y +
      3 * u * u * t * kendali1.y +
      3 * u * t * t * kendali2.y +
      t * t * t * akhir.y,
  };
}

/** Panjang satu lengkung, dihitung dari potong garis lurus. */
function panjangLengkung(lengkung: Titik[]): number {
  let total = 0;
  let sebelumnya = titikKubik(
    lengkung[0],
    lengkung[1],
    lengkung[2],
    lengkung[3],
    0,
  );
  for (let i = 1; i <= POTONG; i += 1) {
    const sekarang = titikKubik(
      lengkung[0],
      lengkung[1],
      lengkung[2],
      lengkung[3],
      i / POTONG,
    );
    total += Math.hypot(sekarang.x - sebelumnya.x, sekarang.y - sebelumnya.y);
    sebelumnya = sekarang;
  }
  return total;
}

/** Panjang tiap lengkung, dihitung sekali saat modul dimuat. */
export const PANJANG_LENGKUNG = LENGKUNG.map(panjangLengkung);

/** Panjang dari titik pertama sampai tiap titik berikutnya. */
export const PANJANG_SAMPAI = PANJANG_LENGKUNG.reduce<number[]>(
  (daftar, panjang) => {
    const sebelumnya = daftar.length === 0 ? 0 : daftar[daftar.length - 1];
    return [...daftar, sebelumnya + panjang];
  },
  [],
);

/** Panjang seluruh rute. */
export const PANJANG_TOTAL = PANJANG_SAMPAI[PANJANG_SAMPAI.length - 1];

/** Jalur rute, dibangun dari data lengkung. */
export const JALUR = `M${TITIK[0].x} ${TITIK[0].y} ${LENGKUNG.map(
  (lengkung) =>
    `C${lengkung[1].x} ${lengkung[1].y} ${lengkung[2].x} ${lengkung[2].y} ${lengkung[3].x} ${lengkung[3].y}`,
).join(' ')}`;

/** Diameter motor, tidak ikut skala gambar. */
const UKURAN_MOTOR = 36;
/** Jari-jari titik langkah. */
const RADIUS_TITIK = 7;
/** Tebal tepi titik langkah. */
const TEBAL_TITIK = 3;
/** Jari-jari riak pertama dan kedua. */
const RADIUS_RIAK = [15, 24];
/** Transparansi riak pertama dan kedua. */
const OPASITAS_RIAK = [0.5, 0.22];

export interface TrackRouteProps {
  /** Langkah order sekarang. Null berarti order dibatalkan. */
  langkah: LangkahRute;
}

/**
 * Warna isi dan tepi satu titik langkah.
 *
 * Titik yang sudah dilewati warnanya biru, titik yang belum dilewati warnanya
 * gelap, kecuali titik terakhir yang tepinya tetap biru.
 */
function warnaTitik(
  nomor: number,
  langkah: LangkahRute,
  colors: ThemeColors,
): { fill: string; stroke: string } {
  if (langkah === null) {
    return nomor === 1
      ? { fill: colors.info, stroke: colors.info }
      : { fill: colors.header, stroke: colors.rail };
  }
  if (nomor <= langkah) {
    return { fill: colors.info, stroke: colors.info };
  }
  if (nomor === 4) {
    return { fill: colors.header, stroke: colors.info };
  }
  return { fill: colors.header, stroke: colors.rail };
}

export function TrackRoute({ langkah }: TrackRouteProps): React.JSX.Element {
  const { colors } = useTheme();
  const [lebar, setLebar] = useState(0);

  const ukur = useCallback((event: LayoutChangeEvent) => {
    setLebar(event.nativeEvent.layout.width);
  }, []);

  const skala = lebar / LEBAR_VB;
  const tinggi = (lebar * TINGGI_VB) / LEBAR_VB;
  const langkahMotor = langkah !== null && langkah >= 2 ? langkah : null;
  const titikMotor = langkahMotor ? TITIK[langkahMotor - 1] : null;

  return (
    <View
      testID="rute-status"
      onLayout={ukur}
      style={styles.wadah}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {lebar > 0 ? (
        <>
          <Svg width={lebar} height={tinggi} viewBox={`0 0 ${LEBAR_VB} ${TINGGI_VB}`}>
            <Path
              d={JALUR}
              fill="none"
              stroke={colors.rail}
              strokeWidth={stroke.route}
              strokeLinecap="round"
            />
            {langkah !== null && langkah >= 2 ? (
              <Path
                d={JALUR}
                fill="none"
                stroke={colors.info}
                strokeWidth={stroke.route}
                strokeLinecap="round"
                strokeDasharray={[PANJANG_SAMPAI[langkah - 2], PANJANG_TOTAL]}
              />
            ) : null}
            {langkah === 1
              ? RADIUS_RIAK.map((radius, urutan) => (
                  <Circle
                    key={`riak-${urutan}`}
                    cx={TITIK[3].x}
                    cy={TITIK[3].y}
                    r={radius}
                    fill="none"
                    stroke={colors.info}
                    strokeWidth={stroke.ring}
                    opacity={OPASITAS_RIAK[urutan]}
                  />
                ))
              : null}
            {TITIK.map((titik, urutan) => {
              const warna = warnaTitik(urutan + 1, langkah, colors);
              return (
                <Circle
                  key={`titik-${urutan}`}
                  cx={titik.x}
                  cy={titik.y}
                  r={RADIUS_TITIK}
                  fill={warna.fill}
                  stroke={warna.stroke}
                  strokeWidth={TEBAL_TITIK}
                />
              );
            })}
          </Svg>
          {titikMotor ? (
            <View
              testID="motor-rute"
              style={[
                styles.motor,
                {
                  left: titikMotor.x * skala - UKURAN_MOTOR / 2,
                  top: titikMotor.y * skala - UKURAN_MOTOR / 2,
                  backgroundColor: colors.info,
                },
              ]}
            >
              <Icon name="two_wheeler" size={size.iconMd} color={colors.onInfoFill} />
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wadah: {
    aspectRatio: LEBAR_VB / TINGGI_VB,
  },
  motor: {
    position: 'absolute',
    width: UKURAN_MOTOR,
    height: UKURAN_MOTOR,
    borderRadius: UKURAN_MOTOR / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
