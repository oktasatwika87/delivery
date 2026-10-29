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
import { colors, radius, space, type } from '../theme/tokens';

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

export function EmptyState({
  icon,
  title,
  body,
  action,
}: EmptyStateProps): React.JSX.Element {
  return (
    <View style={styles.wadah}>
      <View style={styles.lingkaran}>
        <Icon name={icon} size={UKURAN_IKON} color={colors.text} />
      </View>
      <Text style={styles.judul}>{title}</Text>
      {body ? <Text style={styles.isi}>{body}</Text> : null}
      {action ? (
        <Button title={action.title} onPress={action.onPress} variant="primary" size="md" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wadah: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[3],
    paddingTop: space[8],
    paddingHorizontal: space[6],
  },
  lingkaran: {
    width: UKURAN_LINGKARAN,
    height: UKURAN_LINGKARAN,
    borderRadius: radius.full,
    backgroundColor: colors.fillNeutral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  judul: {
    ...type.titleMd,
    color: colors.text,
    textAlign: 'center',
  },
  isi: {
    ...type.body,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: LEBAR_ISI,
  },
});
