/**
 * Rute langkah order.
 *
 * Menempatkan order di antara empat langkah yang dihubungkan lewat satu rute
 * melengkung. Yang bergerak di sini: riak berdenyut selama order masih
 * mencari driver, garis biru menunjukkan bagian rute yang sudah dilalui, dan
 * motor muncul di titik langkah yang sedang berjalan.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Path, type CircleProps, type PathProps } from 'react-native-svg';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { Icon } from '../theme/Icon';
import { useTheme } from '../theme/ThemeProvider';
import { motion, size, stroke, type ThemeColors } from '../theme/tokens';
import { useInitialWindow } from './motion/InitialWindow';
import { fadeIn, fadeOut, motorEasing, standardEasing } from './motion/presets';

/** Langkah order di rute. Null berarti order dibatalkan. */
export type LangkahRute = 1 | 2 | 3 | 4 | null;

interface Titik {
  x: number;
  y: number;
}

/** Ukuran gambar dalam satuan viewBox. */
const LEBAR_VB = 360;
const TINGGI_VB = 88;

/** Empat titik rute, dari awal sampai akhir. */
const TITIK: Titik[] = [
  { x: 45, y: 52 },
  { x: 135, y: 32 },
  { x: 225, y: 60 },
  { x: 315, y: 38 },
];

/** Tiga lengkung kubik, masing-masing dari satu titik ke titik berikutnya. */
const LENGKUNG: Titik[][] = [
  [TITIK[0], { x: 80, y: 52 }, { x: 100, y: 30 }, TITIK[1]],
  [TITIK[1], { x: 172, y: 34 }, { x: 190, y: 62 }, TITIK[2]],
  [TITIK[2], { x: 260, y: 58 }, { x: 280, y: 36 }, TITIK[3]],
];

/** Jumlah potong garis lurus per lengkung saat panjangnya dihitung. */
const POTONG = 64;

/** Titik pada lengkung kubik untuk nilai t tertentu. */
function titikKubik(
  awal: Titik,
  kendali1: Titik,
  kendali2: Titik,
  akhir: Titik,
  t: number,
): Titik {
  'worklet';
  const u = 1 - t;
  return {
    x:
      u * u * u * awal.x +
      3 * u * u * t * kendali1.x +
      3 * u * t * t * kendali2.x +
      t * t * t * akhir.x,
    y:
      u * u * u * awal.y +
      3 * u * u * t * kendali1.y +
      3 * u * t * t * kendali2.y +
      t * t * t * akhir.y,
  };
}

/** Panjang satu lengkung, dihitung dari potong garis lurus. */
function panjangLengkung(lengkung: Titik[]): number {
  let total = 0;
  let sebelumnya = titikKubik(
    lengkung[0],
    lengkung[1],
    lengkung[2],
    lengkung[3],
    0,
  );
  for (let i = 1; i <= POTONG; i += 1) {
    const sekarang = titikKubik(
      lengkung[0],
      lengkung[1],
      lengkung[2],
      lengkung[3],
      i / POTONG,
    );
    total += Math.hypot(sekarang.x - sebelumnya.x, sekarang.y - sebelumnya.y);
    sebelumnya = sekarang;
  }
  return total;
}

/** Panjang tiap lengkung, dihitung sekali saat modul dimuat. */
export const PANJANG_LENGKUNG = LENGKUNG.map(panjangLengkung);

/** Panjang dari titik pertama sampai tiap titik berikutnya. */
export const PANJANG_SAMPAI = PANJANG_LENGKUNG.reduce<number[]>(
  (daftar, panjang) => {
    const sebelumnya = daftar.length === 0 ? 0 : daftar[daftar.length - 1];
    return [...daftar, sebelumnya + panjang];
  },
  [],
);

/** Panjang seluruh rute. */
export const PANJANG_TOTAL = PANJANG_SAMPAI[PANJANG_SAMPAI.length - 1];

/** Jalur rute, dibangun dari data lengkung. */
export const JALUR = `M${TITIK[0].x} ${TITIK[0].y} ${LENGKUNG.map(
  (lengkung) =>
    `C${lengkung[1].x} ${lengkung[1].y} ${lengkung[2].x} ${lengkung[2].y} ${lengkung[3].x} ${lengkung[3].y}`,
).join(' ')}`;

/** Diameter motor, tidak ikut skala gambar. */
const UKURAN_MOTOR = 36;
/** Jari-jari titik langkah. */
const RADIUS_TITIK = 7;
/** Tebal tepi titik langkah. */
const TEBAL_TITIK = 3;
/** Titik tempat riak berdenyut selama order masih mencari driver. */
const TITIK_RIAK = TITIK[3];
/** Jari-jari riak diam, dipakai kalau gerakan dikurangi. */
const RADIUS_RIAK = [15, 24];
/** Transparansi riak diam, dipakai kalau gerakan dikurangi. */
const OPASITAS_RIAK = [0.5, 0.22];
/** Jari-jari riak paling kecil saat denyutannya hampir habis. */
const RIAK_AWAL = 7;
/** Selisih jari-jari riak antara awal dan akhir denyutan. */
const RIAK_SELISIH = 21;
/** Transparansi riak paling awal. */
const RIAK_OPASITAS = 0.5;
/** Lama satu denyutan riak. */
const SIKLUS_RIAK = 1400;
/** Jeda cincin kedua, biar denyutannya tidak serempak. */
const JEDA_RIAK = 700;
/** Transparansi cahaya motor saat paling terang. */
const CAHAYA_TERANG = 0.6;
/** Tambahan ukuran cahaya motor. */
const CAHAYA_SKALA = 0.8;
/** Lama cahaya motor menyala. */
const DURASI_CAHAYA = 700;
/** Batas miring motor, supaya motor tidak miring terlalu jauh. */
const BATAS_SUDUT = 15;

/** Lingkaran riak yang bisa dianimasikan. */
const LingkaranRiak = Animated.createAnimatedComponent(Circle);
/** Jalur progres yang bisa dianimasikan. */
const JalurProgres = Animated.createAnimatedComponent(Path);

/** Jenis gerak rute ketika langkah order berubah. */
export type JenisGerak = 'muncul' | 'kembali' | 'langsung' | 'luncur';

/**
 * Menentukan jenis gerak dari perubahan langkah.
 *
 * 'muncul' kalau order yang tadinya belum ada driver sekarang punya driver,
 * atau lompat dari langkah dua ke empat. 'kembali' kalau order balik ke
 * langkah satu, jadi sedang mencari driver lagi. 'luncur' kalau motor meluncur
 * dari satu titik ke titik berikutnya. Sisanya berubah langsung saja tanpa
 * gerak.
 */
export function jenisGerakRute(lama: LangkahRute, baru: LangkahRute): JenisGerak {
  if (lama === baru) return 'langsung';
  if (lama === null || baru === null) return 'langsung';
  if (baru === 1) return 'kembali';
  if (lama === 1) return 'muncul';
  if (lama === 2 && baru === 4) return 'muncul';
  if (baru === lama + 1) return 'luncur';
  return 'langsung';
}

/**
 * Posisi motor di lengkung ke-k.
 *
 * Panjang lengkung dihitung dari 0 sampai 2, dan t dari 0 sampai 1. Di t 0
 * motor masih di awal lengkung, di t 1 sudah di titik akhirnya.
 */
export function posisiMotor(k: number, t: number): Titik {
  'worklet';
  const lengkung = LENGKUNG[k];
  return titikKubik(lengkung[0], lengkung[1], lengkung[2], lengkung[3], t);
}

/**
 * Arah motor di lengkung ke-k, dalam derajat.
 *
 * Arahnya diambil dari garis singgung lengkung, dibatasi 15 derajat supaya
 * motor tidak miring terlalu jauh, lalu dikali sinus supaya motor tegak di
 * awal dan di akhir lintasan.
 */
export function sudutMotor(k: number, t: number): number {
  'worklet';
  const lengkung = LENGKUNG[k];
  const awal = lengkung[0];
  const kendali1 = lengkung[1];
  const kendali2 = lengkung[2];
  const akhir = lengkung[3];
  const u = 1 - t;
  const dx =
    3 * u * u * (kendali1.x - awal.x) +
    6 * u * t * (kendali2.x - kendali1.x) +
    3 * t * t * (akhir.x - kendali2.x);
  const dy =
    3 * u * u * (kendali1.y - awal.y) +
    6 * u * t * (kendali2.y - kendali1.y) +
    3 * t * t * (akhir.y - kendali2.y);
  const sudut = (Math.atan2(dy, dx) * 180) / Math.PI;
  const dibatasi = Math.min(BATAS_SUDUT, Math.max(-BATAS_SUDUT, sudut));
  return dibatasi * Math.sin(Math.PI * t);
}

/**
 * Panjang garis progres yang diam untuk suatu langkah.
 *
 * Langkah satu dan order yang dibatalkan belum punya progres, jadi
 * panjangnya nol.
 */
function panjangDiam(langkah: LangkahRute): number {
  if (langkah === null || langkah < 2) return 0;
  return PANJANG_SAMPAI[langkah - 2];
}

/**
 * Transparansi cahaya motor.
 *
 * Cahaya mulai dan selesai dengan tidak terlihat, jadi yang kelihatan hanya
 * bagian tengah denyutannya.
 */
export function opasitasCahaya(c: number): number {
  if (c <= 0 || c >= 1) return 0;
  return CAHAYA_TERANG * (1 - c);
}

/** Ukuran cahaya motor, dikali skala denyutannya. */
export function skalaCahaya(c: number): number {
  return 1 + CAHAYA_SKALA * c;
}

export interface TrackRouteProps {
  /** Langkah order sekarang. Null berarti order dibatalkan. */
  langkah: LangkahRute;
}

/**
 * Warna isi dan tepi satu titik langkah.
 *
 * Titik yang sudah dilewati warnanya biru, titik yang belum dilewati warnanya
 * gelap, kecuali titik terakhir yang tepinya tetap biru.
 */
function warnaTitik(
  nomor: number,
  langkah: LangkahRute,
  colors: ThemeColors,
): { fill: string; stroke: string } {
  if (langkah === null) {
    return nomor === 1
      ? { fill: colors.info, stroke: colors.info }
      : { fill: colors.header, stroke: colors.rail };
  }
  if (nomor <= langkah) {
    return { fill: colors.info, stroke: colors.info };
  }
  if (nomor === 4) {
    return { fill: colors.header, stroke: colors.info };
  }
  return { fill: colors.header, stroke: colors.rail };
}

/**
 * Satu cincin riak yang berdenyut.
 *
 * Cincin ini penanda order yang masih menunggu driver, jadi ia tetap berdenyut
 * sejak langkah pertama tampil, termasuk di dalam jendela awal.
 */
function Riak({
  urutan,
  warna,
}: {
  urutan: number;
  warna: string;
}): React.JSX.Element {
  const kurangiGerak = useReducedMotion();
  const fase = useSharedValue(0);

  const props = useAnimatedProps<CircleProps>(() =>
    kurangiGerak
      ? { r: RADIUS_RIAK[urutan], opacity: OPASITAS_RIAK[urutan] }
      : {
          r: RIAK_AWAL + RIAK_SELISIH * (1 - (1 - fase.value) * (1 - fase.value)),
          opacity: RIAK_OPASITAS * (1 - fase.value),
        },
  );

  useEffect(() => {
    if (kurangiGerak) return undefined;

    const denyut = withRepeat(
      withTiming(1, { duration: SIKLUS_RIAK, easing: Easing.linear }),
      -1,
      false,
    );
    fase.value = urutan === 0 ? denyut : withDelay(JEDA_RIAK, denyut);

    return () => {
      cancelAnimation(fase);
    };
  }, [fase, kurangiGerak, urutan]);

  return (
    <LingkaranRiak
      animatedProps={props}
      cx={TITIK_RIAK.x}
      cy={TITIK_RIAK.y}
      fill="none"
      stroke={warna}
      strokeWidth={stroke.ring}
    />
  );
}

/**
 * Cahaya yang menyala di sekitar motor.
 *
 * Cahaya ini digambar di belakang motor, jadi motor tetap terbaca.
 */
function CahayaMotor({
  kiri,
  atas,
  nilai,
}: {
  kiri: number;
  atas: number;
  nilai: SharedValue<number>;
}): React.JSX.Element {
  const { colors } = useTheme();

  const gaya = useAnimatedStyle(() => ({
    opacity: opasitasCahaya(nilai.value),
    transform: [{ scale: skalaCahaya(nilai.value) }],
  }));

  return (
    <Animated.View
      testID="cahaya-rute"
      pointerEvents="none"
      style={[
        styles.cahaya,
        { left: kiri, top: atas, borderColor: colors.info, borderWidth: stroke.ring },
        gaya,
      ]}
    />
  );
}

/** Riwayat perubahan langkah, dipakai untuk menentukan jenis geraknya. */
interface RiwayatGerak {
  /** Langkah sebelum perubahan. */
  lama: LangkahRute;
  /** Langkah sesudah perubahan. */
  baru: LangkahRute;
  /** Jenis gerak dari perubahan itu. */
  jenis: JenisGerak;
  /** True kalau geraknya boleh jalan waktu perubahan itu terjadi. */
  boleh: boolean;
  /** Nomor motor, naik setiap kali motor baru masuk. */
  nomorMotor: number;
  /** True kalau motor yang baru masuk pakai gerak pudar. */
  motorMasuk: boolean;
}

export function TrackRoute({ langkah }: TrackRouteProps): React.JSX.Element {
  const { colors } = useTheme();
  const [lebar, setLebar] = useState(0);
  const dalamJendela = useInitialWindow();
  const kurangiGerak = useReducedMotion();

  const panjang = useSharedValue(panjangDiam(langkah));
  const cahaya = useSharedValue(1);
  const [riwayat, setRiwayat] = useState<RiwayatGerak>({
    lama: langkah,
    baru: langkah,
    jenis: 'langsung',
    boleh: false,
    nomorMotor: 0,
    motorMasuk: false,
  });
  /** Posisi motor di lengkung, 1 kalau motor sudah diam di titik. */
  const tMotor = useSharedValue(1);

  const ukur = useCallback((event: LayoutChangeEvent) => {
    setLebar(event.nativeEvent.layout.width);
  }, []);

  // Gerak boleh jalan kalau layar sudah lama terbuka, gerakan tidak dikurangi,
  // dan gambar sudah diukur. Selama salah satu belum terpenuhi, perubahan
  // langkah langsung saja ke bentuk barunya.
  const bolehGerak = !dalamJendela && !kurangiGerak && lebar > 0;

  // Jenis geraknya dihitung saat render, supaya efek yang menjalankannya
  // selalu memakai perubahan yang baru saja terjadi.
  if (riwayat.baru !== langkah) {
    const jenis = jenisGerakRute(riwayat.baru, langkah);
    // Motor yang meluncur diisi ke awal lengkung lebih dulu, supaya frame
    // pertamanya sudah di titik asal dan tidak loncat ke titik tujuan.
    if (jenis === 'luncur' && bolehGerak) {
      tMotor.value = 0;
    }
    // Motor baru hanya masuk kalau geraknya 'muncul' dan geraknya boleh jalan.
    const motorBaru = jenis === 'muncul' && bolehGerak;
    setRiwayat({
      lama: riwayat.baru,
      baru: langkah,
      jenis,
      boleh: bolehGerak,
      nomorMotor: motorBaru ? riwayat.nomorMotor + 1 : riwayat.nomorMotor,
      motorMasuk: motorBaru,
    });
  }

  useEffect(() => {
    const target = panjangDiam(riwayat.baru);

    if (!riwayat.boleh || riwayat.jenis === 'langsung') {
      panjang.value = target;
      cahaya.value = 1;
      tMotor.value = 1;
      return;
    }

    if (riwayat.jenis === 'luncur') {
      tMotor.value = 0;
      tMotor.value = withTiming(1, {
        duration: motion.duration.motorStep,
        easing: motorEasing,
      });
      panjang.value = withTiming(target, {
        duration: motion.duration.motorStep,
        easing: motorEasing,
      });
      cahaya.value = 0;
      cahaya.value = withDelay(
        motion.duration.motorStep,
        withTiming(1, { duration: DURASI_CAHAYA, easing: standardEasing }),
      );
      return;
    }

    if (riwayat.jenis === 'muncul') {
      panjang.value = withTiming(target, {
        duration: motion.duration.drawLine,
        easing: standardEasing,
      });
      cahaya.value = 0;
      cahaya.value = withDelay(
        motion.duration.drawLine,
        withTiming(1, { duration: DURASI_CAHAYA, easing: standardEasing }),
      );
      return;
    }

    panjang.value = withTiming(0, {
      duration: motion.duration.drawLine,
      easing: standardEasing,
    });
    cahaya.value = 1;
    tMotor.value = 1;
  }, [cahaya, panjang, riwayat, tMotor]);

  const propsProgres = useAnimatedProps<PathProps>(() => ({
    strokeDashoffset: PANJANG_TOTAL - panjang.value,
  }));

  const skala = lebar / LEBAR_VB;
  const tinggi = (lebar * TINGGI_VB) / LEBAR_VB;
  const langkahMotor = langkah !== null && langkah >= 2 ? langkah : null;
  const titikMotor = langkahMotor ? TITIK[langkahMotor - 1] : null;
  const motorKiri = titikMotor ? titikMotor.x * skala - UKURAN_MOTOR / 2 : 0;
  const motorAtas = titikMotor ? titikMotor.y * skala - UKURAN_MOTOR / 2 : 0;
  /** Lengkung yang dilalui motor, dihitung dari langkah sekarang. */
  const kurva = langkahMotor !== null ? langkahMotor - 2 : -1;

  /**
   * Gaya motor: posisi dan kemiringannya mengikuti lengkung yang dilalui.
   *
   * Motor diam di t 1, jadi posisinya tepat di titik langkah dan tegak.
   */
  const gayaMotor = useAnimatedStyle(() => {
    'worklet';
    if (kurva < 0) {
      return {
        transform: [{ translateX: 0 }, { translateY: 0 }, { rotate: '0deg' }],
      };
    }
    const titik = posisiMotor(kurva, tMotor.value);
    const sudut = Math.round(sudutMotor(kurva, tMotor.value) * 100) / 100;
    return {
      transform: [
        { translateX: titik.x * skala - UKURAN_MOTOR / 2 },
        { translateY: titik.y * skala - UKURAN_MOTOR / 2 },
        { rotate: `${sudut}deg` },
      ],
    };
  }, [kurva, skala]);

  return (
    <View
      testID="rute-status"
      onLayout={ukur}
      style={styles.wadah}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {lebar > 0 ? (
        <>
          <Svg width={lebar} height={tinggi} viewBox={`0 0 ${LEBAR_VB} ${TINGGI_VB}`}>
            <Path
              d={JALUR}
              fill="none"
              stroke={colors.rail}
              strokeWidth={stroke.route}
              strokeLinecap="round"
            />
            <JalurProgres
              testID="progres-rute"
              animatedProps={propsProgres}
              d={JALUR}
              fill="none"
              stroke={colors.info}
              strokeWidth={stroke.route}
              strokeLinecap="round"
              strokeDasharray={[PANJANG_TOTAL, PANJANG_TOTAL]}
            />
            {langkah === 1
              ? RADIUS_RIAK.map((_, urutan) => (
                  <Riak key={`riak-${urutan}`} urutan={urutan} warna={colors.info} />
                ))
              : null}
            {TITIK.map((titik, urutan) => {
              const warna = warnaTitik(urutan + 1, langkah, colors);
              return (
                <Circle
                  key={`titik-${urutan}`}
                  cx={titik.x}
                  cy={titik.y}
                  r={RADIUS_TITIK}
                  fill={warna.fill}
                  stroke={warna.stroke}
                  strokeWidth={TEBAL_TITIK}
                />
              );
            })}
          </Svg>
          {titikMotor ? (
            <>
              <CahayaMotor kiri={motorKiri} atas={motorAtas} nilai={cahaya} />
              <Animated.View
                key={riwayat.nomorMotor}
                testID="motor-rute"
                entering={
                  riwayat.motorMasuk
                    ? fadeIn(motion.duration.drawLine - motion.duration.fadeIn)
                    : undefined
                }
                exiting={bolehGerak ? fadeOut() : undefined}
                style={[
                  styles.motor,
                  {
                    backgroundColor: colors.info,
                  },
                  gayaMotor,
                ]}
              >
                <Icon name="two_wheeler" size={size.iconMd} color={colors.onInfoFill} />
              </Animated.View>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wadah: {
    aspectRatio: LEBAR_VB / TINGGI_VB,
  },
  motor: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: UKURAN_MOTOR,
    height: UKURAN_MOTOR,
    borderRadius: UKURAN_MOTOR / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cahaya: {
    position: 'absolute',
    width: UKURAN_MOTOR,
    height: UKURAN_MOTOR,
    borderRadius: UKURAN_MOTOR / 2,
  },
});
