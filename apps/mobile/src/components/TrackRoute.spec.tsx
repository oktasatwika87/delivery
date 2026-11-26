/**
 * Tes komponen TrackRoute.
 *
 * Rute langkah order: empat titik di satu rel melengkung, progres biru sesuai
 * langkah, riak saat masih mencari, dan motor di titik yang sedang berjalan.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import * as reanimated from 'react-native-reanimated';

import {
  JALUR,
  PANJANG_LENGKUNG,
  PANJANG_SAMPAI,
  PANJANG_TOTAL,
  TrackRoute,
  jenisGerakRute,
  opasitasCahaya,
  posisiMotor,
  sudutMotor,
  type LangkahRute,
} from './TrackRoute';
import { InitialWindowProvider } from './motion/InitialWindow';
import * as presets from './motion/presets';
import { themes } from '../theme/tokens';

// Ikon ditiru jadi komponen yang menggambar View. Kalau namanya two_wheeler,
// ikon menambah pencatat di efek, jadi tes bisa menghitung berapa kali motor
// dipasang.
const mockJumlahMotor = { dipasang: 0 };

jest.mock('../theme/Icon', () => {
  const mockReact = jest.requireActual<typeof import('react')>('react');
  const mockTampilan = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Icon: ({ name }: { name: string }) => {
      mockReact.useEffect(() => {
        if (name === 'two_wheeler') {
          mockJumlahMotor.dipasang += 1;
        }
      }, []);
      return mockReact.createElement(mockTampilan.View, null);
    },
  };
});

type Pohon = ReturnType<typeof render>;

const LEBAR = 360;
const TINGGI = 88;
/** Lama satu denyutan riak. */
const SIKLUS_RIAK = 1400;
/** Jeda cincin riak kedua. */
const JEDA_RIAK = 700;
/** Lama cahaya motor menyala. */
const DURASI_CAHAYA = 700;
/** Lama gambar garis progres. */
const DURASI_GARIS = 320;
/** Lama motor meluncur ke titik berikutnya. */
const DURASI_MOTOR = 900;
/** Jeda masuknya motor, supaya selesai bersama garis progres. */
const JEDA_MOTOR = 140;

function rute(langkah: LangkahRute): React.JSX.Element {
  return <TrackRoute langkah={langkah} />;
}

function wadah(pohon: Pohon) {
  return pohon.getByTestId('rute-status', { includeHiddenElements: true });
}

function ukur(pohon: Pohon, lebar = LEBAR): void {
  fireEvent(wadah(pohon), 'layout', {
    nativeEvent: {
      layout: { x: 0, y: 0, width: lebar, height: (lebar * TINGGI) / LEBAR },
    },
  });
}

function lintasan(pohon: Pohon) {
  return within(wadah(pohon)).UNSAFE_getAllByType(Path);
}

function lingkaran(pohon: Pohon) {
  return within(wadah(pohon)).UNSAFE_getAllByType(Circle);
}

/** Empat titik langkah, urut dari titik pertama. */
function titikLangkah(pohon: Pohon) {
  return lingkaran(pohon).filter((el) => el.props.r === 7);
}

/** Dua cincin riak yang bisa dianimasikan. */
function riak(pohon: Pohon) {
  return lingkaran(pohon).filter((el) => el.props.animatedProps !== undefined);
}

/** Jalur progres, yaitu jalur yang warnanya biru. */
function progres(pohon: Pohon) {
  return lintasan(pohon).filter((el) => el.props.stroke === themes.gelap.info);
}

/** Panjang garis progres yang sedang tampil. */
function panjangProgres(pohon: Pohon): number {
  const garis = progres(pohon)[0];
  return PANJANG_TOTAL - garis.props.animatedProps.strokeDashoffset;
}

/** Motor di rute, termasuk yang disembunyikan dari pembaca layar. */
function motor(pohon: Pohon) {
  return pohon.getByTestId('motor-rute', { includeHiddenElements: true });
}

/** Bagian transform motor: geser dan kemiringannya. */
interface TransformMotor {
  translateX?: number;
  translateY?: number;
  rotate?: string;
}

/** Transform motor, yaitu geser dan kemiringannya. */
function transformMotor(pohon: Pohon): TransformMotor {
  const gaya = StyleSheet.flatten(motor(pohon).props.style);
  const daftar: TransformMotor[] = Array.isArray(gaya.transform) ? gaya.transform : [];
  return daftar.reduce<TransformMotor>(
    (gabungan, bagian) => ({ ...gabungan, ...bagian }),
    {},
  );
}

describe('TrackRoute', () => {
  beforeEach(() => {
    mockJumlahMotor.dipasang = 0;
  });

  it('panjang tiap lengkung sudah dihitung', () => {
    expect(PANJANG_LENGKUNG[0]).toBeCloseTo(92.9, 1);
    expect(PANJANG_LENGKUNG[1]).toBeCloseTo(95.4, 1);
    expect(PANJANG_LENGKUNG[2]).toBeCloseTo(93.4, 1);
    expect(PANJANG_TOTAL).toBeCloseTo(281.62, 1);
  });

  it('panjang dari titik pertama sampai tiap titik berikutnya', () => {
    expect(PANJANG_SAMPAI[0]).toBeCloseTo(92.9, 1);
    expect(PANJANG_SAMPAI[1]).toBeCloseTo(188.26, 1);
    expect(PANJANG_SAMPAI[2]).toBeCloseTo(281.62, 1);
  });

  it('jalur rute dibangun dari data lengkung', () => {
    expect(JALUR).toBe(
      'M45 52 C80 52 100 30 135 32 C172 34 190 62 225 60 C260 58 280 36 315 38',
    );
  });

  it('sebelum lebar diukur tidak ada gambar', () => {
    const pohon = render(rute(1));
    expect(pohon.UNSAFE_queryByType(Svg)).toBeNull();
  });

  it('rel digambar penuh dengan warna rel dan ujung bulat', () => {
    const pohon = render(rute(1));
    ukur(pohon);

    const rel = lintasan(pohon).find((el) => el.props.stroke === themes.gelap.rail);
    expect(rel?.props.d).toBe(JALUR);
    expect(rel?.props.strokeWidth).toBe(4);
    expect(rel?.props.strokeLinecap).toBe('round');
    expect(rel?.props.fill).toBe('none');
  });

  it('langkah satu menggambar riak berdenyut dan progres sepanjang 0', () => {
    jest.restoreAllMocks();
    const spyUlang = jest.spyOn(reanimated, 'withRepeat');
    const spyTiming = jest.spyOn(reanimated, 'withTiming');
    const spyJeda = jest.spyOn(reanimated, 'withDelay');

    const pohon = render(rute(1));
    ukur(pohon);

    expect(riak(pohon)).toHaveLength(2);
    expect(spyUlang).toHaveBeenCalledTimes(2);
    expect(spyTiming).toHaveBeenCalledWith(1, {
      duration: SIKLUS_RIAK,
      easing: reanimated.Easing.linear,
    });
    expect(spyJeda).toHaveBeenCalledWith(JEDA_RIAK, expect.anything());
    expect(panjangProgres(pohon)).toBeCloseTo(0, 5);
  });

  it('riak diam dengan kurangi gerakan', () => {
    jest.restoreAllMocks();
    jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);

    const pohon = render(rute(1));
    ukur(pohon);

    const cincin = riak(pohon);
    expect(cincin).toHaveLength(2);
    expect(cincin[0].props.animatedProps.r).toBe(15);
    expect(cincin[0].props.animatedProps.opacity).toBe(0.5);
    expect(cincin[1].props.animatedProps.r).toBe(24);
    expect(cincin[1].props.animatedProps.opacity).toBe(0.22);
  });

  it('langkah satu tidak menggambar motor', () => {
    const pohon = render(rute(1));
    ukur(pohon);

    expect(pohon.queryByTestId('motor-rute', { includeHiddenElements: true })).toBeNull();
  });

  it('titik langkah pada langkah satu', () => {
    const pohon = render(rute(1));
    ukur(pohon);

    const titik = titikLangkah(pohon);
    expect(titik).toHaveLength(4);
    expect(titik[0].props.fill).toBe(themes.gelap.info);
    expect(titik[0].props.stroke).toBe(themes.gelap.info);
    expect(titik[1].props.fill).toBe(themes.gelap.header);
    expect(titik[1].props.stroke).toBe(themes.gelap.rail);
    expect(titik[2].props.fill).toBe(themes.gelap.header);
    expect(titik[2].props.stroke).toBe(themes.gelap.rail);
    expect(titik[3].props.fill).toBe(themes.gelap.header);
    expect(titik[3].props.stroke).toBe(themes.gelap.info);
  });

  it('langkah dua menggambar progres sampai titik kedua', () => {
    const pohon = render(rute(2));
    ukur(pohon);

    const garis = progres(pohon);
    expect(garis).toHaveLength(1);
    expect(garis[0].props.d).toBe(JALUR);
    expect(garis[0].props.strokeDasharray[0]).toBeCloseTo(PANJANG_TOTAL, 1);
    expect(garis[0].props.strokeDasharray[1]).toBeCloseTo(PANJANG_TOTAL, 1);
    expect(garis[0].props.strokeLinecap).toBe('round');
    expect(panjangProgres(pohon)).toBeCloseTo(92.9, 1);

    expect(riak(pohon)).toHaveLength(0);
  });

  it('langkah tiga menggambar progres sampai titik ketiga', () => {
    const pohon = render(rute(3));
    ukur(pohon);

    const garis = progres(pohon);
    expect(garis).toHaveLength(1);
    expect(garis[0].props.strokeDasharray[0]).toBeCloseTo(PANJANG_TOTAL, 1);
    expect(garis[0].props.strokeDasharray[1]).toBeCloseTo(PANJANG_TOTAL, 1);
    expect(panjangProgres(pohon)).toBeCloseTo(188.26, 1);
  });

  it('langkah empat menggambar progres penuh', () => {
    const pohon = render(rute(4));
    ukur(pohon);

    const garis = progres(pohon);
    expect(garis).toHaveLength(1);
    expect(garis[0].props.strokeDasharray[0]).toBeCloseTo(PANJANG_TOTAL, 1);
    expect(garis[0].props.strokeDasharray[1]).toBeCloseTo(PANJANG_TOTAL, 1);
    expect(panjangProgres(pohon)).toBeCloseTo(281.62, 1);
  });

  it('titik langkah pada langkah dua', () => {
    const pohon = render(rute(2));
    ukur(pohon);

    const titik = titikLangkah(pohon);
    expect(titik).toHaveLength(4);
    expect(titik[0].props.fill).toBe(themes.gelap.info);
    expect(titik[1].props.fill).toBe(themes.gelap.info);
    expect(titik[2].props.fill).toBe(themes.gelap.header);
    expect(titik[2].props.stroke).toBe(themes.gelap.rail);
    expect(titik[3].props.fill).toBe(themes.gelap.header);
    expect(titik[3].props.stroke).toBe(themes.gelap.info);
  });

  it('langkah empat membuat keempat titik berwarna biru', () => {
    const pohon = render(rute(4));
    ukur(pohon);

    const titik = titikLangkah(pohon);
    expect(titik).toHaveLength(4);
    titik.forEach((el) => {
      expect(el.props.fill).toBe(themes.gelap.info);
      expect(el.props.stroke).toBe(themes.gelap.info);
    });
  });

  it('motor berada di titik langkah yang sedang berjalan', () => {
    const pohon = render(rute(2));
    ukur(pohon);

    const gaya = transformMotor(pohon);
    expect(gaya.translateX).toBe(117);
    expect(gaya.translateY).toBe(14);
    const gayaLuar = StyleSheet.flatten(motor(pohon).props.style);
    expect(gayaLuar.backgroundColor).toBe(themes.gelap.info);
  });

  it('motor langkah tiga berada di titik ketiga', () => {
    const pohon = render(rute(3));
    ukur(pohon);

    const gaya = transformMotor(pohon);
    expect(gaya.translateX).toBe(207);
    expect(gaya.translateY).toBe(42);
  });

  it('motor langkah empat berada di titik keempat', () => {
    const pohon = render(rute(4));
    ukur(pohon);

    const gaya = transformMotor(pohon);
    expect(gaya.translateX).toBe(297);
    expect(gaya.translateY).toBe(20);
  });

  it('order dibatalkan: progres sepanjang 0, tanpa riak, dan tanpa motor', () => {
    const pohon = render(rute(null));
    ukur(pohon);

    expect(panjangProgres(pohon)).toBeCloseTo(0, 5);
    expect(riak(pohon)).toHaveLength(0);
    expect(pohon.queryByTestId('motor-rute', { includeHiddenElements: true })).toBeNull();
  });

  it('titik langkah pada order yang dibatalkan', () => {
    const pohon = render(rute(null));
    ukur(pohon);

    const titik = titikLangkah(pohon);
    expect(titik).toHaveLength(4);
    expect(titik[0].props.fill).toBe(themes.gelap.info);
    expect(titik[0].props.stroke).toBe(themes.gelap.info);
    expect(titik[1].props.fill).toBe(themes.gelap.header);
    expect(titik[1].props.stroke).toBe(themes.gelap.rail);
    expect(titik[2].props.fill).toBe(themes.gelap.header);
    expect(titik[2].props.stroke).toBe(themes.gelap.rail);
    expect(titik[3].props.fill).toBe(themes.gelap.header);
    expect(titik[3].props.stroke).toBe(themes.gelap.rail);
  });

  it('lebar 720 membuat gambar lebih besar dan motor ikut tempatnya', () => {
    const pohon = render(rute(2));
    ukur(pohon, 720);

    const gambar = pohon.UNSAFE_getAllByType(Svg)[0];
    expect(gambar.props.width).toBe(720);
    expect(gambar.props.height).toBe(176);

    const gaya = transformMotor(pohon);
    expect(gaya.translateX).toBe(252);
    expect(gaya.translateY).toBe(46);
  });

  it('wadah disembunyikan dari pembaca layar', () => {
    const pohon = render(rute(1));

    const akar = wadah(pohon);
    expect(akar.props.accessibilityElementsHidden).toBe(true);
    expect(akar.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('wadah memakai perbandingan tinggi dan lebar gambar', () => {
    const pohon = render(rute(1));

    const gaya = StyleSheet.flatten(wadah(pohon).props.style);
    expect(gaya.aspectRatio).toBeCloseTo(LEBAR / TINGGI, 5);
  });

  it('jenis gerak rute untuk semua pasangan langkah', () => {
    expect(jenisGerakRute(1, 1)).toBe('langsung');
    expect(jenisGerakRute(1, 2)).toBe('muncul');
    expect(jenisGerakRute(1, 3)).toBe('muncul');
    expect(jenisGerakRute(1, 4)).toBe('muncul');
    expect(jenisGerakRute(2, 1)).toBe('kembali');
    expect(jenisGerakRute(3, 1)).toBe('kembali');
    expect(jenisGerakRute(4, 1)).toBe('kembali');
    expect(jenisGerakRute(2, 3)).toBe('luncur');
    expect(jenisGerakRute(3, 4)).toBe('luncur');
    expect(jenisGerakRute(4, 3)).toBe('langsung');
    expect(jenisGerakRute(4, 2)).toBe('langsung');
    expect(jenisGerakRute(1, null)).toBe('langsung');
    expect(jenisGerakRute(null, 1)).toBe('langsung');
    expect(jenisGerakRute(null, 2)).toBe('langsung');
  });

  it('langkah satu ke dua: garis digambar 320 milidetik, motor masuk, cahaya telat', () => {
    jest.restoreAllMocks();
    const spyTiming = jest.spyOn(reanimated, 'withTiming');
    const spyJeda = jest.spyOn(reanimated, 'withDelay');
    const spyMasuk = jest.spyOn(presets, 'fadeIn');

    const pohon = render(rute(1));
    ukur(pohon);
    pohon.rerender(rute(2));
    pohon.rerender(rute(2));

    expect(spyTiming).toHaveBeenCalledWith(PANJANG_SAMPAI[0], {
      duration: DURASI_GARIS,
      easing: presets.standardEasing,
    });
    expect(spyMasuk).toHaveBeenCalledWith(JEDA_MOTOR);
    expect(spyJeda).toHaveBeenCalledWith(DURASI_GARIS, expect.anything());
    expect(spyTiming).toHaveBeenCalledWith(1, {
      duration: DURASI_CAHAYA,
      easing: presets.standardEasing,
    });
  });

  it('langkah dua ke satu: garis kembali nol, motor keluar, riak muncul lagi', () => {
    jest.restoreAllMocks();
    const spyTiming = jest.spyOn(reanimated, 'withTiming');

    const pohon = render(rute(2));
    ukur(pohon);
    expect(motor(pohon).props.exiting).toBeDefined();

    pohon.rerender(rute(1));
    pohon.rerender(rute(1));

    expect(spyTiming).toHaveBeenCalledWith(0, {
      duration: DURASI_GARIS,
      easing: presets.standardEasing,
    });
    expect(
      pohon.queryByTestId('motor-rute', { includeHiddenElements: true }),
    ).toBeNull();
    expect(riak(pohon)).toHaveLength(2);
  });

  it('langkah satu ke tiga dan langkah dua ke empat digerakkan muncul', () => {
    expect(jenisGerakRute(1, 3)).toBe('muncul');
    expect(jenisGerakRute(2, 4)).toBe('muncul');
  });

  it('motor dipasang ulang saat langkah dua ke empat', () => {
    const pohon = render(rute(2));
    ukur(pohon);
    const motorLama = motor(pohon);

    pohon.rerender(rute(4));
    pohon.rerender(rute(4));
    const motorBaru = motor(pohon);

    expect(motorBaru).not.toBe(motorLama);
    expect(motorBaru.props.entering).toBeDefined();
  });

  it('motor tidak dipasang ulang saat langkah dua ke tiga', () => {
    const pohon = render(rute(2));
    ukur(pohon);
    const motorLama = motor(pohon);

    pohon.rerender(rute(3));
    pohon.rerender(rute(3));

    expect(motor(pohon)).toBe(motorLama);
    expect(motor(pohon).props.entering).toBeUndefined();
  });

  it('langkah satu ke dua memasang motor tepat sekali', () => {
    const pohon = render(rute(1));
    ukur(pohon);
    mockJumlahMotor.dipasang = 0;

    pohon.rerender(rute(2));

    expect(mockJumlahMotor.dipasang).toBe(1);
  });

  it('langkah satu ke tiga memasang motor tepat sekali', () => {
    const pohon = render(rute(1));
    ukur(pohon);
    mockJumlahMotor.dipasang = 0;

    pohon.rerender(rute(3));

    expect(mockJumlahMotor.dipasang).toBe(1);
  });

  it('di dalam jendela awal perubahan langkah langsung tanpa gerak', () => {
    jest.restoreAllMocks();
    const spyTiming = jest.spyOn(reanimated, 'withTiming');

    const pohon = render(<InitialWindowProvider>{rute(1)}</InitialWindowProvider>);
    ukur(pohon);
    pohon.rerender(<InitialWindowProvider>{rute(2)}</InitialWindowProvider>);
    pohon.rerender(<InitialWindowProvider>{rute(2)}</InitialWindowProvider>);

    expect(spyTiming).not.toHaveBeenCalledWith(PANJANG_SAMPAI[0], expect.anything());
    expect(spyTiming).not.toHaveBeenCalledWith(1, {
      duration: DURASI_CAHAYA,
      easing: presets.standardEasing,
    });
    expect(motor(pohon).props.entering).toBeUndefined();
  });

  it('dengan kurangi gerakan perubahan langkah langsung tanpa gerak', () => {
    jest.restoreAllMocks();
    jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);
    const spyTiming = jest.spyOn(reanimated, 'withTiming');

    const pohon = render(rute(1));
    ukur(pohon);
    pohon.rerender(rute(2));
    pohon.rerender(rute(2));

    expect(spyTiming).not.toHaveBeenCalledWith(PANJANG_SAMPAI[0], expect.anything());
    expect(spyTiming).not.toHaveBeenCalledWith(1, {
      duration: DURASI_CAHAYA,
      easing: presets.standardEasing,
    });
    expect(motor(pohon).props.entering).toBeUndefined();
  });

  it('sebelum lebar terukur perubahan langkah langsung tanpa gerak', () => {
    jest.restoreAllMocks();
    const spyTiming = jest.spyOn(reanimated, 'withTiming');

    const pohon = render(rute(1));
    pohon.rerender(rute(2));
    pohon.rerender(rute(2));

    expect(spyTiming).not.toHaveBeenCalledWith(PANJANG_SAMPAI[0], expect.anything());
    expect(
      pohon.queryByTestId('motor-rute', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('riak tetap berdenyut di dalam jendela awal dan dibatalkan saat keluar', () => {
    jest.restoreAllMocks();
    const spyUlang = jest.spyOn(reanimated, 'withRepeat');
    const spyBatal = jest.spyOn(reanimated, 'cancelAnimation');

    const pohon = render(<InitialWindowProvider>{rute(1)}</InitialWindowProvider>);
    ukur(pohon);
    expect(spyUlang).toHaveBeenCalledTimes(2);

    pohon.rerender(<InitialWindowProvider>{rute(2)}</InitialWindowProvider>);
    expect(spyBatal).toHaveBeenCalled();
  });

  it('cahaya tidak terlihat di awal dan di akhir denyutannya', () => {
    expect(opasitasCahaya(0)).toBe(0);
    expect(opasitasCahaya(1)).toBe(0);
    expect(opasitasCahaya(0.5)).toBeCloseTo(0.3, 5);
  });

  it('posisi motor di lengkung: awal di titik awal, akhir di titik akhir', () => {
    expect(posisiMotor(1, 0)).toEqual({ x: 135, y: 32 });
    expect(posisiMotor(0, 1)).toEqual({ x: 135, y: 32 });
    expect(posisiMotor(1, 1)).toEqual({ x: 225, y: 60 });
    expect(posisiMotor(2, 1)).toEqual({ x: 315, y: 38 });
  });

  it('sudut motor tegak di awal dan di akhir, paling miring 15 derajat', () => {
    expect(sudutMotor(0, 0)).toBeCloseTo(0, 5);
    expect(sudutMotor(0, 1)).toBeCloseTo(0, 5);
    expect(sudutMotor(1, 0.5)).toBeCloseTo(15, 5);
    expect(sudutMotor(2, 0.5)).toBeCloseTo(-15, 5);
  });

  it('langkah dua ke tiga: motor meluncur, garis dan cahaya ikut', () => {
    jest.restoreAllMocks();
    const spyTiming = jest.spyOn(reanimated, 'withTiming');
    const spyJeda = jest.spyOn(reanimated, 'withDelay');

    const pohon = render(rute(2));
    ukur(pohon);
    const motorLama = motor(pohon);

    pohon.rerender(rute(3));
    pohon.rerender(rute(3));

    expect(spyTiming).toHaveBeenCalledWith(1, {
      duration: DURASI_MOTOR,
      easing: presets.motorEasing,
    });
    expect(spyTiming).toHaveBeenCalledWith(PANJANG_SAMPAI[1], {
      duration: DURASI_MOTOR,
      easing: presets.motorEasing,
    });
    expect(spyJeda).toHaveBeenCalledWith(DURASI_MOTOR, expect.anything());
    expect(motor(pohon)).toBe(motorLama);
  });

  it('langkah tiga ke empat: motor meluncur, garis dan cahaya ikut', () => {
    jest.restoreAllMocks();
    const spyTiming = jest.spyOn(reanimated, 'withTiming');
    const spyJeda = jest.spyOn(reanimated, 'withDelay');

    const pohon = render(rute(3));
    ukur(pohon);
    const motorLama = motor(pohon);

    pohon.rerender(rute(4));
    pohon.rerender(rute(4));

    expect(spyTiming).toHaveBeenCalledWith(1, {
      duration: DURASI_MOTOR,
      easing: presets.motorEasing,
    });
    expect(spyTiming).toHaveBeenCalledWith(PANJANG_SAMPAI[2], {
      duration: DURASI_MOTOR,
      easing: presets.motorEasing,
    });
    expect(spyJeda).toHaveBeenCalledWith(DURASI_MOTOR, expect.anything());
    expect(motor(pohon)).toBe(motorLama);
  });

  it('motor diam tegak di titik langkah', () => {
    const pohon = render(rute(4));
    ukur(pohon);

    const gaya = transformMotor(pohon);
    expect(gaya.rotate).toBe('0deg');
  });

  it('di dalam jendela awal motor meluncur tanpa gerak', () => {
    jest.restoreAllMocks();
    const spyTiming = jest.spyOn(reanimated, 'withTiming');

    const pohon = render(<InitialWindowProvider>{rute(2)}</InitialWindowProvider>);
    ukur(pohon);
    pohon.rerender(<InitialWindowProvider>{rute(3)}</InitialWindowProvider>);
    pohon.rerender(<InitialWindowProvider>{rute(3)}</InitialWindowProvider>);

    expect(spyTiming).not.toHaveBeenCalledWith(1, {
      duration: DURASI_MOTOR,
      easing: presets.motorEasing,
    });
    expect(spyTiming).not.toHaveBeenCalledWith(PANJANG_SAMPAI[1], expect.anything());
    expect(transformMotor(pohon).translateX).toBe(207);
  });

  it('dengan kurangi gerakan motor meluncur tanpa gerak', () => {
    jest.restoreAllMocks();
    jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);
    const spyTiming = jest.spyOn(reanimated, 'withTiming');

    const pohon = render(rute(2));
    ukur(pohon);
    pohon.rerender(rute(3));
    pohon.rerender(rute(3));

    expect(spyTiming).not.toHaveBeenCalledWith(1, {
      duration: DURASI_MOTOR,
      easing: presets.motorEasing,
    });
    expect(spyTiming).not.toHaveBeenCalledWith(PANJANG_SAMPAI[1], expect.anything());
    expect(transformMotor(pohon).translateX).toBe(207);
  });
});
