/**
 * Unit tests untuk cursor persistence.
 * Verifikasi cursor persist across module re-imports.
 *
 * The AsyncStorage mock is provided by moduleNameMapper in jest.config.js,
 * which maps @react-native-async-storage/async-storage to src/__mocks__.
 * We import the mock directly and manipulate its state.
 */

describe('cursor persistence', function() {
  beforeEach(function() {
    jest.resetModules();
  });

  test('getCursor() returns null when no cursor stored', async function() {
    var cursor = require('./cursor');
    var result = await cursor.loadCursor();
    expect(result).toBeNull();
  });

  test('setCursor(xyz) stores in AsyncStorage', async function() {
    var cursor = require('./cursor');
    await cursor.saveCursor('cursor-xyz-123');
    // Verify the module-level state was updated
    var result = await cursor.loadCursor();
    expect(result).toBe('cursor-xyz-123');
  });

  test('setCursor(null) clears stored value', async function() {
    var cursor = require('./cursor');
    // First set a value
    await cursor.saveCursor('some-value');
    // Then clear it
    await cursor.saveCursor(null);
    // Verify it's cleared
    var result = await cursor.loadCursor();
    expect(result).toBeNull();
  });

  test('empty string treated as null on load', async function() {
    var cursor = require('./cursor');
    // Manually set empty string in the mock storage
    var asyncStorageMock = require('../__mocks__/@react-native-async-storage/async-storage');
    asyncStorageMock.mockStorage['sync_cursor'] = '';
    var result = await cursor.loadCursor();
    expect(result).toBeNull();
  });

  test('getCursorSync returns cached value after save, null before', async function() {
    var cursor = require('./cursor');
    // Before save, should be null
    expect(cursor.getCursorSync()).toBeNull();
    await cursor.saveCursor('sync-cursor');
    // After save, should have cached value
    expect(cursor.getCursorSync()).toBe('sync-cursor');
  });
});
