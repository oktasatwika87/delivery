/**
 * Tes komponen CashBox.
 *
 * Kotak tunai punya dua bentuk, tagih dan diterima. Isinya berganti di tempat
 * waktu bentuknya berubah.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';
import { Circle, Path } from 'react-native-svg';

import { CashBox } from './CashBox';
import { DrawnStroke } from './motion/DrawnPath';
import { InitialWindowProvider } from './motion/InitialWindow';
import { iconPaths } from '../theme/icons';
import { themes, size, space } from '../theme/tokens';

const JUMLAH = 'Rp 25.000';

function kotak(variant: 'tagih' | 'diterima'): React.JSX.Element {
  return <CashBox variant={variant} amountText={JUMLAH} />;
}

describe('CashBox', () => {
  it('bentuk tagih menampilkan teks, ikon, dan jumlah', () => {
    const pohon = render(kotak('tagih'));

    const teks = StyleSheet.flatten(pohon.getByText('Tagih tunai ke customer').props.style);
    expect(teks.color).toBe(themes.gelap.textMuted);
    expect(teks.fontFamily).toBe('PlusJakartaSans-Regular');

    const jumlah = StyleSheet.flatten(pohon.getByText(JUMLAH).props.style);
    expect(jumlah.color).toBe(themes.gelap.text);
    expect(jumlah.fontFamily).toBe('PlusJakartaSans-Bold');

    const kotakGaya = StyleSheet.flatten(pohon.getByTestId('kotak-tunai').props.style);
    expect(kotakGaya.backgroundColor).toBe(themes.gelap.surface);
    expect(kotakGaya.borderColor).toBe(themes.gelap.accentLine);

    const path = pohon.UNSAFE_getAllByType(Path);
    expect(path.some((el) => el.props.d === iconPaths.payments.d)).toBe(true);
  });

  it('bentuk diterima menampilkan tanda centang tanpa digambar', () => {
    const pohon = render(kotak('diterima'));

    const teks = StyleSheet.flatten(pohon.getByText('Pembayaran tunai diterima').props.style);
    expect(teks.color).toBe(themes.gelap.text);
    expect(teks.fontFamily).toBe('PlusJakartaSans-Medium');

    const jumlah = StyleSheet.flatten(pohon.getByText(JUMLAH).props.style);
    expect(jumlah.fontFamily).toBe('PlusJakartaSans-SemiBold');

    const kotakGaya = StyleSheet.flatten(pohon.getByTestId('kotak-tunai').props.style);
    expect(kotakGaya.backgroundColor).toBe(themes.gelap.infoWash);
    expect(kotakGaya.borderColor).toBe(themes.gelap.infoLine);

    const lingkaran = pohon.UNSAFE_getAllByType(Circle);
    expect(lingkaran).toHaveLength(1);
    expect(lingkaran[0].props.fill).toBe(themes.gelap.infoFill);
    expect(lingkaran[0].props.r).toBe(11);

    const centang = pohon.UNSAFE_getAllByType(DrawnStroke);
    expect(centang).toHaveLength(1);
    expect(centang[0].props.animate).toBe(false);
  });

  it('kedua bentuk punya label aksesibel', () => {
    const pohon = render(kotak('tagih'));
    expect(pohon.getByLabelText(`Tagih tunai ke customer, ${JUMLAH}`)).toBeTruthy();

    const lain = render(kotak('diterima'));
    expect(lain.getByLabelText(`Pembayaran tunai diterima, ${JUMLAH}`)).toBeTruthy();
  });

  it('pergantian ke diterima menyisakan isi baru saja dan centang digambar', () => {
    const pohon = render(kotak('tagih'));
    pohon.rerender(kotak('diterima'));

    expect(pohon.queryByText('Tagih tunai ke customer')).toBeNull();
    expect(pohon.getByText('Pembayaran tunai diterima')).toBeTruthy();

    const centang = pohon.UNSAFE_getAllByType(DrawnStroke);
    expect(centang).toHaveLength(1);
    expect(centang[0].props.animate).toBe(true);
  });

  it('di dalam jendela awal pergantian tidak menyimpan isi lama', () => {
    const pohon = render(
      <InitialWindowProvider>{kotak('tagih')}</InitialWindowProvider>,
    );
    pohon.rerender(<InitialWindowProvider>{kotak('diterima')}</InitialWindowProvider>);

    expect(pohon.queryByText('Tagih tunai ke customer')).toBeNull();
    expect(pohon.getByText('Pembayaran tunai diterima')).toBeTruthy();

    const centang = pohon.UNSAFE_getAllByType(DrawnStroke);
    expect(centang).toHaveLength(1);
    expect(centang[0].props.animate).toBe(false);
  });

  it('kotak tunai tidak dikunci tinggi, jadi label panjang tidak terpotong', () => {
    const pohon = render(kotak('tagih'));

    const gaya = StyleSheet.flatten(pohon.getByTestId('kotak-tunai').props.style);
    expect(gaya.minHeight).toBe(size.cashbox);
    expect(gaya.paddingVertical).toBe(space[2]);
    expect(gaya.height).toBeUndefined();
  });

  it('pergantian isi tidak memunculkan peringatan console', () => {
    const galat = jest.spyOn(console, 'error');

    const pohon = render(kotak('tagih'));
    pohon.rerender(kotak('diterima'));

    expect(galat).not.toHaveBeenCalled();

    galat.mockRestore();
  });
});
