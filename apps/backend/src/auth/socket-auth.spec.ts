/**
 * Tes unit untuk middleware pemeriksa token socket.
 *
 * Middleware dipasang lewat namespace.use() sebelum soket tersambung,
 * supaya klien yang tokennya ditolak menerima connect_error dan tidak
 * pernah melihat connect. handleConnection di gateway tinggal membaca
 * userId/role dari socket.data setelah middleware lolos.
 *
 * Pengujian memakai JwtService asli supaya kita bisa menguji token kedaluwarsa,
 * tanda tangan salah, dan verifikasi sub kosong lewat mekanisme yang
 * sama dengan produksi.
 */

import { JwtService } from '@nestjs/jwt';
import { UserRole } from '@delivery/shared';

import { createSocketAuthMiddleware, isUserRole } from './socket-auth';

const SECRET = 'rahasia-uji';

function makeJwt(sign: Record<string, unknown>, secret = SECRET): string {
  return new JwtService({ secret }).sign(sign);
}

function expiredJwt(): string {
  return new JwtService({ secret: SECRET }).sign(
    { sub: 'driver-expired', role: UserRole.DRIVER },
    { expiresIn: -1 },
  );
}

describe('isUserRole', () => {
  test('menerima CUSTOMER dan DRIVER', () => {
    expect(isUserRole(UserRole.CUSTOMER)).toBe(true);
    expect(isUserRole(UserRole.DRIVER)).toBe(true);
  });

  test('menolak nilai di luar UserRole', () => {
    expect(isUserRole('ADMIN')).toBe(false);
    expect(isUserRole('')).toBe(false);
    expect(isUserRole(null)).toBe(false);
    expect(isUserRole(undefined)).toBe(false);
    expect(isUserRole(42)).toBe(false);
    expect(isUserRole({})).toBe(false);
  });
});

describe('createSocketAuthMiddleware', () => {
  let jwt: JwtService;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jwt = new JwtService({ secret: SECRET });
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  function makeSocket(auth?: Record<string, unknown>): {
    handshake: { auth: Record<string, unknown> };
    data: Record<string, unknown>;
  } {
    return {
      handshake: { auth: auth ?? {} },
      data: {},
    };
  }

  test('token sah dengan role DRIVER: next tanpa argumen, data terisi', () => {
    const token = makeJwt({ sub: 'driver-uuid', role: UserRole.DRIVER });
    const middleware = createSocketAuthMiddleware(jwt, '/orders');
    const socket = makeSocket({ token });
    const next = jest.fn();

    middleware(socket, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(socket.data.userId).toBe('driver-uuid');
    expect(socket.data.role).toBe(UserRole.DRIVER);
  });

  test('token sah dengan role CUSTOMER: data terisi, next tanpa argumen', () => {
    const token = makeJwt({ sub: 'customer-uuid', role: UserRole.CUSTOMER });
    const middleware = createSocketAuthMiddleware(jwt, '/chat');
    const socket = makeSocket({ token });
    const next = jest.fn();

    middleware(socket, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
    expect(socket.data.userId).toBe('customer-uuid');
    expect(socket.data.role).toBe(UserRole.CUSTOMER);
  });

  test('tanpa auth.token: next dengan Error UNAUTHORIZED, data tetap kosong', () => {
    const middleware = createSocketAuthMiddleware(jwt, '/orders');
    const socket = makeSocket({});
    const next = jest.fn();

    middleware(socket, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'UNAUTHORIZED' }));
    expect(socket.data).toEqual({});
  });

  test('token bukan string: ditolak, data tetap kosong', () => {
    const middleware = createSocketAuthMiddleware(jwt, '/orders');
    const socket = makeSocket({ token: 12345 });
    const next = jest.fn();

    middleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'UNAUTHORIZED' }));
    expect(socket.data).toEqual({});
  });

  test('token string kosong: ditolak, data tetap kosong', () => {
    const middleware = createSocketAuthMiddleware(jwt, '/orders');
    const socket = makeSocket({ token: '' });
    const next = jest.fn();

    middleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'UNAUTHORIZED' }));
    expect(socket.data).toEqual({});
  });

  test("token 'bukan-jwt': ditolak, data tetap kosong", () => {
    const middleware = createSocketAuthMiddleware(jwt, '/orders');
    const socket = makeSocket({ token: 'bukan-jwt' });
    const next = jest.fn();

    middleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'UNAUTHORIZED' }));
    expect(socket.data).toEqual({});
  });

  test('token ditandatangani secret lain: ditolak, data tetap kosong', () => {
    const foreignToken = makeJwt({ sub: 'driver-uuid', role: UserRole.DRIVER }, 'rahasia-orang');
    const middleware = createSocketAuthMiddleware(jwt, '/orders');
    const socket = makeSocket({ token: foreignToken });
    const next = jest.fn();

    middleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'UNAUTHORIZED' }));
    expect(socket.data).toEqual({});
  });

  test('token kedaluwarsa: ditolak, data tetap kosong', () => {
    const middleware = createSocketAuthMiddleware(jwt, '/orders');
    const socket = makeSocket({ token: expiredJwt() });
    const next = jest.fn();

    middleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'UNAUTHORIZED' }));
    expect(socket.data).toEqual({});
  });

  test('sub kosong: ditolak, data tetap kosong', () => {
    const token = makeJwt({ sub: '', role: UserRole.DRIVER });
    const middleware = createSocketAuthMiddleware(jwt, '/orders');
    const socket = makeSocket({ token });
    const next = jest.fn();

    middleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'UNAUTHORIZED' }));
    expect(socket.data).toEqual({});
  });

  test("role 'ADMIN' (bukan nilai UserRole): ditolak, data tetap kosong", () => {
    const token = makeJwt({ sub: 'attacker', role: 'ADMIN' });
    const middleware = createSocketAuthMiddleware(jwt, '/orders');
    const socket = makeSocket({ token });
    const next = jest.fn();

    middleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'UNAUTHORIZED' }));
    expect(socket.data).toEqual({});
  });

  test('console.warn memuat label dan tidak memuat isi token', () => {
    const middleware = createSocketAuthMiddleware(jwt, '/orders-secret');
    const socket = makeSocket({ token: 'bukan-jwt-sama-sekali' });
    const next = jest.fn();

    middleware(socket, next);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('/orders-secret'));
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('bukan-jwt-sama-sekali'));
  });

  test('pesan galat dari verify ikut tercatat di console.warn', () => {
    const middleware = createSocketAuthMiddleware(jwt, '/orders');
    const socket = makeSocket({ token: expiredJwt() });
    const next = jest.fn();

    middleware(socket, next);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('/orders'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/jwt expired/));
  });
});
