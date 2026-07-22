import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'OrderDetail'>;

export function OrderDetailScreen({ route }: Props): React.JSX.Element {
  const { orderId } = route.params;
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Order {orderId.slice(0, 8)}</Text>
      <Text style={styles.muted}>Detail view — hubungkan ke OrderModel.observe()</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8 },
  title: { fontSize: 20, fontWeight: '600' },
  muted: { color: '#71717a' },
});