/**
 * Centang.
 *
 * Garis tengah dan tebal ikon centang, digambar dari awal ke akhir.
 */

import React from 'react';

import { DrawnPath } from './DrawnPath';

interface CheckMarkProps {
  size: number;
  color: string;
  /** Kalau false, centang langsung utuh tanpa digambar. */
  animate?: boolean;
}

export function CheckMark({
  size,
  color,
  animate = true,
}: CheckMarkProps): React.JSX.Element {
  return (
    <DrawnPath
      d="M4.93 12.24 L9.46 16.77 L19.06 7.17"
      length={21}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      color={color}
      strokeWidth={1.73}
      animate={animate}
    />
  );
}
