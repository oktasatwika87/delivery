/**
 * Tes garis yang digambar: garis penanda yang mulai dari ujung lalu
 * digambar sampai ujung yang lain.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Path } from 'react-native-svg';

import { DrawnPath } from './DrawnPath';

const WARNA = '#ffffff';

function gambarPakai(props: {
  d?: string;
  length?: number;
  animate?: boolean;
}): ReturnType<typeof render> {
  return render(
    <DrawnPath
      d={props.d ?? 'M0 0 L10 10'}
      length={props.length ?? 14}
      viewBox="0 0 24 24"
      width={24}
      height={24}
      color={WARNA}
      strokeWidth={1.73}
      animate={props.animate}
    />,
  );
}

describe('garis digambar', () => {
  it('path menerima data, warna, dan tebal garis', () => {
    const { UNSAFE_getByType } = gambarPakai({});

    const path = UNSAFE_getByType(Path);
    expect(path.props.d).toBe('M0 0 L10 10');
    expect(path.props.stroke).toBe(WARNA);
    expect(path.props.strokeWidth).toBe(1.73);
  });

  it('pola putus sama dengan panjang garis', () => {
    const { UNSAFE_getByType } = gambarPakai({ length: 14 });

    expect(UNSAFE_getByType(Path).props.strokeDasharray).toEqual([14, 14]);
  });

  it('panjang garis dibulatkan ke atas', () => {
    const { UNSAFE_getByType } = gambarPakai({ length: 14.2 });

    expect(UNSAFE_getByType(Path).props.strokeDasharray).toEqual([15, 15]);
  });

  it('tanpa animasi garis langsung utuh', () => {
    const { UNSAFE_getByType } = gambarPakai({ animate: false });

    const path = UNSAFE_getByType(Path);
    expect(path.props.animatedProps.strokeDashoffset).toBe(0);
  });

  it('dengan animasi garis mulai dari ujung', () => {
    const { UNSAFE_getByType } = gambarPakai({ length: 14 });

    const path = UNSAFE_getByType(Path);
    expect(path.props.animatedProps.strokeDashoffset).toBe(14);
  });

  it('ujung garis membulat', () => {
    const { UNSAFE_getByType } = gambarPakai({});

    const path = UNSAFE_getByType(Path);
    expect(path.props.strokeLinecap).toBe('round');
    expect(path.props.strokeLinejoin).toBe('round');
    expect(path.props.fill).toBe('none');
  });
});
