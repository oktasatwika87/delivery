/**
 * Data layar status order untuk customer.
 *
 * Hook ini memegang satu order customer: ambil dari server, ikut perubahan
 * lewat socket, dan ambil ulang kalau perlu. Tidak ada database lokal, jadi
 * kalau server tidak bisa dihubungi, yang tampil tetap data terakhir yang
 * diketahui benar.
 *
 * Versi order dipakai sebagai penanda kesegaran: hasil yang versinya lebih
 * tua dari yang sudah tampil diabaikan, jadi jawaban server yang telat
 * tidak menimpa perubahan yang lebih baru.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { Order } from '@delivery/shared';

import { getOrderById, requestNewDriver, ApiError, UnauthorizedError } from '../sync/client';
import { ordersSocket } from '../sync/ordersSocket';
import type { HasilCariDriverLain } from './customerTrackView';

/** Jeda antar ambil ulang berkala, dalam milidetik. */
export const AMBIL_ULANG_MS = 60 * 1000;

/** Dari mana perubahan data terakhir berasal. */
export type AsalPerubahan = 'awal' | 'pihak_lain' | 'sendiri';

export interface CustomerOrder {
  data: { order: Order; terakhirDiperbarui: number } | null;
  memuat: boolean;
  gagalMemuat: boolean;
  cobaLagi: () => void;
  terputus: boolean;
  tunaiDiterima: boolean;
  asalPerubahan: AsalPerubahan;
  memintaDriverLain: boolean;
  mintaDriverLain: () => Promise<HasilCariDriverLain | null>;
}

export function useCustomerOrder(orderId: string, terlihat: boolean): CustomerOrder {
  const [order, setOrder] = useState<Order | null>(null);
  const [memuat, setMemuat] = useState(true);
  const [gagalMemuat, setGagalMemuat] = useState(false);
  const [terputus, setTerputus] = useState(!ordersSocket.isConnected);
  const [tunaiDiterima, setTunaiDiterima] = useState(false);
  const [asalPerubahan, setAsalPerubahan] = useState<AsalPerubahan>('awal');
  const [terakhirDiperbarui, setTerakhirDiperbarui] = useState(0);
  const [appAktif, setAppAktif] = useState(AppState.currentState === 'active');
  const [memintaDriverLain, setMemintaDriverLain] = useState(false);

  const orderRef = useRef<Order | null>(null);
  const versiTampilRef = useRef(0);
  /** Naik tiap orderId berganti atau hook dilepas, supaya hasil yang telat dibuang. */
  const genRef = useRef(0);
  const orderIdRef = useRef(orderId);
  /** Socket tersambung terakhir yang diketahui, dilacak dari kejadian connect dan disconnect. */
  const socketTersambungRef = useRef(ordersSocket.isConnected);
  /** Berapa kali socket putus, supaya takeover.putus di tengah ambil ulang bisa dikenali. */
  const putusCounterRef = useRef(0);
  /** Ada perubahan yang datang sebelum order pertama tampil, jadi perlu ambil ulang sekali. */
  const perluAmbilUlangRef = useRef(false);
  /** Permintaan minta driver lain yang masih berjalan. */
  const mintaBerjalanRef = useRef(false);

  orderIdRef.current = orderId;

  /**
   * Pakai hasil dari server. Hasil yang versinya lebih tua dari yang sudah
   * tampil diabaikan, tapi waktu pembaruan terakhir tetap diisi karena
   * percobaan ke server tetap kabar bahwa data terakhir kita masih berlaku.
   */
  const pasangDariGet = useCallback((fetched: Order) => {
    setTerakhirDiperbarui(Date.now());

    const naik = fetched.version > versiTampilRef.current;
    if (fetched.version < versiTampilRef.current) return;

    const baruPertama = orderRef.current === null;
    orderRef.current = fetched;
    versiTampilRef.current = fetched.version;
    setOrder(fetched);

    if (baruPertama) {
      setAsalPerubahan('awal');
    } else if (naik) {
      setAsalPerubahan('pihak_lain');
    }
  }, []);

  /** Pakai hasil perubahan dari socket. */
  const pasangDariSocket = useCallback((berikutnya: Order, asal: AsalPerubahan) => {
    orderRef.current = berikutnya;
    versiTampilRef.current = berikutnya.version;
    setOrder(berikutnya);
    setTerakhirDiperbarui(Date.now());
    setAsalPerubahan(asal);
  }, []);

  /**
   * Ambil ulang order. Tidak mengubah status memuat, dan gagalnya diam
   * saja supaya data lama yang tampil tidak hilang.
   */
  const ambilUlang = useCallback(async () => {
    const myGen = genRef.current;
    const mulaiTersambung = socketTersambungRef.current;
    const putusCounterAwal = putusCounterRef.current;

    try {
      const fetched = await getOrderById(orderIdRef.current);
      if (genRef.current !== myGen) return;

      pasangDariGet(fetched);

      // Putus lagi di tengah ambil ulang berarti data yang baru saja kita
      // ambil belum tentu yang paling baru, jadi status terputus tetap.
      if (mulaiTersambung && putusCounterRef.current === putusCounterAwal) {
        setTerputus(false);
      }
    } catch {
      // diam, data lama tetap
    }
  }, [pasangDariGet]);

  /**
   * Pemicu ambil ulang. Kalau order belum pernah tampil, tandai saja,
   * nanti diambil ulang sekali setelah order pertama berhasil dimuat.
   */
  const pemicuAmbilUlang = useCallback(() => {
    if (orderRef.current === null) {
      perluAmbilUlangRef.current = true;
      return;
    }
    void ambilUlang();
  }, [ambilUlang]);

  /** Ambil order dari server untuk pertama kalinya. */
  const muatAwal = useCallback(async () => {
    const myGen = genRef.current;

    setMemuat(true);
    setGagalMemuat(false);

    try {
      const fetched = await getOrderById(orderIdRef.current);
      if (genRef.current !== myGen) return;

      pasangDariGet(fetched);
      setMemuat(false);

      if (perluAmbilUlangRef.current) {
        perluAmbilUlangRef.current = false;
        void ambilUlang();
      }
    } catch (err) {
      if (genRef.current !== myGen) return;
      if (err instanceof UnauthorizedError) {
        // Token tidak berlaku, sesi diakhiri lewat jalur yang sudah ada di
        // App.tsx. Layar tidak menampilkan galat dan tetap di status memuat.
        return;
      }
      setGagalMemuat(true);
      setMemuat(false);
    }
  }, [pasangDariGet, ambilUlang]);

  const cobaLagi = useCallback(() => {
    void muatAwal();
  }, [muatAwal]);

  /**
   * Customer minta driver lain untuk order yang dipegang driver lama.
   *
   * Kalau order belum tampil atau permintaan sebelumnya masih berjalan,
   * fungsi ini mengembalikan null tanpa memanggil server.
   */
  const mintaDriverLain = useCallback(async (): Promise<HasilCariDriverLain | null> => {
    const sekarang = orderRef.current;
    if (!sekarang || mintaBerjalanRef.current) return null;

    const myGen = genRef.current;
    mintaBerjalanRef.current = true;
    setMemintaDriverLain(true);

    try {
      const berikut = await requestNewDriver(sekarang.id, sekarang.version);
      // Jawaban yang datang sesudah hook dilepas atau orderId berganti
      // diabaikan, sama seperti hasil ambil ulang.
      if (genRef.current !== myGen) return 'berhasil';

      setTerakhirDiperbarui(Date.now());

      // Aturan version sama seperti hasil GET: yang lebih tua diabaikan,
      // yang sama tetap dipakai.
      if (berikut.version >= versiTampilRef.current) {
        orderRef.current = berikut;
        versiTampilRef.current = berikut.version;
        setOrder(berikut);
        setAsalPerubahan('sendiri');
      }
      return 'berhasil';
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return 'sesi_berakhir';
      }
      if (err instanceof ApiError && err.status === 409) {
        // Server menolak, ambil ulang supaya layar ikut keadaan sebenarnya.
        if (genRef.current === myGen) {
          void ambilUlang();
        }
        switch (err.code) {
          case 'DRIVER_STILL_REACHABLE':
            return 'driver_tersambung';
          case 'ORDER_NOT_RELEASABLE':
            return 'tidak_bisa_dialihkan';
          case 'VERSION_CONFLICT':
            return 'order_berubah';
          default:
            return 'gagal';
        }
      }
      return 'gagal';
    } finally {
      mintaBerjalanRef.current = false;
      setMemintaDriverLain(false);
    }
  }, [ambilUlang]);

  useEffect(() => {
    genRef.current += 1;
    const myGen = genRef.current;

    orderRef.current = null;
    versiTampilRef.current = 0;
    perluAmbilUlangRef.current = false;
    setOrder(null);
    setMemuat(true);
    setGagalMemuat(false);
    setTunaiDiterima(false);
    setAsalPerubahan('awal');
    setTerakhirDiperbarui(0);
    setMemintaDriverLain(false);

    void muatAwal();

    const terapkanSocket = <T extends { orderId: string; version: number }>(
      payload: T,
      ubah: (sekarang: Order) => Order,
      asal: AsalPerubahan,
    ): void => {
      if (payload.orderId !== orderId) return;
      if (genRef.current !== myGen) return;

      const sekarang = orderRef.current;
      if (!sekarang) {
        // Order belum tampil, jadi perubahannya tidak bisa dipasang sekarang.
        perluAmbilUlangRef.current = true;
        return;
      }

      if (payload.version <= versiTampilRef.current) return;

      pasangDariSocket(ubah(sekarang), asal);
    };

    const unsubAccepted = ordersSocket.onOrderAccepted((payload) => {
      terapkanSocket(payload, (sekarang) => ({
        ...sekarang,
        status: 'PREPARING',
        driverId: payload.driverId,
        version: payload.version,
        cancelledBy: undefined,
        cancelReason: undefined,
        driverUnreachableSince: undefined,
      }), 'pihak_lain');
    });

    const unsubRejected = ordersSocket.onOrderRejected((payload) => {
      terapkanSocket(payload, (sekarang) => ({
        ...sekarang,
        status: payload.status,
        driverId: undefined,
        version: payload.version,
        cancelledBy: undefined,
        cancelReason: undefined,
        driverUnreachableSince: undefined,
      }), 'pihak_lain');
    });

    const unsubCancelled = ordersSocket.onOrderCancelled((payload) => {
      terapkanSocket(payload, (sekarang) => {
        const olehCustomer = payload.reason === 'driver_unreachable';
        return {
          ...sekarang,
          status: payload.status,
          driverId: undefined,
          cancelReason: payload.reason,
          // Server menulis cancelledBy dengan isi yang berbeda tergantung
          // siapa yang melepas order: customer kalau reason driver_unreachable,
          // driver lama kalau driver yang membatalkan.
          cancelledBy: olehCustomer ? sekarang.customerId : sekarang.driverId,
          version: payload.version,
          driverUnreachableSince: undefined,
        };
      }, payload.reason === 'driver_unreachable' ? 'sendiri' : 'pihak_lain');
    });

    const unsubStatusUpdated = ordersSocket.onOrderStatusUpdated((payload) => {
      terapkanSocket(payload, (sekarang) => ({
        ...sekarang,
        status: payload.status,
        updatedAt: payload.updatedAt,
        version: payload.version,
        driverUnreachableSince: undefined,
      }), 'pihak_lain');
    });

    const unsubCodCollected = ordersSocket.onOrderCodCollected((payload) => {
      if (payload.orderId !== orderId) return;
      if (genRef.current !== myGen) return;

      setTunaiDiterima(true);
      setTerakhirDiperbarui(Date.now());

      if (orderRef.current === null) {
        perluAmbilUlangRef.current = true;
      }
    });

    const unsubConnect = ordersSocket.on('connect', () => {
      socketTersambungRef.current = true;
      pemicuAmbilUlang();
    });

    const unsubDisconnect = ordersSocket.on('disconnect', () => {
      socketTersambungRef.current = false;
      putusCounterRef.current += 1;
      setTerputus(true);
      // Sampai detik ini data yang tampil masih yang benar, jadi waktunya
      // diperbarui biar banner terputus tidak berbohong.
      setTerakhirDiperbarui(Date.now());
    });

    const langgananAppState = AppState.addEventListener('change', (status: AppStateStatus) => {
      const aktif = status === 'active';
      setAppAktif(aktif);
      if (aktif) {
        pemicuAmbilUlang();
      }
    });

    return () => {
      genRef.current += 1;
      unsubAccepted();
      unsubRejected();
      unsubCancelled();
      unsubStatusUpdated();
      unsubCodCollected();
      unsubConnect();
      unsubDisconnect();
      langgananAppState.remove();
    };
  }, [orderId, muatAwal, pasangDariSocket, pemicuAmbilUlang]);

  const statusOrder = order?.status;

  useEffect(() => {
    if (!terlihat) return;
    if (!appAktif) return;
    // Pewaktu baru jalan kalau order sudah tampil. Pemicu yang datang
    // sebelum itu ditandai dan diambil ulang sekali sesudah GET pertama
    // berhasil, jadi galat pertama tetap lewat cobaLagi.
    if (statusOrder === undefined) return;
    if (statusOrder !== 'PREPARING' && !terputus) return;

    const timer = setInterval(() => {
      void ambilUlang();
    }, AMBIL_ULANG_MS);

    return () => clearInterval(timer);
  }, [terlihat, appAktif, statusOrder, terputus, ambilUlang]);

  return {
    data: order ? { order, terakhirDiperbarui } : null,
    memuat,
    gagalMemuat,
    cobaLagi,
    terputus,
    tunaiDiterima,
    asalPerubahan,
    memintaDriverLain,
    mintaDriverLain,
  };
}
