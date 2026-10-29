/**
 * Kepala layar.
 *
 * MainHeader dipakai di layar utama tiap peran: kepala gelap berisi logo,
 * nama peran, dan tombol keluar. AppBar dipakai di layar turunan: bar putih
 * berisi judul, tombol kembali, dan isi kanan kalau ada.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../theme/Icon';
import { Logo } from '../theme/Logo';
import { colors, size, space, type } from '../theme/tokens';

const TINGGI_LOGO = 32;
const TEBAL_GARIS = 1;

export interface MainHeaderProps {
  title: string;
  subtitle: string;
  onLogout: () => void;
  children?: React.ReactNode;
}

export interface AppBarProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
}

export function MainHeader({
  title,
  subtitle,
  onLogout,
  children,
}: MainHeaderProps): React.JSX.Element {
  return (
    <View style={styles.kepalaGelap}>
      <View style={styles.baris}>
        <Logo variant="inverse" height={TINGGI_LOGO} />
        <View style={styles.judulArea}>
          <Text style={styles.judulGelap}>{title}</Text>
          <Text style={styles.subjudulGelap}>{subtitle}</Text>
        </View>
        <Pressable
          onPress={onLogout}
          accessibilityRole="button"
          accessibilityLabel="Keluar"
          style={styles.tombolKeluar}
        >
          <Icon name="logout" size={size.iconSm} color={colors.textInverse} />
          <Text style={styles.teksKeluar}>Keluar</Text>
        </Pressable>
      </View>
      {children}
    </View>
  );
}

export function AppBar({ title, subtitle, onBack, right }: AppBarProps): React.JSX.Element {
  return (
    <View style={styles.barPutih}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Kembali"
          style={styles.tombolKembali}
        >
          <Icon name="arrow_back" size={size.icon} color={colors.text} />
        </Pressable>
      ) : null}
      <View style={styles.judulArea}>
        <Text style={styles.judulPutih} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.subjudulPutih}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  kepalaGelap: {
    backgroundColor: colors.surfaceInverse,
  },
  baris: {
    flexDirection: 'row',
    alignItems: 'center',
    height: size.appbar,
    paddingLeft: space[4],
    paddingRight: space[2],
    gap: space[3],
  },
  judulArea: {
    flex: 1,
  },
  judulGelap: {
    ...type.titleLg,
    color: colors.textInverse,
  },
  subjudulGelap: {
    ...type.caption,
    color: colors.textInverseMuted,
  },
  tombolKeluar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: size.touch,
    paddingHorizontal: space[3],
    gap: space[2],
  },
  teksKeluar: {
    ...type.label,
    color: colors.textInverse,
  },
  barPutih: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    height: size.appbar,
    paddingHorizontal: space[2],
    gap: space[2],
    borderBottomWidth: TEBAL_GARIS,
    borderBottomColor: colors.line,
  },
  tombolKembali: {
    width: size.touch,
    height: size.touch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  judulPutih: {
    ...type.titleMd,
    color: colors.text,
  },
  subjudulPutih: {
    ...type.overline,
    color: colors.textMuted,
  },
});
