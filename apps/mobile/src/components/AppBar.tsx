/**
 * Kepala layar.
 *
 * MainHeader dipakai di layar utama tiap peran: kepala gelap berisi logo,
 * nama peran, dan tombol keluar. AppBar dipakai di layar turunan: bar
 * berisi judul, tombol kembali, dan isi kanan kalau ada.
 *
 * Isi kedua kepala selalu memakai tema gelap, jadi warnanya diambil di dalam
 * bungkus tema gelap. Wadahnya sendiri memakai warna kepala dari tema peran.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '../theme/Icon';
import { Logo } from '../theme/Logo';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { radius, size, space, stroke, type } from '../theme/tokens';

const TINGGI_LOGO = 43;

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
  const { colors } = useTheme();

  return (
    <View style={[styles.kepala, { backgroundColor: colors.header }]}>
      <ThemeProvider name="gelap">
        <IsiKepala title={title} subtitle={subtitle} onLogout={onLogout} />
        {children}
      </ThemeProvider>
    </View>
  );
}

/** Isi kepala utama, selalu di dalam bungkus tema gelap. */
function IsiKepala({
  title,
  subtitle,
  onLogout,
}: MainHeaderProps): React.JSX.Element {
  const { colors } = useTheme();

  return (
    <View style={styles.baris}>
      <Logo height={TINGGI_LOGO} />
      <View style={styles.judulArea}>
        <Text style={[styles.judul, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.subjudul, { color: colors.textSubtle }]}>{subtitle}</Text>
      </View>
      <Pressable
        onPress={onLogout}
        accessibilityRole="button"
        accessibilityLabel="Keluar"
        style={[
          styles.tombolKeluar,
          { backgroundColor: colors.surface, borderColor: colors.lineControl },
        ]}
      >
        <Icon name="logout" size={size.iconSm} color={colors.textMuted} />
        <Text style={[styles.teksKeluar, { color: colors.text }]}>Keluar</Text>
      </Pressable>
    </View>
  );
}

export function AppBar({ title, subtitle, onBack, right }: AppBarProps): React.JSX.Element {
  const { colors } = useTheme();

  return (
    <View style={[styles.kepala, { backgroundColor: colors.header }]}>
      <ThemeProvider name="gelap">
        <IsiAppBar title={title} subtitle={subtitle} onBack={onBack} right={right} />
      </ThemeProvider>
    </View>
  );
}

/** Isi bar turunan, selalu di dalam bungkus tema gelap. */
function IsiAppBar({ title, subtitle, onBack, right }: AppBarProps): React.JSX.Element {
  const { colors } = useTheme();

  return (
    <View style={styles.barisAppBar}>
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
      <View style={styles.judulAreaAppBar}>
        <Text style={[styles.judulAppBar, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.nomorOrder, { color: colors.textSubtle }]}>{subtitle}</Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  kepala: {
    width: '100%',
  },
  baris: {
    flexDirection: 'row',
    alignItems: 'center',
    height: size.header,
    paddingLeft: space[4],
    paddingRight: space[3],
    gap: space[3],
  },
  judulArea: {
    flex: 1,
  },
  judul: {
    ...type.titleMd,
  },
  subjudul: {
    ...type.bodyXs,
  },
  tombolKeluar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: size.controlMd,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    borderWidth: stroke.hairline,
    gap: space[2],
  },
  teksKeluar: {
    ...type.bodyMdMedium,
  },
  barisAppBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: size.appbar,
    paddingLeft: space[1],
    paddingRight: space[3],
    gap: space[2],
  },
  tombolKembali: {
    width: size.touch,
    height: size.touch,
    alignItems: 'center',
    justifyContent: 'center',
  },
  judulAreaAppBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  judulAppBar: {
    ...type.titleXs,
  },
  nomorOrder: {
    ...type.bodyXs,
    marginLeft: space[2],
  },
});
