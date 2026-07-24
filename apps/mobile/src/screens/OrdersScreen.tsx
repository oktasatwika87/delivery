import React from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Q } from '@nozbe/watermelondb';
import { withDatabase, withObservables } from '@nozbe/watermelondb/react';
import type { Database } from '@nozbe/watermelondb';

import type { RootStackParamList } from '../../App';
import { OrderModel } from '../db/models/OrderModel';

interface Props {
  orders: OrderModel[];
}

function OrdersScreenBase({ orders }: Props): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList, 'Orders'>>();

  return (
    <FlatList
      data={orders}
      keyExtractor={(o) => o.id}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.card}
          onPress={() => navigation.navigate('OrderDetail', { orderId: item.id })}
        >
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

// withObservables(triggerProps, getObservables) RETURNS a function that accepts a component
// Then withDatabase wraps the resulting enhanced component
const enhance = withDatabase(
  withObservables<{ database: Database }, Props>([], ({ database }) => ({
    // @ts-expect-error WatermelonDB HOC generic inference: withObservables expects
    // Observable<T> in return but component prop type declares T[]
    orders: database
      .get<OrderModel>('orders')
      .query(
        Q.where('deleted_at', Q.eq(null)),
        Q.sortBy('created_at', Q.desc)
      )
      .observe(),
  }))(OrdersScreenBase)  // <-- Apply component HERE
);

export const OrdersScreen = enhance;

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  card: { padding: 16, borderRadius: 8, backgroundColor: '#f4f4f5' },
  cardTitle: { fontWeight: '600', fontSize: 16 },
  cardMeta: { marginTop: 4, color: '#71717a' },
  empty: { padding: 32, alignItems: 'center' },
});
