/**
 * Pemeriksaan token socket di middleware namespace.
 *
 * Dipasang lewat server.use() di afterInit gateway. Token yang ditolak di
 * sini sampai ke klien sebagai connect_error berisi pesan dari server,
 * sebelum klien sempat menerima connect. Kalau penolakannya di
 * handleConnection, klien sudah menerima connect lalu diputus dengan
 * alasan "io server disconnect", yang tidak pernah dicoba ulang dan tidak
 * memberi tahu klien bahwa tokennya ditolak.
 */

import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@delivery/shared';

/** Bentuk minimum socket yang dipakai middleware ini. Socket socket.io
 *  memenuhi tipe ini secara struktural, jadi bisa dipasang ke `use`
 *  tanpa cast dan diuji dengan objek biasa. */
export interface MinimalSocket {
  handshake: { auth: Record<string, unknown> };
  data: Record<string, unknown>;
}

/** Fungsi next() dari socket.io untuk middleware. */
export type SocketNext = (err?: Error) => void;

/** Benar kalau nilainya salah satu UserRole. */
export function isUserRole(value: unknown): value is UserRole {
  return Object.values(UserRole).some((r) => r === value);
}

/** Satu pesan untuk semua penolakan token, jadi klien cukup mengenali
 *  pesan ini. */
const UNAUTHORIZED_MESSAGE = 'UNAUTHORIZED';

/**
 * Buat middleware socket untuk namespace tertentu. Middleware ini
 * memverifikasi JWT dari handshake.auth.token. Kalau sah, userId dan
 * role disimpan di socket.data dan next() dipanggil tanpa argumen. Kalau
 * gagal, satu console.warn dicetak dengan label dan alasan singkat,
 * lalu next() dipanggil dengan Error('UNAUTHORIZED').
 */
export function createSocketAuthMiddleware(
  jwtService: JwtService,
  label: string,
): (socket: MinimalSocket, next: SocketNext) => void {
  return (socket, next) => {
    const token = socket.handshake.auth.token;

    if (typeof token !== 'string' || token.length === 0) {
      console.warn(`[socket] token ditolak (${label}): tanpa token`);
      next(new Error(UNAUTHORIZED_MESSAGE));
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = jwtService.verify<Record<string, unknown>>(token);
    } catch (err) {
      const reason =
        err instanceof Error && err.message ? err.message : 'token tidak sah';
      console.warn(`[socket] token ditolak (${label}): ${reason}`);
      next(new Error(UNAUTHORIZED_MESSAGE));
      return;
    }

    const sub = payload.sub;
    const role = payload.role;
    if (typeof sub !== 'string' || sub.length === 0 || !isUserRole(role)) {
      console.warn(`[socket] token ditolak (${label}): isi token tidak lengkap`);
      next(new Error(UNAUTHORIZED_MESSAGE));
      return;
    }

    socket.data.userId = sub;
    socket.data.role = role;
    next();
  };
}
