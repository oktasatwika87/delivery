/**
 * Angka yang bergulir.
 *
 * Angka selalu tampil utuh sebagai satu teks, jadi lebar dan yang dibaca
 * pembaca layar tetap jelas. Saat nilainya berubah, digit yang berubah
 * bergulir di atas teks itu: bagian yang tidak berubah tetap diam, digit
 * yang berubah keluar dan masuk bergantian.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { motion } from '../../theme/tokens';
import { standardEasing } from './presets';
import { useInitialWindow } from './InitialWindow';

/** Bagian yang tetap diam, atau digit yang bergulir. */
export type RollSegment =
  | { kind: 'fixed'; text: string }
  | { kind: 'column'; from: string; to: string };

function isDigit(huruf: string): boolean {
  return huruf >= '0' && huruf <= '9';
}

/**
 * Membagi dua teks sepanjang sama jadi bagian tetap dan kolom digit.
 *
 * Karakter yang sama jadi bagian tetap. Dua digit yang berbeda jadi kolom
 * yang berisi digit lama dan digit baru. Perbedaan selain digit dianggap
 * tetap, memakai karakter yang baru.
 */
export function rollSegments(oldText: string, newText: string): RollSegment[] {
  if (oldText.length !== newText.length) {
    return [{ kind: 'fixed', text: newText }];
  }

  const hasil: RollSegment[] = [];
  let index = 0;
  while (index < oldText.length) {
    const beda = oldText[index] !== newText[index];
    if (beda && isDigit(oldText[index]) && isDigit(newText[index])) {
      hasil.push({ kind: 'column', from: oldText[index], to: newText[index] });
      index += 1;
      continue;
    }
    let teks = '';
    while (index < oldText.length) {
      const kolomBeda =
        oldText[index] !== newText[index] &&
        isDigit(oldText[index]) &&
        isDigit(newText[index]);
      if (kolomBeda) {
        break;
      }
      teks += newText[index];
      index += 1;
    }
    hasil.push({ kind: 'fixed', text: teks });
  }

  // Spasi di ujung bagian tetap sebelum kolom dipindah ke awal kolom, jadi
  // lebar lapisan tidak bergantung pada cara tiap platform mengukur spasi
  // di ujung teks.
  for (let nomor = 0; nomor < hasil.length - 1; nomor += 1) {
    const bagian = hasil[nomor];
    const berikutnya = hasil[nomor + 1];
    if (bagian.kind !== 'fixed' || berikutnya.kind !== 'column') {
      continue;
    }
    const tanpaSpasi = bagian.text.replace(/ +$/, '');
    const spasi = bagian.text.slice(tanpaSpasi.length);
    if (spasi.length === 0) {
      continue;
    }
    hasil[nomor] = { kind: 'fixed', text: tanpaSpasi };
    hasil[nomor + 1] = {
      kind: 'column',
      from: spasi + berikutnya.from,
      to: spasi + berikutnya.to,
    };
  }

  return hasil;
}

interface Gulungan {
  nomor: number;
  dari: string;
  ke: string;
  naik: boolean;
  segmen: RollSegment[];
}

interface KolomDigitProps {
  from: string;
  to: string;
  lineHeight: number;
  naik: boolean;
  progres: SharedValue<number>;
  style: TextStyle;
}

/**
 * Satu digit yang bergulir.
 *
 * Digit lama dan digit baru bertumpuk, lalu digeser satu tinggi baris.
 * Naik berarti digit lama keluar ke atas dan digit baru masuk dari bawah.
 */
function KolomDigit({
  from,
  to,
  lineHeight,
  naik,
  progres,
  style,
}: KolomDigitProps): React.JSX.Element {
  const gaya = useAnimatedStyle(() => {
    const dari = naik ? 0 : -lineHeight;
    const ke = naik ? -lineHeight : 0;
    return {
      transform: [{ translateY: dari + (ke - dari) * progres.value }],
    };
  });

  const atas = naik ? from : to;
  const bawah = naik ? to : from;

  return (
    <View style={[styles.kolom, { height: lineHeight }]}>
      <Animated.View style={gaya}>
        <Text style={style}>{atas}</Text>
        <Text style={style}>{bawah}</Text>
      </Animated.View>
    </View>
  );
}

interface LapisanGulungProps {
  gulungan: Gulungan;
  lineHeight: number;
  style: TextStyle;
  /** Dipanggil kalau gulungan ini selesai, dengan nomornya. */
  onSelesai: (nomor: number) => void;
}

/**
 * Lapisan yang menggambar digit yang bergulir.
 *
 * Tiap gulungan punya lapisan sendiri dengan nilai progres sendiri, jadi
 * gulungan yang baru mulai tidak mewarisi nilai gulungan sebelumnya.
 */
function LapisanGulung({
  gulungan,
  lineHeight,
  style,
  onSelesai,
}: LapisanGulungProps): React.JSX.Element {
  const progres = useSharedValue(0);

  useEffect(() => {
    progres.value = withTiming(
      1,
      { duration: motion.duration.rollNumber, easing: standardEasing },
      (selesai) => {
        if (selesai) {
          runOnJS(onSelesai)(gulungan.nomor);
        }
      },
    );
  }, [progres, onSelesai, gulungan.nomor]);

  return (
    <View
      style={styles.lapisan}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {gulungan.segmen.map((segmen, nomor) =>
        segmen.kind === 'fixed' ? (
          <Text key={nomor} style={style}>
            {segmen.text}
          </Text>
        ) : (
          <KolomDigit
            key={nomor}
            from={segmen.from}
            to={segmen.to}
            lineHeight={lineHeight}
            naik={gulungan.naik}
            progres={progres}
            style={style}
          />
        ),
      )}
    </View>
  );
}

interface RollingNumberProps {
  /** Nilai yang ditampilkan, bilangan bulat tidak negatif. */
  value: number;
  /** Cara nilai jadi teks. */
  format?: (value: number) => string;
  /** Gaya teks, harus punya lineHeight. */
  style: TextStyle & { lineHeight: number };
}

export function RollingNumber({
  value,
  format = String,
  style,
}: RollingNumberProps): React.JSX.Element {
  const dalamJendela = useInitialWindow();
  const kurangiGerak = useReducedMotion();
  const teks = format(value);
  const lineHeight = style.lineHeight;

  const [sebelumnya, setSebelumnya] = useState({ nilai: value, teks });
  const [gulungan, setGulungan] = useState<Gulungan | null>(null);
  const nomorGulungan = useRef(0);

  // Perubahan nilai dihitung saat render, jadi tidak ada satu render yang
  // masih menampilkan angka lama padahal nilainya sudah baru.
  if (sebelumnya.teks !== teks) {
    setSebelumnya({ nilai: value, teks });
    const panjangSama = sebelumnya.teks.length === teks.length;
    const bolehGulung = !dalamJendela && !kurangiGerak && panjangSama;
    nomorGulungan.current += 1;
    setGulungan(
      bolehGulung
        ? {
            nomor: nomorGulungan.current,
            dari: sebelumnya.teks,
            ke: teks,
            naik: value > sebelumnya.nilai,
            segmen: rollSegments(sebelumnya.teks, teks),
          }
        : null,
    );
  }

  // Gulungan yang selesai cuma menutup gulungan yang nomornya masih sama,
  // jadi lapisan lama yang sempat selesai tidak menutup gulungan berikutnya.
  const selesaiGulung = useCallback((nomor: number) => {
    setGulungan((sekarang) =>
      sekarang !== null && sekarang.nomor === nomor ? null : sekarang,
    );
  }, []);

  const gayaTeks: TextStyle = {
    ...style,
    fontVariant: ['tabular-nums'],
  };

  return (
    <View>
      <Text style={[gayaTeks, gulungan ? { color: 'transparent' } : null]}>
        {teks}
      </Text>
      {gulungan ? (
        <LapisanGulung
          key={gulungan.nomor}
          gulungan={gulungan}
          lineHeight={lineHeight}
          style={gayaTeks}
          onSelesai={selesaiGulung}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lapisan: {
    position: 'absolute',
    top: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  kolom: {
    overflow: 'hidden',
  },
});
