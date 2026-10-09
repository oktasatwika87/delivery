/**
 * Unit tests untuk JWT secret wajib dari environment.
 *
 * JWT_SECRET wajib diisi di env, tidak ada nilai bawaan. Aplikasi
 * harus gagal start kalau env ini kosong atau tidak ada.
 */

import { ConfigService } from '@nestjs/config';

import { JwtStrategy } from './jwt.strategy';
import { readJwtSecret } from './jwt-secret';

describe('readJwtSecret', () => {
  const originalEnv = process.env.JWT_SECRET;

  beforeEach(() => {
    delete process.env.JWT_SECRET;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalEnv;
    }
  });

  test('throw kalau JWT_SECRET tidak ada', () => {
    const config = new ConfigService({});
    expect(() => readJwtSecret(config)).toThrow('JWT_SECRET');
  });

  test('throw kalau JWT_SECRET string kosong', () => {
    const config = new ConfigService({ JWT_SECRET: '' });
    expect(() => readJwtSecret(config)).toThrow('JWT_SECRET belum diisi di env');
  });

  test('mengembalikan nilainya kalau JWT_SECRET ada', () => {
    const config = new ConfigService({ JWT_SECRET: 'test-secret-value' });
    expect(readJwtSecret(config)).toBe('test-secret-value');
  });
});

describe('JwtStrategy saat JWT_SECRET kosong', () => {
  const originalEnv = process.env.JWT_SECRET;

  beforeEach(() => {
    delete process.env.JWT_SECRET;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalEnv;
    }
  });

  test('new JwtStrategy melempar galat kalau env tidak ada', () => {
    expect(() => new JwtStrategy(new ConfigService({}))).toThrow('JWT_SECRET');
  });
});
