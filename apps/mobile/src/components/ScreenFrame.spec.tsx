/**
 * Tes kerangka layar.
 *
 * Yang diuji: latar layar dan status bar, bilah koneksi, urutan anak isi
 * layar, bilah bawah, dan gerak isi layar.
 */

import React from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import { render } from '@testing-library/react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConnectionBar } from './ConnectionBar';
import type { ConnectionBarProps } from './ConnectionBar';
import { InitialWindowProvider } from './motion/InitialWindow';
import { ScreenFrame } from './ScreenFrame';
import { ThemeProvider } from '../theme/ThemeProvider';
import { stroke, themes } from '../theme/tokens';

const KONEKSI: ConnectionBarProps = {
  status: 'offline',
  pendingCount: 2,
  failedCount: 1,
};

/** Elemen pohon uji. Cuma bagian yang dipakai di berkas ini. */
interface Instansi {
  parent: Instansi | null;
  children: Array<Instansi | string>;
  props: Record<string, unknown>;
  type: unknown;
}

/** Leluhur sebuah elemen, dari yang paling dekat sampai akar pohon. */
function leluhr(term: Instansi): Instansi[] {
  const hasil: Instansi[] = [];
  let sekarang: Instansi | null = term.parent;
  while (sekarang) {
    hasil.push(sekarang);
    sekarang = sekarang.parent;
  }
  return hasil;
}

/** Anak elemen, tanpa teks. */
function anak(term: Instansi): Instansi[] {
  return term.children.filter(
    (child): child is Instansi => typeof child !== 'string',
  );
}

/**
 * Isi layar.
 *
 * Dicari dari leluhur kepala, karena isi layar adalah elemen yang punya
 * prop layout.
 */
function isiLayar(term: Instansi): Instansi {
  let sekarang: Instansi | null = term.parent;
  while (sekarang) {
    if ('layout' in sekarang.props) return sekarang;
    sekarang = sekarang.parent;
  }
  throw new Error('isi layar tidak ditemukan');
}

/** Bilah bawah, yaitu anak terakhir isi layar. */
function bilahBawah(term: Instansi): Instansi {
  const daftar = anak(term);
  return daftar[daftar.length - 1];
}

/** Isi bilah bawah, tempat gaya bilah diletakkan. */
function isiBilahBawah(term: Instansi): Instansi {
  return anak(bilahBawah(term))[0];
}

/** Gaya pada sebuah elemen, digabung jadi satu objek. */
function gaya(term: Instansi): ViewStyle {
  return StyleSheet.flatten(term.props.style as ViewStyle);
}

interface Opsi {
  bottomBar?: React.ReactNode;
  connection?: ConnectionBarProps;
}

function renderKerangka(opsi: Opsi = {}) {
  return render(
    <ThemeProvider name="gelap">
      <ScreenFrame
        header={<View testID="kepala-layar" />}
        connection={opsi.connection ?? KONEKSI}
        bottomBar={opsi.bottomBar}
      >
        <>
          <View testID="isi-satu" />
          <View testID="isi-dua" />
        </>
      </ScreenFrame>
    </ThemeProvider>,
  );
}

const mockInsets = useSafeAreaInsets as jest.MockedFunction<typeof useSafeAreaInsets>;

beforeEach(() => {
  mockInsets.mockReset();
  mockInsets.mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0 });
});

describe('kerangka layar', () => {
  test('latar layar dan status bar pakai warna tema gelap', () => {
    const { toJSON, UNSAFE_getAllByType } = renderKerangka();

    const gayaLayar = StyleSheet.flatten(toJSON().props.style);
    expect(gayaLayar.backgroundColor).toBe(themes.gelap.bg);

    const statusBar = UNSAFE_getAllByType(StatusBar)[0];
    expect(statusBar.props.barStyle).toBe('light-content');
    expect(statusBar.props.backgroundColor).toBe(themes.gelap.header);
  });

  test('bilah koneksi menerima angka dari props koneksi', () => {
    const { UNSAFE_getByType } = renderKerangka();

    const bilah = UNSAFE_getByType(ConnectionBar);
    expect(bilah.props.status).toBe('offline');
    expect(bilah.props.pendingCount).toBe(2);
    expect(bilah.props.failedCount).toBe(1);
  });

  test('bilah koneksi tanpa jumlah gagal tetap dapat nol', () => {
    const { UNSAFE_getByType } = renderKerangka({
      connection: { status: 'offline', pendingCount: 0 },
    });

    expect(UNSAFE_getByType(ConnectionBar).props.failedCount).toBe(0);
  });

  test('bilah koneksi bukan turunan isi layar', () => {
    const { getByTestId, UNSAFE_getByType } = renderKerangka();

    const isi = isiLayar(getByTestId('kepala-layar'));
    const leluhrBilah = leluhr(UNSAFE_getByType(ConnectionBar));

    expect(leluhrBilah.includes(isi)).toBe(false);
  });

  test('isi layar urutannya kepala lalu anak-anak isi tanpa pembungkus', () => {
    const { getByTestId } = renderKerangka();

    const isi = isiLayar(getByTestId('kepala-layar'));
    const urutan = anak(isi);

    expect(urutan).toHaveLength(3);
    expect(urutan[0].props.testID).toBe('kepala-layar');
    expect(urutan[1].props.testID).toBe('isi-satu');
    expect(urutan[2].props.testID).toBe('isi-dua');
  });

  test('tanpa bilah bawah isi layar cuma isi konten', () => {
    const { getByTestId } = renderKerangka();

    const isi = isiLayar(getByTestId('kepala-layar'));

    expect(anak(isi)).toHaveLength(3);
  });

  test('bilah bawah jadi anak terakhir isi layar', () => {
    const { getByTestId } = renderKerangka({ bottomBar: <View testID="bawah" /> });

    const isi = isiLayar(getByTestId('kepala-layar'));
    const urutan = anak(isi);

    expect(urutan).toHaveLength(4);
    expect(leluhr(getByTestId('bawah')).includes(bilahBawah(isi))).toBe(true);
  });

  test('bilah bawah pakai padding bawah 16 saat inset nol', () => {
    const { getByTestId } = renderKerangka({ bottomBar: <View testID="bawah" /> });

    const isi = isiLayar(getByTestId('kepala-layar'));
    const gayaBilah = gaya(isiBilahBawah(isi));

    expect(gayaBilah.paddingBottom).toBe(16);
    expect(gayaBilah.borderTopWidth).toBe(stroke.hairline);
    expect(gayaBilah.borderTopColor).toBe(themes.gelap.line);
  });

  test('bilah bawah tambah tinggi inset bawah', () => {
    mockInsets.mockReturnValue({ top: 0, bottom: 24, left: 0, right: 0 });

    const { getByTestId } = renderKerangka({ bottomBar: <View testID="bawah" /> });

    const isi = isiLayar(getByTestId('kepala-layar'));
    const gayaBilah = gaya(isiBilahBawah(isi));

    expect(gayaBilah.paddingBottom).toBe(40);
  });

  test('di dalam jendela awal isi layar dan bilah bawah tidak bergerak', () => {
    const { getByTestId } = render(
      <ThemeProvider name="gelap">
        <InitialWindowProvider>
          <ScreenFrame
            header={<View testID="kepala-layar" />}
            connection={KONEKSI}
            bottomBar={<View testID="bawah" />}
          >
            <View testID="isi-satu" />
          </ScreenFrame>
        </InitialWindowProvider>
      </ThemeProvider>,
    );

    const isi = isiLayar(getByTestId('kepala-layar'));

    expect(isi.props.layout).toBeUndefined();
    expect(isiBilahBawah(isi).props.layout).toBeUndefined();
  });

  test('di luar jendela awal isi layar dan bilah bawah bergerak', () => {
    const { getByTestId } = renderKerangka({ bottomBar: <View testID="bawah" /> });

    const isi = isiLayar(getByTestId('kepala-layar'));

    expect(isi.props.layout).toBeDefined();
    expect(isiBilahBawah(isi).props.layout).toBeDefined();
  });
});
