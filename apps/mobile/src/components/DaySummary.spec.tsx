/**
 * Tes komponen DaySummary.
 *
 * Panel ringkasan hari ini, isinya dua kolom angka.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { DaySummary } from './DaySummary';
import { themes } from '../theme/tokens';

describe('DaySummary', () => {
  it('dua angka tampil dengan labelnya', () => {
    const { getByText } = render(
      <DaySummary doneText="3 selesai" cashText="Rp 120.000" />,
    );
    expect(getByText('Hari ini')).toBeTruthy();
    expect(getByText('3 selesai')).toBeTruthy();
    expect(getByText('Tunai tercatat')).toBeTruthy();
    expect(getByText('Rp 120.000')).toBeTruthy();
  });

  it('nilai nol tetap tampil', () => {
    const { getByText } = render(<DaySummary doneText="0 selesai" cashText="Rp 0" />);
    expect(getByText('0 selesai')).toBeTruthy();
    expect(getByText('Rp 0')).toBeTruthy();
  });

  it('warna angka dan label mengikuti tema gelap', () => {
    const { getByText } = render(
      <DaySummary doneText="3 selesai" cashText="Rp 120.000" />,
    );
    expect(StyleSheet.flatten(getByText('Hari ini').props.style).color).toBe(
      themes.gelap.textSubtle,
    );
    expect(StyleSheet.flatten(getByText('3 selesai').props.style).color).toBe(
      themes.gelap.text,
    );
  });

  it('panel memakai sudut, tepi, dan padding kartu', () => {
    const { toJSON } = render(
      <DaySummary doneText="3 selesai" cashText="Rp 120.000" />,
    );
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.borderRadius).toBe(18);
    expect(gaya.borderWidth).toBe(1);
    expect(gaya.borderColor).toBe(themes.gelap.lineCard);
    expect(gaya.borderTopColor).toBe(themes.gelap.edgeHighlight);
    expect(gaya.paddingVertical).toBe(14);
    expect(gaya.paddingHorizontal).toBe(16);
  });
});
