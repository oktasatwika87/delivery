/**
 * Tests for RegisterScreen.
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

import { RegisterScreen } from './RegisterScreen';

const mockRegister = jest.fn();
const mockCountUnsentData = jest.fn();
const mockStartLocalSession = jest.fn();
const mockDatabase = { marker: 'db' };

jest.mock('../db', () => ({ database: mockDatabase }));

jest.mock('../sync/client', () => {
  const actual = jest.requireActual('../sync/client') as typeof import('../sync/client');
  return {
    ...actual,
    register: (...args: unknown[]) => mockRegister(...args),
  };
});

jest.mock('../sync/localData', () => ({
  startLocalSession: (...args: unknown[]) => mockStartLocalSession(...args),
  countUnsentData: (...args: unknown[]) => mockCountUnsentData(...args),
  unsentDataBlockMessage: (count: number) =>
    `HP ini masih menyimpan ${count} data dari akun yang terakhir masuk, dan data itu belum terkirim.`,
}));

describe('RegisterScreen', () => {
  beforeEach(() => {
    mockRegister.mockReset();
    mockCountUnsentData.mockReset();
    mockStartLocalSession.mockReset();
  });

  test('renders without crashing', () => {
    const onRegisterSuccess = jest.fn();
    const onBackToLogin = jest.fn();
    const { getAllByText, getByText } = render(
      <RegisterScreen onRegisterSuccess={onRegisterSuccess} onBackToLogin={onBackToLogin} />
    );

    expect(getAllByText('Daftar').length).toBeGreaterThanOrEqual(1);
    expect(getByText('Customer')).toBeTruthy();
    expect(getByText('Driver')).toBeTruthy();
  });

  test('renders back to login link', () => {
    const onRegisterSuccess = jest.fn();
    const onBackToLogin = jest.fn();
    const { getByText } = render(
      <RegisterScreen onRegisterSuccess={onRegisterSuccess} onBackToLogin={onBackToLogin} />
    );

    expect(getByText('Sudah punya akun? Masuk')).toBeTruthy();
  });

  test('countUnsentData > 0: pesan tampil dan register tidak dipanggil', async () => {
    mockCountUnsentData.mockResolvedValue(7);

    const onRegisterSuccess = jest.fn();
    const { getByPlaceholderText, getAllByText, getByText } = render(
      <RegisterScreen onRegisterSuccess={onRegisterSuccess} onBackToLogin={jest.fn()} />
    );

    fireEvent.changeText(getByPlaceholderText('Nama'), 'Budi');
    fireEvent.changeText(getByPlaceholderText('Nomor HP'), '08123');
    fireEvent.changeText(getByPlaceholderText('Password (min. 8 karakter)'), 'password1234');
    // getAllByText('Daftar') -> [judul, tombol]. Pilih yang terakhir.
    const daftarButtons = getAllByText('Daftar');
    fireEvent.press(daftarButtons[daftarButtons.length - 1]);

    await waitFor(() => {
      expect(
        getByText(/HP ini masih menyimpan 7 data dari akun yang terakhir masuk/),
      ).toBeTruthy();
    });
    expect(mockRegister).not.toHaveBeenCalled();
    expect(onRegisterSuccess).not.toHaveBeenCalled();
  });
});
