/**
 * Tes detak status basi.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { DETAK_BASI_MS, useDetakBasi } from './useDetakBasi';

/** Komponen penguji yang menampilkan angka detaknya. */
function Pemakai({ aktif }: { aktif: boolean }) {
  const detak = useDetakBasi(aktif);
  return <Text testID="detak">{detak}</Text>;
}

describe('detak status basi', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('detak naik satu setelah satu menit saat aktif', () => {
    const { getByTestId } = render(<Pemakai aktif />);

    expect(getByTestId('detak').props.children).toBe(0);

    act(() => {
      jest.advanceTimersByTime(DETAK_BASI_MS);
    });

    expect(getByTestId('detak').props.children).toBe(1);
  });

  test('detak tetap dan tidak ada pewaktu saat tidak aktif', () => {
    const { getByTestId } = render(<Pemakai aktif={false} />);

    act(() => {
      jest.advanceTimersByTime(DETAK_BASI_MS * 2);
    });

    expect(getByTestId('detak').props.children).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  test('pewaktu dibersihkan saat aktif berubah jadi tidak aktif', () => {
    const { rerender } = render(<Pemakai aktif />);

    expect(jest.getTimerCount()).toBe(1);

    rerender(<Pemakai aktif={false} />);

    expect(jest.getTimerCount()).toBe(0);
  });
});
