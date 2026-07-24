import React, { useEffect, useState } from 'react';
import {
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
