/**
 * Tes centang: garis tengah ikon centang yang digambar dari awal ke akhir.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Path, Svg } from 'react-native-svg';

import { CheckMark } from './CheckMark';

const WARNA = '#0b0b0c';

describe('centang', () => {
  it('meneruskan ukuran dan warna', () => {
    const { UNSAFE_getByType } = render(<CheckMark size={20} color={WARNA} />);

    const svg = UNSAFE_getByType(Svg);
    expect(svg.props.width).toBe(20);
    expect(svg.props.height).toBe(20);
    expect(UNSAFE_getByType(Path).props.stroke).toBe(WARNA);
  });

  it('meneruskan data garis centang', () => {
    const { UNSAFE_getByType } = render(<CheckMark size={20} color={WARNA} />);

    const path = UNSAFE_getByType(Path);
    expect(path.props.d).toBe('M4.93 12.24 L9.46 16.77 L19.06 7.17');
    expect(path.props.strokeWidth).toBe(1.73);
  });

  it('bisa digambar tanpa animasi', () => {
    const { UNSAFE_getByType } = render(
      <CheckMark size={20} color={WARNA} animate={false} />,
    );

    expect(UNSAFE_getByType(Path).props.animatedProps.strokeDashoffset).toBe(0);
  });
});
