/**
 * App entry - set up WatermelonDB dan navigation.
 *
 * Auth flow:
 *   - App mulai -> cek token di keychain
 *   - Ada token -> langsung ke Orders (user sudah login sebelumnya)
 *   - Tidak ada token -> tampilkan LoginScreen
 *   - Setelah login -> handleLoginSuccess() set authenticated=true
 *     DAN beginSyncSession() supaya sinkron dan kedua socket nyala.
 *
 * Sesi sinkron dan socket dikelola lewat satu pasang fungsi
 * (beginSyncSession, endSyncSession dari ./src/sync/sessionControl).
 * sessionActiveRef menandai ada sesi; AppState 'active' cuma
 * memanggil beginSyncSession() kalau ref true.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DatabaseProvider } from '@nozbe/watermelondb/react';

import { database } from './src/db';
import { syncCoordinator } from './src/sync';
import { getToken, clearToken, getRole } from './src/sync/token-storage';
import { isCurrentToken } from './src/sync/session';
import { syncEvents, type AuthExpiredEvent } from './src/sync/syncEvents';
import { beginSyncSession, endSyncSession } from './src/sync/sessionControl';
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

  // Tanda ada sesi sinkron dan socket nyala; dipakai untuk AppState 'active'
  // agar tidak membangun koneksi sebelum login, dan sebaliknya memanggil
  // endSyncSession() saat sesi berakhir.
  const sessionActiveRef = useRef<boolean>(false);

  // Status terakhir, supaya flushNow hanya dipicu perpindahan 'offline' -> 'online'.
  const prevNetworkStatusRef = useRef<NetworkStatus>('unknown');

  /**
   * Akhiri sesi: hentikan sinkron dan kedua socket, bersihkan state
   * otentikasi, dan opsional hapus token (untuk logout manual).
   *
   * Dipakai oleh pendengar 'auth-expired' (setelah cek token),
   * handleLogout, token tanpa role saat app dibuka, role yang tidak
   * terbaca setelah login, dan galat saat pemeriksaan awal.
   * Tidak menghapus data lokal; itu tanggung jawab pemanggil (lihat
   * clearLocalDataForLogout di commit 5 / App.tsx).
   */
  const endSession = (reason: 'auth-expired' | 'manual'): void => {
    sessionActiveRef.current = false;
    endSyncSession();
    setLogoutReason(reason);
    setAuthenticated(false);
    setRole(null);
    setShowRegister(false);
    clearToken().catch((err) => {
      console.error('[App] clearToken failed:', err);
    });
  };

  useEffect(() => {
    let cancelled = false;

    // Route snapshot retention cleanup - sekali per boot per session.
    routeSnapshotService
      .runRetentionCleanup(database)
      .catch((err) => {
        if (!cancelled) {
          console.warn('[App] route snapshot retention cleanup failed:', err);
        }
      });

    // Network monitor ping periodik supaya UI map punya indikator
    // online/offline. Tidak blocking; status awal 'unknown' sampai
    // cek pertama selesai.
    networkMonitor.start();

    // --- AppState listener: pause/resume sync + sockets on background/foreground ---
    // Sinkron dan socket cuma jalan selama ada sesi. active tanpa sesi:
    // no-op. active dengan sesi: beginSyncSession() supaya pull pertama
    // kembali setelah perpindahan background. Keadaan lain: endSyncSession().
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        console.log('[App] AppState active, restarting sync + resuming sockets');
        networkMonitor.recheck().catch(() => {});
        if (sessionActiveRef.current) {
          beginSyncSession(database);
        }
      } else {
        // 'background' atau 'inactive' - stop sync + sockets.
        console.log('[App] AppState background/inactive, pausing sync + sockets');
        endSyncSession();
      }
    });

    // --- Auth-expired listener: force logout saat session expired detected ---
    const onAuthExpired = async (event: AuthExpiredEvent): Promise<void> => {
      const { source, token } = event;
      console.warn(
        `[App] auth-expired event from: ${source}, rejecting token length=${token.length}`,
      );
      if (!token || !(await isCurrentToken(token))) {
        console.warn('[App] auth-expired event for stale token, ignoring');
        return;
      }
      try {
        endSession('auth-expired');
      } catch (err: unknown) {
        console.error('[App] endSession failed:', err);
      }
    };
    syncEvents.on('auth-expired', onAuthExpired);

    // Auth-check jalan PARALEL dengan sync - tidak saling tunggu.
    (async () => {
      try {
        const token = await getToken();
        console.log('[App] Auth token check done:', token ? `Found` : 'NULL');

        if (!token) {
          setAuthenticated(false);
          setRole(null);
        } else {
          const userRole = await getRole();

          if (!userRole) {
            // Token tidak valid atau role tidak ada (legacy). Akhiri sesi
            // tanpa menghapus data, supaya user bisa login ulang dengan
            // akun lain dan datanya tetap tersimpan.
            console.warn('[App] Token has invalid or missing role - ending session');
            endSession('auth-expired');
          } else {
            // Token dan role sah. Sesi nyala.
            setAuthenticated(true);
            setRole(userRole);
            sessionActiveRef.current = true;
            console.log('[App] User role:', userRole);

            beginSyncSession(database);
          }
        }
      } catch (err) {
        console.error('[App] Auth token check failed', err);
        endSession('auth-expired');
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      endSyncSession();
      networkMonitor.stop();
      appStateSubscription.remove();
      syncEvents.off('auth-expired', onAuthExpired);
    };
  }, []);

  // --- Kick flush dari transisi offline -> online ---
  // Hanya perpindahan 'offline' -> 'online' yang memicu flushNow;
  // transisi 'unknown' -> 'online' diurus di tempat lain. Hanya saat
  // ada sesi sinkron (sessionActiveRef true), supaya pemicu offline
  // -> online dari pemantau lain (mis. network monitor global) tidak
  // memanggil flush sebelum login.
  useEffect(() => {
    let cancelled = false;

    const unsubscribe = networkMonitor.subscribe((status) => {
      const prev = prevNetworkStatusRef.current;
      prevNetworkStatusRef.current = status;

      if (prev === 'offline' && status === 'online' && !cancelled && sessionActiveRef.current) {
        console.log('[App] Network offline -> online, triggering flush');
        syncCoordinator.flushNow().catch((err: unknown) => {
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
        '[App] User logged in - sinkron dan socket dimulai lewat beginSyncSession',
      );
    }
  }, [authenticated]);

  /**
   * Login success handler.
   *
   * Setelah token tersimpan (oleh LoginScreen SEBELUM callback ini
   * dipanggil), kita:
   *  1. Decode role dari token
   *  2. Set authenticated=true + role state -> App re-render dengan nav stack sesuai role
   *  3. Mulai sinkron dan kedua socket lewat beginSyncSession().
   *     Pull pertama langsung jalan, tidak perlu menunggu tick 30 detik.
   */
  const handleLoginSuccess = async (): Promise<void> => {
    setLogoutReason(undefined);

    // Decode role from saved token
    const userRole = await getRole();
    if (!userRole) {
      console.warn('[App] Login success but could not decode role from token');
      // Akhiri sesi: token tersimpan tapi role tidak bisa dibaca.
      endSession('auth-expired');
      return;
    }

    setAuthenticated(true);
    setRole(userRole);
    sessionActiveRef.current = true;
    console.log('[App] Login success, user role:', userRole);

    beginSyncSession(database);
  };

  /**
   * Logout handler: shared between driver and customer stacks.
   * Triggers logout flow and resets auth state.
   *
   * Data lokal dihapus lewat clearLocalDataForLogout (lihat commit 5),
   * dipanggil dari pemanggil (LoginScreen / handleLogout) dengan
   * konfirmasi user dulu.
   */
  const handleLogout = (): void => {
    sessionActiveRef.current = false;
    endSyncSession();
    setLogoutReason('manual');
    setAuthenticated(false);
    setRole(null);
    setShowRegister(false);
    clearToken().catch((err) => {
      console.error('[App] clearToken failed:', err);
    });
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