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
 */

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

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

describe('OrderCreateScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('submit sukses tanpa onCreateSuccess → fallback ke tombol "Kembali ke Home" (legacy Tier 2)', async () => {
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
});
