import { UserRole } from '@delivery/shared';

/** Auth-only types. Tidak di-share via @delivery/shared karena ini runtime secret. */

/** Shape hasil sanitasi: User tanpa passwordHash. */
export interface AuthenticatedUser {
  id: string;
  role: UserRole;
  name: string;
  phone: string;
  version: number;
}

/** Payload JWT yang ditandatangani. */
export interface JwtPayload {
  /** Subject — userId (UUID). */
  sub: string;
  /** Role user untuk otorisasi ringan di controller lain. */
  role: UserRole;
}

/**
 * 30 hari dipilih agar kurir / customer tidak harus sering login di tengah shift.
 *
 * Trade-off:
 *   + Kenyamanan tinggi untuk mobile delivery (dipakai harian, kemungkinan
 *     ganti device lebih sering daripada ganti akun).
 *   - Token yang dicuri berlaku panjang — perlu mitigasi via:
 *       * refresh token (TODO di iterasi berikut) untuk rotate
 *       * device-bound token (cek deviceId di payload) supaya token dari
 *         device A tidak bisa dipakai di device B
 *       * server-side revocation list kalau user "logout all devices"
 *
 * Untuk produksi yang lebih aman: 7–14 hari + refresh token sliding window.
 * Disimpan di sini sebagai catatan agar mudah di-revisit.
 */
export const JWT_EXPIRES_IN = '30d';

/** Secret untuk signing JWT — wajib di-set via env. Default hanya untuk dev. */
export const JWT_SECRET_ENV = 'JWT_SECRET';
export const JWT_SECRET_DEFAULT = 'dev-only-do-not-use-in-production';