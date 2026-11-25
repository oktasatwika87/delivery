/**
 * Tes komponen Banner.
 *
 * Banner memberi tahu pengguna soal kondisi aplikasi, dengan tombol aksi dan
 * tombol tutup opsional.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { Banner } from './Banner';
import { Button } from './Button';
import { InitialWindowProvider } from './motion/InitialWindow';
import { CheckMark } from './motion/CheckMark';
import { Icon } from '../theme/Icon';
import { ThemeProvider } from '../theme/ThemeProvider';
import { stroke, themes } from '../theme/tokens';
import type { EntryAnimationsValues, ExitAnimationsValues } from 'react-native-reanimated';

/** Nilai masuk lengkap: semua kolom target dan ukuran jendela. */
function nilaiMasuk(): EntryAnimationsValues {
  return {
    targetOriginX: 0,
    targetOriginY: 0,
    targetWidth: 320,
    targetHeight: 60,
    targetBorderRadius: 14,
    targetGlobalOriginX: 0,
    targetGlobalOriginY: 0,
    windowWidth: 360,
    windowHeight: 720,
  };
}

/** Nilai keluar lengkap: semua kolom current dan ukuran jendela. */
function nilaiKeluar(): ExitAnimationsValues {
  return {
    currentOriginX: 0,
    currentOriginY: 0,
    currentWidth: 320,
    currentHeight: 80,
    currentBorderRadius: 14,
    currentGlobalOriginX: 0,
    currentGlobalOriginY: 0,
    windowWidth: 360,
    windowHeight: 720,
  };
}

const KASUS_IKON: { tone: 'pending' | 'warning' | 'info' | 'danger'; ikon: string }[] = [
  { tone: 'pending', ikon: 'cloud_upload' },
  { tone: 'warning', ikon: 'history' },
  { tone: 'info', ikon: 'sync' },
  { tone: 'danger', ikon: 'sync_problem' },
];

describe('Banner', () => {
  it('judul dan isi tampil', () => {
    const { getByText } = render(
      <Banner tone="info" title="Sinkronisasi jalan" body="Data dikirim otomatis" />,
    );
    expect(getByText('Sinkronisasi jalan')).toBeTruthy();
    expect(getByText('Data dikirim otomatis')).toBeTruthy();
  });

  it('tanpa onClose tidak ada tombol tutup', () => {
    const { queryByLabelText } = render(<Banner tone="info" title="Judul" />);
    expect(queryByLabelText('Tutup')).toBeNull();
  });

  it('tekan tombol tutup memanggil onClose', () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <Banner tone="info" title="Judul" onClose={onClose} />,
    );
    fireEvent.press(getByLabelText('Tutup'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each(KASUS_IKON)('tone $tone memakai ikon bawaannya', (kasus) => {
    const { UNSAFE_getAllByType } = render(<Banner tone={kasus.tone} title="Judul" />);
    expect(UNSAFE_getAllByType(Icon)[0].props.name).toBe(kasus.ikon);
  });

  it('nama ikon yang diberikan menggantikan ikon bawaan', () => {
    const { UNSAFE_getAllByType } = render(
      <Banner tone="info" title="Judul" icon="info" />,
    );
    expect(UNSAFE_getAllByType(Icon)[0].props.name).toBe('info');
  });

  it('tone pending memakai tepi putus-putus', () => {
    const { toJSON } = render(<Banner tone="pending" title="Judul" />);
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.borderStyle).toBe('dashed');
    expect(gaya.borderColor).toBe(themes.gelap.pendingLine);
  });

  it('tone pending isinya rata tengah dan tingginya tetap', () => {
    const { toJSON } = render(<Banner tone="pending" title="Judul" />);
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.backgroundColor).toBeUndefined();
    expect(gaya.minHeight).toBe(52);
    expect(gaya.alignItems).toBe('center');
  });

  it('warna isi sesuai tone', () => {
    const bahaya = StyleSheet.flatten(
      render(<Banner tone="danger" title="Judul" />).toJSON().props.style,
    );
    expect(bahaya.backgroundColor).toBe(themes.gelap.dangerSoft);
    const informasi = StyleSheet.flatten(
      render(<Banner tone="info" title="Judul" />).toJSON().props.style,
    );
    expect(informasi.backgroundColor).toBe(themes.gelap.infoSoft);
  });

  it('warna ikon mengikuti tone', () => {
    const bahaya = render(<Banner tone="danger" title="Judul" />);
    expect(bahaya.UNSAFE_getAllByType(Icon)[0].props.color).toBe(themes.gelap.danger);
    const informasi = render(<Banner tone="info" title="Judul" />);
    expect(informasi.UNSAFE_getAllByType(Icon)[0].props.color).toBe(themes.gelap.info);
  });

  it('wadah memakai sudut, padding, dan jarak versi 2', () => {
    const { toJSON } = render(<Banner tone="info" title="Judul" />);
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.borderRadius).toBe(14);
    expect(gaya.paddingVertical).toBe(12);
    expect(gaya.paddingHorizontal).toBe(14);
    expect(gaya.gap).toBe(10);
  });

  it('tombol tutup berukuran 44 dengan ikon close', () => {
    const { getByLabelText, UNSAFE_getAllByType } = render(
      <Banner tone="info" title="Judul" onClose={() => {}} />,
    );
    const gaya = StyleSheet.flatten(getByLabelText('Tutup').props.style);
    expect(gaya.width).toBe(44);
    expect(gaya.height).toBe(44);
    const ikonTutup = UNSAFE_getAllByType(Icon).find((ikon) => ikon.props.name === 'close');
    expect(ikonTutup?.props.size).toBe(24);
    expect(ikonTutup?.props.color).toBe(themes.gelap.text);
  });

  it('di dalam jendela awal akar tidak punya entering', () => {
    const { toJSON } = render(
      <InitialWindowProvider>
        <Banner tone="info" title="Judul" />
      </InitialWindowProvider>,
    );
    expect(toJSON().props.entering).toBeUndefined();
  });

  it('tanpa penyedia akar punya entering', () => {
    const { toJSON } = render(<Banner tone="info" title="Judul" />);
    expect(toJSON().props.entering).toBeDefined();
  });

  it('banner tanpa judul isi teksnya bergaya sedang', () => {
    const { getByText } = render(<Banner tone="info" body="Perubahan tersimpan" />);
    const gaya = StyleSheet.flatten(getByText('Perubahan tersimpan').props.style);
    expect(gaya.fontSize).toBe(15);
    expect(gaya.color).toBe(themes.gelap.text);
  });

  it('banner dengan judul isinya bergaya kecil', () => {
    const { getByText } = render(
      <Banner tone="info" title="Sinkronisasi jalan" body="Data dikirim otomatis" />,
    );
    const gaya = StyleSheet.flatten(getByText('Data dikirim otomatis').props.style);
    expect(gaya.fontSize).toBe(14);
    expect(gaya.color).toBe(themes.gelap.text);
  });

  it('satu tombol aksi di tone danger memakai isi bahaya', () => {
    const onPress = jest.fn();
    const { UNSAFE_getAllByType, getByText } = render(
      <Banner
        tone="danger"
        title="Gagal"
        actions={[{ label: 'Hapus', onPress }]}
      />,
    );
    const tombol = UNSAFE_getAllByType(Button);
    expect(tombol).toHaveLength(1);
    expect(tombol[0].props.variant).toBe('dangerFill');
    expect(tombol[0].props.size).toBe('sm');
    fireEvent.press(getByText('Hapus'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('dua tombol aksi, yang kedua tombol hantu', () => {
    const { UNSAFE_getAllByType } = render(
      <Banner
        tone="info"
        title="Sinkronisasi jalan"
        actions={[
          { label: 'Coba lagi', onPress: jest.fn() },
          { label: 'Abaikan', onPress: jest.fn() },
        ]}
      />,
    );
    const tombol = UNSAFE_getAllByType(Button);
    expect(tombol).toHaveLength(2);
    expect(tombol[1].props.variant).toBe('ghost');
    expect(tombol[1].props.size).toBe('sm');
  });

  it('tone info tombol pertamanya isi utama', () => {
    const { UNSAFE_getAllByType } = render(
      <Banner tone="info" title="Sinkronisasi jalan" actions={[{ label: 'Coba lagi', onPress: jest.fn() }]} />,
    );
    expect(UNSAFE_getAllByType(Button)[0].props.variant).toBe('primary');
  });

  it('tone pending selesai pakai centang dan tepi utuh', () => {
    const { UNSAFE_queryByType, UNSAFE_queryAllByType, toJSON } = render(
      <Banner tone="pending" title="Menunggu" done />,
    );
    expect(UNSAFE_queryByType(CheckMark)).toBeTruthy();
    expect(
      UNSAFE_queryAllByType(Icon).some((ikon) => ikon.props.name === 'cloud_upload'),
    ).toBe(false);
    expect(StyleSheet.flatten(toJSON().props.style).borderStyle).toBe('solid');
  });

  it('tone pending belum selesai pakai ikon unggah dan tepi putus', () => {
    const { UNSAFE_queryByType, UNSAFE_queryAllByType, toJSON } = render(
      <Banner tone="pending" title="Menunggu" />,
    );
    expect(UNSAFE_queryByType(CheckMark)).toBeNull();
    expect(
      UNSAFE_queryAllByType(Icon).some((ikon) => ikon.props.name === 'cloud_upload'),
    ).toBe(true);
    expect(StyleSheet.flatten(toJSON().props.style).borderStyle).toBe('dashed');
  });

  it('tone danger mengabaikan tanda selesai', () => {
    const { UNSAFE_queryByType } = render(<Banner tone="danger" title="Gagal" done />);
    expect(UNSAFE_queryByType(CheckMark)).toBeNull();
  });

  it('tombol tutup punya margin minus sepuluh', () => {
    const { getByLabelText } = render(
      <Banner tone="info" title="Judul" onClose={() => {}} />,
    );
    const gaya = StyleSheet.flatten(getByLabelText('Tutup').props.style);
    expect(gaya.marginTop).toBe(-10);
    expect(gaya.marginBottom).toBe(-10);
    expect(gaya.marginRight).toBe(-10);
  });

  it('tanpa penyedia akar punya gerak geser dan gerak masuk keluar', () => {
    const { toJSON } = render(<Banner tone="info" title="Judul" />);
    const akar = toJSON().props;

    expect(akar.layout).toBeDefined();
    expect(typeof akar.entering).toBe('function');
    expect(typeof akar.exiting).toBe('function');
    expect(akar.entering(nilaiMasuk()).initialValues.height).toBe(0);
    expect(akar.exiting(nilaiKeluar()).initialValues.height).toBe(80);
  });

  it('di dalam jendela awal akar tidak punya gerak geser', () => {
    const { toJSON } = render(
      <InitialWindowProvider>
        <Banner tone="info" title="Judul" />
      </InitialWindowProvider>,
    );
    expect(toJSON().props.layout).toBeUndefined();
  });

  it('wadah memotong isi yang keluar', () => {
    const { toJSON } = render(<Banner tone="info" title="Judul" />);
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.overflow).toBe('hidden');
  });

  it('tone warning dengan satu aksi memakai tombol berlatar terang', () => {
    const { getByLabelText } = render(
      <ThemeProvider name="terang">
        <Banner
          tone="warning"
          title="Belang"
          actions={[{ label: 'Coba lagi', onPress: jest.fn() }]}
        />
      </ThemeProvider>,
    );

    const gaya = StyleSheet.flatten(getByLabelText('Coba lagi').props.style);
    expect(gaya.backgroundColor).toBe(themes.terang.actionSecondary);
    expect(gaya.borderColor).toBe(themes.terang.lineControl);
    expect(gaya.borderWidth).toBe(stroke.hairline);
  });

  it('aksi yang sedang memuat membuat tombol sibuk dan tidak bisa ditekan', () => {
    const onPress = jest.fn();
    const { getByLabelText, UNSAFE_getByType } = render(
      <Banner
        tone="info"
        title="Judul"
        actions={[{ label: 'Coba lagi', onPress, loading: true }]}
      />,
    );

    const tombol = getByLabelText('Coba lagi');
    expect(tombol.props.accessibilityState.busy).toBe(true);
    expect(UNSAFE_getByType(ActivityIndicator)).toBeTruthy();

    fireEvent.press(tombol);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('aksi kedua yang sedang memuat juga membuat tombolnya sibuk', () => {
    const { getByLabelText } = render(
      <Banner
        tone="info"
        title="Judul"
        actions={[
          { label: 'Coba lagi', onPress: jest.fn() },
          { label: 'Abaikan', onPress: jest.fn(), loading: true },
        ]}
      />,
    );

    expect(getByLabelText('Abaikan').props.accessibilityState.busy).toBe(true);
    expect(getByLabelText('Coba lagi').props.accessibilityState.busy).toBe(false);
  });

  it('aksi tanpa memuat membuat tombol biasa', () => {
    const onPress = jest.fn();
    const { getByLabelText, UNSAFE_queryByType } = render(
      <Banner
        tone="info"
        title="Judul"
        actions={[{ label: 'Coba lagi', onPress }]}
      />,
    );

    const tombol = getByLabelText('Coba lagi');
    expect(tombol.props.accessibilityState.busy).toBe(false);
    expect(UNSAFE_queryByType(ActivityIndicator)).toBeNull();

    fireEvent.press(tombol);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
