/**
 * Skala tombol saat ditekan.
 *
 * Tombol yang ditekan mengecil sedikit, lalu kembali begitu dilepas. Kalau
 * tombolnya mati, skala langsung kembali ke normal.
 */

import { useCallback, useEffect } from 'react';
import { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { motion } from '../../theme/tokens';

export function usePressScale(enabled: boolean) {
  const skala = useSharedValue(1);

  useEffect(() => {
    if (!enabled) {
      skala.value = 1;
    }
  }, [enabled, skala]);

  const onPressIn = useCallback(() => {
    if (!enabled) return;
    skala.value = withSpring(motion.pressScale, {
      duration: motion.duration.press,
      dampingRatio: 1,
    });
  }, [enabled, skala]);

  const onPressOut = useCallback(() => {
    if (!enabled) return;
    skala.value = withSpring(1, {
      duration: motion.duration.release,
      dampingRatio: 1,
    });
  }, [enabled, skala]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: skala.value }],
  }));

  return { style, onPressIn, onPressOut };
}
