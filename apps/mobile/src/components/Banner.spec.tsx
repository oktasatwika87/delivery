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
import { InitialWindowProvider } from './motion/InitialWindow';
import { Icon } from '../theme/Icon';
import { themes } from '../theme/tokens';

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
    expect(gaya.borderColor).toBe(themes.gelap.pendingLine);
  });

  it('tone pending tanpa isi dan isinya rata tengah', () => {
    const { toJSON } = render(<Banner tone="pending" title="Judul" />);
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.backgroundColor).toBeUndefined();
    expect(gaya.minHeight).toBe(52);
    expect(gaya.justifyContent).toBe('center');
  });

  it('warna isi sesuai tone', () => {
    const bahaya = StyleSheet.flatten(
      render(<Banner tone="danger" title="Judul" />).toJSON().props.style,
    );
    expect(bahaya.backgroundColor).toBe(themes.gelap.dangerSoft);
    const sukses = StyleSheet.flatten(
      render(<Banner tone="success" title="Judul" />).toJSON().props.style,
    );
    expect(sukses.backgroundColor).toBe(themes.gelap.infoSoft);
    const informasi = StyleSheet.flatten(
      render(<Banner tone="info" title="Judul" />).toJSON().props.style,
    );
    expect(informasi.backgroundColor).toBe(themes.gelap.infoSoft);
  });

  it('warna ikon mengikuti tone', () => {
    const bahaya = render(<Banner tone="danger" title="Judul" />);
    expect(bahaya.UNSAFE_getAllByType(Icon)[0].props.color).toBe(themes.gelap.danger);
    const informasi = render(<Banner tone="info" title="Judul" />);
    expect(informasi.UNSAFE_getAllByType(Icon)[0].props.color).toBe(themes.gelap.info);
    const sukses = render(<Banner tone="success" title="Judul" />);
    expect(sukses.UNSAFE_getAllByType(Icon)[0].props.color).toBe(themes.gelap.info);
  });

  it('wadah memakai sudut, padding, dan jarak versi 2', () => {
    const { toJSON } = render(<Banner tone="info" title="Judul" />);
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.borderRadius).toBe(14);
    expect(gaya.paddingVertical).toBe(12);
    expect(gaya.paddingHorizontal).toBe(14);
    expect(gaya.gap).toBe(10);
  });

  it('tombol tutup berukuran 44 dengan ikon close', () => {
    const { getByLabelText, UNSAFE_getAllByType } = render(
      <Banner tone="info" title="Judul" onClose={() => {}} />,
    );
    const gaya = StyleSheet.flatten(getByLabelText('Tutup').props.style);
    expect(gaya.width).toBe(44);
    expect(gaya.height).toBe(44);
    const ikonTutup = UNSAFE_getAllByType(Icon).find((ikon) => ikon.props.name === 'close');
    expect(ikonTutup?.props.size).toBe(24);
    expect(ikonTutup?.props.color).toBe(themes.gelap.text);
  });

  it('di dalam jendela awal akar tidak punya entering', () => {
    const { toJSON } = render(
      <InitialWindowProvider>
        <Banner tone="info" title="Judul" />
      </InitialWindowProvider>,
    );
    expect(toJSON().props.entering).toBeUndefined();
  });

  it('tanpa penyedia akar punya entering', () => {
    const { toJSON } = render(<Banner tone="info" title="Judul" />);
    expect(toJSON().props.entering).toBeDefined();
  });
});
