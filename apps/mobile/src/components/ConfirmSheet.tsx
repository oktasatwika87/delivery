/**
 * Lembar konfirmasi dari bawah.
 *
 * Lembar muncul dari bawah layar untuk minta kepastian pengguna. Lembar naik
 * sambil motornya jalan ke kanan, dan keluar dengan motor berbalik ke kiri
 * kalau pembatalannya yang dipilih.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from './Button';
import { RiderArt, UKURAN_RIDER } from './RiderArt';
import { exitEasing, standardEasing } from './motion/presets';
import { useTheme } from '../theme/ThemeProvider';
import { elevation, motion, radius, space, type } from '../theme/tokens';

/** Jarak gambar motor dari tepi lembar. */
const MARGIN_GAMBAR = 12;
/** Tinggi baris gambar motor. */
const TINGGI_BARIS = 80;
/** Tebal garis rel dan garis biru di baris gambar. */
const TEBAL_GARIS = 3 * UKURAN_RIDER.skala;
/** Panjang garis biru, dari tepi baris sampai roda depan. */
const PANJANG_GARIS_BIRU = MARGIN_GAMBAR + UKURAN_RIDER.ujungRodaDepanX;

/** Durasi motor berjalan ke tempatnya saat lembar dibuka. */
const DURASI_MASUK_GESER = 450;
/** Jeda motor berjalan setelah lembar mulai naik. */
const JEDA_MASUK_GESER = 60;
/** Durasi gambar berbalik arah. */
const DURASI_BALIK = 100;
/** Durasi motor berjalan ke kiri saat pembatalan. */
const DURASI_KELUAR_GESER = 360;
/** Jeda lembar turun saat keluar. */
const JEDA_KELUAR_NAIK = 140;
/** Jeda latar pudar saat keluar. */
const JEDA_KELUAR_LATAR = 300;

export type ConfirmSheetTone = 'primary' | 'danger';

export interface ConfirmSheetProps {
  /** True kalau lembar harus tampil. */
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** Teks tombol batal. Bawaannya Tidak. */
  cancelLabel?: string;
  /** Nada tombol Ya. Bawaannya primary. */
  tone?: ConfirmSheetTone;
  /** Dipanggil saat tombol Ya ditekan. */
  onConfirm: () => void;
  /** Dipanggil saat tombol Tidak ditekan atau lembar ditutup dari luar. */
  onCancel: () => void;
}

/**
 * Lembar konfirmasi dari bawah.
 *
 * Pemanggil mengubah `visible` jadi false di dalam `onConfirm` dan
 * `onCancel`. Kalau tidak, lembar tetap terpasang dan tombolnya menganggur.
 */
export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Tidak',
  tone = 'primary',
  onConfirm,
  onCancel,
}: ConfirmSheetProps): React.JSX.Element | null {
  const { name, colors } = useTheme();
  const inset = useSafeAreaInsets();

  const latar = useSharedValue(0);
  const naik = useSharedValue(0);
  const geser = useSharedValue(0);
  const arah = useSharedValue(1);
  const opasitasLembar = useSharedValue(0);

  const [terpasang, setTerpasang] = useState(visible);
  const [lebarLembar, setLebarLembar] = useState(0);
  const [tinggiLembar, setTinggiLembar] = useState(0);

  /** True kalau sedang keluar, supaya geraknya tidak dijalankan dua kali. */
  const sedangKeluar = useRef(false);
  /** True kalau lembar sudah pernah diukur, jadi geraknya jalan sekali saja. */
  const sudahTerukur = useRef(false);
  /** Nilai visible terakhir, buat tahu pemanggil membuka atau menutup lembar. */
  const visibleTerakhir = useRef(visible);

  const lepas = useCallback(() => {
    setTerpasang(false);
  }, []);

  /** Keluar karena pembatalan: motor berbalik lalu jalan ke kiri. */
  const keluarBatal = useCallback(() => {
    if (sedangKeluar.current) return;
    sedangKeluar.current = true;

    arah.value = withTiming(-1, {
      duration: DURASI_BALIK,
      easing: standardEasing,
    });
    geser.value = withTiming(-(MARGIN_GAMBAR + UKURAN_RIDER.lebar), {
      duration: DURASI_KELUAR_GESER,
      easing: exitEasing,
    });
    naik.value = withDelay(
      JEDA_KELUAR_NAIK,
      withTiming(tinggiLembar, {
        duration: motion.duration.exit,
        easing: exitEasing,
      }),
    );
    latar.value = withDelay(
      JEDA_KELUAR_LATAR,
      withTiming(
        0,
        { duration: motion.duration.fadeOut, easing: exitEasing },
        (habis) => {
          if (habis) runOnJS(lepas)();
        },
      ),
    );
  }, [arah, geser, latar, naik, tinggiLembar, lepas]);

  /** Keluar karena Ya: motor jalan ke kanan sampai keluar dari tepi lembar. */
  const keluarYa = useCallback(() => {
    if (sedangKeluar.current) return;
    sedangKeluar.current = true;

    geser.value = withTiming(lebarLembar - MARGIN_GAMBAR, {
      duration: motion.duration.exit,
      easing: exitEasing,
    });
    naik.value = withDelay(
      JEDA_KELUAR_NAIK,
      withTiming(tinggiLembar, {
        duration: motion.duration.exit,
        easing: exitEasing,
      }),
    );
    latar.value = withDelay(
      JEDA_KELUAR_LATAR,
      withTiming(
        0,
        { duration: motion.duration.fadeOut, easing: exitEasing },
        (habis) => {
          if (habis) runOnJS(lepas)();
        },
      ),
    );
  }, [geser, latar, naik, lebarLembar, tinggiLembar, lepas]);

  const pilihYa = useCallback(() => {
    onConfirm();
    keluarYa();
  }, [onConfirm, keluarYa]);

  const pilihTidak = useCallback(() => {
    onCancel();
    keluarBatal();
  }, [onCancel, keluarBatal]);

  // Lembar yang dibuka lagi dipasang ulang dan geraknya diulang dari awal.
  useEffect(() => {
    if (visible === visibleTerakhir.current) return;
    visibleTerakhir.current = visible;

    if (visible) {
      sedangKeluar.current = false;
      sudahTerukur.current = false;
      opasitasLembar.value = 0;
      setTerpasang(true);
      return;
    }

    // Ditutup dari luar: keluar seperti pembatalan, tanpa memanggil apa pun.
    keluarBatal();
  }, [visible, keluarBatal, opasitasLembar]);

  // Ukuran lembar diketahui dari pengukuran pertamanya, lalu geraknya mulai.
  const ukurLembar = useCallback(
    (peristiwa: LayoutChangeEvent) => {
      const { width, height } = peristiwa.nativeEvent.layout;
      setLebarLembar(width);
      setTinggiLembar(height);
      if (sudahTerukur.current) return;
      sudahTerukur.current = true;

      opasitasLembar.value = 1;
      naik.value = height;
      geser.value = -(MARGIN_GAMBAR + UKURAN_RIDER.lebar);
      arah.value = 1;
      latar.value = 0;

      latar.value = withTiming(1, {
        duration: motion.duration.fadeIn,
        easing: standardEasing,
      });
      naik.value = withTiming(0, {
        duration: motion.duration.enter,
        easing: standardEasing,
      });
      geser.value = withDelay(
        JEDA_MASUK_GESER,
        withTiming(0, {
          duration: DURASI_MASUK_GESER,
          easing: standardEasing,
        }),
      );
    },
    [arah, geser, latar, naik, opasitasLembar],
  );

  const gayaLatar = useAnimatedStyle(() => ({ opacity: latar.value }));
  const gayaLembar = useAnimatedStyle(() => ({
    transform: [{ translateY: naik.value }],
    opacity: opasitasLembar.value,
  }));

  if (!terpasang) {
    return null;
  }

  // Tema terang memakai elevasi, tema gelap ambil kedalaman dari warnanya.
  const bayangan = name === 'terang' ? { elevation: elevation.overlay } : null;
  const tinggiGaris = UKURAN_RIDER.dasarRodaY - TEBAL_GARIS / 2;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={pilihTidak}
    >
      <View style={styles.akar}>
        <Animated.View
          testID="pembungkus-latar"
          style={[StyleSheet.absoluteFill, gayaLatar]}
          pointerEvents="box-none"
        >
          <Pressable
            testID="latar-lembar"
            onPress={pilihTidak}
            accessible={false}
            importantForAccessibility="no"
            style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
          />
        </Animated.View>
        <Animated.View
          testID="lembar-konfirmasi"
          onLayout={ukurLembar}
          onAccessibilityEscape={pilihTidak}
          style={[
            styles.lembar,
            {
              backgroundColor: colors.surface,
              paddingBottom: space[4] + inset.bottom,
            },
            bayangan,
            gayaLembar,
          ]}
        >
          <View
            testID="baris-motor"
            style={styles.barisMotor}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View
              style={[
                styles.garis,
                styles.garisPenuh,
                {
                  top: tinggiGaris,
                  backgroundColor: colors.rail,
                },
              ]}
            />
            <View
              testID="garis-biru"
              style={[
                styles.garis,
                {
                  top: tinggiGaris,
                  width: PANJANG_GARIS_BIRU,
                  backgroundColor: colors.info,
                },
              ]}
            />
            <View style={styles.gambar}>
              <RiderArt geser={geser} arah={arah} />
            </View>
          </View>
          <Text
            accessibilityRole="header"
            style={[styles.judul, { color: colors.text }]}
          >
            {title}
          </Text>
          <Text style={[styles.isi, { color: colors.textMuted }]}>{message}</Text>
          <View style={styles.tombol}>
            <Button
              title={confirmLabel}
              onPress={pilihYa}
              size="lg"
              variant={tone === 'danger' ? 'dangerFill' : 'primary'}
            />
            <Button
              title={cancelLabel}
              onPress={pilihTidak}
              size="lg"
              variant="ghost"
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  akar: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  lembar: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    overflow: 'hidden',
    paddingTop: space[6],
    paddingHorizontal: space[6],
    paddingBottom: space[4],
    gap: space[3],
  },
  barisMotor: {
    height: TINGGI_BARIS,
    marginHorizontal: -space[6],
  },
  garis: {
    position: 'absolute',
    left: 0,
    height: TEBAL_GARIS,
    borderRadius: TEBAL_GARIS / 2,
  },
  garisPenuh: {
    right: 0,
  },
  gambar: {
    position: 'absolute',
    left: MARGIN_GAMBAR,
    top: 0,
  },
  judul: {
    ...type.titleMd,
  },
  isi: {
    ...type.body,
  },
  tombol: {
    flexDirection: 'column',
    gap: space[2],
    marginTop: space[2],
  },
});
