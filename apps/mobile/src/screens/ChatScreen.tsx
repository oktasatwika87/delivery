import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Q } from '@nozbe/watermelondb';
import { withDatabase } from '@nozbe/watermelondb/react';
import type { Database } from '@nozbe/watermelondb';

import type { RootStackParamList } from '../../App';
import { ChatMessageModel } from '../db/models/ChatMessageModel';
import { getCurrentUserId } from '../sync/session';
import { sendChatMessage } from '../sync/client';

/** Generate UUID v4 for record IDs */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'> & {
  database: Database;
};

function ChatScreenBase({ database }: Props): React.JSX.Element {
  const route = useRoute<Props['route']>();
  const { roomId } = route.params;

  const [messages, setMessages] = useState<ChatMessageModel[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  // Load current user ID
  useEffect(() => {
    getCurrentUserId().then(setCurrentUserId);
  }, []);

  // Subscribe to messages
  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    const subscribe = async () => {
      try {
        const collection = database.get<ChatMessageModel>('chat_messages');
        subscription = collection
          .query(
            Q.where('room_id', roomId),
            Q.sortBy('client_created_at', Q.asc)
          )
          .observe()
          .subscribe({
            next: (records) => {
              setMessages(records);
              setIsLoading(false);
            },
            error: (err) => {
              console.error('[Chat] observe error:', err);
              setIsLoading(false);
            },
          });
      } catch (err) {
        console.error('[Chat] setup error:', err);
        setIsLoading(false);
      }
    };

    subscribe();

    return () => {
      subscription?.unsubscribe();
    };
  }, [database, roomId]);

  const handleSend = async (): Promise<void> => {
    const text = inputText.trim();
    if (!text || !currentUserId) return;

    setInputText('');

    const clientCreatedAt = Date.now();

    // 1. Create local record (offline-first) — save reference directly
    let localRecord: ChatMessageModel | null = null;
    try {
      await database.write(async () => {
        localRecord = await database.get<ChatMessageModel>('chat_messages').create((msg) => {
          // Set id via _raw because msg.id is readonly in WatermelonDB Model
          // UUID required for sync with Postgres
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (msg._raw as any).id = generateUUID();
          msg.roomId = roomId;
          msg.senderId = currentUserId;
          msg.body = text;
          msg.status = 'PENDING_SEND';
          msg.clientCreatedAt = clientCreatedAt;
          msg.serverVersion = 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          msg._raw._status = 'created'; // Mark as dirty for sync
        });
      });

      // Scroll to bottom after adding message
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);

      // 2. Try to send via REST
      try {
        const response = await sendChatMessage({
          roomId,
          body: text,
          clientCreatedAt: new Date(clientCreatedAt).toISOString(),
        });

        // 3. Update local record with server response — use saved reference
        if (localRecord) {
          await database.write(async () => {
            await localRecord!.update((m) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              m._raw._status = 'synced'; // Clear dirty flag
              m.status = 'SENT';
              m.serverVersion = response.version;
            });
          });
        }
      } catch (err) {
        // REST failed — message stays as PENDING_SEND, will be picked up by sync coordinator
        console.warn('[Chat] sendChatMessage failed, will retry via sync:', err);
      }
    } catch (err) {
      console.error('[Chat] Failed to create local message:', err);
    }
  };

  const renderMessage = ({ item }: { item: ChatMessageModel }): React.JSX.Element => {
    const isOwn = item.senderId === currentUserId;
    const time = new Date(item.clientCreatedAt);
    const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;

    return (
      <View style={[styles.messageRow, isOwn ? styles.ownMessageRow : styles.otherMessageRow]}>
        <View style={[styles.messageBubble, isOwn ? styles.ownBubble : styles.otherBubble]}>
          <Text style={[styles.messageText, isOwn ? styles.ownMessageText : styles.otherMessageText]}>
            {item.body}
          </Text>
          <View style={styles.messageFooter}>
            <Text style={[styles.timestamp, isOwn ? styles.ownTimestamp : styles.otherTimestamp]}>
              {timeStr}
            </Text>
            {isOwn && (
              <Text style={[
                styles.statusText,
                item.status === 'PENDING_SEND' ? styles.pendingStatus : styles.sentStatus,
              ]}>
                {item.status === 'PENDING_SEND' ? '·mengirim...' : '·terkirim'}
              </Text>
            )}
          </View>
        </View>
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <Text style={styles.loadingText}>Memuat pesan...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Belum ada pesan.</Text>
            <Text style={styles.emptySubtext}>Mulai percakapan dengan mengirim pesan.</Text>
          </View>
        }
      />

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.textInput}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Ketik pesan..."
          placeholderTextColor="#9ca3af"
          multiline
          maxLength={1000}
        />
        <TouchableOpacity
          style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim()}
        >
          <Text style={styles.sendButtonText}>Kirim</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const enhance = withDatabase(ChatScreenBase);

export { enhance as ChatScreen };

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#6b7280',
  },
  messageList: {
    padding: 12,
    flexGrow: 1,
  },
  messageRow: {
    marginVertical: 4,
    maxWidth: '80%',
  },
  ownMessageRow: {
    alignSelf: 'flex-end',
  },
  otherMessageRow: {
    alignSelf: 'flex-start',
  },
  messageBubble: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    maxWidth: '100%',
  },
  ownBubble: {
    backgroundColor: '#2563eb',
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 20,
  },
  ownMessageText: {
    color: '#fff',
  },
  otherMessageText: {
    color: '#111827',
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  timestamp: {
    fontSize: 11,
  },
  ownTimestamp: {
    color: 'rgba(255,255,255,0.7)',
  },
  otherTimestamp: {
    color: '#9ca3af',
  },
  statusText: {
    fontSize: 11,
    marginLeft: 4,
  },
  pendingStatus: {
    color: 'rgba(255,255,255,0.5)',
    fontStyle: 'italic',
  },
  sentStatus: {
    color: 'rgba(255,255,255,0.85)',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 8,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#f9fafb',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
    color: '#111827',
  },
  sendButton: {
    backgroundColor: '#2563eb',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginLeft: 8,
  },
  sendButtonDisabled: {
    backgroundColor: '#9ca3af',
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
});
