/**
 * Tes komponen AppBar.
 *
 * Ada dua kepala: MainHeader untuk layar utama tiap peran, AppBar untuk
 * layar turunan.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { AppBar, MainHeader } from './AppBar';
import { ThemeProvider } from '../theme/ThemeProvider';
import { themes } from '../theme/tokens';

describe('MainHeader', () => {
  it('judul, subjudul, dan logo tampil', () => {
    const { getByText, getByLabelText } = render(
      <MainHeader title="Kurir" subtitle="Area Bandung" onLogout={() => {}} />,
    );
    expect(getByText('Kurir')).toBeTruthy();
    expect(getByText('Area Bandung')).toBeTruthy();
    expect(getByLabelText('M Delivery')).toBeTruthy();
  });

  it('tekan Keluar memanggil onLogout', () => {
    const onLogout = jest.fn();
    const { getByLabelText } = render(
      <MainHeader title="Kurir" subtitle="Area Bandung" onLogout={onLogout} />,
    );
    fireEvent.press(getByLabelText('Keluar'));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('children dirender di bawah baris kepala', () => {
    const { getByText } = render(
      <MainHeader title="Kurir" subtitle="Area Bandung" onLogout={() => {}}>
        <Text>Tab Tambahan</Text>
      </MainHeader>,
    );
    expect(getByText('Tab Tambahan')).toBeTruthy();
  });

  it('wadah kepala ikut tema peran tapi isinya selalu tema gelap', () => {
    const { getByText, toJSON } = render(
      <ThemeProvider name="terang">
        <MainHeader title="Kurir" subtitle="Area Bandung" onLogout={() => {}} />
      </ThemeProvider>,
    );
    const gayaWadah = StyleSheet.flatten(toJSON().props.style);
    expect(gayaWadah.backgroundColor).toBe(themes.terang.header);
    expect(StyleSheet.flatten(getByText('Kurir').props.style).color).toBe(
      themes.gelap.text,
    );
    expect(StyleSheet.flatten(getByText('Area Bandung').props.style).color).toBe(
      themes.gelap.textSubtle,
    );
  });

  it('tombol Keluar memakai isi surface dan tepi lineControl', () => {
    const { getByLabelText } = render(
      <MainHeader title="Kurir" subtitle="Area Bandung" onLogout={() => {}} />,
    );
    const gayaTombol = StyleSheet.flatten(getByLabelText('Keluar').props.style);
    expect(gayaTombol.backgroundColor).toBe(themes.gelap.surface);
    expect(gayaTombol.borderColor).toBe(themes.gelap.lineControl);
    expect(gayaTombol.height).toBe(48);
  });
});

describe('AppBar', () => {
  it('judul dan subjudul tampil', () => {
    const { getByText } = render(<AppBar title="Detail Order" subtitle="ORD-123" />);
    expect(getByText('Detail Order')).toBeTruthy();
    expect(getByText('ORD-123')).toBeTruthy();
  });

  it('tanpa onBack tidak ada tombol Kembali', () => {
    const { queryByLabelText } = render(<AppBar title="Detail Order" />);
    expect(queryByLabelText('Kembali')).toBeNull();
  });

  it('tekan Kembali memanggil onBack', () => {
    const onBack = jest.fn();
    const { getByLabelText } = render(<AppBar title="Detail Order" onBack={onBack} />);
    fireEvent.press(getByLabelText('Kembali'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('isi kanan dirender', () => {
    const { getByText } = render(
      <AppBar
        title="Detail Order"
        right={<Text>Sebelah Kanan</Text>}
      />,
    );
    expect(getByText('Sebelah Kanan')).toBeTruthy();
  });
});
