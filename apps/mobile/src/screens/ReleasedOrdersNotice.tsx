/**
 * Kotak pemberitahuan di layar Order untuk order yang sudah tidak ditugaskan
 * ke driver ini dalam 24 jam terakhir, biasanya karena HP-nya lama tidak
 * tersambung. Mengetuk baris membuka OrderDetail, yang banner-nya menjelaskan
 * selengkapnya. Tombol Tutup mengosongkan last_conflict_reason dan
 * last_conflict_at, sehingga banner dan baris ini hilang.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Database } from '@nozbe/watermelondb';
import { Q } from '@nozbe/watermelondb';

import { OrderModel } from '../db/models/OrderModel';
import { Button } from '../components/Button';
import { Icon } from '../theme/Icon';
import { perTema, useTheme } from '../theme/ThemeProvider';
import { radius, size, space, stroke, type } from '../theme/tokens';

const NOTICE_TTL_MS = 24 * 60 * 60 * 1000; // 24 jam
const PADDING_ATAS = 14;
const JARAK_IKON = 10;

export interface ReleasedOrderItem {
  id: string;
  lastConflictAt: number | null;
}

export interface ReleasedOrdersNoticeProps {
  items: ReleasedOrderItem[];
  onOpen: (orderId: string) => void;
  onDismiss: (orderIds: string[]) => void;
}

const gaya = perTema((c) =>
  StyleSheet.create({
    wadah: {
      backgroundColor: c.surface,
      borderColor: c.infoLine,
      borderWidth: stroke.hairline,
      borderRadius: radius.xl2,
      paddingTop: PADDING_ATAS,
      paddingHorizontal: space[4],
      paddingBottom: space[2],
      marginHorizontal: space[4],
      marginTop: space[3],
    },
    barisJudul: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: JARAK_IKON,
    },
    judul: {
      ...type.labelMd,
      color: c.text,
    },
    barisOrder: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: size.controlSm,
      paddingLeft: 12,
      paddingRight: space[2],
      borderRadius: radius.md,
      backgroundColor: c.actionSecondary,
      marginTop: JARAK_IKON,
    },
    teksOrder: {
      ...type.bodyMdMedium,
      color: c.onActionSecondary,
    },
    keterangan: {
      ...type.bodySm,
      color: c.textMuted,
      marginTop: JARAK_IKON,
    },
    barisTombol: {
      alignItems: 'flex-end',
    },
  }),
);

/**
 * Hanya menampilkan data: `items` disiapkan OrdersScreen dari
 * releasedOrdersQuery, dan penutupan diserahkan ke `onDismiss`. Dengan begitu
 * komponen ini bisa dites dengan data biasa.
 */
export function ReleasedOrdersNotice({ items, onOpen, onDismiss }: ReleasedOrdersNoticeProps): React.JSX.Element | null {
  const { name, colors } = useTheme();
  const s = gaya[name];

  // Hanya order yang lastConflictAt-nya dalam 24 jam terakhir.
  const now = Date.now();
  const visible: ReleasedOrderItem[] = items.filter((it) => {
    if (it.lastConflictAt == null) return false;
    return now - it.lastConflictAt <= NOTICE_TTL_MS;
  });
  if (visible.length === 0) return null;

  return (
    <View style={s.wadah}>
      <View style={s.barisJudul}>
        <Icon name="info" size={size.iconMd} color={colors.info} />
        <Text style={s.judul}>Order sudah tidak ditugaskan ke Anda</Text>
      </View>
      {visible.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => onOpen(item.id)}
          accessibilityRole="button"
          style={s.barisOrder}
        >
          <Text style={s.teksOrder}>Order #{item.id.slice(0, 8)}</Text>
          <Icon name="chevron_right" size={size.iconSm} color={colors.textSubtle} />
        </Pressable>
      ))}
      <Text style={s.keterangan}>
        Biasanya karena HP Anda lama tidak tersambung. Ketuk order untuk melihat rinciannya.
      </Text>
      <View style={s.barisTombol}>
        <Button
          title="Tutup"
          onPress={() => onDismiss(visible.map((it) => it.id))}
          variant="secondary"
          size="sm"
        />
      </View>
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
