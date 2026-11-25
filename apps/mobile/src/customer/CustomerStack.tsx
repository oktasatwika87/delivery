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
import { Platform } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import { useReducedMotion } from 'react-native-reanimated';

import { CustomerHomeScreen } from './CustomerHomeScreen';
import { OrderCreateScreen } from './OrderCreateScreen';
import { OrderTrackingScreen } from './OrderTrackingScreen';
import { ChatScreen } from '../screens/ChatScreen';
import {
  InitialWindowProvider,
  withInitialWindow,
} from '../components/motion/InitialWindow';
import { animasiTumpukan } from '../components/motion/animasiTumpukan';
import { TEMA_CUSTOMER, ThemeProvider } from '../theme/ThemeProvider';

export type CustomerStackParamList = {
  CustomerHome: undefined;
  OrderCreate: undefined;
  OrderTracking: { orderId: string };
  Chat: { roomId: string };
};

const Stack = createNativeStackNavigator<CustomerStackParamList>();

// Pembungkus layar dibuat sekali di tingkat modul.
const ChatDenganJendela = withInitialWindow(ChatScreen);

type PropsStatusOrder = NativeStackScreenProps<
  CustomerStackParamList,
  'OrderTracking'
>;

/**
 * Layar status order.
 *
 * Layar ini memakai tema terang, jadi isinya perlu dibungkus sendiri.
 * Jendela awal dibuat di dalam layar status order, jadi dihitung dari isi
 * pertamanya.
 */
function LayarStatusOrder({
  navigation,
  route,
}: PropsStatusOrder): React.JSX.Element {
  const terlihat = useIsFocused();

  return (
    <ThemeProvider name={TEMA_CUSTOMER}>
      <OrderTrackingScreen
        orderId={route.params.orderId}
        terlihat={terlihat}
        onBack={() => navigation.goBack()}
        onOpenChat={(roomId) => navigation.navigate('Chat', { roomId })}
      />
    </ThemeProvider>
  );
}

interface CustomerStackProps {
  onLogout: () => void;
}

export function CustomerStack({ onLogout }: CustomerStackProps): React.JSX.Element {
  const kurangiGerak = useReducedMotion();

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: animasiTumpukan(kurangiGerak, Platform.OS),
      }}
    >
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
      <Stack.Screen name="OrderTracking" component={LayarStatusOrder} />
      <Stack.Screen name="Chat" component={ChatDenganJendela} />
    </Stack.Navigator>
  );
}
