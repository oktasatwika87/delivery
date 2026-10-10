/**
 * App entry - set up WatermelonDB, sync coordinator, dan navigation.
 *
 * Auth flow:
 *   - App mulai -> cek token di keychain
 *   - Ada token -> langsung ke Orders (user sudah login sebelumnya)
 *   - Tidak ada token -> tampilkan LoginScreen
 *   - Setelah login -> handleLoginSuccess() set authenticated=true
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
import { getToken, clearToken, getRole } from './src/sync/token-storage';
import { syncEvents } from './src/sync/syncEvents';
import { UserRole } from '@delivery/shared';
import { CustomerStack } from './src/customer';
import { RegisterScreen } from './src/screens/RegisterScreen';
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
  const [role, setRole] = useState<UserRole | null>(null);
  const [logoutReason, setLogoutReason] = useState<'auth-expired' | 'manual' | undefined>(undefined);
  const [showRegister, setShowRegister] = useState(false);

  // Track previous network status so we only kick flushNow on
  // offline -> online transition (not initial 'online' or every probe).
  const prevNetworkStatusRef = useRef<NetworkStatus>('unknown');

  useEffect(() => {
    let cancelled = false;

    // Fire-and-forget: syncCoordinator.start() jalan di background,
    // tidak blocking auth-check atau render UI.
    // collectDirty() akan throw kalau belum login -> ditangkep di catch,
    // aman untuk fresh install / offline-first.
    syncCoordinator.start(database).catch((err) => {
      if (!cancelled) {
        console.warn('[App] Background sync start failed (non-blocking):', err);
      }
    });

    // Route snapshot retention cleanup - sekali per boot per session
    // (lihat keputusan #8). LRU max 20 snapshot - lihat routeSnapshot.ts.
    // Tidak dipicu interval - hemat baterai.
    routeSnapshotService
      .runRetentionCleanup(database)
      .catch((err) => {
        if (!cancelled) {
          console.warn('[App] route snapshot retention cleanup failed:', err);
        }
      });

    // Network monitor - start periodic ping ke backend supaya UI map
    // bisa tampil indikator online/offline real-time. Tidak blocking -
    // optimistic default 'online' sampai ada bukti sebaliknya.
    networkMonitor.start();

    // --- AppState listener: pause/resume sync + sockets on background/foreground ---
    // Fix C6 dari offline-audit-findings.md.
    // background/inactive -> stop sync + disconnect sockets (hemat battery/resource)
    // active -> restart periodic sync + resume sockets.
    //
    // stop() clear interval dan set stopped=true, jadi kalau app masuk background
    // lalu aktif lagi, periodic sync TIDAK akan jalan tanpa start() yang dipanggil ulang.
    // syncCoordinator.start() sekarang idempotent terhadap concurrent/repeated call
    // (pakai isStarting flag untuk guard race window sebelum initial pull selesai),
    // jadi aman dipanggil di sini tanpa "Cannot update a record with pending changes".
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        console.log('[App] AppState active, restarting sync + resuming sockets');
        // start() idempotent: guard di isStarting + syncInterval memastikan
        // tidak ada duplicate initial pull atau duplicate interval.
        syncCoordinator.start(database).catch((err) => {
          console.warn('[App] syncCoordinator resume failed:', err);
        });
        chatSocket.connect().catch((err) => {
          console.warn('[App] chatSocket resume failed:', err);
        });
        ordersSocket.connect().catch((err) => {
          console.warn('[App] ordersSocket resume failed:', err);
        });
      } else {
        // 'background' atau 'inactive' - sama treat-nya untuk MVP
        console.log('[App] AppState background/inactive, pausing sync + sockets');
        syncCoordinator.stop();
        chatSocket.disconnect();
        ordersSocket.disconnect();
      }
    });

    // --- Auth-expired listener: force logout saat session expired detected ---
    const onAuthExpired = (event: { source: string }) => {
      console.warn(`[App] auth-expired event from: ${event.source}, forcing logout`);
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
      // 4. Reset auth state - trigger re-render ke LoginScreen
      setAuthenticated(false);
      setRole(null);
    };
    syncEvents.on('auth-expired', onAuthExpired);

    // Auth-check jalan PARALEL dengan sync - tidak saling tunggu.
    (async () => {
      try {
        const token = await getToken();
        console.log('[App] Auth token check done:', token ? `Found` : 'NULL');

        if (!token) {
          // No token -> not authenticated
          setAuthenticated(false);
          setRole(null);
        } else {
          // Token found -> validate role
          const userRole = await getRole();

          if (!userRole) {
            // Token invalid or role missing (legacy token) -> trigger logout
            console.warn('[App] Token has invalid or missing role - triggering logout');
            setLogoutReason('auth-expired');
            syncCoordinator.stop();
            chatSocket.disconnect();
            ordersSocket.disconnect();
            await clearToken();
            setAuthenticated(false);
            setRole(null);
          } else {
            // Valid token and role -> authenticated
            setAuthenticated(true);
            setRole(userRole);
            console.log('[App] User role:', userRole);

            // Restore session: connect ordersSocket (driver only for now)
            // connect() idempotent - aman dipanggil berkali-kali
            ordersSocket.connect().catch((err) => {
              if (!cancelled) {
                console.warn('[App] ordersSocket connect failed (will retry):', err);
              }
            });
          }
        }
      } catch (err) {
        console.error('[App] Auth token check failed', err);
        // Treat errors as auth-expired
        setLogoutReason('auth-expired');
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

  // --- Kick sync on back-online transition -------------------------------------------
  // networkMonitor fires on every status change. Only trigger flushNow when
  // we transition offline -> online (not initial 'online', not every probe).
  useEffect(() => {
    let cancelled = false;

    const unsubscribe = networkMonitor.subscribe((status) => {
      const prev = prevNetworkStatusRef.current;
      prevNetworkStatusRef.current = status;

      if (prev !== 'online' && status === 'online' && !cancelled) {
        console.log('[App] Network status known online (was ' + prev + '), triggering flush');
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
   *  1. Decode role dari token
   *  2. Set authenticated=true + role state -> App re-render dengan nav stack sesuai role
   *  3. Trigger pullNow() secara manual - jangan tunggu 30s tick berikutnya.
   */
  const handleLoginSuccess = async (): Promise<void> => {
    setLogoutReason(undefined);

    // Decode role from saved token
    const userRole = await getRole();
    if (!userRole) {
      // Should not happen if server returns valid role in JWT
      console.warn('[App] Login success but could not decode role from token');
      setLogoutReason('auth-expired');
      return;
    }

    setAuthenticated(true);
    setRole(userRole);
    console.log('[App] Login success, user role:', userRole);

    // ordersSocket - connect setelah login sukses. Tidak di-mount (Opsi A lazy
    // per-screen) karena value proposition WebSocket push (2.2.a) butuh socket
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

  /**
   * Logout handler: shared between driver and customer stacks.
   * Triggers logout flow and resets auth state.
   */
  const handleLogout = (): void => {
    setLogoutReason('manual');
    syncCoordinator.stop();
    chatSocket.disconnect();
    ordersSocket.disconnect();
    clearToken().catch((err) => {
      console.error('[App] clearToken failed:', err);
    });
    setAuthenticated(false);
    setRole(null);
    setShowRegister(false);
  };

  /**
   * Navigate to register screen.
   */
  const handleNavigateToRegister = (): void => {
    setShowRegister(true);
  };

  /**
   * Navigate back to login screen from register.
   */
  const handleBackToLogin = (): void => {
    setShowRegister(false);
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
            showRegister ? (
              <RegisterScreen onRegisterSuccess={handleLoginSuccess} onBackToLogin={handleBackToLogin} />
            ) : (
              <LoginScreen onLoginSuccess={handleLoginSuccess} logoutReason={logoutReason} onNavigateToRegister={handleNavigateToRegister} />
            )
          ) : role === UserRole.DRIVER ? (
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Orders" component={OrdersScreen} />
              <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
              <Stack.Screen name="Chat" component={ChatScreen} />
              <Stack.Screen name="Map" component={MapScreen} />
              <Stack.Screen name="MapSettings" component={MapSettingsScreen} />
            </Stack.Navigator>
          ) : role === UserRole.CUSTOMER ? (
            <CustomerStack onLogout={handleLogout} />
          ) : (
            // Should not happen - role should be validated in auth check
            // Fallback to loading while redirecting
            <View style={styles.center}>
              <ActivityIndicator size="large" />
            </View>
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