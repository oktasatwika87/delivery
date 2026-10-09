/**
 * Unit tests untuk offlineStorage.ts
 *
 * Test focus:
 * - State number jadi DownloadState enum mapping (0/1/2 jadi inactive/active/complete)
 * - PackInfo transformation
 * - Retry logic
 * - listPacks, deletePack
 */

import { offlineStorage, stateFromNumber } from './offlineStorage';
import { OfflineManager } from '@maplibre/maplibre-react-native';

// Mock react-native-config
jest.mock('react-native-config', () => ({
  __esModule: true,
  default: {
    API_BASE_URL: 'http://10.0.2.2:3000',
    TILE_BASE_URL: 'http://10.0.2.2:8080',
  },
}));

// Helper: mock pack dengan status
function mockPackWithStatus(name: string, state: number, percentage: number) {
  return {
    name,
    status: jest.fn().mockResolvedValue({
      state,
      percentage,
      completedTileCount: percentage,
      completedTileSize: percentage * 1024,
      requiredResourceCount: 100,
    }),
  };
}

describe('offlineStorage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('stateFromNumber mapping', () => {
    test('maps 0 jadi inactive', () => {
      expect(stateFromNumber(0)).toBe('inactive');
    });

    test('maps 1 jadi active', () => {
      expect(stateFromNumber(1)).toBe('active');
    });

    test('maps 2 jadi complete', () => {
      expect(stateFromNumber(2)).toBe('complete');
    });

    test('unknown state defaults to inactive', () => {
      expect(stateFromNumber(99)).toBe('inactive');
      expect(stateFromNumber(-1)).toBe('inactive');
      expect(stateFromNumber(3)).toBe('inactive');
    });
  });

  describe('listPacks()', () => {
    test('returns empty array when no packs', async () => {
      (OfflineManager.getPacks as jest.Mock).mockResolvedValue([]);
      const packs = await offlineStorage.listPacks();
      expect(packs).toEqual([]);
    });

    test('returns packs with correct DownloadState mapping', async () => {
      const mockPacks = [
        mockPackWithStatus('denpasar', 0, 0),    // inactive
        mockPackWithStatus('kuta-badung', 1, 50), // active
        mockPackWithStatus('ubud', 2, 100),      // complete
      ];
      (OfflineManager.getPacks as jest.Mock).mockResolvedValue(mockPacks);

      const packs = await offlineStorage.listPacks();

      expect(packs).toHaveLength(3);
      expect(packs[0].state).toBe('inactive');
      expect(packs[0].percentage).toBe(0);
      expect(packs[1].state).toBe('active');
      expect(packs[1].percentage).toBe(50);
      expect(packs[2].state).toBe('complete');
      expect(packs[2].percentage).toBe(100);
    });

    test('handles pack status() throwing gracefully', async () => {
      const mockPacks = [
        {
          name: 'error-pack',
          status: jest.fn().mockRejectedValue(new Error('Pack corrupted')),
        },
      ];
      (OfflineManager.getPacks as jest.Mock).mockResolvedValue(mockPacks);

      const packs = await offlineStorage.listPacks();
      expect(packs).toEqual([]);
    });
  });

  describe('totalUsedBytes()', () => {
    test('sums completedTileSize from all packs', async () => {
      const mockPacks = [
        mockPackWithStatus('denpasar', 2, 100),
        mockPackWithStatus('kuta-badung', 2, 100),
      ];
      (OfflineManager.getPacks as jest.Mock).mockResolvedValue(mockPacks);

      const total = await offlineStorage.totalUsedBytes();
      // Each pack: 100 * 1024 = 102400 bytes
      expect(total).toBe(204800);
    });
  });

  describe('isStorageLow()', () => {
    test('returns false when under 200MB threshold', async () => {
      const mockPacks = [
        mockPackWithStatus('small-pack', 2, 50), // 50 * 1024 = 51200 bytes
      ];
      (OfflineManager.getPacks as jest.Mock).mockResolvedValue(mockPacks);

      const isLow = await offlineStorage.isStorageLow();
      expect(isLow).toBe(false);
    });

    test('returns true when over 200MB threshold', async () => {
      // Create pack with > 200MB
      const largePack = {
        name: 'large-pack',
        status: jest.fn().mockResolvedValue({
          state: 2,
          percentage: 100,
          completedTileCount: 100,
          completedTileSize: 201 * 1024 * 1024, // 201 MB
          requiredResourceCount: 100,
        }),
      };
      (OfflineManager.getPacks as jest.Mock).mockResolvedValue([largePack]);

      const isLow = await offlineStorage.isStorageLow();
      expect(isLow).toBe(true);
    });
  });

  describe('checkStorageBeforeDownload()', () => {
    test('returns null when estimated tiles fit in budget', async () => {
      const mockPacks = [
        mockPackWithStatus('small-pack', 2, 10), // 10 * 8KB = 80KB
      ];
      (OfflineManager.getPacks as jest.Mock).mockResolvedValue(mockPacks);

      const warning = await offlineStorage.checkStorageBeforeDownload(1000);
      // 80KB + 1000 * 8KB = ~8.08MB, well under 200MB
      expect(warning).toBeNull();
    });

    test('returns warning message when over budget', async () => {
      // Create pack with ~100MB already used
      const largePack = {
        name: 'large-pack',
        status: jest.fn().mockResolvedValue({
          state: 2,
          percentage: 100,
          completedTileCount: 100,
          completedTileSize: 100 * 1024 * 1024, // 100 MB
          requiredResourceCount: 100,
        }),
      };
      (OfflineManager.getPacks as jest.Mock).mockResolvedValue([largePack]);

      // 100MB + 20000 tiles * 8KB = 100MB + 160MB = 260MB > 200MB
      const warning = await offlineStorage.checkStorageBeforeDownload(20000);
      expect(warning).toContain('Storage warning');
      expect(warning).toContain('MB');
    });
  });

  describe('downloadRegion()', () => {
    // Mutable bounds type (not readonly)
    // NOTE: bounds order is NE-first per OfflineCreatePackOptions contract.
    const mockInput = {
      name: 'test-region',
      bounds: [[106.95, -6.1], [106.7, -6.3]] as [[number, number], [number, number]],
      minZoom: 10,
      maxZoom: 16,
    };

    beforeEach(() => {
      jest.clearAllMocks();
      // Reset timer for fake timers tests
      jest.useRealTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('berhasil pada percobaan pertama (no retry needed)', async () => {
      const errorCallback = jest.fn();

      // createPack succeeds immediately on first call
      (OfflineManager.createPack as jest.Mock).mockResolvedValue(undefined);

      await offlineStorage.downloadRegion(mockInput, jest.fn(), errorCallback);

      // createPack called exactly once (no retry needed)
      expect(OfflineManager.createPack).toHaveBeenCalledTimes(1);
      expect(OfflineManager.createPack).toHaveBeenCalledWith(
        expect.objectContaining({
          name: mockInput.name,
          styleURL: 'http://10.0.2.2:8080/styles/bali/style.json',
          bounds: mockInput.bounds,
          minZoom: mockInput.minZoom,
          maxZoom: mockInput.maxZoom,
        }),
        expect.any(Function),
        expect.any(Function),
      );
      expect(errorCallback).not.toHaveBeenCalled();
    });

    test('gagal 1x lalu berhasil, retry dipanggil ulang dengan exponential backoff', async () => {
      jest.useFakeTimers();

      const onProgress = jest.fn();
      const onError = jest.fn();

      // Fail first, succeed second
      let callCount = 0;
      (OfflineManager.createPack as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call fails
          return Promise.reject(new Error('Network timeout'));
        }
        // Second call: simulate progress callback being set up, then succeed
        setTimeout(() => {
          onProgress(null, {
            state: 2,
            percentage: 100,
            completedTileCount: 100,
            completedTileSize: 1024,
            requiredResourceCount: 100,
          });
        }, 10);
        return Promise.resolve();
      });

      const input = {
        name: 'retry-test-1',
        bounds: mockInput.bounds,
        minZoom: mockInput.minZoom,
        maxZoom: mockInput.maxZoom,
      };

      const promise = offlineStorage.downloadRegion(input, onProgress, onError);

      // Advance time past the first retry delay (1500ms)
      await jest.advanceTimersByTimeAsync(1600);

      const result = await promise;

      // createPack called twice (initial + 1 retry)
      expect(OfflineManager.createPack).toHaveBeenCalledTimes(2);
      expect(result.name).toBe('retry-test-1');
    });

    test('gagal 2x lalu berhasil, dua retry dengan exponential backoff total ~4500ms', async () => {
      jest.useFakeTimers();

      let callCount = 0;
      const onProgress = jest.fn();
      const onError = jest.fn();

      (OfflineManager.createPack as jest.Mock).mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          // Fail first 2 attempts
          return Promise.reject(new Error(`Attempt ${callCount} failed`));
        }
        // Third attempt succeeds
        setTimeout(() => {
          onProgress(null, {
            state: 2,
            percentage: 100,
            completedTileCount: 100,
            completedTileSize: 1024,
            requiredResourceCount: 100,
          });
        }, 10);
        return Promise.resolve();
      });

      const input = {
        name: 'retry-test-2',
        bounds: mockInput.bounds,
        minZoom: mockInput.minZoom,
        maxZoom: mockInput.maxZoom,
      };

      const promise = offlineStorage.downloadRegion(input, onProgress, onError);

      // Total delay should be ~4500ms (1500 + 3000)
      await jest.advanceTimersByTimeAsync(4600);

      const result = await promise;

      // createPack called 3 times (initial + 2 retries)
      expect(OfflineManager.createPack).toHaveBeenCalledTimes(3);
      expect(result.name).toBe('retry-test-2');
    });

    test('gagal 3x berhenti retry dan error di-propagate', async () => {
      const errorCallback = jest.fn();

      // Track attempts
      let attempts = 0;

      (OfflineManager.createPack as jest.Mock).mockImplementation(
        (_options, _onProgress, onError) => {
          attempts++;
          // Call error callback like real implementation would
          onError(null, { message: 'Network timeout' });
          // Return rejected promise so catch block triggers
          return Promise.reject(new Error('Network timeout'));
        },
      );

      await expect(
        offlineStorage.downloadRegion(mockInput, jest.fn(), errorCallback),
      ).rejects.toThrow('Network timeout');

      // createPack called exactly 3 times (initial + 2 retries = 3 attempts)
      expect(OfflineManager.createPack).toHaveBeenCalledTimes(3);
      expect(attempts).toBe(3);
      // Error callback should be called with retry exhausted message
      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('failed after 3 retries'),
        }),
      );
    });

    test('progress listener terpanggil selama download berhasil', async () => {
      jest.useFakeTimers();

      const progressCallback = jest.fn();

      // createPack calls onProgress(pack, status) - we need pack to have .name
      (OfflineManager.createPack as jest.Mock).mockImplementation(
        (_options, onProgress) => {
          // Create mock pack with name property (required by packInfoFromStatus)
          const mockPack = { name: mockInput.name };

          // Simulate async progress events
          setTimeout(() => {
            onProgress(mockPack, {
              state: 1,
              percentage: 50,
              completedTileCount: 50,
              completedTileSize: 51200,
              requiredResourceCount: 100,
            });
          }, 10);
          setTimeout(() => {
            onProgress(mockPack, {
              state: 2,
              percentage: 100,
              completedTileCount: 100,
              completedTileSize: 102400,
              requiredResourceCount: 100,
            });
          }, 20);
          return Promise.resolve();
        },
      );

      const promise = offlineStorage.downloadRegion(mockInput, progressCallback);

      // Advance time to let all setTimeout callbacks execute
      await jest.advanceTimersByTimeAsync(100);

      await promise;

      // Progress callback called with intermediate and final states
      expect(progressCallback).toHaveBeenCalledTimes(2);
      expect(progressCallback).toHaveBeenNthCalledWith(1, expect.objectContaining({
        percentage: 50,
        state: 'active',
      }));
      expect(progressCallback).toHaveBeenNthCalledWith(2, expect.objectContaining({
        percentage: 100,
        state: 'complete',
      }));
    });

    test('retry tidak infinite loop, berhenti setelah MAX_RETRY_ATTEMPTS', async () => {
      const MAX_ATTEMPTS = 3;
      const errorCallback = jest.fn();

      // createPack always fails - need pack with name to avoid crash
      (OfflineManager.createPack as jest.Mock).mockImplementation(
        (_options, _onProgress, onError) => {
          const mockPack = { name: mockInput.name };
          // onError receives (pack, err) - err must have message property
          onError(mockPack, { message: 'Network error' });
          return Promise.reject(new Error('Network error'));
        },
      );

      await expect(
        offlineStorage.downloadRegion(mockInput, jest.fn(), errorCallback),
      ).rejects.toThrow('Network error');

      // Should not exceed MAX_RETRY_ATTEMPTS
      expect(OfflineManager.createPack).toHaveBeenCalledTimes(MAX_ATTEMPTS);

      // Error callback called once at the end with retry exhausted message
      expect(errorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining(`${MAX_ATTEMPTS} retries`),
        }),
      );
    });
  });

  describe('deletePack()', () => {
    test('calls OfflineManager.deletePack with correct name', async () => {
      (OfflineManager.deletePack as jest.Mock).mockResolvedValue(undefined);

      await offlineStorage.deletePack('denpasar');

      expect(OfflineManager.deletePack).toHaveBeenCalledWith('denpasar');
    });
  });
});
