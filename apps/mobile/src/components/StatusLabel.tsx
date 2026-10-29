/**
 * Lencana status order.
 *
 * Teks label datang dari pemanggil, jadi tiap peran bisa memakai kalimatnya
 * sendiri. Status cuma menentukan warna isi, warna teks, dan ikon.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { OrderStatus } from '@delivery/shared';

import { Icon } from '../theme/Icon';
import type { IconName } from '../theme/icons';
import { colors, radius, space, type } from '../theme/tokens';

const TINGGI_LABEL = 26;
const UKURAN_IKON = 16;
const JARAK_IKON = 6;
const TEBAL_TEPI = 1.5;

interface GayaStatus {
  backgroundColor: string;
  color: string;
  icon: IconName;
  borderWidth: number;
}

const GAYA_STATUS: Record<OrderStatus, GayaStatus> = {
  ASSIGNED: {
    backgroundColor: colors.surface,
    color: colors.text,
    icon: 'search',
    borderWidth: TEBAL_TEPI,
  },
  PENDING: {
    backgroundColor: colors.fillNeutral,
    color: colors.text,
    icon: 'inventory_2',
    borderWidth: 0,
  },
  CONFIRMED: {
    backgroundColor: colors.fillNeutral,
    color: colors.text,
    icon: 'inventory_2',
    borderWidth: 0,
  },
  PREPARING: {
    backgroundColor: colors.fillNeutral,
    color: colors.text,
    icon: 'inventory_2',
    borderWidth: 0,
  },
  OUT_FOR_DELIVERY: {
    backgroundColor: colors.surfaceInverse,
    color: colors.textInverse,
    icon: 'two_wheeler',
    borderWidth: 0,
  },
  DELIVERED: {
    backgroundColor: colors.successSoft,
    color: colors.successStrong,
    icon: 'check_circle_fill',
    borderWidth: 0,
  },
  CANCELLED: {
    backgroundColor: colors.dangerSoft,
    color: colors.dangerStrong,
    icon: 'close',
    borderWidth: 0,
  },
};

export interface StatusLabelProps {
  status: OrderStatus;
  label: string;
}

export function StatusLabel({ status, label }: StatusLabelProps): React.JSX.Element {
  const gaya = GAYA_STATUS[status];

  return (
    <View
      style={[
        styles.wadah,
        {
          backgroundColor: gaya.backgroundColor,
          borderWidth: gaya.borderWidth,
          borderColor: colors.lineStrong,
        },
      ]}
    >
      <Icon name={gaya.icon} size={UKURAN_IKON} color={gaya.color} />
      <Text style={[styles.teks, { color: gaya.color }]}>{label}</Text>
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
