/**
 * Tes komponen Logo.
 *
 * react-native-svg dipetakan ke tiruan di src/__mocks__/react-native-svg.ts,
 * jadi tes memeriksa props Svg, G, dan Path yang diteruskan.
 */

import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import Svg, { G, Path } from 'react-native-svg';

import { Logo } from './Logo';
import { ThemeProvider } from './ThemeProvider';
import { themes } from './tokens';

const VIEW_BOX = '0 0 200 172';

describe('Logo', () => {
  it('Svg menerima viewBox logo', () => {
    const { UNSAFE_getByType } = render(<Logo />);
    expect(UNSAFE_getByType(Svg).props.viewBox).toBe(VIEW_BOX);
  });

  it('tinggi bawaan 43 dan lebarnya ikut perbandingan logo', () => {
    const { UNSAFE_getByType } = render(<Logo />);
    const svg = UNSAFE_getByType(Svg);
    expect(svg.props.height).toBe(43);
    expect(svg.props.width).toBeCloseTo((43 * 200) / 172);
  });

  it('huruf M digambar dengan garis warna logo dari tema', () => {
    const { UNSAFE_getAllByType } = render(<Logo />);
    const paths = UNSAFE_getAllByType(Path);
    const hurufM = paths.find((p) => p.props.d?.startsWith('M20 108'));
    expect(hurufM?.props.stroke).toBe(themes.gelap.logoM);
    expect(hurufM?.props.fill).toBe('none');
  });

  it('cangkang helm diisi warna helm dari tema', () => {
    const { UNSAFE_getAllByType } = render(<Logo />);
    const paths = UNSAFE_getAllByType(Path);
    const cangkang = paths.find((p) => p.props.d?.startsWith('M0 0 V-60'));
    expect(cangkang?.props.fill).toBe(themes.gelap.logoHelmet);
    expect(cangkang?.props.stroke).toBe(themes.gelap.logoLine);
  });

  it('tali menggantung dari kaki kanan M dan berada di luar grup helm', () => {
    const { UNSAFE_getAllByType, UNSAFE_getByType } = render(<Logo />);
    const paths = UNSAFE_getAllByType(Path);
    const tali = paths.find((p) => p.props.d?.startsWith('M95 98'));
    expect(tali?.props.stroke).toBe(themes.gelap.logoLine);
    const grup = UNSAFE_getByType(G);
    const anak = React.Children.toArray(grup.props.children);
    const adaTali = anak.some(
      (item) =>
        React.isValidElement<{ d?: string }>(item) &&
        item.props.d === 'M95 98 C103 90 120 92 118 116',
    );
    expect(adaTali).toBe(false);
  });

  it('helm digambar dalam grup yang dimiringkan', () => {
    const { UNSAFE_getByType } = render(<Logo />);
    expect(UNSAFE_getByType(G).props.transform).toBe('translate(118 120) rotate(34) scale(.7)');
  });

  it('warna logo ikut tema yang dipakai', () => {
    const { UNSAFE_getAllByType } = render(
      <ThemeProvider name="terang">
        <Logo />
      </ThemeProvider>,
    );
    const paths = UNSAFE_getAllByType(Path);
    const hurufM = paths.find((p) => p.props.d?.startsWith('M20 108'));
    expect(hurufM?.props.stroke).toBe(themes.terang.logoM);
  });

  it('logo berperan sebagai gambar dengan label M Delivery', () => {
    const { UNSAFE_getByType } = render(<Logo />);
    const wadah = UNSAFE_getByType(View);
    expect(wadah.props.accessible).toBe(true);
    expect(wadah.props.accessibilityRole).toBe('image');
    expect(wadah.props.accessibilityLabel).toBe('M Delivery');
  });
});
