/**
 * App entry — set up WatermelonDB, sync coordinator, dan navigation.
 *
 * Auth flow:
 *   - App mulai → cek token di keychain
 *   - Ada token → langsung ke Orders (user sudah login sebelumnya)
 *   - Tidak ada token → tampilkan LoginScreen
 *   - Setelah login → handleLoginSuccess() set authenticated=true
 *     DAN trigger syncCoordinator.pullNow() supaya data server langsung
 *     muncul, tidak perlu menunggu tick periodik berikutnya (~30s).
 *
 * Sync coordinator start() dipanggil di awal regardless of auth.
 * collectDirty() akan throw kalau belum login, tapi ditangkep oleh
 * try/catch di syncTick() sehingga aman. Setelah user login, sync
 * akan jalan efektif mulai tick berikutnya (dan langsung via pullNow()).
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DatabaseProvider } from '@nozbe/watermelondb/react';

import { database } from './src/db';
import { syncCoordinator } from './src/sync';
import { ordersSocket } from './src/sync';
import { chatSocket } from './src/sync/socket';
import { getToken, clearToken } from './src/sync/token-storage';
import { syncEvents } from './src/sync/syncEvents';
import { LoginScreen } from './src/screens/LoginScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { OrderDetailScreen } from './src/screens/OrderDetailScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { MapScreen } from './src/screens/MapScreen';
import { MapSettingsScreen } from './src/screens/MapSettingsScreen';
import { routeSnapshotService } from './src/map/routeSnapshot';
import { networkMonitor, type NetworkStatus } from './src/map/networkMonitor';

export type RootStackParamList = {
  Login: undefined;
  Orders: undefined;
  OrderDetail: { orderId: string };
  Chat: { roomId: string };
  Map: { orderId: string };
  MapSettings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function App(): React.JSX.Element {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [logoutReason, setLogoutReason] = useState<'auth-expired' | 'manual' | undefined>(undefined);

  // Track previous network status so we only kick flushNow on
  // offline → online transition (not initial 'online' or every probe).
  const prevNetworkStatusRef = useRef<NetworkStatus>('unknown');

  useEffect(() => {
    let cancelled = false;

    // Fire-and-forget: syncCoordinator.start() jalan di background,
    // tidak blocking auth-check atau render UI.
    // collectDirty() akan throw kalau belum login → ditangkep di catch,
    // aman untuk fresh install / offline-first.
    syncCoordinator.start(database).catch((err) => {
      if (!cancelled) {
        console.warn('[App] Background sync start failed (non-blocking):', err);
      }
    });

    // Route snapshot retention cleanup — sekali per boot per session
    // (lihat keputusan #8). LRU max 20 snapshot — lihat routeSnapshot.ts.
    // Tidak dipicu interval — hemat baterai.
    routeSnapshotService
      .runRetentionCleanup(database)
      .catch((err) => {
        if (!cancelled) {
          console.warn('[App] route snapshot retention cleanup failed:', err);
        }
      });

    // Network monitor — start periodic ping ke backend supaya UI map
    // bisa tampil indikator online/offline real-time. Tidak blocking —
    // optimistic default 'online' sampai ada bukti sebaliknya.
    networkMonitor.start();

    // ─── AppState listener: pause/resume sync + sockets on background/foreground ──
    // Fix C6 dari offline-audit-findings.md.
    // background/inactive → stop sync + disconnect sockets (hemat battery/resource)
    // active → resume sockets (sync coordinator TIDAK di-restart — dia udah
    //   jalan terus sejak mount via setInterval; kalau di-start ulang di sini
    //   bakal race dengan mount's start(), causing duplicate initial pull dan
    //   "Cannot update a record with pending changes" dari WatermelonDB)
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        console.log('[App] AppState active — resuming sockets only');
        // syncCoordinator TIDAK dipanggil start() di sini. Periodic sync udah
        // jalan dari setInterval yang di-set saat mount. Cukup resume sockets.
        // (start() punya guard di syncInterval, tapi guard gak nutup window
        //  antara mount dan initial pull selesai — race reproducible.)
        // connect() idempotent — double-connect aman
        chatSocket.connect().catch((err) => {
          console.warn('[App] chatSocket resume failed:', err);
        });
        ordersSocket.connect().catch((err) => {
          console.warn('[App] ordersSocket resume failed:', err);
        });
      } else {
        // 'background' atau 'inactive' — sama treat-nya untuk MVP
        console.log('[App] AppState background/inactive — pausing sync + sockets');
        syncCoordinator.stop();
        chatSocket.disconnect();
        ordersSocket.disconnect();
      }
    });

    // ─── Auth-expired listener: force logout saat session expired detected ───
    const onAuthExpired = (event: { source: string }) => {
      console.warn('[App] auth-expired event from:', event.source, '— forcing logout');
      setLogoutReason('auth-expired');
      // 1. Stop sync coordinator
      syncCoordinator.stop();
      // 2. Disconnect sockets (paralel dengan AppState inactive branch)
      chatSocket.disconnect();
      ordersSocket.disconnect();
      // 3. Clear token (FIRST call site for clearToken() in entire codebase)
      clearToken().catch((err) => {
        console.error('[App] clearToken failed:', err);
      });
      // 4. Reset auth state — trigger re-render ke LoginScreen
      setAuthenticated(false);
    };
    syncEvents.on('auth-expired', onAuthExpired);

    // Auth-check jalan PARALEL dengan sync — tidak saling tunggu.
    (async () => {
      try {
        const token = await getToken();
        console.log('[App] Auth token check done:', token ? `Found` : 'NULL');
        if (!cancelled) {
          setAuthenticated(!!token);
          // Restore session: connect ordersSocket kalau token ditemukan.
          // connect() idempotent — aman dipanggil berkali-kali (double-connect
          // resolve immediately kalau socket sudah nyala).
          if (token) {
            ordersSocket.connect().catch((err) => {
              if (!cancelled) {
                console.warn('[App] ordersSocket connect failed (will retry):', err);
              }
            });
          }
        }
      } catch (err) {
        console.error('[App] Auth token check failed', err);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      syncCoordinator.stop();
      networkMonitor.stop();
      ordersSocket.disconnect();
      appStateSubscription.remove();
      syncEvents.off('auth-expired', onAuthExpired);
    };
  }, []);

  // ─── Kick sync on back-online transition ────────────────────────────────────
  // networkMonitor fires on every status change. Only trigger flushNow when
  // we transition offline → online (not initial 'online', not every probe).
  useEffect(() => {
    let cancelled = false;

    const unsubscribe = networkMonitor.subscribe((status) => {
      const prev = prevNetworkStatusRef.current;
      prevNetworkStatusRef.current = status;

      if (prev !== 'online' && status === 'online' && !cancelled) {
        console.log('[App] Network status known online (was ' + prev + ') — triggering flush');
        syncCoordinator.flushNow().catch((err) => {
          if (!cancelled) {
            console.warn(
              '[App] Post-online flushNow failed (will retry on next tick):',
              err,
            );
          }
        });
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Debug: log when authenticated state changes
  useEffect(() => {
    console.log('[App] authenticated changed to:', authenticated);
    if (authenticated) {
      console.log(
        '[App] User logged in - pullNow() already triggered, periodic sync continues every 30s',
      );
    }
  }, [authenticated]);

  /**
   * Login success handler.
   *
   * Setelah token tersimpan di keychain (oleh LoginScreen SEBELUM callback ini
   * dipanggil), kita:
   *  1. Set authenticated=true → App re-render ke Orders screen
   *  2. Trigger pullNow() secara manual — jangan tunggu 30s tick berikutnya.
   *
   * Karena token sudah ada di keychain saat handler ini jalan,
   * `getCurrentToken()` di dalam pull → fetchWithAuth akan return token
   * yang baru di-save, sehingga /sync/pull akan return data yang difilter
   * per-user. Tidak perlu tunggu state update flush ke re-render.
   */
  const handleLoginSuccess = async (): Promise<void> => {
    setAuthenticated(true);
    setLogoutReason(undefined);
    // ordersSocket — connect setelah login sukses. Tidak di-mount (Opsi A lazy
    // per-screen) karena value proposition WebSocket push (§ 2.2.a) butuh socket
    // nyala di semua screen (OrderDetail, Map, dll) bukan cuma OrdersScreen.
    ordersSocket.connect().catch((err) => {
      console.warn('[App] ordersSocket connect failed (will retry):', err);
    });
    try {
      console.log('[App] Triggering immediate pull after login...');
      await syncCoordinator.pullNow();
    } catch (err) {
      console.warn('[App] Post-login pullNow failed (will retry on next tick):', err);
    }
  };

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <DatabaseProvider database={database}>
        <NavigationContainer>
          {!authenticated ? (
            <LoginScreen onLoginSuccess={handleLoginSuccess} logoutReason={logoutReason} />
          ) : (
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Orders" component={OrdersScreen} />
              <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
              <Stack.Screen name="Chat" component={ChatScreen} />
              <Stack.Screen name="Map" component={MapScreen} />
              <Stack.Screen name="MapSettings" component={MapSettingsScreen} />
            </Stack.Navigator>
          )}
        </NavigationContainer>
      </DatabaseProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

export default App;