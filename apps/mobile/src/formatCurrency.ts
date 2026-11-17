/**
 * Format mata uang IDR. Nilai sudah dalam rupiah apa adanya (bukan sen).
 */

/**
 * Formatter dipakai ulang per mata uang. Membuat Intl.NumberFormat itu
 * mahal, dan layar order memformat angka berkali-kali dalam satu gambar.
 */
const formatterCache = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string): Intl.NumberFormat {
  const ada = formatterCache.get(currency);
  if (ada) return ada;
  const baru = new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  });
  formatterCache.set(currency, baru);
  return baru;
}

export function formatCurrency(amount: number, currency: string): string {
  return formatterFor(currency).format(amount);
}
