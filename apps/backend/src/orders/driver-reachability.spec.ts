/**
 * Tes fungsi murni driverUnreachableSince.
 *
 * Fungsi ini jadi dasar keputusan customer minta driver lain: kalau HP driver
 * lama sudah lewat batas menit tanpa kontak, order dianggap ditinggal driver.
 */

import { driverUnreachableSince } from './driver-reachability';

const MENIT = 60 * 1000;

describe('driverUnreachableSince', () => {
  const now = new Date('2026-05-01T12:00:00.000Z');

  test('lastSeenAt lebih baru dari updatedAt jadi acuan', () => {
    const lastSeenAt = new Date(now.getTime() - 31 * MENIT);
    const orderUpdatedAt = new Date(now.getTime() - 120 * MENIT);

    expect(driverUnreachableSince(lastSeenAt, orderUpdatedAt, now)).toEqual(lastSeenAt);
  });

  test('updatedAt lebih baru dari lastSeenAt jadi acuan', () => {
    const lastSeenAt = new Date(now.getTime() - 120 * MENIT);
    const orderUpdatedAt = new Date(now.getTime() - 31 * MENIT);

    expect(driverUnreachableSince(lastSeenAt, orderUpdatedAt, now)).toEqual(orderUpdatedAt);
  });

  test('lastSeenAt null jadi acuan updatedAt', () => {
    const orderUpdatedAt = new Date(now.getTime() - 31 * MENIT);

    expect(driverUnreachableSince(null, orderUpdatedAt, now)).toEqual(orderUpdatedAt);
  });

  test('tepat di batas menit belum dianggap tidak nyambung', () => {
    const lastSeenAt = new Date(now.getTime() - 30 * MENIT);
    const orderUpdatedAt = new Date(now.getTime() - 60 * MENIT);

    expect(driverUnreachableSince(lastSeenAt, orderUpdatedAt, now)).toBeNull();
  });

  test('satu milidetik lewat batas jadi tidak nyambung', () => {
    const lastSeenAt = new Date(now.getTime() - 30 * MENIT - 1);
    const orderUpdatedAt = new Date(now.getTime() - 60 * MENIT);

    expect(driverUnreachableSince(lastSeenAt, orderUpdatedAt, now)).toEqual(lastSeenAt);
  });
});
