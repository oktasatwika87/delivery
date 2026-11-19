/**
 * Kerangka layar driver.
 *
 * Kerangkanya sama untuk semua layar driver: latar layar, status bar, bilah
 * koneksi di atas, lalu isi layar. Isi layar tidak dibungkus, jadi layar
 * bisa menata anaknya sendiri.
 */

import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectionBar } from './ConnectionBar';
import type { ConnectionBarProps } from './ConnectionBar';
import { shift } from './motion/presets';
import { useInitialWindow } from './motion/InitialWindow';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { stroke, space } from '../theme/tokens';

/** Geser isi layar saat tata letaknya berubah. */
const GESER = shift();

/** Geser bilah bawah saat isinya berubah. */
const GESER_BILAH = shift();

export interface ScreenFrameProps {
  /** Kepala layar, misalnya MainHeader atau AppBar. */
  header: React.ReactNode;
  connection: ConnectionBarProps;
  children: React.ReactNode;
  /** Isi bilah bawah. Kalau tidak diisi, bilah tidak dipasang. */
  bottomBar?: React.ReactNode;
}

export function ScreenFrame({
  header,
  connection,
  children,
  bottomBar,
}: ScreenFrameProps): React.JSX.Element {
  const { colors } = useTheme();
  const dalamJendela = useInitialWindow();

  return (
    <View style={[styles.layar, { backgroundColor: colors.bg }]}>
      <StatusBar barStyle="light-content" backgroundColor={colors.header} />
      {/* Bilah di luar isi layar, supaya layout di isiLayar menggeser
          isi layar saat bilah muncul atau hilang. */}
      <View style={{ backgroundColor: colors.header }}>
        <ThemeProvider name="gelap">
          <ConnectionBar
            status={connection.status}
            pendingCount={connection.pendingCount}
            failedCount={connection.failedCount ?? 0}
          />
        </ThemeProvider>
      </View>
      <Animated.View style={styles.isiLayar} layout={dalamJendela ? undefined : GESER}>
        {header}
        {children}
        {bottomBar ? <BilahBawah>{bottomBar}</BilahBawah> : null}
      </Animated.View>
    </View>
  );
}

interface BilahBawahProps {
  children: React.ReactNode;
}

/**
 * Bilah bawah layar.
 *
 * Dipisah jadi komponen sendiri karena hanya bagian ini yang perlu tahu
 * tinggi area aman di bawah layar.
 */
function BilahBawah({ children }: BilahBawahProps): React.JSX.Element {
  const { colors } = useTheme();
  const dalamJendela = useInitialWindow();
  const insets = useSafeAreaInsets();

  return (
    <Animated.View
      style={[
        styles.bilahBawah,
        {
          paddingBottom: space[4] + insets.bottom,
          backgroundColor: colors.bg,
          borderTopColor: colors.line,
        },
      ]}
      layout={dalamJendela ? undefined : GESER_BILAH}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layar: {
    flex: 1,
  },
  isiLayar: {
    flex: 1,
  },
  bilahBawah: {
    paddingTop: space[3],
    paddingHorizontal: space[4],
    borderTopWidth: stroke.hairline,
    gap: space[2],
  },
});
