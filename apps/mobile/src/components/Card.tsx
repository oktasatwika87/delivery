/**
 * Kartu kosong.
 *
 * Wadah dengan gaya kartu yang sama untuk semua tema. Dipakai kartu-kartu
 * di layar Detail order driver.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';

import { perTema, useTheme } from '../theme/ThemeProvider';
import { elevation, radius, space, stroke } from '../theme/tokens';

export interface CardProps {
  children: React.ReactNode;
  accessibilityLabel?: string;
}

const gaya = perTema((c) =>
  StyleSheet.create({
    kartu: {
      backgroundColor: c.surface,
      borderRadius: radius.xl2,
      borderWidth: stroke.hairline,
      borderColor: c.lineCard,
      borderTopColor: c.edgeHighlight,
      padding: space[4],
    },
  }),
);

export function Card({ children, accessibilityLabel }: CardProps): React.JSX.Element {
  const { name } = useTheme();
  const s = gaya[name];
  // Tema terang pakai elevasi, tema gelap ambil kedalaman dari warnanya.
  const bayangan = name === 'terang' ? { elevation: elevation.card } : null;

  return (
    <View accessibilityLabel={accessibilityLabel} style={[s.kartu, bayangan]}>
      {children}
    </View>
  );
}
