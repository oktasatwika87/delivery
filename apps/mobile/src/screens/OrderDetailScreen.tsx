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

import type { RootStackParamList } from '../../App';
import { OrderModel } from '../db/models/OrderModel';
import { PaymentModel } from '../db/models/PaymentModel';
import { PendingActionModel, readUpdateStatusTarget } from '../db/models/PendingActionModel';
import { formatCurrency } from '../formatCurrency';
import { getCurrentUserId } from '../sync/session';
import { syncEvents } from '../sync/syncEvents';
import type { OrderConflictEvent } from '../sync/syncEvents';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@delivery/shared';
import {
  enqueueCancel,
  enqueueCollectCod,
  enqueueUpdateStatus,
  drainPendingActions,
  isPendingActionStale,
  retryFailedAction,
  discardFailedAction,
} from '../sync/outbox';

// Types

interface ItemRow {
  name: string;
  quantity: number;
  unitPriceCents: number;
}

interface AddressData {
  street?: string;
  city?: string;
  notes?: string;
}

interface Props {
  database: Database;
}

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

  const isActionNeeded = event.reason === 'reassigned' || event.reason === 'rejected-oc' || event.reason === 'accepted-by-other';
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
    if (event.reason === 'accepted-by-other') {
      return 'Order ini sudah diambil driver lain. Pilih order lain dari daftar Tersedia.';
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

  if (isDismissed || isExpired || !order.lastConflictReason) return null;

  const getMessage = (): string => {
    switch (order.lastConflictReason) {
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

// Status Badge

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  PENDING: { bg: '#fef3c7', text: '#92400e' },
  CONFIRMED: { bg: '#dbeafe', text: '#1e40af' },
  PREPARING: { bg: '#ede9fe', text: '#5b21b6' },
  OUT_FOR_DELIVERY: { bg: '#fed7aa', text: '#c2410c' },
  DELIVERED: { bg: '#d1fae5', text: '#065f46' },
  CANCELLED: { bg: '#fee2e2', text: '#991b1b' },
};

function StatusBadge({ status }: { status: string }): React.JSX.Element {
  const colors = STATUS_COLORS[status] ?? { bg: '#f3f4f6', text: '#374151' };
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>
        {status.replace('_', ' ')}
      </Text>
    </View>
  );
}

// Item Row

function ItemRow({ item }: { item: ItemRow }): React.JSX.Element {
  return (
    <View style={styles.itemRow}>
      <Text style={styles.itemName}>
        {item.quantity}x {item.name}
      </Text>
      <Text style={styles.itemPrice}>
        {formatCurrency(item.unitPriceCents * item.quantity, 'IDR')}
      </Text>
    </View>
  );
}

// Helpers

function formatDate(date: Date): string {
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
  ];
  const d = date;
  const day = d.getDate();
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, pukul ${hours}:${minutes}`;
}

// Base Component

function OrderDetailBase({ database }: Props): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'OrderDetail'>>();
  const route = useRoute<NativeStackScreenProps<RootStackParamList, 'OrderDetail'>['route']>();

  const { orderId } = route.params;
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
  // activeAction: aksi yang masih menunggu terkirim ('pending' atau 'syncing').
  const activeAction = pendingActions.filter(
    (a) => a.status === 'pending' || a.status === 'syncing',
  );
  // statusActionsActive: aksi update_status yang masih menunggu terkirim,
  // urut dari createdAt (aksi tertua dulu). Dipakai untuk displayStatus dan
  // syarat tombol status, sehingga tampilan menunjukkan status yang berlaku
  // setelah antrean selesai terkirim.
  const statusActionsActive = activeAction
    .filter((a) => a.actionType === 'update_status')
    .sort((a, b) => {
      const aMs = a.createdAt instanceof Date ? a.createdAt.getTime() : Number(a.createdAt);
      const bMs = b.createdAt instanceof Date ? b.createdAt.getTime() : Number(b.createdAt);
      return aMs - bMs;
    });
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
  // isPendingStale: ada aksi yang menunggu terkirim lebih dari sejam.
  const isPendingStale = activeAction.some((a) => isPendingActionStale(a));
  // displayStatus: target aksi status aktif yang paling baru (createdAt
  // terbesar), yaitu status order setelah antrean selesai terkirim. Kalau
  // tidak ada aksi status, atau ada aksi 'failed'/yatim jenis apa pun untuk
  // order ini, pakai status baris order dari server.
  const latestStatusAction = statusActionsActive[statusActionsActive.length - 1];
  const latestStatusTarget = latestStatusAction
    ? readUpdateStatusTarget(latestStatusAction.payloadJson)
    : null;
  const displayStatus = (latestStatusTarget && !hasFailedOrOrphanedAction)
    ? latestStatusTarget
    : order?.status;

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

  if (isLoading) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Memuat detail order...</Text>
      </View>
    );
  }

  if (error || !order) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? 'Order tidak ditemukan'}</Text>
      </View>
    );
  }

  // itemsJson dan addressJson sudah ter-parse oleh @json decorator di OrderModel
  const items = (order.itemsJson as ItemRow[]) ?? [];
  const address = (order.addressJson as AddressData) ?? {};

  return (
    <ScrollView style={styles.container}>
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
      {activeAction.length > 0 && !isPendingStale && (
        <View style={styles.pendingBanner}>
          <Text style={styles.pendingBannerText}>Menunggu sinkronisasi...</Text>
        </View>
      )}

      {/* Stale Pending Action Warning */}
      {isPendingStale && (
        <View style={styles.stalePendingBanner}>
          <Text style={styles.stalePendingBannerText}>
            Belum tersinkron dari sejam lalu — cek koneksi internet kamu
          </Text>
        </View>
      )}

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Order #{order.id.slice(0, 8)}</Text>
        <StatusBadge status={displayStatus ?? order.status} />
      </View>

      {/* Items */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Item</Text>
        {items.length === 0 ? (
          <Text style={styles.mutedText}>Tidak ada item.</Text>
        ) : (
          items.map((item, idx) => <ItemRow key={idx} item={item} />)
        )}
      </View>

      {/* Total */}
      <View style={styles.section}>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            {formatCurrency(order.totalCents, order.currency)}
          </Text>
        </View>
      </View>

      {/* Address */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Alamat Pengiriman</Text>
        <Text style={styles.addressText}>
          {address.street ?? 'Alamat tidak tersedia'}
        </Text>
        {address.city && <Text style={styles.addressText}>{address.city}</Text>}
      </View>

      {/* Notes */}
      {(order.notes || address.notes) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Catatan</Text>
          <Text style={styles.notesText}>{order.notes ?? address.notes}</Text>
        </View>
      )}

      {/* Timestamp */}
      <View style={styles.section}>
        <Text style={styles.timestampText}>
          Dibuat: {formatDate(new Date(order.createdAt))}
        </Text>
      </View>

      {/* Chat Button, hanya untuk driver yang ditugaskan ke order ini */}
      {order && currentUserId && order.driverId === currentUserId && (
        <TouchableOpacity
          style={styles.chatButton}
          onPress={() => navigation.navigate('Chat', { roomId: order.id })}
        >
          <Text style={styles.chatButtonText}>Chat dengan Kurir / Customer</Text>
        </TouchableOpacity>
      )}

      {/* Map Button, hanya untuk driver yang ditugaskan ke order ini */}
      {order && currentUserId && order.driverId === currentUserId && (
        <TouchableOpacity
          style={styles.mapButton}
          onPress={() => navigation.navigate('Map', { orderId: order.id })}
        >
          <Text style={styles.mapButtonText}>Lihat Rute Pengiriman</Text>
        </TouchableOpacity>
      )}

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
          style={[
            styles.statusButton,
            inflightStatusRef.current && styles.statusButtonDisabled,
          ]}
          onPress={() => handleUpdateStatus(order)}
          disabled={inflightStatusRef.current}
        >
          <Text
            style={[
              styles.statusButtonText,
              inflightStatusRef.current && styles.statusButtonTextDisabled,
            ]}
          >
            {displayStatus === OrderStatus.PREPARING ? 'Mulai antar' : 'Selesai diantar'}
          </Text>
        </TouchableOpacity>
      )}

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

// Enhanced with Database

const enhance = withDatabase(OrderDetailBase);

export { enhance as OrderDetailScreen };

// Styles

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  section: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  itemName: {
    fontSize: 15,
    color: '#374151',
    flex: 1,
  },
  itemPrice: {
    fontSize: 15,
    fontWeight: '500',
    color: '#374151',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  addressText: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 22,
  },
  notesText: {
    fontSize: 15,
    color: '#6b7280',
    fontStyle: 'italic',
  },
  timestampText: {
    fontSize: 13,
    color: '#9ca3af',
  },
  chatButton: {
    margin: 16,
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  chatButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  mapButton: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#059669',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  mapButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
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
  statusButtonDisabled: {
    backgroundColor: '#a1a1aa',
  },
  statusButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  statusButtonTextDisabled: {
    color: '#d4d4d8',
  },
  bottomSpacer: {
    height: 24,
  },
  loadingText: {
    fontSize: 16,
    color: '#6b7280',
  },
  errorText: {
    fontSize: 16,
    color: '#dc2626',
    textAlign: 'center',
  },
  mutedText: {
    fontSize: 14,
    color: '#9ca3af',
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
