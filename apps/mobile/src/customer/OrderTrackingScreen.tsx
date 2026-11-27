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
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

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
import { InitialWindowProvider, useInitialWindow } from '../components/motion/InitialWindow';
import { exitEasing, fadeIn, fadeOut, geserTinggi } from '../components/motion/presets';
import { useGantiIsi } from '../components/motion/useGantiIsi';
import { formatCurrency } from '../formatCurrency';
import { formatOrderNumber } from '../formatOrderNumber';
import { orderStatusLabel } from '../orderStatusLabel';
import { hapticError } from '../haptics';
import { useNetworkStatus } from '../map/useNetworkStatus';
import { Icon } from '../theme/Icon';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { motion, radius, size, space, stroke, type } from '../theme/tokens';
import { customerTrackView, teksHasilCariDriverLain } from './customerTrackView';
import type { CustomerTrackView } from './customerTrackView';
import { useCustomerOrder } from './useCustomerOrder';
import type { AsalPerubahan } from './useCustomerOrder';

/** Tanda kali di rincian barang. */
const TANDA_KALI = '\u00d7';
/** Titik tengah di baris nama penerima. */
const TITIK_TENGAH = '\u00b7';
/**
 * Tinggi lapisan berwarna kepala di atas isi, supaya pantulan gulir iOS di
 * atas kepala tetap gelap.
 */
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
/** Gerak tinggi wadah judul kepala dan isi lembar saat isinya berubah. */
const GESER_TINGGI = geserTinggi();
/** Judul kepala pudar masuk. */
const MASUK_JUDUL = fadeIn();
/** Isi baris orang pudar masuk. */
const MASUK_ORANG = fadeIn();
/** Baris orang dan garis yang hilang pudar keluar. */
const KELUAR_PUDAR = fadeOut();
/** Batas sorotan baris orang dari isi barisnya, di atas dan bawah. */
const SOROTAN_ATAS = -8;
/** Batas sorotan baris orang dari isi barisnya, di kiri dan kanan. */
const SOROTAN_SAMPING = -12;
/**
 * Batas aman tahanan tampilan, dalam milidetik.
 *
 * Kalau lembar belum lepas dalam waktu ini, tahanan dilepas juga, supaya
 * layar tidak tertahan selamanya.
 */
export const BATAS_TAHAN_MS = 1000;

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

/**
 * Tampilan yang ditahan selama lembar keluar lewat Ya.
 *
 * Isi layar dibekukan supaya tidak berubah di tengah gerak motor. Order,
 * banner, asal perubahannya, dan banner hasil ikut dibekukan, karena
 * semuanya turun dari isi yang sama.
 */
interface TahanLayar {
  order: Order;
  view: CustomerTrackView;
  asalPerubahan: AsalPerubahan;
  hasilCari: HasilCari | null;
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

/**
 * Judul kepala yang sedang pudar keluar.
 *
 * Lapisan ini digambar absolute di atas judul baru, jadi tidak bisa diketuk dan
 * tidak dibaca pembaca layar.
 */
interface JudulLamaProps {
  judul: string;
  /** Nomor pergantian yang sedang ditutup. */
  nomor: number;
  /** Dipanggil saat judul lama selesai pudar. */
  selesai: (nomor: number) => void;
}

function JudulLama({ judul, nomor, selesai }: JudulLamaProps): React.JSX.Element {
  const { colors } = useTheme();
  const opasitas = useSharedValue(1);

  useEffect(() => {
    opasitas.value = withTiming(
      0,
      { duration: motion.duration.fadeOut, easing: exitEasing },
      (habis) => {
        if (habis) {
          runOnJS(selesai)(nomor);
        }
      },
    );
  }, [nomor, opasitas, selesai]);

  const gaya = useAnimatedStyle(() => ({ opacity: opasitas.value }));

  return (
    <Animated.View
      testID="judul-lama"
      style={[styles.judulLama, gaya]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text accessibilityRole="header" style={[styles.judul, { color: colors.text }]}>
        {judul}
      </Text>
    </Animated.View>
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
  const dalamJendela = useInitialWindow();
  const ganti = useGantiIsi(view.judul, view.judul);

  return (
    <>
      <View style={styles.bagianStatus} accessibilityLiveRegion="polite">
        <StatusLabel
          status={order.status}
          label={orderStatusLabel(order.status)}
          peran="customer"
        />
        <Animated.View
          testID="wadah-judul"
          style={styles.wadahJudul}
          layout={dalamJendela ? undefined : GESER_TINGGI}
        >
          <Animated.View
            key={ganti.nomor}
            entering={ganti.nomor > 0 ? MASUK_JUDUL : undefined}
            testID="judul-baru"
          >
            <Text accessibilityRole="header" style={[styles.judul, { color: colors.text }]}>
              {view.judul}
            </Text>
          </Animated.View>
          {ganti.lama !== null ? (
            <JudulLama
              key={`lama-${ganti.nomor}`}
              judul={ganti.lama}
              nomor={ganti.nomor}
              selesai={ganti.selesai}
            />
          ) : null}
        </Animated.View>
      </View>
      <Animated.View
        testID="wadah-rute"
        style={styles.rute}
        layout={dalamJendela ? undefined : GESER_TINGGI}
      >
        <TrackRoute langkah={view.langkah} />
      </Animated.View>
      <Animated.View
        testID="baris-label-langkah"
        style={styles.barisLangkah}
        layout={dalamJendela ? undefined : GESER_TINGGI}
      >
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
                <Text style={[GAYA_LABEL[status], styles.jamDibuat, { color: warna }]}>
                  {view.jamDibuat}
                </Text>
              ) : null}
            </View>
          );
        })}
      </Animated.View>
    </>
  );
}

/** Isi baris orang: avatar, keterangan, dan tombol chat. */
interface IsiBarisOrangProps {
  jenis: 'mencari' | 'driver';
  bolehChat: boolean;
  order: Order;
  onOpenChat: (roomId: string) => void;
}

function IsiBarisOrang({
  jenis,
  bolehChat,
  order,
  onOpenChat,
}: IsiBarisOrangProps): React.JSX.Element {
  const { colors } = useTheme();
  const mencari = jenis === 'mencari';

  return (
    <>
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
      {bolehChat ? (
        <Button
          title="Chat"
          icon="chat"
          size="md"
          variant="primary"
          testID="tombol-chat"
          onPress={() => onOpenChat(order.id)}
        />
      ) : null}
    </>
  );
}

/**
 * Ukuran isi baris orang.
 *
 * Dipakai untuk mengunci isi lama, supaya isinya tidak ditata ulang waktu
 * isi baru dipasang.
 */
interface UkuranIsi {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Isi baris orang yang sedang pudar keluar.
 *
 * Lapisan ini digambar absolute di atas isi baru, jadi tidak bisa diketuk dan
 * tidak dibaca pembaca layar. Ukurannya dikunci dari ukuran isi sebelum
 * perubahan, jadi teksnya tidak membungkus ulang dan tidak turun ke bawah
 * avatar.
 */
interface OrangLamaProps {
  isi: { jenis: 'mencari' | 'driver'; bolehChat: boolean };
  /** Ukuran isi sebelum perubahan, dikunci dari render pertama. */
  ukuran: UkuranIsi | null;
  order: Order;
  onOpenChat: (roomId: string) => void;
  /** Nomor pergantian yang sedang ditutup. */
  nomor: number;
  /** Dipanggil saat isi lama selesai pudar. */
  selesai: (nomor: number) => void;
}

function OrangLama({
  isi,
  ukuran,
  order,
  onOpenChat,
  nomor,
  selesai,
}: OrangLamaProps): React.JSX.Element {
  const opasitas = useSharedValue(1);

  // Ukuran dikunci dari render pertama. Isi lama dibuat bareng isi baru,
  // jadi ukuran yang tersimpan masih ukuran isi yang digantikan.
  const [beku] = useState(ukuran);

  useEffect(() => {
    opasitas.value = withTiming(
      0,
      { duration: motion.duration.fadeOut, easing: exitEasing },
      (habis) => {
        if (habis) {
          runOnJS(selesai)(nomor);
        }
      },
    );
  }, [nomor, opasitas, selesai]);

  const gaya = useAnimatedStyle(() => ({ opacity: opasitas.value }));

  return (
    <Animated.View
      testID="orang-lama"
      style={[
        styles.orangLama,
        beku !== null
          ? { left: beku.x, top: beku.y, width: beku.width, height: beku.height }
          : null,
        gaya,
      ]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <IsiBarisOrang
        jenis={isi.jenis}
        bolehChat={isi.bolehChat}
        order={order}
        onOpenChat={onOpenChat}
      />
    </Animated.View>
  );
}

/**
 * Lapisan sorot di belakang isi baris orang.
 *
 * Sorot muncul utuh lalu memudar habis, jadi mata sempat menangkap isi baru
 * itu sebelum sorotannya hilang.
 */
function SorotanOrang({
  nomor,
  selesai,
}: {
  nomor: number;
  selesai: (nomor: number) => void;
}): React.JSX.Element {
  const { colors } = useTheme();
  const opasitas = useSharedValue(1);

  useEffect(() => {
    opasitas.value = withTiming(
      0,
      { duration: motion.duration.highlight, easing: exitEasing },
      (habis) => {
        if (habis) {
          runOnJS(selesai)(nomor);
        }
      },
    );
  }, [nomor, opasitas, selesai]);

  const gaya = useAnimatedStyle(() => ({ opacity: opasitas.value }));

  return (
    <Animated.View
      testID="sorotan-orang"
      pointerEvents="none"
      style={[
        styles.sorotanOrang,
        { backgroundColor: colors.infoWash },
        gaya,
      ]}
    />
  );
}

/** Baris orang: sedang mencari driver, atau driver yang sudah ada. */
interface BarisOrangProps {
  jenis: 'mencari' | 'driver';
  bolehChat: boolean;
  asalPerubahan: AsalPerubahan;
  order: Order;
  onOpenChat: (roomId: string) => void;
}

/**
 * Keputusan sorotan baris orang.
 *
 * NomorDiputuskan adalah nomor pergantian terakhir yang sudah diputuskan,
 * jadi keputusan baru diambil hanya kalau nomornya beda. Aktif adalah nomor
 * pergantian yang sorotannya masih jalan.
 */
interface SorotanBaris {
  /** Nomor pergantian terakhir yang sudah diputuskan. */
  nomorDiputuskan: number;
  /** Nomor pergantian yang sorotannya masih jalan, null kalau tidak ada. */
  aktif: number | null;
}

function BarisOrang({
  jenis,
  bolehChat,
  asalPerubahan,
  order,
  onOpenChat,
}: BarisOrangProps): React.JSX.Element {
  const ganti = useGantiIsi({ jenis, bolehChat }, `${jenis}|${bolehChat}`);
  /** Ukuran isi baris orang terakhir, dipakai untuk mengunci isi lama. */
  const [ukuranIsi, setUkuranIsi] = useState<UkuranIsi | null>(null);
  /** Keputusan sorotan, dihitung dari nomor pergantian isinya. */
  const [sorotan, setSorotan] = useState<SorotanBaris>({
    nomorDiputuskan: ganti.nomor,
    aktif: null,
  });

  const ukurIsi = useCallback((peristiwa: LayoutChangeEvent) => {
    const { x, y, width, height } = peristiwa.nativeEvent.layout;
    setUkuranIsi((sebelumnya) =>
      sebelumnya !== null &&
      sebelumnya.x === x &&
      sebelumnya.y === y &&
      sebelumnya.width === width &&
      sebelumnya.height === height
        ? sebelumnya
        : { x, y, width, height },
    );
  }, []);

  // Keputusannya dihitung saat render, bukan di efek, jadi sorot langsung
  // muncul bersama pergantian isinya. Satu nomor pergantian hanya diputuskan
  // sekali, jadi isi baris yang tidak berubah tidak memasang sorot baru.
  // Pergantian karena tindakan sendiri juga menghentikan sorotan yang
  // masih jalan.
  if (ganti.nomor !== sorotan.nomorDiputuskan) {
    setSorotan({
      nomorDiputuskan: ganti.nomor,
      aktif: asalPerubahan === 'pihak_lain' ? ganti.nomor : null,
    });
  }

  const selesaiSorotan = useCallback((nomor: number) => {
    setSorotan((sekarang) =>
      sekarang.aktif === nomor ? { ...sekarang, aktif: null } : sekarang,
    );
  }, []);

  return (
    <View testID="baris-orang" style={styles.barisOrang}>
      {sorotan.aktif !== null ? (
        <SorotanOrang
          key={`sorotan-${sorotan.aktif}`}
          nomor={sorotan.aktif}
          selesai={selesaiSorotan}
        />
      ) : null}
      <Animated.View
        key={ganti.nomor}
        entering={ganti.nomor > 0 ? MASUK_ORANG : undefined}
        onLayout={ukurIsi}
        testID="isi-baris-orang"
        style={styles.barisOrangIsi}
      >
        <IsiBarisOrang
          jenis={jenis}
          bolehChat={bolehChat}
          order={order}
          onOpenChat={onOpenChat}
        />
      </Animated.View>
      {ganti.lama !== null ? (
        <OrangLama
          key={`lama-${ganti.nomor}`}
          isi={ganti.lama}
          ukuran={ukuranIsi}
          order={order}
          onOpenChat={onOpenChat}
          nomor={ganti.nomor}
          selesai={ganti.selesai}
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
  asalPerubahan: AsalPerubahan;
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
  asalPerubahan,
  onOpenChat,
  hasilCari,
  onTutupHasilCari,
  onBukaCariDriverLain,
  memintaDriverLain,
}: IsiOrderProps): React.JSX.Element {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const dalamJendela = useInitialWindow();

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
      <Animated.View
        testID="lembar-status"
        layout={dalamJendela ? undefined : GESER_TINGGI}
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
          <Animated.View
            testID="anak-lembar"
            layout={dalamJendela ? undefined : GESER_TINGGI}
            exiting={dalamJendela ? undefined : KELUAR_PUDAR}
          >
            <BarisOrang
              jenis={view.barisOrang}
              bolehChat={view.bolehChat}
              asalPerubahan={asalPerubahan}
              order={order}
              onOpenChat={onOpenChat}
            />
          </Animated.View>
        ) : null}
        {view.barisOrang ? (
          <Animated.View
            testID="anak-lembar"
            layout={dalamJendela ? undefined : GESER_TINGGI}
            exiting={dalamJendela ? undefined : KELUAR_PUDAR}
          >
            <View
              testID="garis-orang"
              style={[styles.garis, { backgroundColor: colors.line }]}
            />
          </Animated.View>
        ) : null}
        <Animated.View
          testID="anak-lembar"
          layout={dalamJendela ? undefined : GESER_TINGGI}
        >
          <BarisAlamat order={order} />
        </Animated.View>
        {view.kotakTunai ? (
          <Animated.View
            testID="anak-lembar"
            layout={dalamJendela ? undefined : GESER_TINGGI}
          >
            <CashBox
              variant={view.kotakTunai}
              amountText={formatCurrency(order.totalCents, order.currency)}
            />
          </Animated.View>
        ) : null}
        {order.items.length > 0 || order.notes ? (
          <Animated.View
            testID="anak-lembar"
            layout={dalamJendela ? undefined : GESER_TINGGI}
          >
            <Rincian order={order} />
          </Animated.View>
        ) : null}
      </Animated.View>
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
    asalPerubahan,
    memintaDriverLain,
    mintaDriverLain,
  } = useCustomerOrder(orderId, terlihat);
  const statusJaringan = useNetworkStatus();

  const [lembarCari, setLembarCari] = useState(false);
  const [hasilCari, setHasilCari] = useState<HasilCari | null>(null);
  /** Nomor permintaan, dipakai sebagai kunci banner hasilnya. */
  const hitunganCari = useRef(0);
  /** Tampilan yang ditahan selama lembar keluar lewat Ya. */
  const [tahan, setTahan] = useState<TahanLayar | null>(null);
  /** Pewaktu batas aman tahanan, dibersihkan waktu tahanan lepas. */
  const batasTahanRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const view = data
    ? customerTrackView({
        order: data.order,
        tunaiDiterima,
        terputus,
        terakhirDiperbarui: data.terakhirDiperbarui,
        sekarangMs: Date.now(),
      })
    : null;

  /**
   * Menahan tampilan terakhir sampai lembar keluar selesai.
   *
   * Nilai yang ditangkap di sini adalah nilai render terakhir, jadi yang
   * ditahan benar-benar tampilan sebelum tombol Ya ditekan. Perubahan data
   * yang masuk selama ditahan belum ikut terpasang.
   */
  const mulaiTahan = useCallback(() => {
    if (data === null || view === null) return;
    setTahan({ order: data.order, view, asalPerubahan, hasilCari });
    if (batasTahanRef.current !== null) clearTimeout(batasTahanRef.current);
    batasTahanRef.current = setTimeout(() => {
      setTahan(null);
    }, BATAS_TAHAN_MS);
  }, [data, view, asalPerubahan, hasilCari]);

  /** Melepas tahanan tampilan, dipakai waktu lembar sudah dilepas. */
  const selesaiTahan = useCallback(() => {
    if (batasTahanRef.current !== null) {
      clearTimeout(batasTahanRef.current);
      batasTahanRef.current = null;
    }
    setTahan(null);
  }, []);

  useEffect(
    () => () => {
      if (batasTahanRef.current !== null) clearTimeout(batasTahanRef.current);
    },
    [],
  );

  const bolehCariDriverLain = view !== null && view.bolehCariDriverLain;

  // Hasil bernada danger dibuang begitu cari driver lain tidak lagi boleh,
  // jadi banner galat lamanya tidak muncul lagi waktu cari driver lain
  // boleh lagi. Hasil bernada info tetap tampil sampai ditutup sendiri.
  if (!bolehCariDriverLain && hasilCari !== null && hasilCari.nada === 'danger') {
    setHasilCari(null);
  }

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

  /**
   * Menahan tampilan terakhir sampai lembar keluar selesai.
   *
   * Data yang masuk selama ditahan belum ikut terpasang. Setelah tahanan
   * lepas, data terbaru langsung terpasang sekali.
   */
  const orderTampil = tahan !== null ? tahan.order : data?.order ?? null;
  const viewTampil = tahan !== null ? tahan.view : view;
  const asalTampil = tahan !== null ? tahan.asalPerubahan : asalPerubahan;
  const hasilTampil = tahan !== null ? tahan.hasilCari : hasilCari;

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
      peran="customer"
    >
      {orderTampil !== null && viewTampil !== null ? (
        <InitialWindowProvider>
          <IsiOrder
            order={orderTampil}
            view={viewTampil}
            asalPerubahan={asalTampil}
            onOpenChat={onOpenChat}
            hasilCari={hasilTampil}
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
        onMulaiKeluar={mulaiTahan}
        onSelesaiKeluar={selesaiTahan}
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
  wadahJudul: {
    marginTop: space[3],
  },
  judul: {
    ...type.headline,
    minHeight: 2 * type.headline.lineHeight,
    maxWidth: LEBAR_JUDUL,
  },
  judulLama: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  rute: {
    marginTop: space[4],
  },
  barisLangkah: {
    flexDirection: 'row',
  },
  satuLangkah: {
    flex: 1,
    alignItems: 'center',
  },
  teksLangkah: {
    textAlign: 'center',
  },
  jamDibuat: {
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
  barisOrangIsi: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    flex: 1,
  },
  orangLama: {
    position: 'absolute',
    top: 0,
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
  },
  sorotanOrang: {
    position: 'absolute',
    top: SOROTAN_ATAS,
    bottom: SOROTAN_ATAS,
    left: SOROTAN_SAMPING,
    right: SOROTAN_SAMPING,
    borderRadius: radius.lg,
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
    alignItems: 'center',
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
