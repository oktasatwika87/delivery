/**
 * Tes komponen StatusLabel.
 *
 * Status menentukan ikon dan warna isi, teks label datang dari pemanggil.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { OrderStatus } from '@delivery/shared';

import { StatusLabel } from './StatusLabel';
import { InitialWindowProvider } from './motion/InitialWindow';
import { Icon } from '../theme/Icon';
import { themes } from '../theme/tokens';

const KASUS: { status: OrderStatus; ikon: string; isi: string; teks: string }[] = [
  {
    status: OrderStatus.ASSIGNED,
    ikon: 'search',
    isi: themes.gelap.fillNeutral,
    teks: themes.gelap.text,
  },
  {
    status: OrderStatus.PENDING,
    ikon: 'inventory_2',
    isi: themes.gelap.fillNeutral,
    teks: themes.gelap.text,
  },
  {
    status: OrderStatus.CONFIRMED,
    ikon: 'inventory_2',
    isi: themes.gelap.fillNeutral,
    teks: themes.gelap.text,
  },
  {
    status: OrderStatus.PREPARING,
    ikon: 'inventory_2',
    isi: themes.gelap.fillNeutral,
    teks: themes.gelap.text,
  },
  {
    status: OrderStatus.OUT_FOR_DELIVERY,
    ikon: 'two_wheeler',
    isi: themes.gelap.infoSoft,
    teks: themes.gelap.onInfoSoft,
  },
  {
    status: OrderStatus.DELIVERED,
    ikon: 'check_circle',
    isi: themes.gelap.accentSoft,
    teks: themes.gelap.onAccentSoft,
  },
  {
    status: OrderStatus.CANCELLED,
    ikon: 'cancel',
    isi: themes.gelap.dangerSoft,
    teks: themes.gelap.danger,
  },
];

describe('StatusLabel', () => {
  it('label tampil apa adanya dari pemanggil', () => {
    const { getByText } = render(
      <StatusLabel status={OrderStatus.PENDING} label="Menunggu konfirmasi" />,
    );
    expect(getByText('Menunggu konfirmasi')).toBeTruthy();
  });

  it.each(KASUS)('status $status memakai ikon dan warna isi yang benar', (kasus) => {
    const { toJSON, UNSAFE_getByType } = render(
      <StatusLabel status={kasus.status} label="Label" />,
    );
    expect(UNSAFE_getByType(Icon).props.name).toBe(kasus.ikon);
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.backgroundColor).toBe(kasus.isi);
  });

  it('label status tidak punya tepi garis', () => {
    const { toJSON } = render(<StatusLabel status={OrderStatus.ASSIGNED} label="Label" />);
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.borderWidth).toBeUndefined();
  });

  it('teks dan ikon warnanya sama', () => {
    const { getByText, UNSAFE_getByType } = render(
      <StatusLabel status={OrderStatus.DELIVERED} label="Terkirim" />,
    );
    const gayaTeks = StyleSheet.flatten(getByText('Terkirim').props.style);
    expect(gayaTeks.color).toBe(themes.gelap.onAccentSoft);
    expect(UNSAFE_getByType(Icon).props.color).toBe(themes.gelap.onAccentSoft);
  });

  it('tinggi label dan sudutnya ikut token', () => {
    const { toJSON } = render(<StatusLabel status={OrderStatus.PENDING} label="Label" />);
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.height).toBe(28);
    expect(gaya.borderRadius).toBe(8);
    expect(gaya.paddingHorizontal).toBe(10);
  });

  it('status yang berganti menyisakan label baru dengan warna status baru', () => {
    const pohon = render(
      <StatusLabel status={OrderStatus.PENDING} label="Menunggu konfirmasi" />,
    );
    pohon.rerender(
      <StatusLabel status={OrderStatus.DELIVERED} label="Terkirim" />,
    );

    expect(pohon.queryByText('Menunggu konfirmasi')).toBeNull();
    expect(pohon.getByText('Terkirim')).toBeTruthy();

    const gayaTeks = StyleSheet.flatten(pohon.getByText('Terkirim').props.style);
    expect(gayaTeks.color).toBe(themes.gelap.onAccentSoft);

    const gaya = StyleSheet.flatten(pohon.toJSON().props.style);
    expect(gaya.backgroundColor).toBe(themes.gelap.accentSoft);
    expect(pohon.getByTestId('pil-status').props.entering).toBeDefined();
  });

  it('di dalam jendela awal status yang berganti tidak menyimpan pil lama', () => {
    const pohon = render(
      <InitialWindowProvider>
        <StatusLabel status={OrderStatus.PENDING} label="Menunggu konfirmasi" />
      </InitialWindowProvider>,
    );
    pohon.rerender(
      <InitialWindowProvider>
        <StatusLabel status={OrderStatus.DELIVERED} label="Terkirim" />
      </InitialWindowProvider>,
    );

    expect(pohon.queryByText('Menunggu konfirmasi')).toBeNull();
    expect(pohon.getByText('Terkirim')).toBeTruthy();
    expect(pohon.getByTestId('pil-status').props.entering).toBeUndefined();
  });

  it('pembungkus label status menempel ke kiri', () => {
    const { toJSON } = render(
      <StatusLabel status={OrderStatus.PENDING} label="Label" />,
    );
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.alignSelf).toBe('flex-start');
  });

  it('status yang berganti tidak memunculkan peringatan console', () => {
    const galat = jest.spyOn(console, 'error');

    const pohon = render(
      <StatusLabel status={OrderStatus.PENDING} label="Menunggu konfirmasi" />,
    );
    pohon.rerender(
      <StatusLabel status={OrderStatus.DELIVERED} label="Terkirim" />,
    );

    expect(galat).not.toHaveBeenCalled();

    galat.mockRestore();
  });
});
