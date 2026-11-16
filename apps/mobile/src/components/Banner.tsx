/**
 * Banner informasi.
 *
 * Memberi tahu pengguna soal kondisi aplikasi, misalnya perubahan yang belum
 * tersinkron atau koneksi yang bermasalah. Bisa punya tombol tutup dan satu
 * aksi.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Icon } from '../theme/Icon';
import type { IconName } from '../theme/icons';
import { StripeFill } from '../theme/StripeFill';
import { perTema, useTheme } from '../theme/ThemeProvider';
import { radius, size, space, stroke, type } from '../theme/tokens';
import { enterFromAbove, exitUp } from './motion/presets';
import { useInitialWindow } from './motion/InitialWindow';

const PADDING_ATAS = 12;
const PADDING_SAMPING = 14;
const JARAK_ISI = 10;
const UKURAN_TUTUP = 44;

/** Masuk banner dari atas. */
const MASUK = enterFromAbove();
/** Keluar banner ke atas. */
const KELUAR = exitUp();

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
  /** Isi kotak banner. Kalau tidak diisi, banner tanpa warna latar. */
  backgroundColor?: string;
  /** Warna ikon utama. */
  color: string;
  /** Warna judul. */
  titleColor: string;
  icon: IconName;
  borderWidth: number;
  borderStyle: 'solid' | 'dashed';
  borderColor?: string;
  /** Kalau true, latar banner pakai belang. */
  stripe: boolean;
  /** Kalau true, isi banner diratakan di tengah. */
  tengah: boolean;
}

const GAYA_TONE = perTema(
  (c): Record<BannerTone, GayaTone> => ({
    pending: {
      color: c.text,
      titleColor: c.text,
      icon: 'cloud_upload',
      borderWidth: stroke.pending,
      borderStyle: 'dashed',
      borderColor: c.pendingLine,
      stripe: false,
      tengah: true,
    },
    warning: {
      color: c.warning,
      titleColor: c.warning,
      icon: 'history',
      borderWidth: 0,
      borderStyle: 'solid',
      stripe: true,
      tengah: false,
    },
    danger: {
      backgroundColor: c.dangerSoft,
      color: c.danger,
      titleColor: c.text,
      icon: 'sync_problem',
      borderWidth: 0,
      borderStyle: 'solid',
      stripe: false,
      tengah: false,
    },
    info: {
      backgroundColor: c.infoSoft,
      color: c.info,
      titleColor: c.text,
      icon: 'sync',
      borderWidth: 0,
      borderStyle: 'solid',
      stripe: false,
      tengah: false,
    },
    success: {
      backgroundColor: c.infoSoft,
      color: c.info,
      titleColor: c.text,
      icon: 'payments',
      borderWidth: 0,
      borderStyle: 'solid',
      stripe: false,
      tengah: false,
    },
  }),
);

const gaya = StyleSheet.create({
  wadah: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: JARAK_ISI,
    paddingVertical: PADDING_ATAS,
    paddingHorizontal: PADDING_SAMPING,
    borderRadius: radius.xl,
  },
  tengah: {
    minHeight: 52,
    justifyContent: 'center',
  },
  ikon: {
    marginTop: 1,
  },
  kolom: {
    flex: 1,
    gap: 2,
  },
  judul: {
    ...type.labelMd,
  },
  isi: {
    ...type.bodyMdMedium,
  },
  barisAksi: {
    flexDirection: 'row',
    gap: space[2],
    marginTop: JARAK_ISI,
  },
  aksi: {
    ...type.bodyMdMedium,
    textDecorationLine: 'underline',
  },
  tombolTutup: {
    width: UKURAN_TUTUP,
    height: UKURAN_TUTUP,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export function Banner({
  tone,
  title,
  body,
  icon,
  onClose,
  action,
}: BannerProps): React.JSX.Element {
  const { name, colors } = useTheme();
  const gayaTone = GAYA_TONE[name][tone];
  const dalamJendela = useInitialWindow();
  const namaIkon = icon ?? gayaTone.icon;

  return (
    <Animated.View
      entering={dalamJendela ? undefined : MASUK}
      exiting={dalamJendela ? undefined : KELUAR}
      style={[
        gaya.wadah,
        gayaTone.tengah ? gaya.tengah : null,
        {
          backgroundColor: gayaTone.backgroundColor,
          borderWidth: gayaTone.borderWidth,
          borderStyle: gayaTone.borderStyle,
          borderColor: gayaTone.borderColor,
        },
      ]}
    >
      {gayaTone.stripe ? (
        <StripeFill color={colors.warningStripe} colorAlt={colors.warningStripeAlt} />
      ) : null}
      <View style={gaya.ikon}>
        <Icon name={namaIkon} size={size.iconMd} color={gayaTone.color} />
      </View>
      <View style={gaya.kolom}>
        <Text style={[gaya.judul, { color: gayaTone.titleColor }]}>{title}</Text>
        {body ? <Text style={[gaya.isi, { color: colors.textMuted }]}>{body}</Text> : null}
        {action ? (
          <View style={gaya.barisAksi}>
            <Pressable
              onPress={action.onPress}
              accessibilityRole="button"
              accessibilityLabel={action.label}
            >
              <Text style={[gaya.aksi, { color: gayaTone.color }]}>{action.label}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
      {onClose ? (
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Tutup"
          style={gaya.tombolTutup}
        >
          <Icon name="close" size={size.icon} color={colors.text} />
        </Pressable>
      ) : null}
    </Animated.View>
  );
}
