/**
 * Kartu daftar masuk.
 *
 * Daftar yang baru terisi bergerak berurutan satu per satu, jadi mata bisa
 * menyusul baris yang masuk. Setelah itu baris yang baru muncul cuma
 * digerakkan seperlunya, dan baris yang sudah ada tetap diam.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Animated from 'react-native-reanimated';

import { enterFromAbove, enterFromBelow, staggerDelay } from './presets';
import { useInitialWindow } from './InitialWindow';

/** Keputusan gerak untuk satu baris. */
export interface ListEnterDecision {
  kind: 'stagger' | 'fromAbove' | 'fromBelow' | 'none';
  /** Jeda sebelum baris bergerak, cuma dipakai untuk 'stagger'. */
  delay?: number;
}

/** Pemantau daftar, dipakai baris untuk meminta keputusan geraknya. */
export interface ListEnterTracker {
  decide: (
    id: string,
    index: number,
    initialWindow: boolean,
  ) => ListEnterDecision;
  markUsed: (id: string) => void;
}

interface OpsiListEnter {
  /** Berapa baris pertama yang digerakkan, diisi dengan initialNumToRender. */
  initialCount: number;
  /** False kalau daftarnya sedang tersembunyi, misalnya di tab lain. */
  active?: boolean;
}

/**
 * Pelacak masuk daftar.
 *
 * Urutan baris pertama dicatat sekali, waktu data pertama tidak kosong
 * muncul. Urutan itu dipakai untuk memberi jeda antarbaris.
 */
export function useListEnter(
  ids: readonly string[],
  opsi: OpsiListEnter,
): ListEnterTracker {
  const { initialCount, active = true } = opsi;

  const [urutan, setUrutan] = useState<string[] | null>(null);
  const urutanRef = useRef<string[] | null>(null);
  const commitRef = useRef<readonly string[]>([]);
  const sudahCommitRef = useRef(false);
  const terpakaiRef = useRef<Set<string>>(new Set());

  // Data pertama dicatat saat render, bukan di efek, jadi urutan baris yang
  // pertama masuk sudah pasti walau data baru menyusul beberapa render
  // kemudian.
  if (urutan === null && ids.length > 0) {
    const baru = active ? ids.slice(0, initialCount) : [];
    urutanRef.current = baru;
    setUrutan(baru);
  }

  // Id dari commit sebelumnya dipakai untuk tahu baris mana yang sudah
  // pernah tampil, termasuk baris yang dipasang ulang karena digulir.
  // Daftar yang sempat kosong ikut diperbarui, jadi id yang kembali
  // setelahnya dianggap baru lagi.
  useEffect(() => {
    commitRef.current = ids;
    if (ids.length > 0) {
      sudahCommitRef.current = true;
    }
  }, [ids]);

  return useMemo<ListEnterTracker>(
    () => ({
      decide: (id, index, initialWindow) => {
        const daftar = urutanRef.current ?? [];
        const posisi = daftar.indexOf(id);
        if (posisi >= 0 && !terpakaiRef.current.has(id)) {
          return { kind: 'stagger', delay: staggerDelay(posisi) };
        }

        const commit = commitRef.current;
        if (!sudahCommitRef.current) {
          // Data pertama belum pernah ter-commit, jadi belum ada yang bisa
          // dipastikan soal baris ini.
          return { kind: 'none' };
        }
        if (commit.includes(id)) {
          return { kind: 'none' };
        }
        if (initialWindow) {
          return { kind: 'none' };
        }
        return index === 0 ? { kind: 'fromAbove' } : { kind: 'fromBelow' };
      },
      markUsed: (id) => {
        terpakaiRef.current.add(id);
      },
    }),
    [],
  );
}

type EnterAnimation = NonNullable<
  React.ComponentProps<typeof Animated.View>['entering']
>;
type ExitAnimation = NonNullable<
  React.ComponentProps<typeof Animated.View>['exiting']
>;

interface ListEnterRowProps {
  tracker: ListEnterTracker;
  id: string;
  index: number;
  /** Bentuk keluar, bentuknya diputuskan per layar. */
  exiting?: ExitAnimation;
  children: React.ReactNode;
}

/**
 * Satu baris daftar.
 *
 * Geraknya diputuskan sekali, waktu baris dipasang, lalu baris menandai
 * dirinya sudah terpakai supaya tidak digerakkan lagi.
 */
export function ListEnterRow({
  tracker,
  id,
  index,
  exiting,
  children,
}: ListEnterRowProps): React.JSX.Element {
  const dalamJendela = useInitialWindow();

  const [entering] = useState<EnterAnimation | undefined>(() => {
    const keputusan = tracker.decide(id, index, dalamJendela);
    switch (keputusan.kind) {
      case 'stagger':
        return enterFromBelow(keputusan.delay ?? 0);
      case 'fromAbove':
        return enterFromAbove();
      case 'fromBelow':
        return enterFromBelow();
      default:
        return undefined;
    }
  });

  useEffect(() => {
    tracker.markUsed(id);
  }, [tracker, id]);

  return (
    <Animated.View entering={entering} exiting={exiting}>
      {children}
    </Animated.View>
  );
}
