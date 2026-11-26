/**
 * Bilah status koneksi.
 *
 * Muncul hanya kalau ada yang perlu diberi tahu: sedang offline, atau ada
 * antrean perubahan yang sedang dikirim ke server.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import type { TextStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { NetworkStatus } from '../map/networkMonitor';
import { Icon } from '../theme/Icon';
import { useTheme } from '../theme/ThemeProvider';
import { motion, size, space, type } from '../theme/tokens';
import { CheckMark } from './motion/CheckMark';
import { RollingNumber } from './motion/RollingNumber';
import { enterFromAbove, exitEasing, exitUp } from './motion/presets';
import { useHoldDone } from './motion/useHoldDone';
import { useInitialWindow } from './motion/InitialWindow';

const TITIK_TENGAH = '\u00b7';
const TEKS_OFFLINE = `Offline ${TITIK_TENGAH} perubahan disimpan di HP`;
/** Teks offline untuk customer, yang antrean sinkronnya tidak disebut. */
const TEKS_OFFLINE_CUSTOMER = 'Offline';
const JARAK_KATA = 4;

/** Masuk bilah dari atas. */
const MASUK = enterFromAbove();
/** Keluar bilah ke atas. */
const KELUAR = exitUp();

/** Peran layar pemakai bilah. Bawaannya driver. */
export type PeranKoneksi = 'driver' | 'customer';

export interface ConnectionBarProps {
  status: NetworkStatus;
  pendingCount: number;
  /** Jumlah aksi yang ditolak server atau COD yatim. */
  failedCount?: number;
  /** Peran layar pemanggil. Bawaannya driver. */
  peran?: PeranKoneksi;
}

export function ConnectionBar({
  status,
  pendingCount,
  failedCount = 0,
  peran = 'driver',
}: ConnectionBarProps): React.JSX.Element | null {
  const { colors } = useTheme();
  const dalamJendela = useInitialWindow();
  const fase = useHoldDone(status === 'online' && pendingCount > 0);
  const [jumlahTerakhir, setJumlahTerakhir] = useState(pendingCount);

  // Jumlah terakhir yang lebih dari nol, jadi bilah tidak pernah menulis
  // angka nol saat antrean sudah habis.
  if (pendingCount > 0 && pendingCount !== jumlahTerakhir) {
    setJumlahTerakhir(pendingCount);
  }

  const opasitasTeks = useSharedValue(1);

  useEffect(() => {
    opasitasTeks.value =
      fase === 'done'
        ? withTiming(0, { duration: motion.duration.fadeOut, easing: exitEasing })
        : 1;
  }, [fase, opasitasTeks]);

  const gayaTeksSelesai = useAnimatedStyle(() => ({
    opacity: opasitasTeks.value,
  }));

  const offline = status === 'offline';
  const teksOffline = peran === 'customer' ? TEKS_OFFLINE_CUSTOMER : TEKS_OFFLINE;
  // Bilah tidak memberi centang kalau masih ada aksi yang ditolak server,
  // karena antrean belum benar-benar bersih.
  const selesai = !offline && fase === 'done' && failedCount === 0;
  const sinkron = status === 'online' && (pendingCount > 0 || selesai);

  if (!offline && !sinkron) {
    return null;
  }

  // Angkanya ditebalkan, sisa kalimatnya dibiarkan redup.
  const gayaAngka: TextStyle & { lineHeight: number } = {
    ...type.bodySmMedium,
    color: colors.text,
  };

  return (
    <Animated.View
      entering={dalamJendela ? undefined : MASUK}
      exiting={dalamJendela ? undefined : KELUAR}
      style={[
        styles.wadah,
        { backgroundColor: offline ? colors.surfaceRaised : colors.syncSoft },
      ]}
      accessibilityLiveRegion="polite"
    >
      {offline ? (
        <>
          <Icon name="cloud_off" size={size.iconSm} color={colors.textMuted} />
          <Text style={[styles.teksOffline, { color: colors.text }]}>{teksOffline}</Text>
        </>
      ) : (
        <>
          {selesai ? (
            <CheckMark size={size.iconSm} color={colors.info} />
          ) : (
            <Icon name="sync" size={size.iconSm} color={colors.info} />
          )}
          <Animated.View
            style={[styles.barisTeks, gayaTeksSelesai]}
            accessibilityElementsHidden={selesai}
            importantForAccessibility={selesai ? 'no-hide-descendants' : 'auto'}
          >
            <Text style={[styles.teksAwal, { color: colors.text }]}>Menyinkronkan</Text>
            <RollingNumber value={jumlahTerakhir} style={gayaAngka} />
            <Text style={[styles.teksSisa, { color: colors.textMuted }]}>perubahan</Text>
          </Animated.View>
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wadah: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    width: '100%',
    height: size.connectionBar,
    paddingHorizontal: space[4],
  },
  teksOffline: {
    ...type.bodySm,
  },
  barisTeks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: JARAK_KATA,
  },
  teksAwal: {
    ...type.bodySm,
  },
  teksSisa: {
    ...type.bodySm,
  },
});
