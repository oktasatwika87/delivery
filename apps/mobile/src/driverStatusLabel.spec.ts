import { driverStatusLabel } from './driverStatusLabel';

describe('driverStatusLabel', () => {
  it('status ASSIGNED labelnya Tersedia', () => {
    expect(driverStatusLabel('ASSIGNED')).toBe('Tersedia');
  });

  it('status PREPARING labelnya Diterima', () => {
    expect(driverStatusLabel('PREPARING')).toBe('Diterima');
  });

  it('status OUT_FOR_DELIVERY labelnya Sedang diantar', () => {
    expect(driverStatusLabel('OUT_FOR_DELIVERY')).toBe('Sedang diantar');
  });

  it('status DELIVERED labelnya Selesai', () => {
    expect(driverStatusLabel('DELIVERED')).toBe('Selesai');
  });

  it('status CANCELLED labelnya Dibatalkan', () => {
    expect(driverStatusLabel('CANCELLED')).toBe('Dibatalkan');
  });

  it('status PENDING labelnya Menunggu konfirmasi', () => {
    expect(driverStatusLabel('PENDING')).toBe('Menunggu konfirmasi');
  });

  it('status CONFIRMED labelnya Menunggu konfirmasi', () => {
    expect(driverStatusLabel('CONFIRMED')).toBe('Menunggu konfirmasi');
  });
});
