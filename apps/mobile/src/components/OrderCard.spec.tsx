/**
 * Tes komponen OrderCard.
 *
 * Ada tiga bentuk kartu: pool untuk order yang tersedia, mine untuk order
 * milik sendiri, dan row untuk baris order di layar customer.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { OrderCard } from './OrderCard';

describe('OrderCard bentuk pool', () => {
  it('nomor, waktu, kota, total, dan keterangan tampil', () => {
    const { getByText } = render(
      <OrderCard
        variant="pool"
        orderNumber="#1D42E3E2"
        timeText="10 menit lalu"
        city="Bandung"
        amountText="Rp45.000"
        amountCaption="Termasuk ongkir"
        onAccept={() => {}}
      />,
    );
    expect(getByText('ORDER #1D42E3E2')).toBeTruthy();
    expect(getByText('10 menit lalu')).toBeTruthy();
    expect(getByText('Bandung')).toBeTruthy();
    expect(getByText('Rp45.000')).toBeTruthy();
    expect(getByText('Termasuk ongkir')).toBeTruthy();
  });

  it('tanpa kota menampilkan pesan bahwa alamat belum ada', () => {
    const { getByText } = render(
      <OrderCard
        variant="pool"
        orderNumber="#1D42E3E2"
        timeText="10 menit lalu"
        city={null}
        amountText="Rp45.000"
        onAccept={() => {}}
      />,
    );
    expect(getByText('Alamat tampil setelah order diterima')).toBeTruthy();
  });

  it('tekan Terima Order memanggil onAccept dan bukan onPress kartu', () => {
    const onAccept = jest.fn();
    const onPress = jest.fn();
    const { getByLabelText } = render(
      <OrderCard
        variant="pool"
        orderNumber="#1D42E3E2"
        timeText="10 menit lalu"
        city="Bandung"
        amountText="Rp45.000"
        onAccept={onAccept}
        onPress={onPress}
      />,
    );
    fireEvent.press(getByLabelText('Terima Order'));
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('acceptDisabled membuat tekan Terima tidak memanggil onAccept', () => {
    const onAccept = jest.fn();
    const { getByLabelText } = render(
      <OrderCard
        variant="pool"
        orderNumber="#1D42E3E2"
        timeText="10 menit lalu"
        city="Bandung"
        amountText="Rp45.000"
        onAccept={onAccept}
        acceptDisabled
      />,
    );
    fireEvent.press(getByLabelText('Terima Order'));
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('acceptHelp tampil', () => {
    const { getByText } = render(
      <OrderCard
        variant="pool"
        orderNumber="#1D42E3E2"
        timeText="10 menit lalu"
        city="Bandung"
        amountText="Rp45.000"
        onAccept={() => {}}
        acceptHelp="Order ini sudah diambil kurir lain"
      />,
    );
    expect(getByText('Order ini sudah diambil kurir lain')).toBeTruthy();
  });
});

describe('OrderCard bentuk mine', () => {
  it('label status, alamat, dan lencana sinkronisasi tampil', () => {
    const { getByText } = render(
      <OrderCard
        variant="mine"
        orderNumber="#1D42E3E2"
        status="OUT_FOR_DELIVERY"
        statusText="Dalam perjalanan"
        addressMain="Jl. Merdeka 10"
        addressSub="RT 04 RW 05"
        syncState="pending"
        amountText="Rp45.000"
        onPress={() => {}}
      />,
    );
    expect(getByText('Dalam perjalanan')).toBeTruthy();
    expect(getByText('Jl. Merdeka 10')).toBeTruthy();
    expect(getByText('Menunggu sinkronisasi')).toBeTruthy();
  });

  it('tanpa syncState tidak ada lencana sinkronisasi', () => {
    const { queryByText } = render(
      <OrderCard
        variant="mine"
        orderNumber="#1D42E3E2"
        status="DELIVERED"
        statusText="Selesai"
        addressMain="Jl. Merdeka 10"
        amountText="Rp45.000"
        onPress={() => {}}
      />,
    );
    expect(queryByText('Menunggu sinkronisasi')).toBeNull();
  });

  it('timeText tampil kalau ada', () => {
    const { getByText } = render(
      <OrderCard
        variant="mine"
        orderNumber="#1D42E3E2"
        status="DELIVERED"
        statusText="Selesai"
        addressMain="Jl. Merdeka 10"
        amountText="Rp45.000"
        timeText="10 menit lalu"
        onPress={() => {}}
      />,
    );
    expect(getByText('10 menit lalu')).toBeTruthy();
  });

  it('tekan kartu memanggil onPress', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <OrderCard
        variant="mine"
        orderNumber="#1D42E3E2"
        status="DELIVERED"
        statusText="Selesai"
        addressMain="Jl. Merdeka 10"
        amountText="Rp45.000"
        onPress={onPress}
      />,
    );
    fireEvent.press(getByText('ORDER #1D42E3E2'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('OrderCard bentuk row', () => {
  it('nomor, alamat, tanggal, label status, dan total tampil', () => {
    const { getByText } = render(
      <OrderCard
        variant="row"
        orderNumber="#1D42E3E2"
        dateText="29 Okt 2026"
        addressText="Jl. Merdeka 10"
        status="DELIVERED"
        statusText="Selesai"
        amountText="Rp45.000"
        onPress={() => {}}
      />,
    );
    expect(getByText('#1D42E3E2')).toBeTruthy();
    expect(getByText('Jl. Merdeka 10')).toBeTruthy();
    expect(getByText('29 Okt 2026')).toBeTruthy();
    expect(getByText('Selesai')).toBeTruthy();
    expect(getByText('Rp45.000')).toBeTruthy();
  });

  it('tanpa addressText tidak merender baris alamat', () => {
    const { queryByText } = render(
      <OrderCard
        variant="row"
        orderNumber="#1D42E3E2"
        dateText="29 Okt 2026"
        status="DELIVERED"
        statusText="Selesai"
        amountText="Rp45.000"
        onPress={() => {}}
      />,
    );
    expect(queryByText('Jl. Merdeka 10')).toBeNull();
  });

  it('tekan baris memanggil onPress', () => {
    const onPress = jest.fn();
    const { getByText } = render(
      <OrderCard
        variant="row"
        orderNumber="#1D42E3E2"
        dateText="29 Okt 2026"
        status="DELIVERED"
        statusText="Selesai"
        amountText="Rp45.000"
        onPress={onPress}
      />,
    );
    fireEvent.press(getByText('#1D42E3E2'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
