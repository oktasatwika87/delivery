import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Text,
  unstable_batchedUpdates,
  View,
  type LayoutChangeEvent,
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
  withDelay,
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
import { revealOffset } from './orderListScroll';
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
import type { SyncState } from '../components/SyncBadge';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../theme/Icon';
import { exitEasing, exitRight, shift, standardEasing } from '../components/motion/presets';
import { ListEnterRow, useListEnter } from '../components/motion/listEnter';
import type { ListEnterTracker } from '../components/motion/listEnter';
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

// Bentuk keluar kartu, diambil dari tipe baris daftar.
type BentukKeluar = React.ComponentProps<typeof ListEnterRow>['exiting'];

interface BarisTersediaProps {
  order: OrderModel;
  index: number;
  tracker: ListEnterTracker;
  exiting?: BentukKeluar;
  orderNumber: string;
  timeText: string;
  city: string | null;
  amountText: string;
  online: boolean;
  loading: boolean;
  success: boolean;
  onAccept: (order: OrderModel) => void;
}

/**
 * Baris kartu di tab Tersedia.
 *
 * Semua nilai tampilan dihitung di layar lalu masuk sebagai props biasa.
 * Baris ini dibungkus memo, jadi kartu yang tidak berubah tidak digambar
 * ulang. Model order sendiri tidak dibaca di dalam baris, karena model
 * diubah di tempat dan memo tidak melihat perubahan kolom.
 */
const BarisTersedia = React.memo(function BarisTersedia({
  order,
  index,
  tracker,
  exiting,
  orderNumber,
  timeText,
  city,
  amountText,
  online,
  loading,
  success,
  onAccept,
}: BarisTersediaProps): React.JSX.Element {
  const terima = useCallback(() => onAccept(order), [onAccept, order]);

  return (
    <ListEnterRow tracker={tracker} id={order.id} index={index} exiting={exiting}>
      <OrderCard
        variant="pool"
        orderNumber={orderNumber}
        timeText={timeText}
        city={city}
        amountText={amountText}
        onAccept={terima}
        acceptDisabled={!online}
        acceptHelp={online ? undefined : TEKS_BUTUH_KONEKSI}
        acceptLoading={loading}
        acceptSuccess={success}
      />
    </ListEnterRow>
  );
});

interface BarisSayaProps {
  id: string;
  index: number;
  tracker: ListEnterTracker;
  orderNumber: string;
  status: OrderStatus;
  statusText: string;
  addressMain: string;
  addressSub?: string;
  syncState?: SyncState;
  amountText: string;
  timeText: string;
  highlight: boolean;
  onOpen: (id: string) => void;
  /** Dipanggil saat kartu selesai diukur, buat menggulir daftar. */
  onCardLayout: (id: string, kartu: View | null) => void;
}

/**
 * Baris kartu di tab Order Saya.
 *
 * Sama seperti baris Tersedia: nilai tampilan datang dari layar, jadi kartu
 * yang tidak berubah tidak digambar ulang.
 */
const BarisSaya = React.memo(function BarisSaya({
  id,
  index,
  tracker,
  orderNumber,
  status,
  statusText,
  addressMain,
  addressSub,
  syncState,
  amountText,
  timeText,
  highlight,
  onOpen,
  onCardLayout,
}: BarisSayaProps): React.JSX.Element {
  const buka = useCallback(() => onOpen(id), [onOpen, id]);
  const kartuRef = useRef<View>(null);
  const saatTertata = useCallback(
    () => onCardLayout(id, kartuRef.current),
    [onCardLayout, id],
  );

  return (
    <ListEnterRow tracker={tracker} id={id} index={index}>
      <View ref={kartuRef} collapsable={false} onLayout={saatTertata}>
        <OrderCard
          variant="mine"
          orderNumber={orderNumber}
          status={status}
          statusText={statusText}
          addressMain={addressMain}
          addressSub={addressSub}
          syncState={syncState}
          amountText={amountText}
          timeText={timeText}
          onPress={buka}
          highlight={highlight}
        />
      </View>
    </ListEnterRow>
  );
});

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
  // Fetch pertama sudah selesai, berhasil atau gagal.
  const [firstFetchDone, setFirstFetchDone] = useState(false);
  // Order yang sedang diterima, buat menandai satu kartu saja.
  const [acceptingOrderId, setAcceptingOrderId] = useState<string | null>(null);
  // Tab awal ditentukan sekali, waktu layar dipasang.
  const [activeTab, setActiveTab] = useState(() => tabAwal(myOrders));
  // Tab yang terakhir tampil, dipakai efek ganti tab.
  const tabSebelumnya = useRef<TabKey>(activeTab);
  // Kurangi gerakan: isi langsung berubah tanpa pudar.
  const kurangiGerak = useReducedMotion();
  // Opasitas tiap lapisan daftar, dipakai pudar saat ganti tab.
  const opasitasTersedia = useSharedValue(activeTab === TAB_TERSEDIA ? 1 : 0);
  const opasitasSaya = useSharedValue(activeTab === TAB_SAYA ? 1 : 0);
  const daftarTersediaRef = useRef<FlatList<OrderModel>>(null);
  const daftarSayaRef = useRef<FlatList<OrderModel>>(null);
  // Urutan Terima yang sedang jalan: tombol jadi centang, kartu keluar,
  // baru tab pindah.
  const [terimaBerhasil, setTerimaBerhasil] = useState<UrutanTerima | null>(null);
  // Ref selalu berisi nilai terbaru, jadi handleAccept dan onTabChange
  // membaca urutan yang sedang jalan tanpa closure basi.
  const terimaRef = useRef<UrutanTerima | null>(null);
  terimaRef.current = terimaBerhasil;
  // Order yang baru diterima, disorot sekali.
  const [sorotId, setSorotId] = useState<string | null>(null);
  // Order yang baru diterima dan belum digulir ke layar. Urutan Order Saya
  // tetap created_at, jadi order pool yang lebih lama bisa jatuh di bawah
  // layar. Daftar digulir selagi masih tersembunyi, jadi pemakai tidak
  // perlu menggulir sendiri.
  const tampilkanRef = useRef<string | null>(null);
  // Wadah kedua daftar, dipakai buat mengukur posisi kartu.
  const wadahDaftarRef = useRef<View>(null);
  // Tinggi bagian daftar yang terlihat, buat menghitung posisi gulir.
  const tinggiDaftarRef = useRef(0);

  // Posisi GPS terakhir. Dipakai buat asal rute saat Terima, jadi disimpan
  // di ref: posisinya sering berubah dan layar tidak perlu digambar ulang
  // cuma karena GPS maju satu langkah.
  const lokasiRef = useRef<{ lat: number; lng: number } | null>(null);

  // Refs for socket unsubscribe
  const unsubscribeRef = useRef<Array<() => void>>([]);

  // Langganan lokasi, polanya sama dengan layar Peta.
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    // Lokasi cache, buat awal saat layar baru dibuka.
    locationService.getLastKnown().then((loc) => {
      if (cancelled || !loc) return;
      // Kalau langganan sudah memberi posisi, cache tidak boleh menimpanya.
      if (lokasiRef.current !== null) return;
      lokasiRef.current = { lat: loc.coords.latitude, lng: loc.coords.longitude };
    });

    locationService
      .subscribe((loc) => {
        lokasiRef.current = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      })
      .then((unsub) => {
        // Kalau layar sudah dilepas saat subscribe selesai, langsung berhenti.
        if (cancelled) {
          unsub();
        } else {
          unsubscribe = unsub;
        }
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
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
  const runFetchPool = useCallback(async (): Promise<OrderModel[] | null> => {
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
      return null;
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
    return pool;
  }, [database]);

  // Penanda fetch pertama tetap terisi walau fetch gagal, supaya layar tahu
  // daftar sudah ditanyakan ke server.
  const fetchPool = useCallback(async (): Promise<void> => {
    let pool: OrderModel[] | null = null;
    try {
      pool = await runFetchPool();
    } finally {
      // Daftar baru dan penanda fetch ikut digambar sekali.
      unstable_batchedUpdates(() => {
        if (pool) {
          setPoolOrders(pool);
        }
        setFirstFetchDone(true);
      });
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
      });
    return () => {
      subscription.unsubscribe();
    };
  }, [database]);

  // Jumlah aksi yang masih antre, dipakai ConnectionBar.
  const pendingActionCount = useMemo(
    () =>
      pendingActions.filter((action) => {
        const status = action._getRaw('status');
        return status === 'pending' || status === 'syncing';
      }).length,
    [pendingActions],
  );

  // Jumlah aksi yang ditolak server atau COD yatim, dipakai ConnectionBar.
  const failedActionCount = useMemo(
    () =>
      pendingActions.filter((action) => {
        const status = action._getRaw('status');
        return status === 'failed' || status === 'orphaned_needs_review';
      }).length,
    [pendingActions],
  );

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
    active: activeTab === TAB_TERSEDIA,
  });
  const pelacakSaya = useListEnter(idSaya, {
    initialCount: JUMLAH_AWAL,
    active: activeTab === TAB_SAYA,
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
        unstable_batchedUpdates(() => {
          buangDariTersedia(terimaBerhasil.id);
          setTerimaBerhasil({ id: terimaBerhasil.id, tahap: 'keluar' });
        });
      }, motion.duration.drawLine);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      unstable_batchedUpdates(() => {
        setTerimaBerhasil(null);
        setSorotId(terimaBerhasil.id);
        setActiveTab(TAB_SAYA);
      });
    }, motion.duration.exit);
    return () => clearTimeout(timer);
  }, [terimaBerhasil, kartuTerimaAda, buangDariTersedia]);

  // Sorotan cuma sekali. Kartu tidak lagi dipasang ulang saat ganti tab,
  // jadi sorotannya dibersihkan setelah waktu sorot lewat.
  useEffect(() => {
    if (!sorotId) return;
    const timer = setTimeout(() => {
      setSorotId(null);
    }, motion.duration.fadeOut + motion.duration.highlight);
    return () => clearTimeout(timer);
  }, [sorotId]);

  // Tanda gulir hanya berlaku sampai Order Saya baru tampil. Sesudah itu
  // kartu yang baru ditata tidak boleh menggulir daftar, karena pemakai
  // sudah melihat daftarnya dan mungkin sedang menggulir sendiri. Berlaku
  // untuk cabang dengan dan tanpa kurangi gerakan.
  useEffect(() => {
    if (activeTab !== TAB_SAYA) {
      tampilkanRef.current = null;
      return;
    }
    const timer = setTimeout(() => {
      tampilkanRef.current = null;
    }, motion.duration.fadeOut + motion.duration.highlight);
    return () => clearTimeout(timer);
  }, [activeTab]);

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
      // Penanda sukses, jadi penanda menerima tidak diulang di finally.
      let berhasil = false;
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
          // Tandai order ini buat digulir ke layar begitu masuk Order Saya,
          // berlaku buat cabang dengan dan tanpa kurangi gerakan.
          tampilkanRef.current = order.id;
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
          // Tulis lokal gagal, jadi tidak ada yang perlu digulir.
          tampilkanRef.current = null;
          return;
        }

        // Terima berhasil, jadi beri tahu lewat getaran.
        hapticAccept();

        // Semua perubahan keadaan digabung, layar cuma digambar sekali.
        unstable_batchedUpdates(() => {
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
          setAcceptingOrderId(null);
          berhasil = true;
        });

        // Pre-compute route for offline-ready. Pakai koordinat dari respons
        // (bukan dari model baris), karena baris pool awalnya tidak punya
        // address_json. Asal dari GPS terakhir, syarat status 'online' dan
        // GPS tersedia. Tidak di-await (Terima tidak menunggu rute); gagal
        // hanya dicatat di log.
        const lokasi = lokasiRef.current;
        if (networkMonitor.getStatus() === 'online' && lokasi) {
          const addressJson = response.deliveryAddress;
          const coordinates = addressJson.coordinates;
          if (coordinates && coordinates.length === 2) {
            const [lng, lat] = coordinates;
            const destination = { lng, lat };
            const origin = { lng: lokasi.lng, lat: lokasi.lat };
            routeService.getRoute({ origin, destination }).catch((err) => {
              console.warn('[OrdersScreen] pre-compute route failed:', err);
            });
          }
        }
      } finally {
        // Jalur sukses sudah mengosongkan penanda menerima bersama perubahan lain di atas.
        if (!berhasil) {
          setAcceptingOrderId(null);
        }
      }
    },
    [database, routeService, kurangiGerak, buangDariTersedia],
  );
  // Sinkronkan ref agar tes bisa memanggil langsung dari luar komponen.
  handleAcceptRef.current = handleAccept;

  // Terima order dari kartu. Identitasnya tetap antar render, jadi kartu
  // yang tidak berubah tidak digambar ulang.
  const terimaOrder = useCallback(
    (order: OrderModel) => {
      void handleAccept(order);
    },
    [handleAccept],
  );

  // Buka detail order dari kartu.
  const bukaDetail = useCallback(
    (orderId: string) => {
      navigation.navigate('OrderDetail', { orderId });
    },
    [navigation],
  );

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

  // Gulir daftar ke atas, jadi daftar selalu tampil dari atas.
  const gulirKeAtas = useCallback((tab: TabKey) => {
    const ref = tab === TAB_TERSEDIA ? daftarTersediaRef : daftarSayaRef;
    ref.current?.scrollToOffset({ offset: 0, animated: false });
  }, []);

  // Tinggi daftar yang terlihat disimpan buat menghitung posisi gulir.
  const saatWadahTerukur = useCallback((event: LayoutChangeEvent) => {
    tinggiDaftarRef.current = event.nativeEvent.layout.height;
  }, []);

  // Pengukuran menunggu onLayout kartu, karena baru saat itu tata letaknya
  // pasti sudah dihitung.
  const kartuSayaTertata = useCallback((id: string, kartu: View | null) => {
    if (id !== tampilkanRef.current) return;
    if (!kartu || !wadahDaftarRef.current) return;
    tampilkanRef.current = null;
    const wadah = wadahDaftarRef.current;
    kartu.measureLayout(wadah, (_x, atas, _lebar, tinggi) => {
      daftarSayaRef.current?.scrollToOffset({
        offset: revealOffset({
          cardTop: atas,
          cardHeight: tinggi,
          viewportHeight: tinggiDaftarRef.current,
          gapAbove: space[2],
          gapBelow: space[3],
        }),
        animated: false,
      });
    });
  }, []);

  // Ganti tab: daftar lama pudar keluar, lalu daftar tujuan pudar masuk.
  // Dua daftar tetap dipasang, jadi kartu tidak pernah dipasang ulang.
  useEffect(() => {
    if (activeTab === tabSebelumnya.current) {
      return;
    }
    tabSebelumnya.current = activeTab;
    const tabKeluar = activeTab === TAB_TERSEDIA ? TAB_SAYA : TAB_TERSEDIA;
    const opasitasKeluar = activeTab === TAB_TERSEDIA ? opasitasSaya : opasitasTersedia;
    const opasitasMasuk = activeTab === TAB_TERSEDIA ? opasitasTersedia : opasitasSaya;

    if (kurangiGerak) {
      opasitasKeluar.value = 0;
      opasitasMasuk.value = 1;
      gulirKeAtas(tabKeluar);
      return;
    }

    opasitasKeluar.value = withTiming(
      0,
      { duration: motion.duration.fadeOut, easing: exitEasing },
      (selesai) => {
        if (selesai) {
          runOnJS(gulirKeAtas)(tabKeluar);
        }
      },
    );
    opasitasMasuk.value = withDelay(
      motion.duration.fadeOut,
      withTiming(1, { duration: motion.duration.fadeIn, easing: standardEasing }),
    );
  }, [activeTab, kurangiGerak, gulirKeAtas, opasitasTersedia, opasitasSaya]);

  const gayaOpasitasTersedia = useAnimatedStyle(() => ({
    opacity: opasitasTersedia.value,
  }));

  const gayaOpasitasSaya = useAnimatedStyle(() => ({
    opacity: opasitasSaya.value,
  }));

  // Kartu yang hilang dari Tersedia keluar ke kanan.
  const keluarTersedia = !dalamJendela ? KELUAR_KANAN : undefined;

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
      <BarisTersedia
        order={item}
        index={index}
        tracker={pelacakTersedia}
        exiting={keluarTersedia}
        orderNumber={formatOrderNumber(item.id)}
        timeText={formatOrderTime(readWaktu(item, 'created_at'), Date.now())}
        city={alamat.city}
        amountText={formatCurrency(readTotalCents(item), readCurrency(item))}
        online={online}
        loading={acceptingOrderId === item.id}
        success={terimaBerhasil?.id === item.id}
        onAccept={terimaOrder}
      />
    );
  };

  const renderMineItem = ({ item, index }: { item: OrderModel; index: number }) => {
    // Kartu Order Saya memakai status yang sedang berlaku: kalau ada aksi
    // status yang antre, status targetnya yang tampil.
    const actions = actionsByOrderId.get(item.id) ?? [];
    const { displayStatus, syncState } = deriveOrderSyncView(readOrderStatus(item), actions);
    const alamat = readAlamat(item);
    return (
      <BarisSaya
        id={item.id}
        index={index}
        tracker={pelacakSaya}
        orderNumber={formatOrderNumber(item.id)}
        status={displayStatus}
        statusText={driverStatusLabel(displayStatus)}
        addressMain={alamat.street ?? 'Alamat tidak tersedia'}
        addressSub={alamat.city ?? undefined}
        syncState={syncState ?? undefined}
        amountText={formatCurrency(readTotalCents(item), readCurrency(item))}
        timeText={formatOrderTime(readWaktu(item, 'created_at'), Date.now())}
        highlight={item.id === sorotId}
        onOpen={bukaDetail}
        onCardLayout={kartuSayaTertata}
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

  const tersediaAktif = activeTab === TAB_TERSEDIA;
  const sayaAktif = activeTab === TAB_SAYA;

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
        {/* Dua daftar dipasang terus, satu per tab, ditumpuk di tempat yang
            sama. Ganti tab cuma memudarkan isinya, jadi kartu tidak pernah
            dipasang ulang. Lapisan yang tidak aktif tidak bisa disentuh dan
            disembunyikan dari pembaca layar. */}
        <View
          style={gayaLayar.wadahDaftar}
          ref={wadahDaftarRef}
          collapsable={false}
          onLayout={saatWadahTerukur}
        >
          <Animated.View
            testID="isi-tersedia"
            pointerEvents={tersediaAktif ? 'auto' : 'none'}
            importantForAccessibility={tersediaAktif ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={!tersediaAktif}
            style={[StyleSheet.absoluteFill, gayaOpasitasTersedia]}
          >
            <Animated.FlatList
              testID="daftar-tersedia"
              ref={daftarTersediaRef}
              data={poolUrut}
              extraData={extraData}
              initialNumToRender={JUMLAH_AWAL}
              itemLayoutAnimation={dalamJendela ? undefined : GESER_BARIS}
              keyExtractor={(row) => row.id}
              renderItem={renderPoolItem}
              ListHeaderComponent={renderPoolHeader()}
              ListEmptyComponent={kosongTersedia}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing || (fetchBelumSelesai && networkStatus !== 'offline')}
                  onRefresh={onRefresh}
                />
              }
              contentContainerStyle={gayaLayar.daftar}
              scrollsToTop={tersediaAktif}
            />
          </Animated.View>
          <Animated.View
            testID="isi-saya"
            pointerEvents={sayaAktif ? 'auto' : 'none'}
            importantForAccessibility={sayaAktif ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={!sayaAktif}
            style={[StyleSheet.absoluteFill, gayaOpasitasSaya]}
          >
            <Animated.FlatList
              testID="daftar-saya"
              ref={daftarSayaRef}
              data={myOrdersUrut}
              extraData={extraData}
              initialNumToRender={JUMLAH_AWAL}
              itemLayoutAnimation={dalamJendela ? undefined : GESER_BARIS}
              keyExtractor={(row) => row.id}
              renderItem={renderMineItem}
              ListHeaderComponent={notice}
              ListEmptyComponent={kosongSaya}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing || (fetchBelumSelesai && networkStatus !== 'offline')}
                  onRefresh={onRefresh}
                />
              }
              contentContainerStyle={gayaLayar.daftar}
              scrollsToTop={sayaAktif}
            />
          </Animated.View>
        </View>
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
// lokasiRef, dan routeService saat dipanggil dari dalam OrdersScreenBase.
export const handleAcceptRef: { current: ((order: OrderModel) => Promise<void>) | null } = {
  current: null,
};
export const fetchPoolRef: { current: (() => Promise<void>) | null } = {
  current: null,
};
