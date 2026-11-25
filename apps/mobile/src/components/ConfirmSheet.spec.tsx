/**
 * Tes komponen ConfirmSheet.
 *
 * Lembar konfirmasi dari bawah: judul, isi, dua tombol, dan aturan melepasnya
 * lembar setelah pilihan pertama.
 */

import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import * as reanimated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from './Button';
import { ConfirmSheet } from './ConfirmSheet';
import { exitEasing, standardEasing } from './motion/presets';
import { ThemeProvider } from '../theme/ThemeProvider';
import { elevation, themes } from '../theme/tokens';

interface Opsi {
  visible?: boolean;
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  tema?: 'terang' | 'gelap';
}

function lembar({
  visible = true,
  title = 'Batalkan order?',
  message = 'Order yang dibatalkan tidak bisa dikembalikan lagi.',
  confirmLabel = 'Ya, batalkan',
  cancelLabel = 'Tidak',
  tone = 'primary',
  tema,
}: Opsi = {}): React.JSX.Element {
  const isi = (
    <ConfirmSheet
      visible={visible}
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      cancelLabel={cancelLabel}
      tone={tone}
      onConfirm={jest.fn()}
      onCancel={jest.fn()}
    />
  );
  return tema ? <ThemeProvider name={tema}>{isi}</ThemeProvider> : isi;
}

/** Mengukur lembar, supaya geraknya bisa dimulai. */
function ukur(
  pohon: ReturnType<typeof render>,
  lebar = 360,
  tinggi = 300,
): void {
  fireEvent(pohon.getByTestId('lembar-konfirmasi'), 'layout', {
    nativeEvent: {
      layout: { x: 0, y: 0, width: lebar, height: tinggi },
    },
  });
}

describe('ConfirmSheet', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('tidak terpasang tidak menggambar Modal', () => {
    const pohon = render(lembar({ visible: false }));

    expect(pohon.UNSAFE_queryByType(Modal)).toBeNull();
  });

  it('Modal dipasang dengan prop yang benar', () => {
    const pohon = render(lembar());

    const modal = pohon.UNSAFE_getByType(Modal);
    expect(modal.props.visible).toBe(true);
    expect(modal.props.transparent).toBe(true);
    expect(modal.props.animationType).toBe('none');
    expect(modal.props.statusBarTranslucent).toBe(true);
    expect(typeof modal.props.onRequestClose).toBe('function');
  });

  it('judul, isi, dan dua tombol tampil', () => {
    const pohon = render(lembar());

    expect(pohon.getByText('Batalkan order?')).toBeTruthy();
    expect(
      pohon.getByText('Order yang dibatalkan tidak bisa dikembalikan lagi.'),
    ).toBeTruthy();
    expect(pohon.getByLabelText('Ya, batalkan')).toBeTruthy();
    expect(pohon.getByLabelText('Tidak')).toBeTruthy();
  });

  it('judul berperan sebagai kepala untuk pembaca layar', () => {
    const pohon = render(lembar());

    const judul = pohon.getByText('Batalkan order?');
    expect(judul.props.accessibilityRole).toBe('header');
  });

  it('Ya memanggil onConfirm sekali lalu lembar dilepas', () => {
    const onConfirm = jest.fn();
    const pohon = render(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );

    fireEvent.press(pohon.getByLabelText('Ya'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(pohon.UNSAFE_queryByType(Modal)).toBeNull();
  });

  it('tombol Tidak memanggil onCancel sekali', () => {
    const onCancel = jest.fn();
    const pohon = render(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.press(pohon.getByLabelText('Tidak'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(pohon.UNSAFE_queryByType(Modal)).toBeNull();
  });

  it('ketuk latar memanggil onCancel sekali', () => {
    const onCancel = jest.fn();
    const pohon = render(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.press(pohon.getByTestId('latar-lembar'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(pohon.UNSAFE_queryByType(Modal)).toBeNull();
  });

  it('tombol kembali Android memanggil onCancel sekali', () => {
    const onCancel = jest.fn();
    const pohon = render(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent(pohon.UNSAFE_getByType(Modal), 'requestClose');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(pohon.UNSAFE_queryByType(Modal)).toBeNull();
  });

  it('gestur escape di lembar memanggil onCancel sekali', () => {
    const onCancel = jest.fn();
    const pohon = render(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent(pohon.getByTestId('lembar-konfirmasi'), 'accessibilityEscape');

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(pohon.UNSAFE_queryByType(Modal)).toBeNull();
  });

  it('latar menutupi seluruh layar di belakang lembar', () => {
    const pohon = render(lembar());

    const gaya = StyleSheet.flatten(
      pohon.getByTestId('pembungkus-latar').props.style,
    );
    expect(gaya.position).toBe('absolute');
    expect(gaya.top).toBe(0);
    expect(gaya.right).toBe(0);
    expect(gaya.bottom).toBe(0);
    expect(gaya.left).toBe(0);
  });

  it('latar tidak bisa difokus pembaca layar', () => {
    const pohon = render(lembar());

    const latar = pohon.getByTestId('latar-lembar');
    expect(latar.props.accessible).toBe(false);
    expect(latar.props.importantForAccessibility).toBe('no');
  });

  it('ditutup dari luar melepas lembar tanpa memanggil apa pun', () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    const pohon = render(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    pohon.rerender(
      <ConfirmSheet
        visible={false}
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(pohon.UNSAFE_queryByType(Modal)).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('dibuka lagi tampil lagi dan ketukannya aktif lagi', () => {
    const onConfirm = jest.fn();
    const pohon = render(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );

    fireEvent.press(pohon.getByLabelText('Ya'));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    pohon.rerender(
      <ConfirmSheet
        visible={false}
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );
    pohon.rerender(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );

    expect(pohon.UNSAFE_queryByType(Modal)).not.toBeNull();
    fireEvent.press(pohon.getByLabelText('Ya'));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it('ketukan kedua setelah pilihan pertama diabaikan', () => {
    jest
      .spyOn(reanimated, 'withTiming')
      .mockImplementation((nilaiAkhir) => nilaiAkhir);
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const pohon = render(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.press(pohon.getByLabelText('Ya'));
    fireEvent.press(pohon.getByLabelText('Ya'));
    fireEvent.press(pohon.getByTestId('latar-lembar'));
    fireEvent(pohon.UNSAFE_getByType(Modal), 'requestClose');
    fireEvent(pohon.getByTestId('lembar-konfirmasi'), 'accessibilityEscape');

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Tidak lalu Ya memanggil onCancel sekali dan tidak memanggil onConfirm', () => {
    jest
      .spyOn(reanimated, 'withTiming')
      .mockImplementation((nilaiAkhir) => nilaiAkhir);
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const pohon = render(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.press(pohon.getByLabelText('Tidak'));
    fireEvent.press(pohon.getByLabelText('Ya'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('ditutup dari luar lalu ketukan berikutnya diabaikan', () => {
    jest
      .spyOn(reanimated, 'withTiming')
      .mockImplementation((nilaiAkhir) => nilaiAkhir);
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const pohon = render(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    pohon.rerender(
      <ConfirmSheet
        visible={false}
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    fireEvent.press(pohon.getByLabelText('Ya'));
    fireEvent.press(pohon.getByLabelText('Tidak'));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('lembar yang dibuka lagi selagi keluar tidak hilang', () => {
    const timing = jest
      .spyOn(reanimated, 'withTiming')
      .mockImplementation((nilaiAkhir) => nilaiAkhir);
    const onConfirm = jest.fn();
    const pohon = render(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );
    ukur(pohon);

    fireEvent.press(pohon.getByLabelText('Tidak'));
    pohon.rerender(
      <ConfirmSheet
        visible={false}
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );
    timing.mockClear();
    pohon.rerender(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );

    expect(pohon.UNSAFE_queryByType(Modal)).not.toBeNull();
    const gaya = StyleSheet.flatten(
      pohon.getByTestId('lembar-konfirmasi').props.style,
    );
    expect(gaya.opacity).toBe(1);
    expect(timing).toHaveBeenCalledWith(1, {
      duration: 180,
      easing: standardEasing,
    });
    expect(timing).toHaveBeenCalledWith(0, {
      duration: 380,
      easing: standardEasing,
    });
    expect(timing).toHaveBeenCalledWith(1, {
      duration: 140,
      easing: standardEasing,
    });
    expect(timing).toHaveBeenCalledWith(0, {
      duration: 450,
      easing: standardEasing,
    });

    fireEvent.press(pohon.getByLabelText('Ya'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('lembar yang ditutup dari luar lalu dibuka lagi tidak hilang', () => {
    const timing = jest
      .spyOn(reanimated, 'withTiming')
      .mockImplementation((nilaiAkhir) => nilaiAkhir);
    const onConfirm = jest.fn();
    const pohon = render(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );
    ukur(pohon);

    pohon.rerender(
      <ConfirmSheet
        visible={false}
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );
    timing.mockClear();
    pohon.rerender(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );

    expect(pohon.UNSAFE_queryByType(Modal)).not.toBeNull();
    const gaya = StyleSheet.flatten(
      pohon.getByTestId('lembar-konfirmasi').props.style,
    );
    expect(gaya.opacity).toBe(1);
    expect(timing).toHaveBeenCalledWith(1, {
      duration: 180,
      easing: standardEasing,
    });
    expect(timing).toHaveBeenCalledWith(0, {
      duration: 380,
      easing: standardEasing,
    });
    expect(timing).toHaveBeenCalledWith(1, {
      duration: 140,
      easing: standardEasing,
    });
    expect(timing).toHaveBeenCalledWith(0, {
      duration: 450,
      easing: standardEasing,
    });

    fireEvent.press(pohon.getByLabelText('Ya'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('dengan kurangi gerakan lembar langsung tampil dan langsung hilang', () => {
    jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);
    const timing = jest
      .spyOn(reanimated, 'withTiming')
      .mockImplementation((nilaiAkhir) => nilaiAkhir);
    const onConfirm = jest.fn();
    const pohon = render(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={jest.fn()}
      />,
    );

    ukur(pohon);

    const gaya = StyleSheet.flatten(
      pohon.getByTestId('lembar-konfirmasi').props.style,
    );
    expect(gaya.opacity).toBe(1);
    expect(gaya.transform).toEqual([{ translateY: 0 }]);

    const motor = StyleSheet.flatten(
      pohon.getByTestId('gambar-motor', { includeHiddenElements: true }).props
        .style,
    );
    expect(motor.transform).toEqual([{ translateX: 0 }, { scaleX: 1 }]);

    const durasi = timing.mock.calls.map((panggilan) => panggilan[1]?.duration);
    expect(durasi).not.toContain(180);
    expect(durasi).not.toContain(380);
    expect(durasi).not.toContain(450);

    fireEvent.press(pohon.getByLabelText('Ya'));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(pohon.UNSAFE_queryByType(Modal)).toBeNull();
    expect(timing).not.toHaveBeenCalledWith(348, expect.anything());
  });

  it('dengan kurangi gerakan memilih Tidak langsung menutup lembar', () => {
    jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);
    const timing = jest
      .spyOn(reanimated, 'withTiming')
      .mockImplementation((nilaiAkhir) => nilaiAkhir);
    const onCancel = jest.fn();
    const pohon = render(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />,
    );

    ukur(pohon);
    fireEvent.press(pohon.getByLabelText('Tidak'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(pohon.UNSAFE_queryByType(Modal)).toBeNull();
    expect(timing).not.toHaveBeenCalledWith(-1, expect.anything());
  });

  it('dengan kurangi gerakan ditutup dari luar langsung menutup lembar', () => {
    jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);
    const timing = jest
      .spyOn(reanimated, 'withTiming')
      .mockImplementation((nilaiAkhir) => nilaiAkhir);
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    const pohon = render(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    ukur(pohon);
    pohon.rerender(
      <ConfirmSheet
        visible={false}
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(pohon.UNSAFE_queryByType(Modal)).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(timing).not.toHaveBeenCalled();
  });

  it('tone danger memakai tombol isi danger', () => {
    const pohon = render(lembar({ tone: 'danger' }));

    const tombol = pohon.UNSAFE_getAllByType(Button);
    expect(tombol[0].props.variant).toBe('dangerFill');
    expect(tombol[1].props.variant).toBe('ghost');
  });

  it('tombol utama memakai ukuran besar dan nada utama', () => {
    const pohon = render(lembar());

    const tombol = pohon.UNSAFE_getAllByType(Button);
    expect(tombol[0].props.variant).toBe('primary');
    expect(tombol[0].props.size).toBe('lg');
    expect(tombol[1].props.size).toBe('lg');
  });

  it('tema terang memakai latar putih dan elevasi', () => {
    const pohon = render(lembar({ tema: 'terang' }));

    const gaya = StyleSheet.flatten(
      pohon.getByTestId('lembar-konfirmasi').props.style,
    );
    expect(gaya.backgroundColor).toBe('#FFFFFF');
    expect(gaya.elevation).toBe(elevation.overlay);

    const latar = StyleSheet.flatten(pohon.getByTestId('latar-lembar').props.style);
    expect(latar.backgroundColor).toBe(themes.terang.scrim);
  });

  it('tema gelap tidak memakai elevasi', () => {
    const pohon = render(lembar({ tema: 'gelap' }));

    const gaya = StyleSheet.flatten(
      pohon.getByTestId('lembar-konfirmasi').props.style,
    );
    expect(gaya.backgroundColor).toBe(themes.gelap.surface);
    expect(gaya.elevation).toBeUndefined();
  });

  it('padding bawah menambah inset area aman', () => {
    jest
      .mocked(useSafeAreaInsets)
      .mockReturnValue({ top: 0, bottom: 34, left: 0, right: 0 });

    const pohon = render(lembar());

    const gaya = StyleSheet.flatten(
      pohon.getByTestId('lembar-konfirmasi').props.style,
    );
    expect(gaya.paddingBottom).toBe(50);

    jest
      .mocked(useSafeAreaInsets)
      .mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0 });
  });

  it('baris gambar tersembunyi dari pembaca layar', () => {
    const pohon = render(lembar());

    const baris = pohon.getByTestId('baris-motor', {
      includeHiddenElements: true,
    });
    expect(baris.props.accessibilityElementsHidden).toBe(true);
    expect(baris.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('garis biru berhenti di roda depan', () => {
    const pohon = render(lembar());
    ukur(pohon);

    const gaya = StyleSheet.flatten(
      pohon.getByTestId('garis-biru', { includeHiddenElements: true }).props
        .style,
    );
    expect(gaya.left).toBeCloseTo(-360, 2);
    expect(gaya.width).toBeCloseTo(466.55, 2);
    expect(gaya.transform[0].translateX).toBeCloseTo(0, 2);
    expect(gaya.left + gaya.width + gaya.transform[0].translateX).toBeCloseTo(
      106.55,
      2,
    );
    expect(gaya.backgroundColor).toBe(themes.gelap.info);
  });

  it('garis biru ikut motor saat keluar lewat Ya', () => {
    jest
      .spyOn(reanimated, 'withTiming')
      .mockImplementation((nilaiAkhir) => nilaiAkhir);
    const pohon = render(lembar());
    ukur(pohon);

    fireEvent.press(pohon.getByLabelText('Ya, batalkan'));
    pohon.rerender(lembar());

    const gaya = StyleSheet.flatten(
      pohon.getByTestId('garis-biru', { includeHiddenElements: true }).props
        .style,
    );
    const geser = gaya.transform[0].translateX;
    expect(geser).toBeCloseTo(348, 2);
    expect(gaya.left + geser).toBeLessThanOrEqual(0);
    expect(gaya.left + gaya.width + geser).toBeGreaterThanOrEqual(360);
  });

  it('garis biru memendek saat keluar lewat Tidak', () => {
    jest
      .spyOn(reanimated, 'withTiming')
      .mockImplementation((nilaiAkhir) => nilaiAkhir);
    const pohon = render(lembar());
    ukur(pohon);

    fireEvent.press(pohon.getByLabelText('Tidak'));
    pohon.rerender(lembar());

    const gaya = StyleSheet.flatten(
      pohon.getByTestId('garis-biru', { includeHiddenElements: true }).props
        .style,
    );
    const geser = gaya.transform[0].translateX;
    expect(geser).toBeCloseTo(-134, 2);
    expect(gaya.left + gaya.width + geser).toBeLessThan(0);
  });

  it('gambar motor diletakkan dua belas piksel dari tepi', () => {
    const pohon = render(lembar());

    const wadah = pohon
      .UNSAFE_getAllByType(View)
      .filter((el) => StyleSheet.flatten(el.props.style)?.left === 12);
    expect(wadah).toHaveLength(1);
    expect(StyleSheet.flatten(wadah[0].props.style).top).toBe(0);
  });

  it('baris gambar selebar lembar', () => {
    const pohon = render(lembar());

    const gaya = StyleSheet.flatten(
      pohon.getByTestId('baris-motor', { includeHiddenElements: true }).props
        .style,
    );
    expect(gaya.height).toBe(80);
    expect(gaya.marginHorizontal).toBe(-24);
  });

  it('lembar transparan sampai ukurannya diketahui', () => {
    const pohon = render(lembar());

    const gaya = StyleSheet.flatten(
      pohon.getByTestId('lembar-konfirmasi').props.style,
    );
    expect(gaya.opacity).toBe(0);
  });

  it('setelah diukur lembar muncul dan motornya jalan ke tempatnya', () => {
    const timing = jest.spyOn(reanimated, 'withTiming');
    const tunda = jest.spyOn(reanimated, 'withDelay');
    const pohon = render(lembar());

    ukur(pohon);

    const gaya = StyleSheet.flatten(
      pohon.getByTestId('lembar-konfirmasi').props.style,
    );
    expect(gaya.opacity).toBe(1);
    expect(gaya.transform).toEqual([{ translateY: 0 }]);

    const motor = StyleSheet.flatten(
      pohon.getByTestId('gambar-motor', { includeHiddenElements: true }).props
        .style,
    );
    expect(motor.transform).toEqual([{ translateX: 0 }, { scaleX: 1 }]);

    expect(timing).toHaveBeenCalledWith(1, {
      duration: 180,
      easing: standardEasing,
    });
    expect(timing).toHaveBeenCalledWith(0, {
      duration: 380,
      easing: standardEasing,
    });
    expect(timing).toHaveBeenCalledWith(0, {
      duration: 450,
      easing: standardEasing,
    });
    expect(tunda).toHaveBeenCalledWith(60, expect.anything());
  });

  it('Ya membuat motor jalan ke kanan keluar dari tepi lembar', () => {
    const timing = jest.spyOn(reanimated, 'withTiming');
    const tunda = jest.spyOn(reanimated, 'withDelay');
    const pohon = render(lembar());
    ukur(pohon);

    fireEvent.press(pohon.getByLabelText('Ya, batalkan'));

    expect(timing).toHaveBeenCalledWith(348, {
      duration: 260,
      easing: exitEasing,
    });
    expect(timing).toHaveBeenCalledWith(300, {
      duration: 260,
      easing: exitEasing,
    });
    expect(timing).toHaveBeenCalledWith(
      0,
      {
        duration: 120,
        easing: exitEasing,
      },
      expect.any(Function),
    );
    expect(tunda).toHaveBeenCalledWith(140, 300);
    expect(tunda).toHaveBeenCalledWith(300, 0);
    expect(timing).not.toHaveBeenCalledWith(-1, expect.anything());
  });

  it('Tidak membuat motor berbalik lalu jalan ke kiri', () => {
    const timing = jest.spyOn(reanimated, 'withTiming');
    const tunda = jest.spyOn(reanimated, 'withDelay');
    const pohon = render(lembar());
    ukur(pohon);

    fireEvent.press(pohon.getByLabelText('Tidak'));

    expect(timing).toHaveBeenCalledWith(-1, {
      duration: 140,
      easing: standardEasing,
    });
    expect(timing).toHaveBeenCalledWith(-134, {
      duration: 260,
      easing: exitEasing,
    });
    expect(tunda).toHaveBeenCalledWith(100, -134);
    expect(tunda).toHaveBeenCalledWith(180, 300);
    expect(tunda).toHaveBeenCalledWith(360, 0);
  });

  it('ditutup dari luar motor keluar tanpa memanggil apa pun', () => {
    const timing = jest.spyOn(reanimated, 'withTiming');
    const tunda = jest.spyOn(reanimated, 'withDelay');
    const onCancel = jest.fn();
    const pohon = render(
      <ConfirmSheet
        visible
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya, batalkan"
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />,
    );
    ukur(pohon);

    pohon.rerender(
      <ConfirmSheet
        visible={false}
        title="Batalkan order?"
        message="Yakin?"
        confirmLabel="Ya, batalkan"
        onConfirm={jest.fn()}
        onCancel={onCancel}
      />,
    );

    expect(onCancel).not.toHaveBeenCalled();
    expect(timing).toHaveBeenCalledWith(-1, {
      duration: 140,
      easing: standardEasing,
    });
    expect(timing).toHaveBeenCalledWith(-134, {
      duration: 260,
      easing: exitEasing,
    });
    expect(tunda).toHaveBeenCalledWith(100, -134);
    expect(tunda).toHaveBeenCalledWith(180, 300);
    expect(tunda).toHaveBeenCalledWith(360, 0);
  });
});
