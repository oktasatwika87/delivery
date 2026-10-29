/**
 * Tes komponen Logo.
 *
 * react-native-svg dipetakan ke tiruan di src/__mocks__/react-native-svg.ts,
 * jadi tes memeriksa props Svg, Polygon, dan Path yang diteruskan.
 */

import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import Svg, { Path, Polygon } from 'react-native-svg';

import { Logo } from './Logo';
import { colors } from './tokens';

const VIEW_BOX = '0 -22 176 144';

describe('Logo', () => {
  it('Svg menerima viewBox logo', () => {
    const { UNSAFE_getByType } = render(<Logo />);
    expect(UNSAFE_getByType(Svg).props.viewBox).toBe(VIEW_BOX);
  });

  it('tinggi bawaan 32 dan lebarnya ikut perbandingan logo', () => {
    const { UNSAFE_getByType } = render(<Logo />);
    const svg = UNSAFE_getByType(Svg);
    expect(svg.props.height).toBe(32);
    expect(svg.props.width).toBeCloseTo((32 * 176) / 144);
  });

  it('huruf M dan D memakai warna bawaan dari token', () => {
    const { UNSAFE_getByType } = render(<Logo />);
    expect(UNSAFE_getByType(Polygon).props.fill).toBe(colors.text);
    expect(UNSAFE_getByType(Path).props.fill).toBe(colors.brandRed);
  });

  it('varian inverse memakai warna terang dari token', () => {
    const { UNSAFE_getByType } = render(<Logo variant="inverse" />);
    expect(UNSAFE_getByType(Polygon).props.fill).toBe(colors.textInverse);
    expect(UNSAFE_getByType(Path).props.fill).toBe(colors.brandRedInverse);
  });

  it('logo berperan sebagai gambar dengan label M Delivery', () => {
    const { UNSAFE_getByType } = render(<Logo />);
    const wadah = UNSAFE_getByType(View);
    expect(wadah.props.accessible).toBe(true);
    expect(wadah.props.accessibilityRole).toBe('image');
    expect(wadah.props.accessibilityLabel).toBe('M Delivery');
  });
});
