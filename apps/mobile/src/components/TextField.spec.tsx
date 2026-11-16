/**
 * Tes komponen TextField.
 *
 * Kotak isinya dicek lewat style kotak yang membungkus input.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { TextField } from './TextField';
import { themes } from '../theme/tokens';

const mockShake = jest.fn();

jest.mock('./motion/useFieldShake', () => ({
  useFieldShake: () => ({ style: {}, shake: mockShake }),
}));

describe('TextField', () => {
  beforeEach(() => {
    mockShake.mockClear();
  });

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

  it('kotak memakai tinggi, sudut, dan padding versi 2', () => {
    const { getByLabelText } = render(
      <TextField label="Kota" value="" onChangeText={() => {}} />,
    );
    const gaya = StyleSheet.flatten(getByLabelText('Kota').parent.parent.props.style);
    expect(gaya.minHeight).toBe(56);
    expect(gaya.borderRadius).toBe(12);
    expect(gaya.paddingHorizontal).toBe(16);
    expect(gaya.borderWidth).toBe(1);
    expect(gaya.backgroundColor).toBe(themes.gelap.surface);
  });

  it('label memakai warna label tema', () => {
    const { getByText } = render(
      <TextField label="Kota" value="" onChangeText={() => {}} />,
    );
    expect(StyleSheet.flatten(getByText('Kota').props.style).color).toBe(
      themes.gelap.textLabel,
    );
  });

  it('fokus membuat tepi kotak jadi warna fokus', () => {
    const { getByLabelText } = render(
      <TextField label="Kota" value="" onChangeText={() => {}} />,
    );
    fireEvent(getByLabelText('Kota'), 'focus');
    const gaya = StyleSheet.flatten(getByLabelText('Kota').parent.parent.props.style);
    expect(gaya.borderColor).toBe(themes.gelap.focus);
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
    expect(gaya.borderColor).toBe(themes.gelap.danger);
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

  it('tombol ikon kanan berukuran 48', () => {
    const { getByLabelText } = render(
      <TextField
        label="Sandi"
        value=""
        onChangeText={() => {}}
        rightIcon={{ name: 'visibility', onPress: () => {}, accessibilityLabel: 'Lihat sandi' }}
      />,
    );
    const gaya = StyleSheet.flatten(getByLabelText('Lihat sandi').props.style);
    expect(gaya.width).toBe(48);
    expect(gaya.height).toBe(48);
  });

  it('kotak yang tidak bisa diisi memakai warna latar dan garis tipis', () => {
    const { getByLabelText } = render(
      <TextField label="Kota" value="" onChangeText={() => {}} editable={false} />,
    );
    const gaya = StyleSheet.flatten(getByLabelText('Kota').parent.parent.props.style);
    expect(gaya.backgroundColor).toBe(themes.gelap.bg);
    expect(gaya.borderColor).toBe(themes.gelap.line);
  });

  it('submitCount naik bersama galat membuat kotak bergetar', () => {
    const { rerender } = render(
      <TextField label="Kota" value="" onChangeText={() => {}} submitCount={0} />,
    );

    rerender(
      <TextField
        label="Kota"
        value=""
        onChangeText={() => {}}
        error="Kota wajib diisi"
        submitCount={1}
      />,
    );

    expect(mockShake).toHaveBeenCalledTimes(1);
  });

  it('kotak yang dipasang dengan galat tidak bergetar', () => {
    render(
      <TextField
        label="Kota"
        value=""
        onChangeText={() => {}}
        error="Kota wajib diisi"
        submitCount={1}
      />,
    );

    expect(mockShake).not.toHaveBeenCalled();
  });

  it('mengetik tidak membuat kotak bergetar', () => {
    const { getByLabelText, rerender } = render(
      <TextField label="Kota" value="" onChangeText={() => {}} submitCount={0} />,
    );

    rerender(
      <TextField label="Kota" value="Bandung" onChangeText={() => {}} submitCount={0} />,
    );
    fireEvent.changeText(getByLabelText('Kota'), 'Bandung');

    expect(mockShake).not.toHaveBeenCalled();
  });

  it('submitCount naik tanpa galat tidak membuat kotak bergetar', () => {
    const { rerender } = render(
      <TextField label="Kota" value="" onChangeText={() => {}} submitCount={0} />,
    );

    rerender(
      <TextField label="Kota" value="" onChangeText={() => {}} submitCount={1} />,
    );

    expect(mockShake).not.toHaveBeenCalled();
  });
});
