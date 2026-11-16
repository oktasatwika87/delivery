/**
 * Panel ringkasan hari ini.
 *
 * Komponen ini cuma tampilan: angkanya masuk sebagai angka, lalu diformat
 * di dalam supaya angkanya bisa bergulir saat berubah.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TextStyle } from 'react-native';
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

  const gayaAngka: TextStyle & { lineHeight: number } = {
    ...s.angka,
    color: colors.text,
  };

  return (
    <View style={s.panel}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <LinearGradient id={idGradasi} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.surfaceLift} />
          <Stop offset="1" stopColor={colors.surface} />
        </LinearGradient>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${idGradasi})`} />
      </Svg>
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
