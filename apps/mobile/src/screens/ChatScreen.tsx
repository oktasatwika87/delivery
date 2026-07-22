import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../App';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

export function ChatScreen({ route }: Props): React.JSX.Element {
  const { roomId } = route.params;
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Room {roomId.slice(0, 8)}</Text>
      <Text style={styles.muted}>Chat list — observe chat_messages by roomId</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: '600' },
  muted: { color: '#71717a', marginTop: 8 },
});