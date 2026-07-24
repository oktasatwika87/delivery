// Mock untuk @react-native-async-storage/async-storage
// Menyimpan data di memory (bersih per test)

let mockStorage: Record<string, string | null> = {};

function getItem(key: string): Promise<string | null> {
  return Promise.resolve(mockStorage[key] ?? null);
}

function setItem(key: string, value: string): Promise<void> {
  mockStorage[key] = value;
  return Promise.resolve();
}

function removeItem(key: string): Promise<void> {
  delete mockStorage[key];
  return Promise.resolve();
}

function clear(): Promise<void> {
  mockStorage = {};
  return Promise.resolve();
}

// Reset mock storage before each test
beforeEach(() => {
  mockStorage = {};
});

export { getItem, setItem, removeItem, clear };
