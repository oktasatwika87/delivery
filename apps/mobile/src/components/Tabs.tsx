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
import { perTema, useTheme } from '../theme/ThemeProvider';
import { elevation, motion, radius, size, space, type } from '../theme/tokens';

const LEBAR_PIL_MIN = 24;
const TINGGI_PIL = 22;
const PADDING_PIL = 6;
const JARAK_TAB = 4;

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

const gaya = perTema((c) =>
  StyleSheet.create({
    wadah: {
      height: size.controlLg,
      padding: JARAK_TAB,
      borderRadius: radius.xl,
      backgroundColor: c.surface,
    },
    baris: {
      flex: 1,
      flexDirection: 'row',
      gap: JARAK_TAB,
    },
    tab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space[2],
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
      top: 0,
      bottom: 0,
      borderRadius: radius.md,
      backgroundColor: c.surfaceRaised,
    },
  }),
);

export function Tabs({ tabs, activeKey, onChange }: TabsProps): React.JSX.Element {
  const { name, colors } = useTheme();
  const s = gaya[name];
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

  // Tema terang memakai elevasi, tema gelap ambil kedalaman dari warnanya.
  const bayangan = name === 'terang' ? { elevation: elevation.card } : null;

  return (
    <View style={s.wadah}>
      <View style={s.baris}>
        {/* Penanda diletakkan lebih dulu supaya label tetap di atasnya. */}
        <Animated.View
          testID="penanda-tab"
          style={[s.penanda, bayangan, gayaPenanda]}
        />
        {tabs.map((tab) => {
          const aktif = tab.key === activeKey;
          const gayaTeksPil: TextStyle & { lineHeight: number } = {
            ...type.labelSm,
            color: aktif ? colors.onAccent : colors.textMuted,
          };
          return (
            <Pressable
              key={tab.key}
              onPress={aktif ? undefined : () => onChange(tab.key)}
              onLayout={padaLayout(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: aktif }}
              style={s.tab}
            >
              <Text style={[s.label, { color: aktif ? colors.text : colors.textSubtle }]}>
                {tab.label}
              </Text>
              {tab.count !== undefined ? (
                <Animated.View
                  entering={dalamJendela ? undefined : MASUK}
                  exiting={dalamJendela ? undefined : KELUAR}
                  testID="pil-tab"
                  style={[
                    s.pil,
                    { backgroundColor: aktif ? colors.accent : colors.surfaceRaised },
                  ]}
                >
                  <RollingNumber value={tab.count} style={gayaTeksPil} />
                </Animated.View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
