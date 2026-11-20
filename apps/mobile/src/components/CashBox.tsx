/**
 * Kotak tunai.
 *
 * Dua bentuk: tagih, saat uang masih diminta ke customer, dan diterima,
 * setelah pembayaran tunai selesai. Isinya berganti di tempat, jadi isi yang
 * lama keluar sementara isi yang baru masuk.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { Icon } from '../theme/Icon';
import { useTheme } from '../theme/ThemeProvider';
import { motion, radius, size, space, stroke, type } from '../theme/tokens';
import { DrawnStroke } from './motion/DrawnPath';
import { exitEasing, fadeIn } from './motion/presets';
import { useGantiIsi } from './motion/useGantiIsi';

export type CashBoxVariant = 'tagih' | 'diterima';

export interface CashBoxProps {
  variant: CashBoxVariant;
  /** Jumlah yang sudah diformat pemanggil. */
  amountText: string;
}

const TEKS: Record<CashBoxVariant, string> = {
  tagih: 'Tagih tunai ke customer',
  diterima: 'Pembayaran tunai diterima',
};

const PADDING_SAMPING = 14;
const JARAK_ISI = space[3];
const UKURAN_TANDA = 24;
const PANJANG_CENTANG = 14.78;

/** Masuk lapisan isi baru: pudar masuk tanpa geser. */
const MASUK_ISI = fadeIn();

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

  return (
    <>
      {variant === 'tagih' ? (
        <Icon name="payments" size={size.icon} color={colors.accent} />
      ) : (
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
      )}
      <Text
        style={[
          styles.teks,
          variant === 'tagih' ? styles.teksTagih : styles.teksDiterima,
          { color: variant === 'tagih' ? colors.textMuted : colors.text },
        ]}
      >
        {TEKS[variant]}
      </Text>
      <Text
        style={[
          variant === 'tagih' ? styles.jumlahTagih : styles.jumlahDiterima,
          { color: colors.text },
        ]}
      >
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
  const opasitas = useSharedValue(1);

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
      style={[styles.lapisanLama, gaya]}
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
  const dariTagih = ganti.lama?.variant === 'tagih' && variant === 'diterima';

  return (
    <View
      testID="kotak-tunai"
      accessible
      accessibilityLabel={`${TEKS[variant]}, ${amountText}`}
      style={[
        styles.kotak,
        {
          backgroundColor: variant === 'tagih' ? colors.surface : colors.infoWash,
          borderColor: variant === 'tagih' ? colors.accentLine : colors.infoLine,
        },
      ]}
    >
      <Animated.View
        key={ganti.nomor}
        entering={ganti.nomor > 0 ? MASUK_ISI : undefined}
        style={styles.lapisan}
      >
        <IsiKotak variant={variant} amountText={amountText} animate={dariTagih} />
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
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: PADDING_SAMPING,
    flexDirection: 'row',
    alignItems: 'center',
    gap: JARAK_ISI,
  },
  teks: {
    flex: 1,
  },
  teksTagih: {
    ...type.bodySm,
  },
  teksDiterima: {
    ...type.bodySmMedium,
  },
  jumlahTagih: {
    ...type.amountLg,
  },
  jumlahDiterima: {
    ...type.stat,
  },
});
