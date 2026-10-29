/**
 * Tes komponen EmptyState.
 *
 * Tampilan untuk layar yang belum punya isi.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { EmptyState } from './EmptyState';
import { Icon } from '../theme/Icon';
import { colors } from '../theme/tokens';

const LEBAR_ISI = 280;

describe('EmptyState', () => {
  it('judul dan isi tampil', () => {
    const { getByText } = render(
      <EmptyState icon="search" title="Belum ada order" body="Order yang masuk akan tampil di sini" />,
    );
    expect(getByText('Belum ada order')).toBeTruthy();
    expect(getByText('Order yang masuk akan tampil di sini')).toBeTruthy();
  });

  it('tanpa isi tidak ada baris teks isi', () => {
    const { UNSAFE_getAllByType } = render(
      <EmptyState icon="search" title="Belum ada order" />,
    );
    const adaIsi = UNSAFE_getAllByType(Text).some(
      (teks) => StyleSheet.flatten(teks.props.style).maxWidth === LEBAR_ISI,
    );
    expect(adaIsi).toBe(false);
  });

  it('aksi tampil dan aksinya dipanggil saat ditekan', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <EmptyState icon="search" title="Belum ada order" action={{ title: 'Buat Order', onPress }} />,
    );
    fireEvent.press(getByText('Buat Order'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('lingkaran ikon memakai warna netral', () => {
    const { UNSAFE_getByType } = render(<EmptyState icon="search" title="Belum ada order" />);
    expect(UNSAFE_getByType(Icon).props.name).toBe('search');
    const gaya = StyleSheet.flatten(UNSAFE_getByType(Icon).parent.props.style);
    expect(gaya.backgroundColor).toBe(colors.fillNeutral);
  });
});
