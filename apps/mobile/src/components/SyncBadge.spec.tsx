/**
 * Tes komponen SyncBadge.
 *
 * Lencana ini memberitahu pengguna perubahan lokal belum sampai ke server.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { SyncBadge } from './SyncBadge';
import { Icon } from '../theme/Icon';
import { colors } from '../theme/tokens';

describe('SyncBadge', () => {
  it('keadaan pending menampilkan teks menunggu sinkronisasi', () => {
    const { getByText } = render(<SyncBadge state="pending" />);
    expect(getByText('Menunggu sinkronisasi')).toBeTruthy();
  });

  it('keadaan stale menampilkan teks belum tersinkron', () => {
    const { getByText } = render(<SyncBadge state="stale" />);
    expect(getByText('Belum tersinkron dari sejam lalu')).toBeTruthy();
  });

  it('keadaan pending pakai tepi putus-putus', () => {
    const { toJSON } = render(<SyncBadge state="pending" />);
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.borderStyle).toBe('dashed');
    expect(gaya.borderColor).toBe(colors.text);
  });

  it('warna isi sesuai keadaan', () => {
    const pending = StyleSheet.flatten(render(<SyncBadge state="pending" />).toJSON().props.style);
    expect(pending.backgroundColor).toBe(colors.surface);
    const stale = StyleSheet.flatten(render(<SyncBadge state="stale" />).toJSON().props.style);
    expect(stale.backgroundColor).toBe(colors.warningSoft);
  });

  it('ikon sesuai keadaan', () => {
    const pending = render(<SyncBadge state="pending" />);
    expect(pending.UNSAFE_getByType(Icon).props.name).toBe('cloud_upload');
    const stale = render(<SyncBadge state="stale" />);
    expect(stale.UNSAFE_getByType(Icon).props.name).toBe('history');
  });

  it('keadaan stale tidak punya tepi garis', () => {
    const { toJSON } = render(<SyncBadge state="stale" />);
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.borderWidth).toBe(0);
  });
});
