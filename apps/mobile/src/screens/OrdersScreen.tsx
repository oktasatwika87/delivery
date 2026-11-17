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
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { RootStackParamList } from '../../App';
import { OrderModel } from '../db/models/OrderModel';
import { PaymentModel } from '../db/models/PaymentModel';
import { PendingActionModel } from '../db/models/PendingActionModel';
import { getCurrentUserId } from '../sync/session';
import { fetchAvailableOrders, UnauthorizedError, acceptOrder, ApiError } from '../sync/client';
import { hapticAccept, hapticError } from '../haptics';
import { ordersSocket } from '../sync/ordersSocket';
import { syncEvents } from '../sync/syncEvents';
import { deriveOrderSyncView } from '../sync/orderSyncView';
import { buildPoolRow, poolAddressJson } from './buildPoolRow';
import {
  readCurrency,
  readOrderStatus,
  readTotalCents,
  readWaktu,
} from './orderRowRead';
import { countActiveOrders, sortMyOrders, sortPoolOrders } from './orderListSort';
import { deriveDaySummary } from './daySummary';
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
import { DaySummary } from '../components/DaySummary';
import { MainHeader } from '../components/AppBar';
import { Tabs } from '../components/Tabs';
import type { TabItem } from '../components/Tabs';
import { OrderCard } from '../components/OrderCard';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../theme/Icon';
import { exitEasing, exitRight, shift, standardEasing } from '../components/motion/presets';
import { ListEnterRow, useListEnter } from '../components/motion/listEnter';
import { useInitialWindow } from '../components/motion/InitialWindow';
import { perTema, ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { motion, size, space, type } from '../theme/tokens';
import { formatCurrency } from '../formatCurrency';
import { formatOrderNumber } from '../formatOrderNumber';
import { formatOrderTime } from '../formatOrderTime';
import { driverStatusLabel } from '../driverStatusLabel';

const TAB_TERSEDIA = 'available';
const TAB_SAYA = 'mine';

type TabKey = typeof TAB_TERSEDIA | typeof TAB_SAYA;

// Jarak ikon dan teks di kepala daftar.
const JARAK_IKON = 6;

const TEKS_BUTUH_KONEKSI = 'Butuh koneksi internet untuk menerima order';

// Jumlah tunai menggabungkan banyak baris payment, dan server selalu mengisi
// mata uang IDR.
const MATA_UANG_TUNAI = 'IDR';

// Geser posisi isi layar, dipakai satu kali jadi konstanta modul.
const GESER = shift();

// Geser posisi baris daftar, dipakai satu kali jadi konstanta modul.
const GESER_BARIS = shift();

// Bentuk keluar kartu yang hilang dari daftar Tersedia.
const KELUAR_KANAN = exitRight();

// Berapa baris pertama yang digambar sekaligus digerakkan.
const JUMLAH_AWAL = 10;

/** Tahap urutan Terima: centang dulu, baru kartu keluar. */
interface UrutanTerima {
  id: string;
  tahap: 'centang' | 'keluar';
}

interface Props {
  database: Database;
  // Kosong kalau layar belum tahu order milik sendiri.
  myOrders?: OrderModel[];
  releasedOrders?: OrderModel[];
  // Payment tunai milik driver ini, buat ringkasan hari ini.
  payments?: PaymentModel[];
  onLogout: () => void;
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
  payments = [],
  onLogout,
}: Props): React.JSX.Element {
  // Reset ref setiap render agar tidak ada referensi stale dari render sebelumnya.
  handleAcceptRef.current = null;
  fetchPoolRef.current = null;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Orders'>>();
  const dalamJendela = useInitialWindow();
  const { name: namaTema, colors: warnaTema } = useTheme();
  const gayaLayar = gaya[namaTema];
  const [poolOrders, setPoolOrders] = useState<OrderModel[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>(networkMonitor.getStatus());
  // Semua aksi outbox, untuk semua order. Satu langganan untuk seluruh
  // layar, jadi lencana hilang sendiri begitu aksi terkirim dan dihapus.
  const [pendingActions, setPendingActions] = useState<PendingActionModel[]>([]);
  // Jumlah aksi yang masih antre, dipakai ConnectionBar.
  const [pendingActionCount, setPendingActionCount] = useState(0);
  // Jumlah aksi yang ditolak server atau COD yatim, dipakai ConnectionBar.
  const [failedActionCount, setFailedActionCount] = useState(0);
  // Fetch pertama sudah selesai, berhasil atau gagal.
  const [firstFetchDone, setFirstFetchDone] = useState(false);
  // Order yang sedang diterima, buat menandai satu kartu saja.
  const [acceptingOrderId, setAcceptingOrderId] = useState<string | null>(null);
  // Tab awal ditentukan sekali, waktu layar dipasang.
  const [activeTab, setActiveTab] = useState(() => tabAwal(myOrders));
  // Tab yang isinya sedang tampil. Berbeda dari activeTab selama isi lama
  // masih memudar keluar sebelum isi baru masuk.
  const [tabTampil, setTabTampil] = useState<TabKey>(() => activeTab);
  // Kurangi gerakan: isi langsung berubah tanpa pudar.
  const kurangiGerak = useReducedMotion();
  // Opasitas isi daftar, dipakai pudar saat ganti tab.
  const opasitasDaftar = useSharedValue(1);
  const daftarRef = useRef<FlatList<OrderModel>>(null);
  // Urutan Terima yang sedang jalan: tombol jadi centang, kartu keluar,
  // baru tab pindah.
  const [terimaBerhasil, setTerimaBerhasil] = useState<UrutanTerima | null>(null);
  // Ref selalu berisi nilai terbaru, jadi handleAccept dan onTabChange
  // membaca urutan yang sedang jalan tanpa closure basi.
  const terimaRef = useRef<UrutanTerima | null>(null);
  terimaRef.current = terimaBerhasil;
  // Order yang baru diterima, disorot sekali.
  const [sorotId, setSorotId] = useState<string | null>(null);

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
        setFailedActionCount(
          actions.filter((action) => {
            const status = action._getRaw('status');
            return status === 'failed' || status === 'orphaned_needs_review';
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

  // Daftar diurutkan sendiri, bukan ikut urutan database. Order aktif
  // dulu, lalu sisanya, dan di dalam tiap kelompok order yang dibuat
  // paling baru dulu.
  const myOrdersUrut = useMemo(
    () => sortMyOrders(myOrders, actionsByOrderId),
    [myOrders, actionsByOrderId],
  );
  const poolUrut = useMemo(() => sortPoolOrders(poolOrders), [poolOrders]);

  // Id baris tiap daftar, dipakai pelacak gerak masuk. Id-nya dijaga
  // identitasnya, karena efek pelacak bergantung pada identitas larik.
  const idTersedia = useMemo(() => poolUrut.map((row) => row.id), [poolUrut]);
  const idSaya = useMemo(() => myOrdersUrut.map((row) => row.id), [myOrdersUrut]);

  // Setiap tab punya pelacak sendiri, jadi baris di tab lain tidak ikut
  // digerakkan.
  const pelacakTersedia = useListEnter(idTersedia, {
    initialCount: JUMLAH_AWAL,
    active: tabTampil === TAB_TERSEDIA,
  });
  const pelacakSaya = useListEnter(idSaya, {
    initialCount: JUMLAH_AWAL,
    active: tabTampil === TAB_SAYA,
  });

  // Pil Order Saya cuma menghitung order yang masih dikerjakan.
  const orderAktif = useMemo(
    () => countActiveOrders(myOrders, actionsByOrderId),
    [myOrders, actionsByOrderId],
  );

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

  // Buang satu kartu dari daftar Tersedia.
  const buangDariTersedia = useCallback((id: string) => {
    setPoolOrders((prev) => prev.filter((o) => o.id !== id));
  }, []);

  // Kartu yang sedang ditahan masih ada di daftar Tersedia.
  const kartuTerimaAda = useMemo(() => {
    if (!terimaBerhasil) return false;
    return poolOrders.some((row) => row.id === terimaBerhasil.id);
  }, [terimaBerhasil, poolOrders]);

  // Urutan Terima: tombol jadi centang, kartu keluar ke kanan, baru tab
  // pindah ke Order Saya. Kartunya ditahan di daftar selama centang.
  useEffect(() => {
    if (!terimaBerhasil) return;
    if (terimaBerhasil.tahap === 'centang') {
      // Kartunya sudah hilang duluan, jadi sisa waktu centang dipotong.
      if (!kartuTerimaAda) {
        setTerimaBerhasil({ id: terimaBerhasil.id, tahap: 'keluar' });
        return;
      }
      const timer = setTimeout(() => {
        buangDariTersedia(terimaBerhasil.id);
        setTerimaBerhasil({ id: terimaBerhasil.id, tahap: 'keluar' });
      }, motion.duration.drawLine);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      setTerimaBerhasil(null);
      setSorotId(terimaBerhasil.id);
      setActiveTab(TAB_SAYA);
    }, motion.duration.exit);
    return () => clearTimeout(timer);
  }, [terimaBerhasil, kartuTerimaAda, buangDariTersedia]);

  // Sorotan cuma sekali. Kartunya dipasang lagi setelah isi tab lama
  // memudar, jadi sorotannya dibersihkan setelah waktu sorot lewat.
  useEffect(() => {
    if (!sorotId) return;
    const timer = setTimeout(() => {
      setSorotId(null);
    }, motion.duration.fadeOut + motion.duration.highlight);
    return () => clearTimeout(timer);
  }, [sorotId]);

  // Accept order
  const handleAccept = useCallback(
    async (order: OrderModel): Promise<void> => {
      if (networkMonitor.getStatus() !== 'online') {
        hapticError();
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

      // Baris pool selalu membawa versi dari server; kalau tidak ada, jangan
      // kirim apa pun.
      const serverVersion = order._getRaw('server_version');
      if (typeof serverVersion !== 'number') {
        console.warn('[OrdersScreen] handleAccept: server_version bukan angka', order.id);
        hapticError();
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
            hapticError();
            Alert.alert(
              'Order sudah berubah atau diambil driver lain. Daftar diperbarui.',
            );
            syncEvents.emit('pool-refresh', {});
            return;
          }
          console.error('[OrdersScreen] acceptOrder failed:', err);
          hapticError();
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

        // Terima berhasil, jadi beri tahu lewat getaran.
        hapticAccept();

        if (kurangiGerak) {
          // Tanpa gerakan, kartu langsung hilang dan tab langsung pindah.
          buangDariTersedia(order.id);
          setActiveTab(TAB_SAYA);
        } else {
          // Kalau urutan sebelumnya masih jalan, kartunya langsung dibuang.
          const sebelumnya = terimaRef.current;
          if (sebelumnya && sebelumnya.id !== order.id) {
            buangDariTersedia(sebelumnya.id);
          }
          // Tombol jadi centang dulu, kartu keluar kemudian.
          setTerimaBerhasil({ id: order.id, tahap: 'centang' });
        }

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
    [database, routeService, currentLocation, kurangiGerak, buangDariTersedia],
  );
  // Sinkronkan ref agar tes bisa memanggil langsung dari luar komponen.
  handleAcceptRef.current = handleAccept;

  const online = networkStatus === 'online';
  // Selama fetch pertama belum selesai, layar belum tahu apa isi daftar.
  const fetchBelumSelesai = !firstFetchDone;
  const tampilkanKosong = !(fetchBelumSelesai && networkStatus !== 'offline');

  const tabs: TabItem[] = [
    { key: TAB_TERSEDIA, label: 'Tersedia', count: poolOrders.length },
    { key: TAB_SAYA, label: 'Order Saya', count: orderAktif },
  ];

  // Ringkasan hari ini dihitung tiap render, jadi batas hari ikut bergeser
  // tanpa perlu timer.
  const ringkasan = deriveDaySummary(myOrders, payments, pendingActions, Date.now());

  const onTabChange = useCallback(
    (key: string) => {
      if (key === TAB_TERSEDIA || key === TAB_SAYA) {
        // Pengguna pindah tab sendiri di tengah urutan Terima, jadi urutannya
        // dipotong ke keadaan akhir.
        const urutan = terimaRef.current;
        if (urutan) {
          buangDariTersedia(urutan.id);
          setSorotId(urutan.id);
          setTerimaBerhasil(null);
        }
        setActiveTab(key);
      }
    },
    [buangDariTersedia],
  );

  // Ganti isi daftar: gulir ke atas dulu, lalu tampilkan isi tab tujuan.
  const gantiIsi = useCallback((tujuan: TabKey) => {
    daftarRef.current?.scrollToOffset({ offset: 0, animated: false });
    setTabTampil(tujuan);
  }, []);

  // Isi daftar pudar keluar dulu, baru isi tab baru pudar masuk. Kalau
  // pengguna kembali ke tab semula sebelum pudar keluar selesai, pudar
  // keluar dibatalkan dan isi lama kembali terang.
  useEffect(() => {
    if (activeTab === tabTampil) {
      opasitasDaftar.value = kurangiGerak
        ? 1
        : withTiming(1, {
            duration: motion.duration.fadeIn,
            easing: standardEasing,
          });
      return;
    }
    if (kurangiGerak) {
      gantiIsi(activeTab);
      return;
    }
    opasitasDaftar.value = withTiming(
      0,
      { duration: motion.duration.fadeOut, easing: exitEasing },
      (selesai) => {
        if (selesai) {
          runOnJS(gantiIsi)(activeTab);
        }
      },
    );
  }, [activeTab, tabTampil, kurangiGerak, gantiIsi, opasitasDaftar]);

  const gayaOpasitas = useAnimatedStyle(() => ({
    opacity: opasitasDaftar.value,
  }));

  // Kartu yang hilang dari Tersedia keluar ke kanan. Syarat tab aktif
  // mematikan gerak keluar begitu isi lama mulai memudar, jadi kartu tidak
  // meluncur saat tab diganti.
  const keluarTersedia =
    !dalamJendela && tabTampil === TAB_TERSEDIA && activeTab === TAB_TERSEDIA
      ? KELUAR_KANAN
      : undefined;

  // Nilai di luar data yang dipakai renderItem. FlatList cuma pasti
  // menggambar ulang sel kalau data atau extraData berubah.
  const extraData = useMemo(
    () => ({
      acceptingOrderId,
      online,
      keluarTersedia,
      actionsByOrderId,
      terimaBerhasil,
      sorotId,
    }),
    [acceptingOrderId, online, keluarTersedia, actionsByOrderId, terimaBerhasil, sorotId],
  );

  // Kartu di Tersedia tidak dibuka ke detail: baris pool hanya berisi
  // kota, jadi detailnya tampil seperti order rusak. Tombol Terima di
  // dalam kartu tetap dipakai.
  const renderPoolItem = ({ item, index }: { item: OrderModel; index: number }) => {
    const alamat = readAlamat(item);
    return (
      <ListEnterRow
        tracker={pelacakTersedia}
        id={item.id}
        index={index}
        exiting={keluarTersedia}
      >
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
          acceptSuccess={terimaBerhasil?.id === item.id}
        />
      </ListEnterRow>
    );
  };

  const renderMineItem = ({ item, index }: { item: OrderModel; index: number }) => {
    // Kartu Order Saya memakai status yang sedang berlaku: kalau ada aksi
    // status yang antre, status targetnya yang tampil.
    const actions = actionsByOrderId.get(item.id) ?? [];
    const { displayStatus, syncState } = deriveOrderSyncView(readOrderStatus(item), actions);
    const alamat = readAlamat(item);
    return (
      <ListEnterRow tracker={pelacakSaya} id={item.id} index={index}>
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
          highlight={item.id === sorotId}
        />
      </ListEnterRow>
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
      <View style={gayaLayar.kepalaDaftar}>
        <Icon
          name={online ? 'refresh' : 'schedule'}
          size={size.iconXs}
          color={warnaTema.textSubtle}
        />
        <Text style={gayaLayar.teksKepalaDaftar}>
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

  const tampilTersedia = tabTampil === TAB_TERSEDIA;

  return (
    <View style={gayaLayar.layar}>
      <StatusBar barStyle="light-content" backgroundColor={warnaTema.header} />
      {/* Bilah di luar isi layar, supaya layout di isiLayar menggeser
          isi layar saat bilah muncul atau hilang. */}
      <View style={gayaLayar.wadahBilah}>
        <ThemeProvider name="gelap">
          <ConnectionBar
            status={networkStatus}
            pendingCount={pendingActionCount}
            failedCount={failedActionCount}
          />
        </ThemeProvider>
      </View>
      <Animated.View
        style={gayaLayar.isiLayar}
        layout={dalamJendela ? undefined : GESER}
      >
        <MainHeader title="Order" subtitle="Driver" onLogout={onLogout} />
        <View style={gayaLayar.wadahRingkasan}>
          <DaySummary
            doneCount={ringkasan.doneCount}
            cashAmount={ringkasan.cashAmount}
            currency={MATA_UANG_TUNAI}
          />
        </View>
        <View style={gayaLayar.wadahTab}>
          <Tabs tabs={tabs} activeKey={activeTab} onChange={onTabChange} />
        </View>
        {/* Isi daftar dibungkus lapisan sendiri, jadi isinya bisa pudar
            saat ganti tab tanpa ikut menggeser isi layar. */}
        <Animated.View style={[gayaLayar.wadahDaftar, gayaOpasitas]}>
          <Animated.FlatList
            ref={daftarRef}
            data={tampilTersedia ? poolUrut : myOrdersUrut}
            extraData={extraData}
            initialNumToRender={JUMLAH_AWAL}
            itemLayoutAnimation={dalamJendela ? undefined : GESER_BARIS}
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
            contentContainerStyle={gayaLayar.daftar}
          />
        </Animated.View>
      </Animated.View>
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
            )
            .observeWithColumns(['status', 'updated_at'])
        : of<OrderModel[]>([]),
      // Baris order dengan driver_id null dan last_conflict_reason 'released'
      // atau 'reassigned', untuk kotak pemberitahuan order yang lepas.
      releasedOrders: currentUserId
        ? releasedOrdersQuery(database)
        : of<OrderModel[]>([]),
      // Payment tunai milik driver ini, buat ringkasan hari ini.
      payments: currentUserId
        ? database
            .get<PaymentModel>('payments')
            .query(Q.where('method', 'CASH'), Q.where('deleted_at', null))
            .observeWithColumns(['status'])
        : of<PaymentModel[]>([]),
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
  const { name: namaTema } = useTheme();
  const gayaLayar = gaya[namaTema];

  useEffect(() => {
    getCurrentUserId().then(setCurrentUserId);
  }, []);

  if (currentUserId === null) {
    return <View style={gayaLayar.menunggu} />;
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

const gaya = perTema((c) =>
  StyleSheet.create({
    layar: {
      flex: 1,
      backgroundColor: c.bg,
    },
    isiLayar: {
      flex: 1,
    },
    wadahBilah: {
      backgroundColor: c.header,
    },
    wadahRingkasan: {
      marginTop: 4,
      marginHorizontal: space[4],
    },
    wadahTab: {
      marginTop: space[3],
      marginHorizontal: space[4],
    },
    wadahDaftar: {
      flex: 1,
    },
    daftar: {
      paddingTop: space[2],
      paddingHorizontal: space[4],
      gap: space[3],
      paddingBottom: space[10],
    },
    kepalaDaftar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: 28,
      gap: JARAK_IKON,
    },
    teksKepalaDaftar: {
      ...type.bodyXs,
      color: c.textSubtle,
    },
    menunggu: {
      flex: 1,
      backgroundColor: c.bg,
    },
  }),
);

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
