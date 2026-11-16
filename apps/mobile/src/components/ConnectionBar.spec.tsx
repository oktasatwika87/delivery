/**
 * Tes komponen ConnectionBar.
 *
 * Bilah ini cuma muncul kalau ada yang perlu diberi tahu ke pengguna.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { ConnectionBar } from './ConnectionBar';
import { CheckMark } from './motion/CheckMark';
import { InitialWindowProvider } from './motion/InitialWindow';
import { Icon } from '../theme/Icon';
import { themes } from '../theme/tokens';

const TITIK_TENGAH = '\u00b7';

describe('ConnectionBar', () => {
  it('offline menampilkan teks lengkap', () => {
    const { getByText } = render(<ConnectionBar status="offline" pendingCount={0} />);
    expect(getByText(`Offline ${TITIK_TENGAH} perubahan disimpan di HP`)).toBeTruthy();
  });

  it('offline dengan antrean tetap menampilkan teks offline', () => {
    const { getByText } = render(<ConnectionBar status="offline" pendingCount={3} />);
    expect(getByText(`Offline ${TITIK_TENGAH} perubahan disimpan di HP`)).toBeTruthy();
  });

  it('online dengan antrean menampilkan jumlah perubahan yang dikirim', () => {
    const { getByText } = render(<ConnectionBar status="online" pendingCount={3} />);
    expect(getByText('Menyinkronkan')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
    expect(getByText('perubahan')).toBeTruthy();
  });

  it('online tanpa antrean tidak merender apa pun', () => {
    const { toJSON } = render(<ConnectionBar status="online" pendingCount={0} />);
    expect(toJSON()).toBeNull();
  });

  it('status unknown dengan antrean tidak merender apa pun', () => {
    const { toJSON } = render(<ConnectionBar status="unknown" pendingCount={3} />);
    expect(toJSON()).toBeNull();
  });

  it('warna isi berbeda antara offline dan sedang sinkron', () => {
    const offline = StyleSheet.flatten(
      render(<ConnectionBar status="offline" pendingCount={0} />).toJSON().props.style,
    );
    expect(offline.backgroundColor).toBe(themes.gelap.surfaceRaised);
    const sinkron = StyleSheet.flatten(
      render(<ConnectionBar status="online" pendingCount={2} />).toJSON().props.style,
    );
    expect(sinkron.backgroundColor).toBe(themes.gelap.syncSoft);
  });

  it('warna teks offline dan teks sinkron mengikuti tema', () => {
    const offline = render(<ConnectionBar status="offline" pendingCount={0} />);
    expect(
      StyleSheet.flatten(offline.getByText(`Offline ${TITIK_TENGAH} perubahan disimpan di HP`).props.style)
        .color,
    ).toBe(themes.gelap.text);

    const sinkron = render(<ConnectionBar status="online" pendingCount={2} />);
    expect(StyleSheet.flatten(sinkron.getByText('Menyinkronkan').props.style).color).toBe(
      themes.gelap.text,
    );
    expect(StyleSheet.flatten(sinkron.getByText('2').props.style).color).toBe(
      themes.gelap.text,
    );
    expect(StyleSheet.flatten(sinkron.getByText('perubahan').props.style).color).toBe(
      themes.gelap.textMuted,
    );
  });

  it('ikon menyesuaikan keadaan', () => {
    const offline = render(<ConnectionBar status="offline" pendingCount={0} />);
    expect(offline.UNSAFE_getByType(Icon).props.name).toBe('cloud_off');
    const sinkron = render(<ConnectionBar status="online" pendingCount={2} />);
    expect(sinkron.UNSAFE_getByType(Icon).props.name).toBe('sync');
  });
});

describe('ConnectionBar yang menahan selesai', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('antrean habis tampil centang lalu bilahnya hilang', () => {
    const { rerender, UNSAFE_queryByType, queryByText, toJSON } = render(
      <ConnectionBar status="online" pendingCount={2} />,
    );

    rerender(<ConnectionBar status="online" pendingCount={0} />);

    expect(UNSAFE_queryByType(CheckMark)).toBeTruthy();
    expect(UNSAFE_queryByType(Icon)).toBeNull();
    expect(queryByText('0')).toBeNull();

    act(() => {
      jest.advanceTimersByTime(700);
    });

    expect(toJSON()).toBeNull();
  });

  it('antrean habis di dalam jendela awal langsung hilang', () => {
    const { rerender, toJSON } = render(
      <InitialWindowProvider>
        <ConnectionBar status="online" pendingCount={2} />
      </InitialWindowProvider>,
    );

    rerender(
      <InitialWindowProvider>
        <ConnectionBar status="online" pendingCount={0} />
      </InitialWindowProvider>,
    );

    expect(toJSON()).toBeNull();
  });

  it('berubah ke offline tampil teks offline tanpa centang', () => {
    const { rerender, getByText, UNSAFE_queryByType } = render(
      <ConnectionBar status="online" pendingCount={2} />,
    );

    rerender(<ConnectionBar status="offline" pendingCount={0} />);

    expect(getByText(`Offline ${TITIK_TENGAH} perubahan disimpan di HP`)).toBeTruthy();
    expect(UNSAFE_queryByType(CheckMark)).toBeNull();
  });

  it('dari offline ke online tanpa antrean langsung hilang', () => {
    const { rerender, toJSON } = render(
      <ConnectionBar status="offline" pendingCount={0} />,
    );

    rerender(<ConnectionBar status="online" pendingCount={0} />);

    expect(toJSON()).toBeNull();
  });

  it('antrean habis tapi ada aksi gagal: bilah hilang tanpa centang', () => {
    const { rerender, UNSAFE_queryByType, toJSON } = render(
      <ConnectionBar status="online" pendingCount={1} failedCount={1} />,
    );

    rerender(<ConnectionBar status="online" pendingCount={0} failedCount={1} />);

    expect(UNSAFE_queryByType(CheckMark)).toBeNull();
    expect(toJSON()).toBeNull();
  });

  it('offline dengan ada aksi gagal tetap menampilkan teks offline', () => {
    const { getByText } = render(
      <ConnectionBar status="offline" pendingCount={0} failedCount={2} />,
    );
    expect(getByText(`Offline ${TITIK_TENGAH} perubahan disimpan di HP`)).toBeTruthy();
  });
});
