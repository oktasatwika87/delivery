import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Q } from '@nozbe/watermelondb';
import { withDatabase, withObservables } from '@nozbe/watermelondb/react';
import type { Database } from '@nozbe/watermelondb';
import { of } from 'rxjs';
import { OrderStatus } from '@delivery/shared';

import type { RootStackParamList } from '../../App';
import { OrderModel } from '../db/models/OrderModel';
import { PendingActionModel } from '../db/models/PendingActionModel';
import { getCurrentUserId } from '../sync/session';
import { fetchAvailableOrders, UnauthorizedError, acceptOrder, ApiError } from '../sync/client';
import { ordersSocket } from '../sync/ordersSocket';
import { syncEvents } from '../sync/syncEvents';
import { deriveOrderSyncView } from '../sync/orderSyncView';
import { buildPoolRow, poolAddressJson } from './buildPoolRow';
import {
  ReleasedOrdersNotice,
  dismissReleasedOrders,
  releasedOrdersQuery,
  type ReleasedOrderItem,
} from './ReleasedOrdersNotice';
import { locationService } from '../map/location';
import { networkMonitor } from '../map/networkMonitor';
import type { NetworkStatus } from '../map/networkMonitor';
import { RouteService } from '../map/routeService';
import { GraphHopperRoutingProvider } from '../map/routing';
import { ConnectionBar } from '../components/ConnectionBar';
import { MainHeader } from '../components/AppBar';
import { Tabs } from '../components/Tabs';
import type { TabItem } from '../components/Tabs';
import { OrderCard } from '../components/OrderCard';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../theme/Icon';
import { colors, fontFamily, type } from '../theme/tokens';
import { formatCurrency } from '../formatCurrency';
import { formatOrderNumber } from '../formatOrderNumber';
import { formatOrderTime } from '../formatOrderTime';
import { driverStatusLabel } from '../driverStatusLabel';

const TAB_TERSEDIA = 'available';
const TAB_SAYA = 'mine';

type TabKey = typeof TAB_TERSEDIA | typeof TAB_SAYA;

// Nilai dari desain: ikon kecil 16 dp dan jarak 6 dp.
const UKURAN_IKON = 16;
const JARAK_IKON = 6;

const TEKS_BUTUH_KONEKSI = 'Butuh koneksi internet untuk menerima order';

interface Props {
  database: Database;
  // Kosong kalau layar belum tahu order milik sendiri.
  myOrders?: OrderModel[];
  releasedOrders?: OrderModel[];
  onLogout: () => void;
}

const ORDER_STATUS_VALUES: readonly string[] = Object.values(OrderStatus);

function isOrderStatus(value: string): value is OrderStatus {
  return ORDER_STATUS_VALUES.includes(value);
}

// Status baris dibaca mentah karena dekorator model tidak aktif di Jest.
function readOrderStatus(row: OrderModel): OrderStatus {
  const raw = row._getRaw('status');
  if (typeof raw === 'string' && isOrderStatus(raw)) return raw;
  return OrderStatus.PENDING;
}

function readTotalCents(row: OrderModel): number {
  const raw = row._getRaw('total_cents');
  return typeof raw === 'number' ? raw : 0;
}

function readCurrency(row: OrderModel): string {
  const raw = row._getRaw('currency');
  return typeof raw === 'string' ? raw : '';
}

function readWaktu(row: OrderModel, column: 'created_at' | 'updated_at'): number {
  const raw = row._getRaw(column);
  return typeof raw === 'number' ? raw : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface AlamatBaris {
  street: string | null;
  city: string | null;
}

// Alamat diambil dari address_json. JSON rusak dianggap objek kosong, jadi
// layar tetap bisa menampilkan kartu.
function readAlamat(row: OrderModel): AlamatBaris {
  const raw = row._getRaw('address_json');
  if (typeof raw !== 'string' || raw.length === 0) {
    return { street: null, city: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { street: null, city: null };
  }
  if (!isRecord(parsed)) {
    return { street: null, city: null };
  }
  const street = parsed.street;
  const city = parsed.city;
  return {
    street: typeof street === 'string' && street.length > 0 ? street : null,
    city: typeof city === 'string' && city.length > 0 ? city : null,
  };
}

// Tab awal ditentukan sekali, waktu layar dipasang: kalau ada order yang
// sedang dikerjakan, pengguna langsung butuh melihatnya.
function tabAwal(myOrders: OrderModel[]): TabKey {
  const adaYangDikerjakan = myOrders.some((row) => {
    const status = readOrderStatus(row);
    return status === OrderStatus.PREPARING || status === OrderStatus.OUT_FOR_DELIVERY;
  });
  return adaYangDikerjakan ? TAB_SAYA : TAB_TERSEDIA;
}

// Exported (in addition to the default HOC-wrapped OrdersScreen below) so
// tests can render it directly with plain-object props, bypassing the
// withDatabase/withObservables HOC chain entirely, that chain is mocked as
// an identity function in OrdersScreen.spec.tsx and doesn't actually compute
// myOrders, so testing badge/render behavior through the wrapped export isn't
// possible without a much more elaborate observable mock.
export function OrdersScreenBase({
  database,
  myOrders = [],
  releasedOrders = [],
  onLogout,
}: Props): React.JSX.Element {
  // Reset ref setiap render agar tidak ada referensi stale dari render sebelumnya.
  handleAcceptRef.current = null;
  fetchPoolRef.current = null;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Orders'>>();
  const [poolOrders, setPoolOrders] = useState<OrderModel[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>(networkMonitor.getStatus());
  // Semua aksi outbox, untuk semua order. Satu langganan untuk seluruh
  // layar, jadi lencana hilang sendiri begitu aksi terkirim dan dihapus.
  const [pendingActions, setPendingActions] = useState<PendingActionModel[]>([]);
  // Jumlah aksi yang masih antre, dipakai ConnectionBar.
  const [pendingActionCount, setPendingActionCount] = useState(0);
  // Fetch pertama sudah selesai, berhasil atau gagal.
  const [firstFetchDone, setFirstFetchDone] = useState(false);
  // Order yang sedang diterima, buat menandai satu kartu saja.
  const [acceptingOrderId, setAcceptingOrderId] = useState<string | null>(null);
  // Tab awal ditentukan sekali, waktu layar dipasang.
  const [activeTab, setActiveTab] = useState(() => tabAwal(myOrders));

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
      setNetworkStatus(status);
    });
    return unsubscribe;
  }, []);

  // Route service instance
  const routeService = useMemo(() => {
    const provider = new GraphHopperRoutingProvider();
    return new RouteService({ routingProvider: provider, database });
  }, [database]);

  // Fetch available pool from REST
  const runFetchPool = useCallback(async (): Promise<void> => {
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

  // Penanda fetch pertama tetap terisi walau fetch gagal, supaya layar tahu
  // daftar sudah ditanyakan ke server.
  const fetchPool = useCallback(async (): Promise<void> => {
    try {
      await runFetchPool();
    } finally {
      setFirstFetchDone(true);
    }
  }, [runFetchPool]);

  // Sinkronkan ref agar tes bisa memanggil langsung dari luar komponen.
  fetchPoolRef.current = fetchPool;

  // Baca daftar pool dari database dulu, baru panggil fetchPool. Urutan ini
  // penting: kalau keduanya jalan bersamaan, bacaan awal bisa menimpa hasil
  // fetchPool dan mengembalikan order yang server sudah hapus.
  useEffect(() => {
    let cancelled = false;
    const loadPool = async (): Promise<void> => {
      const pool = await database
        .get<OrderModel>('orders')
        .query(
          Q.where('driver_id', null),
          Q.where('status', 'ASSIGNED'),
          Q.where('deleted_at', null),
        )
        .fetch();
      if (cancelled) return;
      setPoolOrders(pool);
      await fetchPool();
    };
    void loadPool();
    return () => {
      cancelled = true;
    };
  }, [database, fetchPool]);

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

  // Langganan semua aksi outbox. Dibuka saat layar dipasang dan ditutup
  // saat dilepas, jadi lencana ikut hilang sendiri begitu aksi dihapus
  // dari database tanpa tarik-segarkan.
  useEffect(() => {
    const subscription = database
      .get<PendingActionModel>('pending_actions')
      .query()
      .observeWithColumns(['status'])
      .subscribe((actions) => {
        setPendingActions(actions);
        setPendingActionCount(
          actions.filter((action) => {
            const status = action._getRaw('status');
            return status === 'pending' || status === 'syncing';
          }).length,
        );
      });
    return () => {
      subscription.unsubscribe();
    };
  }, [database]);

  // Aksi dikelompokkan per order, supaya tiap kartu cuma melihat aksinya
  // sendiri.
  const actionsByOrderId = useMemo(() => {
    const grouped = new Map<string, PendingActionModel[]>();
    for (const action of pendingActions) {
      const orderId = action._getRaw('target_order_id');
      if (typeof orderId !== 'string' || orderId.length === 0) continue;
      const list = grouped.get(orderId);
      if (list) {
        list.push(action);
      } else {
        grouped.set(orderId, [action]);
      }
    }
    return grouped;
  }, [pendingActions]);

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
    setRefreshing(false);
  }, [fetchPool]);

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

      setAcceptingOrderId(order.id);
      try {
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
                // Terima sukses artinya order bukan lagi 'released'/'reassigned',
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

        // Terima berhasil, jadi pengguna mau lihat ordernya: pindah ke tab
        // Order Saya.
        setActiveTab(TAB_SAYA);

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
      } finally {
        setAcceptingOrderId(null);
      }
    },
    [database, routeService, currentLocation],
  );
  // Sinkronkan ref agar tes bisa memanggil langsung dari luar komponen.
  handleAcceptRef.current = handleAccept;

  const online = networkStatus === 'online';
  // Selama fetch pertama belum selesai, layar belum tahu apa isi daftar.
  const fetchBelumSelesai = !firstFetchDone;
  const tampilkanKosong = !(fetchBelumSelesai && networkStatus !== 'offline');

  const tabs: TabItem[] = [
    { key: TAB_TERSEDIA, label: 'Tersedia', count: poolOrders.length },
    { key: TAB_SAYA, label: 'Order Saya', count: myOrders.length },
  ];

  const onTabChange = useCallback((key: string) => {
    if (key === TAB_TERSEDIA || key === TAB_SAYA) {
      setActiveTab(key);
    }
  }, []);

  const renderPoolItem = ({ item }: { item: OrderModel }) => {
    const alamat = readAlamat(item);
    return (
      <OrderCard
        variant="pool"
        orderNumber={formatOrderNumber(item.id)}
        timeText={formatOrderTime(readWaktu(item, 'created_at'), Date.now())}
        city={alamat.city}
        amountText={formatCurrency(readTotalCents(item), readCurrency(item))}
        onAccept={() => { void handleAccept(item); }}
        acceptDisabled={!online}
        acceptHelp={online ? undefined : TEKS_BUTUH_KONEKSI}
        acceptLoading={acceptingOrderId === item.id}
        onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
      />
    );
  };

  const renderMineItem = ({ item }: { item: OrderModel }) => {
    // Kartu Order Saya memakai status yang sedang berlaku: kalau ada aksi
    // status yang antre, status targetnya yang tampil.
    const actions = actionsByOrderId.get(item.id) ?? [];
    const { displayStatus, syncState } = deriveOrderSyncView(readOrderStatus(item), actions);
    const alamat = readAlamat(item);
    return (
      <OrderCard
        variant="mine"
        orderNumber={formatOrderNumber(item.id)}
        status={displayStatus}
        statusText={driverStatusLabel(displayStatus)}
        addressMain={alamat.street ?? 'Alamat tidak tersedia'}
        addressSub={alamat.city ?? undefined}
        syncState={syncState ?? undefined}
        amountText={formatCurrency(readTotalCents(item), readCurrency(item))}
        timeText={formatOrderTime(readWaktu(item, 'created_at'), Date.now())}
        onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
      />
    );
  };

  // Kepala daftar ikut tergulir. Di Tersedia keterangan daftar, di Order
  // Saya kotak order yang sudah lepas.
  const renderPoolHeader = (): React.JSX.Element | null => {
    if (poolOrders.length === 0) return null;
    const terbaru = poolOrders.reduce(
      (max, row) => Math.max(max, readWaktu(row, 'updated_at')),
      0,
    );
    return (
      <View style={styles.kepalaDaftar}>
        <Icon
          name={online ? 'refresh' : 'schedule'}
          size={UKURAN_IKON}
          color={colors.textMuted}
        />
        <Text style={styles.teksKepalaDaftar}>
          {online
            ? 'Tarik ke bawah untuk menyegarkan'
            : `Daftar terakhir diperbarui ${formatOrderTime(terbaru, Date.now())}`}
        </Text>
      </View>
    );
  };

  // Data biasa untuk ReleasedOrdersNotice. last_conflict_at dibaca mentah
  // dalam milidetik; nilai yang bukan angka dianggap null.
  const releasedItems: ReleasedOrderItem[] = releasedOrders.map((row) => {
    const raw = row._getRaw('last_conflict_at');
    return {
      id: row.id,
      lastConflictAt: typeof raw === 'number' ? raw : null,
    };
  });

  const notice = (
    <ReleasedOrdersNotice
      items={releasedItems}
      onOpen={(orderId) => navigation.navigate('OrderDetail', { orderId })}
      onDismiss={(orderIds) => { void dismissReleasedOrders(database, orderIds); }}
    />
  );

  const kosongTersedia = tampilkanKosong ? (
    online ? (
      <EmptyState
        icon="inventory_2"
        title="Belum ada order"
        body="Order baru muncul di sini otomatis. Tarik ke bawah untuk menyegarkan."
      />
    ) : (
      <EmptyState
        icon="cloud_off"
        title="Belum ada daftar order tersimpan"
        body="Sambungkan internet untuk melihat order baru."
      />
    )
  ) : null;

  const kosongSaya = (
    <EmptyState
      icon="two_wheeler"
      title="Belum ada order diterima"
      body="Order yang diterima muncul di sini."
    />
  );

  const tampilTersedia = activeTab === TAB_TERSEDIA;

  return (
    <View style={styles.layar}>
      <StatusBar barStyle="light-content" backgroundColor={colors.surfaceInverse} />
      <ConnectionBar status={networkStatus} pendingCount={pendingActionCount} />
      <MainHeader title="Order" subtitle="Driver" onLogout={onLogout}>
        <Tabs tabs={tabs} activeKey={activeTab} onChange={onTabChange} />
      </MainHeader>
      <FlatList
        data={tampilTersedia ? poolOrders : myOrders}
        keyExtractor={(row) => row.id}
        renderItem={tampilTersedia ? renderPoolItem : renderMineItem}
        ListHeaderComponent={tampilTersedia ? renderPoolHeader() : notice}
        ListEmptyComponent={tampilTersedia ? kosongTersedia : kosongSaya}
        refreshControl={
          <RefreshControl
            refreshing={refreshing || (fetchBelumSelesai && networkStatus !== 'offline')}
            onRefresh={onRefresh}
          />
        }
        contentContainerStyle={styles.daftar}
      />
    </View>
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
            .observeWithColumns(['status', 'updated_at'])
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
  onLogout: () => void;
}
function OrdersScreenWrapper({ database, onLogout }: WrapperProps): React.JSX.Element {
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

  return (
    <OrdersScreenWithObservables
      database={database}
      currentUserId={currentUserId}
      onLogout={onLogout}
    />
  );
}

export const OrdersScreen = withDatabase(OrdersScreenWrapper);

const styles = StyleSheet.create({
  layar: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  daftar: {
    padding: 16,
    gap: 12,
  },
  kepalaDaftar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: JARAK_IKON,
  },
  teksKepalaDaftar: {
    ...type.caption,
    fontFamily: fontFamily.semibold,
    color: colors.textMuted,
  },
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
