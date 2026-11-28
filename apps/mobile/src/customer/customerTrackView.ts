/**
 * Aturan tampilan status order untuk customer.
 *
 * Modul ini cuma menghitung bentuk tampilan dari data order, tanpa efek
 * samping dan tanpa menyentuh jaringan. Layar status order tinggal
 * memakainya, jadi aturan teksnya bisa diuji tanpa render.
 *
 * Yang dihitung:
 *   - tahap order (langkah) dan judulnya
 *   - baris orang yang tampil (mencari driver atau driver)
 *   - kotak uang tunai
 *   - banner: pembaruan terputus, order dilepas dari driver sebelumnya,
 *     dan HP driver belum tersambung
 */

import type { Order, OrderStatus } from '@delivery/shared';

import { formatOrderTime } from '../formatOrderTime';

/** Tahap order yang tampil di layar customer. */
export type StatusTampil =
  | 'menunggu'
  | 'mencari'
  | 'ditemukan'
  | 'perjalanan'
  | 'terkirim'
  | 'dibatalkan';

/** Hasil permintaan customer minta driver lain. */
export type HasilCariDriverLain =
  | 'berhasil'
  | 'driver_tersambung'
  | 'tidak_bisa_dialihkan'
  | 'order_berubah'
  | 'gagal'
  | 'sesi_berakhir';

export interface TeksBanner {
  judul: string;
  isi: string;
}

export interface CustomerTrackInput {
  order: Order;
  terputus: boolean;
  terakhirDiperbarui: number;
  sekarangMs: number;
}

export interface CustomerTrackView {
  statusTampil: StatusTampil;
  langkah: 1 | 2 | 3 | 4 | null;
  judul: string;
  jamDibuat: string;
  barisOrang: 'mencari' | 'driver' | null;
  bolehChat: boolean;
  kotakTunai: 'siapkan' | 'diterima' | null;
  bolehCariDriverLain: boolean;
  bannerTerputus: TeksBanner | null;
  bannerLepas: string | null;
  bannerHpDriver: TeksBanner | null;
}

const LANGKAH: Record<StatusTampil, 1 | 2 | 3 | 4 | null> = {
  menunggu: 1,
  mencari: 1,
  ditemukan: 2,
  perjalanan: 3,
  terkirim: 4,
  dibatalkan: null,
};

const JUDUL: Record<StatusTampil, string> = {
  menunggu: 'Order Anda sudah masuk',
  mencari: 'Order Anda sudah masuk',
  ditemukan: 'Driver sudah ditemukan untuk order Anda',
  perjalanan: 'Driver sedang menuju alamat Anda',
  terkirim: 'Order sudah sampai di alamat Anda',
  dibatalkan: 'Order ini dibatalkan',
};

const TEKS_HASIL_CARI_DRIVER_LAIN: Record<
  HasilCariDriverLain,
  { nada: 'info' | 'danger'; teks: string } | null
> = {
  berhasil: null,
  driver_tersambung: {
    nada: 'info',
    teks: 'Driver baru saja tersambung lagi, jadi order tetap dipegang driver.',
  },
  tidak_bisa_dialihkan: {
    nada: 'info',
    teks: 'Order ini sudah tidak bisa dialihkan ke driver lain.',
  },
  order_berubah: {
    nada: 'info',
    teks: 'Order baru saja berubah. Coba lagi kalau masih perlu.',
  },
  gagal: {
    nada: 'danger',
    teks: 'Tidak bisa meminta driver lain. Cek koneksi internet Anda lalu coba lagi.',
  },
  sesi_berakhir: null,
};

function statusTampilDari(status: OrderStatus): StatusTampil {
  switch (status) {
    case 'ASSIGNED':
      return 'mencari';
    case 'PREPARING':
      return 'ditemukan';
    case 'OUT_FOR_DELIVERY':
      return 'perjalanan';
    case 'DELIVERED':
      return 'terkirim';
    case 'CANCELLED':
      return 'dibatalkan';
    default:
      return 'menunggu';
  }
}

/**
 * Jam dalam kalimat. "Kemarin" dari formatOrderTime ditulis huruf kecil
 * karena berada di tengah kalimat, bukan di awal.
 */
function jamDalamKalimat(ms: number, sekarangMs: number): string {
  const jam = formatOrderTime(ms, sekarangMs);
  return jam.startsWith('Kemarin') ? `kemarin${jam.slice('Kemarin'.length)}` : jam;
}

/**
 * Banner order yang dilepas dari driver sebelumnya. Kode alasan tidak
 * pernah ditampilkan, cuma diterjemahkan ke bahasa customer.
 */
function teksBannerLepas(order: Order): string | null {
  if (order.cancelReason === 'driver_unreachable') {
    return 'Order sudah dilepas dari driver sebelumnya. Sedang dicarikan driver lain.';
  }
  if (order.cancelReason === 'system_timeout') {
    return 'Driver sebelumnya tidak aktif. Sedang dicarikan driver lain.';
  }
  if (order.cancelledBy) {
    return 'Driver sebelumnya membatalkan order ini. Sedang dicarikan driver lain.';
  }
  return null;
}

/**
 * Tunai sudah diterima kalau payment terakhir order ini sudah tertangkap
 * dan caranya tunai, atau ordernya sudah sampai di alamat customer.
 */
function tunaiDiterima(order: Order): boolean {
  const payment = order.payment;
  const tunaiTertangkap = payment?.method === 'CASH' && payment.status === 'CAPTURED';
  return tunaiTertangkap || order.status === 'DELIVERED';
}

/**
 * Bentuk tampilan layar status order untuk customer.
 */
export function customerTrackView(input: CustomerTrackInput): CustomerTrackView {
  const { order, terputus, terakhirDiperbarui, sekarangMs } = input;

  const statusTampil = statusTampilDari(order.status);
  const langkah = LANGKAH[statusTampil];

  const barisOrang: 'mencari' | 'driver' | null =
    langkah === null ? null : langkah === 1 ? 'mencari' : 'driver';

  const bolehChat = Boolean(order.driverId) && order.status !== 'CANCELLED';

  const kotakTunai: 'siapkan' | 'diterima' | null =
    order.status === 'CANCELLED' ? null : tunaiDiterima(order) ? 'diterima' : 'siapkan';

  const bolehCariDriverLain =
    order.status === 'PREPARING' && Boolean(order.driverUnreachableSince);

  const bannerTerputus: TeksBanner | null = terputus
    ? {
        judul: 'Pembaruan langsung terputus',
        isi: `Status terakhir dari ${jamDalamKalimat(terakhirDiperbarui, sekarangMs)}. Layar ini diperbarui sendiri begitu tersambung lagi.`,
      }
    : null;

  const bannerLepas = langkah === 1 ? teksBannerLepas(order) : null;

  const bannerHpDriver: TeksBanner | null =
    bolehCariDriverLain && order.driverUnreachableSince
      ? {
          judul: `HP driver belum tersambung sejak ${jamDalamKalimat(
            new Date(order.driverUnreachableSince).getTime(),
            sekarangMs,
          )}`,
          isi: 'Order tetap dipegang driver. Kalau tidak mau menunggu, Anda bisa minta driver lain.',
        }
      : null;

  return {
    statusTampil,
    langkah,
    judul: JUDUL[statusTampil],
    jamDibuat: formatOrderTime(new Date(order.createdAt).getTime(), sekarangMs),
    barisOrang,
    bolehChat,
    kotakTunai,
    bolehCariDriverLain,
    bannerTerputus,
    bannerLepas,
    bannerHpDriver,
  };
}

/**
 * Teks yang ditampilkan setelah customer minta driver lain. Berhasil dan
 * sesi berakhir tidak perlu banner.
 */
export function teksHasilCariDriverLain(
  hasil: HasilCariDriverLain,
): { nada: 'info' | 'danger'; teks: string } | null {
  return TEKS_HASIL_CARI_DRIVER_LAIN[hasil];
}
