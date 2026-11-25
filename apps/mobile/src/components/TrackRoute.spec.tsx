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

import {
  JALUR,
  PANJANG_LENGKUNG,
  PANJANG_SAMPAI,
  PANJANG_TOTAL,
  TrackRoute,
  type LangkahRute,
} from './TrackRoute';
import { themes } from '../theme/tokens';

type Pohon = ReturnType<typeof render>;

const LEBAR = 360;
const TINGGI = 88;

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

/** Dua lingkaran riak. */
function riak(pohon: Pohon) {
  return lingkaran(pohon).filter((el) => el.props.r !== 7);
}

/** Jalur progres, yaitu jalur yang warnanya biru. */
function progres(pohon: Pohon) {
  return lintasan(pohon).filter((el) => el.props.stroke === themes.gelap.info);
}

describe('TrackRoute', () => {
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

  it('langkah satu menggambar riak dan tanpa progres', () => {
    const pohon = render(rute(1));
    ukur(pohon);

    expect(progres(pohon)).toHaveLength(0);

    const riakLingkaran = riak(pohon);
    expect(riakLingkaran).toHaveLength(2);
    expect(riakLingkaran[0].props.r).toBe(15);
    expect(riakLingkaran[0].props.opacity).toBe(0.5);
    expect(riakLingkaran[1].props.r).toBe(24);
    expect(riakLingkaran[1].props.opacity).toBe(0.22);
    expect(riakLingkaran[0].props.stroke).toBe(themes.gelap.info);
    expect(riakLingkaran[0].props.fill).toBe('none');
  });

  it('langkah satu tidak menggambar motor', () => {
    const pohon = render(rute(1));
    ukur(pohon);

    expect(pohon.queryByTestId('motor-rute')).toBeNull();
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
    expect(garis[0].props.strokeDasharray[0]).toBeCloseTo(92.9, 1);
    expect(garis[0].props.strokeDasharray[1]).toBeCloseTo(281.62, 1);
    expect(garis[0].props.strokeLinecap).toBe('round');

    expect(riak(pohon)).toHaveLength(0);
  });

  it('langkah tiga menggambar progres sampai titik ketiga', () => {
    const pohon = render(rute(3));
    ukur(pohon);

    const garis = progres(pohon);
    expect(garis).toHaveLength(1);
    expect(garis[0].props.strokeDasharray[0]).toBeCloseTo(188.26, 1);
    expect(garis[0].props.strokeDasharray[1]).toBeCloseTo(281.62, 1);
  });

  it('langkah empat menggambar progres penuh', () => {
    const pohon = render(rute(4));
    ukur(pohon);

    const garis = progres(pohon);
    expect(garis).toHaveLength(1);
    expect(garis[0].props.strokeDasharray[0]).toBeCloseTo(281.62, 1);
    expect(garis[0].props.strokeDasharray[1]).toBeCloseTo(281.62, 1);
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

    const motor = pohon.getByTestId('motor-rute', { includeHiddenElements: true });
    const gaya = StyleSheet.flatten(motor.props.style);
    expect(gaya.left).toBe(117);
    expect(gaya.top).toBe(14);
    expect(gaya.backgroundColor).toBe(themes.gelap.info);
  });

  it('motor langkah tiga berada di titik ketiga', () => {
    const pohon = render(rute(3));
    ukur(pohon);

    const motor = pohon.getByTestId('motor-rute', { includeHiddenElements: true });
    const gaya = StyleSheet.flatten(motor.props.style);
    expect(gaya.left).toBe(207);
    expect(gaya.top).toBe(42);
  });

  it('motor langkah empat berada di titik keempat', () => {
    const pohon = render(rute(4));
    ukur(pohon);

    const motor = pohon.getByTestId('motor-rute', { includeHiddenElements: true });
    const gaya = StyleSheet.flatten(motor.props.style);
    expect(gaya.left).toBe(297);
    expect(gaya.top).toBe(20);
  });

  it('order dibatalkan tidak menggambar progres, riak, dan motor', () => {
    const pohon = render(rute(null));
    ukur(pohon);

    expect(progres(pohon)).toHaveLength(0);
    expect(riak(pohon)).toHaveLength(0);
    expect(pohon.queryByTestId('motor-rute')).toBeNull();
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

    const motor = pohon.getByTestId('motor-rute', { includeHiddenElements: true });
    const gaya = StyleSheet.flatten(motor.props.style);
    expect(gaya.left).toBe(252);
    expect(gaya.top).toBe(46);
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
});
