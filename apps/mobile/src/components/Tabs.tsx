/**
 * Baris tab.
 *
 * Dipakai di layar utama untuk berpindah antara daftar, misalnya order yang
 * tersedia dan order yang sedang dimakan.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius, space, type } from '../theme/tokens';

const TINGGI_TAB = 48;
const TEBAL_GARIS = 3;
const LEBAR_PIL_MIN = 22;
const TINGGI_PIL = 20;
const PADDING_PIL = 6;

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

export function Tabs({ tabs, activeKey, onChange }: TabsProps): React.JSX.Element {
  return (
    <View style={styles.wadah}>
      {tabs.map((tab) => {
        const aktif = tab.key === activeKey;
        return (
          <Pressable
            key={tab.key}
            onPress={aktif ? undefined : () => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: aktif }}
            style={[
              styles.tab,
              {
                borderBottomColor: aktif ? colors.brandRedInverse : colors.surfaceInverse,
              },
            ]}
          >
            <Text style={[styles.label, { color: aktif ? colors.textInverse : colors.textInverseMuted }]}>
              {tab.label}
            </Text>
            {tab.count && tab.count > 0 ? (
              <View
                style={[
                  styles.pil,
                  { backgroundColor: aktif ? colors.surface : colors.fillInverse },
                ]}
              >
                <Text
                  style={[
                    styles.teksPil,
                    { color: aktif ? colors.text : colors.textInverse },
                  ]}
                >
                  {tab.count}
                </Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
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
  teksPil: {
    ...type.caption,
    fontFamily: fontFamily.extrabold,
  },
});
