/**
 * Lencana status order.
 *
 * Teks label datang dari pemanggil, jadi tiap peran bisa memakai kalimatnya
 * sendiri. Status cuma menentukan warna isi, warna teks, dan ikon.
 */

import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { OrderStatus } from '@delivery/shared';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '../theme/Icon';
import type { IconName } from '../theme/icons';
import { perTema, useTheme } from '../theme/ThemeProvider';
import { motion, radius, size, type } from '../theme/tokens';
import { exitEasing, fadeIn } from './motion/presets';
import { useGantiIsi } from './motion/useGantiIsi';

const UKURAN_IKON = size.iconSm;
const JARAK_IKON = 6;
const PADDING_SAMPING = 10;

/** Masuk lapisan pil baru: pudar masuk tanpa geser. */
const MASUK_PIL = fadeIn();

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

interface IsiPilProps {
  status: OrderStatus;
  label: string;
}

function IsiPil({ status, label }: IsiPilProps): React.JSX.Element {
  const { name } = useTheme();
  const nada = NADA_STATUS[name][status];

  return (
    <>
      <Icon name={nada.icon} size={UKURAN_IKON} color={nada.color} />
      <Text style={[styles.teks, { color: nada.color }]}>{label}</Text>
    </>
  );
}

interface PilLamaProps {
  status: OrderStatus;
  label: string;
  /** Nomor pergantian yang sedang ditutup. */
  nomor: number;
  /** Dipanggil saat pil lama selesai pudar. */
  selesai: (nomor: number) => void;
}

function PilLama({ status, label, nomor, selesai }: PilLamaProps): React.JSX.Element {
  const { name } = useTheme();
  const nada = NADA_STATUS[name][status];
  const opasitas = useSharedValue(1);

  useEffect(() => {
    opasitas.value = withTiming(
      0,
      { duration: motion.duration.fadeOut, easing: exitEasing },
      (habis) => {
        if (habis) {
          runOnJS(selesai)(nomor);
        }
      },
    );
  }, [nomor, opasitas, selesai]);

  const gaya = useAnimatedStyle(() => ({ opacity: opasitas.value }));

  return (
    <Animated.View
      style={[
        styles.pilLama,
        { backgroundColor: nada.backgroundColor },
        gaya,
      ]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <IsiPil status={status} label={label} />
    </Animated.View>
  );
}

export function StatusLabel({ status, label }: StatusLabelProps): React.JSX.Element {
  const { name } = useTheme();
  const nada = NADA_STATUS[name][status];
  const ganti = useGantiIsi({ status, label }, `${status}|${label}`);

  return (
    <View style={[styles.wadah, { backgroundColor: nada.backgroundColor }]}>
      <Animated.View
        key={ganti.nomor}
        entering={ganti.nomor > 0 ? MASUK_PIL : undefined}
        testID="pil-status"
        style={styles.lapisan}
      >
        <IsiPil status={status} label={label} />
      </Animated.View>
      {ganti.lama ? (
        <PilLama
          key={`lama-${ganti.nomor}`}
          status={ganti.lama.status}
          label={ganti.lama.label}
          nomor={ganti.nomor}
          selesai={ganti.selesai}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wadah: {
    alignSelf: 'flex-start',
    height: size.status,
    paddingHorizontal: PADDING_SAMPING,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  lapisan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: JARAK_IKON,
  },
  pilLama: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: size.status,
    paddingHorizontal: PADDING_SAMPING,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: JARAK_IKON,
  },
  teks: {
    ...type.labelSm,
  },
});
