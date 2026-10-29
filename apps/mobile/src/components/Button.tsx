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

import { HelpLine } from './HelpLine';
import { Icon } from '../theme/Icon';
import type { IconName } from '../theme/icons';
import {
  colors,
  fontFamily,
  radius,
  size as ukuranKontrol,
  space,
  type,
} from '../theme/tokens';

const TEBAL_TEPI = 1.5;

/** Sisa tinggi tombol kecil supaya area sentuhnya tetap 48. */
const SENTUH_SM = {
  top: (ukuranKontrol.touch - ukuranKontrol.controlSm) / 2,
  bottom: (ukuranKontrol.touch - ukuranKontrol.controlSm) / 2,
  left: (ukuranKontrol.touch - ukuranKontrol.controlSm) / 2,
  right: (ukuranKontrol.touch - ukuranKontrol.controlSm) / 2,
};

const TANPA_ISI: ViewStyle = {};

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'lg' | 'md' | 'sm';

export interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  helpText?: string;
  testID?: string;
}

/** Warna teks tombol sesuai varian, tombol nonaktif pakai teks nonaktif. */
function warnaTeksButton(variant: ButtonVariant, nonaktif: boolean): string {
  if (nonaktif) return colors.onActionDisabled;
  if (variant === 'primary') return colors.onAction;
  if (variant === 'danger') return colors.danger;
  return colors.text;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled = false,
  loading = false,
  helpText,
  testID,
}: ButtonProps): React.JSX.Element {
  const mati = disabled || loading;
  const warnaTeks = warnaTeksButton(variant, disabled);

  const gayaUkuran =
    size === 'lg' ? styles.ukuranLg : size === 'sm' ? styles.ukuranSm : styles.ukuranMd;

  const gayaIsi: ViewStyle[] = [
    variant === 'primary'
      ? styles.isiPrimer
      : variant === 'secondary'
        ? styles.isiKedua
        : TANPA_ISI,
    ...(disabled && variant !== 'ghost' && variant !== 'danger'
      ? [styles.isiNonaktif]
      : []),
  ];

  const gayaTeks: TextStyle[] = [
    styles.teks,
    ...(size === 'sm' ? [styles.teksKecil] : []),
    { color: warnaTeks },
  ];

  return (
    <View>
      <Pressable
        testID={testID}
        onPress={mati ? undefined : onPress}
        disabled={mati}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: mati, busy: loading }}
        android_ripple={variant === 'primary' ? { color: colors.actionPressed } : undefined}
        hitSlop={size === 'sm' ? SENTUH_SM : undefined}
        style={({ pressed }) => [
          styles.tombol,
          gayaUkuran,
          ...gayaIsi,
          pressed && variant === 'primary' ? styles.isiPrimerDitekan : null,
        ]}
      >
        {loading ? (
          <ActivityIndicator size="small" color={warnaTeks} />
        ) : icon ? (
          <Icon name={icon} size={ukuranKontrol.iconSm} color={warnaTeks} />
        ) : null}
        <Text style={gayaTeks}>{title}</Text>
      </Pressable>
      {helpText ? <HelpLine text={helpText} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tombol: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    gap: space[2],
  },
  ukuranLg: {
    height: ukuranKontrol.controlLg,
    paddingHorizontal: space[6],
    width: '100%',
  },
  ukuranMd: {
    height: ukuranKontrol.controlMd,
    paddingHorizontal: space[5],
  },
  ukuranSm: {
    height: ukuranKontrol.controlSm,
    paddingHorizontal: space[3],
  },
  isiPrimer: {
    backgroundColor: colors.action,
  },
  isiKedua: {
    backgroundColor: colors.surface,
    borderWidth: TEBAL_TEPI,
    borderColor: colors.lineStrong,
  },
  isiNonaktif: {
    backgroundColor: colors.actionDisabled,
    borderWidth: 0,
  },
  isiPrimerDitekan: {
    backgroundColor: colors.actionPressed,
  },
  teks: {
    ...type.label,
  },
  teksKecil: {
    ...type.bodySm,
    fontFamily: fontFamily.bold,
  },
});
