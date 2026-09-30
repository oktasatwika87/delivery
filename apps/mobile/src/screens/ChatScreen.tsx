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
import { chatSocket } from '../sync/socket';
import type { ChatMessage } from '@delivery/shared';

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
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [renderKey, setRenderKey] = useState(0); // increments to force FlatList re-render on observe emit
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
              // Increment renderKey so FlatList re-renders even if the array
              // reference is unchanged (WatermelonDB observe mutates in-place).
              setRenderKey((k) => k + 1);
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

  // Socket lifecycle — connect & join room, leave on cleanup
  useEffect(() => {
    let unsubNewMessage: (() => void) | null = null;
    let unsubConnect: (() => void) | null = null;
    let unsubDisconnect: (() => void) | null = null;
    let unsubConnectError: (() => void) | null = null;
    let joined = false;
    // Penjaga unmount: kalau layar ditutup sebelum connect/join_room,
    // semua langkah setelah titik itu dilewati supaya tidak emit join_room
    // atau subscribe ke socket yang tidak lagi relevan.
    let cancelled = false;

    const setupSocket = async () => {
      // Subscribe to connection status changes
      unsubConnect = chatSocket.on('connect', () => {
        console.info('[Chat] socket connected');
        setIsSocketConnected(true);
        // Kalau sudah join sebelumnya dan socket nyambung lagi (reconnect),
        // kirim ulang join_room supaya server tahu kita masih di room ini.
        if (joined) {
          chatSocket.emitToServer('join_room', { roomId });
        }
      });

      unsubDisconnect = chatSocket.on('disconnect', (reason) => {
        console.warn('[Chat] socket disconnected:', reason);
        setIsSocketConnected(false);
      });

      unsubConnectError = chatSocket.on('connect_error', (error) => {
        console.error('[Chat] socket connect_error:', error);
        setIsSocketConnected(false);
      });

      // Connect if not already connected
      if (!chatSocket.isConnected) {
        try {
          await chatSocket.connect();
        } catch (err) {
          console.warn('[Chat] socket connect failed:', err);
          return;
        }
      }

      // Layar sudah ditutup selagi menunggu connect, jadi emit dan subscribe
      // setelah titik ini tidak dijalankan.
      if (cancelled) return;

      // Join room
      try {
        const ack = await new Promise<{ success: boolean; error?: string }>((resolve) => {
          chatSocket.emitToServer('join_room', { roomId }, (response: { success: boolean; error?: string }) => {
            resolve(response);
          });
        });
        if (ack.success) {
          joined = true;
        } else {
          console.warn('[Chat] join_room failed:', ack.error);
        }
      } catch (err) {
        console.warn('[Chat] join_room error:', err);
      }

      // Subscribe to new_message events
      unsubNewMessage = chatSocket.on<ChatMessage>('new_message', async (message) => {
        // Only process if message belongs to this room
        if (message.roomId !== roomId) return;

        console.log(`[new_message] received: id=${message.id}, roomId=${message.roomId}, senderId=${message.senderId}`);

        try {
          const collection = database.get<ChatMessageModel>('chat_messages');

          // Check if message already exists locally (could be echo from our own send)
          const existing = await collection.find(message.id).catch(() => null);
          console.log(`[new_message] find(${message.id}): ${existing ? 'FOUND, will update' : 'NOT FOUND, will create'}`);

          if (existing) {
            // Update status — message already inserted (from our own send or sync)
            console.log(`[new_message] BEFORE update: id=${message.id}, _status=${(existing._raw as any)._status}, status=${existing.status}`);
            await database.write(async () => {
              await existing.update((m) => {
                m.status = 'SENT';
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                m._raw._status = 'synced';
              });
            });
            console.log(`[new_message] AFTER update: id=${message.id}, _status=synced`);
          } else {
            // Insert new message from other user
            await database.write(async () => {
              await collection.create((m) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (m._raw as any).id = message.id;
                m.roomId = message.roomId;
                m.senderId = message.senderId;
                m.body = message.body;
                m.status = 'SENT';
                m.clientCreatedAt = new Date(message.clientCreatedAt).getTime();
                m.serverCreatedAt = message.serverCreatedAt
                  ? new Date(message.serverCreatedAt).getTime()
                  : undefined;
                m.serverVersion = message.version;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                m._raw._status = 'synced';
              });
            });
            console.log(`[new_message] created: id=${message.id}, _status=synced`);
          }
        } catch (err) {
          console.error('[new_message] error:', err);
        }
      });
    };

    setupSocket();

    // Cleanup: leave room & unsubscribe all listeners
    return () => {
      cancelled = true;
      unsubNewMessage?.();
      unsubConnect?.();
      unsubDisconnect?.();
      unsubConnectError?.();

      if (joined) {
        chatSocket.emitToServer('leave_room', { roomId });
      }
    };
  }, [database, roomId]);

  const handleSend = async (): Promise<void> => {
    const text = inputText.trim();
    if (!text || !currentUserId) return;

    setInputText('');

    const clientCreatedAt = Date.now();
    const tempId = generateUUID();

    // 1. Create local record (offline-first) — save reference directly
    let localRecord: ChatMessageModel | null = null;
    try {
      await database.write(async () => {
        localRecord = await database.get<ChatMessageModel>('chat_messages').create((msg) => {
          // Set id via _raw because msg.id is readonly in WatermelonDB Model
          // UUID required for sync with Postgres
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (msg._raw as any).id = tempId;
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

      console.log(`[handleSend] CREATED: id=${tempId}, _status=${(localRecord!._raw as any)._status}, status=${localRecord!.status}`);

      // Scroll to bottom after adding message
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 100);

      // 2. Try socket first (real-time)
      if (chatSocket.isConnected) {
        try {
          const ack = await new Promise<{ success: boolean; message?: ChatMessage; error?: string }>((resolve) => {
            chatSocket.emitToServer(
              'send_message',
              { id: tempId, roomId, body: text },
              (response: { success: boolean; message?: ChatMessage; error?: string }) => {
                resolve(response);
              }
            );
          });

          if (ack.success && ack.message) {
            console.log(`[handleSend] SOCKET ACK SUCCESS: id=${tempId}, ack.message.id=${ack.message.id}`);
            // Update local record with server response
            if (localRecord) {
              await database.write(async () => {
                await localRecord!.update((m) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  m._raw._status = 'synced'; // Clear dirty flag
                  m.status = 'SENT';
                  m.serverVersion = ack.message!.version;
                });
              });
              console.log(`[handleSend] SOCKET ACK: updated id=${tempId}, _status=synced`);
            }
            return; // Success via socket — no need for REST fallback
          } else {
            console.warn(`[handleSend] SOCKET ACK FAILED: id=${tempId}, error=${ack.error}`);
            // Continue to REST fallback
          }
        } catch (err) {
          console.warn(`[handleSend] SOCKET ERROR: id=${tempId}, err=${err}`);
          // Continue to REST fallback
        }
      } else {
        console.warn(`[handleSend] SOCKET NOT CONNECTED: id=${tempId}, falling back to REST`);
      }

      // 3. Fallback to REST (offline-first retry)
      try {
        const response = await sendChatMessage({
          id: tempId,
          roomId,
          body: text,
          clientCreatedAt: new Date(clientCreatedAt).toISOString(),
        });

        console.log(`[handleSend] REST SUCCESS: id=${tempId}, response.id=${response.id}`);
        // Update local record with server response
        if (localRecord) {
          await database.write(async () => {
            await localRecord!.update((m) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              m._raw._status = 'synced'; // Clear dirty flag
              m.status = 'SENT';
              m.serverVersion = response.version;
            });
          });
          console.log(`[handleSend] REST: updated id=${tempId}, _status=synced`);
        }
      } catch (err) {
        // REST failed — message stays as PENDING_SEND, will be picked up by sync coordinator
        console.warn(`[handleSend] REST FAILED: id=${tempId}, err=${err}`);
      }
    } catch (err) {
      console.error(`[handleSend] CREATE FAILED: id=${tempId}, err=${err}`);
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
      {/* Socket connection status indicator */}
      {!isSocketConnected && (
        <View style={styles.connectionBanner}>
          <Text style={styles.connectionBannerText}>
            Koneksi real-time terputus — pesan akan dikirim saat koneksi pulih
          </Text>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
        // extraData forces FlatList to re-render when observer emits new records.
        // Without it, React may skip re-render when the array reference is unchanged
        // (WatermelonDB observe() mutates Model instances in-place, so the same
        // array + Model references can be returned — shallow compare sees "no change").
        extraData={renderKey}
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
  connectionBanner: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#fcd34d',
  },
  connectionBannerText: {
    fontSize: 12,
    color: '#92400e',
    textAlign: 'center',
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
