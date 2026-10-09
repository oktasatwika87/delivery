import { ConfigService } from '@nestjs/config';

/**
 * Sumber tunggal secret JWT.
 *
 * getOrThrow melempar kalau env tidak ada; kita juga cek string kosong
 * supaya env yang ter-set ke string kosong tidak lolos diam-diam.
 */
export function readJwtSecret(config: ConfigService): string {
  const secret = config.getOrThrow<string>('JWT_SECRET');
  if (secret === '') {
    throw new Error('JWT_SECRET belum diisi di env');
  }
  return secret;
}
