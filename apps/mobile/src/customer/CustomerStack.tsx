/**
 * Customer Navigation Stack.
 *
 * Navigation stack for customer users. Contains screens for:
 * - CustomerHomeScreen (placeholder for now)
 *
 * This stack is rendered when `role === 'CUSTOMER'` in App.tsx.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CustomerHomeScreen } from './CustomerHomeScreen';

export type CustomerStackParamList = {
  CustomerHome: undefined;
};

const Stack = createNativeStackNavigator<CustomerStackParamList>();

interface CustomerStackProps {
  onLogout: () => void;
}

export function CustomerStack({ onLogout }: CustomerStackProps): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="CustomerHome">
        {() => <CustomerHomeScreen onLogout={onLogout} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
