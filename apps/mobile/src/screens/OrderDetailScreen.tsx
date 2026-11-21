import React, { useEffect, useState, useRef } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { Q } from '@nozbe/watermelondb';
import { withDatabase } from '@nozbe/watermelondb/react';
import type { Database } from '@nozbe/watermelondb';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import type { RootStackParamList } from '../../App';
import { OrderModel } from '../db/models/OrderModel';
import { PaymentModel } from '../db/models/PaymentModel';
import { PendingActionModel, readUpdateStatusTarget } from '../db/models/PendingActionModel';
import { formatCurrency } from '../formatCurrency';
import { hapticDelivered } from '../haptics';
import { driverStatusLabel } from '../driverStatusLabel';
import { formatOrderNumber } from '../formatOrderNumber';
import { formatOrderTime } from '../formatOrderTime';
import { deriveOrderSyncView } from '../sync/orderSyncView';
import { getCurrentUserId } from '../sync/session';
import { syncEvents } from '../sync/syncEvents';
import type { OrderConflictEvent } from '../sync/syncEvents';
import { useConnectionBar } from '../sync/useConnectionBar';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@delivery/shared';
import {
  enqueueCancel,
  enqueueCollectCod,
  enqueueUpdateStatus,
  drainPendingActions,
  retryFailedAction,
  discardFailedAction,
} from '../sync/outbox';
import { AppBar } from '../components/AppBar';
import { Banner } from '../components/Banner';
import type { BannerAction } from '../components/Banner';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { CashBox } from '../components/CashBox';
import type { CashBoxVariant } from '../components/CashBox';
import { OrderSteps } from '../components/OrderSteps';
import { ScreenFrame } from '../components/ScreenFrame';
import { Icon } from '../theme/Icon';
import type { IconName } from '../theme/icons';
import { useTheme } from '../theme/ThemeProvider';
import { motion, size, space, stroke, type } from '../theme/tokens';
import { useInitialWindow } from '../components/motion/InitialWindow';
import { useHoldDone } from '../components/motion/useHoldDone';
import { fadeIn, fadeOut, shift } from '../components/motion/presets';
import { langkahOrder } from './langkahOrder';
import { isOrderStatus } from './orderRowRead';

// Types

interface ItemRow {
  name: string;
  quantity: number;
  unitPriceCents: number;
}

interface AddressData {
  street?: string;
  city?: string;
  postalCode?: string;
  notes?: string;
}

interface Props {
  database: Database;
}

/** Geser kartu saat tata letaknya berubah, misalnya banner masuk atau keluar. */
const GESER = shift();

/** Macam aksi utama: mulai antar, terima tunai, atau selesai diantar. */
type AksiUtama = 'mulai' | 'tunai' | 'selesai';

/** Tahap tahan tombol Selesai diantar: sedang mengirim, lalu sudah berhasil. */
type TahapSelesai = 'kirim' | 'berhasil';

/** Judul dan ikon tombol utama, satu per macam aksi. */
const AKSI_UTAMA: Record<AksiUtama, { judul: string; ikon: IconName }> = {
  mulai: { judul: 'Mulai antar', ikon: 'two_wheeler' },
  tunai: { judul: 'Terima Tunai (COD)', ikon: 'payments' },
  selesai: { judul: 'Selesai diantar', ikon: 'check_circle' },
};

/** Keluar pelan saat tombol Batalkan hilang. */
const KELUAR_BATAL = fadeOut();

/**
 * Kotak tunai baru terlihat sesudah tombol utama hampir sampai di tempat
 * barunya, jadi kotak tidak tampak menimpa tombol.
 */
const MASUK_TUNAI = fadeIn(motion.duration.fadeOut);

/** Batalkan yang muncul lagi. */
const MASUK_BATAL = fadeIn();

/** Tanda kali di baris barang, ditulis lewat kode karakter supaya sumber tetap ASCII. */
const TANDA_KALI = String.fromCharCode(0xd7);

// Teks banner

/** Teks banner konflik dari kejadian sinkron. */
function teksKonflikKejadian(event: OrderConflictEvent): string {
  if (event.reason === 'reassigned') {
    return 'Order ini sudah dipindahkan ke driver lain.';
  }
  if (event.reason === 'rejected-oc') {
    return event.ackReason || 'Order tidak bisa diperbarui karena status di server sudah berubah.';
  }
  // Konflik status: kode status mentah tidak pernah tampil, yang dipakai
  // label driver dengan huruf pertama dikecilkan karena di tengah kalimat.
  if (isOrderStatus(event.serverStatus)) {
    const label = driverStatusLabel(event.serverStatus);
    return `Status order diperbarui server, sekarang ${label.charAt(0).toLowerCase()}${label.slice(1)}.`;
  }
  return 'Status order diperbarui server.';
}

/** Teks banner konflik tersimpan, satu per alasan. */
function teksKonflikTersimpan(reason: string): string {
  switch (reason) {
    case 'released':
      return 'Order ini sudah tidak ditugaskan ke Anda, biasanya karena HP Anda lama tidak tersambung. Kalau order ini ada lagi di daftar Tersedia, Anda bisa menerimanya lagi.';
    case 'reassigned':
      return 'Order ini sudah dipindahkan ke driver lain, jadi aksi Anda tidak diproses.';
    case 'cancelled-by-server':
      return 'Pembatalan tidak diproses karena order sudah berubah di server. Data order sudah diperbarui.';
    case 'cancel-cod-captured':
      return 'Order ini tidak bisa dibatalkan karena COD-nya sudah tercatat. Selesaikan pengantarannya.';
    case 'cod-already-captured':
      return 'COD order ini sudah tercatat sebelumnya, jadi catatan dari HP ini tidak disimpan. Kalau Anda menerima uang dua kali, hubungi support.';
    case 'sync-rejected':
      return 'Perubahan data order ini di HP ditolak server. Kalau data order terlihat salah, hubungi support.';
    default:
      return 'Order ini sudah berubah di server.';
  }
}

// Banner konflik tersimpan: teks per last_conflict_reason, tampil 24 jam sejak
// last_conflict_at.

const CONFLICT_BANNER_TTL_MS = 24 * 60 * 60 * 1000;

// Teks banner aksi gagal, satu per jenis aksi.

function teksAksiGagal(action: PendingActionModel): string | null {
  if (action.actionType === 'cancel') {
    return 'Pembatalan ditolak server dan tidak dicoba lagi otomatis.';
  }
  if (action.actionType === 'reject') {
    return 'Penolakan order ditolak server dan tidak dicoba lagi otomatis.';
  }
  if (action.actionType === 'update_status') {
    // Teks per target yang dituju aksi. Target yang tidak terbaca
    // (payload korup) memakai pesan bawaan.
    const target = readUpdateStatusTarget(action.payloadJson);
    return target === 'OUT_FOR_DELIVERY'
      ? 'Mulai antar ditolak server dan tidak dicoba lagi otomatis.'
      : target === 'DELIVERED'
        ? 'Selesai diantar ditolak server dan tidak dicoba lagi otomatis.'
        : 'Perubahan status ditolak server dan tidak dicoba lagi otomatis.';
  }
  if (action.actionType === 'collect_cod') {
    return 'COD gagal dicatat server dan tidak dicoba lagi otomatis. Simpan uangnya, lalu coba lagi atau hubungi support.';
  }
  return null;
}

/** Satu tombol banner aksi gagal. */
function satuAksi(aksi: BannerAction): readonly [BannerAction] {
  return [aksi];
}

/** Dua tombol banner aksi gagal. */
function duaAksi(pertama: BannerAction, kedua: BannerAction): readonly [BannerAction, BannerAction] {
  return [pertama, kedua];
}

/**
 * Tombol banner aksi gagal. Cancel, reject, dan update_status punya tombol
 * Coba lagi dan Abaikan; COD hanya Coba lagi karena tidak bisa dibuang.
 * Jenis lain tidak tampil.
 */
function tombolAksiGagal(
  action: PendingActionModel,
): readonly [BannerAction] | readonly [BannerAction, BannerAction] | null {
  const cobaLagi: BannerAction = {
    label: 'Coba lagi',
    onPress: () => {
      void retryFailedAction(action.id);
    },
  };
  if (action.actionType === 'collect_cod') {
    return satuAksi(cobaLagi);
  }
  if (
    action.actionType === 'cancel' ||
    action.actionType === 'reject' ||
    action.actionType === 'update_status'
  ) {
    return duaAksi(cobaLagi, {
      label: 'Abaikan',
      onPress: () => {
        void discardFailedAction(action.id);
      },
    });
  }
  return null;
}

// Base Component

function OrderDetailBase({ database }: Props): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'OrderDetail'>>();
  const route = useRoute<NativeStackScreenProps<RootStackParamList, 'OrderDetail'>['route']>();
  const { colors } = useTheme();
  const dalamJendela = useInitialWindow();

  const { orderId } = route.params;
  const bilah = useConnectionBar(database);
  const [order, setOrder] = useState<OrderModel | null>(null);
  // findAndObserve mengirim ulang objek model yang sama setiap baris berubah, dan React
  // melewati setState dengan referensi yang sama. Angka ini dinaikkan tiap data datang
  // supaya layar tetap digambar ulang.
  const [, setOrderRev] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // payments dan pending_actions diamati dengan observeWithColumns(['status']):
  // observe() tidak memancarkan saat kolom berubah, jadi perubahan status tidak
  // akan menggambar ulang tombol dan banner.
  const [payments, setPayments] = useState<PaymentModel[]>([]);
  const [pendingActions, setPendingActions] = useState<PendingActionModel[]>([]);
  const [failedBannerDismissed, setFailedBannerDismissed] = useState(false);
  const [conflictEvent, setConflictEvent] = useState<OrderConflictEvent | null>(null);
  const [lastConflictDismissed, setLastConflictDismissed] = useState(false);
  // Tahap tahan tombol Selesai diantar. Selama tombol ditahan, bilah bawah
  // tidak berubah dan layar belum pindah ke layar sukses.
  const [tahapSelesai, setTahapSelesai] = useState<TahapSelesai | null>(null);
  const inflightCollectRef = useRef(false);
  const inflightStatusRef = useRef(false);
  const kurangiGerak = useReducedMotion();

  useEffect(() => {
    getCurrentUserId().then(setCurrentUserId);
  }, []);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    const subscribe = async () => {
      try {
        const collection = database.get<OrderModel>('orders');
        subscription = collection.findAndObserve(orderId).subscribe({
          next: (record) => {
            setOrder(record);
            setOrderRev((rev) => rev + 1);
            setIsLoading(false);
            setError(null);
          },
          error: (err) => {
            console.error('[OrderDetail] observe error:', err);
            setError('Gagal memuat order');
            setIsLoading(false);
          },
        });
      } catch (err) {
        console.error('[OrderDetail] setup error:', err);
        setError('Order tidak ditemukan');
        setIsLoading(false);
      }
    };

    subscribe();

    return () => {
      subscription?.unsubscribe();
    };
  }, [database, orderId]);

  // Payment order ini, termasuk perubahan statusnya.
  useEffect(() => {
    if (!orderId) return;

    let subscription: { unsubscribe: () => void } | null = null;

    const subscribe = async () => {
      try {
        const paymentsCollection = database.get<PaymentModel>('payments');
        subscription = paymentsCollection
          .query(Q.where('order_id', orderId))
          .observeWithColumns(['status'])
          .subscribe({
            next: (records) => {
              setPayments(records);
            },
            error: (err) => {
              console.warn('[OrderDetail] payments observe error:', err);
            },
          });
      } catch (err) {
        console.warn('[OrderDetail] failed to observe payments:', err);
      }
    };

    subscribe();

    return () => {
      subscription?.unsubscribe();
    };
  }, [database, orderId]);

  // Subscribe to sync conflict/rejected events
  useEffect(() => {
    const conflictHandler = (event: OrderConflictEvent) => {
      if (event.orderId !== orderId) return;
      setConflictEvent(event);
    };
    const rejectedHandler = (event: { orderId: string; reason: string }) => {
      if (event.orderId !== orderId) return;
      setConflictEvent({
        orderId: event.orderId,
        reason: 'rejected-oc',
        serverStatus: order?.status ?? 'unknown',
        serverChangedAt: new Date().toISOString(),
        ackReason: event.reason,
      });
    };
    syncEvents.on('orderConflict', conflictHandler);
    syncEvents.on('orderRejected', rejectedHandler);
    return () => {
      syncEvents.off('orderConflict', conflictHandler);
      syncEvents.off('orderRejected', rejectedHandler);
    };
  }, [orderId, order?.status]);

  // Aksi outbox order ini, termasuk perubahan statusnya.
  useEffect(() => {
    if (!orderId) return;
    let subscription: { unsubscribe: () => void } | null = null;

    const subscribe = async () => {
      try {
        subscription = database
          .get<PendingActionModel>('pending_actions')
          .query(Q.where('target_order_id', orderId))
          .observeWithColumns(['status'])
          .subscribe({
            next: (actions) => {
              setPendingActions(actions);
            },
            error: (err) => {
              console.warn('[OrderDetail] pending_actions observe error:', err);
            },
          });
      } catch (err) {
        console.warn('[OrderDetail] failed to observe pending_actions:', err);
      }
    };

    subscribe();
    return () => {
      subscription?.unsubscribe();
    };
  }, [database, orderId]);

  // Pindah ke layar sukses setelah tombol Selesai diantar ditahan sebentar
  // dalam bentuk berhasil.
  useEffect(() => {
    if (tahapSelesai !== 'berhasil') return;
    const timer = setTimeout(() => {
      navigation.replace('OrderDone', { orderId });
    }, motion.duration.drawLine);
    return () => clearTimeout(timer);
  }, [navigation, orderId, tahapSelesai]);

  // Nilai turunan untuk syarat tombol dan banner. codCaptured: COD order ini
  // sudah tercatat di server (payment CASH CAPTURED).
  const codCaptured = payments.some(
    (p) => p.method === PaymentMethod.CASH && p.status === PaymentStatus.CAPTURED,
  );
  // failedActions: aksi 'failed' jenis apa pun (cancel, reject, update_status, COD).
  const failedActions = pendingActions.filter((a) => a.status === 'failed');
  // hasFailedOrOrphanedAction: ada aksi 'failed' atau yatim untuk order ini.
  // Tombol aksi (Mulai antar, COD, Selesai diantar, Batalkan) tidak tampil
  // saat ada aksi gagal/yatim, supaya driver melihat banner dulu dan memilih
  // Coba lagi atau Abaikan sebelum menambah aksi baru.
  const orphanedCodActions = pendingActions.filter(
    (a) => a.actionType === 'collect_cod' && a.status === 'orphaned_needs_review',
  );
  const hasFailedOrOrphanedAction =
    failedActions.length > 0 || orphanedCodActions.length > 0;
  // Status yang tampil dan keadaan antrean diambil dari aturan yang sama
  // dengan kartu Order Saya.
  const tampilanSinkron = order
    ? deriveOrderSyncView(order.status, pendingActions)
    : null;
  const displayStatus = tampilanSinkron?.displayStatus;
  const antrean = tampilanSinkron?.antrean ?? null;
  // Tahan selesai banner menunggu: antrean yang sudah kosong tetap
  // menampilkan bentuk selesai sebentar sebelum banner hilang.
  const faseMenunggu = useHoldDone(antrean === 'pending');

  /**
   * Batalkan: order milik driver ini, status masih bisa dibatalkan, COD belum
   * tercatat, dan tidak ada aksi outbox apa pun.
   */
  const canDriverCancel = (order: OrderModel): boolean => {
    if (order.status !== OrderStatus.ASSIGNED &&
        order.status !== OrderStatus.PREPARING &&
        order.status !== OrderStatus.OUT_FOR_DELIVERY) {
      return false;
    }
    if (!currentUserId || order.driverId !== currentUserId) return false;
    if (codCaptured) return false;
    if (pendingActions.length > 0) return false;
    return true;
  };

  /**
   * Terima Tunai (COD): displayStatus OUT_FOR_DELIVERY, order milik driver,
   * COD belum tercatat, tidak ada aksi collect_cod, cancel, atau reject
   * yang antre, dan tidak ada aksi 'failed' atau yatim. Mulai antar yang
   * masih antre tidak menghalangi, karena displayStatus sudah
   * OUT_FOR_DELIVERY.
   */
  const canCollectCod = (order: OrderModel): boolean => {
    if (displayStatus !== OrderStatus.OUT_FOR_DELIVERY) return false;
    if (!currentUserId || order.driverId !== currentUserId) return false;
    if (codCaptured) return false;
    if (pendingActions.some((a) => a.actionType === 'collect_cod')) return false;
    if (pendingActions.some((a) => a.actionType === 'cancel' || a.actionType === 'reject')) return false;
    if (hasFailedOrOrphanedAction) return false;
    return true;
  };

  /**
   * Mulai antar: displayStatus PREPARING, order milik driver, dan tidak ada
   * aksi outbox apa pun untuk order ini.
   * Selesai diantar: displayStatus OUT_FOR_DELIVERY, COD tercatat (payment
   * CAPTURED) atau ada aksi collect_cod aktif ('pending'/'syncing'),
   * tidak ada aksi cancel/reject, tidak ada aksi 'failed' atau yatim.
   * Mulai antar yang masih antre tidak menghalangi: displayStatus
   * OUT_FOR_DELIVERY berarti Mulai antar sudah diantre atau terkirim.
   */
  const canUpdateStatus = (order: OrderModel): boolean => {
    if (!currentUserId || order.driverId !== currentUserId) return false;
    if (displayStatus === OrderStatus.PREPARING) {
      // Mulai antar: aksi apa pun untuk order ini menghalangi.
      if (pendingActions.length > 0) return false;
      return true;
    }
    if (displayStatus === OrderStatus.OUT_FOR_DELIVERY) {
      // Selesai diantar: aksi cancel/reject/failed/yatim tetap menghalangi,
      // tapi aksi collect_cod aktif tidak (driver bisa lanjut mengetuk
      // Selesai diantar saat COD-nya antre).
      if (pendingActions.some((a) => a.actionType === 'cancel' || a.actionType === 'reject')) return false;
      if (hasFailedOrOrphanedAction) return false;
      if (!codCaptured &&
          !pendingActions.some((a) =>
            a.actionType === 'collect_cod' && (a.status === 'pending' || a.status === 'syncing')
          )) {
        return false;
      }
      return true;
    }
    return false;
  };

  /**
   * Mulai antar dan Selesai diantar: aksi update_status diantre lewat
   * outbox, supaya tetap jalan saat offline.
   *
   * Selesai diantar punya urutan sendiri: tombol utama ditahan dalam bentuk
   * berhasil supaya bilah bawah tidak berubah, lalu layar pindah ke layar
   * sukses. Kirim antrean tidak ditunggu, supaya layar tidak tertahan.
   *
   * Target dihitung dari status yang sedang ditampilkan, jadi Selesai
   * diantar yang diketuk saat Mulai antar menghasilkan target DELIVERED.
   */
  const handleUpdateStatus = async (orderToUpdate: OrderModel) => {
    if (displayStatus !== OrderStatus.PREPARING && displayStatus !== OrderStatus.OUT_FOR_DELIVERY) {
      return;
    }
    const nextStatus = displayStatus === OrderStatus.PREPARING
      ? OrderStatus.OUT_FOR_DELIVERY
      : OrderStatus.DELIVERED;
    const alertTitle = displayStatus === OrderStatus.PREPARING
      ? 'Mulai Antar'
      : 'Selesai diantar';
    const alertBody = displayStatus === OrderStatus.PREPARING
      ? 'Tandai order ini sedang dalam perjalanan?'
      : 'Tandai order ini sudah selesai diantar?';
    const selesaiDiantar = nextStatus === OrderStatus.DELIVERED;

    Alert.alert(alertTitle, alertBody, [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Ya',
        onPress: async () => {
          if (inflightStatusRef.current) return;
          inflightStatusRef.current = true;
          // Tombol ditahan sebelum aksi tercatat, supaya layar tidak sempat
          // digambar tanpa tombol utama dan bilah bawah.
          if (selesaiDiantar) setTahapSelesai('kirim');
          try {
            const result = await enqueueUpdateStatus(orderToUpdate.id, nextStatus);
            if (!result.success) {
              if (selesaiDiantar) setTahapSelesai(null);
              Alert.alert('Gagal', 'Status gagal dicatat. Coba lagi.');
              return;
            }
            // Getarnya tanda aksi sudah diterima HP, jadi tetap bergetar
            // walau antrean belum sempat terkirim. Mulai antar tidak
            // bergetar.
            if (selesaiDiantar) {
              hapticDelivered();
            }
            // Kirim antrean tidak ditunggu, supaya layar tidak tertahan.
            void drainPendingActions(database).catch(() => {
              // Kalau kirim antrean gagal (offline), aksi tetap tersimpan
              // 'pending' dan dikirim di kesempatan berikutnya.
              console.log('[OrderDetail] drain attempt while offline, action queued');
            });
            if (selesaiDiantar) {
              if (kurangiGerak) {
                navigation.replace('OrderDone', { orderId: orderToUpdate.id });
              } else {
                setTahapSelesai('berhasil');
              }
            }
          } catch (err) {
            console.error('[OrderDetail] failed to enqueue update_status:', err);
            if (selesaiDiantar) setTahapSelesai(null);
            Alert.alert('Gagal', 'Status gagal dicatat. Coba lagi.');
          } finally {
            inflightStatusRef.current = false;
          }
        },
      },
    ]);
  };

  /**
   * Terima tunai lewat outbox.
   * Aksinya diantre dulu, lalu dikirim saat ada koneksi.
   */
  const handleCollectCod = async (orderToCollect: OrderModel) => {
    const amount = formatCurrency(orderToCollect.totalCents, orderToCollect.currency);
    Alert.alert(
      'Terima Tunai (COD)',
      `Terima tunai ${amount} dari customer?`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Ya, Terima',
          onPress: async () => {
            // Penjaga ketukan ganda: dua ketukan tidak boleh membuat dua
            // pembayaran. Ref dipakai karena nilainya langsung terbaca,
            // sedangkan nilai `useState` baru berubah di render berikutnya.
            if (inflightCollectRef.current) return;
            inflightCollectRef.current = true;
            try {
              const result = await enqueueCollectCod(orderToCollect.id, orderToCollect.totalCents);
              if (!result.success) {
                console.warn('[OrderDetail] enqueue COD gagal:', result.error);
                Alert.alert('Gagal', 'Tidak bisa mencatat pembayaran tunai. Coba lagi.');
                return;
              }
              // Tombol COD hilang karena aksinya terlihat lewat pengamatan
              // pending_actions. Kirim antrean langsung supaya tidak menunggu
              // sinkron berkala berikutnya.
              try {
                await drainPendingActions(database);
              } catch (err) {
                // Kalau kirim antrean gagal (offline), aksi tetap tersimpan
                // 'pending' dan dikirim di kesempatan berikutnya.
                console.log('[OrderDetail] drain attempt while offline, action queued');
              }
            } catch (err) {
              console.error('[OrderDetail] failed to enqueue COD:', err);
              Alert.alert('Gagal', 'Tidak bisa mencatat pembayaran tunai. Coba lagi.');
            } finally {
              inflightCollectRef.current = false;
            }
          },
        },
      ],
    );
  };

  /**
   * Batalkan order lewat outbox.
   * Aksinya diantre dulu, lalu dikirim saat ada koneksi.
   */
  const handleCancelOrder = async (orderToCancel: OrderModel) => {
    Alert.alert(
      'Batalkan Order',
      'Apakah Anda yakin ingin membatalkan order ini?',
      [
        { text: 'Tidak', style: 'cancel' },
        {
          text: 'Ya, Batalkan',
          style: 'destructive',
          onPress: async () => {
            try {
              const result = await enqueueCancel(orderToCancel.id, orderToCancel.serverVersion);
              if (!result.success) {
                console.warn('[OrderDetail] enqueue pembatalan gagal:', result.error);
                Alert.alert('Gagal', 'Tidak bisa membatalkan order. Coba lagi.');
                return;
              }
              // Kirim antrean langsung supaya tidak menunggu sinkron berkala
              // berikutnya.
              try {
                await drainPendingActions(database);
              } catch (err) {
                // Kalau kirim antrean gagal (offline), aksi tetap tersimpan
                // 'pending' dan dikirim di kesempatan berikutnya.
                console.log('[OrderDetail] drain attempt while offline, action queued');
              }
            } catch (err) {
              console.error('[OrderDetail] failed to enqueue cancel:', err);
              Alert.alert('Gagal', 'Tidak bisa membatalkan order. Coba lagi.');
            }
          },
        },
      ],
    );
  };

  const kepala = (
    <AppBar
      title="Detail order"
      subtitle={formatOrderNumber(orderId)}
      onBack={() => navigation.goBack()}
    />
  );

  if (isLoading) {
    return (
      <ScreenFrame header={kepala} connection={bilah}>
        <View style={styles.kosong} />
      </ScreenFrame>
    );
  }

  if (error || !order) {
    return (
      <ScreenFrame header={kepala} connection={bilah}>
        <View style={styles.kosong}>
          <Text style={[type.bodyMd, { color: colors.textMuted, textAlign: 'center' }]}>
            {error ?? 'Order tidak ditemukan'}
          </Text>
        </View>
      </ScreenFrame>
    );
  }

  // itemsJson dan addressJson sudah ter-parse oleh @json decorator di OrderModel
  const items = (order.itemsJson as ItemRow[]) ?? [];
  const address = (order.addressJson as AddressData) ?? {};
  const catatan = order.notes ?? address.notes;
  const statusTampil = displayStatus ?? order.status;
  // Tunai sudah tercatat kalau payment-nya CAPTURED atau aksinya masih antre.
  const tunaiTercatat =
    codCaptured ||
    pendingActions.some(
      (a) =>
        a.actionType === 'collect_cod' &&
        (a.status === 'pending' || a.status === 'syncing'),
    );
  const driverPemilik = !!currentUserId && order.driverId === currentUserId;
  const kotaKodePos = [address.city, address.postalCode].filter(Boolean).join(' ');

  // Tombol utama satu slot: terima tunai dulu, kalau tidak bisa baru status.
  // Selama tombol Selesai diantar ditahan, tombolnya tetap Selesai diantar
  // dan tidak ikut hilang bersama status yang sudah antre.
  const ditahanSelesai = tahapSelesai !== null;
  const aksiUtama: AksiUtama | null = ditahanSelesai
    ? 'selesai'
    : canCollectCod(order)
      ? 'tunai'
      : canUpdateStatus(order)
        ? statusTampil === OrderStatus.PREPARING
          ? 'mulai'
          : 'selesai'
        : null;
  // Kotak tunai: bentuk tagih saat uang masih diminta, bentuk diterima
  // setelah tercatat. COD yatim tidak tercatat dan tidak aktif, jadi
  // tidak ada kotak.
  const varianTunai: CashBoxVariant | null =
    aksiUtama === 'tunai' ? 'tagih' : tunaiTercatat ? 'diterima' : null;
  const jumlahTunai = formatCurrency(order.totalCents, order.currency);
  // Selama tombol ditahan, kotak tunai tetap di bilah bawah supaya isi
  // bilah tidak berubah di tengah layar sukses akan datang.
  const kotakDiBilah = ditahanSelesai
    ? varianTunai !== null
    : varianTunai !== null && statusTampil === OrderStatus.OUT_FOR_DELIVERY;
  const kotakDiDaftar = ditahanSelesai
    ? false
    : varianTunai !== null && statusTampil === OrderStatus.DELIVERED;
  const bisaBatal = !!currentUserId && canDriverCancel(order);
  const adaBilahBawah = kotakDiBilah || aksiUtama !== null || bisaBatal;

  // Banner COD gagal: ada payment yang gagal dan COD belum tercatat.
  const paymentGagal =
    payments.some((p) => p.status === PaymentStatus.FAILED) &&
    !failedBannerDismissed &&
    !codCaptured;
  // Konflik dari kejadian sinkron perlu tindakan driver kalau order
  // dipindahkan atau aksinya ditolak.
  const konflikButuhTindak =
    conflictEvent?.reason === 'reassigned' || conflictEvent?.reason === 'rejected-oc';
  // Konflik tersimpan berlaku selama 24 jam sejak last_conflict_at. Alasan
  // 'released' dan 'reassigned' hanya relevan kalau baris sudah bukan
  // milik driver.
  const alasanKonflik = order.lastConflictReason;
  const konflikKedaluwarsa =
    !order.lastConflictAt ||
    Date.now() - new Date(order.lastConflictAt).getTime() > CONFLICT_BANNER_TTL_MS;
  const driverKosong = !order.driverId;
  const alasanButuhDriverKosong =
    alasanKonflik === 'released' || alasanKonflik === 'reassigned';
  const konflikTersimpan =
    alasanKonflik &&
    !lastConflictDismissed &&
    !konflikKedaluwarsa &&
    !(alasanButuhDriverKosong && !driverKosong)
      ? alasanKonflik
      : null;
  // Banner menunggu: antrean yang berjalan, atau antrean yang baru saja
  // habis dan masih ditahan dalam bentuk selesai. Aksi gagal atau COD
  // yatim membuat banner langsung hilang.
  const tampilMenunggu =
    antrean === 'pending' ||
    (antrean === null && faseMenunggu === 'done' && !hasFailedOrOrphanedAction);

  // Tiga slot dengan urutan tetap. Slot kosong ditulis null, bukan
  // disaring, supaya tombol utama tidak dipasang ulang saat kotak tunai
  // muncul atau hilang. Bilah bawah bergerak lewat bingkainya, jadi tiap
  // anak diberi gerak geser yang sama supaya ikut berpindah bersama bilah,
  // bukan langsung melompat ke posisi akhirnya.
  const isiBilahBawah = (
    <>
      {kotakDiBilah ? (
        <Animated.View
          testID="slot-tunai"
          style={styles.slotTunai}
          entering={dalamJendela ? undefined : MASUK_TUNAI}
          layout={dalamJendela ? undefined : GESER}
        >
          <CashBox variant={varianTunai ?? 'tagih'} amountText={jumlahTunai} />
        </Animated.View>
      ) : null}
      {aksiUtama ? (
        <Animated.View
          testID="bungkus-aksi-utama"
          layout={dalamJendela ? undefined : GESER}
        >
          <Button
            testID="aksi-utama"
            title={AKSI_UTAMA[aksiUtama].judul}
            icon={AKSI_UTAMA[aksiUtama].ikon}
            size="lg"
            success={tahapSelesai === 'berhasil'}
            onPress={() => {
              // Selama tombol ditahan, ketukan tidak melakukan apa-apa.
              if (ditahanSelesai) return;
              if (aksiUtama === 'tunai') {
                handleCollectCod(order);
              } else {
                handleUpdateStatus(order);
              }
            }}
          />
        </Animated.View>
      ) : null}
      {bisaBatal ? (
        <Animated.View
          testID="bungkus-batal"
          exiting={dalamJendela ? undefined : KELUAR_BATAL}
          layout={dalamJendela ? undefined : GESER}
          entering={dalamJendela ? undefined : MASUK_BATAL}
        >
          <Button
            title="Batalkan Order"
            variant="danger"
            onPress={() => handleCancelOrder(order)}
          />
        </Animated.View>
      ) : null}
    </>
  );

  return (
    <ScreenFrame
      header={kepala}
      connection={bilah}
      bottomBar={adaBilahBawah ? isiBilahBawah : undefined}
    >
      <ScrollView
        testID="isi-detail"
        style={styles.daftar}
        contentContainerStyle={styles.daftarIsi}
      >
        {/* Banner COD gagal diverifikasi */}
        {paymentGagal ? (
          <Banner
            key="cod-gagal"
            tone="danger"
            body="COD gagal diverifikasi. Hubungi support kalau uang tunai sudah di tangan."
            onClose={() => setFailedBannerDismissed(true)}
          />
        ) : null}

        {/* Banner konflik dari kejadian sinkron */}
        {conflictEvent ? (
          <Banner
            key="konflik-kejadian"
            tone={konflikButuhTindak ? 'danger' : 'info'}
            body={teksKonflikKejadian(conflictEvent)}
            onClose={() => setConflictEvent(null)}
          />
        ) : null}

        {/* Banner konflik tersimpan */}
        {konflikTersimpan ? (
          <Banner
            key="konflik-tersimpan"
            tone="danger"
            body={teksKonflikTersimpan(konflikTersimpan)}
            onClose={() => setLastConflictDismissed(true)}
          />
        ) : null}

        {/* Banner aksi gagal, satu per aksi */}
        {failedActions.map((action) => {
          const isi = teksAksiGagal(action);
          const tombol = tombolAksiGagal(action);
          if (!isi || !tombol) return null;
          return (
            <Banner
              key={`gagal-${action.id}`}
              tone="danger"
              body={isi}
              actions={tombol}
            />
          );
        })}

        {/* Banner COD yatim, satu per aksi */}
        {orphanedCodActions.map((action) => (
          <Banner
            key={`yatim-${action.id}`}
            tone="danger"
            body="Order ini sudah tidak ditugaskan ke Anda saat COD-nya terkirim. Simpan uangnya dan hubungi support."
          />
        ))}

        {/* Banner menunggu sinkronisasi */}
        {tampilMenunggu ? (
          <Banner
            key="menunggu"
            tone="pending"
            title="Menunggu sinkronisasi"
            done={antrean !== 'pending'}
          />
        ) : null}

        {/* Banner antrean basi */}
        {antrean === 'stale' ? (
          <Banner
            key="basi"
            tone="warning"
            title="Belum tersinkron dari sejam lalu"
            body="Cek koneksi internet Anda"
          />
        ) : null}

        {/* Kartu Langkah order */}
        <Animated.View layout={dalamJendela ? undefined : GESER}>
          <Card accessibilityLabel="Langkah order">
            <OrderSteps
              status={statusTampil}
              statusText={driverStatusLabel(statusTampil)}
              selesai={langkahOrder(statusTampil, tunaiTercatat)}
            />
          </Card>
        </Animated.View>

        {/* Kartu Antar ke */}
        <Animated.View layout={dalamJendela ? undefined : GESER}>
          <Card accessibilityLabel="Antar ke">
            <Text
              accessibilityRole="header"
              style={[styles.judulBagian, { color: colors.textSubtle }]}
            >
              Antar ke
            </Text>
            <View style={styles.barisAlamat}>
              <Icon name="location_on" size={size.iconMd} color={colors.info} />
              <View style={styles.kolomAlamat}>
                <Text style={[type.titleSm, { color: colors.text }]}>
                  {address.street ?? 'Alamat tidak tersedia'}
                </Text>
                {kotaKodePos ? (
                  <Text style={[type.bodySm, { color: colors.textMuted, marginTop: 2 }]}>
                    {kotaKodePos}
                  </Text>
                ) : null}
              </View>
            </View>
            {catatan ? (
              <View style={styles.barisCatatan}>
                <Icon name="edit_note" size={size.iconMd} color={colors.textSubtle} />
                <Text style={[type.bodySm, { color: colors.textMuted, flex: 1 }]}>
                  {catatan}
                </Text>
              </View>
            ) : null}
            {driverPemilik ? (
              <View style={styles.barisTombol}>
                <View style={styles.tombolSetengah}>
                  <Button
                    title="Chat"
                    icon="chat"
                    variant="secondary"
                    onPress={() => navigation.navigate('Chat', { roomId: order.id })}
                  />
                </View>
                <View style={styles.tombolSetengah}>
                  <Button
                    title="Lihat Rute"
                    icon="directions"
                    variant="secondary"
                    onPress={() => navigation.navigate('Map', { orderId: order.id })}
                  />
                </View>
              </View>
            ) : null}
          </Card>
        </Animated.View>

        {/* Kartu Rincian */}
        <Animated.View layout={dalamJendela ? undefined : GESER}>
          <Card accessibilityLabel="Rincian">
            <Text
              accessibilityRole="header"
              style={[styles.judulBagian, { color: colors.textSubtle }]}
            >
              Rincian
            </Text>
            {items.length === 0 ? (
              <Text style={[type.bodyMd, { color: colors.textMuted, marginTop: 10 }]}>
                Tidak ada item.
              </Text>
            ) : (
              items.map((item, idx) => (
                <View key={idx} style={styles.barisItem}>
                  <Text style={[type.bodyMd, { color: colors.text, flex: 1 }]}>
                    {item.name}{' '}
                    <Text style={{ color: colors.textSubtle }}>
                      {TANDA_KALI} {item.quantity}
                    </Text>
                  </Text>
                  <Text
                    style={[
                      type.bodyMd,
                      { color: colors.text, fontVariant: ['tabular-nums'] },
                    ]}
                  >
                    {formatCurrency(item.unitPriceCents * item.quantity, order.currency)}
                  </Text>
                </View>
              ))
            )}
            <View style={[styles.garis, { backgroundColor: colors.line }]} />
            <View style={styles.barisTotal}>
              <Text style={[type.bodyMd, { color: colors.textMuted }]}>Total</Text>
              <Text style={[type.amount, { color: colors.text }]}>
                {formatCurrency(order.totalCents, order.currency)}
              </Text>
            </View>
            <View style={styles.barisDibuat}>
              <Icon name="schedule" size={size.iconXs} color={colors.textSubtle} />
              <Text
                style={[
                  type.bodyXs,
                  { color: colors.textSubtle, fontVariant: ['tabular-nums'] },
                ]}
              >
                Dibuat {formatOrderTime(new Date(order.createdAt).getTime(), Date.now())}
              </Text>
            </View>
          </Card>
        </Animated.View>

        {/* Kotak tunai di akhir daftar, dipakai kalau order sudah selesai */}
        {kotakDiDaftar ? (
          <Animated.View layout={dalamJendela ? undefined : GESER}>
            <CashBox variant={varianTunai ?? 'diterima'} amountText={jumlahTunai} />
          </Animated.View>
        ) : null}
      </ScrollView>
    </ScreenFrame>
  );
}

// Enhanced with Database

const enhance = withDatabase(OrderDetailBase);

export { enhance as OrderDetailScreen };

// Styles

const styles = StyleSheet.create({
  daftar: {
    flex: 1,
  },
  daftarIsi: {
    paddingTop: space[2],
    paddingHorizontal: space[4],
    paddingBottom: space[4],
    gap: space[3],
  },
  kosong: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space[6],
  },
  judulBagian: {
    ...type.labelSm,
  },
  barisAlamat: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 10,
  },
  kolomAlamat: {
    flex: 1,
  },
  barisCatatan: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 10,
  },
  barisTombol: {
    marginTop: 16,
    flexDirection: 'row',
    gap: space[2],
  },
  tombolSetengah: {
    flex: 1,
  },
  barisItem: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  garis: {
    height: stroke.hairline,
    marginVertical: 12,
  },
  barisTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  barisDibuat: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  slotTunai: {
    marginBottom: space[1],
  },
});
