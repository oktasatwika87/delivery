/**
 * Tampilan layar yang belum ada isinya.
 *
 * Dipakai kalau daftar atau detail masih kosong, supaya pengguna tahu apa
 * yang harus dilakukan berikutnya.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { Icon } from '../theme/Icon';
import type { IconName } from '../theme/icons';
import { perTema, useTheme } from '../theme/ThemeProvider';
import { radius, space, type } from '../theme/tokens';

const UKURAN_LINGKARAN = 64;
const UKURAN_IKON = 32;
const LEBAR_ISI = 280;

export interface EmptyStateAction {
  title: string;
  onPress: () => void;
}

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  body?: string;
  action?: EmptyStateAction;
}

const gaya = perTema((c) =>
  StyleSheet.create({
    wadah: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: space[2],
      paddingTop: space[8],
      paddingHorizontal: space[6],
    },
    lingkaran: {
      width: UKURAN_LINGKARAN,
      height: UKURAN_LINGKARAN,
      borderRadius: radius.full,
      backgroundColor: c.fillNeutral,
      alignItems: 'center',
      justifyContent: 'center',
    },
    judul: {
      ...type.titleMd,
      color: c.text,
      textAlign: 'center',
    },
    isi: {
      ...type.body,
      color: c.textMuted,
      textAlign: 'center',
      maxWidth: LEBAR_ISI,
    },
  }),
);

export function EmptyState({
  icon,
  title,
  body,
  action,
}: EmptyStateProps): React.JSX.Element {
  const { name, colors } = useTheme();
  const s = gaya[name];

  return (
    <View style={s.wadah}>
      <View style={s.lingkaran}>
        <Icon name={icon} size={UKURAN_IKON} color={colors.text} />
      </View>
      <Text style={s.judul}>{title}</Text>
      {body ? <Text style={s.isi}>{body}</Text> : null}
      {action ? (
        <Button title={action.title} onPress={action.onPress} variant="primary" size="md" />
      ) : null}
    </View>
  );
}
