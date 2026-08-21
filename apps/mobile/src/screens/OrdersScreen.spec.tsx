/**
 * Smoke test untuk OrdersScreen — verify component mounts without errors.
 *
 * Full render test dengan async HOC chain (getCurrentUserId → withObservables →
 * fetchPool) sulit diisolasi di Jest tanpa integration setup yang kompleks.
 * Test ini cukup memastikan component tidak throw saat mount dengan mock data.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

// ─── Mock @nozbe/watermelondb/react SEBELUM import component ──────────────
jest.mock('@nozbe/watermelondb/react', () => ({
  withDatabase: (C: any) => C,
  withObservables: (_trigger: any, _getObs: any) => (C: any) => C,
}));

jest.mock('@nozbe/watermelondb', () => ({
  Q: {
    where: jest.fn().mockReturnValue({ _where: 'test' }),
    sortBy: jest.fn().mockReturnValue({ _sortBy: 'test' }),
  },
}));

// ─── Mock Config ───────────────────────────────────────────────────────────────
jest.mock('react-native-config', () => ({
  default: { API_BASE_URL: 'http://localhost:3000' },
}));

// ─── Mock session ────────────────────────────────────────────────────────────
jest.mock('../sync/session', () => ({
  getCurrentUserId: () => Promise.resolve('driver-123'),
}));

// ─── Mock API client ─────────────────────────────────────────────────────────
// Must use require.resolve to ensure correct module path
jest.mock('../sync/client', () => ({
  fetchWithAuth: jest.fn().mockResolvedValue({
    ok: true,
    json: jest.fn().mockResolvedValue([]),
  }),
}));

// ─── Mock ordersSocket ────────────────────────────────────────────────────────
jest.mock('../sync/ordersSocket', () => ({
  ordersSocket: {
    onOrderAvailable: jest.fn().mockReturnValue(jest.fn()),
    onOrderUnavailable: jest.fn().mockReturnValue(jest.fn()),
    on: jest.fn().mockReturnValue(jest.fn()),
  },
}));

// ─── Mock navigation ───────────────────────────────────────────────────────
jest.mock('@react-navigation/native', () => ({
  NavigationContainer: ({ children }: { children: React.ReactNode }) => children,
  useNavigation: () => ({
    navigate: jest.fn(),
  }),
}));

// ─── Mock WatermelonDB ──────────────────────────────────────────────────────
const mockOrdersCollection = {
  query: jest.fn().mockReturnValue({
    fetch: jest.fn().mockResolvedValue([]),
    observe: jest.fn().mockReturnValue({
      subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
    }),
  }),
  find: jest.fn().mockRejectedValue(new Error('not found')),
  create: jest.fn().mockResolvedValue({}),
};

const mockDatabase = {
  get: jest.fn().mockReturnValue(mockOrdersCollection),
  write: jest.fn().mockImplementation(async (fn: () => Promise<void>) => fn()),
};

// ─── Import after mocks ───────────────────────────────────────────────────────
import { OrdersScreen } from './OrdersScreen';

describe('OrdersScreen smoke test', () => {
  test('mounts without throwing', () => {
    let error: Error | null = null;

    try {
      // Render synchronously — async HOC chain causes loading state but doesn't throw
      const { UNSAFE_root } = render(<OrdersScreen database={mockDatabase as never} />);
      // Access root to prevent "unused variable" warning
      expect(UNSAFE_root).toBeTruthy();
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeNull();
  });
});
