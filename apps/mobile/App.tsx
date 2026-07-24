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
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { DatabaseProvider } from '@nozbe/watermelondb/react';

import { database } from './src/db';
import { syncCoordinator } from './src/sync';
import { getToken } from './src/sync/token-storage';
import { LoginScreen } from './src/screens/LoginScreen';
import { OrdersScreen } from './src/screens/OrdersScreen';
import { OrderDetailScreen } from './src/screens/OrderDetailScreen';
import { ChatScreen } from './src/screens/ChatScreen';

export type RootStackParamList = {
  Login: undefined;
  Orders: undefined;
  OrderDetail: { orderId: string };
  Chat: { roomId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function App(): React.JSX.Element {
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

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

    // Auth-check jalan PARALEL dengan sync — tidak saling tunggu.
    (async () => {
      try {
        const token = await getToken();
        console.log('[App] Auth token check done:', token ? `Found` : 'NULL');
        if (!cancelled) setAuthenticated(!!token);
      } catch (err) {
        console.error('[App] Auth token check failed', err);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
      syncCoordinator.stop();
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
            <LoginScreen onLoginSuccess={handleLoginSuccess} />
          ) : (
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen name="Orders" component={OrdersScreen} />
              <Stack.Screen name="OrderDetail" component={OrderDetailScreen} />
              <Stack.Screen name="Chat" component={ChatScreen} />
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