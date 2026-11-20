import React, { useEffect, useState, useRef } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { Q } from '@nozbe/watermelondb';
import { withDatabase } from '@nozbe/watermelondb/react';
import type { Database } from '@nozbe/watermelondb';
import Animated from 'react-native-reanimated';

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
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { OrderSteps } from '../components/OrderSteps';
import { ScreenFrame } from '../components/ScreenFrame';
import { Icon } from '../theme/Icon';
import { useTheme } from '../theme/ThemeProvider';
import { size, space, stroke, type } from '../theme/tokens';
import { useInitialWindow } from '../components/motion/InitialWindow';
import { shift } from '../components/motion/presets';
import { langkahOrder } from './langkahOrder';

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

// Failed Payment Banner

interface FailedPaymentBannerProps {
  payments: PaymentModel[];
  codCaptured: boolean;
  onDismiss: () => void;
  isDismissed: boolean;
}

function FailedPaymentBanner({ payments, codCaptured, onDismiss, isDismissed }: FailedPaymentBannerProps): React.JSX.Element | null {
  const hasFailedPayment = payments.some((p) => p.status === PaymentStatus.FAILED);

  if (!hasFailedPayment || isDismissed || codCaptured) return null;

  return (
    <View style={styles.failedBanner}>
      <Text style={styles.failedBannerText}>
        COD gagal diverifikasi. Hubungi support jika cash sudah di tangan.
      </Text>
      <TouchableOpacity onPress={onDismiss} style={styles.failedBannerDismiss}>
        <Text style={styles.failedBannerDismissText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

// Order Conflict Banner

interface OrderConflictBannerProps {
  event: OrderConflictEvent | null;
  onDismiss: () => void;
}

function OrderConflictBanner({ event, onDismiss }: OrderConflictBannerProps): React.JSX.Element | null {
  if (!event) return null;

  const isActionNeeded = event.reason === 'reassigned' || event.reason === 'rejected-oc';
  const backgroundColor = isActionNeeded ? '#fef3c7' : '#e5e7eb';
  const borderColor = isActionNeeded ? '#fcd34d' : '#d1d5db';
  const textColor = isActionNeeded ? '#92400e' : '#374151';

  const getMessage = () => {
    if (event.reason === 'reassigned') {
      return 'Order ini sudah dipindahkan ke driver lain.';
    }
    if (event.reason === 'rejected-oc') {
      return event.ackReason ?? 'Order tidak bisa diperbarui — status di server sudah berubah.';
    }
    // order-status-conflict
    return `Status order diperbarui server — sekarang ${event.serverStatus}.`;
  };

  return (
    <View style={[styles.conflictBanner, { backgroundColor, borderColor }]}>
      <Text style={[styles.conflictBannerText, { color: textColor }]}>
        {isActionNeeded ? '⚠️ ' : 'ℹ️ '}{getMessage()}
      </Text>
      <TouchableOpacity onPress={onDismiss} style={styles.conflictBannerDismiss}>
        <Text style={[styles.conflictBannerDismissText, { color: textColor }]}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

// Banner konflik tersimpan: teks per last_conflict_reason, tampil 24 jam sejak
// last_conflict_at.

interface LastConflictBannerProps {
  order: OrderModel;
  isDismissed: boolean;
  onDismiss: () => void;
}

const CONFLICT_BANNER_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function LastConflictBanner({ order, isDismissed, onDismiss }: LastConflictBannerProps): React.JSX.Element | null {
  // Auto-expire: 24 hours dari last_conflict_at
  const isExpired = !order.lastConflictAt ||
    (Date.now() - new Date(order.lastConflictAt).getTime()) > CONFLICT_BANNER_TTL_MS;

  // 'released' dan 'reassigned' hanya relevan kalau baris sudah bukan milik
  // driver: driver_id kosong (null, undefined, atau ''). Kalau masih
  // terisi, alasan itu tidak berlaku untuk order ini dan banner disembunyikan.
  const driverIsEmpty = !order.driverId;
  const reasonRequiresUnowned =
    order.lastConflictReason === 'released' || order.lastConflictReason === 'reassigned';

  if (isDismissed || isExpired || !order.lastConflictReason) return null;
  if (reasonRequiresUnowned && !driverIsEmpty) return null;

  const getMessage = (): string => {
    switch (order.lastConflictReason) {
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
  };

  return (
    <View style={styles.conflictBanner}>
      <Text style={styles.conflictBannerText}>
        ⚠️ {getMessage()}
      </Text>
      <TouchableOpacity onPress={onDismiss} style={styles.conflictBannerDismiss}>
        <Text style={styles.conflictBannerDismissText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

// Banner aksi gagal, satu per aksi 'failed'. Cancel, reject, dan update_status
// punya tombol Coba lagi dan Abaikan; COD hanya Coba lagi karena tidak
// bisa dibuang.

interface FailedActionBannerProps {
  action: PendingActionModel;
  onRetry: (actionId: string) => void;
  onDiscard: (actionId: string) => void;
}

function FailedActionBanner({ action, onRetry, onDiscard }: FailedActionBannerProps): React.JSX.Element | null {
  if (action.actionType === 'cancel') {
    return (
      <View style={styles.failedActionBanner}>
        <Text style={styles.failedActionBannerText}>
          Pembatalan ditolak server dan tidak dicoba lagi otomatis.
        </Text>
        <View style={styles.failedActionButtons}>
          <TouchableOpacity onPress={() => onRetry(action.id)} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Coba lagi</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onDiscard(action.id)} style={styles.discardButton}>
            <Text style={styles.discardButtonText}>Abaikan</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  if (action.actionType === 'reject') {
    return (
      <View style={styles.failedActionBanner}>
        <Text style={styles.failedActionBannerText}>
          Penolakan order ditolak server dan tidak dicoba lagi otomatis.
        </Text>
        <View style={styles.failedActionButtons}>
          <TouchableOpacity onPress={() => onRetry(action.id)} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Coba lagi</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onDiscard(action.id)} style={styles.discardButton}>
            <Text style={styles.discardButtonText}>Abaikan</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  if (action.actionType === 'update_status') {
    // Teks per target yang dituju aksi. Target yang tidak terbaca
    // (payload korup) memakai pesan bawaan.
    const target = readUpdateStatusTarget(action.payloadJson);
    const message =
      target === 'OUT_FOR_DELIVERY'
        ? 'Mulai antar ditolak server dan tidak dicoba lagi otomatis.'
        : target === 'DELIVERED'
        ? 'Selesai diantar ditolak server dan tidak dicoba lagi otomatis.'
        : 'Perubahan status ditolak server dan tidak dicoba lagi otomatis.';
    return (
      <View style={styles.failedActionBanner}>
        <Text style={styles.failedActionBannerText}>{message}</Text>
        <View style={styles.failedActionButtons}>
          <TouchableOpacity onPress={() => onRetry(action.id)} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Coba lagi</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onDiscard(action.id)} style={styles.discardButton}>
            <Text style={styles.discardButtonText}>Abaikan</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  if (action.actionType === 'collect_cod') {
    return (
      <View style={styles.failedActionBanner}>
        <Text style={styles.failedActionBannerText}>
          COD gagal dicatat server dan tidak dicoba lagi otomatis. Simpan uangnya, lalu coba lagi atau hubungi support.
        </Text>
        <View style={styles.failedActionButtons}>
          <TouchableOpacity onPress={() => onRetry(action.id)} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Coba lagi</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
  return null;
}

// Banner COD yatim, satu per aksi COD 'orphaned_needs_review'. Tanpa tombol.

function OrphanedCodBanner(): React.JSX.Element | null {
  return (
    <View style={styles.orphanBanner}>
      <Text style={styles.orphanBannerText}>
        Order ini sudah tidak ditugaskan ke Anda saat COD-nya terkirim. Simpan uangnya dan hubungi support.
      </Text>
    </View>
  );
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
  const inflightCollectRef = useRef(false);
  const inflightStatusRef = useRef(false);

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
   * Terima Cash (COD): displayStatus OUT_FOR_DELIVERY, order milik driver,
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
   * outbox, supaya tetap jalan saat offline. Target dihitung dari
   * displayStatus (status yang sedang ditampilkan), bukan dari order.status,
   * supaya Selesai diantar yang diketuk saat Mulai antar masih antre
   * menghasilkan target DELIVERED.
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

    Alert.alert(alertTitle, alertBody, [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Ya',
        onPress: async () => {
          if (inflightStatusRef.current) return;
          inflightStatusRef.current = true;
          try {
            const result = await enqueueUpdateStatus(orderToUpdate.id, nextStatus);
            if (!result.success) {
              Alert.alert('Gagal', 'Status gagal dicatat. Coba lagi.');
              return;
            }
            // Getarnya tanda aksi sudah diterima HP, jadi tetap bergetar
            // walau antrean belum sempat terkirim. Mulai antar tidak
            // bergetar.
            if (nextStatus === OrderStatus.DELIVERED) {
              hapticDelivered();
            }
            try {
              await drainPendingActions(database);
            } catch (err) {
              // Kalau kirim antrean gagal (offline), aksi tetap tersimpan
              // 'pending' dan dikirim di kesempatan berikutnya.
              console.log('[OrderDetail] drain attempt while offline, action queued');
            }
          } catch (err) {
            console.error('[OrderDetail] failed to enqueue update_status:', err);
            Alert.alert('Gagal', 'Status gagal dicatat. Coba lagi.');
          } finally {
            inflightStatusRef.current = false;
          }
        },
      },
    ]);
  };

  /**
   * Handle COD collection via outbox.
   * Enqueues a pending action that will be synced when online.
   */
  const handleCollectCod = async (orderToCollect: OrderModel) => {
    const amount = formatCurrency(orderToCollect.totalCents, orderToCollect.currency);
    Alert.alert(
      'Terima Cash (COD)',
      `Kumpulkan payment cash ${amount} dari customer?`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Ya, Terima',
          onPress: async () => {
            // Inflight guard: prevent double-tap / concurrent calls
            // Use ref for synchronous check (state updates are async, refs are sync)
            if (inflightCollectRef.current) return;
            inflightCollectRef.current = true;
            try {
              const result = await enqueueCollectCod(orderToCollect.id, orderToCollect.totalCents);
              if (!result.success) {
                Alert.alert('Gagal', result.error ?? 'Tidak bisa mencatat payment. Coba lagi.');
                return;
              }
              // Tombol COD hilang karena aksinya terlihat lewat pengamatan
              // pending_actions. Kirim antrean langsung supaya tidak menunggu
              // sinkron berkala berikutnya.
              try {
                await drainPendingActions(database);
              } catch (err) {
                // If drain fails (offline), that's expected, action stays pending
                console.log('[OrderDetail] drain attempt while offline, action queued');
              }
            } catch (err) {
              console.error('[OrderDetail] failed to enqueue COD:', err);
              Alert.alert('Gagal', 'Tidak bisa mencatat payment. Coba lagi.');
            } finally {
              inflightCollectRef.current = false;
            }
          },
        },
      ],
    );
  };

  /**
   * Handle cancel order action via outbox.
   * Enqueues a pending action that will be synced when online.
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
                Alert.alert('Gagal', result.error ?? 'Tidak bisa membatalkan order. Coba lagi.');
                return;
              }
              // Kirim antrean langsung supaya tidak menunggu sinkron berkala
              // berikutnya.
              try {
                await drainPendingActions(database);
              } catch (err) {
                // If drain fails (offline), that's expected, action stays pending
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

  return (
    <ScreenFrame header={kepala} connection={bilah}>
      <ScrollView
        testID="isi-detail"
        style={styles.daftar}
        contentContainerStyle={styles.daftarIsi}
      >
        {/* Failed Payment Banner */}
        <FailedPaymentBanner
          payments={payments}
          codCaptured={codCaptured}
          isDismissed={failedBannerDismissed}
          onDismiss={() => setFailedBannerDismissed(true)}
        />

        {/* Order Conflict Banner */}
        <OrderConflictBanner
          event={conflictEvent}
          onDismiss={() => setConflictEvent(null)}
        />

        {/* Banner konflik tersimpan */}
        <LastConflictBanner
          order={order}
          isDismissed={lastConflictDismissed}
          onDismiss={() => setLastConflictDismissed(true)}
        />

        {/* Banner aksi gagal, satu per aksi */}
        {failedActions.map((action) => (
          <FailedActionBanner
            key={action.id}
            action={action}
            onRetry={(actionId) => { void retryFailedAction(actionId); }}
            onDiscard={(actionId) => { void discardFailedAction(actionId); }}
          />
        ))}

        {/* Banner COD yatim, satu per aksi */}
        {orphanedCodActions.map((action) => (
          <OrphanedCodBanner key={action.id} />
        ))}

        {/* Pending Action Indicator */}
        {antrean === 'pending' && (
          <View style={styles.pendingBanner}>
            <Text style={styles.pendingBannerText}>Menunggu sinkronisasi...</Text>
          </View>
        )}

        {/* Stale Pending Action Warning */}
        {antrean === 'stale' && (
          <View style={styles.stalePendingBanner}>
            <Text style={styles.stalePendingBannerText}>
              Belum tersinkron dari sejam lalu — cek koneksi internet kamu
            </Text>
          </View>
        )}

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
                      {'×'} {item.quantity}
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

        {/* Tombol Batalkan, syaratnya di canDriverCancel */}
        {order && currentUserId && canDriverCancel(order) && (
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => handleCancelOrder(order)}
          >
            <Text style={styles.cancelButtonText}>Batalkan Order</Text>
          </TouchableOpacity>
        )}

        {/* Tombol COD, syaratnya di canCollectCod */}
        {order && currentUserId && canCollectCod(order) && (
          <TouchableOpacity
            style={styles.codButton}
            onPress={() => handleCollectCod(order)}
          >
            <Text style={styles.codButtonText}>Terima Cash (COD)</Text>
          </TouchableOpacity>
        )}

        {/* Tombol Mulai antar dan Selesai diantar, syaratnya di canUpdateStatus */}
        {order && currentUserId && canUpdateStatus(order) && (
          <TouchableOpacity
            style={styles.statusButton}
            onPress={() => handleUpdateStatus(order)}
          >
            <Text style={styles.statusButtonText}>
              {displayStatus === OrderStatus.PREPARING ? 'Mulai antar' : 'Selesai diantar'}
            </Text>
          </TouchableOpacity>
        )}
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
  cancelButton: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#dc2626',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  codButton: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#059669',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  codButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  statusButton: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  statusButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  // Failed Payment Banner
  failedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#fcd34d',
  },
  failedBannerText: {
    flex: 1,
    fontSize: 14,
    color: '#92400e',
    fontWeight: '500',
  },
  failedBannerDismiss: {
    marginLeft: 12,
    padding: 4,
  },
  failedBannerDismissText: {
    fontSize: 16,
    color: '#92400e',
    fontWeight: '600',
  },
  // Order Conflict Banner
  conflictBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  conflictBannerText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  conflictBannerDismiss: {
    marginLeft: 12,
    padding: 4,
  },
  conflictBannerDismissText: {
    fontSize: 16,
    fontWeight: '600',
  },
  // Pending Action Banner
  pendingBanner: {
    backgroundColor: '#dbeafe',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#93c5fd',
  },
  pendingBannerText: {
    fontSize: 13,
    color: '#1e40af',
    textAlign: 'center',
  },
  // Stale Pending Action Banner
  stalePendingBanner: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#fcd34d',
  },
  stalePendingBannerText: {
    fontSize: 13,
    color: '#92400e',
    textAlign: 'center',
  },
  // Banner aksi gagal
  failedActionBanner: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#fecaca',
  },
  failedActionBannerText: {
    fontSize: 14,
    color: '#7f1d1d',
    fontWeight: '500',
    lineHeight: 20,
    marginBottom: 8,
  },
  failedActionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  retryButton: {
    backgroundColor: '#dc2626',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  discardButton: {
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#dc2626',
  },
  discardButtonText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '600',
  },
  // Banner COD yatim
  orphanBanner: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#fcd34d',
  },
  orphanBannerText: {
    fontSize: 14,
    color: '#92400e',
    fontWeight: '500',
    lineHeight: 20,
  },
});
