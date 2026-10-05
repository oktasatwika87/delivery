/**
 * Customer Navigation Stack.
 *
 * Navigation stack for customer users. Contains screens for:
 * - CustomerHomeScreen
 * - OrderCreateScreen (Tier 2)
 * - OrderTrackingScreen (Tier 3)
 *
 * This stack is rendered when `role === 'CUSTOMER'` in App.tsx.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CustomerHomeScreen } from './CustomerHomeScreen';
import { OrderCreateScreen } from './OrderCreateScreen';
import { OrderTrackingScreen } from './OrderTrackingScreen';
import { ChatScreen } from '../screens/ChatScreen';

export type CustomerStackParamList = {
  CustomerHome: undefined;
  OrderCreate: undefined;
  OrderTracking: { orderId: string };
  Chat: { roomId: string };
};

const Stack = createNativeStackNavigator<CustomerStackParamList>();

interface CustomerStackProps {
  onLogout: () => void;
}

export function CustomerStack({ onLogout }: CustomerStackProps): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="CustomerHome">
        {({ navigation }) => (
          <CustomerHomeScreen onLogout={onLogout} navigation={navigation} />
        )}
      </Stack.Screen>
      <Stack.Screen name="OrderCreate">
        {({ navigation }) => (
          <OrderCreateScreen
            onBack={() => navigation.goBack()}
            onCreateSuccess={(orderId) =>
              navigation.replace('OrderTracking', { orderId })
            }
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="OrderTracking">
        {({ navigation, route }) => (
          <OrderTrackingScreen
            orderId={route.params.orderId}
            onBack={() => navigation.goBack()}
            onOpenChat={(roomId) => navigation.navigate('Chat', { roomId })}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="Chat" component={ChatScreen} />
    </Stack.Navigator>
  );
}
