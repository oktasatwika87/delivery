/**
 * Tes angka bergulir: digit yang berubah bergulir, bagian yang tidak
 * berubah tetap diam.
 */

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { RollingNumber, rollSegments } from './RollingNumber';
import { InitialWindowProvider } from './InitialWindow';
import { type } from '../../theme/tokens';

const gaya = type.bodySm;

function formatJumlah(nilai: number): string {
  return `Jumlah ${nilai}`;
}

describe('bagian angka bergulir', () => {
  it('digit yang berubah jadi kolom', () => {
    expect(
      rollSegments('Menyinkronkan 3 perubahan', 'Menyinkronkan 2 perubahan'),
    ).toEqual([
      { kind: 'fixed', text: 'Menyinkronkan' },
      { kind: 'column', from: ' 3', to: ' 2' },
      { kind: 'fixed', text: ' perubahan' },
    ]);
  });

  it('dua digit bersebelahan jadi dua kolom', () => {
    expect(rollSegments('120.000', '143.000')).toEqual([
      { kind: 'fixed', text: '1' },
      { kind: 'column', from: '2', to: '4' },
      { kind: 'column', from: '0', to: '3' },
      { kind: 'fixed', text: '.000' },
    ]);
  });

  it('teks yang sama jadi satu bagian tetap', () => {
    expect(rollSegments('12', '12')).toEqual([{ kind: 'fixed', text: '12' }]);
  });

  it('seluruh teks beda bukan digit jadi bagian tetap', () => {
    expect(rollSegments('a-b', 'a+b')).toEqual([{ kind: 'fixed', text: 'a+b' }]);
  });
});

describe('angka bergulir', () => {
  it('teks utuh tampil sebagai satu Text', () => {
    const { getByText } = render(
      <RollingNumber value={12} format={formatJumlah} style={gaya} />,
    );

    expect(getByText('Jumlah 12')).toBeTruthy();
  });

  it('setelah nilai berubah hanya ada satu teks baru', () => {
    const { getAllByText, rerender, UNSAFE_queryAllByType } = render(
      <RollingNumber value={12} format={formatJumlah} style={gaya} />,
    );

    rerender(<RollingNumber value={13} format={formatJumlah} style={gaya} />);

    expect(getAllByText('Jumlah 13')).toHaveLength(1);
    expect(UNSAFE_queryAllByType(Text)).toHaveLength(1);
  });

  it('di dalam jendela awal nilai langsung diganti', () => {
    const { getAllByText, rerender, UNSAFE_queryAllByType } = render(
      <InitialWindowProvider>
        <RollingNumber value={12} format={formatJumlah} style={gaya} />
      </InitialWindowProvider>,
    );

    rerender(
      <InitialWindowProvider>
        <RollingNumber value={13} format={formatJumlah} style={gaya} />
      </InitialWindowProvider>,
    );

    expect(getAllByText('Jumlah 13')).toHaveLength(1);
    expect(UNSAFE_queryAllByType(Text)).toHaveLength(1);
  });
});
