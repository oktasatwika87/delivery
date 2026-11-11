/**
 * Tes jendela awal layar: elemen yang muncul begitu layar dibuka tidak
 * ikut gerak selama jendela ini masih terbuka.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, render, renderHook } from '@testing-library/react-native';

import {
  InitialWindowProvider,
  useInitialWindow,
  withInitialWindow,
} from './InitialWindow';
import { motion } from '../../theme/tokens';

describe('jendela awal layar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('di dalam penyedia jendela masih terbuka', () => {
    const { result } = renderHook(() => useInitialWindow(), {
      wrapper: InitialWindowProvider,
    });

    expect(result.current).toBe(true);
  });

  it('masih terbuka di 499 milidetik', () => {
    const { result } = renderHook(() => useInitialWindow(), {
      wrapper: InitialWindowProvider,
    });

    act(() => {
      jest.advanceTimersByTime(499);
    });

    expect(result.current).toBe(true);
  });

  it('tertutup di 500 milidetik', () => {
    const { result } = renderHook(() => useInitialWindow(), {
      wrapper: InitialWindowProvider,
    });

    act(() => {
      jest.advanceTimersByTime(motion.initialWindow);
    });

    expect(result.current).toBe(false);
  });

  it('tanpa penyedia jendela langsung tertutup', () => {
    const { result } = renderHook(() => useInitialWindow());

    expect(result.current).toBe(false);
  });

  it('pembungkus layar meneruskan props', () => {
    const Layar = withInitialWindow(
      ({ label }: { label: string }) => <Text>{label}</Text>,
    );

    const { getByText } = render(<Layar label="Isi layar" />);

    expect(getByText('Isi layar')).toBeTruthy();
  });

  it('pembungkus layar memberi jendela awal', () => {
    const Layar = withInitialWindow(() => {
      const dalamJendela = useInitialWindow();
      return <Text>{dalamJendela ? 'dalam jendela' : 'luar jendela'}</Text>;
    });

    const { getByText } = render(<Layar />);

    expect(getByText('dalam jendela')).toBeTruthy();
  });
});
