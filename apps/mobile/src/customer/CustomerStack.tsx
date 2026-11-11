/**
 * Customer Navigation Stack.
 *
 * Navigation stack for customer users. Contains screens for:
 * - CustomerHomeScreen
 * - OrderCreateScreen
 * - OrderTrackingScreen
 *
 * This stack is rendered when `role === 'CUSTOMER'` in App.tsx.
 */

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CustomerHomeScreen } from './CustomerHomeScreen';
import { OrderCreateScreen } from './OrderCreateScreen';
import { OrderTrackingScreen } from './OrderTrackingScreen';
import { ChatScreen } from '../screens/ChatScreen';
import {
  InitialWindowProvider,
  withInitialWindow,
} from '../components/motion/InitialWindow';

export type CustomerStackParamList = {
  CustomerHome: undefined;
  OrderCreate: undefined;
  OrderTracking: { orderId: string };
  Chat: { roomId: string };
};

const Stack = createNativeStackNavigator<CustomerStackParamList>();

// Pembungkus layar dibuat sekali di tingkat modul.
const ChatDenganJendela = withInitialWindow(ChatScreen);

interface CustomerStackProps {
  onLogout: () => void;
}

export function CustomerStack({ onLogout }: CustomerStackProps): React.JSX.Element {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="CustomerHome">
        {({ navigation }) => (
          <InitialWindowProvider>
            <CustomerHomeScreen onLogout={onLogout} navigation={navigation} />
          </InitialWindowProvider>
        )}
      </Stack.Screen>
      <Stack.Screen name="OrderCreate">
        {({ navigation }) => (
          <InitialWindowProvider>
            <OrderCreateScreen
              onBack={() => navigation.goBack()}
              onCreateSuccess={(orderId) =>
                navigation.replace('OrderTracking', { orderId })
              }
            />
          </InitialWindowProvider>
        )}
      </Stack.Screen>
      <Stack.Screen name="OrderTracking">
        {({ navigation, route }) => (
          <InitialWindowProvider>
            <OrderTrackingScreen
              orderId={route.params.orderId}
              onBack={() => navigation.goBack()}
              onOpenChat={(roomId) => navigation.navigate('Chat', { roomId })}
            />
          </InitialWindowProvider>
        )}
      </Stack.Screen>
      <Stack.Screen name="Chat" component={ChatDenganJendela} />
    </Stack.Navigator>
  );
}
