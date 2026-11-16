/**
 * Baris tab.
 *
 * Dipakai di layar utama untuk berpindah antara daftar, misalnya order yang
 * tersedia dan order yang sedang dikerjakan.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent, TextStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { RollingNumber } from './motion/RollingNumber';
import { fadeIn, fadeOut } from './motion/presets';
import { useInitialWindow } from './motion/InitialWindow';
import { colors, fontFamily, motion, radius, space, type } from '../theme/tokens';

const TINGGI_TAB = 48;
const TEBAL_GARIS = 3;
const LEBAR_PIL_MIN = 22;
const TINGGI_PIL = 20;
const PADDING_PIL = 6;

/** Masuk pil angka. */
const MASUK = fadeIn();
/** Keluar pil angka. */
const KELUAR = fadeOut();

export interface TabItem {
  key: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  tabs: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
}

/** Posisi dan lebar satu tab di dalam wadah. */
interface PosisiTab {
  x: number;
  width: number;
}

export function Tabs({ tabs, activeKey, onChange }: TabsProps): React.JSX.Element {
  const dalamJendela = useInitialWindow();
  const [tataLetak, setTataLetak] = useState<Record<string, PosisiTab>>({});
  const lebarPenanda = useSharedValue(0);
  const geserPenanda = useSharedValue(0);
  const keyTerakhir = useRef(activeKey);

  const padaLayout = useCallback(
    (key: string) => (event: LayoutChangeEvent) => {
      const { x, width } = event.nativeEvent.layout;
      setTataLetak((sebelumnya) => {
        const lama = sebelumnya[key];
        if (lama && lama.x === x && lama.width === width) {
          return sebelumnya;
        }
        return { ...sebelumnya, [key]: { x, width } };
      });
    },
    [],
  );

  const posisi = tataLetak[activeKey];

  // Tab aktif yang berpindah digerakkan penandanya, tapi penempatan pertama
  // dan perubahan tata letak lain langsung tanpa gerak.
  useEffect(() => {
    if (!posisi) {
      return;
    }
    const keyBerubah = keyTerakhir.current !== activeKey;
    keyTerakhir.current = activeKey;
    if (keyBerubah) {
      lebarPenanda.value = withSpring(posisi.width, {
        duration: motion.duration.tabIndicator,
        dampingRatio: 1,
      });
      geserPenanda.value = withSpring(posisi.x, {
        duration: motion.duration.tabIndicator,
        dampingRatio: 1,
      });
    } else {
      lebarPenanda.value = posisi.width;
      geserPenanda.value = posisi.x;
    }
  }, [posisi, activeKey, lebarPenanda, geserPenanda]);

  const gayaPenanda = useAnimatedStyle(() => ({
    width: lebarPenanda.value,
    transform: [{ translateX: geserPenanda.value }],
  }));

  return (
    <View style={styles.wadah}>
      {tabs.map((tab) => {
        const aktif = tab.key === activeKey;
        const gayaTeksPil: TextStyle & { lineHeight: number } = {
          ...type.caption,
          fontFamily: fontFamily.bold,
          color: aktif ? colors.text : colors.textInverse,
        };
        return (
          <Pressable
            key={tab.key}
            onPress={aktif ? undefined : () => onChange(tab.key)}
            onLayout={padaLayout(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: aktif }}
            style={[styles.tab, { borderBottomColor: colors.surfaceInverse }]}
          >
            <Text style={[styles.label, { color: aktif ? colors.textInverse : colors.textInverseMuted }]}>
              {tab.label}
            </Text>
            {tab.count && tab.count > 0 ? (
              <Animated.View
                entering={dalamJendela ? undefined : MASUK}
                exiting={dalamJendela ? undefined : KELUAR}
                style={[
                  styles.pil,
                  { backgroundColor: aktif ? colors.surface : colors.fillInverse },
                ]}
              >
                <RollingNumber value={tab.count} style={gayaTeksPil} />
              </Animated.View>
            ) : null}
          </Pressable>
        );
      })}
      <Animated.View
        testID="penanda-tab"
        style={[styles.penanda, gayaPenanda]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wadah: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceInverse,
    paddingHorizontal: space[2],
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    height: TINGGI_TAB,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    borderBottomWidth: TEBAL_GARIS,
  },
  label: {
    ...type.label,
  },
  pil: {
    minWidth: LEBAR_PIL_MIN,
    height: TINGGI_PIL,
    paddingHorizontal: PADDING_PIL,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  penanda: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: TEBAL_GARIS,
    backgroundColor: colors.brandRedInverse,
  },
});
