import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  Alert,
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
import { of } from 'rxjs';

import type { RootStackParamList } from '../../App';
import { OrderModel } from '../db/models/OrderModel';
import { PendingActionModel } from '../db/models/PendingActionModel';
import { getCurrentUserId } from '../sync/session';
import { fetchAvailableOrders, UnauthorizedError, acceptOrder, ApiError } from '../sync/client';
import { ordersSocket } from '../sync/ordersSocket';
import { syncEvents } from '../sync/syncEvents';
import { hasPendingAction, hasStalePendingAction } from '../sync/outbox';
import { buildPoolRow, poolAddressJson } from './buildPoolRow';
import {
  ReleasedOrdersNotice,
  dismissReleasedOrders,
  releasedOrdersQuery,
  type ReleasedOrderItem,
} from './ReleasedOrdersNotice';
import { locationService } from '../map/location';
import { networkMonitor } from '../map/networkMonitor';
import { RouteService } from '../map/routeService';
import { GraphHopperRoutingProvider } from '../map/routing';

interface SectionData {
  title: string;
  data: OrderModel[];
}

interface Props {
  database: Database;
  myOrders: OrderModel[];
  releasedOrders?: OrderModel[];
}

// Exported (in addition to the default HOC-wrapped OrdersScreen below) so
// tests can render it directly with plain-object props, bypassing the
// withDatabase/withObservables HOC chain entirely, that chain is mocked as
// an identity function in OrdersScreen.spec.tsx and doesn't actually compute
// myOrders, so testing badge/render behavior through the wrapped export isn't
// possible without a much more elaborate observable mock.
export function OrdersScreenBase({ database, myOrders, releasedOrders = [] }: Props): React.JSX.Element {
  // Reset ref setiap render agar tidak ada referensi stale dari render sebelumnya.
  handleAcceptRef.current = null;
  fetchPoolRef.current = null;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Orders'>>();
  const [poolOrders, setPoolOrders] = useState<OrderModel[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(networkMonitor.getStatus() === 'online');
  const [pendingOrderIds, setPendingOrderIds] = useState<Set<string>>(new Set());
  const [staleOrderIds, setStaleOrderIds] = useState<Set<string>>(new Set());

  // GPS location state
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Refs for socket unsubscribe
  const unsubscribeRef = useRef<Array<() => void>>([]);

  // Location subscription
  useEffect(() => {
    let cancelled = false;
    // Initial fix dari last-known cache
    locationService.getLastKnown().then((loc) => {
      if (cancelled || !loc) return;
      setCurrentLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    });
    // Subscribe to updates
    locationService.subscribe((loc) => {
      setCurrentLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    }).then((unsub) => {
      if (cancelled) unsub();
    });
    return () => { cancelled = true; };
  }, []);

  // Network monitor subscription
  useEffect(() => {
    const unsubscribe = networkMonitor.subscribe((status) => {
      setIsOnline(status === 'online');
    });
    return unsubscribe;
  }, []);

  // Route service instance
  const routeService = useMemo(() => {
    const provider = new GraphHopperRoutingProvider();
    return new RouteService({ routingProvider: provider, database });
  }, [database]);

  // Fetch available pool from REST
  const fetchPool = useCallback(async (): Promise<void> => {
    let response: Awaited<ReturnType<typeof fetchAvailableOrders>>;
    try {
      response = await fetchAvailableOrders();
    } catch (err) {
      // Network error, 401, 5xx, atau respons tidak valid: tidak ada
      // perubahan. auth-expired dipancarkan lewat fetchWithAuth kalau token
      // tidak berlaku; jalur ini cukup keluar tanpa log galat untuk 401.
      if (!(err instanceof UnauthorizedError)) {
        console.warn('[OrdersScreen] fetchPool failed:', err);
      }
      return;
    }

    const { items: serverItems, hasMore } = response;
    const serverIds = new Set(serverItems.map((item) => item.orderId).filter(Boolean));
    const nowMs = Date.now();
    const batch: OrderModel[] = [];

    // Baris pool dibaca di dalam database.write yang sama dengan penulisannya.
    // Kalau dipisah, tulisan Terima (handleAccept) bisa masuk di antaranya
    // dan order yang baru diterima terhapus atau tertimpa lagi jadi ASSIGNED.
    await database.write(async () => {
      // Baris pool: status ASSIGNED, driver_id null, deleted_at kosong. Baris
      // pool yang punya aksi outbox tidak diubah atau dihapus. Baris lain
      // yang ada di daftar server hanya dijadikan baris pool kalau sudah
      // lepas (lihat di bawah).
      const poolRows: OrderModel[] = await database
        .get<OrderModel>('orders')
        .query(
          Q.where('status', 'ASSIGNED'),
          Q.where('driver_id', null),
          Q.where('deleted_at', null),
        )
        .fetch();

      // Baris yang punya aksi outbox berstatus apa pun tidak disentuh,
      // termasuk aksi 'failed' dan 'orphaned_needs_review'.
      const pendingActionsCollection = database.get<PendingActionModel>('pending_actions');
      const pendingIds = new Set<string>();
      for (const row of poolRows) {
        const count = await pendingActionsCollection
          .query(Q.where('target_order_id', row.id))
          .fetchCount();
        if (count > 0) {
          pendingIds.add(row.id);
        }
      }

      // Update pool rows that appear in server list (unless they have pending actions).
      for (const item of serverItems) {
        if (!item.orderId) continue;
        const row = poolRows.find((r) => r.id === item.orderId);
        if (!row) continue;
        // Skip rows with pending actions.
        if (pendingIds.has(row.id)) continue;
        // Skip rows that are not 'synced' (local changes must not be overwritten).
        if (row._getRaw('_status') !== 'synced') continue;
        batch.push(
          row.prepareUpdate((r) => {
            // _setRaw for schema columns; direct mutation for internal _status/_changed.
            // _setRaw mutates _raw in-place via Object.assign, so the changes persist on
            // the same object that batch() pushes to the Loki adapter.
            r._setRaw('server_version', item.version);
            r._setRaw('total_cents', item.totalCents);
            r._setRaw('currency', item.currency);
            // Status pool order selalu ASSIGNED (pool hanya berisi order ASSIGNED).
            // available order payload tidak mengirim status, jadi hardcode di sini.
            r._setRaw('status', 'ASSIGNED');
            // Baris pool hanya boleh menyimpan kota dari server, jadi alamat
            // lengkap dan barang lama dibuang.
            r._setRaw('address_json', poolAddressJson(item.city));
            r._setRaw('items_json', '[]');
            // Internal fields: not in schema, set directly on _raw.
            r._raw._status = 'synced';
            r._raw._changed = '';
            // updated_at tetap Date.now(), sama seperti buildPoolRow.
            // created_at dan customer_id tidak diubah.
            // last_conflict_* tidak diubah, supaya banner dan kotak
            // pemberitahuan tidak hilang karena fetchPool.
          }),
        );
      }

      // Create new pool rows for server items not yet in local DB.
      for (const item of serverItems) {
        if (!item.orderId) continue;
        if (poolRows.some((r) => r.id === item.orderId)) continue;
        // Cek juga baris non-pool untuk mencegah pembuatan ganda
        // (misalnya baris yang sudah punya driver_id terisi dari seed).
        // Baris lain yang sudah lepas (driver_id kosong, _status synced,
        // deleted_at kosong, tanpa aksi outbox) dijadikan baris pool dengan
        // data server terbaru.
        const alreadyExists = await database.get<OrderModel>('orders').find(item.orderId).catch(() => null);
        if (alreadyExists) {
          // Aksi berstatus apa pun menghalangi: order dengan COD yang gagal
          // atau yatim tidak boleh muncul di Tersedia, karena uangnya masih
          // harus diselesaikan.
          const existingDriverId = alreadyExists._getRaw('driver_id');
          const driverIsEmpty = existingDriverId === null || existingDriverId === '';
          if (!driverIsEmpty) continue;
          if (alreadyExists._getRaw('deleted_at') !== null) continue;
          if (alreadyExists._getRaw('_status') !== 'synced') continue;
          // Sama seperti poolRows di atas: hitung semua baris pending_actions
          // untuk order ini, status apa pun.
          const existingCount = await pendingActionsCollection
            .query(Q.where('target_order_id', item.orderId))
            .fetchCount();
          if (existingCount > 0) continue;
          batch.push(
            alreadyExists.prepareUpdate((r) => {
              r._setRaw('server_version', item.version);
              r._setRaw('total_cents', item.totalCents);
              r._setRaw('currency', item.currency);
              // Status pool selalu ASSIGNED; order masuk daftar Tersedia.
              r._setRaw('status', 'ASSIGNED');
              // Baris pool hanya boleh menyimpan kota dari server, jadi alamat
              // lengkap dan barang lama dibuang.
              r._setRaw('address_json', poolAddressJson(item.city));
              r._setRaw('items_json', '[]');
              r._raw._status = 'synced';
              r._raw._changed = '';
              // last_conflict_* tidak diubah: banner masih berlaku.
            }),
          );
          continue;
        }
        const row = buildPoolRow(
          {
            orderId: item.orderId,
            totalCents: item.totalCents,
            currency: item.currency,
            city: item.city,
            createdAt: item.createdAt,
            version: item.version,
          },
          nowMs,
        );
        batch.push(database.get<OrderModel>('orders').prepareCreateFromDirtyRaw(row));
      }

      // Delete pool rows not in server list, ONLY when hasMore is false.
      if (!hasMore) {
        for (const row of poolRows) {
          if (serverIds.has(row.id)) continue;
          // Skip rows with pending actions.
          if (pendingIds.has(row.id)) continue;
          batch.push(row.prepareDestroyPermanently());
        }
      }

      if (batch.length > 0) {
        await database.batch(...batch);
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
  }, [database]);
  // Sinkronkan ref agar tes bisa memanggil langsung dari luar komponen.
  fetchPoolRef.current = fetchPool;

  // Initial fetch
  useEffect(() => {
    fetchPool();
  }, [fetchPool]);

  // Listen for pool-refresh events (emitted by handleAccept on 409 conflict).
  useEffect(() => {
    const handler = () => {
      fetchPool();
    };
    syncEvents.on('pool-refresh', handler);
    return () => {
      syncEvents.off('pool-refresh', handler);
    };
  }, [fetchPool]);

  // Check pending actions for myOrders
  useEffect(() => {
    let cancelled = false;
    const checkPending = async () => {
      if (!myOrders?.length) return;
      try {
        const pendingResults = await Promise.all(myOrders.map((o) => hasPendingAction(o.id)));
        const staleResults = await Promise.all(myOrders.map((o) => hasStalePendingAction(o.id)));
        if (!cancelled) {
          const pending = new Set<string>();
          const stale = new Set<string>();
          myOrders.forEach((o, i) => {
            if (pendingResults[i]) pending.add(o.id);
            if (staleResults[i]) stale.add(o.id);
          });
          setPendingOrderIds(pending);
          setStaleOrderIds(stale);
        }
      } catch (err) {
        console.warn('[OrdersScreen] failed to check pending actions:', err);
      }
    };
    checkPending();
    return () => { cancelled = true; };
  }, [myOrders]);

  // Socket subscription
  useEffect(() => {
    // Clear previous unsubscribes
    unsubscribeRef.current.forEach((unsub) => unsub());
    unsubscribeRef.current = [];

    const onAvailable = () => {
      console.log('[OrdersScreen] order:available, refetching pool');
      fetchPool();
    };
    const onUnavailable = () => {
      console.log('[OrdersScreen] order:unavailable, refetching pool');
      fetchPool();
    };
    // Server tidak kirim ulang event yang terlewat selama socket putus,
    // supaya tab Tersedia dapat daftar order terbaru setelah sambungan
    // pulih, panggil fetchPool() sekali lagi saat socket tersambung.
    // Aman dipanggil berulang-ulang saat connect pertama karena fetchPool
    // idempotent.
    const onConnect = () => {
      console.log('[OrdersScreen] connect: refetching pool');
      fetchPool();
    };

    // onOrderAvailable/onOrderUnavailable/on('connect') mengembalikan fungsi unsubscribe
    const unsubAvailable = ordersSocket.onOrderAvailable(onAvailable);
    const unsubUnavailable = ordersSocket.onOrderUnavailable(onUnavailable);
    const unsubConnect = ordersSocket.on('connect', onConnect);

    unsubscribeRef.current = [
      unsubAvailable,
      unsubUnavailable,
      unsubConnect,
    ];

    return () => {
      unsubscribeRef.current.forEach((unsub) => unsub());
      unsubscribeRef.current = [];
    };
  }, [fetchPool]);

  // Pull to refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPool();
    // Re-check pending actions after pool refresh
    if (myOrders?.length) {
      try {
        const pendingResults = await Promise.all(myOrders.map((o) => hasPendingAction(o.id)));
        const staleResults = await Promise.all(myOrders.map((o) => hasStalePendingAction(o.id)));
        const pending = new Set<string>();
        const stale = new Set<string>();
        myOrders.forEach((o, i) => {
          if (pendingResults[i]) pending.add(o.id);
          if (staleResults[i]) stale.add(o.id);
        });
        setPendingOrderIds(pending);
        setStaleOrderIds(stale);
      } catch (err) {
        console.warn('[OrdersScreen] onRefresh: failed to check pending actions:', err);
      }
    }
    setRefreshing(false);
  }, [fetchPool, myOrders]);

  // Accept order
  const handleAccept = useCallback(
    async (order: OrderModel): Promise<void> => {
      if (networkMonitor.getStatus() !== 'online') {
        Alert.alert(
          'Butuh Koneksi',
          'Terima order butuh koneksi internet biar nggak bentrok sama driver lain.',
        );
        return;
      }

      const userId = await getCurrentUserId();
      if (!userId) {
        console.warn('[OrdersScreen] handleAccept: no userId');
        return;
      }

      // _getRaw karena dekorator model tidak aktif di Jest. Baris pool selalu
      // membawa versi dari server; kalau tidak ada, jangan kirim apa pun.
      const serverVersion = order._getRaw('server_version');
      if (typeof serverVersion !== 'number') {
        console.warn('[OrdersScreen] handleAccept: server_version bukan angka', order.id);
        Alert.alert('Gagal', 'Terima order gagal. Coba lagi.');
        return;
      }

      let response: Awaited<ReturnType<typeof acceptOrder>>;
      try {
        response = await acceptOrder(order.id, serverVersion);
      } catch (err: unknown) {
        // Hanya ApiError dengan status 409 dianggap konflik (status backend
        // ConflictException, code bisa ORDER_UNAVAILABLE atau VERSION_CONFLICT).
        // Pesan teks TIDAK lagi dicocokkan, backend kini mengirim body
        // { code, message } dan caller diharap pakai err.code, bukan parse pesan.
        if (err instanceof ApiError && err.status === 409) {
          Alert.alert(
            'Order sudah berubah atau diambil driver lain. Daftar diperbarui.',
          );
          syncEvents.emit('pool-refresh', {});
          return;
        }
        console.error('[OrdersScreen] acceptOrder failed:', err);
        Alert.alert('Gagal', 'Terima order gagal. Coba lagi.');
        return;
      }

      // Sukses: tulis baris lokal dari respons server via WatermelonDB batch.
      // Respons POST /orders/:id/accept adalah Order lengkap, jadi tulis
      // semua kolom order (alamat, item, total, dsb) supaya baris siap
      // untuk detail dan pre-compute rute tanpa fetch ulang. Pola
      // JSON.stringify sama dengan buildRawRowForCreate di coordinator.ts
      // supaya serialisasi address_json/items_json konsisten.
      try {
        await database.write(async () => {
          await database.batch(
            order.prepareUpdate((r) => {
              r._setRaw('status', response.status);
              r._setRaw('driver_id', response.driverId ?? userId);
              r._setRaw('server_version', response.version);
              r._setRaw('customer_id', response.customerId);
              r._setRaw('items_json', JSON.stringify(response.items));
              r._setRaw('address_json', JSON.stringify(response.deliveryAddress));
              r._setRaw('total_cents', response.totalCents);
              r._setRaw('currency', response.currency);
              r._setRaw('notes', response.notes ?? null);
              r._setRaw('cancelled_by', response.cancelledBy ?? null);
              r._setRaw('cancel_reason', response.cancelReason ?? null);
              r._setRaw('updated_at', Date.parse(response.updatedAt));
              // Bersihkan banner tersimpan (last_conflict_reason/at) kalau ada:
              // Terima sukses artinya baris bukan lagi 'released'/'reassigned',
              // sehingga banner LastConflictBanner harus hilang.
              r._setRaw('last_conflict_reason', null);
              r._setRaw('last_conflict_at', null);
              // created_at tidak diubah
              r._raw._status = 'synced';
              r._raw._changed = '';
            }),
          );
        });
      } catch (err) {
        console.error('[OrdersScreen] acceptOrder: local write failed:', err);
        return;
      }

      // Remove from pool (local state)
      setPoolOrders((prev) => prev.filter((o) => o.id !== order.id));

      // Pre-compute route for offline-ready. Pakai koordinat dari respons
      // (bukan dari model baris), karena baris pool awalnya tidak punya
      // address_json. Asal dari GPS terakhir, syarat status 'online' dan
      // GPS tersedia. Tidak di-await (Terima tidak menunggu rute); gagal
      // hanya dicatat di log.
      if (networkMonitor.getStatus() === 'online' && currentLocation) {
        const addressJson = response.deliveryAddress;
        const coordinates = addressJson.coordinates;
        if (coordinates && coordinates.length === 2) {
          const [lng, lat] = coordinates;
          const destination = { lng, lat };
          const origin = { lng: currentLocation.lng, lat: currentLocation.lat };
          routeService.getRoute({ origin, destination }).catch((err) => {
            console.warn('[OrdersScreen] pre-compute route failed:', err);
          });
        }
      }
    },
    [database, routeService, currentLocation],
  );
  // Sinkronkan ref agar tes bisa memanggil langsung dari luar komponen.
  handleAcceptRef.current = handleAccept;

  // Section data
  const sections: SectionData[] = [
    { title: 'Tersedia', data: poolOrders },
    { title: 'Order Saya', data: myOrders },
  ];

  const renderItem = ({ item, section }: { item: OrderModel; section: SectionData }) => {
    const isPool = section.title === 'Tersedia';
    const isMyOrder = section.title === 'Order Saya';
    const hasPending = isMyOrder && pendingOrderIds.has(item.id);
    const isStale = isMyOrder && staleOrderIds.has(item.id);
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
          {hasPending && !isStale && (
            <Text style={styles.pendingBadge}>Menunggu sinkronisasi</Text>
          )}
          {isStale && (
            <Text style={styles.stalePendingBadge}>
              Belum tersinkron dari sejam lalu — cek koneksi internet kamu
            </Text>
          )}
        </View>
        {isPool && (
          <TouchableOpacity
            style={[styles.acceptButton, !isOnline && styles.acceptButtonDisabled]}
            onPress={() => handleAccept(item)}
            disabled={!isOnline}
          >
            <Text style={[styles.acceptButtonText, !isOnline && styles.acceptButtonTextDisabled]}>Terima Order</Text>
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

  // Data biasa untuk ReleasedOrdersNotice. last_conflict_at dibaca mentah
  // dalam milidetik; nilai yang bukan angka dianggap null.
  const releasedItems: ReleasedOrderItem[] = releasedOrders.map((row) => {
    const raw = row._getRaw('last_conflict_at');
    return {
      id: row.id,
      lastConflictAt: typeof raw === 'number' ? raw : null,
    };
  });

  return (
    <>
      <ReleasedOrdersNotice
        items={releasedItems}
        onOpen={(orderId) => navigation.navigate('OrderDetail', { orderId })}
        onDismiss={(orderIds) => { void dismissReleasedOrders(database, orderIds); }}
      />
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

// HOC: withObservables dengan triggerProps ['currentUserId']
// currentUserId di-pass sebagai trigger prop ke withObservables.
// Saat currentUserId berubah, observable myOrders akan re-query.
const OrdersScreenWithObservables = withDatabase(
  withObservables(
    ['currentUserId'],
    ({ database, currentUserId }: { database: Database; currentUserId: string | null }) => ({
      myOrders: currentUserId
        ? database
            .get<OrderModel>('orders')
            .query(
              Q.where('driver_id', currentUserId),
              Q.where('deleted_at', null),
              Q.sortBy('updated_at', Q.desc),
            )
            .observe()
        : of<OrderModel[]>([]),
      // Baris order dengan driver_id null dan last_conflict_reason 'released'
      // atau 'reassigned', untuk kotak pemberitahuan order yang lepas.
      releasedOrders: currentUserId
        ? releasedOrdersQuery(database)
        : of<OrderModel[]>([]),
    }),
  )(OrdersScreenBase),
);

// Wrapper: resolve currentUserId sebelum render
// Props explicit agar database flow dari test, wrapper, observables
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
  pendingBadge: {
    marginTop: 4,
    fontSize: 12,
    color: '#1e40af',
    backgroundColor: '#dbeafe',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  stalePendingBadge: {
    marginTop: 4,
    fontSize: 12,
    color: '#92400e',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  acceptButton: {
    backgroundColor: '#22c55e',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    marginLeft: 12,
  },
  acceptButtonDisabled: {
    backgroundColor: '#a1a1aa',
  },
  acceptButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  acceptButtonTextDisabled: { color: '#d4d4d8' },
  empty: { padding: 32, alignItems: 'center' },
  loading: { padding: 32, alignItems: 'center' },
});

// Export handleAccept dan fetchPool untuk tes regresi.
// handleAcceptRef dijaga agar selalu merujuk ke callback handleAccept terbaru,
// yang bisa dipanggil langsung dari tes tanpa harus render/tekan tombol.
// Fungsi-fungsi ini sudah punya closure terhadap database, setPoolOrders, fetchPool,
// currentLocation, dan routeService saat dipanggil dari dalam OrdersScreenBase.
export const handleAcceptRef: { current: ((order: OrderModel) => Promise<void>) | null } = {
  current: null,
};
export const fetchPoolRef: { current: (() => Promise<void>) | null } = {
  current: null,
};
