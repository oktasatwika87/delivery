/**
 * Tes pola ganti isi di tempat.
 *
 * Hook yang dipakai kalau isi di satu tempat berganti tapi tempatnya tetap.
 */

import React from 'react';
import { act, renderHook } from '@testing-library/react-native';

import { useGantiIsi } from './useGantiIsi';
import { InitialWindowProvider } from './InitialWindow';

interface Isi {
  isi: string;
  kunci: string;
}

const AWAL: Isi = { isi: 'satu', kunci: 'a' };

describe('useGantiIsi', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('render pertama tidak punya isi lama', () => {
    const { result } = renderHook(() => useGantiIsi('satu', 'a'));

    expect(result.current.lama).toBeNull();
    expect(result.current.nomor).toBe(0);
  });

  it('kunci yang berubah menyimpan isi lama dan menaikkan nomor', () => {
    const { result, rerender } = renderHook(
      ({ isi, kunci }: Isi) => useGantiIsi(isi, kunci),
      { initialProps: AWAL },
    );

    rerender({ isi: 'satu', kunci: 'b' });

    expect(result.current.lama).toBe('satu');
    expect(result.current.nomor).toBe(1);
  });

  it('selesai menutup isi lama', () => {
    const { result, rerender } = renderHook(
      ({ isi, kunci }: Isi) => useGantiIsi(isi, kunci),
      { initialProps: AWAL },
    );

    rerender({ isi: 'satu', kunci: 'b' });
    act(() => result.current.selesai(1));

    expect(result.current.lama).toBeNull();
    expect(result.current.nomor).toBe(1);
  });

  it('selesai dengan nomor lama diabaikan dan nomor baru mengosongkan', () => {
    const { result, rerender } = renderHook(
      ({ isi, kunci }: Isi) => useGantiIsi(isi, kunci),
      { initialProps: AWAL },
    );

    rerender({ isi: 'satu', kunci: 'b' });
    rerender({ isi: 'satu', kunci: 'c' });
    expect(result.current.nomor).toBe(2);

    act(() => result.current.selesai(1));
    expect(result.current.lama).toBe('satu');

    act(() => result.current.selesai(2));
    expect(result.current.lama).toBeNull();
  });

  it('isi yang berubah tanpa kunci berubah tidak bergerak', () => {
    const { result, rerender } = renderHook(
      ({ isi, kunci }: Isi) => useGantiIsi(isi, kunci),
      { initialProps: AWAL },
    );

    rerender({ isi: 'dua', kunci: 'a' });

    expect(result.current.lama).toBeNull();
    expect(result.current.nomor).toBe(0);
  });

  it('isi baru tiap render tidak bikin render berulang', () => {
    const { result, rerender } = renderHook(
      ({ kunci }: { kunci: string }) => useGantiIsi({ teks: kunci }, kunci),
      { initialProps: { kunci: 'a' } },
    );

    // Kunci sama: isi yang berubah tidak apa-apa.
    rerender({ kunci: 'a' });

    expect(result.current.nomor).toBe(0);
    expect(result.current.lama).toBeNull();

    // Kunci berubah: isi lama dari kunci sebelumnya.
    rerender({ kunci: 'b' });

    expect(result.current.nomor).toBe(1);
    expect(result.current.lama).toEqual({ teks: 'a' });
  });

  it('di dalam jendela awal pergantian tidak bergerak', () => {
    const bungkus = ({ children }: { children: React.ReactNode }) => (
      <InitialWindowProvider>{children}</InitialWindowProvider>
    );
    const { result, rerender } = renderHook(
      ({ isi, kunci }: Isi) => useGantiIsi(isi, kunci),
      { initialProps: AWAL, wrapper: bungkus },
    );

    rerender({ isi: 'satu', kunci: 'b' });

    expect(result.current.lama).toBeNull();
    expect(result.current.nomor).toBe(0);
  });

  it('kurangi gerakan membuat pergantian langsung', () => {
    const reanimated = require('react-native-reanimated') as {
      useReducedMotion: () => boolean;
    };
    jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);

    const { result, rerender } = renderHook(
      ({ isi, kunci }: Isi) => useGantiIsi(isi, kunci),
      { initialProps: AWAL },
    );

    rerender({ isi: 'satu', kunci: 'b' });

    expect(result.current.lama).toBeNull();
    expect(result.current.nomor).toBe(0);
  });
});
