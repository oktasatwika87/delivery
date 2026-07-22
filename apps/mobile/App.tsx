/**
 * App entry — set up WatermelonDB, sync coordinator, dan navigation.
 *
 * Auth flow:
 *   - App mulai → cek token di keychain
 *   - Ada token → langsung ke Orders (user sudah login sebelumnya)
 *   - Tidak ada token → tampilkan LoginScreen
 *   - Setelah login → navigate ke Orders
 *
 * Sync coordinator start() dipanggil di awal regardless of auth.
 * collectDirty() akan throw kalau belum login, tapi ditangkep oleh
 * try/catch di syncTick() sehingga aman. Setelah user login, sync
 * akan jalan efektif mulai tick berikutnya.
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
    (async () => {
      try {
        await syncCoordinator.start(database);
        // Cek apakah sudah pernah login sebelumnya
        const token = await getToken();
        if (!cancelled) setAuthenticated(!!token);
      } catch (err) {
        console.error('[App] sync start failed', err);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
      syncCoordinator.stop();
    };
  }, []);

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
            <LoginScreen onLoginSuccess={() => setAuthenticated(true)} />
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