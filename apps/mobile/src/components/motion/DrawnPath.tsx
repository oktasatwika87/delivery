/**
 * Garis yang digambar.
 *
 * Garis mulai dari ujung lalu digambar sampai ujung yang lain, jadi
 * kelihatan seperti digambar tangan.
 */

import React, { useEffect } from 'react';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { motion } from '../../theme/tokens';
import { standardEasing } from './presets';

const AnimatedPath = Animated.createAnimatedComponent(Path);

interface DrawnPathProps {
  /** Data path SVG. */
  d: string;
  /** Panjang path, dihitung pemanggil. */
  length: number;
  viewBox: string;
  width: number;
  height: number;
  color: string;
  strokeWidth: number;
  /** Kalau false, garis langsung utuh tanpa digambar. */
  animate?: boolean;
  /** Jeda sebelum garis digambar, dalam milidetik. */
  delay?: number;
}

export function DrawnPath({
  d,
  length,
  viewBox,
  width,
  height,
  color,
  strokeWidth,
  animate = true,
  delay = 0,
}: DrawnPathProps): React.JSX.Element {
  // Panjang dibulatkan ke atas, supaya ujung garis tidak jatuh di celah.
  const panjang = Math.ceil(length);
  const offset = useSharedValue(animate ? panjang : 0);

  useEffect(() => {
    if (!animate) {
      offset.value = 0;
      return;
    }
    offset.value = withDelay(
      delay,
      withTiming(0, { duration: motion.duration.drawLine, easing: standardEasing }),
    );
  }, [animate, delay, offset]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: offset.value,
  }));

  return (
    <Svg width={width} height={height} viewBox={viewBox}>
      <AnimatedPath
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={[panjang, panjang]}
        animatedProps={animatedProps}
      />
    </Svg>
  );
}
