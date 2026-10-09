/**
 * Tests untuk OrderCreateScreen.
 *
 * Screen ini online-only (tidak ada WatermelonDB), jadi mocking lebih simple.
 * Cakupan:
 * 1. Render tanpa crash
 * 2. Submit dengan field kosong → validasi block
 * 3. Submit dengan field lengkap → createOrder dipanggil dengan payload benar
 * 4. Submit sukses → Alert konfirmasi dengan tombol 'Lihat Status' + onCreateSuccess
 * 5. Submit sukses tanpa onCreateSuccess → fallback ke tombol 'Kembali ke Home' (legacy)
 * 6. Submit gagal → tampil pesan error, form tidak ke-reset
 * 7. Submit butuh posisi GPS (titik antar) sebelum createOrder
 */

import React from 'react';
import { Alert } from 'react-native';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';

import { OrderCreateScreen } from './OrderCreateScreen';

// Mock react-native untuk Alert
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return {
    ...actual,
    Alert: { ...actual.Alert, alert: jest.fn() },
  };
});

// Mock createOrder
jest.mock('../sync/client', () => ({
  createOrder: jest.fn(),
}));

// Mock locationService. Bawaannya izin diberikan dan posisi terakhir ada
// (lat -8.65, lng 115.2167, Denpasar), jadi tes submit yang lama tetap
// berjalan. Tes lain mengganti nilainya sendiri.
const mockRequestPermission = jest.fn().mockResolvedValue('granted');
const mockGetLastKnown = jest.fn().mockResolvedValue({
  coords: { latitude: -8.65, longitude: 115.2167 },
  timestamp: 1000,
});
const mockUnsubscribe = jest.fn();
const mockSubscribe = jest.fn().mockResolvedValue(mockUnsubscribe);

jest.mock('../map/location', () => ({
  locationService: {
    requestPermission: (...args: unknown[]) => mockRequestPermission(...args),
    getLastKnown: (...args: unknown[]) => mockGetLastKnown(...args),
    subscribe: (...args: unknown[]) => mockSubscribe(...args),
    hasPermission: jest.fn(() => true),
    setMinDisplacement: jest.fn(),
  },
}));

describe('OrderCreateScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks tidak mengembalikan implementasi, jadi nilai bawaan
    // dipasang ulang supaya perubahan di satu tes tidak terbawa ke tes lain.
    mockRequestPermission.mockResolvedValue('granted');
    mockGetLastKnown.mockResolvedValue({
      coords: { latitude: -8.65, longitude: 115.2167 },
      timestamp: 1000,
    });
    mockSubscribe.mockResolvedValue(mockUnsubscribe);
  });

  it('render tanpa crash', () => {
    const onBack = jest.fn();
    const { getByText, getByPlaceholderText } = render(
      <OrderCreateScreen onBack={onBack} />
    );

    expect(getByText('Buat Order Baru')).toBeTruthy();
    expect(getByPlaceholderText('Nama Penerima')).toBeTruthy();
    expect(getByPlaceholderText('Nama Barang')).toBeTruthy();
    expect(getByText('Buat Order')).toBeTruthy();
    expect(getByText('Batal')).toBeTruthy();
  });

  it('submit dengan field kosong → validasi block, createOrder tidak dipanggil', async () => {
    const onBack = jest.fn();
    const { getByText } = render(<OrderCreateScreen onBack={onBack} />);

    fireEvent.press(getByText('Buat Order'));

    // Validasi errors harus muncul
    await waitFor(() => {
      expect(getByText('Nama penerima wajib diisi')).toBeTruthy();
    });

    // createOrder tidak boleh dipanggil
    const { createOrder } = require('../sync/client');
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('qty = 0 → validasi block dengan pesan "Jumlah harus lebih dari 0"', async () => {
    const onBack = jest.fn();
    const { getByText, getByPlaceholderText } = render(<OrderCreateScreen onBack={onBack} />);

    // Isi form dengan qty = 0
    fireEvent.changeText(getByPlaceholderText('Nama Penerima'), 'Budi');
    fireEvent.changeText(getByPlaceholderText('No. Telepon'), '081234567890');
    fireEvent.changeText(getByPlaceholderText('Alamat / Jalan'), 'Jl. Test');
    fireEvent.changeText(getByPlaceholderText('Kota'), 'Jakarta');
    fireEvent.changeText(getByPlaceholderText('Kode Pos'), '10110');
    fireEvent.changeText(getByPlaceholderText('Nama Barang'), 'Item');
    fireEvent.changeText(getByPlaceholderText('Jumlah'), '0');
    fireEvent.changeText(getByPlaceholderText('Harga (IDR)'), '10000');

    fireEvent.press(getByText('Buat Order'));

    await waitFor(() => {
      expect(getByText('Jumlah harus lebih dari 0')).toBeTruthy();
    });

    const { createOrder } = require('../sync/client');
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('qty negatif → validasi block dengan pesan "Jumlah harus lebih dari 0"', async () => {
    const onBack = jest.fn();
    const { getByText, getByPlaceholderText } = render(<OrderCreateScreen onBack={onBack} />);

    // Isi form dengan qty negatif
    fireEvent.changeText(getByPlaceholderText('Nama Penerima'), 'Budi');
    fireEvent.changeText(getByPlaceholderText('No. Telepon'), '081234567890');
    fireEvent.changeText(getByPlaceholderText('Alamat / Jalan'), 'Jl. Test');
    fireEvent.changeText(getByPlaceholderText('Kota'), 'Jakarta');
    fireEvent.changeText(getByPlaceholderText('Kode Pos'), '10110');
    fireEvent.changeText(getByPlaceholderText('Nama Barang'), 'Item');
    fireEvent.changeText(getByPlaceholderText('Jumlah'), '-5');
    fireEvent.changeText(getByPlaceholderText('Harga (IDR)'), '10000');

    fireEvent.press(getByText('Buat Order'));

    await waitFor(() => {
      expect(getByText('Jumlah harus lebih dari 0')).toBeTruthy();
    });

    const { createOrder } = require('../sync/client');
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('harga = 0 → validasi block dengan pesan "Harga satuan harus lebih dari 0"', async () => {
    const onBack = jest.fn();
    const { getByText, getByPlaceholderText } = render(<OrderCreateScreen onBack={onBack} />);

    // Isi form dengan harga = 0
    fireEvent.changeText(getByPlaceholderText('Nama Penerima'), 'Budi');
    fireEvent.changeText(getByPlaceholderText('No. Telepon'), '081234567890');
    fireEvent.changeText(getByPlaceholderText('Alamat / Jalan'), 'Jl. Test');
    fireEvent.changeText(getByPlaceholderText('Kota'), 'Jakarta');
    fireEvent.changeText(getByPlaceholderText('Kode Pos'), '10110');
    fireEvent.changeText(getByPlaceholderText('Nama Barang'), 'Item');
    fireEvent.changeText(getByPlaceholderText('Jumlah'), '2');
    fireEvent.changeText(getByPlaceholderText('Harga (IDR)'), '0');

    fireEvent.press(getByText('Buat Order'));

    await waitFor(() => {
      expect(getByText('Harga satuan harus lebih dari 0')).toBeTruthy();
    });

    const { createOrder } = require('../sync/client');
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('submit dengan field lengkap → createOrder dipanggil dengan payload benar', async () => {
    const { createOrder } = require('../sync/client');
    createOrder.mockResolvedValueOnce({
      id: 'order-123',
      status: 'PENDING',
      customerId: 'user-1',
      items: [],
      deliveryAddress: {},
      totalCents: 25000,
      currency: 'IDR',
      version: 1,
      createdAt: '2026-08-30T00:00:00Z',
      updatedAt: '2026-08-30T00:00:00Z',
    });

    const onBack = jest.fn();
    const { getByPlaceholderText, getByText } = render(
      <OrderCreateScreen onBack={onBack} />
    );

    // Tunggu sampai posisi tampil (bawaan mock).
    await waitFor(() => {
      expect(getByText(/Titik antar: lokasi Anda saat ini/)).toBeTruthy();
    });

    // Isi form
    fireEvent.changeText(getByPlaceholderText('Nama Penerima'), 'Budi Santoso');
    fireEvent.changeText(getByPlaceholderText('No. Telepon'), '081234567890');
    fireEvent.changeText(getByPlaceholderText('Alamat / Jalan'), 'Jl. Merdeka No. 1');
    fireEvent.changeText(getByPlaceholderText('Kota'), 'Jakarta');
    fireEvent.changeText(getByPlaceholderText('Kode Pos'), '10110');
    fireEvent.changeText(getByPlaceholderText('Nama Barang'), 'Nasi Goreng');
    fireEvent.changeText(getByPlaceholderText('Jumlah'), '2');
    fireEvent.changeText(getByPlaceholderText('Harga (IDR)'), '25000');

    // Submit
    fireEvent.press(getByText('Buat Order'));

    // Verify createOrder dipanggil dengan arg yang benar
    await waitFor(() => {
      expect(createOrder).toHaveBeenCalledTimes(1);
    });

    const callArg = createOrder.mock.calls[0][0];
    expect(callArg.items).toHaveLength(1);
    expect(callArg.items[0].name).toBe('Nasi Goreng');
    expect(callArg.items[0].quantity).toBe(2);
    expect(callArg.items[0].unitPriceCents).toBe(25000);
    expect(callArg.deliveryAddress.recipientName).toBe('Budi Santoso');
    expect(callArg.deliveryAddress.phone).toBe('081234567890');
    expect(callArg.deliveryAddress.street).toBe('Jl. Merdeka No. 1');
    expect(callArg.deliveryAddress.city).toBe('Jakarta');
    expect(callArg.deliveryAddress.postalCode).toBe('10110');
    // Koordinat ikut dikirim dengan urutan [lng, lat].
    expect(callArg.deliveryAddress.coordinates).toEqual([115.2167, -8.65]);
  });

  it('submit sukses dengan onCreateSuccess → Alert tombol "Lihat Status", callback dipanggil dengan order.id', async () => {
    const orderId = '12345678-0000-0000-0000-000000000000';
    const { createOrder } = require('../sync/client');
    createOrder.mockResolvedValueOnce({
      id: orderId,
      status: 'PENDING',
      customerId: 'user-1',
      items: [],
      deliveryAddress: {},
      totalCents: 10000,
      currency: 'IDR',
      version: 1,
      createdAt: '2026-08-30T00:00:00Z',
      updatedAt: '2026-08-30T00:00:00Z',
    });

    const onBack = jest.fn();
    const onCreateSuccess = jest.fn();
    const { getByPlaceholderText, getByText } = render(
      <OrderCreateScreen onBack={onBack} onCreateSuccess={onCreateSuccess} />
    );

    // Tunggu sampai lokasi tersedia
    await waitFor(() => {
      expect(getByText(/Titik antar: lokasi Anda saat ini/)).toBeTruthy();
    });

    // Isi minimal form
    fireEvent.changeText(getByPlaceholderText('Nama Penerima'), 'Budi');
    fireEvent.changeText(getByPlaceholderText('No. Telepon'), '081234567890');
    fireEvent.changeText(getByPlaceholderText('Alamat / Jalan'), 'Jl. Test');
    fireEvent.changeText(getByPlaceholderText('Kota'), 'Jakarta');
    fireEvent.changeText(getByPlaceholderText('Kode Pos'), '10110');
    fireEvent.changeText(getByPlaceholderText('Nama Barang'), 'Item');
    fireEvent.changeText(getByPlaceholderText('Harga (IDR)'), '10000');

    fireEvent.press(getByText('Buat Order'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Order Berhasil',
        expect.stringContaining('Order berhasil dibuat'),
        expect.arrayContaining([
          expect.objectContaining({ text: 'Lihat Status' }),
        ])
      );
    });

    // Verify onCreateSuccess dipanggil dengan order.id
    const alertCall = (Alert.alert as jest.Mock).mock.calls[0];
    const buttons = alertCall[2] as Array<{ text: string; onPress: () => void }>;
    const lihatStatusBtn = buttons.find((b) => b.text === 'Lihat Status');
    expect(lihatStatusBtn).toBeDefined();

    // Trigger the button press
    lihatStatusBtn!.onPress();
    expect(onCreateSuccess).toHaveBeenCalledWith(orderId);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('submit sukses tanpa onCreateSuccess, fallback ke tombol "Kembali ke Home"', async () => {
    const { createOrder } = require('../sync/client');
    createOrder.mockResolvedValueOnce({
      id: '12345678-0000-0000-0000-000000000000',
      status: 'PENDING',
      customerId: 'user-1',
      items: [],
      deliveryAddress: {},
      totalCents: 10000,
      currency: 'IDR',
      version: 1,
      createdAt: '2026-08-30T00:00:00Z',
      updatedAt: '2026-08-30T00:00:00Z',
    });

    const onBack = jest.fn();
    const { getByPlaceholderText, getByText } = render(
      <OrderCreateScreen onBack={onBack} />
    );

    await waitFor(() => {
      expect(getByText(/Titik antar: lokasi Anda saat ini/)).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('Nama Penerima'), 'Budi');
    fireEvent.changeText(getByPlaceholderText('No. Telepon'), '081234567890');
    fireEvent.changeText(getByPlaceholderText('Alamat / Jalan'), 'Jl. Test');
    fireEvent.changeText(getByPlaceholderText('Kota'), 'Jakarta');
    fireEvent.changeText(getByPlaceholderText('Kode Pos'), '10110');
    fireEvent.changeText(getByPlaceholderText('Nama Barang'), 'Item');
    fireEvent.changeText(getByPlaceholderText('Harga (IDR)'), '10000');

    fireEvent.press(getByText('Buat Order'));

    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Order Berhasil',
        expect.stringContaining('Order berhasil dibuat'),
        expect.arrayContaining([
          expect.objectContaining({ text: 'Kembali ke Home' }),
        ])
      );
    });
  });

  it('submit gagal → tampil pesan error, form tidak ke-reset', async () => {
    const { createOrder } = require('../sync/client');
    createOrder.mockRejectedValueOnce(new Error('Gagal membuat order: 500 - Server error'));

    const onBack = jest.fn();
    const { getByPlaceholderText, getByText } = render(
      <OrderCreateScreen onBack={onBack} />
    );

    await waitFor(() => {
      expect(getByText(/Titik antar: lokasi Anda saat ini/)).toBeTruthy();
    });

    // Isi form
    fireEvent.changeText(getByPlaceholderText('Nama Penerima'), 'Budi');
    fireEvent.changeText(getByPlaceholderText('No. Telepon'), '081234567890');
    fireEvent.changeText(getByPlaceholderText('Alamat / Jalan'), 'Jl. Test');
    fireEvent.changeText(getByPlaceholderText('Kota'), 'Jakarta');
    fireEvent.changeText(getByPlaceholderText('Kode Pos'), '10110');
    fireEvent.changeText(getByPlaceholderText('Nama Barang'), 'Item');
    fireEvent.changeText(getByPlaceholderText('Harga (IDR)'), '10000');

    // Submit
    fireEvent.press(getByText('Buat Order'));

    // Error harus muncul
    await waitFor(() => {
      expect(getByText('Gagal membuat order: 500 - Server error')).toBeTruthy();
    });

    // Form tidak ke-reset (nama masih ada)
    expect(getByPlaceholderText('Nama Penerima').props.value).toBe('Budi');
  });

  it('double-tap race condition → order hanya di-create sekali', async () => {
    const { createOrder } = require('../sync/client');
    // Simulasi response lambat
    let resolveOrder: (value: unknown) => void;
    createOrder.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOrder = resolve;
        })
    );

    const onBack = jest.fn();
    const { getByPlaceholderText, getByText } = render(
      <OrderCreateScreen onBack={onBack} />
    );

    await waitFor(() => {
      expect(getByText(/Titik antar: lokasi Anda saat ini/)).toBeTruthy();
    });

    // Isi form
    fireEvent.changeText(getByPlaceholderText('Nama Penerima'), 'Budi');
    fireEvent.changeText(getByPlaceholderText('No. Telepon'), '081234567890');
    fireEvent.changeText(getByPlaceholderText('Alamat / Jalan'), 'Jl. Test');
    fireEvent.changeText(getByPlaceholderText('Kota'), 'Jakarta');
    fireEvent.changeText(getByPlaceholderText('Kode Pos'), '10110');
    fireEvent.changeText(getByPlaceholderText('Nama Barang'), 'Item');
    fireEvent.changeText(getByPlaceholderText('Jumlah'), '2');
    fireEvent.changeText(getByPlaceholderText('Harga (IDR)'), '10000');

    // Get the submit button BEFORE tapping (button text changes to "Mengirim..." after first tap)
    const submitButton = getByText('Buat Order');

    // Double-tap: 2x press dalam waktu singkat
    fireEvent.press(submitButton);
    fireEvent.press(submitButton);

    // createOrder harus dipanggil HANYA 1 kali despite double-tap
    // Karena state loading = true setelah tap pertama, tap kedua diabaikan
    expect(createOrder).toHaveBeenCalledTimes(1);

    // Resolve the order to clean up
    resolveOrder!({
      id: 'order-123',
      status: 'PENDING',
      customerId: 'user-1',
      items: [],
      deliveryAddress: {},
      totalCents: 20000,
      currency: 'IDR',
      version: 1,
      createdAt: '2026-08-30T00:00:00Z',
      updatedAt: '2026-08-30T00:00:00Z',
    });
  });

  // Titik antar dari GPS customer.

  it('posisi lat -8.65, lng 115.2167 dikirim sebagai coordinates [115.2167, -8.65]', async () => {
    // Bawaan mock sudah memberi lat -8.65, lng 115.2167.
    const { createOrder } = require('../sync/client');
    createOrder.mockResolvedValueOnce({
      id: 'order-123',
      status: 'PENDING',
      customerId: 'user-1',
      items: [],
      deliveryAddress: {},
      totalCents: 25000,
      currency: 'IDR',
      version: 1,
      createdAt: '2026-08-30T00:00:00Z',
      updatedAt: '2026-08-30T00:00:00Z',
    });

    const onBack = jest.fn();
    const { getByPlaceholderText, getByText } = render(
      <OrderCreateScreen onBack={onBack} />
    );

    // Tunggu sampai posisi tampil di UI
    await waitFor(() => {
      expect(getByText(/Titik antar: lokasi Anda saat ini/)).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('Nama Penerima'), 'Budi');
    fireEvent.changeText(getByPlaceholderText('No. Telepon'), '081234567890');
    fireEvent.changeText(getByPlaceholderText('Alamat / Jalan'), 'Jl. Test');
    fireEvent.changeText(getByPlaceholderText('Kota'), 'Jakarta');
    fireEvent.changeText(getByPlaceholderText('Kode Pos'), '10110');
    fireEvent.changeText(getByPlaceholderText('Nama Barang'), 'Item');
    fireEvent.changeText(getByPlaceholderText('Harga (IDR)'), '10000');

    fireEvent.press(getByText('Buat Order'));

    await waitFor(() => {
      expect(createOrder).toHaveBeenCalledTimes(1);
    });

    const callArg = createOrder.mock.calls[0][0];
    // Urutan [lng, lat]: lat -8.65, lng 115.2167.
    expect(callArg.deliveryAddress.coordinates).toEqual([115.2167, -8.65]);
  });

  it('izin ditolak: submit tidak memanggil createOrder dan menampilkan "Titik antar belum didapat."', async () => {
    mockRequestPermission.mockResolvedValue('denied');
    const { createOrder } = require('../sync/client');
    const onBack = jest.fn();
    const { getByPlaceholderText, getByText } = render(
      <OrderCreateScreen onBack={onBack} />
    );

    // Pesan izin ditolak tampil
    await waitFor(() => {
      expect(
        getByText(/Izin lokasi ditolak\. Titik antar dibutuhkan/)
      ).toBeTruthy();
    });

    // Isi form lengkap
    fireEvent.changeText(getByPlaceholderText('Nama Penerima'), 'Budi');
    fireEvent.changeText(getByPlaceholderText('No. Telepon'), '081234567890');
    fireEvent.changeText(getByPlaceholderText('Alamat / Jalan'), 'Jl. Test');
    fireEvent.changeText(getByPlaceholderText('Kota'), 'Jakarta');
    fireEvent.changeText(getByPlaceholderText('Kode Pos'), '10110');
    fireEvent.changeText(getByPlaceholderText('Nama Barang'), 'Item');
    fireEvent.changeText(getByPlaceholderText('Harga (IDR)'), '10000');

    fireEvent.press(getByText('Buat Order'));

    // Pesan validasi titik antar harus muncul
    await waitFor(() => {
      expect(getByText('Titik antar belum didapat.')).toBeTruthy();
    });

    expect(createOrder).not.toHaveBeenCalled();
  });

  it('tanpa posisi terakhir, teks berganti dari "Mencari lokasi Anda..." ke "Titik antar: ..." saat listener mengirim posisi', async () => {
    mockGetLastKnown.mockResolvedValue(null);
    // Simpan listener supaya tes bisa mengirim posisi sendiri.
    let capturedListener: ((loc: unknown) => void) | null = null;
    mockSubscribe.mockImplementation((listener: (loc: unknown) => void) => {
      capturedListener = listener;
      return Promise.resolve(mockUnsubscribe);
    });

    const onBack = jest.fn();
    const { getByText } = render(<OrderCreateScreen onBack={onBack} />);

    // Awalnya tampil "Mencari lokasi Anda..."
    await waitFor(() => {
      expect(getByText(/Mencari lokasi Anda\.\.\./)).toBeTruthy();
    });

    expect(capturedListener).not.toBeNull();

    // Kirim posisi lewat listener; teks harus berganti.
    await act(async () => {
      capturedListener!({
        coords: { latitude: -8.65, longitude: 115.2167 },
        timestamp: 1000,
      });
    });

    await waitFor(() => {
      expect(getByText(/Titik antar: lokasi Anda saat ini/)).toBeTruthy();
    });
  });

  it('unmount memanggil unsubscribe', async () => {
    const onBack = jest.fn();
    const { unmount } = render(<OrderCreateScreen onBack={onBack} />);

    // Tunggu sampai subscribe dipanggil (bawaan mock).
    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalled();
    });

    // Menutup layar menjalankan cleanup dan melepas listener. Listener
    // bisa baru terdaftar setelah promise subscribe selesai, jadi tunggu
    // sampai unsubscribe benar-benar dipanggil.
    unmount();
    await waitFor(() => {
      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  it('izin ditolak lalu Coba lagi diizinkan: subscribe dipanggil', async () => {
    // Percobaan pertama ditolak.
    mockRequestPermission.mockResolvedValueOnce('denied');
    // Percobaan kedua (setelah Coba lagi) diizinkan.
    mockRequestPermission.mockResolvedValueOnce('granted');

    const onBack = jest.fn();
    const { getByText } = render(<OrderCreateScreen onBack={onBack} />);

    // Tunggu pesan izin ditolak dan tombol Coba lagi muncul.
    await waitFor(() => {
      expect(
        getByText(/Izin lokasi ditolak\. Titik antar dibutuhkan/)
      ).toBeTruthy();
    });

    // Saat izin ditolak, subscribe tidak dipanggil.
    expect(mockSubscribe).not.toHaveBeenCalled();

    fireEvent.press(getByText('Coba lagi'));

    // Tunggu percobaan kedua selesai.
    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalled();
    });
  });

  it('galat titik antar hilang sendiri begitu posisi didapat', async () => {
    mockGetLastKnown.mockResolvedValue(null);
    // Simpan listener supaya tes bisa mengirim posisi sendiri.
    let capturedListener: ((loc: unknown) => void) | null = null;
    mockSubscribe.mockImplementation((listener: (loc: unknown) => void) => {
      capturedListener = listener;
      return Promise.resolve(mockUnsubscribe);
    });

    const onBack = jest.fn();
    const { getByPlaceholderText, getByText, queryByText } = render(
      <OrderCreateScreen onBack={onBack} />
    );

    // Tunggu sampai fase "Mencari lokasi Anda..." tampil.
    await waitFor(() => {
      expect(getByText(/Mencari lokasi Anda\.\.\./)).toBeTruthy();
    });

    // Isi semua field supaya satu-satunya yang gagal validasi adalah titik antar.
    fireEvent.changeText(getByPlaceholderText('Nama Penerima'), 'Budi');
    fireEvent.changeText(getByPlaceholderText('No. Telepon'), '081234567890');
    fireEvent.changeText(getByPlaceholderText('Alamat / Jalan'), 'Jl. Test');
    fireEvent.changeText(getByPlaceholderText('Kota'), 'Jakarta');
    fireEvent.changeText(getByPlaceholderText('Kode Pos'), '10110');
    fireEvent.changeText(getByPlaceholderText('Nama Barang'), 'Item');
    fireEvent.changeText(getByPlaceholderText('Harga (IDR)'), '10000');

    fireEvent.press(getByText('Buat Order'));

    // Galat titik antar tampil, createOrder tidak dipanggil.
    await waitFor(() => {
      expect(getByText('Titik antar belum didapat.')).toBeTruthy();
    });
    const { createOrder } = require('../sync/client');
    expect(createOrder).not.toHaveBeenCalled();

    expect(capturedListener).not.toBeNull();

    // Posisi tiba lewat listener; galat titik antar harus hilang sendiri.
    await act(async () => {
      capturedListener!({
        coords: { latitude: -8.65, longitude: 115.2167 },
        timestamp: 1000,
      });
    });

    expect(queryByText('Titik antar belum didapat.')).toBeNull();
  });

  it('galat titik antar muncul bersama galat isian lain', async () => {
    mockRequestPermission.mockResolvedValue('denied');
    const onBack = jest.fn();
    const { getByText } = render(<OrderCreateScreen onBack={onBack} />);

    // Tunggu sampai pesan izin ditolak tampil.
    await waitFor(() => {
      expect(
        getByText(/Izin lokasi ditolak\. Titik antar dibutuhkan/)
      ).toBeTruthy();
    });

    // Submit dengan semua field kosong: galat isian dan galat titik antar
    // harus tampil bersamaan.
    fireEvent.press(getByText('Buat Order'));

    await waitFor(() => {
      expect(getByText('Nama penerima wajib diisi')).toBeTruthy();
    });
    expect(getByText('Titik antar belum didapat.')).toBeTruthy();
  });
});
