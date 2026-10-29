/**
 * Banner informasi.
 *
 * Memberi tahu pengguna soal kondisi aplikasi, misalnya perubahan yang belum
 * tersinkron atau koneksi yang bermasalah. Bisa punya tombol tutup dan satu
 * aksi.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../theme/Icon';
import type { IconName } from '../theme/icons';
import { colors, fontFamily, radius, size, space, type } from '../theme/tokens';

const TEBAL_TEPI = 1.5;

/** Sisa ukuran ikon supaya area sentuhnya tetap 48. */
const SENTUH_IKON = {
  top: (size.touch - size.iconSm) / 2,
  bottom: (size.touch - size.iconSm) / 2,
  left: (size.touch - size.iconSm) / 2,
  right: (size.touch - size.iconSm) / 2,
};

export type BannerTone = 'pending' | 'warning' | 'info' | 'danger' | 'success';

export interface BannerAction {
  label: string;
  onPress: () => void;
}

export interface BannerProps {
  tone: BannerTone;
  title: string;
  body?: string;
  icon?: IconName;
  onClose?: () => void;
  action?: BannerAction;
}

interface GayaTone {
  backgroundColor: string;
  color: string;
  icon: IconName;
  borderWidth: number;
  borderStyle: 'solid' | 'dashed';
  borderColor: string;
}

const GAYA_TONE: Record<BannerTone, GayaTone> = {
  pending: {
    backgroundColor: colors.surface,
    color: colors.text,
    icon: 'cloud_upload',
    borderWidth: TEBAL_TEPI,
    borderStyle: 'dashed',
    borderColor: colors.text,
  },
  warning: {
    backgroundColor: colors.warningSoft,
    color: colors.warning,
    icon: 'history',
    borderWidth: 0,
    borderStyle: 'solid',
    borderColor: colors.warning,
  },
  info: {
    backgroundColor: colors.fillNeutral,
    color: colors.text,
    icon: 'sync',
    borderWidth: 0,
    borderStyle: 'solid',
    borderColor: colors.text,
  },
  danger: {
    backgroundColor: colors.dangerSoft,
    color: colors.dangerStrong,
    icon: 'sync_problem',
    borderWidth: 0,
    borderStyle: 'solid',
    borderColor: colors.dangerStrong,
  },
  success: {
    backgroundColor: colors.successSoft,
    color: colors.successStrong,
    icon: 'payments',
    borderWidth: 0,
    borderStyle: 'solid',
    borderColor: colors.successStrong,
  },
};

export function Banner({
  tone,
  title,
  body,
  icon,
  onClose,
  action,
}: BannerProps): React.JSX.Element {
  const gaya = GAYA_TONE[tone];
  const namaIkon = icon ?? gaya.icon;

  return (
    <View
      style={[
        styles.wadah,
        {
          backgroundColor: gaya.backgroundColor,
          borderWidth: gaya.borderWidth,
          borderStyle: gaya.borderStyle,
          borderColor: gaya.borderColor,
        },
      ]}
    >
      <Icon name={namaIkon} size={size.iconSm} color={gaya.color} />
      <View style={styles.kolom}>
        <Text style={[styles.judul, { color: gaya.color }]}>{title}</Text>
        {body ? <Text style={[styles.isi, { color: gaya.color }]}>{body}</Text> : null}
        {action ? (
          <Pressable
            onPress={action.onPress}
            accessibilityRole="button"
            hitSlop={SENTUH_IKON}
          >
            <Text style={[styles.aksi, { color: gaya.color }]}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {onClose ? (
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Tutup"
          hitSlop={SENTUH_IKON}
        >
          <Icon name="close" size={size.iconSm} color={gaya.color} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wadah: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    borderRadius: radius.md,
  },
  kolom: {
    flex: 1,
    gap: space[1],
  },
  judul: {
    ...type.titleSm,
  },
  isi: {
    ...type.bodySm,
  },
  aksi: {
    ...type.bodySm,
    fontFamily: fontFamily.extrabold,
    textDecorationLine: 'underline',
  },
});
