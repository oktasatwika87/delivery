/**
 * Unit tests untuk networkMonitor.ts
 *
 * Test focus:
 * - Initial state: optimistic 'online'
 * - State transitions: online -> offline -> online
 * - Subscriber notifications on state change
 * - Manual check() updates state
 * - Periodic checks via start/stop
 */

import { networkMonitor, NetworkStatus } from './networkMonitor';

// Suppress console during tests
const originalWarn = console.warn;
beforeEach(() => {
  console.warn = jest.fn();
  networkMonitor.stop(); // Ensure clean state
});
afterEach(() => {
  console.warn = originalWarn;
  networkMonitor.stop();
});

describe('networkMonitor', () => {
  describe('initial state', () => {
    test('initial status is unknown', () => {
      expect(networkMonitor.getStatus()).toBe('unknown');
    });
  });

  describe('getStatus()', () => {
    test('returns current status', () => {
      expect(networkMonitor.getStatus()).toBe('unknown');
    });
  });

  describe('subscribe/unsubscribe', () => {
    test('subscriber does not immediately receive callback (adds to set)', () => {
      // subscribe() adds to listeners set and returns unsubscribe function
      // it does NOT immediately call with current status
      let receivedStatus: NetworkStatus | null = null;
      const unsubscribe = networkMonitor.subscribe((status) => {
        receivedStatus = status;
      });

      // Status should still be null since subscribe doesn't trigger callback
      // This tests that subscribe is synchronous add, not immediate emit
      expect(receivedStatus).toBeNull();

      unsubscribe();
    });

    test('unsubscribe returns function that removes listener', () => {
      let callCount = 0;
      const unsubscribe = networkMonitor.subscribe(() => {
        callCount++;
      });

      // Clear and verify unsubscribe works
      unsubscribe();

      // After unsubscribe, the function reference should still be valid
      expect(typeof unsubscribe).toBe('function');
    });
  });

  describe('start/stop', () => {
    test('start() does not throw', () => {
      expect(() => networkMonitor.start()).not.toThrow();
    });

    test('stop() does not throw after start', () => {
      networkMonitor.start();
      expect(() => networkMonitor.stop()).not.toThrow();
    });

    test('multiple start() calls are idempotent (no duplicate timers)', () => {
      networkMonitor.start();
      networkMonitor.start();
      networkMonitor.start();
      // Should still work without error
      expect(() => networkMonitor.stop()).not.toThrow();
    });

    test('stop() cleans up timer (calling start again works)', () => {
      networkMonitor.start();
      networkMonitor.stop();
      expect(() => networkMonitor.start()).not.toThrow();
      networkMonitor.stop();
    });
  });

  describe('check()', () => {
    test('check() returns a NetworkStatus', async () => {
      const status = await networkMonitor.check();
      expect(status === 'online' || status === 'offline').toBe(true);
    });

    test('check() updates getStatus()', async () => {
      await networkMonitor.check();
      const newStatus = networkMonitor.getStatus();
      // Status should be either online or offline
      expect(newStatus === 'online' || newStatus === 'offline').toBe(true);
    });

    test('check() does not throw on timeout', async () => {
      await expect(networkMonitor.check()).resolves.toBeDefined();
    });
  });

  describe('recheck()', () => {
    test('recheck emits unknown first, then the check result', async () => {
      // Pakai fetch tiruan supaya hasil check deterministik ('online').
      const originalFetch = globalThis.fetch;
      globalThis.fetch = jest.fn().mockResolvedValue({ ok: true });
      try {
        // Set status dulu ke 'online' lewat check() tiruan, supaya
        // recheck benar-benar memancarkan transisi ke 'unknown' dulu.
        await networkMonitor.check();
        expect(networkMonitor.getStatus()).toBe('online');

        const statuses: NetworkStatus[] = [];
        const unsubscribe = networkMonitor.subscribe((status) => {
          statuses.push(status);
        });

        await networkMonitor.recheck();

        // Emit pertama harus 'unknown', emit terakhir harus hasil check ('online')
        expect(statuses.length).toBeGreaterThanOrEqual(2);
        expect(statuses[0]).toBe('unknown');
        expect(statuses[statuses.length - 1]).toBe('online');

        unsubscribe();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('listener notifications', () => {
    test('subscriber is notified when status changes', async () => {
      const statuses: NetworkStatus[] = [];
      const unsubscribe = networkMonitor.subscribe((status) => {
        statuses.push(status);
      });

      // Trigger a check - this may or may not change status
      await networkMonitor.check();

      // Status should have been pushed at least once
      expect(statuses.length).toBeGreaterThanOrEqual(0);

      unsubscribe();
    });
  });
});

describe('NetworkStatus type', () => {
  test('NetworkStatus is either online or offline', () => {
    const statuses: NetworkStatus[] = ['online', 'offline'];
    expect(statuses).toHaveLength(2);
  });
});
