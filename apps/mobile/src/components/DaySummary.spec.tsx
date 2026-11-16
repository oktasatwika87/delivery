/**
 * Tes komponen DaySummary.
 *
 * Panel ringkasan hari ini, isinya dua kolom angka.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { DaySummary, formatSelesai, formatTunai } from './DaySummary';
import { formatCurrency } from '../formatCurrency';
import { themes } from '../theme/tokens';

describe('DaySummary', () => {
  it('dua angka tampil dengan labelnya', () => {
    const { getByText } = render(
      <DaySummary doneCount={3} cashAmount={120000} currency="IDR" />,
    );
    expect(getByText('Hari ini')).toBeTruthy();
    expect(getByText('3 selesai')).toBeTruthy();
    expect(getByText('Tunai tercatat')).toBeTruthy();
    expect(getByText(formatCurrency(120000, 'IDR'))).toBeTruthy();
  });

  it('nilai nol tetap tampil', () => {
    const { getByText } = render(
      <DaySummary doneCount={0} cashAmount={0} currency="IDR" />,
    );
    expect(getByText('0 selesai')).toBeTruthy();
    expect(getByText(formatCurrency(0, 'IDR'))).toBeTruthy();
  });

  it('format selesai dan format tunai', () => {
    expect(formatSelesai(4)).toBe('4 selesai');
    expect(formatTunai(5000, 'IDR')).toBe(formatCurrency(5000, 'IDR'));
  });

  it('warna angka dan label mengikuti tema gelap', () => {
    const { getByText } = render(
      <DaySummary doneCount={3} cashAmount={120000} currency="IDR" />,
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
      <DaySummary doneCount={3} cashAmount={120000} currency="IDR" />,
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
