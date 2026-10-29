/**
 * Tes komponen Banner.
 *
 * Banner memberi tahu pengguna soal kondisi aplikasi, dengan aksi dan tombol
 * tutup opsional.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { Banner } from './Banner';
import { Icon } from '../theme/Icon';
import { colors } from '../theme/tokens';

const KASUS_IKON: { tone: 'pending' | 'warning' | 'info' | 'danger' | 'success'; ikon: string }[] = [
  { tone: 'pending', ikon: 'cloud_upload' },
  { tone: 'warning', ikon: 'history' },
  { tone: 'info', ikon: 'sync' },
  { tone: 'danger', ikon: 'sync_problem' },
  { tone: 'success', ikon: 'payments' },
];

describe('Banner', () => {
  it('judul dan isi tampil', () => {
    const { getByText } = render(
      <Banner tone="info" title="Sinkronisasi jalan" body="Data dikirim otomatis" />,
    );
    expect(getByText('Sinkronisasi jalan')).toBeTruthy();
    expect(getByText('Data dikirim otomatis')).toBeTruthy();
  });

  it('tanpa onClose tidak ada tombol tutup', () => {
    const { queryByLabelText } = render(<Banner tone="info" title="Judul" />);
    expect(queryByLabelText('Tutup')).toBeNull();
  });

  it('tekan tombol tutup memanggil onClose', () => {
    const onClose = jest.fn();
    const { getByLabelText } = render(
      <Banner tone="info" title="Judul" onClose={onClose} />,
    );
    fireEvent.press(getByLabelText('Tutup'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('tekan aksi memanggil aksi yang diberikan', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <Banner tone="info" title="Judul" action={{ label: 'Coba lagi', onPress }} />,
    );
    fireEvent.press(getByText('Coba lagi'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each(KASUS_IKON)('tone $tone memakai ikon bawaannya', (kasus) => {
    const { UNSAFE_getAllByType } = render(<Banner tone={kasus.tone} title="Judul" />);
    expect(UNSAFE_getAllByType(Icon)[0].props.name).toBe(kasus.ikon);
  });

  it('nama ikon yang diberikan menggantikan ikon bawaan', () => {
    const { UNSAFE_getAllByType } = render(
      <Banner tone="info" title="Judul" icon="info" />,
    );
    expect(UNSAFE_getAllByType(Icon)[0].props.name).toBe('info');
  });

  it('tone pending memakai tepi putus-putus', () => {
    const { toJSON } = render(<Banner tone="pending" title="Judul" />);
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.borderStyle).toBe('dashed');
    expect(gaya.borderColor).toBe(colors.text);
  });

  it('warna isi sesuai tone', () => {
    const bahaya = StyleSheet.flatten(
      render(<Banner tone="danger" title="Judul" />).toJSON().props.style,
    );
    expect(bahaya.backgroundColor).toBe(colors.dangerSoft);
    const sukses = StyleSheet.flatten(
      render(<Banner tone="success" title="Judul" />).toJSON().props.style,
    );
    expect(sukses.backgroundColor).toBe(colors.successSoft);
  });
});
