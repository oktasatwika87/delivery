/**
 * Tes komponen Button.
 *
 * Gaya dicek lewat StyleSheet.flatten dari elemen yang dirender.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { Button } from './Button';
import { CheckMark } from './motion/CheckMark';
import { InitialWindowProvider } from './motion/InitialWindow';
import { Icon } from '../theme/Icon';
import { size, themes } from '../theme/tokens';

describe('Button', () => {
  it('judul tombol tampil sebagai teks', () => {
    const { getByText } = render(<Button title="Simpan" onPress={() => {}} />);
    expect(getByText('Simpan')).toBeTruthy();
  });

  it('tekan tombol memanggil aksi', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button title="Simpan" onPress={onPress} />);
    fireEvent.press(getByText('Simpan'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('tombol nonaktif tidak memanggil aksi dan tandai nonaktif', () => {
    const onPress = jest.fn();
    const { getByText, getByTestId } = render(
      <Button title="Simpan" onPress={onPress} disabled testID="tombol" />,
    );
    fireEvent.press(getByText('Simpan'));
    expect(onPress).not.toHaveBeenCalled();
    expect(getByTestId('tombol').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('tombol sedang memuat tidak memanggil aksi dan tandai sibuk', () => {
    const onPress = jest.fn();
    const { getByText, getByTestId } = render(
      <Button title="Simpan" onPress={onPress} loading testID="tombol" />,
    );
    fireEvent.press(getByText('Simpan'));
    expect(onPress).not.toHaveBeenCalled();
    expect(getByTestId('tombol').props.accessibilityState).toMatchObject({
      busy: true,
    });
  });

  it('isi tombol utama memakai warna aksi dan teksnya warna teks aksi', () => {
    const { getByTestId } = render(
      <Button title="Simpan" onPress={() => {}} testID="tombol" />,
    );
    const gaya = StyleSheet.flatten(getByTestId('tombol').props.style);
    expect(gaya.backgroundColor).toBe(themes.gelap.action);
  });

  it('isi tombol kedua memakai warna aksi kedua dan tepinya garis tipis', () => {
    const { getByTestId } = render(
      <Button title="Simpan" onPress={() => {}} variant="secondary" testID="tombol" />,
    );
    const gaya = StyleSheet.flatten(getByTestId('tombol').props.style);
    expect(gaya.backgroundColor).toBe(themes.gelap.actionSecondary);
    expect(gaya.borderColor).toBe(themes.gelap.lineControl);
  });

  it('tombol nonaktif memakai isi dan teks nonaktif', () => {
    const { getByTestId } = render(
      <Button title="Simpan" onPress={() => {}} disabled testID="tombol" />,
    );
    const gaya = StyleSheet.flatten(getByTestId('tombol').props.style);
    expect(gaya.backgroundColor).toBe(themes.gelap.actionDisabled);
  });

  it('tombol tanpa isi tidak punya warna latar', () => {
    const { getByTestId } = render(
      <Button title="Simpan" onPress={() => {}} variant="ghost" testID="tombol" />,
    );
    const gaya = StyleSheet.flatten(getByTestId('tombol').props.style);
    expect(gaya.backgroundColor).toBeUndefined();
  });

  it('teks bantuan tampil kalau ada', () => {
    const { getByText } = render(
      <Button title="Simpan" onPress={() => {}} helpText="Perubahan disimpan di HP" />,
    );
    expect(getByText('Perubahan disimpan di HP')).toBeTruthy();
  });

  it('ikon dirender kalau nama ikon diberikan', () => {
    const { UNSAFE_getByType } = render(
      <Button title="Simpan" onPress={() => {}} icon="cloud_upload" />,
    );
    expect(UNSAFE_getByType(Icon).props.name).toBe('cloud_upload');
  });

  it('ikon tombol kedua memakai warna info', () => {
    const { UNSAFE_getByType } = render(
      <Button title="Simpan" onPress={() => {}} variant="secondary" icon="cloud_upload" />,
    );
    expect(UNSAFE_getByType(Icon).props.color).toBe(themes.gelap.info);
  });

  it('tinggi tombol sesuai ukuran yang dipilih', () => {
    const { getByTestId } = render(
      <Button title="Simpan" onPress={() => {}} size="lg" testID="tombol" />,
    );
    const gaya = StyleSheet.flatten(getByTestId('tombol').props.style);
    expect(gaya.height).toBe(size.controlLg);
  });

  it('tombol ukuran kartu punya tinggi dan sudut sendiri', () => {
    const { getByTestId } = render(
      <Button title="Simpan" onPress={() => {}} size="card" testID="tombol" />,
    );
    const gaya = StyleSheet.flatten(getByTestId('tombol').props.style);
    expect(gaya.height).toBe(size.controlCard);
    expect(gaya.borderRadius).toBe(12);
  });

  it('tombol aktif punya penangan tekan dan menekan tidak mengganggu aksi', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <Button title="Simpan" onPress={onPress} testID="tombol" />,
    );

    expect(getByTestId('tombol').props.onPressIn).toBeDefined();

    fireEvent(getByTestId('tombol'), 'pressIn');
    fireEvent.press(getByTestId('tombol'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('tombol nonaktif, memuat, dan berhasil tidak punya penangan tekan', () => {
    const nonaktif = render(
      <Button title="Simpan" onPress={() => {}} disabled testID="tombol" />,
    );
    expect(nonaktif.getByTestId('tombol').props.onPressIn).toBeUndefined();

    const memuat = render(
      <Button title="Simpan" onPress={() => {}} loading testID="tombol" />,
    );
    expect(memuat.getByTestId('tombol').props.onPressIn).toBeUndefined();

    const berhasil = render(
      <Button title="Simpan" onPress={() => {}} success testID="tombol" />,
    );
    expect(berhasil.getByTestId('tombol').props.onPressIn).toBeUndefined();
  });

  it('tombol berhasil menampilkan centang dengan judulnya tetap ada', () => {
    const { getByText, UNSAFE_getByType } = render(
      <Button title="Simpan" onPress={() => {}} success />,
    );

    expect(UNSAFE_getByType(CheckMark)).toBeTruthy();
    expect(getByText('Simpan')).toBeTruthy();
  });

  it('lapisan judul tetap ada dan disembunyikan saat loading dan saat success', () => {
    const memuat = render(<Button title="Simpan" onPress={() => {}} loading />);
    expect(memuat.getByText('Simpan')).toBeTruthy();
    const gayaMemuat = StyleSheet.flatten(memuat.getByTestId('judul-tombol').props.style);
    expect(gayaMemuat.opacity).toBe(0);

    const berhasil = render(<Button title="Simpan" onPress={() => {}} success />);
    expect(berhasil.getByText('Simpan')).toBeTruthy();
    const gayaBerhasil = StyleSheet.flatten(berhasil.getByTestId('judul-tombol').props.style);
    expect(gayaBerhasil.opacity).toBe(0);
  });

  it('lapisan judul terlihat kalau tombol normal', () => {
    const { getByTestId } = render(<Button title="Simpan" onPress={() => {}} />);
    const gaya = StyleSheet.flatten(getByTestId('judul-tombol').props.style);
    expect(gaya.opacity).toBe(1);
  });

  it('tombol berhasil tidak memanggil aksi dan tandai nonaktif bukan sibuk', () => {
    const onPress = jest.fn();
    const { getByTestId } = render(
      <Button title="Simpan" onPress={onPress} success testID="tombol" />,
    );

    fireEvent.press(getByTestId('tombol'));

    expect(onPress).not.toHaveBeenCalled();
    expect(getByTestId('tombol').props.accessibilityState).toMatchObject({
      disabled: true,
      busy: false,
    });
  });

  it('tombol berhasil tidak menampilkan pemutar memuat', () => {
    const { UNSAFE_queryByType } = render(
      <Button title="Simpan" onPress={() => {}} icon="cloud_upload" success />,
    );

    expect(UNSAFE_queryByType(ActivityIndicator)).toBeNull();
  });

  it('teks tombol hantu bergaya sedang', () => {
    const { getByText } = render(
      <Button title="Abaikan" onPress={() => {}} variant="ghost" />,
    );
    const gaya = StyleSheet.flatten(getByText('Abaikan').props.style);
    expect(gaya.fontSize).toBe(15);
  });

  it('judul yang berganti menyisakan judul baru saja', () => {
    const pohon = render(<Button title="Lama" onPress={() => {}} />);
    pohon.rerender(<Button title="Baru" onPress={() => {}} />);

    expect(pohon.queryByText('Lama')).toBeNull();
    expect(pohon.getByText('Baru')).toBeTruthy();
    expect(pohon.getByTestId('isi-tombol').props.entering).toBeDefined();
  });

  it('ikon yang berganti dihitung sebagai judul yang berganti', () => {
    const pohon = render(
      <Button title="Simpan" onPress={() => {}} icon="cloud_upload" />,
    );
    expect(pohon.getByTestId('isi-tombol').props.entering).toBeUndefined();

    pohon.rerender(<Button title="Simpan" onPress={() => {}} icon="search" />);
    expect(pohon.getByTestId('isi-tombol').props.entering).toBeDefined();
  });

  it('di dalam jendela awal judul baru langsung tampil tanpa lapisan lama', () => {
    const pohon = render(
      <InitialWindowProvider>
        <Button title="Lama" onPress={() => {}} />
      </InitialWindowProvider>,
    );
    pohon.rerender(
      <InitialWindowProvider>
        <Button title="Baru" onPress={() => {}} />
      </InitialWindowProvider>,
    );

    expect(pohon.queryByText('Lama')).toBeNull();
    expect(pohon.getByText('Baru')).toBeTruthy();
    expect(pohon.getByTestId('isi-tombol').props.entering).toBeUndefined();
  });

  it('judul yang berganti saat tombol memuat tetap disembunyikan', () => {
    const pohon = render(<Button title="Lama" onPress={() => {}} loading />);
    pohon.rerender(<Button title="Baru" onPress={() => {}} loading />);

    expect(pohon.getByText('Baru')).toBeTruthy();
    const gaya = StyleSheet.flatten(pohon.getByTestId('judul-tombol').props.style);
    expect(gaya.opacity).toBe(0);
  });
});
