/**
 * Tes komponen Button.
 *
 * Gaya dicek lewat StyleSheet.flatten dari elemen yang dirender.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { Button } from './Button';
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
});
