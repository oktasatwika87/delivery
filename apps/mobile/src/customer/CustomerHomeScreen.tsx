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

interface CustomerHomeScreenProps {
  onLogout: () => void;
}

export function CustomerHomeScreen({ onLogout }: CustomerHomeScreenProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Customer Home</Text>
        <Text style={styles.subtitle}>
          Order creation and tracking coming in Tier 2/3
        </Text>
        <View style={styles.spacer} />
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
});
