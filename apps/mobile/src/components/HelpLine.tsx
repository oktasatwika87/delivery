/**
 * Baris bantuan di bawah tombol.
 *
 * Isinya ikon cloud off dan teks penjelas. Dipakai tombol dan kartu order
 * supaya cara menampilkan bantuan selalu sama.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '../theme/Icon';
import { colors, space, type } from '../theme/tokens';

const UKURAN_IKON = 16;

export interface HelpLineProps {
  text: string;
}

export function HelpLine({ text }: HelpLineProps): React.JSX.Element {
  return (
    <View style={styles.baris}>
      <Icon name="cloud_off" size={UKURAN_IKON} color={colors.textMuted} />
      <Text style={styles.teks}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  baris: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    marginTop: space[2],
    width: '100%',
  },
  teks: {
    ...type.bodySm,
    color: colors.textMuted,
    flexShrink: 1,
  },
});
