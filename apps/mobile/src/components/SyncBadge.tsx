/**
 * Lencana status sinkronisasi.
 *
 * Menampilkan bahwa perubahan lokal belum sampai ke server, jadi pengguna
 * tahu kalau masih antre.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Icon } from '../theme/Icon';
import type { IconName } from '../theme/icons';
import { colors, radius, space, type } from '../theme/tokens';

const TINGGI_LABEL = 26;
const UKURAN_IKON = 16;
const JARAK_IKON = 6;
const TEBAL_TEPI = 1.5;

export type SyncState = 'pending' | 'stale';

interface GayaState {
  text: string;
  backgroundColor: string;
  color: string;
  icon: IconName;
  borderWidth: number;
  borderStyle: 'solid' | 'dashed';
  borderColor: string;
}

const GAYA_STATE: Record<SyncState, GayaState> = {
  pending: {
    text: 'Menunggu sinkronisasi',
    backgroundColor: colors.surface,
    color: colors.text,
    icon: 'cloud_upload',
    borderWidth: TEBAL_TEPI,
    borderStyle: 'dashed',
    borderColor: colors.text,
  },
  stale: {
    text: 'Belum tersinkron dari sejam lalu',
    backgroundColor: colors.warningSoft,
    color: colors.warning,
    icon: 'history',
    borderWidth: 0,
    borderStyle: 'solid',
    borderColor: colors.warning,
  },
};

export interface SyncBadgeProps {
  state: SyncState;
}

export function SyncBadge({ state }: SyncBadgeProps): React.JSX.Element {
  const gaya = GAYA_STATE[state];

  return (
    <View
      style={[
        styles.wadah,
        {
          backgroundColor: gaya.backgroundColor,
          borderWidth: gaya.borderWidth,
          borderStyle: gaya.borderStyle,
          borderColor: gaya.borderColor,
        },
      ]}
    >
      <Icon name={gaya.icon} size={UKURAN_IKON} color={gaya.color} />
      <Text style={[styles.teks, { color: gaya.color }]}>{gaya.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wadah: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: JARAK_IKON,
    height: TINGGI_LABEL,
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
  },
  teks: {
    ...type.labelSm,
  },
});
