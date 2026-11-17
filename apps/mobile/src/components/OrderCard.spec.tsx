/**
 * Tes komponen OrderCard.
 *
 * Ada tiga bentuk kartu: pool untuk order yang tersedia, mine untuk order
 * milik sendiri, dan row untuk baris order di layar customer.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { OrderCard } from './OrderCard';
import { CheckMark } from './motion/CheckMark';
import { Icon } from '../theme/Icon';
import { motion, themes } from '../theme/tokens';

const TITIK_TENGAH = '\u00b7';

describe('OrderCard bentuk pool', () => {
  it('baris order, kota, dan total tampil', () => {
    const { getByText } = render(
      <OrderCard
        variant="pool"
        orderNumber="#1D42E3E2"
        timeText="10 menit lalu"
        city="Bandung"
        amountText="Rp45.000"
        onAccept={() => {}}
      />,
    );
    expect(getByText(`Order #1D42E3E2 ${TITIK_TENGAH} 10 menit lalu`)).toBeTruthy();
    expect(getByText('Bandung')).toBeTruthy();
    expect(getByText('Rp45.000')).toBeTruthy();
  });

  it('kartu memakai isi, sudut, dan tepi kartu', () => {
    const { toJSON } = render(
      <OrderCard
        variant="pool"
        orderNumber="#1D42E3E2"
        timeText="10 menit lalu"
        city="Bandung"
        amountText="Rp45.000"
        onAccept={() => {}}
      />,
    );
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.backgroundColor).toBe(themes.gelap.surface);
    expect(gaya.borderRadius).toBe(18);
    expect(gaya.borderWidth).toBe(1);
    expect(gaya.borderColor).toBe(themes.gelap.lineCard);
    expect(gaya.borderTopColor).toBe(themes.gelap.edgeHighlight);
    expect(gaya.padding).toBe(16);
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

  it('tombol Terima Order selebar kartu', () => {
    const { getByLabelText } = render(
      <OrderCard
        variant="pool"
        orderNumber="#1D42E3E2"
        timeText="10 menit lalu"
        city="Bandung"
        amountText="Rp45.000"
        onAccept={() => {}}
      />,
    );
    const gaya = StyleSheet.flatten(getByLabelText('Terima Order').props.style);
    expect(gaya.width).toBe('100%');
    expect(gaya.height).toBe(52);
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

  it('acceptSuccess menampilkan centang tanpa pemutar walau acceptLoading masih true', () => {
    const { UNSAFE_getByType, UNSAFE_queryByType, getByTestId } = render(
      <OrderCard
        variant="pool"
        orderNumber="#1D42E3E2"
        timeText="10 menit lalu"
        city="Bandung"
        amountText="Rp45.000"
        onAccept={() => {}}
        acceptSuccess
        acceptLoading
      />,
    );
    expect(UNSAFE_getByType(CheckMark)).toBeTruthy();
    expect(UNSAFE_queryByType(ActivityIndicator)).toBeNull();
    expect(StyleSheet.flatten(getByTestId('judul-tombol').props.style).opacity).toBe(0);
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

  it('baris order menampilkan nomor dan waktu', () => {
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
    expect(getByText(`Order #1D42E3E2 ${TITIK_TENGAH} 10 menit lalu`)).toBeTruthy();
  });

  it('tanpa waktu baris order cuma menampilkan nomor', () => {
    const { getByText } = render(
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
    expect(getByText('Order #1D42E3E2')).toBeTruthy();
  });

  it('kartu mine tidak punya panah di kanan', () => {
    const { UNSAFE_getAllByType } = render(
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
    const panah = UNSAFE_getAllByType(Icon).some(
      (ikon) => ikon.props.name === 'chevron_right',
    );
    expect(panah).toBe(false);
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
    fireEvent.press(getByText('Order #1D42E3E2'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('OrderCard lencana sinkron yang bertahan', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('lencana tetap ada dan jadi centang setelah syncState hilang', () => {
    const { rerender, getByTestId, queryByText } = render(
      <OrderCard
        variant="mine"
        orderNumber="#1D42E3E2"
        status="OUT_FOR_DELIVERY"
        statusText="Dalam perjalanan"
        addressMain="Jl. Merdeka 10"
        syncState="pending"
        amountText="Rp45.000"
        onPress={() => {}}
      />,
    );

    rerender(
      <OrderCard
        variant="mine"
        orderNumber="#1D42E3E2"
        status="OUT_FOR_DELIVERY"
        statusText="Dalam perjalanan"
        addressMain="Jl. Merdeka 10"
        amountText="Rp45.000"
        onPress={() => {}}
      />,
    );

    expect(getByTestId('lencana-sinkron')).toBeTruthy();
    expect(queryByText('Menunggu sinkronisasi')).toBeNull();
  });

  it('lencana hilang setelah centang ditahan selesai', () => {
    const { rerender, queryByTestId } = render(
      <OrderCard
        variant="mine"
        orderNumber="#1D42E3E2"
        status="OUT_FOR_DELIVERY"
        statusText="Dalam perjalanan"
        addressMain="Jl. Merdeka 10"
        syncState="pending"
        amountText="Rp45.000"
        onPress={() => {}}
      />,
    );

    rerender(
      <OrderCard
        variant="mine"
        orderNumber="#1D42E3E2"
        status="OUT_FOR_DELIVERY"
        statusText="Dalam perjalanan"
        addressMain="Jl. Merdeka 10"
        amountText="Rp45.000"
        onPress={() => {}}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(motion.duration.holdDone);
    });

    expect(queryByTestId('lencana-sinkron')).toBeNull();
  });
});

describe('OrderCard bentuk row', () => {
  it('baris order, alamat, label status, dan total tampil', () => {
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
    expect(getByText(`Order #1D42E3E2 ${TITIK_TENGAH} 29 Okt 2026`)).toBeTruthy();
    expect(getByText('Jl. Merdeka 10')).toBeTruthy();
    expect(getByText('Selesai')).toBeTruthy();
    expect(getByText('Rp45.000')).toBeTruthy();
  });

  it('baris order di layar customer memakai tema terang', () => {
    const { getByText, toJSON } = render(
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
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.backgroundColor).toBe(themes.terang.surface);
    expect(gaya.elevation).toBe(1);
    expect(StyleSheet.flatten(getByText('Rp45.000').props.style).color).toBe(
      themes.terang.text,
    );
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
    fireEvent.press(getByText(`Order #1D42E3E2 ${TITIK_TENGAH} 29 Okt 2026`));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
