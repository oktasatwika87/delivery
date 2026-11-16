/**
 * Tes komponen Tabs.
 *
 * Yang dicek: label tiap tab, pil hitungan, lapisan penanda tab aktif, dan
 * perpindahan tab saat ditekan.
 */

import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { Tabs } from './Tabs';
import { themes } from '../theme/tokens';

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

  it('pil hitungan tetap tampil kalau jumlahnya nol', () => {
    const { getByText } = render(
      <Tabs
        tabs={[{ key: 'tersedia', label: 'Tersedia', count: 0 }]}
        activeKey="tersedia"
        onChange={() => {}}
      />,
    );
    expect(getByText('0')).toBeTruthy();
  });

  it('pil hitungan tidak tampil kalau jumlahnya tidak ada', () => {
    const { queryByText } = render(
      <Tabs
        tabs={[
          { key: 'tersedia', label: 'Tersedia' },
          { key: 'dimakan', label: 'Dimakan' },
        ]}
        activeKey="tersedia"
        onChange={() => {}}
      />,
    );
    expect(queryByText(/^\d+$/)).toBeNull();
  });

  it('wadah tab mengikuti token ukuran dan warna', () => {
    const { toJSON } = render(
      <Tabs
        tabs={[{ key: 'tersedia', label: 'Tersedia' }]}
        activeKey="tersedia"
        onChange={() => {}}
      />,
    );
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.height).toBe(56);
    expect(gaya.borderRadius).toBe(14);
    expect(gaya.backgroundColor).toBe(themes.gelap.surface);
  });

  it('tab aktif ditandai terpilih dan penandanya warna permukaan', () => {
    const { UNSAFE_getAllByType, getAllByTestId } = render(
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
    const penanda = getAllByTestId('penanda-tab');
    expect(penanda).toHaveLength(1);
    const gaya = StyleSheet.flatten(penanda[0].props.style);
    expect(gaya.backgroundColor).toBe(themes.gelap.surfaceRaised);
  });

  it('penanda jadi lapisan di belakang label bukan garis bawah', () => {
    const { getAllByTestId } = render(
      <Tabs
        tabs={[{ key: 'tersedia', label: 'Tersedia' }]}
        activeKey="tersedia"
        onChange={() => {}}
      />,
    );
    const gaya = StyleSheet.flatten(getAllByTestId('penanda-tab')[0].props.style);
    expect(gaya.position).toBe('absolute');
    expect(gaya.top).toBe(0);
    expect(gaya.bottom).toBe(0);
    expect(gaya.borderRadius).toBe(10);
    expect(gaya.borderBottomWidth).toBeUndefined();
  });

  it('label tab aktif pakai text dan yang tidak aktif pakai textSubtle', () => {
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
    expect(StyleSheet.flatten(getByText('Tersedia').props.style).color).toBe(
      themes.gelap.text,
    );
    expect(StyleSheet.flatten(getByText('Dimakan').props.style).color).toBe(
      themes.gelap.textSubtle,
    );
  });

  it('pil angka aktif isi accent dan teksnya onAccent', () => {
    const { getAllByTestId, getByText } = render(
      <Tabs
        tabs={[{ key: 'tersedia', label: 'Tersedia', count: 3 }]}
        activeKey="tersedia"
        onChange={() => {}}
      />,
    );
    const gayaPil = StyleSheet.flatten(getAllByTestId('pil-tab')[0].props.style);
    expect(gayaPil.backgroundColor).toBe(themes.gelap.accent);
    expect(gayaPil.minWidth).toBe(24);
    expect(gayaPil.height).toBe(22);
    expect(gayaPil.borderRadius).toBe(9999);
    expect(StyleSheet.flatten(getByText('3').props.style).color).toBe(
      themes.gelap.onAccent,
    );
  });

  it('pil angka tidak aktif isi surfaceRaised dan teksnya textMuted', () => {
    const { getAllByTestId, getByText } = render(
      <Tabs
        tabs={[
          { key: 'tersedia', label: 'Tersedia' },
          { key: 'dimakan', label: 'Dimakan', count: 3 },
        ]}
        activeKey="tersedia"
        onChange={() => {}}
      />,
    );
    const gayaPil = StyleSheet.flatten(getAllByTestId('pil-tab')[0].props.style);
    expect(gayaPil.backgroundColor).toBe(themes.gelap.surfaceRaised);
    expect(StyleSheet.flatten(getByText('3').props.style).color).toBe(
      themes.gelap.textMuted,
    );
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
