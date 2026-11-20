/**
 * Kartu langkah order.
 *
 * Menampilkan posisi order di antara empat langkah: Diterima, Diantar, Tunai,
 * dan Selesai. Kalau langkah order naik, ujung rel memanjang ke titik yang
 * baru, dan titik yang baru selesai digambar centangnya.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent, type TextStyle } from 'react-native';
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line, type CircleProps, type LineProps } from 'react-native-svg';
import type { OrderStatus } from '@delivery/shared';

import { perTema, useTheme } from '../theme/ThemeProvider';
import { motion, space, stroke, type } from '../theme/tokens';
import { DrawnStroke } from './motion/DrawnPath';
import { useInitialWindow } from './motion/InitialWindow';
import { standardEasing } from './motion/presets';
import { RollingNumber } from './motion/RollingNumber';
import { StatusLabel } from './StatusLabel';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedLine = Animated.createAnimatedComponent(Line);

const LABEL = ['Diterima', 'Diantar', 'Tunai', 'Selesai'];

const TINGGI_REL = 28;
const MARGIN_REL = 18;
const TITIK_Y = 14;
const RADIUS_SELESAI = 12.25;
const RADIUS_TITIK = 11;
const RADIUS_INTI = 4;
const TEBAL_REL = 4;
const TEBAL_TITIK = 2.5;
const PANJANG_CENTANG = 15.77;

/** Bentuk titik, sesuai langkahnya. */
type Bentuk = 'selesai' | 'sekarang' | 'berikutnya';

interface Riwayat {
  /** Nilai selesai yang dipakai sekarang. */
  nilai: number | null;
  /** Nilai selesai sebelum perubahan terakhir. */
  sebelumnya: number | null;
  /** True kalau perubahan terakhir layak digerakkan. */
  naik: boolean;
  /** Naik satu tiap ada perubahan, dipakai untuk tahu efeknya sudah jalan. */
  urutan: number;
}

interface WarnaTitik {
  aksi: string;
  onAksi: string;
  rail: string;
  surface: string;
}

interface GayaTema {
  nomor: TextStyle & { lineHeight: number };
  label: Record<Bentuk, TextStyle>;
}

const gaya = perTema((c): GayaTema => ({
  nomor: {
    ...type.bodyXs,
    color: c.textSubtle,
    fontVariant: ['tabular-nums'],
  },
  label: {
    selesai: { ...type.bodyXs, color: c.textMuted },
    sekarang: { ...type.labelSm, color: c.text },
    berikutnya: { ...type.bodyXs, color: c.textSubtle },
  },
}));

/** Teks angka langkah yang bergulir. */
function formatLangkah(nilai: number): string {
  return `Langkah ${nilai} dari 4`;
}

/** Bentuk titik ke-k untuk suatu jumlah langkah yang sudah selesai. */
function bentukTitik(k: number, selesai: number): Bentuk {
  if (k < selesai) {
    return 'selesai';
  }
  if (k === selesai && selesai < 4) {
    return 'sekarang';
  }
  return 'berikutnya';
}

/**
 * Properti pudar masuk untuk lingkaran.
 *
 * Kalau animasi true, opacity naik dari 0 ke 1 selama fadeIn. Kalau tidak,
 * lingkaran langsung terlihat utuh.
 */
function usePudarMasuk(animasi: boolean): Partial<CircleProps> {
  const opasitas = useSharedValue(animasi ? 0 : 1);

  useEffect(() => {
    if (!animasi) {
      opasitas.value = 1;
      return;
    }
    opasitas.value = withTiming(1, {
      duration: motion.duration.fadeIn,
      easing: standardEasing,
    });
  }, [animasi, opasitas]);

  return useAnimatedProps<CircleProps>(() => ({ opacity: opasitas.value }));
}

interface TitikProps {
  cx: number;
  /** True kalau titik ini baru berganti bentuk karena kenaikan langkah. */
  animasi: boolean;
  warna: WarnaTitik;
}

/** Titik yang sudah selesai: lingkaran terisi dan centang di dalamnya. */
function TitikSelesai({ cx, animasi, warna }: TitikProps): React.JSX.Element {
  const pudar = usePudarMasuk(animasi);

  return (
    <>
      <AnimatedCircle
        cx={cx}
        cy={TITIK_Y}
        r={RADIUS_SELESAI}
        fill={warna.aksi}
        animatedProps={pudar}
      />
      <DrawnStroke
        d={`M${cx - 5.5} 14.2 L${cx - 1.7} 18 L${cx + 5.6} 10.6`}
        length={PANJANG_CENTANG}
        color={warna.onAksi}
        strokeWidth={stroke.check}
        animate={animasi}
      />
    </>
  );
}

/** Titik yang sedang berjalan: cincin dan inti di atas lingkaran kosong. */
function TitikSekarang({ cx, animasi, warna }: TitikProps): React.JSX.Element {
  const pudar = usePudarMasuk(animasi);

  return (
    <>
      <Circle
        cx={cx}
        cy={TITIK_Y}
        r={RADIUS_TITIK}
        fill={warna.surface}
        stroke={warna.rail}
        strokeWidth={TEBAL_TITIK}
      />
      <AnimatedCircle
        cx={cx}
        cy={TITIK_Y}
        r={RADIUS_TITIK}
        fill="none"
        stroke={warna.aksi}
        strokeWidth={TEBAL_TITIK}
        animatedProps={pudar}
      />
      <AnimatedCircle cx={cx} cy={TITIK_Y} r={RADIUS_INTI} fill={warna.aksi} animatedProps={pudar} />
    </>
  );
}

/** Titik yang belum sampai: lingkaran kosong. */
function TitikBerikutnya({ cx, warna }: Omit<TitikProps, 'animasi'>): React.JSX.Element {
  return (
    <Circle
      cx={cx}
      cy={TITIK_Y}
      r={RADIUS_TITIK}
      fill={warna.surface}
      stroke={warna.rail}
      strokeWidth={TEBAL_TITIK}
    />
  );
}

export interface OrderStepsProps {
  status: OrderStatus;
  /** Teks label status, dari pemanggil. */
  statusText: string;
  /** Hasil langkahOrder. Null: hanya label status. */
  selesai: number | null;
}

export function OrderSteps({
  status,
  statusText,
  selesai,
}: OrderStepsProps): React.JSX.Element {
  const { name, colors } = useTheme();
  const s = gaya[name];
  const dalamJendela = useInitialWindow();
  const kurangiGerak = useReducedMotion();

  const [lebar, setLebar] = useState(0);
  const [riwayat, setRiwayat] = useState<Riwayat>({
    nilai: selesai,
    sebelumnya: selesai,
    naik: false,
    urutan: 0,
  });

  // Kenaikan langkah dihitung saat render, jadi tidak ada satu render yang
  // sudah menampilkan bentuk akhir tanpa geraknya.
  if (riwayat.nilai !== selesai) {
    const naik =
      riwayat.nilai !== null &&
      selesai !== null &&
      selesai > riwayat.nilai &&
      !dalamJendela &&
      !kurangiGerak;
    setRiwayat({
      nilai: selesai,
      sebelumnya: riwayat.nilai,
      naik,
      urutan: riwayat.urutan + 1,
    });
  }

  const indeksTarget = selesai === null ? 0 : Math.min(selesai, 3);
  const indeksUjung = useSharedValue(indeksTarget);

  useEffect(() => {
    if (!riwayat.naik) {
      indeksUjung.value = indeksTarget;
      return;
    }
    indeksUjung.value = withTiming(indeksTarget, {
      duration: motion.duration.drawLine,
      easing: standardEasing,
    });
  }, [indeksTarget, indeksUjung, riwayat.naik, riwayat.urutan]);

  // Ujung progres disimpan sebagai indeks titik, lalu x-nya dihitung dari
  // lebar. Jadi perubahan lebar cuma menggeser ujungnya, tidak memicu gerak.
  const animatedUjung = useAnimatedProps<LineProps>(() => ({
    x2: (lebar / 4) * (indeksUjung.value + 0.5),
  }));

  const ukurRel = useCallback((event: LayoutChangeEvent) => {
    setLebar(event.nativeEvent.layout.width);
  }, []);

  const warna: WarnaTitik = {
    aksi: colors.action,
    onAksi: colors.onAction,
    rail: colors.rail,
    surface: colors.surface,
  };

  const titik: React.ReactNode[] = [];
  const label: React.ReactNode[] = [];
  if (selesai !== null) {
    for (let k = 0; k < LABEL.length; k += 1) {
      const bentuk = bentukTitik(k, selesai);
      const bentukSebelumnya =
        riwayat.sebelumnya === null ? null : bentukTitik(k, riwayat.sebelumnya);
      const animasi = riwayat.naik && bentuk !== bentukSebelumnya;
      const cx = (lebar / 4) * (k + 0.5);

      titik.push(
        <React.Fragment key={`${bentuk}-${k}`}>
          {bentuk === 'selesai' ? (
            <TitikSelesai cx={cx} animasi={animasi} warna={warna} />
          ) : bentuk === 'sekarang' ? (
            <TitikSekarang cx={cx} animasi={animasi} warna={warna} />
          ) : (
            <TitikBerikutnya cx={cx} warna={warna} />
          )}
        </React.Fragment>,
      );

      label.push(
        <Text key={LABEL[k]} style={[styles.label, s.label[bentuk]]}>
          {LABEL[k]}
        </Text>,
      );
    }
  }

  const nomor = selesai !== null && selesai >= 1 && selesai <= 3 ? selesai + 1 : null;

  return (
    <View>
      <View style={styles.kepala}>
        <StatusLabel status={status} label={statusText} />
        {nomor === null ? null : (
          <RollingNumber value={nomor} format={formatLangkah} style={s.nomor} />
        )}
      </View>
      {selesai === null ? null : (
        <>
          <View testID="rel-langkah" style={styles.rel} onLayout={ukurRel}>
            {lebar > 0 ? (
              <Svg
                width={lebar}
                height={TINGGI_REL}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Line
                  x1={(lebar / 4) * 0.5}
                  y1={TITIK_Y}
                  x2={(lebar / 4) * 3.5}
                  y2={TITIK_Y}
                  stroke={warna.rail}
                  strokeWidth={TEBAL_REL}
                  strokeLinecap="round"
                />
                <AnimatedLine
                  x1={(lebar / 4) * 0.5}
                  y1={TITIK_Y}
                  y2={TITIK_Y}
                  stroke={warna.aksi}
                  strokeWidth={TEBAL_REL}
                  strokeLinecap="round"
                  animatedProps={animatedUjung}
                />
                {titik}
              </Svg>
            ) : null}
          </View>
          <View style={styles.barisLabel}>{label}</View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  kepala: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  rel: {
    height: TINGGI_REL,
    marginTop: MARGIN_REL,
  },
  barisLabel: {
    flexDirection: 'row',
    marginTop: space[2],
  },
  label: {
    flex: 1,
    textAlign: 'center',
  },
});
