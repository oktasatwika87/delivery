/**
 * Nomor order ringkas.
 *
 * Order punya id panjang, tapi yang ditampilkan ke pengguna cukup-awal id
 * saja supaya mudah dibaca.
 */

export function formatOrderNumber(id: string): string {
  return `#${id.slice(0, 8).toUpperCase()}`;
}
