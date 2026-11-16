/**
 * Kolom isian teks.
 *
 * Dipakai untuk formulir, misalnya kota tujuan, alamat, atau sandi. Kotaknya
 * berubah warna tepi saat difokus dan kalau ada pesan galat.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps, TextStyle, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { Icon } from '../theme/Icon';
import type { IconName } from '../theme/icons';
import { perTema, useTheme } from '../theme/ThemeProvider';
import { radius, size, space, stroke, type } from '../theme/tokens';
import { enterFromAbove, fadeOut } from './motion/presets';
import { useInitialWindow } from './motion/InitialWindow';
import { useFieldShake } from './motion/useFieldShake';

const TINGGI_MULTILINE = 88;

/** Masuk pesan galat dari atas. */
const MASUK = enterFromAbove();
/** Keluar pesan galat. */
const KELUAR = fadeOut();

export interface TextFieldRightIcon {
  name: IconName;
  onPress: () => void;
  accessibilityLabel: string;
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (teks: string) => void;
  placeholder?: string;
  optional?: boolean;
  error?: string;
  prefix?: string;
  multiline?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  secureTextEntry?: boolean;
  rightIcon?: TextFieldRightIcon;
  editable?: boolean;
  /** Naik setiap kali pengiriman gagal, dipakai untuk menggetarkan kotak. */
  submitCount?: number;
  testID?: string;
}

const gaya = perTema((c) =>
  StyleSheet.create({
    wadah: {
      width: '100%',
    },
    label: {
      ...type.bodySmMedium,
      color: c.textLabel,
      marginBottom: space[2],
    },
    opsional: {
      color: c.textMuted,
    },
    kotak: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: size.controlLg,
      backgroundColor: c.surface,
      borderWidth: stroke.hairline,
      borderColor: c.lineStrong,
      borderRadius: radius.lg,
      paddingHorizontal: space[4],
      gap: space[2],
    },
    kotakNonaktif: {
      backgroundColor: c.bg,
      borderColor: c.line,
    },
    kotakMultiline: {
      alignItems: 'flex-start',
    },
    awalan: {
      ...type.label,
      color: c.textMuted,
    },
    input: {
      ...type.body,
      color: c.text,
      flex: 1,
    },
    inputMultiline: {
      minHeight: TINGGI_MULTILINE,
      textAlignVertical: 'top',
      paddingVertical: space[3],
    },
    tombolIkon: {
      width: size.touch,
      height: size.touch,
      alignItems: 'center',
      justifyContent: 'center',
    },
    barisGalat: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[1],
      marginTop: space[2],
    },
    teksGalat: {
      ...type.bodyXs,
      color: c.danger,
      flexShrink: 1,
    },
  }),
);

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  optional,
  error,
  prefix,
  multiline,
  keyboardType,
  secureTextEntry,
  rightIcon,
  editable = true,
  submitCount,
  testID,
}: TextFieldProps): React.JSX.Element {
  const [fokus, setFokus] = useState(false);
  const dalamJendela = useInitialWindow();
  const { style: gayaGetar, shake } = useFieldShake();
  const submitSebelum = useRef(submitCount);
  const { name, colors } = useTheme();
  const s = gaya[name];

  // Kotak hanya bergetar waktu pengiriman baru gagal, jadi mengetik tidak
  // membuat kotak bergerak.
  useEffect(() => {
    if (submitSebelum.current === submitCount) {
      return;
    }
    submitSebelum.current = submitCount;
    if (error) {
      shake();
    }
  }, [submitCount, error, shake]);

  const gayaKotak: ViewStyle[] = [s.kotak];
  const gayaInput: TextStyle[] = [s.input];

  if (!editable) {
    gayaKotak.push(s.kotakNonaktif);
  } else if (error) {
    gayaKotak.push({ borderColor: colors.danger });
  } else if (fokus) {
    gayaKotak.push({ borderColor: colors.focus });
  }

  if (multiline) {
    gayaKotak.push(s.kotakMultiline);
    gayaInput.push(s.inputMultiline);
  }

  return (
    <View style={s.wadah}>
      <Text style={s.label}>
        {label}
        {optional ? <Text style={s.opsional}> (opsional)</Text> : null}
      </Text>
      <Animated.View style={[...gayaKotak, gayaGetar]}>
        {prefix ? <Text style={s.awalan}>{prefix}</Text> : null}
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textSubtle}
          keyboardType={keyboardType}
          secureTextEntry={secureTextEntry}
          editable={editable}
          multiline={multiline}
          accessibilityLabel={label}
          onFocus={() => setFokus(true)}
          onBlur={() => setFokus(false)}
          style={gayaInput}
        />
        {rightIcon ? (
          <Pressable
            onPress={rightIcon.onPress}
            accessibilityRole="button"
            accessibilityLabel={rightIcon.accessibilityLabel}
            style={s.tombolIkon}
          >
            <Icon name={rightIcon.name} size={size.iconSm} color={colors.textSubtle} />
          </Pressable>
        ) : null}
      </Animated.View>
      {error ? (
        <Animated.View
          entering={dalamJendela ? undefined : MASUK}
          exiting={dalamJendela ? undefined : KELUAR}
          style={s.barisGalat}
        >
          <Icon name="error" size={size.iconXs} color={colors.danger} />
          <Text style={s.teksGalat}>{error}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}
