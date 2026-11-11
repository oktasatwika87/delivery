/**
 * Tes tahan selesai: bentuk selesai ditahan sebentar sebelum ilang.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { useHoldDone } from './useHoldDone';
import { InitialWindowProvider } from './InitialWindow';
import { motion } from '../../theme/tokens';

function Komponen({ waiting }: { waiting: boolean }): React.JSX.Element {
  const fase = useHoldDone(waiting);
  return <Text>{fase}</Text>;
}

describe('tahan selesai', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('saat awal sudah selesai langsung disembunyikan', () => {
    const { getByText } = render(<Komponen waiting={false} />);

    expect(getByText('hidden')).toBeTruthy();
  });

  it('saat awal masih menunggu ditahan di bentuk menunggu', () => {
    const { getByText } = render(<Komponen waiting={true} />);

    expect(getByText('waiting')).toBeTruthy();
  });

  it('selesai di luar jendela tampil bentuk selesai dulu', () => {
    const { getByText, rerender } = render(<Komponen waiting={true} />);

    rerender(<Komponen waiting={false} />);

    expect(getByText('done')).toBeTruthy();
  });

  it('bentuk selesai ditahan sampai 699 milidetik', () => {
    const { getByText, rerender } = render(<Komponen waiting={true} />);
    rerender(<Komponen waiting={false} />);

    act(() => {
      jest.advanceTimersByTime(motion.duration.holdDone - 1);
    });

    expect(getByText('done')).toBeTruthy();
  });

  it('bentuk selesai hilang di 700 milidetik', () => {
    const { getByText, rerender } = render(<Komponen waiting={true} />);
    rerender(<Komponen waiting={false} />);

    act(() => {
      jest.advanceTimersByTime(motion.duration.holdDone);
    });

    expect(getByText('hidden')).toBeTruthy();
  });

  it('menunggu lagi saat ditahan membatalkan hitungan', () => {
    const { getByText, rerender } = render(<Komponen waiting={true} />);
    rerender(<Komponen waiting={false} />);
    rerender(<Komponen waiting={true} />);

    act(() => {
      jest.advanceTimersByTime(motion.duration.holdDone);
    });

    expect(getByText('waiting')).toBeTruthy();
  });

  it('selesai di dalam jendela langsung disembunyikan', () => {
    const { getByText, rerender } = render(
      <InitialWindowProvider>
        <Komponen waiting={true} />
      </InitialWindowProvider>,
    );

    rerender(
      <InitialWindowProvider>
        <Komponen waiting={false} />
      </InitialWindowProvider>,
    );

    expect(getByText('hidden')).toBeTruthy();
  });

  it('dilepas saat ditahan tanpa peringatan', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender, unmount } = render(<Komponen waiting={true} />);
    rerender(<Komponen waiting={false} />);

    unmount();

    act(() => {
      jest.advanceTimersByTime(motion.duration.holdDone * 2);
    });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
