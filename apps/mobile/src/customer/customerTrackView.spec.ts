/**
 * Tes aturan tampilan status order untuk customer.
 *
 * Modul ini cuma menghitung bentuk tampilan dari data order, tanpa efek
 * samping, jadi semua aturan bisa diuji langsung.
 */

import type { Order, OrderStatus } from '@delivery/shared';

import {
  customerTrackView,
  teksHasilCariDriverLain,
  type CustomerTrackInput,
  type StatusTampil,
} from './customerTrackView';

type Langkah = 1 | 2 | 3 | 4 | null;

/** Waktu tetap supaya hasil format waktu tidak bergantung zona waktu. */
const SEKARANG = new Date(2026, 10, 24, 14, 20);
const SEKARANG_MS = SEKARANG.getTime();

function buatOrder(ubah: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    customerId: 'customer-1',
    status: 'PENDING',
    items: [],
    deliveryAddress: {
      recipientName: 'Budi',
      phone: '081234567890',
      street: 'Jl. Merdeka No. 1',
      city: 'Jakarta',
      postalCode: '10110',
    },
    totalCents: 25000,
    currency: 'IDR',
    version: 1,
    createdAt: new Date(2026, 10, 24, 14, 5).toISOString(),
    updatedAt: new Date(2026, 10, 24, 14, 5).toISOString(),
    ...ubah,
  };
}

function buatInput(ubah: Partial<CustomerTrackInput> = {}): CustomerTrackInput {
  return {
    order: buatOrder(),
    terputus: false,
    terakhirDiperbarui: SEKARANG_MS,
    sekarangMs: SEKARANG_MS,
    ...ubah,
  };
}

describe('status dan langkah', () => {
  it('tujuh status dipetakan ke statusTampil dan langkah', () => {
    const kasus: Array<[OrderStatus, StatusTampil, Langkah]> = [
      ['PENDING', 'menunggu', 1],
      ['CONFIRMED', 'menunggu', 1],
      ['ASSIGNED', 'mencari', 1],
      ['PREPARING', 'ditemukan', 2],
      ['OUT_FOR_DELIVERY', 'perjalanan', 3],
      ['DELIVERED', 'terkirim', 4],
      ['CANCELLED', 'dibatalkan', null],
    ];

    for (const [status, tampil, langkah] of kasus) {
      const hasil = customerTrackView(buatInput({ order: buatOrder({ status }) }));
      expect(hasil.statusTampil).toBe(tampil);
      expect(hasil.langkah).toBe(langkah);
    }
  });

  it('judul mengikuti langkah', () => {
    expect(customerTrackView(buatInput({ order: buatOrder({ status: 'PENDING' }) })).judul).toBe(
      'Order Anda sudah masuk',
    );
    expect(customerTrackView(buatInput({ order: buatOrder({ status: 'ASSIGNED' }) })).judul).toBe(
      'Order Anda sudah masuk',
    );
    expect(customerTrackView(buatInput({ order: buatOrder({ status: 'PREPARING' }) })).judul).toBe(
      'Driver sudah ditemukan untuk order Anda',
    );
    expect(
      customerTrackView(buatInput({ order: buatOrder({ status: 'OUT_FOR_DELIVERY' }) })).judul,
    ).toBe('Driver sedang menuju alamat Anda');
    expect(customerTrackView(buatInput({ order: buatOrder({ status: 'DELIVERED' }) })).judul).toBe(
      'Order sudah sampai di alamat Anda',
    );
    expect(customerTrackView(buatInput({ order: buatOrder({ status: 'CANCELLED' }) })).judul).toBe(
      'Order ini dibatalkan',
    );
  });

  it('jamDibuat memakai formatOrderTime dari createdAt apa adanya', () => {
    const hasil = customerTrackView(
      buatInput({ order: buatOrder({ createdAt: new Date(2026, 10, 24, 14, 5).toISOString() }) }),
    );

    expect(hasil.jamDibuat).toBe('14.05');
  });

  it('jamDibuat kemarin tetap pakai huruf besar dari formatOrderTime', () => {
    const hasil = customerTrackView(
      buatInput({ order: buatOrder({ createdAt: new Date(2026, 10, 23, 9, 0).toISOString() }) }),
    );

    expect(hasil.jamDibuat).toBe('Kemarin 09.00');
  });

  it('baris orang: mencari untuk langkah 1, driver untuk langkah 2 sampai 4, kosong untuk dibatalkan', () => {
    expect(customerTrackView(buatInput({ order: buatOrder({ status: 'ASSIGNED' }) })).barisOrang).toBe(
      'mencari',
    );
    expect(
      customerTrackView(buatInput({ order: buatOrder({ status: 'PREPARING' }) })).barisOrang,
    ).toBe('driver');
    expect(
      customerTrackView(buatInput({ order: buatOrder({ status: 'OUT_FOR_DELIVERY' }) })).barisOrang,
    ).toBe('driver');
    expect(customerTrackView(buatInput({ order: buatOrder({ status: 'DELIVERED' }) })).barisOrang).toBe(
      'driver',
    );
    expect(
      customerTrackView(buatInput({ order: buatOrder({ status: 'CANCELLED' }) })).barisOrang,
    ).toBeNull();
  });

  it('bolehChat hanya kalau ada driver dan order tidak dibatalkan', () => {
    expect(
      customerTrackView(
        buatInput({ order: buatOrder({ status: 'PREPARING', driverId: 'driver-1' }) }),
      ).bolehChat,
    ).toBe(true);
    expect(
      customerTrackView(
        buatInput({ order: buatOrder({ status: 'PREPARING', driverId: undefined }) }),
      ).bolehChat,
    ).toBe(false);
    expect(
      customerTrackView(
        buatInput({ order: buatOrder({ status: 'CANCELLED', driverId: 'driver-1' }) }),
      ).bolehChat,
    ).toBe(false);
  });
});

describe('kotak tunai', () => {
  it('order dibatalkan tidak punya kotak tunai', () => {
    const hasil = customerTrackView(
      buatInput({
        order: buatOrder({
          status: 'CANCELLED',
          payment: { method: 'CASH', status: 'CAPTURED' },
        }),
      }),
    );

    expect(hasil.kotakTunai).toBeNull();
  });

  it('payment CASH CAPTURED berarti kotak diterima', () => {
    const hasil = customerTrackView(
      buatInput({
        order: buatOrder({
          status: 'OUT_FOR_DELIVERY',
          payment: { method: 'CASH', status: 'CAPTURED' },
        }),
      }),
    );

    expect(hasil.kotakTunai).toBe('diterima');
  });

  it('payment null berarti kotak bukan diterima', () => {
    const hasil = customerTrackView(
      buatInput({
        order: buatOrder({ status: 'OUT_FOR_DELIVERY', payment: null }),
      }),
    );

    expect(hasil.kotakTunai).toBe('siapkan');
  });

  it('payment tunai yang belum tertangkap berarti kotak bukan diterima', () => {
    const hasil = customerTrackView(
      buatInput({
        order: buatOrder({
          status: 'OUT_FOR_DELIVERY',
          payment: { method: 'CASH', status: 'PENDING' },
        }),
      }),
    );

    expect(hasil.kotakTunai).toBe('siapkan');
  });

  it('payment nontunai yang tertangkap berarti kotak bukan diterima', () => {
    const hasil = customerTrackView(
      buatInput({
        order: buatOrder({
          status: 'OUT_FOR_DELIVERY',
          payment: { method: 'CARD', status: 'CAPTURED' },
        }),
      }),
    );

    expect(hasil.kotakTunai).toBe('siapkan');
  });

  it('order terkirim berarti kotak diterima walau tunai belum dilaporkan', () => {
    const hasil = customerTrackView(buatInput({ order: buatOrder({ status: 'DELIVERED' }) }));

    expect(hasil.kotakTunai).toBe('diterima');
  });

  it('selain itu kotak tunai berarti siapkan', () => {
    const hasil = customerTrackView(buatInput({ order: buatOrder({ status: 'PREPARING' }) }));

    expect(hasil.kotakTunai).toBe('siapkan');
  });
});

describe('banner driver tidak tersambung', () => {
  it('bolehCariDriverLain hanya saat order preparing dan ada waktu kontak terakhir', () => {
    const boleh = customerTrackView(
      buatInput({
        order: buatOrder({
          status: 'PREPARING',
          driverUnreachableSince: new Date(2026, 10, 24, 13, 50).toISOString(),
        }),
      }),
    );
    expect(boleh.bolehCariDriverLain).toBe(true);

    const tanpaWaktu = customerTrackView(
      buatInput({ order: buatOrder({ status: 'PREPARING', driverUnreachableSince: null }) }),
    );
    expect(tanpaWaktu.bolehCariDriverLain).toBe(false);

    const statusLain = customerTrackView(
      buatInput({
        order: buatOrder({
          status: 'OUT_FOR_DELIVERY',
          driverUnreachableSince: new Date(2026, 10, 24, 13, 50).toISOString(),
        }),
      }),
    );
    expect(statusLain.bolehCariDriverLain).toBe(false);
  });

  it('bannerHpDriver muncul hanya kalau bolehCariDriverLain', () => {
    const boleh = customerTrackView(
      buatInput({
        order: buatOrder({
          status: 'PREPARING',
          driverUnreachableSince: new Date(2026, 10, 24, 13, 50).toISOString(),
        }),
      }),
    );
    expect(boleh.bannerHpDriver).toEqual({
      judul: 'HP driver belum tersambung sejak 13.50',
      isi: 'Order tetap dipegang driver. Kalau tidak mau menunggu, Anda bisa minta driver lain.',
    });

    const tanpaWaktu = customerTrackView(
      buatInput({ order: buatOrder({ status: 'PREPARING', driverUnreachableSince: null }) }),
    );
    expect(tanpaWaktu.bannerHpDriver).toBeNull();
  });
});

describe('banner pembaruan terputus', () => {
  it('hanya muncul saat terputus', () => {
    const hasil = customerTrackView(buatInput({ terputus: false }));

    expect(hasil.bannerTerputus).toBeNull();
  });

  it('isi banner menyebut waktu pembaruan terakhir', () => {
    const hasil = customerTrackView(
      buatInput({ terputus: true, terakhirDiperbarui: new Date(2026, 10, 24, 13, 50).getTime() }),
    );

    expect(hasil.bannerTerputus).toEqual({
      judul: 'Pembaruan langsung terputus',
      isi: 'Status terakhir dari 13.50. Layar ini diperbarui sendiri begitu tersambung lagi.',
    });
  });

  it('jam kemarin di tengah kalimat ditulis huruf kecil', () => {
    const hasil = customerTrackView(
      buatInput({ terputus: true, terakhirDiperbarui: new Date(2026, 10, 23, 9, 0).getTime() }),
    );

    expect(hasil.bannerTerputus?.isi).toBe(
      'Status terakhir dari kemarin 09.00. Layar ini diperbarui sendiri begitu tersambung lagi.',
    );
  });
});

describe('banner order dilepas dari driver sebelumnya', () => {
  it('alasan driver_unreachable: order sudah dilepas dari driver sebelumnya', () => {
    const hasil = customerTrackView(
      buatInput({
        order: buatOrder({
          status: 'ASSIGNED',
          cancelReason: 'driver_unreachable',
          cancelledBy: 'customer-1',
        }),
      }),
    );

    expect(hasil.bannerLepas).toBe(
      'Order sudah dilepas dari driver sebelumnya. Sedang dicarikan driver lain.',
    );
  });

  it('alasan system_timeout: driver sebelumnya tidak aktif', () => {
    const hasil = customerTrackView(
      buatInput({
        order: buatOrder({ status: 'ASSIGNED', cancelReason: 'system_timeout', cancelledBy: 'SYSTEM' }),
      }),
    );

    expect(hasil.bannerLepas).toBe('Driver sebelumnya tidak aktif. Sedang dicarikan driver lain.');
  });

  it('alasan lain dengan cancelledBy terisi: driver sebelumnya membatalkan', () => {
    const hasil = customerTrackView(
      buatInput({
        order: buatOrder({ status: 'ASSIGNED', cancelReason: 'kendaraan mogok', cancelledBy: 'driver-9' }),
      }),
    );

    expect(hasil.bannerLepas).toBe(
      'Driver sebelumnya membatalkan order ini. Sedang dicarikan driver lain.',
    );
  });

  it('alasan lain tanpa cancelledBy tidak ada banner', () => {
    const hasil = customerTrackView(
      buatInput({ order: buatOrder({ status: 'ASSIGNED', cancelReason: 'kendaraan mogok' }) }),
    );

    expect(hasil.bannerLepas).toBeNull();
  });

  it('alasan lama tidak tampil kalau statusnya sudah di luar langkah 1', () => {
    const hasil = customerTrackView(
      buatInput({
        order: buatOrder({
          status: 'PREPARING',
          cancelReason: 'driver_unreachable',
          cancelledBy: 'customer-1',
        }),
      }),
    );

    expect(hasil.bannerLepas).toBeNull();
  });
});

describe('teks hasil minta driver lain', () => {
  it('berhasil dan sesi berakhir tidak punya teks', () => {
    expect(teksHasilCariDriverLain('berhasil')).toBeNull();
    expect(teksHasilCariDriverLain('sesi_berakhir')).toBeNull();
  });

  it('driver tersambung: info', () => {
    expect(teksHasilCariDriverLain('driver_tersambung')).toEqual({
      nada: 'info',
      teks: 'Driver baru saja tersambung lagi, jadi order tetap dipegang driver.',
    });
  });

  it('tidak bisa dialihkan: info', () => {
    expect(teksHasilCariDriverLain('tidak_bisa_dialihkan')).toEqual({
      nada: 'info',
      teks: 'Order ini sudah tidak bisa dialihkan ke driver lain.',
    });
  });

  it('order berubah: info', () => {
    expect(teksHasilCariDriverLain('order_berubah')).toEqual({
      nada: 'info',
      teks: 'Order baru saja berubah. Coba lagi kalau masih perlu.',
    });
  });

  it('gagal: danger', () => {
    expect(teksHasilCariDriverLain('gagal')).toEqual({
      nada: 'danger',
      teks: 'Tidak bisa meminta driver lain. Cek koneksi internet Anda lalu coba lagi.',
    });
  });
});
