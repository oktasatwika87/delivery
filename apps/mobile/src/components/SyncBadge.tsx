/**
 * Lencana status sinkronisasi.
 *
 * Menampilkan bahwa perubahan lokal belum sampai ke server, jadi pengguna
 * tahu kalau masih antre.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '../theme/Icon';
import type { IconName } from '../theme/icons';
import { colors, motion, radius, space, type } from '../theme/tokens';
import { CheckMark } from './motion/CheckMark';
import { exitEasing, fadeIn } from './motion/presets';
import { useHoldDone } from './motion/useHoldDone';
import { useInitialWindow } from './motion/InitialWindow';

const TINGGI_LABEL = 26;
const UKURAN_IKON = 16;
const JARAK_IKON = 6;
const TEBAL_TEPI = 1.5;

/** Masuk lencana: fade pelan, dibuat sekali karena parameternya tetap. */
const MASUK = fadeIn();

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
  state: SyncState | null;
}

export function SyncBadge({ state }: SyncBadgeProps): React.JSX.Element | null {
  const dalamJendela = useInitialWindow();
  const fase = useHoldDone(state !== null);
  const [stateTerakhir, setStateTerakhir] = useState<SyncState | null>(state);
  const [telahTersembunyi, setTelahTersembunyi] = useState(false);

  // State terakhir yang bukan null dipakai untuk bentuk selesai, supaya
  // lencana masih tahu warna dan ikon sebelum terakhir.
  if (state !== null && state !== stateTerakhir) {
    setStateTerakhir(state);
  }

  // Lencana yang muncul lagi setelah sempat hilang boleh bergerak masuk.
  // Lencana yang sudah ada saat SyncBadge dipasang tampil diam, karena
  // kartu yang dipasang ulang saat digulir atau ganti tab juga diam.
  if (fase === 'hidden' && !telahTersembunyi) {
    setTelahTersembunyi(true);
  }

  const opasitasTeks = useSharedValue(1);
  const opasitasLencana = useSharedValue(1);

  useEffect(() => {
    if (fase === 'done') {
      opasitasTeks.value = withTiming(0, {
        duration: motion.duration.fadeOut,
        easing: exitEasing,
      });
      opasitasLencana.value = withDelay(
        motion.duration.holdDone - motion.duration.fadeOut,
        withTiming(0, { duration: motion.duration.fadeOut, easing: exitEasing }),
      );
    } else {
      opasitasTeks.value = 1;
      opasitasLencana.value = 1;
    }
  }, [fase, opasitasTeks, opasitasLencana]);

  const gayaTeks = useAnimatedStyle(() => ({ opacity: opasitasTeks.value }));
  const gayaLencana = useAnimatedStyle(() => ({ opacity: opasitasLencana.value }));

  if (fase === 'hidden' || stateTerakhir === null) {
    return null;
  }

  const selesai = fase === 'done';
  const gaya = GAYA_STATE[state ?? stateTerakhir];

  return (
    <Animated.View
      entering={dalamJendela ? undefined : telahTersembunyi ? MASUK : undefined}
      style={styles.akar}
    >
      <Animated.View
        testID="lencana-sinkron"
        style={[
          styles.wadah,
          {
            backgroundColor: gaya.backgroundColor,
            borderWidth: gaya.borderWidth,
            borderStyle: gaya.borderStyle,
            borderColor: gaya.borderColor,
          },
          gayaLencana,
        ]}
      >
        {selesai ? (
          <CheckMark size={UKURAN_IKON} color={gaya.color} />
        ) : (
          <Icon name={gaya.icon} size={UKURAN_IKON} color={gaya.color} />
        )}
        <Animated.View
          style={gayaTeks}
          accessibilityElementsHidden={selesai}
          importantForAccessibility={selesai ? 'no-hide-descendants' : 'auto'}
        >
          <Text style={[styles.teks, { color: gaya.color }]}>{gaya.text}</Text>
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  akar: {
    alignSelf: 'flex-start',
  },
  wadah: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: JARAK_IKON,
    height: TINGGI_LABEL,
    paddingHorizontal: space[2],
    borderRadius: radius.sm,
  },
  teks: {
    ...type.labelSm,
  },
});
