/**
 * Panel ringkasan hari ini.
 *
 * Komponen ini cuma tampilan: angkanya masuk sebagai teks yang sudah
 * diformat. Panelnya belum dipasang di layar mana pun.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { LinearGradient, Rect, Stop } from 'react-native-svg';

import { perTema, useTheme } from '../theme/ThemeProvider';
import { radius, space, stroke, type } from '../theme/tokens';

const PADDING_ATAS = 14;

/** Id gradasi dibuat unik supaya dua panel tidak saling menimpa. */
let hitungan = 0;

export interface DaySummaryProps {
  /** Teks kiri, misalnya "3 selesai". */
  doneText: string;
  /** Teks kanan, misalnya "Rp 120.000". */
  cashText: string;
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

export function DaySummary({ doneText, cashText }: DaySummaryProps): React.JSX.Element {
  const { name, colors } = useTheme();
  const s = gaya[name];
  const [idGradasi] = useState(() => `gradasi-ringkasan-${hitungan++}`);

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
        <Text style={s.angka}>{doneText}</Text>
      </View>
      <View style={s.kolomKanan}>
        <Text style={s.label}>Tunai tercatat</Text>
        <Text style={s.angka}>{cashText}</Text>
      </View>
    </View>
  );
}
