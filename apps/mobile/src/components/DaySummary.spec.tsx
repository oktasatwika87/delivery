/**
 * Tes komponen DaySummary.
 *
 * Panel ringkasan hari ini, isinya dua kolom angka.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import Svg, { Rect } from 'react-native-svg';

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

  it('sebelum panel diukur gradasi belum ada dan panelnya berlatar', () => {
    const { getByTestId, UNSAFE_queryByType } = render(
      <DaySummary doneCount={3} cashAmount={120000} currency="IDR" />,
    );

    expect(UNSAFE_queryByType(Svg)).toBeNull();
    const gayaPanel = StyleSheet.flatten(getByTestId('panel-ringkasan').props.style);
    expect(gayaPanel.backgroundColor).toBe(themes.gelap.surface);
  });

  it('sesudah panel diukur gradasi memakai ukuran panel', () => {
    const { getByTestId, UNSAFE_getByType } = render(
      <DaySummary doneCount={3} cashAmount={120000} currency="IDR" />,
    );

    fireEvent(getByTestId('panel-ringkasan'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 328, height: 64 } },
    });

    const svg = UNSAFE_getByType(Svg);
    expect(svg.props.width).toBe(328);
    expect(svg.props.height).toBe(64);

    const rect = UNSAFE_getByType(Rect);
    expect(rect.props.width).toBe(328);
    expect(rect.props.height).toBe(64);
  });

  it('panel boleh menurunkan kolom kanan ke baris kedua', () => {
    const { getByTestId } = render(
      <DaySummary doneCount={3} cashAmount={120000} currency="IDR" />,
    );

    const gayaPanel = StyleSheet.flatten(getByTestId('panel-ringkasan').props.style);
    expect(gayaPanel.flexWrap).toBe('wrap');
    expect(gayaPanel.columnGap).toBe(16);
    expect(gayaPanel.rowGap).toBe(12);
  });

  it('kolom kiri selebar isinya dan kolom kanan mengisi sisa', () => {
    const { getByTestId } = render(
      <DaySummary doneCount={3} cashAmount={120000} currency="IDR" />,
    );

    const gayaKiri = StyleSheet.flatten(getByTestId('kolom-selesai').props.style);
    expect(gayaKiri.flex).toBeUndefined();
    expect(gayaKiri.flexShrink).toBe(0);
    expect(gayaKiri.paddingRight).toBe(16);
    expect(gayaKiri.borderRightWidth).toBe(1);

    const gayaKanan = StyleSheet.flatten(getByTestId('kolom-tunai').props.style);
    expect(gayaKanan.flex).toBeUndefined();
    expect(gayaKanan.flexGrow).toBe(1);
    expect(gayaKanan.flexShrink).toBe(1);
    expect(gayaKanan.paddingLeft).toBeUndefined();
    expect(gayaKanan.borderLeftWidth).toBeUndefined();
  });

  it('garis pemisah disembunyikan sebelum kolom kanan diukur', () => {
    const { getByTestId } = render(
      <DaySummary doneCount={3} cashAmount={120000} currency="IDR" />,
    );

    const gayaKiri = StyleSheet.flatten(getByTestId('kolom-selesai').props.style);
    expect(gayaKiri.borderRightColor).toBe('transparent');
  });

  it('garis pemisah tetap tampil kalau kolom kanan di baris pertama', () => {
    const { getByTestId } = render(
      <DaySummary doneCount={3} cashAmount={120000} currency="IDR" />,
    );

    fireEvent(getByTestId('kolom-tunai'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 14, width: 120, height: 30 } },
    });

    const gayaKiri = StyleSheet.flatten(getByTestId('kolom-selesai').props.style);
    expect(gayaKiri.borderRightColor).toBe(themes.gelap.line);
  });

  it('garis pemisah tetap tampil kalau kolom kanan turun sedikit', () => {
    const { getByTestId } = render(
      <DaySummary doneCount={3} cashAmount={120000} currency="IDR" />,
    );

    fireEvent(getByTestId('kolom-tunai'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 14.4, width: 120, height: 30 } },
    });

    const gayaKiri = StyleSheet.flatten(getByTestId('kolom-selesai').props.style);
    expect(gayaKiri.borderRightColor).toBe(themes.gelap.line);
  });

  it('garis pemisah hilang kalau kolom kanan turun ke baris kedua', () => {
    const { getByTestId } = render(
      <DaySummary doneCount={3} cashAmount={120000} currency="IDR" />,
    );

    fireEvent(getByTestId('kolom-tunai'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 70, width: 120, height: 30 } },
    });

    const gayaKiri = StyleSheet.flatten(getByTestId('kolom-selesai').props.style);
    expect(gayaKiri.borderRightColor).toBe('transparent');
  });

  it('garis pemisah kembali tampil kalau kolom kanan naik lagi', () => {
    const { getByTestId } = render(
      <DaySummary doneCount={3} cashAmount={120000} currency="IDR" />,
    );

    fireEvent(getByTestId('kolom-tunai'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 70, width: 120, height: 30 } },
    });
    fireEvent(getByTestId('kolom-tunai'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 14, width: 120, height: 30 } },
    });

    const gayaKiri = StyleSheet.flatten(getByTestId('kolom-selesai').props.style);
    expect(gayaKiri.borderRightColor).toBe(themes.gelap.line);
  });
});
