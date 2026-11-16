/**
 * Baris bantuan di bawah tombol.
 *
 * Isinya ikon cloud off dan teks penjelas. Dipakai tombol dan kartu order
 * supaya cara menampilkan bantuan selalu sama.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '../theme/Icon';
import { perTema, useTheme } from '../theme/ThemeProvider';
import { size, space, type } from '../theme/tokens';

export interface HelpLineProps {
  text: string;
}

const gaya = perTema((c) =>
  StyleSheet.create({
    baris: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[1],
      marginTop: space[2],
      width: '100%',
    },
    teks: {
      ...type.bodySm,
      color: c.textMuted,
      flexShrink: 1,
    },
  }),
);

export function HelpLine({ text }: HelpLineProps): React.JSX.Element {
  const { name, colors } = useTheme();
  const s = gaya[name];

  return (
    <View style={s.baris}>
      <Icon name="cloud_off" size={size.iconXs} color={colors.textMuted} />
      <Text style={s.teks}>{text}</Text>
    </View>
  );
}
