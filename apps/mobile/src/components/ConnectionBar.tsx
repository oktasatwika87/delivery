/**
 * Bilah status koneksi.
 *
 * Muncul hanya kalau ada yang perlu diberi tahu: sedang offline, atau ada
 * antrean perubahan yang sedang dikirim ke server.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { NetworkStatus } from '../map/networkMonitor';
import { Icon } from '../theme/Icon';
import { colors, fontFamily, motion, size, space, type } from '../theme/tokens';
import { CheckMark } from './motion/CheckMark';
import { RollingNumber } from './motion/RollingNumber';
import { enterFromAbove, exitEasing, exitUp } from './motion/presets';
import { useHoldDone } from './motion/useHoldDone';
import { useInitialWindow } from './motion/InitialWindow';

const TITIK_TENGAH = '\u00b7';

/** Masuk bilah dari atas. */
const MASUK = enterFromAbove();
/** Keluar bilah ke atas. */
const KELUAR = exitUp();

export interface ConnectionBarProps {
  status: NetworkStatus;
  pendingCount: number;
}

function formatSinkron(jumlah: number): string {
  return `Menyinkronkan ${jumlah} perubahan`;
}

export function ConnectionBar({
  status,
  pendingCount,
}: ConnectionBarProps): React.JSX.Element | null {
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
  const selesai = !offline && fase === 'done';
  const sinkron = status === 'online' && (pendingCount > 0 || selesai);

  if (!offline && !sinkron) {
    return null;
  }

  return (
    <Animated.View
      entering={dalamJendela ? undefined : MASUK}
      exiting={dalamJendela ? undefined : KELUAR}
      style={[styles.wadah, offline ? styles.isiOffline : styles.isiSinkron]}
      accessibilityLiveRegion="polite"
    >
      {offline ? (
        <>
          <Icon name="cloud_off" size={size.iconSm} color={colors.textInverse} />
          <Text style={styles.teksOffline}>
            Offline
            <Text style={styles.teksLembut}>{` ${TITIK_TENGAH} perubahan disimpan di HP`}</Text>
          </Text>
        </>
      ) : (
        <>
          {selesai ? (
            <CheckMark size={size.iconSm} color={colors.textInverse} />
          ) : (
            <Icon name="sync" size={size.iconSm} color={colors.textInverse} />
          )}
          <Animated.View
            style={gayaTeksSelesai}
            accessibilityElementsHidden={selesai}
            importantForAccessibility={selesai ? 'no-hide-descendants' : 'auto'}
          >
            <RollingNumber
              value={jumlahTerakhir}
              format={formatSinkron}
              style={styles.teksSinkron}
            />
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
    minHeight: size.connectionBar,
    paddingVertical: space[2],
    paddingHorizontal: space[4],
  },
  isiOffline: {
    backgroundColor: colors.surfaceInverse,
  },
  isiSinkron: {
    backgroundColor: colors.success,
  },
  teksOffline: {
    ...type.bodySm,
    fontFamily: fontFamily.extrabold,
    color: colors.textInverse,
  },
  teksLembut: {
    fontFamily: fontFamily.medium,
    color: colors.textInverseMuted,
  },
  teksSinkron: {
    ...type.bodySm,
    fontFamily: fontFamily.semibold,
    color: colors.textInverse,
  },
});
