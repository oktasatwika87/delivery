/**
 * Tahan selesai.
 *
 * Bentuk selesai (misalnya centang) ditahan sebentar sebelum hilang, jadi
 * mata sempat menangkap bahwa ada yang berubah.
 *
 * Yang ditahan cuma tampilan. Pemanggil tetap pakai data terbaru.
 */

import { useEffect, useState } from 'react';

import { motion } from '../../theme/tokens';
import { useInitialWindow } from './InitialWindow';

export type HoldDonePhase = 'waiting' | 'done' | 'hidden';

export function useHoldDone(waiting: boolean): HoldDonePhase {
  const dalamJendela = useInitialWindow();
  const [fase, setFase] = useState<HoldDonePhase>(
    waiting ? 'waiting' : 'hidden',
  );
  const [sebelumnya, setSebelumnya] = useState(waiting);

  // Perubahan fase dihitung saat render, bukan di efek, supaya tidak ada
  // satu render yang masih menampilkan bentuk menunggu padahal datanya
  // sudah selesai.
  if (sebelumnya !== waiting) {
    setSebelumnya(waiting);
    if (waiting) {
      setFase('waiting');
    } else {
      setFase(dalamJendela ? 'hidden' : 'done');
    }
  }

  useEffect(() => {
    if (fase !== 'done') {
      return;
    }
    const timer = setTimeout(() => {
      setFase('hidden');
    }, motion.duration.holdDone);
    return () => clearTimeout(timer);
  }, [fase]);

  return fase;
}
