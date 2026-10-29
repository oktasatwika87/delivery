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
import { Icon } from '../theme/Icon';
import { colors } from '../theme/tokens';

const KASUS: { status: OrderStatus; ikon: string; isi: string }[] = [
  { status: OrderStatus.ASSIGNED, ikon: 'search', isi: colors.surface },
  { status: OrderStatus.PENDING, ikon: 'inventory_2', isi: colors.fillNeutral },
  { status: OrderStatus.CONFIRMED, ikon: 'inventory_2', isi: colors.fillNeutral },
  { status: OrderStatus.PREPARING, ikon: 'inventory_2', isi: colors.fillNeutral },
  {
    status: OrderStatus.OUT_FOR_DELIVERY,
    ikon: 'two_wheeler',
    isi: colors.surfaceInverse,
  },
  { status: OrderStatus.DELIVERED, ikon: 'check_circle_fill', isi: colors.successSoft },
  { status: OrderStatus.CANCELLED, ikon: 'close', isi: colors.dangerSoft },
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

  it('status yang searching driver punya tepi garis tebal', () => {
    const { toJSON } = render(<StatusLabel status={OrderStatus.ASSIGNED} label="Label" />);
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.borderWidth).toBeGreaterThan(0);
    expect(gaya.borderColor).toBe(colors.lineStrong);
  });

  it('teks dan ikon warnanya sama', () => {
    const { getByText, UNSAFE_getByType } = render(
      <StatusLabel status={OrderStatus.DELIVERED} label="Terkirim" />,
    );
    const gayaTeks = StyleSheet.flatten(getByText('Terkirim').props.style);
    expect(gayaTeks.color).toBe(colors.successStrong);
    expect(UNSAFE_getByType(Icon).props.color).toBe(colors.successStrong);
  });
});
