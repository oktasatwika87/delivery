/**
 * Tes komponen TextField.
 *
 * Kotak isinya dicek lewat style kotak yang membungkus input.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { TextField } from './TextField';
import { colors } from '../theme/tokens';

describe('TextField', () => {
  it('label tampil', () => {
    const { getByText } = render(
      <TextField label="Kota" value="" onChangeText={() => {}} />,
    );
    expect(getByText('Kota')).toBeTruthy();
  });

  it('penanda opsional tampil kalau isinya opsional', () => {
    const { getByText } = render(
      <TextField label="Kota" value="" onChangeText={() => {}} optional />,
    );
    expect(getByText('(opsional)')).toBeTruthy();
  });

  it('input ditemukan lewat labelnya dan mengetik memanggil onChangeText', () => {
    const onChangeText = jest.fn();
    const { getByLabelText } = render(
      <TextField label="Kota" value="" onChangeText={onChangeText} />,
    );
    fireEvent.changeText(getByLabelText('Kota'), 'Bandung');
    expect(onChangeText).toHaveBeenCalledWith('Bandung');
  });

  it('fokus membuat tepi kotak jadi lebih tebal dan warna teks', () => {
    const { getByLabelText } = render(
      <TextField label="Kota" value="" onChangeText={() => {}} />,
    );
    fireEvent(getByLabelText('Kota'), 'focus');
    const gaya = StyleSheet.flatten(getByLabelText('Kota').parent.parent.props.style);
    expect(gaya.borderWidth).toBe(2);
    expect(gaya.borderColor).toBe(colors.text);
  });

  it('pesan galat tampil dan tepi kotak jadi warna galat', () => {
    const { getByText, getByLabelText } = render(
      <TextField
        label="Kota"
        value=""
        onChangeText={() => {}}
        error="Kota wajib diisi"
      />,
    );
    expect(getByText('Kota wajib diisi')).toBeTruthy();
    const gaya = StyleSheet.flatten(getByLabelText('Kota').parent.parent.props.style);
    expect(gaya.borderWidth).toBe(2);
    expect(gaya.borderColor).toBe(colors.danger);
  });

  it('awalan tampil di dalam kotak', () => {
    const { getByText } = render(
      <TextField label="Harga" value="" onChangeText={() => {}} prefix="Rp" />,
    );
    expect(getByText('Rp')).toBeTruthy();
  });

  it('tekan ikon kanan memanggil aksinya', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(
      <TextField
        label="Sandi"
        value=""
        onChangeText={() => {}}
        rightIcon={{ name: 'visibility', onPress, accessibilityLabel: 'Lihat sandi' }}
      />,
    );
    fireEvent.press(getByLabelText('Lihat sandi'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('kotak yang tidak bisa diisi memakai warna latar dan garis tipis', () => {
    const { getByLabelText } = render(
      <TextField label="Kota" value="" onChangeText={() => {}} editable={false} />,
    );
    const gaya = StyleSheet.flatten(getByLabelText('Kota').parent.parent.props.style);
    expect(gaya.backgroundColor).toBe(colors.bg);
    expect(gaya.borderColor).toBe(colors.line);
  });
});
