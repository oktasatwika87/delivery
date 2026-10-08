/**
 * Customer Home Screen.
 *
 * Daftar order milik customer login. Sumber data: tabel orders lokal yang
 * di-pull dari server (lihat SyncCoordinator). Order baru yang dibuat lewat
 * OrderCreateScreen baru muncul di sini setelah pull berikutnya - create
 * order itu online-only (POST /orders), tidak menulis DB lokal.
 *
 * Reactivity: withObservables dengan observeWithColumns(['status',
 * 'total_cents']). mutate kolom status/total_cents pada baris yang sudah
 * diload akan memicu re-emit nilai yang sama (WatermelonDB idiom), jadi
 * baris render ulang saat status berubah dari pull berikutnya tanpa
 * reload halaman.
 *
 * Kalau userId kosong: tidak ada query yang dijalankan dan layar tampil
 * "Belum ada order." - tidak pernah fallback ke semua order.
 */

import React, { useEffect, useState } from 'react';
import {
  Button,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Q } from '@nozbe/watermelondb';
import type { Database } from '@nozbe/watermelondb';
import { withDatabase, withObservables } from '@nozbe/watermelondb/react';
import { of } from 'rxjs';
import type { Observable } from 'rxjs';

import type { CustomerStackParamList } from './CustomerStack';
import type { OrderModel } from '../db/models/OrderModel';
import { getCurrentUserId } from '../sync/session';
import { orderStatusLabel } from '../orderStatusLabel';
import { formatCurrency } from '../formatCurrency';

type NavProp = Pick<NativeStackNavigationProp<CustomerStackParamList, 'CustomerHome'>, 'navigate'>;

interface CustomerHomeScreenProps {
  database?: Database;
  myOrders?: OrderModel[];
  onLogout: () => void;
  navigation?: NavProp;
  userId?: string | null;
}

export function CustomerHomeScreenBase({
  myOrders = [],
  onLogout,
  navigation,
}: CustomerHomeScreenProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Order saya</Text>
      <FlatList
        style={styles.list}
        data={myOrders}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => navigation?.navigate('OrderTracking', { orderId: item.id })}
          >
            <Text style={styles.rowTitle}>#{item.id.slice(0, 8).toUpperCase()}</Text>
            <Text style={styles.rowStatus}>{orderStatusLabel(item.status)}</Text>
            <Text style={styles.rowTotal}>
              {formatCurrency(item.totalCents, item.currency)}
            </Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Belum ada order.</Text>}
      />
      <View style={styles.spacer} />
      <Button
        title="Buat Order Baru"
        onPress={() => navigation?.navigate('OrderCreate')}
      />
      <View style={styles.buttonSpacer} />
      <Button title="Logout" onPress={onLogout} />
    </View>
  );
}

/**
 * Fungsi observably: dipanggil oleh withObservables saat userId trigger
 * prop berubah. Mengembalikan observable myOrders yang membaca dari
 * WatermelonDB dan memancarkan ulang saat kolom status atau total_cents
 * baris berubah (lihat observeWithColumns).
 *
 * Dipisah dari komponen agar bisa dites secara terpisah (mock HOC).
 */
function myOrdersObservable({
  database,
  userId,
}: {
  database: Database;
  userId: string | null;
}): { myOrders: Observable<OrderModel[]> } {
  if (!userId) {
    return { myOrders: of([]) };
  }
  const observable = database
    .get<OrderModel>('orders')
    .query(
      Q.where('customer_id', userId),
      Q.sortBy('created_at', Q.desc),
    )
    .observeWithColumns(['status', 'total_cents']);
  return { myOrders: observable };
}

const CustomerHomeScreenWithObs = withObservables(
  ['userId'],
  myOrdersObservable,
)(CustomerHomeScreenBase);

/**
 * Wrapper: baca userId dari session (keychain) sekali waktu mount,
 * lalu teruskan ke HOC. Kalau userId null/kosong, teruskan apa adanya:
 * HOC akan ganti ke of([]) dan tidak menjalankan query DB.
 *
 * useEffect dengan cleanup cancelled flag - race window antara unload
 * dan getCurrentUserId() resolve diabaikan.
 */
function CustomerHomeScreenWrapper({
  database,
  onLogout,
  navigation,
}: {
  database: Database;
  onLogout: () => void;
  navigation?: NavProp;
}): React.JSX.Element {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await getCurrentUserId();
      if (cancelled) return;
      setUserId(id);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <CustomerHomeScreenWithObs
      database={database}
      userId={userId}
      onLogout={onLogout}
      navigation={navigation}
    />
  );
}

export const CustomerHomeScreen = withDatabase(CustomerHomeScreenWrapper);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#222',
    marginBottom: 16,
  },
  empty: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginTop: 24,
  },
  list: {
    flex: 1,
  },
  row: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#222',
  },
  rowStatus: {
    fontSize: 14,
    color: '#444',
    marginTop: 4,
  },
  rowTotal: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  spacer: {
    height: 24,
  },
  buttonSpacer: {
    height: 12,
  },
});
