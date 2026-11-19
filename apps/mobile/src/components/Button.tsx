/**
 * Komponen tombol.
 *
 * Tombol cuma tampilan: judul dan aksi masuk lewat props. Varian menentukan
 * warna, ukuran menentukan tinggi dan padding.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';

import { HelpLine } from './HelpLine';
import { CheckMark } from './motion/CheckMark';
import { usePressScale } from './motion/usePressScale';
import { Icon } from '../theme/Icon';
import type { IconName } from '../theme/icons';
import { perTema, useTheme } from '../theme/ThemeProvider';
import {
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
    lapisanStatus: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
  }),
);

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
    ...(variant === 'secondary' || variant === 'ghost'
      ? type.bodyMdMedium
      : size === 'lg'
        ? type.labelLg
        : size === 'sm'
          ? type.labelMd
          : type.label),
    color: warnaTeks,
  };

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
          ]}
        >
          <View
            testID="judul-tombol"
            style={[s.lapisanJudul, { opacity: loading || success ? 0 : 1 }]}
          >
            {icon ? (
              <Icon name={icon} size={ukuranKontrol.iconSm} color={warnaIkon} />
            ) : null}
            <Text style={gayaTeks}>{title}</Text>
          </View>
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
