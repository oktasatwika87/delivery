/**
 * Tes kartu daftar masuk: baris masuk berurutan cuma saat daftar pertama
 * terisi, baris yang sudah ada tidak digerakkan lagi.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { render, renderHook } from '@testing-library/react-native';

import {
  ListEnterRow,
  useListEnter,
  type ListEnterDecision,
} from './listEnter';

interface OpsiPelacak {
  initialCount: number;
  active?: boolean;
}

/**
 * Menjalankan pelacak sambil memperlakukan tiap id sebagai baris yang
 * terpasang, jadi keputusan diambil sebelum baris menandai dirinya terpakai.
 */
function renderPelacak(
  ids: string[],
  opsi: OpsiPelacak,
): {
  hasil: ListEnterDecision[];
  rerender: (idsBaru: string[], initialWindow?: boolean) => void;
} {
  const hasil: ListEnterDecision[] = [];
  const view = renderHook(
    ({
      ids: idsSekarang,
      initialWindow,
    }: {
      ids: string[];
      initialWindow: boolean;
    }) => {
      const idsTerakhir = React.useRef<readonly string[] | null>(null);
      const tracker = useListEnter(idsSekarang, {
        initialCount: opsi.initialCount,
        active: opsi.active,
      });
      // Baris baru diputuskan hanya kalau datanya berubah, jadi render
      // ulang lain tidak dihitung sebagai baris baru.
      if (idsTerakhir.current !== idsSekarang) {
        idsTerakhir.current = idsSekarang;
        hasil.length = 0;
        idsSekarang.forEach((id, index) => {
          hasil.push(tracker.decide(id, index, initialWindow));
        });
        idsSekarang.forEach((id) => {
          tracker.markUsed(id);
        });
      }
      return tracker;
    },
    { initialProps: { ids, initialWindow: false } },
  );

  return {
    hasil,
    rerender: (idsBaru: string[], initialWindow = false) =>
      view.rerender({ ids: idsBaru, initialWindow }),
  };
}

describe('pelacak masuk daftar', () => {
  it('baris awal masuk berurutan sesuai jeda', () => {
    const { hasil } = renderPelacak(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
      { initialCount: 9 },
    );

    expect(hasil.map((satu) => satu.kind)).toEqual([
      'stagger',
      'stagger',
      'stagger',
      'stagger',
      'stagger',
      'stagger',
      'stagger',
      'stagger',
      'stagger',
    ]);
    expect(hasil.map((satu) => satu.delay)).toEqual([
      0, 50, 100, 150, 200, 250, 300, 350, 350,
    ]);
  });

  it('id di luar initialCount tidak bergerak', () => {
    const { hasil } = renderPelacak(['a', 'b', 'c'], { initialCount: 2 });

    expect(hasil[2].kind).toBe('none');
  });

  it('data yang datang belakangan tetap masuk berurutan', () => {
    const { hasil, rerender } = renderPelacak([], { initialCount: 3 });

    rerender(['a', 'b', 'c']);

    expect(hasil.map((satu) => satu.kind)).toEqual([
      'stagger',
      'stagger',
      'stagger',
    ]);
    expect(hasil.map((satu) => satu.delay)).toEqual([0, 50, 100]);
  });

  it('id baru sesudah jendela masuk dari atas di posisi pertama', () => {
    const { hasil, rerender } = renderPelacak(['a', 'b', 'c'], {
      initialCount: 3,
    });

    rerender(['d', 'a', 'b', 'c']);

    expect(hasil[0].kind).toBe('fromAbove');
  });

  it('id baru sesudah jendela masuk dari bawah di tengah', () => {
    const { hasil, rerender } = renderPelacak(['a', 'b', 'c'], {
      initialCount: 3,
    });

    rerender(['a', 'b', 'c', 'd']);

    expect(hasil[3].kind).toBe('fromBelow');
  });

  it('id baru di dalam jendela tidak bergerak', () => {
    const { hasil, rerender } = renderPelacak(['a', 'b', 'c'], {
      initialCount: 3,
    });

    rerender(['a', 'b', 'c', 'd'], true);

    expect(hasil[3].kind).toBe('none');
  });

  it('id lama yang dipasang ulang tidak bergerak', () => {
    const { hasil, rerender } = renderPelacak(['a', 'b', 'c'], {
      initialCount: 3,
    });

    rerender(['a', 'b', 'c']);

    expect(hasil[0].kind).toBe('none');
  });

  it('id yang kembali setelah daftar sempat kosong dianggap baru', () => {
    const { hasil, rerender } = renderPelacak(['a', 'b'], {
      initialCount: 2,
    });

    rerender([]);
    rerender(['a']);

    expect(hasil[0].kind).toBe('fromAbove');
  });

  it('keputusan dua kali sebelum baris terpasang sama', () => {
    const { result } = renderHook(() => useListEnter(['a'], { initialCount: 1 }));

    const pertama = result.current.decide('a', 0, false);
    const kedua = result.current.decide('a', 0, false);

    expect(pertama.kind).toBe('stagger');
    expect(kedua).toEqual(pertama);
  });

  it('data pertama yang tidak aktif tidak bergerak', () => {
    const { hasil } = renderPelacak(['a', 'b'], {
      initialCount: 2,
      active: false,
    });

    expect(hasil.map((satu) => satu.kind)).toEqual(['none', 'none']);
  });
});

describe('baris daftar', () => {
  it('baris stagger dapat entering dan baris none tidak', () => {
    const { result } = renderHook(() =>
      useListEnter(['a', 'b'], { initialCount: 2 }),
    );
    const tracker = result.current;

    const barisPertama = render(
      <ListEnterRow tracker={tracker} id="a" index={0}>
        <Text>baris pertama</Text>
      </ListEnterRow>,
    );

    expect(barisPertama.UNSAFE_getByType(View).props.entering).toBeDefined();

    tracker.markUsed('a');
    const barisKedua = render(
      <ListEnterRow tracker={tracker} id="a" index={0}>
        <Text>baris kedua</Text>
      </ListEnterRow>,
    );

    expect(barisKedua.UNSAFE_getByType(View).props.entering).toBeUndefined();
  });
});
