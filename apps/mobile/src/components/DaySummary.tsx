/**
 * Panel ringkasan hari ini.
 *
 * Komponen ini cuma tampilan: angkanya masuk sebagai angka, lalu diformat
 * di dalam supaya angkanya bisa bergulir saat berubah.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent, TextStyle } from 'react-native';
import Svg, { LinearGradient, Rect, Stop } from 'react-native-svg';

import { formatCurrency } from '../formatCurrency';
import { perTema, useTheme } from '../theme/ThemeProvider';
import { radius, space, stroke, type } from '../theme/tokens';
import { RollingNumber } from './motion/RollingNumber';

const PADDING_ATAS = 14;

/** Id gradasi dibuat unik supaya dua panel tidak saling menimpa. */
let hitungan = 0;

export interface DaySummaryProps {
  /** Jumlah order yang selesai hari ini. */
  doneCount: number;
  /** Jumlah tunai yang tercatat hari ini. */
  cashAmount: number;
  /** Mata uang tunai, misalnya "IDR". */
  currency: string;
}

/** Teks jumlah order selesai. */
export function formatSelesai(count: number): string {
  return `${count} selesai`;
}

/** Teks jumlah tunai tercatat. */
export function formatTunai(amount: number, currency: string): string {
  return formatCurrency(amount, currency);
}

const gaya = perTema((c) =>
  StyleSheet.create({
    panel: {
      flexDirection: 'row',
      borderRadius: radius.xl2,
      borderWidth: stroke.hairline,
      borderColor: c.lineCard,
      borderTopColor: c.edgeHighlight,
      paddingVertical: PADDING_ATAS,
      paddingHorizontal: space[4],
      overflow: 'hidden',
      // Warna ujung bawah gradasi, jadi bingkai pertama sebelum panel diukur
      // tidak tembus ke latar layar.
      backgroundColor: c.surface,
    },
    kolomKiri: {
      flex: 1,
      gap: 2,
    },
    kolomKanan: {
      flex: 1,
      gap: 2,
      paddingLeft: space[4],
      borderLeftWidth: stroke.hairline,
      borderLeftColor: c.line,
    },
    label: {
      ...type.bodyXs,
      color: c.textSubtle,
    },
    angka: {
      ...type.stat,
      color: c.text,
    },
  }),
);

export function DaySummary({
  doneCount,
  cashAmount,
  currency,
}: DaySummaryProps): React.JSX.Element {
  const { name, colors } = useTheme();
  const s = gaya[name];
  const [idGradasi] = useState(() => `gradasi-ringkasan-${hitungan++}`);
  // Ukuran panel, diisi dari event layout. Gradasi butuh ukuran angka, kalau
  // pakai persen di Android gradasinya berhenti sebelum tepi panel.
  const [ukuran, setUkuran] = useState<{ lebar: number; tinggi: number } | null>(null);

  const saatTerukur = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setUkuran((sebelumnya) =>
      sebelumnya !== null &&
      sebelumnya.lebar === width &&
      sebelumnya.tinggi === height
        ? sebelumnya
        : { lebar: width, tinggi: height },
    );
  }, []);

  const gayaAngka: TextStyle & { lineHeight: number } = {
    ...s.angka,
    color: colors.text,
  };

  return (
    <View style={s.panel} testID="panel-ringkasan" onLayout={saatTerukur}>
      {ukuran ? (
        <Svg style={StyleSheet.absoluteFill} width={ukuran.lebar} height={ukuran.tinggi}>
          <LinearGradient id={idGradasi} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.surfaceLift} />
            <Stop offset="1" stopColor={colors.surface} />
          </LinearGradient>
          <Rect
            x="0"
            y="0"
            width={ukuran.lebar}
            height={ukuran.tinggi}
            fill={`url(#${idGradasi})`}
          />
        </Svg>
      ) : null}
      <View style={s.kolomKiri}>
        <Text style={s.label}>Hari ini</Text>
        <RollingNumber value={doneCount} format={formatSelesai} style={gayaAngka} />
      </View>
      <View style={s.kolomKanan}>
        <Text style={s.label}>Tunai tercatat</Text>
        <RollingNumber
          value={cashAmount}
          format={(nilai) => formatTunai(nilai, currency)}
          style={gayaAngka}
        />
      </View>
    </View>
  );
}
