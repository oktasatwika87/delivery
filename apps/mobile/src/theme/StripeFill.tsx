/**
 * Isian belang miring.
 *
 * Dipakai sebagai lapisan di belakang lencana dan banner untuk menandai hal
 * yang perlu perhatian. Warnanya masuk lewat prop, jadi komponen ini tidak
 * perlu tahu soal tema.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

/** Penghitung modul supaya tiap instance punya id pattern sendiri. */
let hitungan = 0;

export interface StripeFillProps {
  /** Warna belang pertama. */
  color: string;
  /** Warna belang kedua. */
  colorAlt: string;
}

const UKURAN_KOTAK = 12;
const LEBAR_BELANG = 6;

export function StripeFill({ color, colorAlt }: StripeFillProps): React.JSX.Element {
  const [id] = useState(() => `belang-${hitungan++}`);

  return (
    <View style={styles.lapisan} pointerEvents="none">
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern
            id={id}
            patternUnits="userSpaceOnUse"
            width={UKURAN_KOTAK}
            height={UKURAN_KOTAK}
            patternTransform="rotate(135)"
          >
            <Rect x={0} y={0} width={LEBAR_BELANG} height={UKURAN_KOTAK} fill={color} />
            <Rect
              x={LEBAR_BELANG}
              y={0}
              width={LEBAR_BELANG}
              height={UKURAN_KOTAK}
              fill={colorAlt}
            />
          </Pattern>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  lapisan: {
    ...StyleSheet.absoluteFillObject,
  },
});
