/**
 * Tes untuk session.ts: isCurrentToken membandingkan token yang diberikan
 * dengan token tersimpan di keychain.
 *
 * getCurrentToken/isCurrentToken memakai token-storage tiruan via jest.mock
 * supaya tidak benar-benar menulis ke keychain.
 */

import * as sessionModule from './session';
import * as tokenStorage from './token-storage';

jest.mock('./token-storage', () => ({
  getToken: jest.fn(),
}));

describe('isCurrentToken', function() {
  const mockGetToken = tokenStorage.getToken as jest.Mock;

  beforeEach(function() {
    mockGetToken.mockReset();
  });

  it('token sama dengan yang tersimpan: true', async function() {
    mockGetToken.mockResolvedValue('test-token');
    await expect(sessionModule.isCurrentToken('test-token')).resolves.toBe(true);
  });

  it('token berbeda dengan yang tersimpan: false', async function() {
    mockGetToken.mockResolvedValue('current-token');
    await expect(sessionModule.isCurrentToken('other-token')).resolves.toBe(false);
  });

  it('tidak ada token tersimpan: false', async function() {
    mockGetToken.mockResolvedValue(null);
    await expect(sessionModule.isCurrentToken('any-token')).resolves.toBe(false);
  });
});