/**
 * Tes komponen Tabs.
 *
 * Yang dicek: label tiap tab, pil hitungan, garis bawah tab aktif, dan
 * perpindahan tab saat ditekan.
 */

import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { Tabs } from './Tabs';
import { colors } from '../theme/tokens';

describe('Tabs', () => {
  it('dua tab tampil dengan labelnya', () => {
    const { getByText } = render(
      <Tabs
        tabs={[
          { key: 'tersedia', label: 'Tersedia' },
          { key: 'dimakan', label: 'Dimakan' },
        ]}
        activeKey="tersedia"
        onChange={() => {}}
      />,
    );
    expect(getByText('Tersedia')).toBeTruthy();
    expect(getByText('Dimakan')).toBeTruthy();
  });

  it('pil hitungan tampil kalau jumlahnya lebih dari nol', () => {
    const { getByText } = render(
      <Tabs
        tabs={[{ key: 'tersedia', label: 'Tersedia', count: 3 }]}
        activeKey="tersedia"
        onChange={() => {}}
      />,
    );
    expect(getByText('3')).toBeTruthy();
  });

  it('pil hitungan tidak tampil kalau jumlahnya nol atau tidak ada', () => {
    const { queryByText } = render(
      <Tabs
        tabs={[
          { key: 'tersedia', label: 'Tersedia', count: 0 },
          { key: 'dimakan', label: 'Dimakan' },
        ]}
        activeKey="tersedia"
        onChange={() => {}}
      />,
    );
    expect(queryByText(/^\d+$/)).toBeNull();
  });

  it('tab aktif ditandai terpilih dan garis bawahnya warna merah', () => {
    const { UNSAFE_getAllByType } = render(
      <Tabs
        tabs={[
          { key: 'tersedia', label: 'Tersedia' },
          { key: 'dimakan', label: 'Dimakan' },
        ]}
        activeKey="tersedia"
        onChange={() => {}}
      />,
    );
    const tabAktif = UNSAFE_getAllByType(Pressable).find(
      (tab) => tab.props.accessibilityState.selected,
    );
    expect(tabAktif).toBeTruthy();
    const gaya = StyleSheet.flatten(tabAktif.props.style);
    expect(gaya.borderBottomColor).toBe(colors.brandRedInverse);
  });

  it('gaya tab punya flexDirection row biar pil angka sejajar sama label', () => {
    const { UNSAFE_getAllByType } = render(
      <Tabs
        tabs={[{ key: 'tersedia', label: 'Tersedia', count: 3 }]}
        activeKey="tersedia"
        onChange={() => {}}
      />,
    );
    const gaya = StyleSheet.flatten(UNSAFE_getAllByType(Pressable)[0].props.style);
    expect(gaya.flexDirection).toBe('row');
  });

  it('tekan tab lain memanggil onChange dengan key-nya', () => {
    const onChange = jest.fn();
    const { UNSAFE_getAllByType } = render(
      <Tabs
        tabs={[
          { key: 'tersedia', label: 'Tersedia' },
          { key: 'dimakan', label: 'Dimakan' },
        ]}
        activeKey="tersedia"
        onChange={onChange}
      />,
    );
    fireEvent.press(UNSAFE_getAllByType(Pressable)[1]);
    expect(onChange).toHaveBeenCalledWith('dimakan');
  });

  it('tekan tab aktif tidak memanggil apa pun', () => {
    const onChange = jest.fn();
    const { UNSAFE_getAllByType } = render(
      <Tabs
        tabs={[
          { key: 'tersedia', label: 'Tersedia' },
          { key: 'dimakan', label: 'Dimakan' },
        ]}
        activeKey="tersedia"
        onChange={onChange}
      />,
    );
    const tabAktif = UNSAFE_getAllByType(Pressable).find(
      (tab) => tab.props.accessibilityState.selected,
    );
    fireEvent.press(tabAktif);
    expect(onChange).not.toHaveBeenCalled();
  });
});
