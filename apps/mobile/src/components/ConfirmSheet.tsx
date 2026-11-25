/**
 * Lembar konfirmasi dari bawah.
 *
 * Lembar muncul dari bawah layar untuk minta kepastian pengguna. Di bagian
 * ini belum ada geraknya, jadi lembar langsung tampil dan langsung hilang.
 */

import React, { useCallback, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from './Button';
import { RiderArt, UKURAN_RIDER } from './RiderArt';
import { useTheme } from '../theme/ThemeProvider';
import { elevation, radius, space, type } from '../theme/tokens';

/** Jarak gambar motor dari tepi lembar. */
const MARGIN_GAMBAR = 12;
/** Tinggi baris gambar motor. */
const TINGGI_BARIS = 80;
/** Tebal garis rel dan garis biru di baris gambar. */
const TEBAL_GARIS = 3 * UKURAN_RIDER.skala;
/** Panjang garis biru, dari tepi baris sampai roda depan. */
const PANJANG_GARIS_BIRU = MARGIN_GAMBAR + UKURAN_RIDER.ujungRodaDepanX;

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

interface Keadaan {
  /** Visible terakhir yang dilihat, dipakai untuk tahu lembar dibuka lagi. */
  visible: boolean;
  /** True kalau lembar sedang terpasang. */
  terpasang: boolean;
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
  const [keadaan, setKeadaan] = useState<Keadaan>({
    visible,
    terpasang: visible,
  });

  // Pembukaan dan penutupan dihitung saat render, jadi tidak ada satu render
  // yang sudah menampilkan lembar padahal pemanggil sudah menutupnya.
  if (keadaan.visible !== visible) {
    setKeadaan({ visible, terpasang: visible });
  }

  const lepas = useCallback(() => {
    setKeadaan((sekarang) => ({ ...sekarang, terpasang: false }));
  }, []);

  const pilihYa = useCallback(() => {
    onConfirm();
    lepas();
  }, [onConfirm, lepas]);

  const pilihTidak = useCallback(() => {
    onCancel();
    lepas();
  }, [onCancel, lepas]);

  if (!keadaan.terpasang) {
    return null;
  }

  // Tema terang pakai elevasi, tema gelap ambil kedalaman dari warnanya.
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
        <Pressable
          testID="latar-lembar"
          onPress={pilihTidak}
          accessible={false}
          importantForAccessibility="no"
          style={[styles.latar, { backgroundColor: colors.scrim }]}
        />
        <View
          testID="lembar-konfirmasi"
          onAccessibilityEscape={pilihTidak}
          style={[
            styles.lembar,
            { backgroundColor: colors.surface, paddingBottom: space[4] + inset.bottom },
            bayangan,
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
              <RiderArt />
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
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  akar: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  latar: {
    flex: 1,
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
