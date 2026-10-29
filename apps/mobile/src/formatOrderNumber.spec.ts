/**
 * Tes formatOrderNumber.
 *
 * Nomor order ditampilkan ringkas supaya mudah dibaca dan dicari.
 */

import { formatOrderNumber } from './formatOrderNumber';

describe('formatOrderNumber', () => {
  it('id huruf kecil jadi kapital delapan karakter', () => {
    expect(formatOrderNumber('1d42e3e2-9f0b-4c1a-8b2d-3e5f6a7b8c9d')).toBe('#1D42E3E2');
  });

  it('id yang lebih pendek dari delapan karakter dipakai seluruhnya', () => {
    expect(formatOrderNumber('abc12')).toBe('#ABC12');
  });
});
