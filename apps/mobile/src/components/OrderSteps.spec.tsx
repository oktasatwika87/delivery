/**
 * Tes komponen OrderSteps.
 *
 * Kartu langkah order: empat titik di rel, posisi langkah yang sedang jalan,
 * dan gerak saat langkahnya naik.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, within } from '@testing-library/react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { OrderStatus } from '@delivery/shared';

import { OrderSteps } from './OrderSteps';
import { DrawnStroke } from './motion/DrawnPath';
import { InitialWindowProvider } from './motion/InitialWindow';
import { themes, type } from '../theme/tokens';

const LABEL = ['Diterima', 'Diantar', 'Tunai', 'Selesai'];
const LEBAR = 296;
const TINGGI_REL = 28;

type Pohon = ReturnType<typeof render>;

interface TitikBentuk {
  cx: number;
  r: number;
  fill?: string;
  stroke?: string;
}

function langkah(selesai: number | null): React.JSX.Element {
  return (
    <OrderSteps status={OrderStatus.PREPARING} statusText="Disiapkan" selesai={selesai} />
  );
}

function ukurRel(pohon: Pohon, lebar = LEBAR): void {
  fireEvent(pohon.getByTestId('rel-langkah'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: lebar, height: TINGGI_REL } },
  });
}

function titikRel(pohon: Pohon): TitikBentuk[] {
  return within(pohon.getByTestId('rel-langkah'))
    .UNSAFE_getAllByType(Circle)
    .map((el) => ({
      cx: el.props.cx,
      r: el.props.r,
      fill: el.props.fill,
      stroke: el.props.stroke,
    }));
}

function ujungProgres(pohon: Pohon): number {
  const garis = within(pohon.getByTestId('rel-langkah')).UNSAFE_getAllByType(Line);
  const progres = garis.find((el) => el.props.stroke === themes.gelap.action);
  return progres?.props.animatedProps.x2;
}

function bentukAkhir(pohon: Pohon): unknown {
  return {
    titik: titikRel(pohon),
    ujung: ujungProgres(pohon),
    label: LABEL.map((teks) => {
      const gaya = StyleSheet.flatten(pohon.getByText(teks).props.style);
      return { teks, color: gaya.color, fontFamily: gaya.fontFamily };
    }),
  };
}

describe('OrderSteps', () => {
  it('satu langkah selesai menampilkan langkah kedua dan titik yang sedang jalan', () => {
    const pohon = render(langkah(1));
    ukurRel(pohon);

    expect(pohon.getByText('Langkah 2 dari 4')).toBeTruthy();

    const titik = titikRel(pohon);
    expect(titik.filter((t) => t.r === 12.25).map((t) => t.cx)).toEqual([37]);
    expect(
      titik.filter((t) => t.r === 11 && t.stroke === themes.gelap.action).map((t) => t.cx),
    ).toEqual([111]);
    expect(titik.filter((t) => t.r === 4).map((t) => t.cx)).toEqual([111]);
    expect(
      titik.filter((t) => t.r === 11 && t.stroke === themes.gelap.rail).map((t) => t.cx),
    ).toEqual([111, 185, 259]);

    expect(ujungProgres(pohon)).toBe(111);
  });

  it('label langkah mengikuti posisi titiknya', () => {
    const pohon = render(langkah(1));
    ukurRel(pohon);

    const diterima = StyleSheet.flatten(pohon.getByText('Diterima').props.style);
    expect(diterima.color).toBe(themes.gelap.textMuted);
    expect(diterima.fontFamily).toBe(type.bodyXs.fontFamily);

    const diantar = StyleSheet.flatten(pohon.getByText('Diantar').props.style);
    expect(diantar.color).toBe(themes.gelap.text);
    expect(diantar.fontFamily).toBe(type.labelSm.fontFamily);

    const tunai = StyleSheet.flatten(pohon.getByText('Tunai').props.style);
    expect(tunai.color).toBe(themes.gelap.textSubtle);
    expect(tunai.fontFamily).toBe(type.bodyXs.fontFamily);

    const selesai = StyleSheet.flatten(pohon.getByText('Selesai').props.style);
    expect(selesai.color).toBe(themes.gelap.textSubtle);
  });

  it('dua dan tiga langkah selesai menggeser ujung progres', () => {
    const dua = render(langkah(2));
    ukurRel(dua);
    expect(dua.getByText('Langkah 3 dari 4')).toBeTruthy();
    expect(ujungProgres(dua)).toBe(185);

    const tiga = render(langkah(3));
    ukurRel(tiga);
    expect(tiga.getByText('Langkah 4 dari 4')).toBeTruthy();
    expect(ujungProgres(tiga)).toBe(259);
  });

  it('empat langkah selesai menampilkan empat titik bercentang tanpa teks langkah', () => {
    const pohon = render(langkah(4));
    ukurRel(pohon);

    expect(pohon.queryByText(/Langkah/)).toBeNull();

    const titik = titikRel(pohon);
    expect(titik.filter((t) => t.r === 12.25).map((t) => t.cx)).toEqual([37, 111, 185, 259]);
    expect(ujungProgres(pohon)).toBe(259);

    LABEL.forEach((teks) => {
      expect(StyleSheet.flatten(pohon.getByText(teks).props.style).color).toBe(
        themes.gelap.textMuted,
      );
    });
  });

  it('tanpa langkah selesai hanya label status yang tampil', () => {
    const pohon = render(langkah(null));

    expect(pohon.getByText('Disiapkan')).toBeTruthy();
    expect(pohon.queryByTestId('rel-langkah')).toBeNull();
    expect(pohon.queryByText('Diterima')).toBeNull();
  });

  it('sebelum rel diukur relnya belum berisi gambar', () => {
    const pohon = render(langkah(1));

    const rel = within(pohon.getByTestId('rel-langkah'));
    expect(rel.UNSAFE_queryAllByType(Svg)).toHaveLength(0);
  });

  it('lebar rel menentukan jarak antar titik', () => {
    const pohon = render(langkah(1));
    ukurRel(pohon, 392);

    const titik = titikRel(pohon);
    expect(titik.filter((t) => t.r === 12.25).map((t) => t.cx)).toEqual([49]);
    expect(
      titik.filter((t) => t.r === 11 && t.stroke === themes.gelap.action).map((t) => t.cx),
    ).toEqual([147]);
    expect(titik.filter((t) => t.r === 4).map((t) => t.cx)).toEqual([147]);
    expect(
      titik.filter((t) => t.r === 11 && t.stroke === themes.gelap.rail).map((t) => t.cx),
    ).toEqual([147, 245, 343]);
  });

  it('kenaikan langkah memberi bentuk akhir yang sama dengan render langsung', () => {
    const langsung = render(langkah(2));
    ukurRel(langsung);

    const naik = render(langkah(1));
    ukurRel(naik);
    naik.rerender(langkah(2));
    naik.rerender(langkah(2));

    expect(bentukAkhir(naik)).toEqual(bentukAkhir(langsung));

    const centang = naik.UNSAFE_getAllByType(DrawnStroke);
    const bergerak = centang.filter((el) => el.props.animate);
    expect(bergerak).toHaveLength(1);
    expect(bergerak[0].props.d).toContain('105.5');
  });

  it('di dalam jendela awal kenaikan langkah tidak beranimasi', () => {
    const pohon = render(<InitialWindowProvider>{langkah(1)}</InitialWindowProvider>);
    ukurRel(pohon);
    pohon.rerender(<InitialWindowProvider>{langkah(2)}</InitialWindowProvider>);
    pohon.rerender(<InitialWindowProvider>{langkah(2)}</InitialWindowProvider>);

    const centang = pohon.UNSAFE_getAllByType(DrawnStroke);
    expect(centang.filter((el) => el.props.animate)).toHaveLength(0);
    expect(ujungProgres(pohon)).toBe(185);
  });

  it('kurangi gerakan: kenaikan langkah tidak beranimasi dan label lama hilang', () => {
    const reanimated = require('react-native-reanimated') as {
      useReducedMotion: () => boolean;
    };
    const spyGerak = jest.spyOn(reanimated, 'useReducedMotion').mockReturnValue(true);

    const pohon = render(
      <OrderSteps status={OrderStatus.OUT_FOR_DELIVERY} statusText="Sedang diantar" selesai={3} />,
    );
    ukurRel(pohon);
    pohon.rerender(
      <OrderSteps status={OrderStatus.DELIVERED} statusText="Selesai" selesai={4} />,
    );
    pohon.rerender(
      <OrderSteps status={OrderStatus.DELIVERED} statusText="Selesai" selesai={4} />,
    );

    const pil = within(pohon.getByTestId('pil-status'));
    expect(pil.getByText('Selesai')).toBeTruthy();
    expect(
      pohon.queryByText('Sedang diantar', { includeHiddenElements: true }),
    ).toBeNull();

    const centang = pohon.UNSAFE_getAllByType(DrawnStroke);
    expect(centang).toHaveLength(4);
    centang.forEach((el) => {
      expect(el.props.animate).toBe(false);
    });

    spyGerak.mockRestore();
  });
});
