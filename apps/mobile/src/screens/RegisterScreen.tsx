/**
 * Register screen.
 *
 * Flow:
 *   1. User pilih role (Customer / Driver) via toggle pills
 *   2. User isi name, phone, password
 *   3. Sebelum register(): kalau HP ini masih menyimpan data akun lama
 *      yang belum terkirim, tampilkan pesan penolakan dan berhenti.
 *      Akun baru tidak boleh menjadi pemilik data akun lain.
 *   4. Submit jadi register() lalu startLocalSession(token, user.id, db).
 *      Kalau ok, panggil onRegisterSuccess(). Kalau tidak ok, tampilkan
 *      pesan penolakan dan berhenti.
 *   5. Gagal jadi tampilkan pesan galat
 *
 * Navigation ke home dilakukan oleh parent (App.tsx) setelah callback.
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

import { register, RegisterError } from '../sync/client';
import { startLocalSession, countUnsentData, unsentDataBlockMessage } from '../sync/localData';
import { database } from '../db';
import { UserRole } from '@delivery/shared';

interface RegisterScreenProps {
  /** Dipanggil setelah register + saveToken berhasil. */
  onRegisterSuccess: () => void;
  /** Navigasi kembali ke login screen. */
  onBackToLogin: () => void;
}

export function RegisterScreen({ onRegisterSuccess, onBackToLogin }: RegisterScreenProps): React.JSX.Element {
  const [selectedRole, setSelectedRole] = useState<UserRole>(UserRole.CUSTOMER);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (): Promise<void> => {
    if (!name.trim()) {
      setError('Mohon isi nama');
      return;
    }
    if (!phone.trim()) {
      setError('Mohon isi nomor HP');
      return;
    }
    if (!password.trim() || password.length < 8) {
      setError('Password minimal 8 karakter');
      return;
    }

    setLoading(true);
    setError(null);

    // Sebelum register(): kalau HP ini masih menyimpan data belum
    // terkirim dari akun sebelumnya, akun baru tidak boleh menjadi
    // pemilik data itu. Pengguna harus masuk dengan akun lama sampai
    // datanya terkirim, lalu keluar.
    try {
      const unsentCount = await countUnsentData(database);
      if (unsentCount > 0) {
        setError(unsentDataBlockMessage(unsentCount));
        setLoading(false);
        return;
      }
    } catch (err) {
      // Gagal membaca DB: register tetap dilanjutkan, karena
      // startLocalSession memeriksa ulang sebelum token disimpan.
      console.warn('[RegisterScreen] countUnsentData failed:', err);
    }

    try {
      const { token, user } = await register({
        phone: phone.trim(),
        password,
        name: name.trim(),
        role: selectedRole,
      });
      const result = await startLocalSession(token, user.id, database);
      if (!result.ok) {
        setError(unsentDataBlockMessage(result.unsentCount));
        return;
      }
      onRegisterSuccess();
    } catch (err) {
      if (err instanceof RegisterError) {
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
        <Text style={styles.title}>Daftar</Text>
        <Text style={styles.subtitle}>Buat akun baru</Text>

        {/* Role toggle */}
        <View style={styles.roleContainer}>
          <TouchableOpacity
            style={[styles.roleButton, selectedRole === UserRole.CUSTOMER && styles.roleButtonActive]}
            onPress={() => setSelectedRole(UserRole.CUSTOMER)}
            disabled={loading}
          >
            <Text
              style={[styles.roleButtonText, selectedRole === UserRole.CUSTOMER && styles.roleButtonTextActive]}
            >
              Customer
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.roleButton, selectedRole === UserRole.DRIVER && styles.roleButtonActive]}
            onPress={() => setSelectedRole(UserRole.DRIVER)}
            disabled={loading}
          >
            <Text
              style={[styles.roleButtonText, selectedRole === UserRole.DRIVER && styles.roleButtonTextActive]}
            >
              Driver
            </Text>
          </TouchableOpacity>
        </View>

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <TextInput
          style={styles.input}
          placeholder="Nama"
          autoComplete="name"
          value={name}
          onChangeText={setName}
          editable={!loading}
          placeholderTextColor="#999"
        />

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
          placeholder="Password (min. 8 karakter)"
          secureTextEntry
          autoComplete="password-new"
          value={password}
          onChangeText={setPassword}
          editable={!loading}
          placeholderTextColor="#999"
        />

        <Button
          title={loading ? 'Mendaftar...' : 'Daftar'}
          onPress={handleSubmit}
          disabled={loading}
        />

        {loading && (
          <ActivityIndicator style={styles.loader} size="small" />
        )}

        <TouchableOpacity style={styles.backLink} onPress={onBackToLogin} disabled={loading}>
          <Text style={styles.backLinkText}>Sudah punya akun? Masuk</Text>
        </TouchableOpacity>
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
  roleContainer: {
    flexDirection: 'row',
    marginBottom: 24,
    gap: 12,
  },
  roleButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#fafafa',
    alignItems: 'center',
  },
  roleButtonActive: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  roleButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#666',
  },
  roleButtonTextActive: {
    color: '#2563eb',
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
  backLink: {
    marginTop: 24,
    alignItems: 'center',
  },
  backLinkText: {
    color: '#2563eb',
    fontSize: 14,
  },
});
