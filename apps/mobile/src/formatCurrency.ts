/**
 * Format mata uang IDR. Nilai sudah dalam rupiah apa adanya (bukan sen).
 */
export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(amount);
}
