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
import { fetchAvailableOrders, UnauthorizedError } from '../sync/client';
import { ordersSocket } from '../sync/ordersSocket';
import { syncEvents } from '../sync/syncEvents';

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
  const [removedNotice, setRemovedNotice] = useState<{ visible: boolean; orderId: string | null }>({
    visible: false,
    orderId: null,
  });

  // ─── Refs for socket unsubscribe ────────────────────────────────────────────
  const unsubscribeRef = useRef<Array<() => void>>([]);

  // ─── Fetch available pool from REST ─────────────────────────────────────────
  const fetchPool = useCallback(async (): Promise<void> => {
    try {
      // fetchAvailableOrders returns pool items: orderId, totalCents, currency, itemsCount, city?, createdAt
      const poolItems = await fetchAvailableOrders();

      // Upsert each order to local DB with _raw._status='synced'
      // (Penting: synced biar collectDirty gak pickup pool rows)
      await database.write(async () => {
        for (const item of poolItems) {
          const existing = await database.get<OrderModel>('orders').find(item.orderId).catch(() => null);
          if (existing) {
            await existing.update((r) => {
              (r as any)._raw._status = 'synced';
            });
          } else {
            // Safe defaults untuk field non-nullable di OrderModel.
            // Data lengkap (customerId, items, address) belum tersedia di pool payload
            // karena drivers:available broadcast hanya kirim orderId + metadata minimal.
            await database.get<OrderModel>('orders').create((r) => {
              (r as any)._raw.id = item.orderId;
              (r as any).status = 'ASSIGNED';
              (r as any).totalCents = item.totalCents;
              (r as any).currency = item.currency;
              (r as any).customerId = ''; // pool preview — detail belum tersedia
              (r as any).itemsJson = []; // pool preview — items belum tersedia
              (r as any).addressJson = {}; // pool preview — address belum tersedia
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
      // Detect session expired
      if (err instanceof UnauthorizedError) {
        syncEvents.emit('auth-expired', { source: 'pool-fetch' });
        return;
      }
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

  // ─── syncEvents subscription: orderRemovedFromView notice ─────────────────────
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onOrderRemoved = (event: { orderId: string }) => {
      console.log('[OrdersScreen] orderRemovedFromView:', event.orderId);
      // Clear any pending notice before showing new one
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
      setRemovedNotice({ visible: true, orderId: event.orderId });
      // Auto-dismiss after ~3 seconds
      noticeTimerRef.current = setTimeout(() => {
        setRemovedNotice({ visible: false, orderId: null });
        noticeTimerRef.current = null;
      }, 3000);
    };

    syncEvents.on('orderRemovedFromView', onOrderRemoved);
    return () => {
      syncEvents.off('orderRemovedFromView', onOrderRemoved);
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
    };
  }, []);

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
    <>
      {removedNotice.visible && (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Order sudah diambil driver lain</Text>
          <Text style={styles.noticeDetail}>
            Order tersebut baru saja di-accept driver lain dan hilang dari daftar Anda.
          </Text>
        </View>
      )}
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
    </>
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
  notice: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
  },
  noticeTitle: { fontWeight: '700', color: '#92400e', marginBottom: 4 },
  noticeDetail: { color: '#78350f', fontSize: 14 },
});
