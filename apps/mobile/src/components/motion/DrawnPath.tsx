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

export interface DrawnStrokeProps {
  /** Data path SVG. */
  d: string;
  /** Panjang path, dihitung pemanggil. */
  length: number;
  color: string;
  strokeWidth: number;
  /** Kalau false, garis langsung utuh tanpa digambar. */
  animate?: boolean;
  /** Jeda sebelum garis digambar, dalam milidetik. */
  delay?: number;
}

/**
 * Path yang digambar, tanpa wadah gambar.
 *
 * Dipakai kalau garisnya harus berada di dalam gambar yang lebih besar,
 * misalnya titik-titik pada rel langkah order.
 */
export function DrawnStroke({
  d,
  length,
  color,
  strokeWidth,
  animate = true,
  delay = 0,
}: DrawnStrokeProps): React.JSX.Element {
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
  );
}

interface DrawnPathProps extends DrawnStrokeProps {
  viewBox: string;
  width: number;
  height: number;
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
  return (
    <Svg width={width} height={height} viewBox={viewBox}>
      <DrawnStroke
        d={d}
        length={length}
        color={color}
        strokeWidth={strokeWidth}
        animate={animate}
        delay={delay}
      />
    </Svg>
  );
}
