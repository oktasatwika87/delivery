/**
 * Tes untuk LoginScreen.
 *
 * - Submit dengan kredensial sah -> startLocalSession menerima
 *   token + userId + database, lalu onLoginSuccess dipanggil.
 * - startLocalSession mengembalikan {ok: false, unsentCount: N} -> pesan
 *   blok dengan N tampil, onLoginSuccess TIDAK dipanggil.
 * - logoutReason 'auth-expired' -> banner sesi berakhir tampil dengan
 *   baris tambahan tentang data belum terkirim.
 *
 * Module tiruan: ../sync/client, ../sync/localData, ../db.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import { LoginScreen } from './LoginScreen';

const mockLogin = jest.fn();
const mockStartLocalSession = jest.fn();

// mockDatabase dideklarasikan dengan var (bukan const) dan nilai
// eksplisit sehingga factory jest.mock di-hoist bisa membaca referensinya
// sebelum assignment const di-init. Factory di atas dievaluasi oleh
// babel-plugin Jest di awal modul, sehingga module-level const belum
// terinisialisasi saat factory dipanggil.
var mockDatabase: { marker: string } = { marker: 'db' };

jest.mock('../sync/client', () => {
  const actual = jest.requireActual('../sync/client') as typeof import('../sync/client');
  return {
    ...actual,
    login: (...args: unknown[]) => mockLogin(...args),
  };
});

jest.mock('../sync/localData', () => ({
  startLocalSession: (...args: unknown[]) => mockStartLocalSession(...args),
  unsentDataBlockMessage: (count: number) =>
    `HP ini masih menyimpan ${count} data dari akun yang terakhir masuk, dan data itu belum terkirim.`,
}));

// Pakai object getter sehingga referensi mockDatabase yang sebenarnya
// selalu diambil saat akses, bukan snapshot saat factory dijalankan.
jest.mock('../db', () => ({
  get database() {
    return mockDatabase;
  },
}));

describe('LoginScreen', () => {
  beforeEach(() => {
    mockLogin.mockReset();
    mockStartLocalSession.mockReset();
  });

  it('login ditolak menampilkan pesan dengan jumlahnya dan tidak memanggil onLoginSuccess', async () => {
    mockLogin.mockResolvedValueOnce({
      token: 'token-new',
      user: { id: 'user-new', role: 'CUSTOMER', name: 'X', phone: '0' },
    });
    mockStartLocalSession.mockResolvedValueOnce({ ok: false, unsentCount: 4 });

    const onLoginSuccess = jest.fn();
    const { getByPlaceholderText, getAllByText, getByText } = render(
      <LoginScreen onLoginSuccess={onLoginSuccess} />,
    );

    fireEvent.changeText(getByPlaceholderText('Nomor HP'), '08123');
    fireEvent.changeText(getByPlaceholderText('Password'), 'password1234');
    // getAllByText('Masuk') -> [judul, tombol]. Yang terakhir adalah tombol.
    const masukButtons = getAllByText('Masuk');
    fireEvent.press(masukButtons[masukButtons.length - 1]);

    await waitFor(() => {
      expect(
        getByText(/HP ini masih menyimpan 4 data dari akun yang terakhir masuk/),
      ).toBeTruthy();
    });
    expect(onLoginSuccess).not.toHaveBeenCalled();
  });

  it('login diterima: onLoginSuccess dipanggil sekali, startLocalSession menerima token, userId, dan database', async () => {
    mockLogin.mockResolvedValueOnce({
      token: 'token-abc',
      user: { id: 'user-abc', role: 'CUSTOMER', name: 'A', phone: '08123' },
    });
    mockStartLocalSession.mockResolvedValueOnce({ ok: true });

    const onLoginSuccess = jest.fn();
    const { getByPlaceholderText, getAllByText } = render(
      <LoginScreen onLoginSuccess={onLoginSuccess} />,
    );

    fireEvent.changeText(getByPlaceholderText('Nomor HP'), '08123');
    fireEvent.changeText(getByPlaceholderText('Password'), 'password1234');
    const masukButtons = getAllByText('Masuk');
    fireEvent.press(masukButtons[masukButtons.length - 1]);

    await waitFor(() => {
      expect(onLoginSuccess).toHaveBeenCalledTimes(1);
    });
    expect(mockStartLocalSession).toHaveBeenCalledWith('token-abc', 'user-abc', mockDatabase);
  });

  it('logoutReason auth-expired menampilkan kedua baris banner', () => {
    const { getByText } = render(
      <LoginScreen onLoginSuccess={jest.fn()} logoutReason="auth-expired" />,
    );
    // Baris pertama: sesi berakhir, silakan login ulang.
    expect(getByText(/Sesi Anda telah berakhir/)).toBeTruthy();
    // Baris tambahan: data belum terkirim tetap tersimpan.
    expect(getByText(/Data yang belum terkirim tetap tersimpan/)).toBeTruthy();
  });
});