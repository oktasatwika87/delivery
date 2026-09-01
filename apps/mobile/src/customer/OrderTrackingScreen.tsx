/**
 * Order Tracking Screen.
 *
 * Customer-side real-time order tracking. Lifecycle:
 *   1. Mount → fetch order state via GET /orders/:id (initial state)
 *   2. Subscribe OrdersSocketManager untuk event order:accepted/rejected/cancelled
 *   3. Display status, items, address, notes + connection banner
 *   4. Cleanup: unsubscribe semua listeners saat unmount
 *
 * Online-only — sesuai dengan Tier 2 OrderCreateScreen (online POST, no local DB).
 * Socket sudah connect di App.tsx saat customer login; tracking screen cuma
 * subscribe listener untuk orderId yang lagi dibuka.
 *
 * Status updates live (tanpa refresh manual):
 *   - order:accepted → status PREPARING + driverId dari payload
 *   - order:rejected → status CONFIRMED + driverId direset (order bisa
 *     di-assign ulang — lihat fix di orders.service.ts rejectOrder(),
 *     sebelumnya keliru CANCELLED, sudah dibetulkan)
 *   - order:cancelled → status CONFIRMED + cancelReason
 *
 * Connection banner muncul saat socket disconnect (network drop / airplane
 * mode / background). State order TIDAK hilang — banner hanya indikator.
 * Pattern paralel dengan OrderConflictBanner di OrderDetailScreen.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { Order, OrderStatus } from '@delivery/shared';

import { getOrderById, UnauthorizedError } from '../sync/client';
import { ordersSocket } from '../sync/ordersSocket';
import { syncEvents } from '../sync/syncEvents';

interface OrderTrackingScreenProps {
  orderId: string;
  onBack: () => void;
}

const STATUS_COLORS: Record<OrderStatus, { bg: string; text: string }> = {
  PENDING: { bg: '#fef3c7', text: '#92400e' },
  CONFIRMED: { bg: '#dbeafe', text: '#1e40af' },
  ASSIGNED: { bg: '#e0e7ff', text: '#3730a3' },
  PREPARING: { bg: '#ede9fe', text: '#5b21b6' },
  OUT_FOR_DELIVERY: { bg: '#fed7aa', text: '#c2410c' },
  DELIVERED: { bg: '#d1fae5', text: '#065f46' },
  CANCELLED: { bg: '#fee2e2', text: '#991b1b' },
};

const STATUS_DISPLAY: Record<OrderStatus, string> = {
  PENDING: 'Menunggu konfirmasi',
  CONFIRMED: 'Dikonfirmasi, mencari driver...',
  ASSIGNED: 'Driver ditugaskan',
  PREPARING: 'Driver sedang menyiapkan',
  OUT_FOR_DELIVERY: 'Dalam perjalanan',
  DELIVERED: 'Terkirim',
  CANCELLED: 'Dibatalkan',
};

function StatusBadge({ status }: { status: OrderStatus }): React.JSX.Element {
  const colors = STATUS_COLORS[status] ?? { bg: '#f3f4f6', text: '#374151' };
  const display = STATUS_DISPLAY[status] ?? status.replace('_', ' ');
  return (
    <View style={[styles.badge, { backgroundColor: colors.bg }]}>
      <Text style={[styles.badgeText, { color: colors.text }]}>{display}</Text>
    </View>
  );
}

function formatCurrency(cents: number, currency: string): string {
  const amount = cents / 100;
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(amount);
}

export function OrderTrackingScreen({
  orderId,
  onBack,
}: OrderTrackingScreenProps): React.JSX.Element {
  const [order, setOrder] = useState<Order | null>(null);
  const [connected, setConnected] = useState(ordersSocket.isConnected);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTrigger, setRetryTrigger] = useState(0);

  const unsubRef = useRef<Array<() => void>>([]);

  // ─── Initial fetch + socket subscriptions ──────────────────────────────
  useEffect(() => {
    let cancelled = false;

    // Initial fetch dari REST
    (async () => {
      try {
        const fetched = await getOrderById(orderId);
        if (!cancelled) {
          setOrder(fetched);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof UnauthorizedError) {
          // Session expired → trigger logout flow di App.tsx
          syncEvents.emit('auth-expired', { source: 'tracking-fetch' });
          return;
        }
        const message =
          err instanceof Error ? err.message : 'Gagal mengambil data order';
        setError(message);
        setLoading(false);
      }
    })();

    // Filter: hanya update kalau payload untuk order ini
    // (room customerId mungkin deliver event dari order lain di future)
    const matchesOrder = <T extends { orderId: string }>(payload: T): boolean =>
      payload.orderId === orderId;

    const unsubAccepted = ordersSocket.onOrderAccepted((payload) => {
      if (!matchesOrder(payload)) return;
      setOrder(
        (prev) =>
          (prev && {
            ...prev,
            status: 'PREPARING' as OrderStatus,
            driverId: payload.driverId,
            version: payload.version,
          }) ||
          prev,
      );
    });

    const unsubRejected = ordersSocket.onOrderRejected((payload) => {
      if (!matchesOrder(payload)) return;
      setOrder(
        (prev) =>
          (prev && {
            ...prev,
            // FIX (2026-09): reject sekarang balik ke CONFIRMED (reassign-able),
            // bukan CANCELLED (terminal) — lihat orders.service.ts rejectOrder().
            // driverId direset sama seperti onOrderCancelled di bawah.
            status: 'CONFIRMED' as OrderStatus,
            driverId: undefined,
            version: payload.version,
          }) ||
          prev,
      );
    });

    const unsubCancelled = ordersSocket.onOrderCancelled((payload) => {
      if (!matchesOrder(payload)) return;
      setOrder(
        (prev) =>
          (prev && {
            ...prev,
            status: 'CONFIRMED' as OrderStatus,
            driverId: undefined,
            cancelReason: payload.reason,
            version: payload.version,
          }) ||
          prev,
      );
    });

    const unsubConnect = ordersSocket.on('connect', () => setConnected(true));
    const unsubDisconnect = ordersSocket.on('disconnect', () =>
      setConnected(false),
    );

    unsubRef.current = [
      unsubAccepted,
      unsubRejected,
      unsubCancelled,
      unsubConnect,
      unsubDisconnect,
    ];

    return () => {
      cancelled = true;
      unsubRef.current.forEach((u) => u());
      unsubRef.current = [];
    };
  }, [orderId, retryTrigger]);

  // ─── Loading state ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingText}>Memuat order...</Text>
      </View>
    );
  }

  // ─── Error state ───────────────────────────────────────────────────────
  if (error) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorTitle}>Gagal memuat order</Text>
        <Text style={styles.errorText}>{error}</Text>
        <Button
          title="Coba Lagi"
          onPress={() => {
            setLoading(true);
            setError(null);
            setRetryTrigger((c) => c + 1);
          }}
        />
        <Button title="Kembali" onPress={onBack} color="#666" />
      </View>
    );
  }

  if (!order) {
    // Defensive — should never reach because loading/error branches cover all
    return (
      <View style={[styles.container, styles.center]}>
        <Text>Order tidak ditemukan</Text>
        <Button title="Kembali" onPress={onBack} />
      </View>
    );
  }

  // ─── Main render ───────────────────────────────────────────────────────
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {!connected && (
        <View style={styles.banner} testID="connection-banner">
          <Text style={styles.bannerText}>
            Koneksi terputus, mencoba reconnect...
          </Text>
        </View>
      )}

      <Text style={styles.title}>Order #{order.id.slice(0, 8).toUpperCase()}</Text>

      <View style={styles.statusSection}>
        <Text style={styles.statusLabel}>Status:</Text>
        <StatusBadge status={order.status} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Detail Pengiriman</Text>
        <Text style={styles.value}>{order.deliveryAddress.recipientName}</Text>
        <Text style={styles.value}>{order.deliveryAddress.phone}</Text>
        <Text style={styles.value}>{order.deliveryAddress.street}</Text>
        <Text style={styles.value}>
          {order.deliveryAddress.city}, {order.deliveryAddress.postalCode}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Barang</Text>
        {order.items.map((item, idx) => (
          <View key={`${item.productId}-${idx}`} style={styles.itemRow}>
            <Text style={styles.itemName}>
              {item.quantity}x {item.name}
            </Text>
            <Text style={styles.itemPrice}>
              {formatCurrency(item.unitPriceCents * item.quantity, order.currency)}
            </Text>
          </View>
        ))}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>
            {formatCurrency(order.totalCents, order.currency)}
          </Text>
        </View>
      </View>

      {order.notes && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Catatan</Text>
          <Text style={styles.value}>{order.notes}</Text>
        </View>
      )}

      {order.cancelReason && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Alasan Pembatalan</Text>
          <Text style={styles.value}>{order.cancelReason}</Text>
        </View>
      )}

      <View style={styles.backButtonContainer}>
        <Button title="Kembali" onPress={onBack} color="#666" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    padding: 24,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    color: '#666',
  },
  banner: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  bannerText: {
    color: '#92400e',
    fontSize: 14,
    textAlign: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#222',
    marginBottom: 16,
    textAlign: 'center',
  },
  statusSection: {
    alignItems: 'center',
    marginBottom: 24,
  },
  statusLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  badge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
  },
  badgeText: {
    fontSize: 16,
    fontWeight: '600',
  },
  section: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  value: {
    fontSize: 14,
    color: '#222',
    marginBottom: 4,
  },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  itemName: {
    flex: 1,
    fontSize: 14,
    color: '#222',
  },
  itemPrice: {
    fontSize: 14,
    color: '#666',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#222',
  },
  totalValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#222',
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#991b1b',
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
  },
  backButtonContainer: {
    marginTop: 8,
  },
});