/**
 * Tests for CustomerHomeScreen.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { CustomerHomeScreen } from './CustomerHomeScreen';

describe('CustomerHomeScreen', () => {
  test('renders without crashing', () => {
    const onLogout = jest.fn();
    const { getByText } = render(<CustomerHomeScreen onLogout={onLogout} />);

    // Should render title
    expect(getByText('Customer Home')).toBeTruthy();
  });

  test('renders logout button', () => {
    const onLogout = jest.fn();
    const { getByText } = render(<CustomerHomeScreen onLogout={onLogout} />);

    // Logout button is rendered
    expect(getByText('Logout')).toBeTruthy();
  });
});
