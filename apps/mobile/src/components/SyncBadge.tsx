/**
 * Lencana status sinkronisasi.
 *
 * Menampilkan bahwa perubahan lokal belum sampai ke server, jadi pengguna
 * tahu kalau masih antre. Keadaan gagal server menetap dan tidak pernah
 * berubah jadi centang.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '../theme/Icon';
import type { IconName } from '../theme/icons';
import { StripeFill } from '../theme/StripeFill';
import { perTema, useTheme } from '../theme/ThemeProvider';
import { motion, radius, size, stroke, type } from '../theme/tokens';
import { CheckMark } from './motion/CheckMark';
import { exitEasing, fadeIn } from './motion/presets';
import { useHoldDone } from './motion/useHoldDone';
import { useInitialWindow } from './motion/InitialWindow';

const JARAK_IKON = 6;
const PADDING_SAMPING = 10;
const UKURAN_IKON = size.iconXs;

/** Masuk lencana: fade pelan, dibuat sekali karena parameternya tetap. */
const MASUK = fadeIn();

export type SyncState = 'pending' | 'stale' | 'failed';

interface GayaState {
  text: string;
  color: string;
  icon: IconName;
  /** Kalau tidak diisi, lencana tanpa warna latar. */
  backgroundColor?: string;
  borderWidth: number;
  borderStyle: 'solid' | 'dashed';
  borderColor?: string;
  /** Kalau true, latar lencana pakai belang. */
  stripe: boolean;
}

const GAYA_STATE = perTema(
  (c): Record<SyncState, GayaState> => ({
    pending: {
      text: 'Menunggu sinkronisasi',
      color: c.text,
      icon: 'cloud_upload',
      borderWidth: stroke.pending,
      borderStyle: 'dashed',
      borderColor: c.pendingLine,
      stripe: false,
    },
    stale: {
      text: 'Belum tersinkron dari sejam lalu',
      color: c.warning,
      icon: 'history',
      borderWidth: 0,
      borderStyle: 'solid',
      stripe: true,
    },
    failed: {
      text: 'Ditolak server',
      color: c.danger,
      icon: 'sync_problem',
      backgroundColor: c.dangerSoft,
      borderWidth: 0,
      borderStyle: 'solid',
      stripe: false,
    },
  }),
);

const gaya = perTema((c) =>
  StyleSheet.create({
    akar: {
      alignSelf: 'flex-start',
    },
    wadah: {
      alignItems: 'center',
      height: size.status,
      paddingHorizontal: PADDING_SAMPING,
      borderRadius: radius.sm,
      overflow: 'hidden',
    },
    isi: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: JARAK_IKON,
    },
    selesai: {
      alignItems: 'center',
      justifyContent: 'center',
      width: size.status,
      height: size.status,
      borderRadius: radius.sm,
      backgroundColor: c.infoSoft,
    },
    teks: {
      ...type.labelSm,
    },
  }),
);

export interface SyncBadgeProps {
  state: SyncState | null;
  /** Gaya tambahan untuk pembungkus luar lencana. */
  style?: StyleProp<ViewStyle>;
}

export function SyncBadge({ state, style }: SyncBadgeProps): React.JSX.Element | null {
  const { name, colors } = useTheme();
  const s = gaya[name];
  const dalamJendela = useInitialWindow();
  const gagal = state === 'failed';
  // Keadaan gagal tidak menahan selesai, jadi tidak pernah berubah jadi
  // centang dan tidak ikut memudar.
  const fase = useHoldDone(state !== null && !gagal);
  const [telahTersembunyi, setTelahTersembunyi] = useState(false);

  // Lencana yang muncul lagi setelah sempat hilang boleh bergerak masuk.
  // Lencana yang sudah ada saat SyncBadge dipasang tampil diam, karena
  // kartu yang dipasang ulang saat digulir atau ganti tab juga diam.
  if (fase === 'hidden' && !telahTersembunyi) {
    setTelahTersembunyi(true);
  }

  const opasitasLencana = useSharedValue(1);

  useEffect(() => {
    if (fase === 'done' && !gagal) {
      opasitasLencana.value = withDelay(
        motion.duration.holdDone - motion.duration.fadeOut,
        withTiming(0, { duration: motion.duration.fadeOut, easing: exitEasing }),
      );
    } else {
      opasitasLencana.value = 1;
    }
  }, [fase, gagal, opasitasLencana]);

  const gayaLencana = useAnimatedStyle(() => ({ opacity: opasitasLencana.value }));

  if (!gagal && fase === 'hidden') {
    return null;
  }

  const selesai = !gagal && fase === 'done';

  if (selesai) {
    return (
      <Animated.View
        entering={dalamJendela ? undefined : telahTersembunyi ? MASUK : undefined}
        style={[s.akar, style]}
      >
        <Animated.View testID="lencana-sinkron" style={[s.selesai, gayaLencana]}>
          <CheckMark size={UKURAN_IKON} color={colors.info} />
        </Animated.View>
      </Animated.View>
    );
  }

  const gayaState = GAYA_STATE[name][state ?? 'pending'];

  return (
    <Animated.View
      entering={dalamJendela ? undefined : telahTersembunyi ? MASUK : undefined}
      style={[s.akar, style]}
    >
      <Animated.View
        testID="lencana-sinkron"
        style={[
          s.wadah,
          {
            backgroundColor: gayaState.backgroundColor,
            borderWidth: gayaState.borderWidth,
            borderStyle: gayaState.borderStyle,
            borderColor: gayaState.borderColor,
          },
          gayaLencana,
        ]}
      >
        {gayaState.stripe ? (
          <StripeFill color={colors.warningStripe} colorAlt={colors.warningStripeAlt} />
        ) : null}
        <View style={s.isi}>
          <Icon name={gayaState.icon} size={UKURAN_IKON} color={gayaState.color} />
          <Text style={[s.teks, { color: gayaState.color }]}>{gayaState.text}</Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}
