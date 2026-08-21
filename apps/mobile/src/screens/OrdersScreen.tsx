import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Q } from '@nozbe/watermelondb';
import { withDatabase, withObservables } from '@nozbe/watermelondb/react';
import type { Database } from '@nozbe/watermelondb';

import type { RootStackParamList } from '../../App';
import { OrderModel } from '../db/models/OrderModel';
import { getCurrentUserId } from '../sync/session';
import { fetchWithAuth } from '../sync/client';
import { ordersSocket } from '../sync/ordersSocket';
import Config from 'react-native-config';

const API_BASE = Config.API_BASE_URL;

interface SectionData {
  title: string;
  data: OrderModel[];
}

interface Props {
  database: Database;
  currentUserId: string | null;
  myOrders: OrderModel[];
}

function OrdersScreenBase({ database, currentUserId, myOrders }: Props): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Orders'>>();
  const [poolOrders, setPoolOrders] = useState<OrderModel[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [connected, setConnected] = useState(false);

  // ─── Refs for socket unsubscribe ────────────────────────────────────────────
  const unsubscribeRef = useRef<Array<() => void>>([]);

  // ─── Fetch available pool from REST ─────────────────────────────────────────
  const fetchPool = useCallback(async (): Promise<void> => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/orders/available`);
      if (!res.ok) throw new Error(`fetchPool failed: ${res.status}`);

      // Response shape dari findAvailable() → toDomain():
      // { id, customerId, driverId, status, items, deliveryAddress,
      //   totalCents, currency, notes, cancelledBy, cancelReason, version,
      //   createdAt, updatedAt }
      const orders: Array<{
        id: string;
        customerId: string;
        driverId: string | null | undefined;
        status: string;
        items: unknown[];
        deliveryAddress: unknown;
        totalCents: number;
        currency: string;
        notes?: string;
        version: number;
        createdAt: string;
        updatedAt: string;
      }> = await res.json();

      // Upsert each order to local DB with _raw._status='synced'
      // (Penting: synced biar collectDirty gak pickup pool rows)
      await database.write(async () => {
        for (const order of orders) {
          const existing = await database.get<OrderModel>('orders').find(order.id).catch(() => null);
          if (existing) {
            await existing.update((r) => {
              (r as any).serverVersion = order.version;
              (r as any)._raw._status = 'synced';
            });
          } else {
            await database.get<OrderModel>('orders').create((r) => {
              (r as any)._raw.id = order.id;
              (r as any).customerId = order.customerId;
              (r as any).status = order.status;
              (r as any).driverId = order.driverId ?? undefined;
              (r as any).totalCents = order.totalCents;
              (r as any).currency = order.currency;
              (r as any).itemsJson = order.items ?? [];
              (r as any).addressJson = order.deliveryAddress ?? {};
              (r as any).notes = order.notes ?? undefined;
              (r as any).serverVersion = order.version;
              (r as any)._raw._status = 'synced';
            });
          }
        }
      });

      // Reload pool orders from local DB
      const pool = await database
        .get<OrderModel>('orders')
        .query(
          Q.where('driver_id', null),
          Q.where('status', 'ASSIGNED'),
          Q.where('deleted_at', null),
        )
        .fetch();
      setPoolOrders(pool);
    } catch (err) {
      console.warn('[OrdersScreen] fetchPool failed:', err);
    }
  }, [database]);

  // ─── Initial fetch ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetchPool();
  }, [fetchPool]);

  // ─── Socket subscription ───────────────────────────────────────────────────
  useEffect(() => {
    // Clear previous unsubscribes
    unsubscribeRef.current.forEach((unsub) => unsub());
    unsubscribeRef.current = [];

    const onAvailable = () => {
      console.log('[OrdersScreen] order:available — refetching pool');
      fetchPool();
    };
    const onUnavailable = () => {
      console.log('[OrdersScreen] order:unavailable — refetching pool');
      fetchPool();
    };

    // onOrderAvailable/onOrderUnavailable return unsubscribe functions
    const unsubAvailable = ordersSocket.onOrderAvailable(onAvailable);
    const unsubUnavailable = ordersSocket.onOrderUnavailable(onUnavailable);

    // on() also returns unsubscribe
    const unsubConnect = ordersSocket.on('connect', () => setConnected(true));
    const unsubDisconnect = ordersSocket.on('disconnect', () => setConnected(false));

    unsubscribeRef.current = [
      unsubAvailable,
      unsubUnavailable,
      unsubConnect,
      unsubDisconnect,
    ];

    return () => {
      unsubscribeRef.current.forEach((unsub) => unsub());
      unsubscribeRef.current = [];
    };
  }, [fetchPool]);

  // ─── Pull to refresh ────────────────────────────────────────────────────────
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPool();
    setRefreshing(false);
  }, [fetchPool]);

  // ─── Accept order ───────────────────────────────────────────────────────────
  const handleAccept = useCallback(
    async (order: OrderModel): Promise<void> => {
      const userId = await getCurrentUserId();
      if (!userId) {
        console.warn('[OrdersScreen] handleAccept: no userId');
        return;
      }

      try {
        await database.write(async () => {
          await order.update((r) => {
            (r as any).status = 'PREPARING';
            (r as any).driverId = userId;
            (r as any)._raw._status = 'synced';
          });
        });

        // Remove from pool (local state)
        setPoolOrders((prev) => prev.filter((o) => o.id !== order.id));

        console.log('[OrdersScreen] Order accepted locally:', order.id);
      } catch (err) {
        console.error('[OrdersScreen] handleAccept failed:', err);
      }
    },
    [database],
  );

  // ─── Section data ──────────────────────────────────────────────────────────
  const sections: SectionData[] = [
    { title: 'Tersedia', data: poolOrders },
    { title: 'Order Saya', data: myOrders },
  ];

  const renderItem = ({ item, section }: { item: OrderModel; section: SectionData }) => {
    const isPool = section.title === 'Tersedia';
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
      >
        <View style={styles.cardMain}>
          <Text style={styles.cardTitle}>Order #{item.id.slice(0, 8)}</Text>
          <Text style={styles.cardMeta}>
            {item.status} · {item.totalCents} {item.currency}
          </Text>
        </View>
        {isPool && (
          <TouchableOpacity
            style={styles.acceptButton}
            onPress={() => handleAccept(item)}
          >
            <Text style={styles.acceptButtonText}>Terima Order</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const renderSectionHeader = ({ section }: { section: SectionData }) => (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{section.title}</Text>
      <Text style={styles.sectionCount}>{section.data.length}</Text>
    </View>
  );

  return (
    <SectionList
      sections={sections}
      keyExtractor={(o) => o.id}
      renderItem={renderItem}
      renderSectionHeader={renderSectionHeader}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
      contentContainerStyle={styles.list}
      stickySectionHeadersEnabled={false}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text>Belum ada order.</Text>
        </View>
      }
    />
  );
}

// ─── HOC: withObservables dengan triggerProps ['currentUserId'] ───────────────────
// currentUserId di-pass sebagai trigger prop ke withObservables.
// Saat currentUserId berubah, observable myOrders akan re-query.
const OrdersScreenWithObservables = withDatabase(
  withObservables<{ database: Database; currentUserId: string | null }, Props>(
    ['currentUserId'],
    ({ database, currentUserId }) => ({
      myOrders: currentUserId
        ? database
            .get<OrderModel>('orders')
            .query(
              Q.where('driver_id', currentUserId),
              Q.where('deleted_at', null),
              Q.sortBy('updated_at', Q.desc),
            )
            .observe()
        : [],
    }),
  )(OrdersScreenBase),
);

// ─── Wrapper: resolve currentUserId sebelum render ─────────────────────────────────
// Props explicit agar database flow dari test → wrapper → observables
interface WrapperProps {
  database: Database;
}
function OrdersScreenWrapper({ database }: WrapperProps): React.JSX.Element {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUserId().then(setCurrentUserId);
  }, []);

  if (currentUserId === null) {
    return (
      <View style={styles.loading}>
        <Text>Loading...</Text>
      </View>
    );
  }

  return <OrdersScreenWithObservables database={database} currentUserId={currentUserId} />;
}

export const OrdersScreen = withDatabase(OrdersScreenWrapper);

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700' },
  sectionCount: { fontSize: 14, color: '#71717a' },
  card: {
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#f4f4f5',
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardMain: { flex: 1 },
  cardTitle: { fontWeight: '600', fontSize: 16 },
  cardMeta: { marginTop: 4, color: '#71717a' },
  acceptButton: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    marginLeft: 12,
  },
  acceptButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  empty: { padding: 32, alignItems: 'center' },
  loading: { padding: 32, alignItems: 'center' },
});
