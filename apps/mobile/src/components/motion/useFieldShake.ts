/**
 * Getaran kotak kolom isian.
 *
 * Kotak kolom bergetar singkat waktu pengiriman gagal, jadi pengguna tahu
 * ada yang salah tanpa harus membaca pesan galatnya.
 */

import { useCallback } from 'react';
import {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { motion } from '../../theme/tokens';

/** Durasi tiap arah goyangan, totalnya sama dengan motion.duration.fieldShake. */
const DURASI_GOYANG = [50, 100, 100, 50];

export function useFieldShake() {
  const geser = useSharedValue(0);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: geser.value }],
  }));

  const shake = useCallback(() => {
    const jarak = motion.shakeDistance;
    geser.value = withSequence(
      withTiming(jarak, { duration: DURASI_GOYANG[0] }),
      withTiming(-jarak, { duration: DURASI_GOYANG[1] }),
      withTiming(jarak, { duration: DURASI_GOYANG[2] }),
      withTiming(0, { duration: DURASI_GOYANG[3] }),
    );
  }, [geser]);

  return { style, shake };
}
