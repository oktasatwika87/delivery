/**
 * Bilah status koneksi.
 *
 * Muncul hanya kalau ada yang perlu diberi tahu: sedang offline, atau ada
 * antrean perubahan yang sedang dikirim ke server.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { NetworkStatus } from '../map/networkMonitor';
import { Icon } from '../theme/Icon';
import { colors, fontFamily, size, space, type } from '../theme/tokens';

const TITIK_TENGAH = '·';

export interface ConnectionBarProps {
  status: NetworkStatus;
  pendingCount: number;
}

export function ConnectionBar({
  status,
  pendingCount,
}: ConnectionBarProps): React.JSX.Element | null {
  if (status === 'offline') {
    return (
      <View style={[styles.wadah, styles.isiOffline]} accessibilityLiveRegion="polite">
        <Icon name="cloud_off" size={size.iconSm} color={colors.textInverse} />
        <Text style={styles.teksOffline}>
          Offline
          <Text style={styles.teksLembut}>{` ${TITIK_TENGAH} perubahan disimpan di HP`}</Text>
        </Text>
      </View>
    );
  }

  if (status === 'online' && pendingCount > 0) {
    return (
      <View style={[styles.wadah, styles.isiSinkron]} accessibilityLiveRegion="polite">
        <Icon name="sync" size={size.iconSm} color={colors.textInverse} />
        <Text style={styles.teksSinkron}>{`Menyinkronkan ${pendingCount} perubahan`}</Text>
      </View>
    );
  }

  return null;
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
