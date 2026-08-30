/**
 * Tests for RegisterScreen.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { RegisterScreen } from './RegisterScreen';

describe('RegisterScreen', () => {
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
});
