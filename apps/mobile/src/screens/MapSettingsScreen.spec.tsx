/**
 * Unit tests untuk MapSettingsScreen.tsx
 *
 * Test focus:
 * - Baris preset yang sedang diunduh menampilkan persen dari listener progres
 * - Event complete memicu baca ulang daftar region
 * - Event error memicu baca ulang daftar region dan error tetap tampil
 * - Event complete kedua untuk pack yang sama tidak memicu baca ulang lagi
 * - Tidak ada pembaruan state setelah layar ditutup
 */

import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { RenderResult } from '@testing-library/react-native';

import { MapSettingsScreen } from './MapSettingsScreen';
import { offlineStorage } from '../map/offlineStorage';
import type { DownloadProgress, PackInfo } from '../map/offlineStorage';

// Mock database, MapSettingsScreen tidak memakai database
jest.mock('@nozbe/watermelondb/react', () => ({
  withDatabase: (Component: React.ComponentType<object>) => Component,
}));

jest.mock('../map/offlineStorage', () => ({
  offlineStorage: {
    listPacks: jest.fn<Promise<PackInfo[]>, []>(),
    downloadRegion: jest.fn(),
    checkStorageBeforeDownload: jest.fn<Promise<string | null>, []>(),
    deletePack: jest.fn<Promise<void>, [string]>(),
  },
}));

// Test helpers

function buatPackInfo(override: Partial<PackInfo> = {}): PackInfo {
  return {
    name: 'denpasar',
    bounds: [[115.22, -8.63], [115.18, -8.67]],
    state: 'complete',
    percentage: 100,
    completedTileCount: 100,
    completedTileSize: 1024,
    requiredResourceCount: 100,
    ...override,
  };
}

function buatProgres(override: Partial<DownloadProgress> = {}): DownloadProgress {
  return {
    name: 'denpasar',
    bounds: [[115.22, -8.63], [115.18, -8.67]],
    state: 'active',
    percentage: 0,
    completedTileCount: 0,
    completedTileSize: 0,
    requiredResourceCount: 100,
    ...override,
  };
}

/** Listener progres dan error yang diterima offlineStorage.downloadRegion. */
interface ListenerTertangkap {
  progres: (progress: DownloadProgress) => void;
  error: (error: { message: string }) => void;
}

let tertangkap: ListenerTertangkap | null = null;

/** Tekan tombol Download preset pertama, listener progres akan tertangkap. */
async function tekanDownload(): Promise<RenderResult> {
  const layar = render(<MapSettingsScreen database={{ get: jest.fn() }} />);
  const tombolDownload = await layar.findAllByText('Download');
  await act(async () => {
    fireEvent.press(tombolDownload[0]);
  });
  return layar;
}

function jumlahListPacks(): number {
  return jest.mocked(offlineStorage.listPacks).mock.calls.length;
}

beforeEach(() => {
  jest.clearAllMocks();
  tertangkap = null;

  jest.mocked(offlineStorage.listPacks).mockResolvedValue([]);
  jest.mocked(offlineStorage.checkStorageBeforeDownload).mockResolvedValue(null);
  jest.mocked(offlineStorage.downloadRegion).mockImplementation(
    (_input, onProgress, onError) => {
      tertangkap = {
        progres: onProgress,
        error: onError ?? (() => {}),
      };
      return Promise.resolve({ name: 'denpasar', pack: null });
    },
  );
});

describe('MapSettingsScreen', () => {
  describe('progres unduhan', () => {
    test('baris preset menampilkan persen dari listener progres', async () => {
      const layar = await tekanDownload();
      expect(tertangkap).not.toBeNull();

      await act(async () => {
        tertangkap?.progres(buatProgres({ state: 'active', percentage: 42 }));
      });

      expect(layar.getByText(/42%/)).toBeTruthy();
    });
  });

  describe('event complete', () => {
    test('memicu baca ulang dan region muncul di daftar', async () => {
      const layar = await tekanDownload();
      jest.mocked(offlineStorage.listPacks).mockResolvedValue([buatPackInfo()]);
      const sebelum = jumlahListPacks();

      await act(async () => {
        tertangkap?.progres(buatProgres({ state: 'complete', percentage: 100 }));
      });

      await waitFor(() => {
        expect(jumlahListPacks()).toBeGreaterThan(sebelum);
      });
      expect(layar.getByText('denpasar')).toBeTruthy();
    });

    test('kedua untuk pack yang sama tidak memicu baca ulang lagi', async () => {
      await tekanDownload();

      await act(async () => {
        tertangkap?.progres(buatProgres({ state: 'complete', percentage: 100 }));
      });
      const sesudah = jumlahListPacks();

      await act(async () => {
        tertangkap?.progres(buatProgres({ state: 'complete', percentage: 100 }));
      });

      expect(jumlahListPacks()).toBe(sesudah);
    });
  });

  describe('event error', () => {
    test('memicu baca ulang dan error tetap tampil', async () => {
      await tekanDownload();
      const sebelum = jumlahListPacks();

      await act(async () => {
        tertangkap?.error({ message: 'Network timeout' });
      });

      await waitFor(() => {
        expect(jumlahListPacks()).toBeGreaterThan(sebelum);
      });
      expect(Alert.alert).toHaveBeenCalledWith('Download error', 'Network timeout');
    });
  });

  describe('layar ditutup', () => {
    test('tidak ada pembaruan state setelah layar ditutup', async () => {
      const layar = await tekanDownload();
      layar.unmount();
      const sebelum = jumlahListPacks();

      await act(async () => {
        tertangkap?.progres(buatProgres({ state: 'complete', percentage: 100 }));
      });

      expect(jumlahListPacks()).toBe(sebelum);
    });
  });
});
