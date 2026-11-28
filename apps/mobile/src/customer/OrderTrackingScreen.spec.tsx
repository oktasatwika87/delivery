/**
 * Tes layar status order customer.
 *
 * Socket dan HTTP client ditiru supaya kejadian dan jawaban server bisa
 * dikendalikan dari tes. Rute dan label langkah dibaca dari komponen tiruan,
 * karena nilainya cuma ada di props dan tidak terlihat di layar.
 */

import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';
import { LinearGradient, Rect, Stop } from 'react-native-svg';
import * as reanimated from 'react-native-reanimated';

import type {
  Order,
  OrderAcceptedPayload,
  OrderCancelledPayload,
  OrderCodCollectedPayload,
  OrderStatus,
  OrderStatusUpdatedPayload,
} from '@delivery/shared';

import { OrderTrackingScreen } from './OrderTrackingScreen';
import { BATAS_TAHAN_MS } from './OrderTrackingScreen';
import { Banner } from '../components/Banner';
import { DrawnStroke } from '../components/motion/DrawnPath';
import { orderStatusLabel } from '../orderStatusLabel';
import { formatOrderTime } from '../formatOrderTime';
import { syncEvents } from '../sync/syncEvents';
import { ApiError, UnauthorizedError } from '../sync/client';
import { ThemeProvider } from '../theme/ThemeProvider';
import { fontFamily, themes } from '../theme/tokens';

var mockAcceptedSubscribers: Array<(p: OrderAcceptedPayload) => void> = [];
var mockRejectedSubscribers: Array<
  (p: { orderId: string; status: 'ASSIGNED'; version: number }) => void
> = [];
var mockCancelledSubscribers: Array<(p: OrderCancelledPayload) => void> = [];
var mockCodSubscribers: Array<(p: OrderCodCollectedPayload) => void> = [];
var mockStatusSubscribers: Array<(p: OrderStatusUpdatedPayload) => void> = [];
var mockConnectSubscribers: Array<() => void> = [];
var mockDisconnectSubscribers: Array<() => void> = [];

jest.mock('../sync/ordersSocket', () => ({
  ordersSocket: {
    isConnected: true,
    onOrderAccepted: (cb: (p: OrderAcceptedPayload) => void): (() => void) => {
      mockAcceptedSubscribers.push(cb);
      return () => {
        mockAcceptedSubscribers = mockAcceptedSubscribers.filter((s) => s !== cb);
      };
    },
    onOrderRejected: (
      cb: (p: { orderId: string; status: 'ASSIGNED'; version: number }) => void,
    ): (() => void) => {
      mockRejectedSubscribers.push(cb);
      return () => {
        mockRejectedSubscribers = mockRejectedSubscribers.filter((s) => s !== cb);
      };
    },
    onOrderCancelled: (cb: (p: OrderCancelledPayload) => void): (() => void) => {
      mockCancelledSubscribers.push(cb);
      return () => {
        mockCancelledSubscribers = mockCancelledSubscribers.filter((s) => s !== cb);
      };
    },
    onOrderCodCollected: (cb: (p: OrderCodCollectedPayload) => void): (() => void) => {
      mockCodSubscribers.push(cb);
      return () => {
        mockCodSubscribers = mockCodSubscribers.filter((s) => s !== cb);
      };
    },
    onOrderStatusUpdated: (cb: (p: OrderStatusUpdatedPayload) => void): (() => void) => {
      mockStatusSubscribers.push(cb);
      return () => {
        mockStatusSubscribers = mockStatusSubscribers.filter((s) => s !== cb);
      };
    },
    on: (event: string, cb: () => void): (() => void) => {
      if (event === 'connect') mockConnectSubscribers.push(cb);
      if (event === 'disconnect') mockDisconnectSubscribers.push(cb);
      return () => {
        mockConnectSubscribers = mockConnectSubscribers.filter((s) => s !== cb);
        mockDisconnectSubscribers = mockDisconnectSubscribers.filter((s) => s !== cb);
      };
    },
  },
}));

const mockGetOrderById = jest.fn<Promise<Order>, [string]>();
const mockRequestNewDriver = jest.fn<Promise<Order>, [string, number]>();

/** Getar tanda galat, dicatat biar tes bisa menghitungnya. */
var mockHapticError = jest.fn();

jest.mock('../sync/client', () => {
  // requireActual supaya class UnauthorizedError tetap sama dengan yang
  // dilempar hook, jadi instanceof di hook benar.
  const actual = jest.requireActual('../sync/client') as typeof import('../sync/client');
  return {
    ...actual,
    getOrderById: (id: string): Promise<Order> => mockGetOrderById(id),
    requestNewDriver: (id: string, version: number): Promise<Order> =>
      mockRequestNewDriver(id, version),
  };
});

jest.mock('../haptics', () => ({
  hapticError: (): void => {
    mockHapticError();
  },
}));

var mockStatusJaringan = jest.fn<'online' | 'offline' | 'unknown', []>(
  () => 'online',
);

jest.mock('../map/networkMonitor', () => ({
  networkMonitor: {
    getStatus: () => mockStatusJaringan(),
    subscribe: (cb: () => void): (() => void) => {
      cb();
      return () => {};
    },
  },
}));

/** Langkah rute yang terakhir dirender, supaya tes bisa mengeceknya. */
var mockLangkahRute: number | null = null;

jest.mock('../components/TrackRoute', () => {
  const ReactLokal = require('react');
  const ReactNative = require('react-native');
  return {
    TrackRoute: (props: { langkah: number | null }): React.ReactElement => {
      mockLangkahRute = props.langkah;
      return ReactLokal.createElement(ReactNative.View, { testID: 'rute-status' });
    },
  };
});

const ORDER: Order = {
  id: '12345678-0000-0000-0000-000000000000',
  customerId: 'customer-1',
  status: 'ASSIGNED',
  items: [
    {
      id: 'item-1',
      productId: 'produk-1',
      name: 'Mie Goreng',
      quantity: 1,
      unitPriceCents: 23000,
    },
  ],
  deliveryAddress: {
    recipientName: 'Budi Santoso',
    phone: '081234567890',
    street: 'Jl. Merdeka No. 1',
    city: 'Denpasar',
    postalCode: '80111',
  },
  totalCents: 23000,
  currency: 'IDR',
  notes: 'Tolong dibungkus rapi',
  createdAt: '2026-08-30T00:00:00.000Z',
  updatedAt: '2026-08-30T00:00:00.000Z',
  version: 1,
};

const mockOnBack = jest.fn();
const mockOnOpenChat = jest.fn();

/** Waktu terakhir driver tersambung, dipakai order yang driverinya hilang. */
const TERPISAH_SINCE = '2026-08-30T00:10:00.000Z';

function orderDengan(ubah: Partial<Order>): Order {
  return { ...ORDER, ...ubah };
}

/** Order yang dipegang driver yang HP-nya tidak tersambung lagi. */
function orderTerpisah(ubah: Partial<Order> = {}): Order {
  return orderDengan({
    status: 'PREPARING',
    driverId: 'driver-1',
    driverUnreachableSince: TERPISAH_SINCE,
    ...ubah,
  });
}

function elemenLayar(terlihat: boolean): React.JSX.Element {
  return (
    <ThemeProvider name="terang">
      <OrderTrackingScreen
        orderId={ORDER.id}
        terlihat={terlihat}
        onBack={mockOnBack}
        onOpenChat={mockOnOpenChat}
      />
    </ThemeProvider>
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Render layar dengan order tiruan, lalu tunggu jawabannya selesai. */
async function tampilkan(ubah: Partial<Order> = {}): Promise<void> {
  mockGetOrderById.mockResolvedValue(orderDengan(ubah));
  render(elemenLayar(true));
  await flush();
}

function resetSubscribers(): void {
  mockAcceptedSubscribers = [];
  mockRejectedSubscribers = [];
  mockCancelledSubscribers = [];
  mockCodSubscribers = [];
  mockStatusSubscribers = [];
  mockConnectSubscribers = [];
  mockDisconnectSubscribers = [];
}

function triggerAccepted(payload: OrderAcceptedPayload): void {
  mockAcceptedSubscribers.forEach((cb) => cb(payload));
}

function triggerCancelled(payload: OrderCancelledPayload): void {
  mockCancelledSubscribers.forEach((cb) => cb(payload));
}

function triggerRejected(payload: {
  orderId: string;
  status: 'ASSIGNED';
  version: number;
}): void {
  mockRejectedSubscribers.forEach((cb) => cb(payload));
}

function triggerCodCollected(payload: OrderCodCollectedPayload): void {
  mockCodSubscribers.forEach((cb) => cb(payload));
}

function triggerStatusUpdated(payload: OrderStatusUpdatedPayload): void {
  mockStatusSubscribers.forEach((cb) => cb(payload));
}

function triggerConnect(): void {
  mockConnectSubscribers.forEach((cb) => cb());
}

function triggerDisconnect(): void {
  mockDisconnectSubscribers.forEach((cb) => cb());
}

interface GayaTeks {
  color?: TextStyle['color'];
  fontFamily?: TextStyle['fontFamily'];
  fontSize?: TextStyle['fontSize'];
  textAlign?: TextStyle['textAlign'];
}

/** Gaya teks yang sudah diratakan, biar assertionnya enak dibaca. */
function gayaTeks(elemen: { props: { style?: StyleProp<TextStyle> } }): GayaTeks {
  const gaya = StyleSheet.flatten(elemen.props.style);
  return {
    color: gaya?.color,
    fontFamily: gaya?.fontFamily,
    fontSize: gaya?.fontSize,
    textAlign: gaya?.textAlign,
  };
}

/**
 * Label langkah di kepala. Yang dicari lewat gaya, bukan lewat teks saja,
 * karena sebagian teksnya sama dengan label status.
 */
function labelLangkah(nama: string): { props: { style?: StyleProp<TextStyle> } } {
  const kepala = screen.getByTestId('kepala-status');
  const kandidat = within(kepala)
    .UNSAFE_getAllByType(Text)
    .filter((elemen) => {
      const gaya = gayaTeks(elemen);
      return gaya.textAlign === 'center' && elemen.props.children === nama;
    });
  if (kandidat.length !== 1) {
    throw new Error(`label langkah ${nama} ditemukan ${kandidat.length} kali`);
  }
  return kandidat[0];
}

/**
 * Jam order dibuat di kepala, dicari lewat teksnya.
 */
function jamDibuat(): { props: { style?: StyleProp<TextStyle> } } {
  const kepala = screen.getByTestId('kepala-status');
  const teks = formatOrderTime(new Date(ORDER.createdAt).getTime(), Date.now());
  const kandidat = within(kepala)
    .UNSAFE_getAllByType(Text)
    .filter((elemen) => elemen.props.children === teks);
  if (kandidat.length !== 1) {
    throw new Error(`jam order dibuat ditemukan ${kandidat.length} kali`);
  }
  return kandidat[0];
}

function adalahRekaman(nilai: unknown): nilai is Record<string, unknown> {
  return typeof nilai === 'object' && nilai !== null;
}

/** True kalau ada elemen yang punya prop entering, artinya ada gerak masuk. */
function punyaEntering(node: unknown): boolean {
  if (!adalahRekaman(node)) return false;
  const props = node.props;
  if (adalahRekaman(props) && props.entering !== undefined) return true;
  const children = node.children;
  if (Array.isArray(children)) {
    return children.some((child) => punyaEntering(child));
  }
  return false;
}

/** Semua banner di lembar status, sesuai urutan tampilnya. */
function semuaBanner() {
  return within(screen.getByTestId('lembar-status')).UNSAFE_queryAllByType(Banner);
}

/** Banner HP driver, cuma dia yang ikonnya awan terputus. */
function bannerHpDriver() {
  return semuaBanner().find((elemen) => elemen.props.icon === 'cloud_off');
}

/** Banner hasil permintaan driver lain, cuma dia yang punya tombol tutup. */
function bannerHasil() {
  return semuaBanner().find((elemen) => elemen.props.onClose !== undefined);
}

/**
 * Pasang permintaan driver lain yang belum selesai, biar tes bisa menahan
 * jawabannya. Fungsi yang dikembalikan menyelesaikan permintaan itu.
 */
function pasangPermintaanTertunda(): (nilai: Order) => void {
  let selesai: (nilai: Order) => void = () => {};
  const janji = new Promise<Order>((res) => {
    selesai = res;
  });
  mockRequestNewDriver.mockImplementation(() => janji);
  return selesai;
}

beforeEach(() => {
  mockGetOrderById.mockReset();
  mockGetOrderById.mockResolvedValue(ORDER);
  mockRequestNewDriver.mockReset();
  mockRequestNewDriver.mockResolvedValue(
    orderDengan({
      status: 'ASSIGNED',
      cancelReason: 'driver_unreachable',
      version: 2,
    }),
  );
  mockHapticError.mockReset();
  mockStatusJaringan.mockReturnValue('online');
  mockOnBack.mockReset();
  mockOnOpenChat.mockReset();
  mockLangkahRute = null;
  resetSubscribers();
});

describe('layar status order customer', () => {
  it('saat memuat, kerangka tampil dengan judul dan nomor order', () => {
    mockGetOrderById.mockReturnValue(new Promise<Order>(() => {}));
    render(elemenLayar(true));

    expect(screen.getByText('Status order')).toBeTruthy();
    expect(screen.getByText('#12345678')).toBeTruthy();
    expect(screen.queryByText('Order dibuat')).toBeNull();
  });

  it('galat: tombol Coba lagi memanggil server lagi lalu isi tampil', async () => {
    mockGetOrderById.mockRejectedValueOnce(new Error('Jaringan bermasalah'));
    render(elemenLayar(true));
    await flush();

    expect(screen.getByText('Gagal memuat order')).toBeTruthy();
    expect(screen.getByText('Cek koneksi internet Anda lalu coba lagi.')).toBeTruthy();
    expect(screen.queryByText('Jaringan bermasalah')).toBeNull();

    mockGetOrderById.mockResolvedValueOnce(ORDER);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Coba lagi'));
    });
    await flush();

    expect(screen.getByText('Order dibuat')).toBeTruthy();
    expect(screen.queryByText('Gagal memuat order')).toBeNull();
  });

  const KASUS_STATUS: Array<{
    status: OrderStatus;
    judul: string;
    langkah: 1 | 2 | 3 | 4 | null;
  }> = [
    { status: 'PENDING', judul: 'Order Anda sudah masuk', langkah: 1 },
    { status: 'ASSIGNED', judul: 'Order Anda sudah masuk', langkah: 1 },
    { status: 'PREPARING', judul: 'Driver sudah ditemukan untuk order Anda', langkah: 2 },
    { status: 'OUT_FOR_DELIVERY', judul: 'Driver sedang menuju alamat Anda', langkah: 3 },
    { status: 'DELIVERED', judul: 'Order sudah sampai di alamat Anda', langkah: 4 },
    { status: 'CANCELLED', judul: 'Order ini dibatalkan', langkah: null },
  ];

  KASUS_STATUS.forEach((kasus) => {
    it(`status ${kasus.status}: judul, label status, dan langkah sesuai`, async () => {
      await tampilkan({ status: kasus.status });

      const pil = within(screen.getByTestId('pil-status'));
      expect(pil.getByText(orderStatusLabel(kasus.status))).toBeTruthy();
      expect(screen.getByText(kasus.judul)).toBeTruthy();
      expect(mockLangkahRute).toBe(kasus.langkah);
    });
  });

  it('gaya label langkah: selesai, sekarang, dan belum', async () => {
    await tampilkan({ status: 'OUT_FOR_DELIVERY' });

    const selesai = gayaTeks(labelLangkah('Order dibuat'));
    expect(selesai.fontFamily).toBe(fontFamily.regular);
    expect(selesai.color).toBe(themes.gelap.textMuted);

    const sekarang = gayaTeks(labelLangkah('Dalam perjalanan'));
    expect(sekarang.fontFamily).toBe(fontFamily.semibold);
    expect(sekarang.color).toBe(themes.gelap.text);

    const belum = gayaTeks(labelLangkah('Terkirim'));
    expect(belum.fontFamily).toBe(fontFamily.regular);
    expect(belum.color).toBe(themes.gelap.textSubtle);
  });

  it('baris label langkah tanpa jarak atas dan tanpa padding samping', async () => {
    await tampilkan({ status: 'ASSIGNED' });

    const gaya = StyleSheet.flatten(screen.getByTestId('baris-label-langkah').props.style);
    expect(gaya?.marginTop).toBeUndefined();
    expect(gaya?.paddingHorizontal).toBeUndefined();
  });

  it('jam order dibuat ikut gaya label pertama', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-30T00:05:00.000Z') });
    try {
      await tampilkan({ status: 'ASSIGNED' });

      const jamPertama = gayaTeks(jamDibuat());
      expect(jamPertama.fontFamily).toBe(fontFamily.semibold);
      expect(jamPertama.color).toBe(themes.gelap.text);

      await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });

      const jamKedua = gayaTeks(jamDibuat());
      expect(jamKedua.fontFamily).toBe(fontFamily.regular);
      expect(jamKedua.color).toBe(themes.gelap.textMuted);
    } finally {
      jest.useRealTimers();
    }
  });

  it('label langkah pertama selesai, sisanya belum, saat order dibatalkan', async () => {
    await tampilkan({ status: 'CANCELLED' });

    const selesai = gayaTeks(labelLangkah('Order dibuat'));
    expect(selesai.fontFamily).toBe(fontFamily.regular);
    expect(selesai.color).toBe(themes.gelap.textMuted);

    const belum = gayaTeks(labelLangkah('Driver ditemukan'));
    expect(belum.fontFamily).toBe(fontFamily.regular);
    expect(belum.color).toBe(themes.gelap.textSubtle);
  });

  it('kepala memakai tema gelap, jadi judulnya warna terang', async () => {
    await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });

    const judul = screen.getByText('Driver sudah ditemukan untuk order Anda');
    expect(gayaTeks(judul).color).toBe(themes.gelap.text);
  });

  it('kepala memakai gradasi tegak dari header ke headerEnd', async () => {
    await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });

    const kepala = screen.getByTestId('kepala-status');
    await act(async () => {
      fireEvent(kepala, 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 240 } },
      });
    });

    const gradien = within(kepala).UNSAFE_getAllByType(LinearGradient);
    expect(gradien).toHaveLength(1);
    const stops = within(kepala).UNSAFE_getAllByType(Stop);
    expect(stops).toHaveLength(2);
    expect(stops[0].props.stopColor).toBe(themes.terang.header);
    expect(stops[1].props.stopColor).toBe(themes.terang.headerEnd);

    const isi = within(kepala).UNSAFE_getAllByType(Rect);
    expect(isi).toHaveLength(1);
    expect(isi[0].props.fill).toBe(`url(#${gradien[0].props.id})`);
  });

  it('gradasi kepala punya id sendiri per layar', async () => {
    await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });
    const kepalaSatu = screen.getByTestId('kepala-status');
    await act(async () => {
      fireEvent(kepalaSatu, 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 240 } },
      });
    });
    const idSatu = within(kepalaSatu).UNSAFE_getAllByType(LinearGradient)[0].props.id;

    const tampilanLain = render(elemenLayar(true));
    await flush();
    const kepalaDua = tampilanLain.getByTestId('kepala-status');
    await act(async () => {
      fireEvent(kepalaDua, 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 240 } },
      });
    });
    const idDua = within(kepalaDua).UNSAFE_getAllByType(LinearGradient)[0].props.id;

    expect(idSatu).not.toBe(idDua);
  });

  it('pantulan berwarna header tema layar dan berada di atas isi', async () => {
    await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });

    const pantulan = screen.getByTestId('pantulan-kepala');
    const gaya = StyleSheet.flatten(pantulan.props.style);
    expect(gaya?.backgroundColor).toBe(themes.terang.header);
    expect(gaya?.position).toBe('absolute');
    expect(gaya?.top).toBe(-1000);
    expect(gaya?.height).toBe(1000);
  });

  it('baris orang saat order belum punya driver', async () => {
    await tampilkan({ status: 'ASSIGNED' });

    const baris = within(screen.getByTestId('baris-orang'));
    expect(baris.getByText('Mencari driver')).toBeTruthy();
    expect(
      baris.getByText('Halaman ini berubah sendiri begitu ada driver yang menerima'),
    ).toBeTruthy();
    expect(screen.queryByTestId('tombol-chat')).toBeNull();
  });

  it('baris orang saat order sudah punya driver', async () => {
    await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });

    const baris = within(screen.getByTestId('baris-orang'));
    expect(baris.getByText('Driver Anda')).toBeTruthy();
    expect(baris.getByText('Sudah menerima order ini')).toBeTruthy();
    expect(screen.getByTestId('tombol-chat')).toBeTruthy();
  });

  it('order dibatalkan: tanpa baris orang, garis pemisah, dan kotak tunai', async () => {
    await tampilkan({ status: 'CANCELLED', cancelReason: 'kendaraan mogok' });

    expect(screen.queryByTestId('baris-orang')).toBeNull();
    expect(screen.queryByTestId('garis-orang')).toBeNull();
    expect(screen.queryByTestId('kotak-tunai')).toBeNull();
    expect(screen.queryByTestId('tombol-chat')).toBeNull();
  });

  it('baris alamat: jalan, kota dan kode pos, nama dan telepon', async () => {
    await tampilkan({ status: 'ASSIGNED' });

    const baris = within(screen.getByTestId('baris-alamat'));
    expect(baris.getByText('Jl. Merdeka No. 1')).toBeTruthy();
    expect(baris.getByText('Denpasar 80111')).toBeTruthy();
    expect(baris.getByText('Budi Santoso \u00b7 081234567890')).toBeTruthy();
  });

  it('baris alamat isinya rata tengah', async () => {
    await tampilkan({ status: 'ASSIGNED' });

    const gaya = StyleSheet.flatten(screen.getByTestId('baris-alamat').props.style);
    expect(gaya?.alignItems).toBe('center');
  });

  it('kotak tunai menyiapkan uang, lalu berubah jadi diterima', async () => {
    await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });

    expect(screen.getByTestId('kotak-tunai').props.accessibilityLabel).toContain(
      'Siapkan uang tunai',
    );

    await act(async () => {
      triggerCodCollected({
        orderId: ORDER.id,
        amountCents: 23000,
        currency: 'IDR',
        collectedAt: '2026-08-30T01:00:00.000Z',
      });
    });
    await flush();

    expect(screen.getByTestId('kotak-tunai').props.accessibilityLabel).toContain(
      'Pembayaran tunai diterima',
    );
  });

  it('kotak tunai sudah diterima kalau order selesai', async () => {
    await tampilkan({ status: 'DELIVERED', driverId: 'driver-1' });

    expect(screen.getByTestId('kotak-tunai').props.accessibilityLabel).toContain(
      'Pembayaran tunai diterima',
    );
  });

  it('kotak tunai langsung diterima kalau server sudah mencatat pembayaran', async () => {
    await tampilkan({
      status: 'OUT_FOR_DELIVERY',
      driverId: 'driver-1',
      payment: { method: 'CASH', status: 'CAPTURED' },
    });

    expect(screen.getByTestId('kotak-tunai').props.accessibilityLabel).toContain(
      'Pembayaran tunai diterima',
    );
    // Masih di dalam jendela awal, jadi isi kotak tidak berganti dengan gerak.
    expect(screen.queryByTestId('isi-kotak-lama')).toBeNull();
    const centang = screen.UNSAFE_getAllByType(DrawnStroke);
    expect(centang).toHaveLength(1);
    expect(centang[0].props.animate).toBe(false);
  });

  it('kotak tunai belum diterima kalau server belum mencatat pembayaran', async () => {
    await tampilkan({
      status: 'OUT_FOR_DELIVERY',
      driverId: 'driver-1',
      payment: null,
    });

    expect(screen.getByTestId('kotak-tunai').props.accessibilityLabel).toContain(
      'Siapkan uang tunai',
    );
  });

  it('sesudah jendela awal, kotak tunai ke diterima memakai gerak ganti isi', async () => {
    jest.useFakeTimers();
    try {
      await tampilkan({ status: 'OUT_FOR_DELIVERY', driverId: 'driver-1' });
      expect(screen.getByTestId('kotak-tunai').props.accessibilityLabel).toContain(
        'Siapkan uang tunai',
      );

      // Jendela awal sudah lewat, jadi pergantian isinya pakai gerak.
      await act(async () => {
        jest.advanceTimersByTime(600);
      });

      await act(async () => {
        triggerCodCollected({
          orderId: ORDER.id,
          amountCents: 23000,
          currency: 'IDR',
          collectedAt: '2026-08-30T01:00:00.000Z',
        });
      });
      await flush();

      expect(screen.getByTestId('kotak-tunai').props.accessibilityLabel).toContain(
        'Pembayaran tunai diterima',
      );
      const centang = screen.UNSAFE_getAllByType(DrawnStroke);
      expect(centang).toHaveLength(1);
      expect(centang[0].props.animate).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('rincian: barang, tanda kali, harga baris, dan catatan, tanpa total', async () => {
    await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });

    const rincian = within(screen.getByTestId('rincian'));
    expect(rincian.getByText('Rincian')).toBeTruthy();
    expect(rincian.getByText('Mie Goreng \u00d7 1')).toBeTruthy();
    expect(rincian.getByText(/Rp\s23\.000/)).toBeTruthy();
    expect(rincian.getByText('Tolong dibungkus rapi')).toBeTruthy();
    expect(screen.queryByText('Total')).toBeNull();
  });

  it('banner terputus muncul setelah socket terus putus dan hilang setelah tersambung', async () => {
    jest.useFakeTimers();
    try {
      await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });

      expect(screen.queryByText('Pembaruan langsung terputus')).toBeNull();

      await act(async () => {
        triggerDisconnect();
      });
      expect(screen.queryByText('Pembaruan langsung terputus')).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      expect(screen.getByText('Pembaruan langsung terputus')).toBeTruthy();
      expect(screen.getByText(/Status terakhir dari/)).toBeTruthy();

      await act(async () => {
        triggerConnect();
      });
      await flush();
      expect(screen.queryByText('Pembaruan langsung terputus')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('banner order dilepas: driver sebelumnya tidak aktif', async () => {
    await tampilkan({ status: 'ASSIGNED', cancelReason: 'system_timeout' });

    expect(
      screen.getByText('Driver sebelumnya tidak aktif. Sedang dicarikan driver lain.'),
    ).toBeTruthy();
    expect(screen.queryByText('system_timeout')).toBeNull();
  });

  it('banner order dilepas: order lepas dari driver sebelumnya', async () => {
    await tampilkan({ status: 'ASSIGNED', cancelReason: 'driver_unreachable' });

    expect(
      screen.getByText(
        'Order sudah dilepas dari driver sebelumnya. Sedang dicarikan driver lain.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('driver_unreachable')).toBeNull();
  });

  it('banner order dilepas: driver sebelumnya membatalkan', async () => {
    await tampilkan({
      status: 'ASSIGNED',
      cancelReason: 'kendaraan mogok',
      cancelledBy: 'driver-1',
    });

    expect(
      screen.getByText(
        'Driver sebelumnya membatalkan order ini. Sedang dicarikan driver lain.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('kendaraan mogok')).toBeNull();
  });

  it('banner order dilepas hilang setelah order diterima driver', async () => {
    await tampilkan({ status: 'ASSIGNED', cancelReason: 'system_timeout' });
    expect(
      screen.getByText('Driver sebelumnya tidak aktif. Sedang dicarikan driver lain.'),
    ).toBeTruthy();

    await act(async () => {
      triggerAccepted({
        orderId: ORDER.id,
        driverId: 'driver-1',
        status: 'PREPARING',
        version: 2,
      });
    });
    await flush();

    expect(
      screen.queryByText('Driver sebelumnya tidak aktif. Sedang dicarikan driver lain.'),
    ).toBeNull();
  });

  it('order:accepted mengubah label, judul, dan baris orang', async () => {
    await tampilkan({ status: 'ASSIGNED' });

    expect(within(screen.getByTestId('pil-status')).getByText('Mencari driver')).toBeTruthy();
    expect(screen.getByText('Order Anda sudah masuk')).toBeTruthy();
    expect(within(screen.getByTestId('baris-orang')).getByText('Mencari driver')).toBeTruthy();

    await act(async () => {
      triggerAccepted({
        orderId: ORDER.id,
        driverId: 'driver-1',
        status: 'PREPARING',
        version: 2,
      });
    });
    await flush();

    expect(within(screen.getByTestId('pil-status')).getByText('Driver ditemukan')).toBeTruthy();
    expect(screen.getByText('Driver sudah ditemukan untuk order Anda')).toBeTruthy();
    expect(within(screen.getByTestId('baris-orang')).getByText('Driver Anda')).toBeTruthy();
  });

  it('order:status_updated mengubah label, judul, dan baris orang', async () => {
    await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });

    expect(within(screen.getByTestId('pil-status')).getByText('Driver ditemukan')).toBeTruthy();
    expect(screen.getByText('Driver sudah ditemukan untuk order Anda')).toBeTruthy();
    expect(within(screen.getByTestId('baris-orang')).getByText('Driver Anda')).toBeTruthy();

    await act(async () => {
      triggerStatusUpdated({
        orderId: ORDER.id,
        status: 'OUT_FOR_DELIVERY',
        version: 2,
        updatedAt: '2026-08-30T02:00:00.000Z',
      });
    });
    await flush();

    expect(within(screen.getByTestId('pil-status')).getByText('Dalam perjalanan')).toBeTruthy();
    expect(screen.getByText('Driver sedang menuju alamat Anda')).toBeTruthy();
    expect(within(screen.getByTestId('baris-orang')).getByText('Driver Anda')).toBeTruthy();
  });

  it('kejadian untuk order lain diabaikan', async () => {
    await tampilkan({ status: 'ASSIGNED' });

    await act(async () => {
      triggerAccepted({
        orderId: 'order-lain',
        driverId: 'driver-9',
        status: 'PREPARING',
        version: 9,
      });
    });
    await flush();

    expect(within(screen.getByTestId('pil-status')).getByText('Mencari driver')).toBeTruthy();
    expect(screen.getByText('Order Anda sudah masuk')).toBeTruthy();
  });

  it('semua langganan dilepas saat layar ditutup', async () => {
    const tampilan = render(elemenLayar(true));
    await flush();

    expect(mockAcceptedSubscribers.length).toBeGreaterThan(0);
    expect(mockCancelledSubscribers.length).toBeGreaterThan(0);

    tampilan.unmount();

    expect(mockAcceptedSubscribers).toHaveLength(0);
    expect(mockRejectedSubscribers).toHaveLength(0);
    expect(mockCancelledSubscribers).toHaveLength(0);
    expect(mockCodSubscribers).toHaveLength(0);
    expect(mockStatusSubscribers).toHaveLength(0);
    expect(mockConnectSubscribers).toHaveLength(0);
    expect(mockDisconnectSubscribers).toHaveLength(0);
  });

  it('harga 23000 ditulis Rp 23.000, bukan 230', async () => {
    await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });

    expect(screen.getAllByText(/Rp\s23\.000/)).toHaveLength(2);
    expect(screen.queryByText(/Rp\s230(?![\d.])/)).toBeNull();
  });

  it('tombol Chat memanggil onOpenChat dengan id order dan hilang setelah dibatalkan', async () => {
    await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });

    await act(async () => {
      fireEvent.press(screen.getByTestId('tombol-chat'));
    });
    expect(mockOnOpenChat).toHaveBeenCalledWith(ORDER.id);

    await act(async () => {
      triggerCancelled({
        orderId: ORDER.id,
        status: 'ASSIGNED',
        version: 2,
        reason: 'kendaraan mogok',
      });
    });
    await flush();

    expect(screen.queryByTestId('tombol-chat')).toBeNull();
  });

  it('token kedaluwarsa: tanpa UI galat dan tanpa auth-expired dari layar', async () => {
    const emit = jest.spyOn(syncEvents, 'emit');
    mockGetOrderById.mockRejectedValue(new UnauthorizedError('token kedaluwarsa'));
    render(elemenLayar(true));
    await flush();

    expect(screen.queryByText('Gagal memuat order')).toBeNull();
    expect(screen.queryByText('Coba lagi')).toBeNull();
    expect(emit).not.toHaveBeenCalled();
    emit.mockRestore();
  });

  it('teks lama dari layar sebelumnya tidak tampil lagi', async () => {
    await tampilkan({
      status: 'CANCELLED',
      cancelReason: 'kendaraan mogok',
      notes: 'Tolong dibungkus rapi',
    });

    const teksLama = [
      'Memuat order...',
      'Status:',
      'Detail Pengiriman',
      'Catatan',
      'Alasan Pembatalan',
      'Order #',
      'Chat dengan Kurir',
      'Koneksi terputus, mencoba reconnect...',
      'Coba Lagi',
      'Kembali',
    ];
    teksLama.forEach((teks) => {
      expect(screen.queryByText(teks)).toBeNull();
    });
    expect(screen.queryByTestId('cod-collected-banner')).toBeNull();
    expect(screen.queryByTestId('connection-banner')).toBeNull();
  });

  it('terlihat diteruskan: tanpa tampil tidak ambil ulang, dengan tampil ambil ulang', async () => {
    jest.useFakeTimers();
    try {
      mockGetOrderById.mockResolvedValue(orderDengan({ status: 'PREPARING' }));
      const tampilan = render(elemenLayar(false));
      await flush();
      expect(mockGetOrderById).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(60 * 1000);
      });
      await flush();
      expect(mockGetOrderById).toHaveBeenCalledTimes(1);

      tampilan.rerender(elemenLayar(true));
      await act(async () => {
        jest.advanceTimersByTime(60 * 1000);
      });
      await flush();
      expect(mockGetOrderById).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('jendela awal dihitung dari isi pertama, '
    + 'banner yang muncul tidak punya gerak masuk', async () => {
    jest.useFakeTimers();
    try {
      // Isi baru muncul setelah tenggang terputus lewat, jadi banner
      // terputus keluar bersamaan dengan isi pertama.
      mockGetOrderById.mockImplementation(
        () =>
          new Promise<Order>((selesai) => {
            setTimeout(() => selesai(ORDER), 2500);
          }),
      );
      render(elemenLayar(true));
      await flush();

      await act(async () => {
        triggerDisconnect();
      });
      await act(async () => {
        jest.advanceTimersByTime(2500);
      });
      await flush();

      expect(screen.getByText('Pembaruan langsung terputus')).toBeTruthy();
      expect(punyaEntering(screen.toJSON())).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('banner HP driver tampil untuk PREPARING dengan driverUnreachableSince', async () => {
    jest.useFakeTimers({ now: new Date('2026-08-30T02:00:00.000Z') });
    try {
      await tampilkan(orderTerpisah());

      const banner = bannerHpDriver();
      expect(banner).toBeTruthy();
      expect(banner?.props.title).toBe(
        `HP driver belum tersambung sejak ${formatOrderTime(
          new Date(TERPISAH_SINCE).getTime(),
          Date.now(),
        )}`,
      );
      expect(banner?.props.body).toBe(
        'Order tetap dipegang driver. Kalau tidak mau menunggu, Anda bisa minta driver lain.',
      );
      expect(banner?.props.icon).toBe('cloud_off');
      expect(banner?.props.actions?.[0]?.label).toBe('Cari driver lain');
      expect(banner?.props.onClose).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('banner HP driver tidak tampil untuk order yang belum punya driver', async () => {
    await tampilkan(orderTerpisah({ status: 'ASSIGNED' }));

    expect(bannerHpDriver()).toBeUndefined();
  });

  it('banner HP driver tidak tampil tanpa driverUnreachableSince', async () => {
    await tampilkan(orderTerpisah({ driverUnreachableSince: undefined }));

    expect(bannerHpDriver()).toBeUndefined();
  });

  it('aksi Cari driver lain membuka lembar konfirmasi', async () => {
    await tampilkan(orderTerpisah());

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cari driver lain'));
    });

    expect(screen.getByText('Cari driver lain?')).toBeTruthy();
    expect(
      screen.getByText('Order dilepas dari driver ini dan ditawarkan lagi ke driver lain.'),
    ).toBeTruthy();
    const gaya = StyleSheet.flatten(
      screen.getByTestId('lembar-konfirmasi').props.style,
    );
    expect(gaya?.backgroundColor).toBe(themes.terang.surface);
  });

  it('tombol Tidak menutup lembar tanpa meminta driver lain', async () => {
    await tampilkan(orderTerpisah());
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cari driver lain'));
    });
    expect(screen.getByText('Cari driver lain?')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Tidak'));
    });

    expect(screen.queryByText('Cari driver lain?')).toBeNull();
    expect(mockRequestNewDriver).not.toHaveBeenCalled();
  });

  it('Ya meminta driver lain sekali', async () => {
    await tampilkan(orderTerpisah());
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cari driver lain'));
    });

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
    });

    expect(mockRequestNewDriver).toHaveBeenCalledTimes(1);
    expect(mockRequestNewDriver).toHaveBeenCalledWith(ORDER.id, 1);
  });

  it('status order berubah ke ASSIGNED tidak menggagalkan gerak keluar lembar', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    const selesaikanGerak = tahanLapisLama();
    try {
      await tampilkan(orderTerpisah());
      await lewatJendelaAwal();

      await act(async () => {
        fireEvent.press(screen.getByLabelText('Cari driver lain'));
      });
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
      });
      await flush();

      // Gerak keluar belum selesai, jadi Modalnya masih ada.
      expect(screen.getByTestId('lembar-konfirmasi')).toBeTruthy();

      // Jawaban server sudah mengubah status order jadi ASSIGNED, tapi isi
      // layar ditahan selama gerak keluar.
      expect(mockRequestNewDriver).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Driver sudah ditemukan untuk order Anda')).toBeTruthy();

      // Modalnya tetap ada, jadi lembar tidak dilepas lalu dipasang ulang.
      expect(screen.getByTestId('lembar-konfirmasi')).toBeTruthy();

      await act(async () => {
        selesaikanGerak();
      });
      await flush();

      // Modalnya baru dilepas sesudah gerak keluar selesai.
      expect(screen.queryByTestId('lembar-konfirmasi')).toBeNull();
      expect(screen.getByText('Order Anda sudah masuk')).toBeTruthy();
    } finally {
      jest.restoreAllMocks();
      jest.useRealTimers();
    }
  });

  it('selama keluar lewat Ya isi layar ditahan, lalu dipasang lagi setelah lembar lepas', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    const selesaikanGerak = tahanLapisLama();
    try {
      await tampilkan(orderTerpisah());
      await lewatJendelaAwal();

      await act(async () => {
        fireEvent.press(screen.getByLabelText('Cari driver lain'));
      });
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
      });
      await flush();

      // Server sudah menjawab, tapi isi layar masih yang lama.
      expect(mockRequestNewDriver).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('lembar-konfirmasi')).toBeTruthy();
      expect(within(screen.getByTestId('pil-status')).getByText('Driver ditemukan')).toBeTruthy();
      expect(bannerHpDriver()).toBeTruthy();
      expect(screen.queryByText('Order Anda sudah masuk')).toBeNull();

      await act(async () => {
        selesaikanGerak();
      });
      await flush();

      // Lembar sudah lepas, jadi isi baru dipasang.
      expect(screen.queryByTestId('lembar-konfirmasi')).toBeNull();
      expect(within(screen.getByTestId('pil-status')).getByText('Mencari driver')).toBeTruthy();
      expect(bannerHpDriver()).toBeUndefined();
    } finally {
      jest.restoreAllMocks();
      jest.useRealTimers();
    }
  });

  it('tahanan isi layar lepas sendiri kalau lembar belum lepas setelah batas aman', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    tahanLapisLama();
    try {
      await tampilkan(orderTerpisah());
      await lewatJendelaAwal();

      await act(async () => {
        fireEvent.press(screen.getByLabelText('Cari driver lain'));
      });
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
      });
      await flush();

      // Tahanannya masih ada, isi lama yang tampil.
      expect(within(screen.getByTestId('pil-status')).getByText('Driver ditemukan')).toBeTruthy();

      await act(async () => {
        jest.advanceTimersByTime(BATAS_TAHAN_MS);
      });
      await flush();

      // Batas aman terlampaui, jadi isi baru dipasang walau lembar belum lepas.
      expect(screen.getByTestId('lembar-konfirmasi')).toBeTruthy();
      expect(within(screen.getByTestId('pil-status')).getByText('Mencari driver')).toBeTruthy();
    } finally {
      jest.restoreAllMocks();
      jest.useRealTimers();
    }
  });

  it('banner hasil server menolak muncul setelah lembar lepas', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    const selesaikanGerak = tahanLapisLama();
    mockRequestNewDriver.mockRejectedValue(
      new ApiError('ditolak server', 409, 'DRIVER_STILL_REACHABLE'),
    );
    try {
      await tampilkan(orderTerpisah());
      await lewatJendelaAwal();

      await act(async () => {
        fireEvent.press(screen.getByLabelText('Cari driver lain'));
      });
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
      });
      await flush();

      // Server menolak, tapi banner hasilnya masih ditahan.
      expect(bannerHasil()).toBeUndefined();

      await act(async () => {
        selesaikanGerak();
      });
      await flush();

      // Banner hasil baru muncul setelah lembar lepas.
      expect(bannerHasil()?.props.body).toBe(
        'Driver baru saja tersambung lagi, jadi order tetap dipegang driver.',
      );
    } finally {
      jest.restoreAllMocks();
      jest.useRealTimers();
    }
  });

  it('sambil menunggu aksi banner memuat dan ketukan kedua diabaikan', async () => {
    const selesai = pasangPermintaanTertunda();
    await tampilkan(orderTerpisah());
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cari driver lain'));
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
    });

    expect(bannerHpDriver()?.props.actions?.[0]?.loading).toBe(true);

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cari driver lain'));
    });

    expect(mockRequestNewDriver).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Cari driver lain?')).toBeNull();

    await act(async () => {
      selesai(orderDengan({ status: 'ASSIGNED', cancelReason: 'driver_unreachable', version: 2 }));
    });
    await flush();
  });

  it('berhasil: layar jadi mencari dengan banner lepas, tanpa banner hasil ' +
    'dan tanpa getar', async () => {
    await tampilkan(orderTerpisah());
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cari driver lain'));
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
    });
    await flush();

    expect(within(screen.getByTestId('baris-orang')).getByText('Mencari driver')).toBeTruthy();
    expect(
      screen.getByText('Order sudah dilepas dari driver sebelumnya. Sedang dicarikan driver lain.'),
    ).toBeTruthy();
    expect(bannerHasil()).toBeUndefined();
    expect(mockHapticError).not.toHaveBeenCalled();
  });

  const KASUS_DITOLAK: Array<{ kode: string; teks: string }> = [
    {
      kode: 'DRIVER_STILL_REACHABLE',
      teks: 'Driver baru saja tersambung lagi, jadi order tetap dipegang driver.',
    },
    {
      kode: 'ORDER_NOT_RELEASABLE',
      teks: 'Order ini sudah tidak bisa dialihkan ke driver lain.',
    },
    {
      kode: 'VERSION_CONFLICT',
      teks: 'Order baru saja berubah. Coba lagi kalau masih perlu.',
    },
  ];

  KASUS_DITOLAK.forEach((kasus) => {
    it(`server menolak dengan ${kasus.kode}: banner info, getar, dan order ` +
      `diambil ulang`, async () => {
      mockRequestNewDriver.mockRejectedValue(
        new ApiError('ditolak server', 409, kasus.kode),
      );
      await tampilkan(orderTerpisah());
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Cari driver lain'));
      });
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
      });
      await flush();

      const banner = bannerHasil();
      expect(banner?.props.tone).toBe('info');
      expect(banner?.props.icon).toBe('info');
      expect(banner?.props.body).toBe(kasus.teks);
      expect(mockHapticError).toHaveBeenCalledTimes(1);
      expect(mockGetOrderById).toHaveBeenCalledTimes(2);

      await act(async () => {
        fireEvent.press(screen.getByLabelText('Tutup'));
      });
      expect(bannerHasil()).toBeUndefined();
    });
  });

  it('galat jaringan: banner danger dan getar sekali', async () => {
    mockRequestNewDriver.mockRejectedValue(new Error('jaringan bermasalah'));
    await tampilkan(orderTerpisah());
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cari driver lain'));
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
    });
    await flush();

    const banner = bannerHasil();
    expect(banner?.props.tone).toBe('danger');
    expect(banner?.props.icon).toBeUndefined();
    expect(banner?.props.body).toBe(
      'Tidak bisa meminta driver lain. Cek koneksi internet Anda lalu coba lagi.',
    );
    expect(mockHapticError).toHaveBeenCalledTimes(1);
  });

  it('banner danger ikut hilang saat cari driver lain tidak lagi boleh', async () => {
    mockRequestNewDriver.mockRejectedValue(new Error('jaringan bermasalah'));
    await tampilkan(orderTerpisah());
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cari driver lain'));
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
    });
    await flush();

    expect(bannerHasil()?.props.tone).toBe('danger');
    expect(bannerHpDriver()).toBeTruthy();

    // Driver tersambung lagi, jadi cari driver lain tidak lagi boleh.
    mockGetOrderById.mockResolvedValue(
      orderTerpisah({ driverUnreachableSince: undefined }),
    );
    await act(async () => {
      triggerConnect();
    });
    await flush();

    expect(bannerHpDriver()).toBeUndefined();
    expect(bannerHasil()).toBeUndefined();
  });

  it('banner danger tidak muncul lagi setelah cari driver lain boleh lagi', async () => {
    mockRequestNewDriver.mockRejectedValue(new Error('jaringan bermasalah'));
    await tampilkan(orderTerpisah());
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cari driver lain'));
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
    });
    await flush();

    expect(bannerHasil()?.props.tone).toBe('danger');
    expect(bannerHpDriver()).toBeTruthy();

    // Driver tersambung lagi, jadi cari driver lain tidak lagi boleh.
    mockGetOrderById.mockResolvedValue(
      orderTerpisah({ driverUnreachableSince: undefined }),
    );
    await act(async () => {
      triggerConnect();
    });
    await flush();

    expect(bannerHpDriver()).toBeUndefined();
    expect(bannerHasil()).toBeUndefined();

    // Driver tidak tersambung lagi, jadi cari driver lain boleh lagi.
    mockGetOrderById.mockResolvedValue(orderTerpisah());
    await act(async () => {
      triggerConnect();
    });
    await flush();

    expect(bannerHpDriver()).toBeTruthy();
    expect(bannerHasil()).toBeUndefined();
  });

  it('banner info dari penolakan server tetap tampil walau cari driver lain tidak lagi boleh', async () => {
    mockRequestNewDriver.mockRejectedValue(
      new ApiError('ditolak server', 409, 'DRIVER_STILL_REACHABLE'),
    );
    await tampilkan(orderTerpisah());
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cari driver lain'));
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
    });
    await flush();

    // Driver tersambung lagi, jadi cari driver lain tidak lagi boleh.
    mockGetOrderById.mockResolvedValue(
      orderTerpisah({ driverUnreachableSince: undefined }),
    );
    await act(async () => {
      triggerConnect();
    });
    await flush();

    expect(bannerHpDriver()).toBeUndefined();
    expect(bannerHasil()?.props.tone).toBe('info');
  });

  it('sesi berakhir: tanpa banner hasil dan tanpa getar', async () => {
    mockRequestNewDriver.mockRejectedValue(new UnauthorizedError('token kedaluwarsa'));
    await tampilkan(orderTerpisah());
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cari driver lain'));
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
    });
    await flush();

    expect(bannerHasil()).toBeUndefined();
    expect(mockHapticError).not.toHaveBeenCalled();
  });

  it('banner HP driver hilang selagi lembar terbuka menutup lembar dan tidak ' +
    'dibuka lagi', async () => {
    await tampilkan(orderTerpisah());
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cari driver lain'));
    });
    expect(screen.getByText('Cari driver lain?')).toBeTruthy();

    mockGetOrderById.mockResolvedValue(
      orderTerpisah({ driverUnreachableSince: undefined }),
    );
    await act(async () => {
      triggerConnect();
    });
    await flush();

    expect(screen.queryByText('Cari driver lain?')).toBeNull();
    expect(mockRequestNewDriver).not.toHaveBeenCalled();

    mockGetOrderById.mockResolvedValue(orderTerpisah());
    await act(async () => {
      triggerConnect();
    });
    await flush();

    expect(screen.getByText(/HP driver belum tersambung sejak/)).toBeTruthy();
    expect(screen.queryByText('Cari driver lain?')).toBeNull();
  });

  it('urutan banner di lembar: terputus, hasil, lalu HP driver', async () => {
    jest.useFakeTimers();
    try {
      mockRequestNewDriver.mockRejectedValue(new Error('jaringan bermasalah'));
      await tampilkan(orderTerpisah());
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Cari driver lain'));
      });
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
      });
      await flush();
      await act(async () => {
        triggerDisconnect();
      });
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });

      const urutan = semuaBanner().map((elemen) => {
        if (elemen.props.title === 'Pembaruan langsung terputus') return 'terputus';
        if (elemen.props.icon === 'cloud_off') return 'hp-driver';
        return 'hasil';
      });

      expect(urutan).toEqual(['terputus', 'hasil', 'hp-driver']);
    } finally {
      jest.useRealTimers();
    }
  });

  /** Menunggu jendela awal selesai, jadi gerak isi boleh berjalan. */
  async function lewatJendelaAwal(): Promise<void> {
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    await flush();
  }

  /** Timing ditiru tanpa memanggil callback, jadi lapisan lama tetap ada. */
  function tahanLapisLama(): () => void {
    const tertunda: Array<() => void> = [];
    jest
      .spyOn(reanimated, 'withTiming')
      .mockImplementation((nilaiAkhir, _konfigurasi, callback) => {
        if (callback) {
          tertunda.push(() => callback(true));
        }
        return nilaiAkhir;
      });
    return () => {
      tertunda.forEach((panggil) => panggil());
    };
  }

  /**
   * Merekam semua panggilan timing, tanpa memanggil callbacknya.
   *
   * Dipakai untuk memeriksa nilai akhir dan durasi gerakannya, sambil
   * menahan lapisan lama supaya tetap bisa dilihat.
   */
  function rekamGerak(): {
    panggilan: Array<{ nilai: unknown; durasi: number | undefined }>;
    lepaskan: () => void;
  } {
    const tertunda: Array<() => void> = [];
    const panggilan: Array<{ nilai: unknown; durasi: number | undefined }> = [];
    jest
      .spyOn(reanimated, 'withTiming')
      .mockImplementation((nilaiAkhir, konfigurasi, callback) => {
        if (callback) {
          tertunda.push(() => callback(true));
        }
        panggilan.push({ nilai: nilaiAkhir, durasi: konfigurasi?.duration });
        return nilaiAkhir;
      });
    return {
      panggilan,
      lepaskan: () => {
        tertunda.forEach((panggil) => panggil());
      },
    };
  }

  /** Gaya dari elemen yang digerakkan. */
  function gayaIkon(elemen: { props: { style: unknown } }): unknown {
    return elemen.props.style;
  }

  it('judul lama pudar keluar sesudah order:accepted', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    tahanLapisLama();
    try {
      await tampilkan({ status: 'ASSIGNED' });
      await lewatJendelaAwal();

      await act(async () => {
        triggerAccepted({
          orderId: ORDER.id,
          driverId: 'driver-1',
          status: 'PREPARING',
          version: 2,
        });
      });
      await flush();

      const lama = screen.getByTestId('judul-lama', { includeHiddenElements: true });
      expect(
        within(lama).getByText('Order Anda sudah masuk', { includeHiddenElements: true }),
      ).toBeTruthy();
      expect(screen.getByTestId('judul-baru').props.entering).toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('judul lama tidak ada di dalam jendela awal', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    tahanLapisLama();
    try {
      await tampilkan({ status: 'ASSIGNED' });

      await act(async () => {
        triggerAccepted({
          orderId: ORDER.id,
          driverId: 'driver-1',
          status: 'PREPARING',
          version: 2,
        });
      });
      await flush();

      expect(screen.queryByTestId('judul-lama', { includeHiddenElements: true })).toBeNull();
      expect(screen.getByTestId('judul-baru').props.entering).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('baris orang lama dan sorotan muncul sesudah order:accepted', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    tahanLapisLama();
    try {
      await tampilkan({ status: 'ASSIGNED' });
      await lewatJendelaAwal();

      await act(async () => {
        triggerAccepted({
          orderId: ORDER.id,
          driverId: 'driver-1',
          status: 'PREPARING',
          version: 2,
        });
      });
      await flush();

      const lama = screen.getByTestId('orang-lama', { includeHiddenElements: true });
      expect(
        within(lama).getByText('Mencari driver', { includeHiddenElements: true }),
      ).toBeTruthy();

      const gaya = StyleSheet.flatten(screen.getByTestId('sorotan-orang').props.style);
      expect(gaya.backgroundColor).toBe(themes.terang.infoWash);
    } finally {
      jest.useRealTimers();
    }
  });

  it('isi baris orang lama dikunci di ukuran isinya yang sebelumnya', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    tahanLapisLama();
    try {
      await tampilkan({ status: 'ASSIGNED' });
      await lewatJendelaAwal();

      // Ukuran isi baris orang yang terakhir.
      await act(async () => {
        fireEvent(screen.getByTestId('isi-baris-orang'), 'layout', {
          nativeEvent: { layout: { x: 0, y: 4, width: 300, height: 62.5 } },
        });
      });

      await act(async () => {
        triggerAccepted({
          orderId: ORDER.id,
          driverId: 'driver-1',
          status: 'PREPARING',
          version: 2,
        });
      });
      await flush();

      // Isi lama tetap di tempat dan ukuran yang sebelumnya.
      const gaya = StyleSheet.flatten(
        screen.getByTestId('orang-lama', { includeHiddenElements: true }).props.style,
      );
      expect(gaya.width).toBe(300);
      expect(gaya.height).toBe(62.5);
      expect(gaya.left).toBe(0);
      expect(gaya.top).toBe(4);
    } finally {
      jest.useRealTimers();
    }
  });

  it('dengan kurangi gerakan tidak ada lapisan lama dan tidak ada sorotan', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);
    tahanLapisLama();
    try {
      await tampilkan({ status: 'ASSIGNED' });
      await lewatJendelaAwal();

      await act(async () => {
        triggerAccepted({
          orderId: ORDER.id,
          driverId: 'driver-1',
          status: 'PREPARING',
          version: 2,
        });
      });
      await flush();

      expect(screen.queryByTestId('judul-lama', { includeHiddenElements: true })).toBeNull();
      expect(screen.queryByTestId('orang-lama', { includeHiddenElements: true })).toBeNull();
      expect(screen.queryByTestId('sorotan-orang')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('sesudah Cari driver lain sukses ada baris orang lama tapi tanpa sorotan', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    const selesaikanGerak = tahanLapisLama();
    try {
      await tampilkan(orderTerpisah());
      await lewatJendelaAwal();

      await act(async () => {
        fireEvent.press(screen.getByLabelText('Cari driver lain'));
      });
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
      });
      await flush();

      // Isi layar ditahan selama gerak keluar, jadi isinya belum berganti.
      expect(screen.queryByTestId('orang-lama', { includeHiddenElements: true })).toBeNull();

      await act(async () => {
        selesaikanGerak();
      });
      await flush();

      expect(screen.getByTestId('orang-lama', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.queryByTestId('sorotan-orang')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('cari driver lain dengan socket lebih dulu tidak memasang sorotan', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    const selesaikanGerak = tahanLapisLama();
    try {
      await tampilkan(orderTerpisah());
      await lewatJendelaAwal();

      const selesai = pasangPermintaanTertunda();

      await act(async () => {
        fireEvent.press(screen.getByLabelText('Cari driver lain'));
      });
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
      });
      await flush();

      // Socket lebih dulu daripada jawaban http.
      await act(async () => {
        triggerRejected({ orderId: ORDER.id, status: 'ASSIGNED', version: 2 });
      });
      await flush();

      expect(screen.queryByTestId('sorotan-orang')).toBeNull();

      await act(async () => {
        selesai(orderDengan({ status: 'ASSIGNED', cancelReason: 'driver_unreachable', version: 2 }));
      });
      await flush();

      expect(screen.queryByTestId('sorotan-orang')).toBeNull();

      // Lembar sudah lepas, jadi isi baris yang baru dipasang tanpa sorotan.
      await act(async () => {
        selesaikanGerak();
      });
      await flush();

      expect(screen.queryByTestId('sorotan-orang')).toBeNull();
    } finally {
      jest.restoreAllMocks();
      jest.useRealTimers();
    }
  });

  it('cari driver lain dengan jawaban http lebih dulu tidak memasang sorotan', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    const selesaikanGerak = tahanLapisLama();
    try {
      await tampilkan(orderTerpisah());
      await lewatJendelaAwal();

      const selesai = pasangPermintaanTertunda();

      await act(async () => {
        fireEvent.press(screen.getByLabelText('Cari driver lain'));
      });
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
      });
      await flush();

      // Jawaban http lebih dulu.
      await act(async () => {
        selesai(orderDengan({ status: 'ASSIGNED', cancelReason: 'driver_unreachable', version: 2 }));
      });
      await flush();

      expect(screen.queryByTestId('sorotan-orang')).toBeNull();

      // Socket menyusul, versinya sudah dipakai.
      await act(async () => {
        triggerRejected({ orderId: ORDER.id, status: 'ASSIGNED', version: 2 });
      });
      await flush();

      expect(screen.queryByTestId('sorotan-orang')).toBeNull();

      // Lembar sudah lepas, jadi isi baris yang baru dipasang tanpa sorotan.
      await act(async () => {
        selesaikanGerak();
      });
      await flush();

      expect(screen.queryByTestId('sorotan-orang')).toBeNull();
    } finally {
      jest.restoreAllMocks();
      jest.useRealTimers();
    }
  });

  it('ambil ulang dengan versi baru tanpa ganti isi baris tidak pasang sorotan', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    tahanLapisLama();
    try {
      await tampilkan(orderTerpisah());
      await lewatJendelaAwal();

      await act(async () => {
        fireEvent.press(screen.getByLabelText('Cari driver lain'));
      });
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Ya, cari driver lain'));
      });
      await flush();

      mockGetOrderById.mockResolvedValue(
        orderDengan({
          status: 'ASSIGNED',
          cancelReason: 'driver_unreachable',
          version: 3,
        }),
      );
      await act(async () => {
        triggerConnect();
      });
      await flush();

      expect(screen.queryByTestId('sorotan-orang')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('perubahan status yang tidak mengganti isi baris orang tidak pasang sorotan', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    tahanLapisLama();
    try {
      await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });
      await lewatJendelaAwal();

      await act(async () => {
        triggerStatusUpdated({
          orderId: ORDER.id,
          status: 'OUT_FOR_DELIVERY',
          version: 2,
          updatedAt: '2026-08-30T02:00:00.000Z',
        });
      });
      await flush();

      expect(screen.queryByTestId('orang-lama', { includeHiddenElements: true })).toBeNull();
      expect(screen.queryByTestId('sorotan-orang')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('bilah koneksi customer menampilkan Offline saja', async () => {
    mockStatusJaringan.mockReturnValue('offline');
    await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });

    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.queryByText(/perubahan disimpan di HP/)).toBeNull();
  });

  it('tombol chat muncul dengan gerak pudar dan membesar saat driver ditemukan', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    try {
      await tampilkan({ status: 'ASSIGNED' });
      await lewatJendelaAwal();

      // Belum ada driver, jadi tombol chat belum ada.
      expect(screen.queryByTestId('tombol-chat')).toBeNull();

      await act(async () => {
        triggerAccepted({
          orderId: ORDER.id,
          driverId: 'driver-1',
          status: 'PREPARING',
          version: 2,
        });
      });
      await flush();

      expect(screen.getByTestId('tombol-chat')).toBeTruthy();
      const bungkus = screen.getByTestId('bungkus-tombol-chat');
      expect(bungkus.props.entering).toBeDefined();
      expect(bungkus.props.exiting).toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('layar yang dibuka dengan driver menampilkan tombol chat tanpa gerak', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    try {
      await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });

      expect(screen.getByTestId('tombol-chat')).toBeTruthy();
      expect(screen.getByTestId('bungkus-tombol-chat').props.entering).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('dengan kurangi gerakan tombol chat muncul tanpa gerak', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);
    try {
      await tampilkan({ status: 'ASSIGNED' });
      await lewatJendelaAwal();

      await act(async () => {
        triggerAccepted({
          orderId: ORDER.id,
          driverId: 'driver-1',
          status: 'PREPARING',
          version: 2,
        });
      });
      await flush();

      expect(screen.getByTestId('tombol-chat')).toBeTruthy();
      expect(screen.getByTestId('bungkus-tombol-chat').props.entering).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('ikon avatar lama mengecil dan ikon avatar baru membesar', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    const gerak = rekamGerak();
    try {
      await tampilkan({ status: 'ASSIGNED' });
      await lewatJendelaAwal();

      await act(async () => {
        triggerAccepted({
          orderId: ORDER.id,
          driverId: 'driver-1',
          status: 'PREPARING',
          version: 2,
        });
      });
      await flush();

      // Ikon yang baru mulai dari kecil dan transparan, ikon yang lama dari
      // ukuran penuh.
      expect(gayaIkon(screen.getByTestId('ikon-avatar'))).toEqual({
        opacity: 0,
        transform: [{ scale: 0.6 }],
      });
      expect(
        gayaIkon(screen.getByTestId('ikon-avatar-lama', { includeHiddenElements: true })),
      ).toEqual({
        opacity: 1,
        transform: [{ scale: 1 }],
      });

      // Ikon lama mengecil ke 0,6 selama 120 ms, ikon baru membesar ke 1
      // selama 180 ms.
      expect(gerak.panggilan).toContainEqual({ nilai: 0.6, durasi: 120 });
      expect(gerak.panggilan).toContainEqual({ nilai: 1, durasi: 180 });

      // Setelah gerakan selesai, ikon yang baru tampil utuh.
      await act(async () => {
        gerak.lepaskan();
      });
      await flush();
      expect(gayaIkon(screen.getByTestId('ikon-avatar'))).toEqual({
        opacity: 1,
        transform: [{ scale: 1 }],
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('ikon avatar yang muncul saat layar dibuka tidak bergerak', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    const gerak = rekamGerak();
    try {
      await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });
      await lewatJendelaAwal();

      expect(gayaIkon(screen.getByTestId('ikon-avatar'))).toEqual({
        opacity: 1,
        transform: [{ scale: 1 }],
      });
      expect(gerak.panggilan).not.toContainEqual({ nilai: 0.6, durasi: 120 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('dengan kurangi gerakan ikon avatar berganti tanpa gerak', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);
    const gerak = rekamGerak();
    try {
      await tampilkan({ status: 'ASSIGNED' });
      await lewatJendelaAwal();

      await act(async () => {
        triggerAccepted({
          orderId: ORDER.id,
          driverId: 'driver-1',
          status: 'PREPARING',
          version: 2,
        });
      });
      await flush();

      // Tidak ada lapisan lama, jadi ikon langsung berganti.
      expect(
        screen.queryByTestId('ikon-avatar-lama', { includeHiddenElements: true }),
      ).toBeNull();
      expect(gayaIkon(screen.getByTestId('ikon-avatar'))).toEqual({
        opacity: 1,
        transform: [{ scale: 1 }],
      });
      expect(gerak.panggilan).not.toContainEqual({ nilai: 0.6, durasi: 120 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('wadah judul dan isi lembar punya gerak tinggi, isinya di bawah ikut bergeser', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    try {
      await tampilkan({ status: 'ASSIGNED' });

      // Di dalam jendela awal belum ada gerak, biar layar yang baru dibuka
      // tidak ramai.
      expect(screen.getByTestId('wadah-judul').props.layout).toBeUndefined();
      expect(screen.getByTestId('lembar-status').props.layout).toBeUndefined();

      await lewatJendelaAwal();

      // Wadah yang isinya bisa berubah tinggi ikut bergerak.
      expect(screen.getByTestId('wadah-judul').props.layout).toBeDefined();
      expect(screen.getByTestId('lembar-status').props.layout).toBeDefined();

      // Isi di bawahnya ikut bergeser, jadi tidak melompat.
      expect(screen.getByTestId('wadah-rute').props.layout).toBeDefined();
      expect(screen.getByTestId('baris-label-langkah').props.layout).toBeDefined();
      screen.getAllByTestId('anak-lembar').forEach((anak) => {
        expect(anak.props.layout).toBeDefined();
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('layout anak lembar kosong di dalam jendela awal dan terisi setelahnya', async () => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
    try {
      await tampilkan({ status: 'PREPARING', driverId: 'driver-1' });

      const diJendela = screen.getAllByTestId('anak-lembar');
      expect(diJendela.length).toBeGreaterThan(0);
      diJendela.forEach((anak) => {
        expect(anak.props.layout).toBeUndefined();
      });

      await lewatJendelaAwal();

      const diLuar = screen.getAllByTestId('anak-lembar');
      diLuar.forEach((anak) => {
        expect(anak.props.layout).toBeDefined();
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
