/**
 * Tes komponen Button.
 *
 * Gaya dicek lewat StyleSheet.flatten dari elemen yang dirender.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { Button } from './Button';
import { CheckMark } from './motion/CheckMark';
import { Icon } from '../theme/Icon';
import { colors, size } from '../theme/tokens';

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
    expect(gaya.backgroundColor).toBe(colors.action);
  });

  it('isi tombol kedua memakai warna permukaan dan tepinya garis tebal', () => {
    const { getByTestId } = render(
      <Button title="Simpan" onPress={() => {}} variant="secondary" testID="tombol" />,
    );
    const gaya = StyleSheet.flatten(getByTestId('tombol').props.style);
    expect(gaya.backgroundColor).toBe(colors.surface);
    expect(gaya.borderColor).toBe(colors.lineStrong);
  });

  it('tombol nonaktif memakai isi dan teks nonaktif', () => {
    const { getByTestId } = render(
      <Button title="Simpan" onPress={() => {}} disabled testID="tombol" />,
    );
    const gaya = StyleSheet.flatten(getByTestId('tombol').props.style);
    expect(gaya.backgroundColor).toBe(colors.actionDisabled);
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

  it('tinggi tombol sesuai ukuran yang dipilih', () => {
    const { getByTestId } = render(
      <Button title="Simpan" onPress={() => {}} size="lg" testID="tombol" />,
    );
    const gaya = StyleSheet.flatten(getByTestId('tombol').props.style);
    expect(gaya.height).toBe(size.controlLg);
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

  it('tombol berhasil tidak menampilkan ikon atau pemutar memuat', () => {
    const { UNSAFE_queryByType } = render(
      <Button title="Simpan" onPress={() => {}} icon="cloud_upload" success />,
    );

    expect(UNSAFE_queryByType(Icon)).toBeNull();
  });
});
