/**
 * Kotak tunai.
 *
 * Tiga bentuk: tagih, di layar driver sebelum uang diterima, siapkan, di
 * layar customer sebelum membayar, dan diterima, sesudah pembayaran tunai
 * selesai. Isinya berganti di tempat, jadi isi yang lama keluar sementara isi
 * yang baru masuk.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { Icon } from '../theme/Icon';
import { useTheme } from '../theme/ThemeProvider';
import {
  motion,
  radius,
  size,
  space,
  stroke,
  type,
  type ThemeColors,
} from '../theme/tokens';
import { DrawnStroke } from './motion/DrawnPath';
import { exitEasing, fadeIn } from './motion/presets';
import { useGantiIsi } from './motion/useGantiIsi';

export type CashBoxVariant = 'tagih' | 'siapkan' | 'diterima';

export interface CashBoxProps {
  variant: CashBoxVariant;
  /** Jumlah yang sudah diformat pemanggil. */
  amountText: string;
}

const TEKS: Record<CashBoxVariant, string> = {
  tagih: 'Tagih tunai ke customer',
  siapkan: 'Siapkan uang tunai',
  diterima: 'Pembayaran tunai diterima',
};

/** Gaya huruf teks isi per bentuk. */
const GAYA_TEKS: Record<CashBoxVariant, TextStyle> = {
  tagih: type.bodySm,
  siapkan: type.bodyMdMedium,
  diterima: type.bodySmMedium,
};

/** Gaya huruf jumlah nominal per bentuk. */
const GAYA_JUMLAH: Record<CashBoxVariant, TextStyle> = {
  tagih: type.amountLg,
  siapkan: type.amountLg,
  diterima: type.stat,
};

const PADDING_SAMPING = 14;
const JARAK_ISI = space[3];
const UKURAN_TANDA = 24;
const PANJANG_CENTANG = 14.78;

/** Masuk lapisan isi baru: pudar masuk tanpa geser. */
const MASUK_ISI = fadeIn();

interface BentukKotak {
  /** Warna isi kotak. */
  backgroundColor: string;
  /** Warna tepi kotak. */
  borderColor: string;
  /** Warna ikon di depan isi. */
  warnaIkon: string;
  /** Warna teks isi. */
  warnaTeks: string;
  /** Warna angka nominal. */
  warnaJumlah: string;
}

/**
 * Warna kotak, tepinya, dan warna isinya untuk tiap bentuk.
 *
 * Bentuk siapkan memakai warna aksen untuk latar dan tepinya sekaligus, jadi
 * tepinya tidak terlihat tapi ukurannya sama dengan bentuk lain.
 */
function bentukKotak(colors: ThemeColors, variant: CashBoxVariant): BentukKotak {
  if (variant === 'tagih') {
    return {
      backgroundColor: colors.surface,
      borderColor: colors.accentLine,
      warnaIkon: colors.accent,
      warnaTeks: colors.textMuted,
      warnaJumlah: colors.text,
    };
  }
  if (variant === 'siapkan') {
    return {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
      warnaIkon: colors.onAccent,
      warnaTeks: colors.onAccent,
      warnaJumlah: colors.onAccent,
    };
  }
  return {
    backgroundColor: colors.infoWash,
    borderColor: colors.infoLine,
    warnaIkon: colors.info,
    warnaTeks: colors.text,
    warnaJumlah: colors.text,
  };
}

interface IsiProps {
  variant: CashBoxVariant;
  amountText: string;
  /** Kalau true, centang digambar dari awal ke akhir. */
  animate: boolean;
}

function IsiKotak({ variant, amountText, animate }: IsiProps): React.JSX.Element {
  const { colors } = useTheme();
  // Status centang dibaca sekali saat lapisan ini dipasang, supaya centang
  // yang sedang digambar tidak melompat jadi utuh saat isi lama selesai keluar.
  const [gambarCentang] = useState(animate);

  const bentuk = bentukKotak(colors, variant);

  return (
    <>
      {variant === 'diterima' ? (
        <Svg width={UKURAN_TANDA} height={UKURAN_TANDA} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={11} fill={colors.infoFill} />
          <DrawnStroke
            d="M6.8 12.3 L10.4 15.8 L17.3 8.9"
            length={PANJANG_CENTANG}
            color={colors.onInfoFill}
            strokeWidth={stroke.check}
            animate={gambarCentang}
          />
        </Svg>
      ) : (
        <Icon name="payments" size={size.icon} color={bentuk.warnaIkon} />
      )}
      <Text
        style={[styles.teks, GAYA_TEKS[variant], { color: bentuk.warnaTeks }]}
      >
        {TEKS[variant]}
      </Text>
      <Text style={[GAYA_JUMLAH[variant], { color: bentuk.warnaJumlah }]}>
        {amountText}
      </Text>
    </>
  );
}

interface LapisanLamaProps {
  variant: CashBoxVariant;
  amountText: string;
  /** Nomor pergantian yang sedang ditutup. */
  nomor: number;
  /** Dipanggil saat isi lama selesai pudar. */
  selesai: (nomor: number) => void;
}

function LapisanLama({
  variant,
  amountText,
  nomor,
  selesai,
}: LapisanLamaProps): React.JSX.Element {
  const { colors } = useTheme();
  const opasitas = useSharedValue(1);
  const bentuk = bentukKotak(colors, variant);

  useEffect(() => {
    opasitas.value = withTiming(
      0,
      { duration: motion.duration.fadeOut, easing: exitEasing },
      (habis) => {
        if (habis) {
          runOnJS(selesai)(nomor);
        }
      },
    );
  }, [nomor, opasitas, selesai]);

  const gaya = useAnimatedStyle(() => ({ opacity: opasitas.value }));

  return (
    <Animated.View
      testID="isi-kotak-lama"
      style={[
        styles.lapisanLama,
        {
          backgroundColor: bentuk.backgroundColor,
          borderColor: bentuk.borderColor,
        },
        gaya,
      ]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <IsiKotak variant={variant} amountText={amountText} animate={false} />
    </Animated.View>
  );
}

export function CashBox({ variant, amountText }: CashBoxProps): React.JSX.Element {
  const { colors } = useTheme();
  const ganti = useGantiIsi({ variant, amountText }, `${variant}|${amountText}`);
  const bentuk = bentukKotak(colors, variant);
  // Centang digambar saat bentuk diterima datang dari bentuk yang menagih
  // atau menyiapkan uang, bukan dari bentuk diterima yang sebelumnya.
  const dariTagih = ganti.lama?.variant === 'tagih' && variant === 'diterima';
  const dariSiapkan = ganti.lama?.variant === 'siapkan' && variant === 'diterima';

  return (
    <View
      testID="kotak-tunai"
      accessible
      accessibilityLabel={`${TEKS[variant]}, ${amountText}`}
      style={[
        styles.kotak,
        {
          backgroundColor: bentuk.backgroundColor,
          borderColor: bentuk.borderColor,
        },
      ]}
    >
      <Animated.View
        key={ganti.nomor}
        entering={ganti.nomor > 0 ? MASUK_ISI : undefined}
        style={styles.lapisan}
      >
        <IsiKotak
          variant={variant}
          amountText={amountText}
          animate={dariTagih || dariSiapkan}
        />
      </Animated.View>
      {ganti.lama ? (
        <LapisanLama
          key={`lama-${ganti.nomor}`}
          variant={ganti.lama.variant}
          amountText={ganti.lama.amountText}
          nomor={ganti.nomor}
          selesai={ganti.selesai}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  kotak: {
    minHeight: size.cashbox,
    paddingVertical: space[2],
    paddingHorizontal: PADDING_SAMPING,
    borderRadius: radius.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: JARAK_ISI,
    borderWidth: stroke.hairline,
  },
  lapisan: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: JARAK_ISI,
  },
  lapisanLama: {
    position: 'absolute',
    top: -stroke.hairline,
    left: -stroke.hairline,
    right: -stroke.hairline,
    bottom: -stroke.hairline,
    paddingHorizontal: PADDING_SAMPING,
    paddingVertical: space[2],
    borderRadius: radius.xl,
    borderWidth: stroke.hairline,
    flexDirection: 'row',
    alignItems: 'center',
    gap: JARAK_ISI,
  },
  teks: {
    flex: 1,
  },
});
