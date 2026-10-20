/**
 * Login screen.
 *
 * Flow:
 *   1. User isi phone + password
 *   2. Submit -> login() -> startLocalSession(token, user.id, database)
 *      -> kalau ok, panggil onLoginSuccess(). Kalau tidak ok
 *      (pemilik data lokal beda dan ada data belum terkirim),
 *      tampilkan pesan blok dan JANGAN panggil onLoginSuccess().
 *   3. Gagal credential -> tampilkan pesan error
 *
 * Catatan: navigation ke Orders TIDAK dilakukan di sini. Biarkan
 * App.tsx yang handle, ia akan re-render Navigator begitu
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
  TouchableOpacity,
  View,
} from 'react-native';

import { login, InvalidCredentialsError } from '../sync/client';
import { startLocalSession, unsentDataBlockMessage } from '../sync/localData';
import { database } from '../db';

interface LoginScreenProps {
  /** Dipanggil setelah login + saveToken berhasil. */
  onLoginSuccess: () => void;
  /** Reason for forced logout, if any. */
  logoutReason?: 'auth-expired' | 'manual';
  /** Navigasi ke register screen. */
  onNavigateToRegister?: () => void;
}

export function LoginScreen({ onLoginSuccess, logoutReason, onNavigateToRegister }: LoginScreenProps): React.JSX.Element {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const handleSubmit = async (): Promise<void> => {
    if (!phone.trim() || !password.trim()) {
      setError('Mohon isi nomor HP dan password');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { token, user } = await login(phone.trim(), password);
      const result = await startLocalSession(token, user.id, database);
      if (!result.ok) {
        // Ada data belum terkirim dari akun sebelumnya di HP ini.
        // Tampilkan pesan blok; JANGAN panggil onLoginSuccess supaya
        // sesi tidak aktif untuk akun baru.
        setError(unsentDataBlockMessage(result.unsentCount));
        return;
      }
      // Tidak navigate langsung, cukup beritahu App.tsx via callback.
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

        {logoutReason === 'auth-expired' && !bannerDismissed && (
          <View style={styles.banner}>
            <Text style={styles.bannerText}>⚠️ Sesi Anda telah berakhir. Silakan login ulang untuk melanjutkan.</Text>
            <Text style={styles.bannerText}>
              Data yang belum terkirim tetap tersimpan dan dikirim setelah Anda masuk lagi dengan akun yang sama.
            </Text>
            <TouchableOpacity onPress={() => setBannerDismissed(true)} style={styles.bannerClose}>
              <Text style={styles.bannerCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

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

        {onNavigateToRegister && (
          <TouchableOpacity style={styles.registerLink} onPress={onNavigateToRegister} disabled={loading}>
            <Text style={styles.registerLinkText}>Belum punya akun? Daftar</Text>
          </TouchableOpacity>
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
  banner: {
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  bannerText: {
    color: '#92400e',
    fontSize: 14,
    flex: 1,
  },
  bannerClose: {
    marginLeft: 8,
    padding: 4,
  },
  bannerCloseText: {
    color: '#92400e',
    fontSize: 16,
    fontWeight: 'bold',
  },
  loader: {
    marginTop: 16,
  },
  registerLink: {
    marginTop: 24,
    alignItems: 'center',
  },
  registerLinkText: {
    color: '#2563eb',
    fontSize: 14,
  },
});
