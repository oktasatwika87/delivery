/**
 * Tes label status order untuk tampilan customer.
 *
 * Teks label dipakai CustomerHomeScreen dan OrderTrackingScreen, jadi
 * satu tempat saja yang menentukan bacaannya.
 */

import { orderStatusLabel } from './orderStatusLabel';

describe('label status order customer', () => {
  it('PENDING: Menunggu konfirmasi', () => {
    expect(orderStatusLabel('PENDING')).toBe('Menunggu konfirmasi');
  });

  it('CONFIRMED: Menunggu konfirmasi', () => {
    expect(orderStatusLabel('CONFIRMED')).toBe('Menunggu konfirmasi');
  });

  it('ASSIGNED: Mencari driver', () => {
    expect(orderStatusLabel('ASSIGNED')).toBe('Mencari driver');
  });

  it('PREPARING: Driver ditemukan', () => {
    expect(orderStatusLabel('PREPARING')).toBe('Driver ditemukan');
  });

  it('OUT_FOR_DELIVERY: Dalam perjalanan', () => {
    expect(orderStatusLabel('OUT_FOR_DELIVERY')).toBe('Dalam perjalanan');
  });

  it('DELIVERED: Terkirim', () => {
    expect(orderStatusLabel('DELIVERED')).toBe('Terkirim');
  });

  it('CANCELLED: Dibatalkan', () => {
    expect(orderStatusLabel('CANCELLED')).toBe('Dibatalkan');
  });
});
