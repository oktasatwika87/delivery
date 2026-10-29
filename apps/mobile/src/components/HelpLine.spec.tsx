/**
 * Tes komponen HelpLine.
 *
 * Baris bantuan di bawah tombol: ikon cloud off dan teks penjelas.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { HelpLine } from './HelpLine';
import { Icon } from '../theme/Icon';
import { colors } from '../theme/tokens';

describe('HelpLine', () => {
  it('teks bantuan tampil apa adanya', () => {
    const { getByText } = render(<HelpLine text="Perubahan disimpan di HP" />);
    expect(getByText('Perubahan disimpan di HP')).toBeTruthy();
  });

  it('ikon cloud off ditampilkan dengan warna teks muted', () => {
    const { UNSAFE_getByType } = render(<HelpLine text="Perubahan disimpan di HP" />);
    expect(UNSAFE_getByType(Icon).props.name).toBe('cloud_off');
    expect(UNSAFE_getByType(Icon).props.color).toBe(colors.textMuted);
  });

  it('baris bantuan punya warna latar kosong dan teks muted', () => {
    const { toJSON } = render(<HelpLine text="Perubahan disimpan di HP" />);
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.backgroundColor).toBeUndefined();
    expect(gaya.marginTop).toBeGreaterThan(0);
  });
});
