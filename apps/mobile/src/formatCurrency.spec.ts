import { formatCurrency } from './formatCurrency';

describe('formatCurrency', () => {
  it('format 23000 IDR menjadi Rp 23.000 (bukan 230)', () => {
    const result = formatCurrency(23000, 'IDR');
    // Intl.NumberFormat id-ID pakai karakter spasi tak-putus setelah "Rp"
    expect(result).toMatch(/Rp\s23\.000/);
    expect(result).not.toMatch(/Rp\s230$/); // bukan sen
  });

  it('format 1000 IDR tanpa desimal', () => {
    const result = formatCurrency(1000, 'IDR');
    expect(result).toMatch(/Rp\s1\.000/);
  });

  it('format 0 IDR', () => {
    const result = formatCurrency(0, 'IDR');
    expect(result).toMatch(/Rp\s0/);
  });
});
