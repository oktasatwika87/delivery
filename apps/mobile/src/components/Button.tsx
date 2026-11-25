/**
 * Komponen tombol.
 *
 * Tombol cuma tampilan: judul dan aksi masuk lewat props. Varian menentukan
 * warna, ukuran menentukan tinggi dan padding.
 */

import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { HelpLine } from './HelpLine';
import { CheckMark } from './motion/CheckMark';
import { enterFromBelow, exitEasing } from './motion/presets';
import { useGantiIsi } from './motion/useGantiIsi';
import { usePressScale } from './motion/usePressScale';
import { Icon } from '../theme/Icon';
import type { IconName } from '../theme/icons';
import { perTema, useTheme } from '../theme/ThemeProvider';
import {
  motion,
  radius,
  size as ukuranKontrol,
  space,
  stroke,
  type,
} from '../theme/tokens';

/** Sisa tinggi tombol kecil supaya area sentuhnya tetap 48. */
const SENTUH_SM = {
  top: (ukuranKontrol.touch - ukuranKontrol.controlSm) / 2,
  bottom: (ukuranKontrol.touch - ukuranKontrol.controlSm) / 2,
  left: (ukuranKontrol.touch - ukuranKontrol.controlSm) / 2,
  right: (ukuranKontrol.touch - ukuranKontrol.controlSm) / 2,
};

/** Jarak gulir judul, sama dengan jarak yang dipakai preset masuk dan keluar. */
const JARAK_GULIR = 25;

/** Masuk lapisan judul baru: naik dari bawah sambil pudar masuk. */
const MASUK_JUDUL = enterFromBelow();

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerFill';
export type ButtonSize = 'lg' | 'card' | 'md' | 'sm';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  /** Kalau true, tombol menampilkan centang dan tidak bisa ditekan lagi. */
  success?: boolean;
  helpText?: string;
  testID?: string;
}

const gaya = perTema((c) =>
  StyleSheet.create({
    tombol: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    ukuranLg: {
      height: ukuranKontrol.controlLg,
      borderRadius: radius.xl,
      paddingHorizontal: space[4],
      width: '100%',
    },
    ukuranCard: {
      height: ukuranKontrol.controlCard,
      borderRadius: radius.lg,
      paddingHorizontal: space[4],
      width: '100%',
    },
    ukuranMd: {
      height: ukuranKontrol.controlMd,
      borderRadius: radius.lg,
      paddingHorizontal: space[4],
    },
    ukuranSm: {
      height: ukuranKontrol.controlSm,
      borderRadius: radius.md,
      paddingHorizontal: space[4],
    },
    isiPrimer: {
      backgroundColor: c.action,
    },
    isiPrimerDitekan: {
      backgroundColor: c.actionPressed,
    },
    isiKedua: {
      backgroundColor: c.actionSecondary,
      borderWidth: stroke.hairline,
      borderColor: c.lineControl,
    },
    isiDanger: {
      backgroundColor: c.danger,
    },
    isiNonaktif: {
      backgroundColor: c.actionDisabled,
      borderWidth: 0,
    },
    lapisanJudul: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[2],
    },
    lapisanIsi: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[2],
    },
    lapisanJudulLama: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    lapisanStatus: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
  }),
);

interface LapisanJudulLamaProps {
  title: string;
  icon?: IconName;
  /** Nomor pergantian yang sedang ditutup. */
  nomor: number;
  /** Dipanggil saat judul lama selesai keluar. */
  selesai: (nomor: number) => void;
  gayaTeks: TextStyle;
  warnaIkon: string;
}

function LapisanJudulLama({
  title,
  icon,
  nomor,
  selesai,
  gayaTeks,
  warnaIkon,
}: LapisanJudulLamaProps): React.JSX.Element {
  const { name } = useTheme();
  const s = gaya[name];
  const geser = useSharedValue(0);
  const opasitas = useSharedValue(1);

  useEffect(() => {
    const konfigurasi = { duration: motion.duration.exit, easing: exitEasing };
    geser.value = withTiming(-JARAK_GULIR, konfigurasi);
    opasitas.value = withTiming(0, konfigurasi, (habis) => {
      if (habis) {
        runOnJS(selesai)(nomor);
      }
    });
  }, [geser, nomor, opasitas, selesai]);

  const gayaGerak = useAnimatedStyle(() => ({
    transform: [{ translateY: geser.value }],
    opacity: opasitas.value,
  }));

  return (
    <Animated.View
      style={[s.lapisanJudulLama, gayaGerak]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={s.lapisanIsi}>
        {icon ? <Icon name={icon} size={ukuranKontrol.iconSm} color={warnaIkon} /> : null}
        <Text style={gayaTeks}>{title}</Text>
      </View>
    </Animated.View>
  );
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled = false,
  loading = false,
  success = false,
  helpText,
  testID,
}: ButtonProps): React.JSX.Element {
  const { name, colors } = useTheme();
  const s = gaya[name];
  const skala = usePressScale(!disabled && !loading);
  const mati = disabled || loading || success;

  const gayaUkuran =
    size === 'lg'
      ? s.ukuranLg
      : size === 'card'
        ? s.ukuranCard
        : size === 'sm'
          ? s.ukuranSm
          : s.ukuranMd;

  const warnaTeks = disabled
    ? colors.onActionDisabled
    : variant === 'primary'
      ? colors.onAction
      : variant === 'secondary'
        ? colors.onActionSecondary
        : variant === 'dangerFill'
          ? colors.onDanger
          : variant === 'danger'
            ? colors.danger
            : colors.text;

  const warnaIkon = disabled
    ? colors.onActionDisabled
    : variant === 'primary'
      ? colors.onAction
      : variant === 'secondary'
        ? colors.info
        : variant === 'dangerFill'
          ? colors.onDanger
          : variant === 'danger'
            ? colors.danger
            : colors.text;

  const gayaIsi: ViewStyle[] = disabled
    ? [s.isiNonaktif]
    : variant === 'primary'
      ? [s.isiPrimer]
      : variant === 'secondary'
        ? [s.isiKedua]
        : variant === 'dangerFill'
          ? [s.isiDanger]
          : [];

  const gayaTeks: TextStyle = {
    ...(size === 'lg'
      ? type.labelLg
      : variant === 'secondary' || variant === 'ghost'
        ? type.bodyMdMedium
        : size === 'sm'
          ? type.labelMd
          : type.label),
    color: warnaTeks,
  };

  const ganti = useGantiIsi({ title, icon }, `${icon ?? ''}|${title}`);

  return (
    <View>
      <Animated.View style={skala.style}>
        <Pressable
          testID={testID}
          onPress={mati ? undefined : onPress}
          onPressIn={mati ? undefined : skala.onPressIn}
          onPressOut={mati ? undefined : skala.onPressOut}
          disabled={mati}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ disabled: mati, busy: loading && !success }}
          android_ripple={variant === 'primary' ? { color: colors.actionPressed } : undefined}
          hitSlop={size === 'sm' ? SENTUH_SM : undefined}
          style={({ pressed }) => [
            s.tombol,
            gayaUkuran,
            ...gayaIsi,
            pressed && !disabled && variant === 'primary' ? s.isiPrimerDitekan : null,
            { overflow: 'hidden' },
          ]}
        >
          <View
            testID="judul-tombol"
            style={[s.lapisanJudul, { opacity: loading || success ? 0 : 1 }]}
          >
            <Animated.View
              key={ganti.nomor}
              entering={ganti.nomor > 0 ? MASUK_JUDUL : undefined}
              testID="isi-tombol"
              style={s.lapisanIsi}
            >
              {icon ? (
                <Icon name={icon} size={ukuranKontrol.iconSm} color={warnaIkon} />
              ) : null}
              <Text style={gayaTeks}>{title}</Text>
            </Animated.View>
          </View>
          {ganti.lama ? (
            <LapisanJudulLama
              key={`lama-${ganti.nomor}`}
              title={ganti.lama.title}
              icon={ganti.lama.icon}
              nomor={ganti.nomor}
              selesai={ganti.selesai}
              gayaTeks={gayaTeks}
              warnaIkon={warnaIkon}
            />
          ) : null}
          {loading ? (
            <View style={s.lapisanStatus} pointerEvents="none">
              <ActivityIndicator size="small" color={warnaTeks} />
            </View>
          ) : null}
          {success ? (
            <View style={s.lapisanStatus} pointerEvents="none">
              <CheckMark size={ukuranKontrol.iconSm} color={warnaTeks} />
            </View>
          ) : null}
        </Pressable>
      </Animated.View>
      {helpText ? <HelpLine text={helpText} /> : null}
    </View>
  );
}
