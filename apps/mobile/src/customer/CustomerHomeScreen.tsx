/**
 * Customer Home Screen (Placeholder).
 *
 * This is a placeholder screen that will be expanded in Tier 2/3 with:
 * - Order creation flow
 * - Order tracking with real-time updates
 *
 * For now, it shows a welcome message and logout functionality.
 */

import React from 'react';
import { StyleSheet, Text, View, Button } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { CustomerStackParamList } from './CustomerStack';

interface CustomerHomeScreenProps {
  onLogout: () => void;
  navigation?: NativeStackNavigationProp<CustomerStackParamList, 'CustomerHome'>;
}

export function CustomerHomeScreen({ onLogout, navigation }: CustomerHomeScreenProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Customer Home</Text>
        <Text style={styles.subtitle}>
          Order creation and tracking coming in Tier 2/3
        </Text>
        <View style={styles.spacer} />
        <Button
          title="Buat Order Baru"
          onPress={() => navigation?.navigate('OrderCreate')}
        />
        <View style={styles.buttonSpacer} />
        <Button title="Logout" onPress={onLogout} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#222',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  spacer: {
    height: 40,
  },
  buttonSpacer: {
    height: 12,
  },
});
