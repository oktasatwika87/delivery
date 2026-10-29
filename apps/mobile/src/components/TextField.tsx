/**
 * Kolom isian teks.
 *
 * Dipakai untuk formulir, misalnya kota tujuan, alamat, atau sandi. Kotaknya
 * berubah warna tepi saat difokus dan kalau ada pesan galat.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps, TextStyle, ViewStyle } from 'react-native';

import { Icon } from '../theme/Icon';
import type { IconName } from '../theme/icons';
import { colors, fontFamily, radius, size, space, type } from '../theme/tokens';

const JARAK_LABEL = 6;
const TEBAL_TEPI = 1.5;
const TINGGI_MULTILINE = 88;
const UKURAN_IKON_ERROR = 16;

/** Sisa ukuran ikon supaya area sentuhnya tetap 48. */
const SENTUH_IKON = {
  top: (size.touch - size.iconSm) / 2,
  bottom: (size.touch - size.iconSm) / 2,
  left: (size.touch - size.iconSm) / 2,
  right: (size.touch - size.iconSm) / 2,
};

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
  testID?: string;
}

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
  testID,
}: TextFieldProps): React.JSX.Element {
  const [fokus, setFokus] = useState(false);

  const gayaKotak: ViewStyle[] = [styles.kotak];
  const gayaInput: TextStyle[] = [styles.input];

  if (!editable) {
    gayaKotak.push(styles.kotakNonaktif);
  } else if (error) {
    gayaKotak.push(styles.kotakGalat);
  } else if (fokus) {
    gayaKotak.push(styles.kotakFokus);
  }

  if (multiline) {
    gayaKotak.push(styles.kotakMultiline);
    gayaInput.push(styles.inputMultiline);
  }

  return (
    <View style={styles.wadah}>
      <Text style={styles.label}>
        {label}
        {optional ? <Text style={styles.opsional}> (opsional)</Text> : null}
      </Text>
      <View style={gayaKotak}>
        {prefix ? <Text style={styles.awalan}>{prefix}</Text> : null}
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
            hitSlop={SENTUH_IKON}
          >
            <Icon name={rightIcon.name} size={size.iconSm} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <View style={styles.barisGalat}>
          <Icon name="error" size={UKURAN_IKON_ERROR} color={colors.danger} />
          <Text style={styles.teksGalat}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wadah: {
    width: '100%',
  },
  label: {
    ...type.bodySm,
    fontFamily: fontFamily.bold,
    color: colors.text,
    marginBottom: JARAK_LABEL,
  },
  opsional: {
    fontFamily: fontFamily.medium,
    color: colors.textMuted,
  },
  kotak: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: size.controlMd,
    backgroundColor: colors.surface,
    borderWidth: TEBAL_TEPI,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: space[3],
    gap: space[2],
  },
  kotakFokus: {
    borderWidth: 2,
    borderColor: colors.text,
  },
  kotakGalat: {
    borderWidth: 2,
    borderColor: colors.danger,
  },
  kotakNonaktif: {
    backgroundColor: colors.bg,
    borderColor: colors.line,
  },
  kotakMultiline: {
    alignItems: 'flex-start',
  },
  awalan: {
    ...type.label,
    color: colors.textMuted,
  },
  input: {
    ...type.body,
    color: colors.text,
    flex: 1,
  },
  inputMultiline: {
    minHeight: TINGGI_MULTILINE,
    textAlignVertical: 'top',
    paddingVertical: space[3],
  },
  barisGalat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    marginTop: space[2],
  },
  teksGalat: {
    ...type.labelSm,
    color: colors.danger,
    flexShrink: 1,
  },
});
