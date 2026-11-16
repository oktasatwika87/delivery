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
import { perTema, useTheme } from '../theme/ThemeProvider';
import { radius, size, type } from '../theme/tokens';

const UKURAN_IKON = size.iconSm;
const JARAK_IKON = 6;
const PADDING_SAMPING = 10;

interface NadaStatus {
  backgroundColor: string;
  color: string;
  icon: IconName;
}

const NADA_STATUS = perTema(
  (c): Record<OrderStatus, NadaStatus> => ({
    ASSIGNED: {
      backgroundColor: c.fillNeutral,
      color: c.text,
      icon: 'search',
    },
    PENDING: {
      backgroundColor: c.fillNeutral,
      color: c.text,
      icon: 'inventory_2',
    },
    CONFIRMED: {
      backgroundColor: c.fillNeutral,
      color: c.text,
      icon: 'inventory_2',
    },
    PREPARING: {
      backgroundColor: c.fillNeutral,
      color: c.text,
      icon: 'inventory_2',
    },
    OUT_FOR_DELIVERY: {
      backgroundColor: c.infoSoft,
      color: c.onInfoSoft,
      icon: 'two_wheeler',
    },
    DELIVERED: {
      backgroundColor: c.accentSoft,
      color: c.onAccentSoft,
      icon: 'check_circle',
    },
    CANCELLED: {
      backgroundColor: c.dangerSoft,
      color: c.danger,
      icon: 'cancel',
    },
  }),
);

export interface StatusLabelProps {
  status: OrderStatus;
  label: string;
}

export function StatusLabel({ status, label }: StatusLabelProps): React.JSX.Element {
  const { name } = useTheme();
  const nada = NADA_STATUS[name][status];

  return (
    <View
      style={[
        styles.wadah,
        {
          backgroundColor: nada.backgroundColor,
        },
      ]}
    >
      <Icon name={nada.icon} size={UKURAN_IKON} color={nada.color} />
      <Text style={[styles.teks, { color: nada.color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wadah: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: JARAK_IKON,
    height: size.status,
    paddingHorizontal: PADDING_SAMPING,
    borderRadius: radius.sm,
  },
  teks: {
    ...type.labelSm,
  },
});
