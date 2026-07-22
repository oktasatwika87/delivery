/**
 * Login screen.
 *
 * Flow:
 *   1. User isi phone + password
 *   2. Submit → login() → saveToken() → panggil onLoginSuccess()
 *   3. Gagal → tampilkan pesan error
 *
 * Catatan: navigation ke Orders TIDAK dilakukan di sini.
 * Biarkan App.tsx yang handle — ia akan re-render Navigator begitu
 * authenticated=true dan otomatis menampilkan Orders.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Button,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { login, InvalidCredentialsError } from '../sync/client';
import { saveToken } from '../sync/token-storage';

interface LoginScreenProps {
  /** Dipanggil setelah login + saveToken berhasil. */
  onLoginSuccess: () => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps): React.JSX.Element {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (): Promise<void> => {
    if (!phone.trim() || !password.trim()) {
      setError('Mohon isi nomor HP dan password');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { token, user } = await login(phone.trim(), password);
      await saveToken(token, user.id);
      // Tidak navigate langsung — cukup beritahu App.tsx via callback.
      // App.tsx akan re-render Navigator dan otomatis tampilkan Orders.
      onLoginSuccess();
    } catch (err) {
      if (err instanceof InvalidCredentialsError) {
        setError(err.message);
      } else {
        setError('Gagal terhubung ke server. Coba lagi.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Masuk</Text>
        <Text style={styles.subtitle}>Delivery App</Text>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TextInput
          style={styles.input}
          placeholder="Nomor HP"
          keyboardType="phone-pad"
          autoComplete="tel"
          value={phone}
          onChangeText={setPhone}
          editable={!loading}
          placeholderTextColor="#999"
        />

        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          autoComplete="password"
          value={password}
          onChangeText={setPassword}
          editable={!loading}
          placeholderTextColor="#999"
        />

        <Button
          title={loading ? 'Masuk...' : 'Masuk'}
          onPress={handleSubmit}
          disabled={loading}
        />

        {loading && (
          <ActivityIndicator style={styles.loader} size="small" />
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#222',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 16,
    color: '#222',
    backgroundColor: '#fafafa',
  },
  errorBox: {
    backgroundColor: '#fee2e2',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#dc2626',
    fontSize: 14,
    textAlign: 'center',
  },
  loader: {
    marginTop: 16,
  },
});
