/**
 * Kotak pemberitahuan di layar Order untuk order yang sudah tidak ditugaskan
 * ke driver ini dalam 24 jam terakhir, biasanya karena HP-nya lama tidak
 * tersambung. Mengetuk baris membuka OrderDetail, yang banner-nya menjelaskan
 * selengkapnya. Tombol Tutup mengosongkan last_conflict_reason dan
 * last_conflict_at, sehingga banner dan baris ini hilang.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Database } from '@nozbe/watermelondb';
import { Q } from '@nozbe/watermelondb';

import { OrderModel } from '../db/models/OrderModel';

const NOTICE_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam

export interface ReleasedOrderItem {
  id: string;
  lastConflictAt: number | null;
}

export interface ReleasedOrdersNoticeProps {
  items: ReleasedOrderItem[];
  onOpen: (orderId: string) => void;
  onDismiss: (orderIds: string[]) => void;
}

/**
 * Hanya menampilkan data: `items` disiapkan OrdersScreen dari
 * releasedOrdersQuery, dan penutupan diserahkan ke `onDismiss`. Dengan begitu
 * komponen ini bisa dites dengan data biasa.
 */
export function ReleasedOrdersNotice({ items, onOpen, onDismiss }: ReleasedOrdersNoticeProps): React.JSX.Element | null {
  // Hanya order yang lastConflictAt-nya dalam 24 jam terakhir.
  const now = Date.now();
  const visible: ReleasedOrderItem[] = items.filter((it) => {
    if (it.lastConflictAt == null) return false;
    return now - it.lastConflictAt <= NOTICE_TTL_MS;
  });
  if (visible.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Order sudah tidak ditugaskan ke Anda</Text>
      {visible.map((item) => (
        <TouchableOpacity
          key={item.id}
          onPress={() => onOpen(item.id)}
          style={styles.row}
        >
          <Text style={styles.rowText}>Order #{item.id.slice(0, 8)}</Text>
        </TouchableOpacity>
      ))}
      <Text style={styles.hint}>
        Biasanya karena HP Anda lama tidak tersambung. Ketuk order untuk melihat rinciannya.
      </Text>
      <TouchableOpacity
        onPress={() => onDismiss(visible.map((it) => it.id))}
        style={styles.dismissButton}
      >
        <Text style={styles.dismissButtonText}>Tutup</Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * Mengosongkan last_conflict_reason dan last_conflict_at beberapa baris
 * sekaligus, dalam satu database.write. Id yang barisnya tidak ada dilewati.
 */
export async function dismissReleasedOrders(
  database: Database,
  orderIds: string[],
): Promise<void> {
  if (orderIds.length === 0) return;
  await database.write(async () => {
    const collection = database.get<OrderModel>('orders');
    const rows: OrderModel[] = [];
    for (const orderId of orderIds) {
      const row = await collection.find(orderId).catch(() => null);
      if (!row) continue;
      rows.push(row);
    }
    if (rows.length === 0) return;
    await database.batch(
      ...rows.map((row) =>
        row.prepareUpdate((r) => {
          r._setRaw('last_conflict_reason', null);
          r._setRaw('last_conflict_at', null);
          r._raw._status = 'synced';
          r._raw._changed = '';
        }),
      ),
    );
  });
}

/**
 * Baris orders dengan driver_id null, deleted_at kosong, dan
 * last_conflict_reason 'released' atau 'reassigned', untuk
 * ReleasedOrdersNotice lewat withObservables di OrdersScreen. Id akun yang
 * login tidak dipakai di syarat, karena baris lepas sudah tidak punya
 * driver_id.
 */
export function releasedOrdersQuery(database: Database) {
  return database
    .get<OrderModel>('orders')
    .query(
      Q.where('driver_id', null),
      Q.where('deleted_at', null),
      Q.where('last_conflict_reason', Q.oneOf(['released', 'reassigned'])),
    )
    .observeWithColumns(['last_conflict_reason', 'last_conflict_at']);
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 12,
  },
  title: {
    fontWeight: '700',
    color: '#92400e',
    marginBottom: 8,
  },
  row: {
    paddingVertical: 6,
  },
  rowText: {
    fontSize: 15,
    color: '#374151',
    fontWeight: '500',
  },
  hint: {
    fontSize: 13,
    color: '#78350f',
    marginTop: 8,
  },
  dismissButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 6,
  },
  dismissButtonText: {
    color: '#92400e',
    fontWeight: '600',
  },
});
