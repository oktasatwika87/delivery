import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Q } from '@nozbe/watermelondb';
import { useDatabase } from '@nozbe/watermelondb/hooks';
import { withObservables } from '@nozbe/watermelondb/react';

import { OrderModel } from '../db/models/OrderModel';

interface Props {
  orders: OrderModel[];
}

function OrdersScreenBase({ orders }: Props): React.JSX.Element {
  return (
    <FlatList
      data={orders}
      keyExtractor={(o) => o.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.card}>
          <Text style={styles.cardTitle}>Order #{item.id.slice(0, 8)}</Text>
          <Text style={styles.cardMeta}>
            {item.status} · {item.totalCents} {item.currency}
          </Text>
        </TouchableOpacity>
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text>Belum ada order.</Text>
        </View>
      }
    />
  );
}

const enhance = withObservables([], () => ({
  orders: useDatabase()
    .get<OrderModel>('orders')
    .query(Q.where('deleted_at', Q.eq(null)), Q.sortBy('created_at', Q.desc)),
}));

export const OrdersScreen = enhance(OrdersScreenBase);

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  card: { padding: 16, borderRadius: 8, backgroundColor: '#f4f4f5' },
  cardTitle: { fontWeight: '600', fontSize: 16 },
  cardMeta: { marginTop: 4, color: '#71717a' },
  empty: { padding: 32, alignItems: 'center' },
});