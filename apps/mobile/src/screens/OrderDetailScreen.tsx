import React, { useEffect, useState } from 'react';
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
import { withDatabase } from '@nozbe/watermelondb/react';
import type { Database } from '@nozbe/watermelondb';

import type { RootStackParamList } from '../../App';
import { OrderModel } from '../db/models/OrderModel';
import { PaymentModel } from '../db/models/PaymentModel';
import { getCurrentUserId } from '../sync/session';
import { generateCodIdempotencyKey } from '../sync/idempotency';
import { OrderStatus, PaymentMethod, PaymentStatus } from '@delivery/shared';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ItemRow {
  name: string;
  quantity: number;
  priceCents: number;
}

interface AddressData {
  street?: string;
  city?: string;
  notes?: string;
}

interface Props {
  database: Database;
}

// ─── Status Badge ───────────────────────────────────────────────────────────

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

// ─── Item Row ───────────────────────────────────────────────────────────────

function ItemRow({ item }: { item: ItemRow }): React.JSX.Element {
  return (
    <View style={styles.itemRow}>
      <Text style={styles.itemName}>
        {item.quantity}x {item.name}
      </Text>
      <Text style={styles.itemPrice}>
        {formatCurrency(item.priceCents * item.quantity, 'IDR')}
      </Text>
    </View>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(cents: number, currency: string): string {
  const amount = cents / 100;
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(amount);
}

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

// ─── Base Component ─────────────────────────────────────────────────────────

function OrderDetailBase({ database }: Props): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'OrderDetail'>>();
  const route = useRoute<NativeStackScreenProps<RootStackParamList, 'OrderDetail'>['route']>();

  const { orderId } = route.params;
  const [order, setOrder] = useState<OrderModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [hasCodPayment, setHasCodPayment] = useState(false);

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

  // Check if COD payment already exists for this order
  useEffect(() => {
    if (!orderId) return;

    const checkCodPayment = async () => {
      try {
        const paymentsCollection = database.get<PaymentModel>('payments');
        const payments = await paymentsCollection
          .query()
          .fetch();

        const hasCod = payments.some(
          (p) => p.orderId === orderId && p.method === PaymentMethod.CASH,
        );
        setHasCodPayment(hasCod);
      } catch (err) {
        console.warn('[OrderDetail] failed to check COD payment:', err);
      }
    };

    checkCodPayment();
  }, [database, orderId]);

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
   * Handle COD collection.
   * Writes a CAPTURED payment locally to WatermelonDB.
   * SyncCoordinator will pick up the dirty record and push to server.
   */
  const handleCollectCod = async (orderToCollect: OrderModel) => {
    const amount = formatCurrency(orderToCollect.totalCents, orderToCollect.currency);
    Alert.alert(
      'Terima Cash (COD)',
      `Kumpulkan payment cash Rp ${amount} dari customer?`,
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Ya, Terima',
          onPress: async () => {
            try {
              const idempotencyKey = await generateCodIdempotencyKey(orderToCollect.id);
              const paymentsCollection = database.get<PaymentModel>('payments');
              await database.write(async () => {
                await paymentsCollection.create((record) => {
                  record.orderId = orderToCollect.id;
                  record.idempotencyKey = idempotencyKey;
                  record.method = PaymentMethod.CASH;
                  record.status = PaymentStatus.CAPTURED;
                  record.amountCents = orderToCollect.totalCents;
                  record.currency = orderToCollect.currency;
                  record.kind = 'PAYMENT';
                  record.failedSyncAttempts = 0;
                });
              });
              setHasCodPayment(true);
            } catch (err) {
              console.error('[OrderDetail] failed to record COD:', err);
              Alert.alert('Gagal', 'Tidak bisa mencatat payment. Coba lagi.');
            }
          },
        },
      ],
    );
  };

  /**
   * Handle cancel order action.
   * Writes CANCELLED status locally to WatermelonDB.
   * SyncCoordinator will pick up the dirty record and push to server.
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
              await database.write(async () => {
                await orderToCancel.update((record) => {
                  record.status = OrderStatus.CANCELLED;
                  record.cancelledBy = currentUserId ?? undefined;
                });
              });
            } catch (err) {
              console.error('[OrderDetail] failed to cancel order:', err);
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

      {/* Chat Button */}
      <TouchableOpacity
        style={styles.chatButton}
        onPress={() => navigation.navigate('Chat', { roomId: order.id })}
      >
        <Text style={styles.chatButtonText}>Chat dengan Kurir / Customer</Text>
      </TouchableOpacity>

      {/* Map Button */}
      <TouchableOpacity
        style={styles.mapButton}
        onPress={() => navigation.navigate('Map', { orderId: order.id })}
      >
        <Text style={styles.mapButtonText}>Lihat Rute Pengiriman</Text>
      </TouchableOpacity>

      {/* Cancel Button — only visible if driver can cancel this order */}
      {order && currentUserId && canDriverCancel(order) && (
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={() => handleCancelOrder(order)}
        >
          <Text style={styles.cancelButtonText}>Batalkan Order</Text>
        </TouchableOpacity>
      )}

      {/* COD Button — only visible if driver can collect COD and no COD payment exists */}
      {order && currentUserId && canCollectCod(order) && (
        <TouchableOpacity
          style={styles.codButton}
          onPress={() => handleCollectCod(order)}
        >
          <Text style={styles.codButtonText}>Terima Cash (COD)</Text>
        </TouchableOpacity>
      )}

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

// ─── Enhanced with Database ─────────────────────────────────────────────────

const enhance = withDatabase(OrderDetailBase);

export { enhance as OrderDetailScreen };

// ─── Styles ─────────────────────────────────────────────────────────────────

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
});
