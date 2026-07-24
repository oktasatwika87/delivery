// Mock untuk react-native-keychain
// Menyimpan data di memory (bersih per test via jest.clearAllMocks)

let mockStore: Record<string, { password: string } | null> = {};

const ACCESSIBLE = {
  WHEN_UNLOCKED: 'WHEN_UNLOCKED',
};

function setGenericPassword(
  _username: string,
  password: string,
  _options?: { service?: string; accessible?: string }
): Promise<{ success: boolean }> {
  mockStore['session'] = { password };
  return Promise.resolve({ success: true });
}

function getGenericPassword(_options?: { service?: string }): Promise<{ username: string; password: string } | false> {
  const data = mockStore['session'];
  if (!data) return Promise.resolve(false);
  return Promise.resolve({ username: 'session', password: data.password });
}

function resetGenericPassword(_options?: { service?: string }): Promise<{ success: boolean }> {
  delete mockStore['session'];
  return Promise.resolve({ success: true });
}

// Reset mock storage before each test
beforeEach(() => {
  mockStore = {};
});

export { setGenericPassword, getGenericPassword, resetGenericPassword, ACCESSIBLE };
