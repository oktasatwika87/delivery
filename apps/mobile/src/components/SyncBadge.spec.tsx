/**
 * Tes komponen SyncBadge.
 *
 * Lencana ini memberitahu pengguna perubahan lokal belum sampai ke server.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { SyncBadge } from './SyncBadge';
import { CheckMark } from './motion/CheckMark';
import { InitialWindowProvider } from './motion/InitialWindow';
import { Icon } from '../theme/Icon';
import { colors } from '../theme/tokens';

describe('SyncBadge', () => {
  it('keadaan pending menampilkan teks menunggu sinkronisasi', () => {
    const { getByText } = render(<SyncBadge state="pending" />);
    expect(getByText('Menunggu sinkronisasi')).toBeTruthy();
  });

  it('keadaan stale menampilkan teks belum tersinkron', () => {
    const { getByText } = render(<SyncBadge state="stale" />);
    expect(getByText('Belum tersinkron dari sejam lalu')).toBeTruthy();
  });

  it('keadaan pending pakai tepi putus-putus', () => {
    const { getByTestId } = render(<SyncBadge state="pending" />);
    const gaya = StyleSheet.flatten(getByTestId('lencana-sinkron').props.style);
    expect(gaya.borderStyle).toBe('dashed');
    expect(gaya.borderColor).toBe(colors.text);
  });

  it('warna isi sesuai keadaan', () => {
    const pending = StyleSheet.flatten(
      render(<SyncBadge state="pending" />).getByTestId('lencana-sinkron').props.style,
    );
    expect(pending.backgroundColor).toBe(colors.surface);
    const stale = StyleSheet.flatten(
      render(<SyncBadge state="stale" />).getByTestId('lencana-sinkron').props.style,
    );
    expect(stale.backgroundColor).toBe(colors.warningSoft);
  });

  it('ikon sesuai keadaan', () => {
    const pending = render(<SyncBadge state="pending" />);
    expect(pending.UNSAFE_getByType(Icon).props.name).toBe('cloud_upload');
    const stale = render(<SyncBadge state="stale" />);
    expect(stale.UNSAFE_getByType(Icon).props.name).toBe('history');
  });

  it('keadaan stale tidak punya tepi garis', () => {
    const { getByTestId } = render(<SyncBadge state="stale" />);
    const gaya = StyleSheet.flatten(getByTestId('lencana-sinkron').props.style);
    expect(gaya.borderWidth).toBe(0);
  });

  it('dipasang langsung dengan pending tidak ada entering', () => {
    const { toJSON } = render(<SyncBadge state="pending" />);
    expect(toJSON().props.entering).toBeUndefined();
  });
});

describe('SyncBadge yang menahan selesai', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('dari pending ke null tampil centang lalu lencananya hilang', () => {
    const { rerender, UNSAFE_queryByType, UNSAFE_queryAllByType, toJSON } = render(
      <SyncBadge state="pending" />,
    );

    rerender(<SyncBadge state={null} />);

    expect(UNSAFE_queryAllByType(CheckMark)).toHaveLength(1);
    expect(UNSAFE_queryByType(Icon)).toBeNull();

    act(() => {
      jest.advanceTimersByTime(700);
    });

    expect(toJSON()).toBeNull();
  });

  it('dari pending ke null di dalam jendela langsung hilang', () => {
    const { rerender, toJSON } = render(
      <InitialWindowProvider>
        <SyncBadge state="pending" />
      </InitialWindowProvider>,
    );

    rerender(
      <InitialWindowProvider>
        <SyncBadge state={null} />
      </InitialWindowProvider>,
    );

    expect(toJSON()).toBeNull();
  });

  it('null sejak awal tidak merender apa pun', () => {
    const { toJSON } = render(<SyncBadge state={null} />);
    expect(toJSON()).toBeNull();
  });

  it('dari selesai ke pending lagi lencana tetap ada', () => {
    const { rerender, UNSAFE_getByType } = render(<SyncBadge state="pending" />);
    rerender(<SyncBadge state={null} />);
    rerender(<SyncBadge state="pending" />);

    act(() => {
      jest.advanceTimersByTime(700);
    });

    expect(UNSAFE_getByType(Icon).props.name).toBe('cloud_upload');
  });

  it('dari pending ke stale ikon berubah tanpa centang', () => {
    const { rerender, UNSAFE_getByType, UNSAFE_queryByType } = render(
      <SyncBadge state="pending" />,
    );

    rerender(<SyncBadge state="stale" />);

    expect(UNSAFE_getByType(Icon).props.name).toBe('history');
    expect(UNSAFE_queryByType(CheckMark)).toBeNull();
  });

  it('dipasang null lalu pending akar punya entering', () => {
    const { rerender, toJSON } = render(<SyncBadge state={null} />);

    rerender(<SyncBadge state="pending" />);

    expect(toJSON().props.entering).toBeDefined();
  });

  it('pending lalu null lewat 700 ms lalu pending akar punya entering', () => {
    const { rerender, toJSON } = render(<SyncBadge state="pending" />);

    rerender(<SyncBadge state={null} />);

    act(() => {
      jest.advanceTimersByTime(700);
    });

    rerender(<SyncBadge state="pending" />);

    expect(toJSON().props.entering).toBeDefined();
  });
});
