/**
 * Tes komponen RiderArt.
 *
 * Gambar orang naik motor untuk lembar konfirmasi: badan motor, orangnya,
 * helm, dan jari-jari roda.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { render } from '@testing-library/react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import { RiderArt, UKURAN_RIDER } from './RiderArt';
import { JALUR_CANGKANG, JALUR_KACA, JALUR_PET } from '../theme/Logo';
import { ThemeProvider } from '../theme/ThemeProvider';
import { themes } from '../theme/tokens';

const JALUR_KOTAK = 'M18 36 H48';
const JALUR_BADAN =
  'M22 70 C20 58 28 50 42 50 H74 C79 55 78 67 70 72 H100 C104 62 108 48 112 38 M106 36 H122 M112 40 L124 76';
const JALUR_ORANG = 'M64 46 L74 22 M74 24 C86 30 98 34 114 36 M64 46 L84 48 L88 70';
const JALUR_JARI = 'M0 -9 V9 M-9 0 H9';

function gambar(tema?: 'terang' | 'gelap'): React.JSX.Element {
  const isi = <RiderArt />;
  return tema ? <ThemeProvider name={tema}>{isi}</ThemeProvider> : isi;
}

/** Semua jalur gambar, apa adanya. */
function jalur(pohon: ReturnType<typeof render>) {
  return pohon.UNSAFE_getAllByType(Path).map((el) => el.props.d as string);
}

/** Jalur gambar dengan isi tertentu. */
function jalurSatu(pohon: ReturnType<typeof render>, isi: string) {
  return pohon.UNSAFE_getAllByType(Path).find((el) => el.props.d === isi);
}

/** Kelompok gambar yang tidak memakai transformasi. */
function kelompokUtama(pohon: ReturnType<typeof render>) {
  return pohon
    .UNSAFE_getAllByType(G)
    .find((el) => el.props.transform === undefined && el.props.stroke !== undefined);
}

/** Kelompok gambar yang memakai transformasi, yaitu helm. */
function kelompokHelm(pohon: ReturnType<typeof render>) {
  return pohon.UNSAFE_getAllByType(G).find((el) => el.props.transform !== undefined);
}

/** Dua wadah jari-jari roda. */
function wadahJari(pohon: ReturnType<typeof render>) {
  return pohon.UNSAFE_getAllByType(View).filter((el) => {
    const gaya = StyleSheet.flatten(el.props.style);
    return gaya?.position === 'absolute';
  });
}

describe('RiderArt', () => {
  it('ukuran gambar tetap dan viewBox-nya sesuai', () => {
    const pohon = render(gambar());

    const utama = pohon
      .UNSAFE_getAllByType(Svg)
      .find((el) => el.props.viewBox === '0 -8 160 104');
    expect(utama?.props.width).toBe(122);
    expect(utama?.props.height).toBeCloseTo(79.3, 1);
  });

  it('ukuran penting dihitung dari viewBox', () => {
    expect(UKURAN_RIDER.skala).toBeCloseTo(0.7625, 4);
    expect(UKURAN_RIDER.lebar).toBe(122);
    expect(UKURAN_RIDER.tinggi).toBeCloseTo(79.3, 1);
    expect(UKURAN_RIDER.dasarRodaY).toBeCloseTo(73.2, 1);
    expect(UKURAN_RIDER.ujungRodaDepanX).toBeCloseTo(94.55, 2);
    expect(UKURAN_RIDER.jariJariRoda).toBeCloseTo(9.15, 2);
  });

  it('isi jalur gambar utama persis', () => {
    const pohon = render(gambar());

    const daftar = jalur(pohon);
    expect(daftar).toContain(JALUR_KOTAK);
    expect(daftar).toContain(JALUR_BADAN);
    expect(daftar).toContain(JALUR_ORANG);
  });

  it('kotak barang digambar di tempatnya', () => {
    const pohon = render(gambar());

    const kotak = pohon.UNSAFE_getAllByType(Rect)[0];
    expect(kotak.props.x).toBe(18);
    expect(kotak.props.y).toBe(28);
    expect(kotak.props.width).toBe(30);
    expect(kotak.props.height).toBe(22);
    expect(kotak.props.rx).toBe(5);
  });

  it('dua roda digambar di titik yang benar', () => {
    const pohon = render(gambar());

    const roda = pohon.UNSAFE_getAllByType(Circle);
    expect(roda).toHaveLength(2);
    expect(roda[0].props.cx).toBe(40);
    expect(roda[0].props.cy).toBe(76);
    expect(roda[0].props.r).toBe(12);
    expect(roda[1].props.cx).toBe(124);
    expect(roda[1].props.cy).toBe(76);
    expect(roda[1].props.r).toBe(12);
  });

  it('gambar utama tanpa isi dan garisnya tebal', () => {
    const pohon = render(gambar());

    const utama = kelompokUtama(pohon);
    expect(utama?.props.fill).toBe('none');
    expect(utama?.props.strokeWidth).toBe(4);
    expect(utama?.props.strokeLinecap).toBe('round');
    expect(utama?.props.strokeLinejoin).toBe('round');
  });

  it('helm memakai jalur logo dan digeser ke kepala', () => {
    const pohon = render(gambar());

    expect(kelompokHelm(pohon)?.props.transform).toBe('translate(86 21) scale(-.3 .3)');

    const daftar = jalur(pohon);
    expect(daftar).toContain(JALUR_CANGKANG);
    expect(daftar).toContain(JALUR_KACA);
    expect(daftar).toContain(JALUR_PET);
  });

  it('warna gambar mengikuti tema gelap', () => {
    const pohon = render(gambar());

    expect(kelompokUtama(pohon)?.props.stroke).toBe(themes.gelap.textMuted);

    const cangkang = jalurSatu(pohon, JALUR_CANGKANG);
    expect(cangkang?.props.fill).toBe(themes.gelap.accent);
    expect(cangkang?.props.stroke).toBe(themes.gelap.accent);
    expect(cangkang?.props.strokeWidth).toBe(13.33);

    const kaca = jalurSatu(pohon, JALUR_KACA);
    expect(kaca?.props.fill).toBe('none');
    expect(kaca?.props.stroke).toBe(themes.gelap.logoVisor);
    expect(kaca?.props.strokeWidth).toBe(8);

    const pet = jalurSatu(pohon, JALUR_PET);
    expect(pet?.props.fill).toBe('none');
    expect(pet?.props.stroke).toBe(themes.gelap.accent);
    expect(pet?.props.strokeWidth).toBe(20);
  });

  it('warna gambar mengikuti tema terang', () => {
    const pohon = render(gambar('terang'));

    expect(kelompokUtama(pohon)?.props.stroke).toBe(themes.terang.textMuted);

    const cangkang = jalurSatu(pohon, JALUR_CANGKANG);
    expect(cangkang?.props.fill).toBe(themes.terang.accent);
    expect(cangkang?.props.stroke).toBe(themes.terang.accent);

    const kaca = jalurSatu(pohon, JALUR_KACA);
    expect(kaca?.props.stroke).toBe(themes.terang.logoVisor);
  });

  it('jari-jari roda berada di tengah kedua roda', () => {
    const pohon = render(gambar());

    const wadah = wadahJari(pohon);
    expect(wadah).toHaveLength(2);

    const belakang = StyleSheet.flatten(wadah[0].props.style);
    expect(belakang.left).toBeCloseTo(21.35, 2);
    expect(belakang.top).toBeCloseTo(54.9, 2);

    const depan = StyleSheet.flatten(wadah[1].props.style);
    expect(depan.left).toBeCloseTo(85.4, 2);
    expect(depan.top).toBeCloseTo(54.9, 2);
  });

  it('isi jari-jari roda berupa salib tegak', () => {
    const pohon = render(gambar());

    const jari = pohon
      .UNSAFE_getAllByType(Path)
      .filter((el) => el.props.d === JALUR_JARI);
    expect(jari).toHaveLength(2);
    expect(jari[0].props.stroke).toBe(themes.gelap.textMuted);
    expect(jari[0].props.strokeWidth).toBe(2.5);
    expect(jari[0].props.strokeLinecap).toBe('round');
  });

  it('gambar disembunyikan dari pembaca layar', () => {
    const pohon = render(gambar());

    const akar = pohon.getByTestId('gambar-motor', { includeHiddenElements: true });
    expect(akar.props.accessibilityElementsHidden).toBe(true);
    expect(akar.props.importantForAccessibility).toBe('no-hide-descendants');
  });
});
