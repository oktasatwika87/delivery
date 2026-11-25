/**
 * Banner informasi.
 *
 * Memberi tahu pengguna soal kondisi aplikasi, misalnya perubahan yang belum
 * tersinkron atau koneksi yang bermasalah. Bisa punya tombol tutup dan satu
 * atau dua tombol aksi.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { Button } from './Button';
import type { ButtonVariant } from './Button';
import { Icon } from '../theme/Icon';
import type { IconName } from '../theme/icons';
import { StripeFill } from '../theme/StripeFill';
import { perTema, useTheme } from '../theme/ThemeProvider';
import { radius, size, space, stroke, type } from '../theme/tokens';
import { collapseOut, expandIn, shift } from './motion/presets';
import { CheckMark } from './motion/CheckMark';
import { useInitialWindow } from './motion/InitialWindow';

const PADDING_ATAS = 12;
const PADDING_SAMPING = 14;
const JARAK_ISI = 10;
const UKURAN_TUTUP = 44;
/** Margin negatif tombol tutup, supaya banner tidak bertambah tinggi. */
const MARGEN_TUTUP = -10;

/** Banner masuk: tingginya tumbuh dari nol. */
const MASUK = expandIn();
/** Banner keluar: tingginya menyusut ke nol. */
const KELUAR = collapseOut();
/** Banner di bawahnya ikut bergeser mulus. */
const GESER = shift();

export type BannerTone = 'pending' | 'warning' | 'info' | 'danger';

export interface BannerAction {
  label: string;
  onPress: () => void;
  /** Kalau true, tombol aksinya menampilkan pemutar dan tidak bisa ditekan. */
  loading?: boolean;
}

export interface BannerProps {
  tone: BannerTone;
  title?: string;
  body?: string;
  icon?: IconName;
  onClose?: () => void;
  actions?: readonly [BannerAction] | readonly [BannerAction, BannerAction];
  /** Bentuk selesai banner yang menunggu. Hanya dipakai nada pending. */
  done?: boolean;
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
  }),
);

/**
 * Varian tombol aksi pertama untuk tiap nada.
 *
 * Nada warning memakai tombol terang, supaya warnanya tidak bertabrakan
 * dengan belang kuning di belakang banner.
 */
const VARIAN_PERTAMA: Record<BannerTone, ButtonVariant> = {
  pending: 'primary',
  warning: 'secondary',
  info: 'primary',
  danger: 'dangerFill',
};

const gaya = StyleSheet.create({
  wadah: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: JARAK_ISI,
    paddingVertical: PADDING_ATAS,
    paddingHorizontal: PADDING_SAMPING,
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  tengah: {
    minHeight: 52,
    alignItems: 'center',
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
    ...type.bodySm,
  },
  isiTanpaJudul: {
    ...type.bodyMdMedium,
  },
  barisAksi: {
    flexDirection: 'row',
    gap: space[2],
    marginTop: JARAK_ISI,
  },
  tombolTutup: {
    width: UKURAN_TUTUP,
    height: UKURAN_TUTUP,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: MARGEN_TUTUP,
    marginBottom: MARGEN_TUTUP,
    marginRight: MARGEN_TUTUP,
  },
});

export function Banner({
  tone,
  title,
  body,
  icon,
  onClose,
  actions,
  done = false,
}: BannerProps): React.JSX.Element {
  const { name, colors } = useTheme();
  const gayaTone = GAYA_TONE[name][tone];
  const dalamJendela = useInitialWindow();
  const namaIkon = icon ?? gayaTone.icon;
  // Bentuk selesai hanya berlaku untuk banner yang menunggu.
  const selesai = tone === 'pending' && done;

  const gayaIsi = title ? gaya.isi : gaya.isiTanpaJudul;

  return (
    <Animated.View
      entering={dalamJendela ? undefined : MASUK}
      exiting={dalamJendela ? undefined : KELUAR}
      // Banner bisa bertumpuk, jadi banner di bawahnya ikut bergeser mulus
      // saat banner di atasnya masuk atau keluar.
      layout={dalamJendela ? undefined : GESER}
      style={[
        gaya.wadah,
        gayaTone.tengah ? gaya.tengah : null,
        {
          backgroundColor: gayaTone.backgroundColor,
          borderWidth: gayaTone.borderWidth,
          borderStyle: selesai ? 'solid' : gayaTone.borderStyle,
          borderColor: gayaTone.borderColor,
        },
      ]}
    >
      {gayaTone.stripe ? (
        <StripeFill color={colors.warningStripe} colorAlt={colors.warningStripeAlt} />
      ) : null}
      <View style={gaya.ikon}>
        {selesai ? (
          <CheckMark size={size.iconMd} color={colors.info} />
        ) : (
          <Icon name={namaIkon} size={size.iconMd} color={gayaTone.color} />
        )}
      </View>
      <View style={gaya.kolom}>
        {title ? (
          <Text style={[gaya.judul, { color: gayaTone.titleColor }]}>{title}</Text>
        ) : null}
        {body ? <Text style={[gayaIsi, { color: colors.text }]}>{body}</Text> : null}
        {actions ? (
          <View style={gaya.barisAksi}>
            <Button
              title={actions[0].label}
              onPress={actions[0].onPress}
              loading={actions[0].loading}
              size="sm"
              variant={VARIAN_PERTAMA[tone]}
            />
            {actions.length === 2 ? (
              <Button
                title={actions[1].label}
                onPress={actions[1].onPress}
                loading={actions[1].loading}
                size="sm"
                variant="ghost"
              />
            ) : null}
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
