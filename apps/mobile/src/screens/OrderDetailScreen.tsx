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
import { PendingActionModel } from '../db/models/PendingActionModel';
import { formatCurrency } from '../formatCurrency';
import { getCurrentUserId } from '../sync/session';
import { syncEvents } from '../sync/syncEvents';
import type { OrderConflictEvent } from '../sync/syncEvents';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@delivery/shared';
import { enqueueCancel, enqueueCollectCod, drainPendingActions, isPendingActionStale } from '../sync/outbox';
import { updateOrderStatus, getOrderById, ApiError } from '../sync/client';
import { networkMonitor } from '../map/networkMonitor';

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
  onDismiss: () => void;
  isDismissed: boolean;
}

function FailedPaymentBanner({ payments, onDismiss, isDismissed }: FailedPaymentBannerProps): React.JSX.Element | null {
  const hasFailedPayment = payments.some((p) => p.status === PaymentStatus.FAILED);

  if (!hasFailedPayment || isDismissed) return null;

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
      return 'Order ini sudah di-reassign ke driver lain. Hubungi support jika ini seharusnya masih order Anda.';
    }
    if (event.reason === 'rejected-oc') {
      return event.ackReason ?? 'Order tidak bisa diperbarui — status di server sudah berubah.';
    }
    if (event.reason === 'accepted-by-other') {
      return 'Order ini sudah di-accept driver lain. Silakan pilih order lain dari daftar Tersedia.';
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

// Last Conflict Banner (Skenario A)

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

  const getMessage = () => {
    switch (order.lastConflictReason) {
      case 'accepted-by-other':
        return 'Order yang Anda batalkan ternyata sudah di-accept driver lain. Silakan cek status terbaru.';
      case 'reassigned':
        return 'Order yang Anda batalkan ternyata sudah diselesaikan. Status order sudah tidak bisa dibatalkan.';
      case 'order-status-conflict':
      default:
        return 'Order yang Anda batalkan ternyata sudah tidak bisa dibatalkan — server sudah ubah status. Silakan cek status terbaru.';
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
  const [hasCodPayment, setHasCodPayment] = useState(false);
  // hasCashPaymentNotFailed: turunan terpisah untuk gate "Selesai diantar".
  // Gate tombol COD masih pakai hasCodPayment (jangan diubah).
  const [hasCashPaymentNotFailed, setHasCashPaymentNotFailed] = useState(false);
  const [payments, setPayments] = useState<PaymentModel[]>([]);
  const [failedBannerDismissed, setFailedBannerDismissed] = useState(false);
  const [conflictEvent, setConflictEvent] = useState<OrderConflictEvent | null>(null);
  // Skenario A: dismiss state untuk LastConflictBanner (persisted signal)
  const [lastConflictDismissed, setLastConflictDismissed] = useState(false);
  // Observe pending_actions untuk banner reaktif, berubah/hilang sendiri
  const [pendingActions, setPendingActions] = useState<PendingActionModel[]>([]);
  // hasPending: sumber utama dari observe. observe bikin tombol reaktif,
  // nonaktif saat ada pending, aktif lagi saat pending dihapus dari outbox.
  const [hasPending, setHasPending] = useState(false);
  // Use ref for synchronous inflight guard (state updates are async, refs are sync)
  const inflightCollectRef = useRef(false);
  const inflightStatusRef = useRef(false);
  const [isOnline, setIsOnline] = useState(networkMonitor.getStatus() === 'online');

  useEffect(() => {
    getCurrentUserId().then(setCurrentUserId);
  }, []);

  useEffect(() => {
    const unsubscribe = networkMonitor.subscribe((status) => {
      setIsOnline(status === 'online');
    });
    return unsubscribe;
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

  // Observe payments collection filtered by orderId
  useEffect(() => {
    if (!orderId) return;

    let subscription: { unsubscribe: () => void } | null = null;

    const subscribe = async () => {
      try {
        const paymentsCollection = database.get<PaymentModel>('payments');
        subscription = paymentsCollection
          .query(Q.where('order_id', orderId))
          .observe()
          .subscribe({
            next: (records) => {
              setPayments(records);
              // Update hasCodPayment based on observation
              const hasCod = records.some(
                (p) => p.method === PaymentMethod.CASH,
              );
              setHasCodPayment(hasCod);
              // hasCashPaymentNotFailed: turunan terpisah untuk gate tombol
              // Selesai diantar (OUT_FOR_DELIVERY jadi DELIVERED). Hanya true kalau
              // ada payment CASH yang belum FAILED, payment FAILED tetap
              // dianggap "belum ada COD yang valid", jadi driver perlu retry
              // collect sebelum boleh selesaikan delivery.
              const hasCashNotFailed = records.some(
                (p) => p.method === PaymentMethod.CASH && p.status !== PaymentStatus.FAILED,
              );
              setHasCashPaymentNotFailed(hasCashNotFailed);
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

  // Observe pending_actions untuk banner reaktif, berubah/hilang sendiri
  useEffect(() => {
    if (!orderId) return;
    let subscription: { unsubscribe: () => void } | null = null;

    const subscribe = async () => {
      try {
        subscription = database
          .get<PendingActionModel>('pending_actions')
          .query(Q.where('target_order_id', orderId))
          .observe()
          .subscribe({
            next: (actions) => {
              setPendingActions(actions);
              setHasPending(actions.length > 0);
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

  // isPendingStale: turunan pendingActions, banner stale reaktif dari observe.
  const isPendingStale = pendingActions.some((a) => isPendingActionStale(a));

  /**
   * Check if the current driver can cancel this order.
   * Driver can cancel if:
   * - Status is ASSIGNED, PREPARING, or OUT_FOR_DELIVERY
   * - Driver is assigned to this order (driverId matches current user)
   */
  const canDriverCancel = (order: OrderModel): boolean => {
    const cancellableStatuses = [
      OrderStatus.ASSIGNED,
      OrderStatus.PREPARING,
      OrderStatus.OUT_FOR_DELIVERY,
    ];
    if (!cancellableStatuses.includes(order.status as any)) return false;
    if (!currentUserId || order.driverId !== currentUserId) return false;
    return true;
  };

  /**
   * Check if COD button should be shown.
   * Shows for OUT_FOR_DELIVERY orders assigned to current driver,
   * and only if no COD payment already exists.
   */
  const canCollectCod = (order: OrderModel): boolean => {
    if (order.status !== OrderStatus.OUT_FOR_DELIVERY) return false;
    if (!currentUserId || order.driverId !== currentUserId) return false;
    if (hasCodPayment) return false;
    return true;
  };

  /**
   * Check if driver status button should be shown.
   * Shows for PREPARING -> OUT_FOR_DELIVERY or OUT_FOR_DELIVERY -> DELIVERED
   * transitions, assigned to current driver, with no pending action.
   */
  const canUpdateStatus = (order: OrderModel): boolean => {
    if (
      order.status !== OrderStatus.PREPARING &&
      order.status !== OrderStatus.OUT_FOR_DELIVERY
    ) return false;
    if (!currentUserId || order.driverId !== currentUserId) return false;
    return true;
  };

  /**
   * Handle driver status update (PREPARING -> OUT_FOR_DELIVERY, OUT_FOR_DELIVERY -> DELIVERED).
   * Online-only, direct API call with OCC.
   */
  const handleUpdateStatus = async (orderToUpdate: OrderModel) => {
    const nextStatus =
      orderToUpdate.status === OrderStatus.PREPARING
        ? OrderStatus.OUT_FOR_DELIVERY
        : OrderStatus.DELIVERED;
    const alertTitle =
      orderToUpdate.status === OrderStatus.PREPARING
        ? 'Mulai Antar'
        : 'Selesai diantar';
    const alertBody =
      orderToUpdate.status === OrderStatus.PREPARING
        ? 'Tandai order ini sedang dalam perjalanan?'
        : 'Tandai order ini sudah selesai diantar?';

    Alert.alert(alertTitle, alertBody, [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Ya',
        onPress: async () => {
          if (inflightStatusRef.current) return;
          if (networkMonitor.getStatus() !== 'online') {
            Alert.alert(
              'Butuh Koneksi',
              'Status hanya bisa diubah saat ada koneksi internet.',
            );
            return;
          }
          inflightStatusRef.current = true;
          try {
            const result = await updateOrderStatus(
              orderToUpdate.id,
              nextStatus,
              orderToUpdate.serverVersion,
            );
            // Tulis row dari respons server
            await database.write(async () => {
              const collection = database.get<OrderModel>('orders');
              const row = await collection.find(orderToUpdate.id);
              await database.batch(
                row.prepareUpdate((r) => {
                  r._setRaw('status', result.status);
                  r._setRaw('server_version', result.version);
                  r._setRaw('updated_at', Date.parse(result.updatedAt));
                  if (result.driverId !== undefined) {
                    r._setRaw('driver_id', result.driverId ?? '');
                  }
                  if (result.cancelledBy !== undefined) {
                    r._setRaw('cancelled_by', result.cancelledBy ?? '');
                  }
                  if (result.cancelReason !== undefined) {
                    r._setRaw('cancel_reason', result.cancelReason ?? '');
                  }
                  r._setRaw('last_conflict_reason', '');
                  r._setRaw('last_conflict_at', null);
                  r._raw._status = 'synced';
                  r._raw._changed = '';
                }),
              );
            });
          } catch (err) {
            if (err instanceof ApiError && err.status === 409) {
              Alert.alert(
                'Order sudah berubah, data diperbarui.',
                undefined,
                [{ text: 'OK' }],
              );
              // GET /orders/:id lalu tulis row dari respons
              try {
                const refreshed = await getOrderById(orderToUpdate.id);
                await database.write(async () => {
                  const collection = database.get<OrderModel>('orders');
                  const row = await collection.find(orderToUpdate.id);
                  await database.batch(
                    row.prepareUpdate((r) => {
                      r._setRaw('status', refreshed.status);
                      r._setRaw('server_version', refreshed.version);
                      r._setRaw('updated_at', Date.parse(refreshed.updatedAt));
                      if (refreshed.driverId !== undefined) {
                        r._setRaw('driver_id', refreshed.driverId ?? '');
                      }
                      if (refreshed.cancelledBy !== undefined) {
                        r._setRaw('cancelled_by', refreshed.cancelledBy ?? '');
                      }
                      if (refreshed.cancelReason !== undefined) {
                        r._setRaw('cancel_reason', refreshed.cancelReason ?? '');
                      }
                      r._setRaw('last_conflict_reason', '');
                      r._setRaw('last_conflict_at', null);
                      r._raw._status = 'synced';
                      r._raw._changed = '';
                    }),
                  );
                });
              } catch {
                // GET gagal, row tidak diubah
              }
            } else if (err instanceof ApiError && err.status === 403) {
              Alert.alert(
                'Order ini sudah tidak ditugaskan ke Anda.',
                undefined,
                [{ text: 'OK' }],
              );
            } else {
              Alert.alert('Gagal', 'Status gagal diubah. Coba lagi.');
            }
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
              // Optimistic UI: show as collected immediately
              setHasCodPayment(true);
              // hasPending datang dari observe pending_actions, jangan set manual di sini.
              // Pencegah double-tap pakai inflightCollectRef.
              // Try to drain immediately in case we're already online, the
              // coordinator's own drain only fires on an offline->online
              // transition, so an action enqueued while already online would
              // otherwise sit pending until the next real disconnect/reconnect.
              // NOTE: outbox.ts is already statically imported above (for
              // enqueueCancel/enqueueCollectCod/hasPendingAction), so there's
              // no module-load-time-WatermelonDB concern here the way there
              // is in coordinator.ts (which does NOT otherwise import outbox.ts),
              // a dynamic import isn't needed, and dynamic import() inside a
              // .tsx file isn't supported by this project's Jest config anyway
              // (throws without --experimental-vm-modules), so it would be
              // untestable here even if it worked at runtime.
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
              // hasPending datang dari observe pending_actions, jangan set manual di sini.
              // Pencegah double-tap pakai inflightCollectRef (shared dengan COD).
              // Try to drain immediately in case we're already online, the
              // coordinator's own drain only fires on an offline->online
              // transition, so an action enqueued while already online would
              // otherwise sit pending until the next real disconnect/reconnect.
              // NOTE: outbox.ts is already statically imported above (for
              // enqueueCancel/enqueueCollectCod/hasPendingAction), so there's
              // no module-load-time-WatermelonDB concern here the way there
              // is in coordinator.ts (which does NOT otherwise import outbox.ts),
              // a dynamic import isn't needed, and dynamic import() inside a
              // .tsx file isn't supported by this project's Jest config anyway
              // (throws without --experimental-vm-modules), so it would be
              // untestable here even if it worked at runtime.
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
        isDismissed={failedBannerDismissed}
        onDismiss={() => setFailedBannerDismissed(true)}
      />

      {/* Order Conflict Banner */}
      <OrderConflictBanner
        event={conflictEvent}
        onDismiss={() => setConflictEvent(null)}
      />

      {/* Last Conflict Banner (Skenario A, persisted) */}
      <LastConflictBanner
        order={order}
        isDismissed={lastConflictDismissed}
        onDismiss={() => setLastConflictDismissed(true)}
      />

      {/* Pending Action Indicator */}
      {hasPending && !isPendingStale && (
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
        <StatusBadge status={order.status} />
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

      {/* Cancel Button, only visible if driver can cancel this order and there's
          no cancel already queued (prevents re-tapping and enqueueing duplicate
          cancel actions while offline, same guard pattern as the COD button below) */}
      {order && currentUserId && canDriverCancel(order) && !hasPending && (
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => handleCancelOrder(order)}
        >
          <Text style={styles.cancelButtonText}>Batalkan Order</Text>
        </TouchableOpacity>
      )}

      {/* COD Button, only visible if driver can collect COD and no COD payment exists */}
      {order && currentUserId && canCollectCod(order) && (
        <TouchableOpacity
          style={styles.codButton}
          onPress={() => handleCollectCod(order)}
        >
          <Text style={styles.codButtonText}>Terima Cash (COD)</Text>
        </TouchableOpacity>
      )}

      {/* Driver Status Button, PREPARING -> OUT_FOR_DELIVERY or OUT_FOR_DELIVERY -> DELIVERED.
          PREPARING: always shown (no pending).
          OUT_FOR_DELIVERY: shown only if ada payment CASH yang BUKAN FAILED,
          DAN tidak ada pending action. */}
      {order && currentUserId && canUpdateStatus(order) && !hasPending &&
        (order.status === OrderStatus.PREPARING || hasCashPaymentNotFailed) && (
        <TouchableOpacity
          style={[
            styles.statusButton,
            (!isOnline || inflightStatusRef.current) && styles.statusButtonDisabled,
          ]}
          onPress={() => handleUpdateStatus(order)}
          disabled={!isOnline || inflightStatusRef.current}
        >
          <Text
            style={[
              styles.statusButtonText,
              (!isOnline || inflightStatusRef.current) && styles.statusButtonTextDisabled,
            ]}
          >
            {order.status === OrderStatus.PREPARING ? 'Mulai antar' : 'Selesai diantar'}
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
});
