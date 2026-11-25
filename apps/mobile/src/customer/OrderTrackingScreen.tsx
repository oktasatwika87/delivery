/**
 * Layar status order untuk customer.
 *
 * Isi order datang dari server dan berubah sendiri kalau ada kabar baru lewat
 * socket. Aturan tampilannya dihitung di customerTrackView, jadi layar ini
 * cuma merangkai: kepala gelap berisi status dan rute, lalu lembar terang
 * berisi rincian order.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent, TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { LinearGradient, Rect, Stop } from 'react-native-svg';

import type { Order } from '@delivery/shared';

import { AppBar } from '../components/AppBar';
import { Banner } from '../components/Banner';
import type { BannerAction } from '../components/Banner';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CashBox } from '../components/CashBox';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { ScreenFrame } from '../components/ScreenFrame';
import { StatusLabel } from '../components/StatusLabel';
import { TrackRoute } from '../components/TrackRoute';
import type { LangkahRute } from '../components/TrackRoute';
import { InitialWindowProvider } from '../components/motion/InitialWindow';
import { formatCurrency } from '../formatCurrency';
import { formatOrderNumber } from '../formatOrderNumber';
import { orderStatusLabel } from '../orderStatusLabel';
import { hapticError } from '../haptics';
import { useNetworkStatus } from '../map/useNetworkStatus';
import { Icon } from '../theme/Icon';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { radius, size, space, stroke, type } from '../theme/tokens';
import { customerTrackView, teksHasilCariDriverLain } from './customerTrackView';
import type { CustomerTrackView } from './customerTrackView';
import { useCustomerOrder } from './useCustomerOrder';

/** Tanda kali di rincian barang. */
const TANDA_KALI = '\u00d7';
/** Titik tengah di baris nama penerima. */
const TITIK_TENGAH = '\u00b7';
/** Tinggi pantulan di atas kepala, biar kepala sedikit melayang. */
const TINGGI_PANTULAN = 1000;
/** Jarak bawah kepala, biar lembar di bawahnya tidak menempel. */
const PADDING_BAWAH_KEPALA = 32;
/** Lebar maksimum judul, supaya tidak kepanjangan di layar lebar. */
const LEBAR_JUDUL = 290;
/** Sisi avatar dan lebar kolom ikon. */
const SISI_IKON = 48;
/** Jarak atas baris barang. */
const ATAS_BARIS_ITEM = 10;
/** Jarak antar isi baris barang. */
const JARAK_BARIS_ITEM = 12;
/** Jarak atas baris catatan. */
const ATAS_CATATAN = 12;
/** Jarak antar isi baris catatan. */
const JARAK_CATATAN = 10;

/** Empat langkah order, dari order dibuat sampai terkirim. */
const LABEL_LANGKAH = [
  'Order dibuat',
  'Driver ditemukan',
  'Dalam perjalanan',
  'Terkirim',
] as const;

/** Keadaan satu label langkah di kepala. */
type StatusLangkah = 'sekarang' | 'selesai' | 'belum';

/** Banner hasil permintaan driver lain. */
interface HasilCari {
  /** Nada banner, ikut dari hasil permintaannya. */
  nada: 'info' | 'danger';
  /** Isi banner. */
  teks: string;
  /** Nomor permintaan, jadi banner baru masuk lagi tiap kali. */
  nomor: number;
}

/** Gaya huruf tiap keadaan label langkah. */
const GAYA_LABEL: Record<StatusLangkah, TextStyle> = {
  sekarang: type.labelSm,
  selesai: type.bodyXs,
  belum: type.bodyXs,
};

/** Id gradasi dibuat unik supaya dua kepala tidak saling menimpa. */
let hitunganGradasi = 0;

export interface OrderTrackingScreenProps {
  orderId: string;
  /** True kalau layar sedang terlihat, dipakai untuk mengatur ambil ulang. */
  terlihat: boolean;
  onBack: () => void;
  onOpenChat: (roomId: string) => void;
}

/**
 * Keadaan satu label langkah. Kalau order dibatalkan, langkah pertama
 * dianggap sudah lewat, sisanya belum.
 */
function statusLangkah(nomor: number, langkah: LangkahRute): StatusLangkah {
  if (langkah === null) return nomor === 1 ? 'selesai' : 'belum';
  if (nomor < langkah) return 'selesai';
  if (nomor === langkah) return 'sekarang';
  return 'belum';
}

/** Isi layar saat order gagal dimuat. */
function IsiGalat({ onCobaLagi }: { onCobaLagi: () => void }): React.JSX.Element {
  const { colors } = useTheme();

  return (
    <View style={styles.galat}>
      <Text style={[styles.judulGalat, { color: colors.text }]}>Gagal memuat order</Text>
      <Text style={[styles.isiGalat, { color: colors.textMuted }]}>
        Cek koneksi internet Anda lalu coba lagi.
      </Text>
      <Button title="Coba lagi" onPress={onCobaLagi} variant="secondary" size="md" />
    </View>
  );
}

/**
 * Kepala layar: status, judul, rute, dan empat label langkah.
 *
 * Isi kepala memakai tema gelap, jadi teksnya tetap terbaca di atas gradasi
 * kepala yang gelap.
 */
function KepalaStatus({
  order,
  view,
}: {
  order: Order;
  view: CustomerTrackView;
}): React.JSX.Element {
  const { colors } = useTheme();
  const [idGradasi] = useState(() => `gradasi-kepala-${hitunganGradasi++}`);
  const [ukuran, setUkuran] = useState<{ lebar: number; tinggi: number } | null>(null);

  const ukur = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setUkuran((sebelumnya) =>
      sebelumnya !== null &&
      sebelumnya.lebar === width &&
      sebelumnya.tinggi === height
        ? sebelumnya
        : { lebar: width, tinggi: height },
    );
  }, []);

  return (
    <View
      testID="kepala-status"
      onLayout={ukur}
      style={[styles.kepala, { backgroundColor: colors.header }]}
    >
      {ukuran ? (
        <Svg style={StyleSheet.absoluteFill} width={ukuran.lebar} height={ukuran.tinggi}>
          <LinearGradient id={idGradasi} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.header} />
            <Stop offset="1" stopColor={colors.headerEnd} />
          </LinearGradient>
          <Rect
            x="0"
            y="0"
            width={ukuran.lebar}
            height={ukuran.tinggi}
            fill={`url(#${idGradasi})`}
          />
        </Svg>
      ) : null}
      <ThemeProvider name="gelap">
        <IsiKepala order={order} view={view} />
      </ThemeProvider>
    </View>
  );
}

/** Isi kepala, selalu di dalam bungkus tema gelap. */
function IsiKepala({
  order,
  view,
}: {
  order: Order;
  view: CustomerTrackView;
}): React.JSX.Element {
  const { colors } = useTheme();

  return (
    <>
      <View style={styles.bagianStatus} accessibilityLiveRegion="polite">
        <StatusLabel
          status={order.status}
          label={orderStatusLabel(order.status)}
          peran="customer"
        />
        <Text accessibilityRole="header" style={[styles.judul, { color: colors.text }]}>
          {view.judul}
        </Text>
      </View>
      <View style={styles.rute}>
        <TrackRoute langkah={view.langkah} />
      </View>
      <BarisLangkah view={view} />
    </>
  );
}

/** Empat label langkah di bawah rute. */
function BarisLangkah({ view }: { view: CustomerTrackView }): React.JSX.Element {
  const { colors } = useTheme();

  return (
    <View style={styles.barisLangkah}>
      {LABEL_LANGKAH.map((label, urutan) => {
        const nomor = urutan + 1;
        const status = statusLangkah(nomor, view.langkah);
        const warna =
          status === 'sekarang'
            ? colors.text
            : status === 'selesai'
              ? colors.textMuted
              : colors.textSubtle;

        return (
          <View key={label} style={styles.satuLangkah}>
            <Text style={[GAYA_LABEL[status], styles.teksLangkah, { color: warna }]}>
              {label}
            </Text>
            {nomor === 1 ? (
              <Text style={[styles.jamDibuat, { color: colors.textSubtle }]}>
                {view.jamDibuat}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Baris orang: sedang mencari driver, atau driver yang sudah ada. */
function BarisOrang({
  order,
  view,
  onOpenChat,
}: {
  order: Order;
  view: CustomerTrackView;
  onOpenChat: (roomId: string) => void;
}): React.JSX.Element {
  const { colors } = useTheme();
  const mencari = view.barisOrang === 'mencari';

  return (
    <View testID="baris-orang" style={styles.barisOrang}>
      <View style={[styles.avatar, { backgroundColor: colors.fillNeutral }]}>
        <Icon
          name={mencari ? 'search' : 'two_wheeler'}
          size={size.iconMd}
          color={colors.text}
        />
      </View>
      <View style={styles.kolomTeks}>
        <Text style={[styles.judulOrang, { color: colors.text }]}>
          {mencari ? 'Mencari driver' : 'Driver Anda'}
        </Text>
        <Text style={[styles.isiOrang, { color: colors.textMuted }]}>
          {mencari
            ? 'Halaman ini berubah sendiri begitu ada driver yang menerima'
            : 'Sudah menerima order ini'}
        </Text>
      </View>
      {view.bolehChat ? (
        <Button
          title="Chat"
          icon="chat"
          size="md"
          variant="primary"
          testID="tombol-chat"
          onPress={() => onOpenChat(order.id)}
        />
      ) : null}
    </View>
  );
}

/** Baris alamat: jalan, kota dan kode pos, nama penerima dan telepon. */
function BarisAlamat({ order }: { order: Order }): React.JSX.Element {
  const { colors } = useTheme();
  const alamat = order.deliveryAddress;
  const kota = [alamat.city, alamat.postalCode]
    .filter((bagian) => bagian.length > 0)
    .join(' ');

  return (
    <View testID="baris-alamat" style={styles.barisAlamat}>
      <View style={styles.kolomIkon}>
        <Icon name="location_on" size={size.iconMd} color={colors.textMuted} />
      </View>
      <View style={styles.kolomTeks}>
        <Text style={[styles.judulAlamat, { color: colors.text }]}>{alamat.street}</Text>
        {kota ? (
          <Text style={[styles.isiAlamat, { color: colors.textMuted }]}>{kota}</Text>
        ) : null}
        <Text style={[styles.isiAlamat, { color: colors.textMuted }]}>
          {`${alamat.recipientName} ${TITIK_TENGAH} ${alamat.phone}`}
        </Text>
      </View>
    </View>
  );
}

/** Rincian order: barang yang dibeli dan catatan. */
function Rincian({ order }: { order: Order }): React.JSX.Element {
  const { colors } = useTheme();

  return (
    <View testID="rincian">
      <Card accessibilityLabel="Rincian">
        <Text
          accessibilityRole="header"
          style={[styles.judulRincian, { color: colors.textSubtle }]}
        >
          Rincian
        </Text>
        {order.items.map((item) => (
          <View key={item.id} style={styles.barisItem}>
            <Text style={[styles.namaBarang, { color: colors.text }]}>
              {item.name}{' '}
              <Text style={{ color: colors.textSubtle }}>
                {`${TANDA_KALI} ${item.quantity}`}
              </Text>
            </Text>
            <Text style={[styles.hargaBarang, { color: colors.text }]}>
              {formatCurrency(item.unitPriceCents * item.quantity, order.currency)}
            </Text>
          </View>
        ))}
        {order.notes ? (
          <View style={styles.barisCatatan}>
            <Icon name="edit_note" size={size.iconMd} color={colors.textSubtle} />
            <Text style={[styles.isiCatatan, { color: colors.textMuted }]}>
              {order.notes}
            </Text>
          </View>
        ) : null}
      </Card>
    </View>
  );
}

/** Isi layar: kepala gelap di atas, lembar terang di bawahnya. */
interface IsiOrderProps {
  order: Order;
  view: CustomerTrackView;
  onOpenChat: (roomId: string) => void;
  /** Banner hasil permintaan driver lain, kalau ada. */
  hasilCari: HasilCari | null;
  /** Menutup banner hasil. */
  onTutupHasilCari: () => void;
  /** Membuka lembar konfirmasi cari driver lain. */
  onBukaCariDriverLain: () => void;
  /** True kalau permintaan driver lain sedang jalan. */
  memintaDriverLain: boolean;
}

function IsiOrder({
  order,
  view,
  onOpenChat,
  hasilCari,
  onTutupHasilCari,
  onBukaCariDriverLain,
  memintaDriverLain,
}: IsiOrderProps): React.JSX.Element {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const aksiCariDriverLain: readonly [BannerAction] = [
    {
      label: 'Cari driver lain',
      onPress: onBukaCariDriverLain,
      loading: memintaDriverLain,
    },
  ];

  return (
    <ScrollView
      style={[styles.gulir, { backgroundColor: colors.surface }]}
      contentContainerStyle={styles.konten}
    >
      <View
        testID="pantulan-kepala"
        pointerEvents="none"
        style={[styles.pantulan, { backgroundColor: colors.header }]}
      />
      <KepalaStatus order={order} view={view} />
      <View
        testID="lembar-status"
        style={[
          styles.lembar,
          {
            backgroundColor: colors.surface,
            paddingBottom: space[6] + insets.bottom,
          },
        ]}
      >
        {view.bannerTerputus ? (
          <Banner
            tone="info"
            icon="sync"
            title={view.bannerTerputus.judul}
            body={view.bannerTerputus.isi}
          />
        ) : null}
        {hasilCari ? (
          <Banner
            key={hasilCari.nomor}
            tone={hasilCari.nada}
            icon={hasilCari.nada === 'info' ? 'info' : undefined}
            body={hasilCari.teks}
            onClose={onTutupHasilCari}
          />
        ) : null}
        {view.bannerLepas ? <Banner tone="info" icon="info" body={view.bannerLepas} /> : null}
        {view.bannerHpDriver ? (
          <Banner
            tone="warning"
            icon="cloud_off"
            title={view.bannerHpDriver.judul}
            body={view.bannerHpDriver.isi}
            actions={aksiCariDriverLain}
          />
        ) : null}
        {view.barisOrang ? (
          <BarisOrang order={order} view={view} onOpenChat={onOpenChat} />
        ) : null}
        {view.barisOrang ? (
          <View
            testID="garis-orang"
            style={[styles.garis, { backgroundColor: colors.line }]}
          />
        ) : null}
        <BarisAlamat order={order} />
        {view.kotakTunai ? (
          <CashBox
            variant={view.kotakTunai}
            amountText={formatCurrency(order.totalCents, order.currency)}
          />
        ) : null}
        {order.items.length > 0 || order.notes ? <Rincian order={order} /> : null}
      </View>
    </ScrollView>
  );
}

export function OrderTrackingScreen({
  orderId,
  terlihat,
  onBack,
  onOpenChat,
}: OrderTrackingScreenProps): React.JSX.Element {
  const {
    data,
    gagalMemuat,
    cobaLagi,
    terputus,
    tunaiDiterima,
    memintaDriverLain,
    mintaDriverLain,
  } = useCustomerOrder(orderId, terlihat);
  const statusJaringan = useNetworkStatus();

  const [lembarCari, setLembarCari] = useState(false);
  const [hasilCari, setHasilCari] = useState<HasilCari | null>(null);
  /** Nomor permintaan, dipakai sebagai kunci banner hasilnya. */
  const hitunganCari = useRef(0);

  const view = data
    ? customerTrackView({
        order: data.order,
        tunaiDiterima,
        terputus,
        terakhirDiperbarui: data.terakhirDiperbarui,
        sekarangMs: Date.now(),
      })
    : null;

  const bolehCariDriverLain = view !== null && view.bolehCariDriverLain;

  // Kalau banner HP driver hilang selagi lembar terbuka, lembarnya ditutup
  // dan keadaan lembar dikosongkan, jadi lembar tidak terbuka sendiri kalau
  // banner itu muncul lagi.
  useEffect(() => {
    if (!bolehCariDriverLain) {
      setLembarCari(false);
    }
  }, [bolehCariDriverLain]);

  const bukaLembarCari = useCallback(() => {
    if (memintaDriverLain) return;
    setLembarCari(true);
  }, [memintaDriverLain]);

  const tutupLembarCari = useCallback(() => {
    setLembarCari(false);
  }, []);

  /** Menutup banner hasil permintaan driver lain. */
  const tutupHasilCari = useCallback(() => {
    setHasilCari(null);
  }, []);

  /**
   * Customer memastikan minta driver lain. Lembar ditutup dulu, lalu
   * permintaan langsung dikirim tanpa menunggu gerak keluar.
   */
  const konfirmasiCariDriverLain = useCallback(() => {
    setLembarCari(false);
    setHasilCari(null);

    void mintaDriverLain().then((hasil) => {
      if (hasil === null) return;
      const teks = teksHasilCariDriverLain(hasil);
      if (teks === null) return;

      hapticError();
      hitunganCari.current += 1;
      setHasilCari({
        nada: teks.nada,
        teks: teks.teks,
        nomor: hitunganCari.current,
      });
    });
  }, [mintaDriverLain]);

  return (
    <ScreenFrame
      header={
        <AppBar
          title="Status order"
          subtitle={formatOrderNumber(orderId)}
          onBack={onBack}
        />
      }
      connection={{ status: statusJaringan, pendingCount: 0, failedCount: 0 }}
    >
      {data && view ? (
        <InitialWindowProvider>
          <IsiOrder
            order={data.order}
            view={view}
            onOpenChat={onOpenChat}
            hasilCari={hasilCari}
            onTutupHasilCari={tutupHasilCari}
            onBukaCariDriverLain={bukaLembarCari}
            memintaDriverLain={memintaDriverLain}
          />
        </InitialWindowProvider>
      ) : gagalMemuat ? (
        <IsiGalat onCobaLagi={cobaLagi} />
      ) : (
        <View style={styles.kosong} />
      )}
      <ConfirmSheet
        visible={lembarCari && bolehCariDriverLain}
        title="Cari driver lain?"
        message="Order dilepas dari driver ini dan ditawarkan lagi ke driver lain."
        confirmLabel="Ya, cari driver lain"
        onConfirm={konfirmasiCariDriverLain}
        onCancel={tutupLembarCari}
      />
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  gulir: {
    flex: 1,
  },
  konten: {
    flexGrow: 1,
  },
  pantulan: {
    position: 'absolute',
    top: -TINGGI_PANTULAN,
    height: TINGGI_PANTULAN,
    left: 0,
    right: 0,
  },
  kepala: {
    paddingBottom: PADDING_BAWAH_KEPALA,
  },
  bagianStatus: {
    paddingTop: space[4],
    paddingHorizontal: space[6],
  },
  judul: {
    ...type.headline,
    marginTop: space[3],
    minHeight: 2 * type.headline.lineHeight,
    maxWidth: LEBAR_JUDUL,
  },
  rute: {
    marginTop: space[4],
  },
  barisLangkah: {
    flexDirection: 'row',
    marginTop: space[3],
    paddingHorizontal: space[6],
  },
  satuLangkah: {
    flex: 1,
    alignItems: 'center',
  },
  teksLangkah: {
    textAlign: 'center',
  },
  jamDibuat: {
    ...type.bodyXs,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  lembar: {
    marginTop: -16,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: space[6],
    gap: space[5],
    flexGrow: 1,
  },
  barisOrang: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  avatar: {
    width: SISI_IKON,
    height: SISI_IKON,
    borderRadius: SISI_IKON / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kolomTeks: {
    flex: 1,
  },
  judulOrang: {
    ...type.titleXs,
  },
  isiOrang: {
    ...type.bodySm,
  },
  garis: {
    height: stroke.hairline,
  },
  barisAlamat: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space[3],
  },
  kolomIkon: {
    width: SISI_IKON,
    alignItems: 'center',
  },
  judulAlamat: {
    ...type.titleXs,
  },
  isiAlamat: {
    ...type.bodySm,
  },
  judulRincian: {
    ...type.labelSm,
  },
  barisItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: JARAK_BARIS_ITEM,
    marginTop: ATAS_BARIS_ITEM,
  },
  namaBarang: {
    ...type.bodyMd,
    flex: 1,
  },
  hargaBarang: {
    ...type.bodyMd,
    fontVariant: ['tabular-nums'],
  },
  barisCatatan: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: JARAK_CATATAN,
    marginTop: ATAS_CATATAN,
  },
  isiCatatan: {
    ...type.bodySm,
    flex: 1,
  },
  galat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[6],
    gap: space[2],
  },
  judulGalat: {
    ...type.titleSm,
  },
  isiGalat: {
    ...type.bodyMd,
  },
  kosong: {
    flex: 1,
  },
});
