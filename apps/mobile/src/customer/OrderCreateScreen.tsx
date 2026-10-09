/**
 * Order Create Screen.
 *
 * Flow:
 *   1. User isi form (alamat, barang, catatan)
 *   2. Submit jadi createOrder() jadi sukses/error
 *   3. Sukses jadi Alert konfirmasi + tombol "Lihat Status" (panggil onCreateSuccess)
 *
 * Online-only, tidak ada offline queue.
 *
 * Ada dua mode navigasi setelah sukses. CustomerStack saat ini pass
 * onCreateSuccess yang menavigasi langsung ke OrderTrackingScreen
 * (navigation.replace, jadi back dari tracking kembali ke home, bukan
 * ke form create). Kalau prop tidak diberikan, fallback ke onBack
 * seperti flow lama.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Alert,
  ActivityIndicator,
  Button,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { createOrder } from '../sync/client';
import { locationService, type PermissionStatus } from '../map/location';
import type { CreateOrderInput } from '@delivery/shared';

interface OrderCreateScreenProps {
  onBack: () => void;
  /**
   * Dipanggil saat create order sukses dengan order.id yang baru dibuat.
   * CustomerStack pakai ini untuk navigation.replace ke OrderTrackingScreen.
   * Opsional, kalau tidak disediakan, fallback ke onBack (flow lama).
   */
  onCreateSuccess?: (orderId: string) => void;
}

interface FormData {
  recipientName: string;
  phone: string;
  street: string;
  city: string;
  postalCode: string;
  itemName: string;
  quantity: string;
  unitPriceCents: string;
  notes: string;
}

interface FormErrors {
  recipientName?: string;
  phone?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  itemName?: string;
  quantity?: string;
  unitPriceCents?: string;
  /** Galat titik antar (bukan isian yang diketik). */
  coordinates?: string;
}

/** 'pending' sampai requestPermission selesai, setelah itu hasil izinnya. */
type LocationPhase = 'pending' | PermissionStatus;

export function OrderCreateScreen({ onBack, onCreateSuccess }: OrderCreateScreenProps): React.JSX.Element {
  const [form, setForm] = useState<FormData>({
    recipientName: '',
    phone: '',
    street: '',
    city: '',
    postalCode: '',
    itemName: '',
    quantity: '1',
    unitPriceCents: '',
    notes: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Synchronous guard untuk prevent double-tap race condition.
  // useState update is async, tidak aman untuk inflight guard.
  // useRef provides synchronous access to current value.
  const isSubmitting = useRef(false);

  // Minta izin lalu ambil posisi GPS. Effect jalan ulang setiap attemptId
  // naik (tombol Coba lagi). Cleanup menandai alur lama batal dan melepas
  // listener-nya, termasuk listener yang baru selesai didaftarkan setelah
  // layar ditutup, jadi tidak ada setState di layar yang sudah ditutup.
  const [locationPhase, setLocationPhase] = useState<LocationPhase>('pending');
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [attemptId, setAttemptId] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    (async () => {
      const status = await locationService.requestPermission();
      if (cancelled) return;
      setLocationPhase(status);

      if (status !== 'granted') {
        return;
      }

      // Posisi terakhir dipakai dulu supaya tidak menunggu kiriman
      // pertama dari listener. Kalau kosong, listener yang mengisi.
      const last = await locationService.getLastKnown();
      if (cancelled) return;
      if (last) {
        setPosition({ lat: last.coords.latitude, lng: last.coords.longitude });
      }

      const unsub = await locationService.subscribe((loc) => {
        if (cancelled) return;
        setPosition({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      });
      if (cancelled) {
        // Layar sudah ditutup atau Coba lagi sudah ditekan: lepas lagi.
        unsub();
      } else {
        unsubscribe = unsub;
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [attemptId]);

  const handleRetryLocation = useCallback(() => {
    // Ulangi alur izin dari awal.
    setPosition(null);
    setAttemptId((id) => id + 1);
  }, []);

  const updateField = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Clear error saat user mulai ketik ulang
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
    setGlobalError(null);
  };

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!form.recipientName.trim()) {
      newErrors.recipientName = 'Nama penerima wajib diisi';
    }
    if (!form.phone.trim()) {
      newErrors.phone = 'Nomor telepon wajib diisi';
    }
    if (!form.street.trim()) {
      newErrors.street = 'Alamat wajib diisi';
    }
    if (!form.city.trim()) {
      newErrors.city = 'Kota wajib diisi';
    }
    if (!form.postalCode.trim()) {
      newErrors.postalCode = 'Kode pos wajib diisi';
    }
    if (!form.itemName.trim()) {
      newErrors.itemName = 'Nama barang wajib diisi';
    }

    const qty = parseInt(form.quantity, 10);
    if (!form.quantity.trim() || isNaN(qty) || qty <= 0) {
      newErrors.quantity = 'Jumlah harus lebih dari 0';
    }

    const price = parseInt(form.unitPriceCents, 10);
    if (!form.unitPriceCents.trim() || isNaN(price) || price <= 0) {
      newErrors.unitPriceCents = 'Harga satuan harus lebih dari 0';
    }

    // Titik antar dicek di sini supaya galatnya muncul bersama galat
    // isian lain.
    if (!position) {
      newErrors.coordinates = 'Titik antar belum didapat.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (): Promise<void> => {
    // Synchronous guard: prevent double-tap race condition
    if (isSubmitting.current) {
      return;
    }

    // validate() sudah mengisi galat titik antar; position dicek lagi
    // supaya tipenya tidak null di payload.
    if (!validate() || !position) {
      return;
    }

    isSubmitting.current = true;
    setLoading(true);
    setGlobalError(null);

    try {
      const input: CreateOrderInput = {
        items: [
          {
            productId: `item-${Date.now()}`,
            name: form.itemName.trim(),
            quantity: parseInt(form.quantity, 10),
            unitPriceCents: parseInt(form.unitPriceCents, 10),
          },
        ],
        deliveryAddress: {
          recipientName: form.recipientName.trim(),
          phone: form.phone.trim(),
          street: form.street.trim(),
          city: form.city.trim(),
          postalCode: form.postalCode.trim(),
          // Urutan [lng, lat] sesuai DeliveryAddress (GeoJSON), jangan dibalik.
          coordinates: [position.lng, position.lat],
        },
        notes: form.notes.trim() || undefined,
      };

      const order = await createOrder(input);

      // Kalau onCreateSuccess disediakan, pakai untuk navigate langsung
      // ke OrderTrackingScreen (auto-navigate, no double-tap). Fallback ke
      // onBack kalau prop tidak ada, preserve legacy behavior.
      const primaryAction = onCreateSuccess
        ? { text: 'Lihat Status', onPress: () => onCreateSuccess(order.id) }
        : { text: 'Kembali ke Home', onPress: onBack };

      Alert.alert(
        'Order Berhasil',
        `Order berhasil dibuat!\nID: ${order.id.slice(0, 8).toUpperCase()}`,
        [primaryAction]
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal terhubung ke server';
      setGlobalError(message);
    } finally {
      setLoading(false);
      isSubmitting.current = false;
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Buat Order Baru</Text>

        {globalError && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{globalError}</Text>
          </View>
        )}

        {/* Alamat Penerima */}
        <Text style={styles.sectionTitle}>Alamat Penerima</Text>

        <TextInput
          style={[styles.input, errors.recipientName ? styles.inputError : null]}
          placeholder="Nama Penerima"
          value={form.recipientName}
          onChangeText={(v) => updateField('recipientName', v)}
          editable={!loading}
          placeholderTextColor="#999"
        />
        {errors.recipientName && <Text style={styles.fieldError}>{errors.recipientName}</Text>}

        <TextInput
          style={[styles.input, errors.phone ? styles.inputError : null]}
          placeholder="No. Telepon"
          keyboardType="phone-pad"
          value={form.phone}
          onChangeText={(v) => updateField('phone', v)}
          editable={!loading}
          placeholderTextColor="#999"
        />
        {errors.phone && <Text style={styles.fieldError}>{errors.phone}</Text>}

        <TextInput
          style={[styles.input, errors.street ? styles.inputError : null]}
          placeholder="Alamat / Jalan"
          value={form.street}
          onChangeText={(v) => updateField('street', v)}
          editable={!loading}
          placeholderTextColor="#999"
        />
        {errors.street && <Text style={styles.fieldError}>{errors.street}</Text>}

        <TextInput
          style={[styles.input, errors.city ? styles.inputError : null]}
          placeholder="Kota"
          value={form.city}
          onChangeText={(v) => updateField('city', v)}
          editable={!loading}
          placeholderTextColor="#999"
        />
        {errors.city && <Text style={styles.fieldError}>{errors.city}</Text>}

        <TextInput
          style={[styles.input, errors.postalCode ? styles.inputError : null]}
          placeholder="Kode Pos"
          keyboardType="number-pad"
          value={form.postalCode}
          onChangeText={(v) => updateField('postalCode', v)}
          editable={!loading}
          placeholderTextColor="#999"
        />
        {errors.postalCode && <Text style={styles.fieldError}>{errors.postalCode}</Text>}

        {/* Titik antar dari GPS customer. Tombol Coba lagi muncul kalau izin
            ditolak atau diblokir. */}
        <Text style={styles.sectionTitle}>Titik antar</Text>
        {renderTitikAntarContent({
          phase: locationPhase,
          position,
          onRetry: handleRetryLocation,
        })}
        {errors.coordinates && !position && <Text style={styles.fieldError}>{errors.coordinates}</Text>}

        {/* Detail Barang */}
        <Text style={styles.sectionTitle}>Detail Barang</Text>

        <TextInput
          style={[styles.input, errors.itemName ? styles.inputError : null]}
          placeholder="Nama Barang"
          value={form.itemName}
          onChangeText={(v) => updateField('itemName', v)}
          editable={!loading}
          placeholderTextColor="#999"
        />
        {errors.itemName && <Text style={styles.fieldError}>{errors.itemName}</Text>}

        <View style={styles.row}>
          <View style={styles.halfInput}>
            <TextInput
              style={[styles.input, errors.quantity ? styles.inputError : null]}
              placeholder="Jumlah"
              keyboardType="number-pad"
              value={form.quantity}
              onChangeText={(v) => updateField('quantity', v)}
              editable={!loading}
              placeholderTextColor="#999"
            />
            {errors.quantity && <Text style={styles.fieldError}>{errors.quantity}</Text>}
          </View>

          <View style={styles.halfInput}>
            <TextInput
              style={[styles.input, errors.unitPriceCents ? styles.inputError : null]}
              placeholder="Harga (IDR)"
              keyboardType="number-pad"
              value={form.unitPriceCents}
              onChangeText={(v) => updateField('unitPriceCents', v)}
              editable={!loading}
              placeholderTextColor="#999"
            />
            {errors.unitPriceCents && <Text style={styles.fieldError}>{errors.unitPriceCents}</Text>}
          </View>
        </View>

        {/* Catatan */}
        <Text style={styles.sectionTitle}>Catatan (Opsional)</Text>

        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Catatan tambahan..."
          value={form.notes}
          onChangeText={(v) => updateField('notes', v)}
          editable={!loading}
          multiline
          numberOfLines={3}
          placeholderTextColor="#999"
        />

        <Button
          title={loading ? 'Mengirim...' : 'Buat Order'}
          onPress={handleSubmit}
          // Tetap aktif walau posisi belum ada, supaya galat titik antar
          // bisa muncul saat submit.
          disabled={loading}
        />

        {loading && (
          <ActivityIndicator style={styles.loader} size="small" />
        )}

        <Button
          title="Batal"
          onPress={onBack}
          disabled={loading}
          color="#666"
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

interface TitikAntarContentProps {
  phase: LocationPhase;
  position: { lat: number; lng: number } | null;
  onRetry: () => void;
}

function renderTitikAntarContent({ phase, position, onRetry }: TitikAntarContentProps): React.JSX.Element {
  if (position) {
    return (
      <Text style={styles.titikAntarText}>
        Titik antar: lokasi Anda saat ini ({position.lat.toFixed(5)}, {position.lng.toFixed(5)})
      </Text>
    );
  }
  if (phase === 'denied') {
    return (
      <View>
        <Text style={styles.titikAntarText}>
          Izin lokasi ditolak. Titik antar dibutuhkan supaya driver bisa menemukan Anda.
        </Text>
        <View style={styles.retryButton}>
          <Button title="Coba lagi" onPress={onRetry} />
        </View>
      </View>
    );
  }
  if (phase === 'blocked') {
    return (
      <View>
        <Text style={styles.titikAntarText}>
          Izin lokasi diblokir. Aktifkan izin lokasi untuk aplikasi ini di Pengaturan, lalu ketuk Coba lagi.
        </Text>
        <View style={styles.retryButton}>
          <Button title="Coba lagi" onPress={onRetry} />
        </View>
      </View>
    );
  }
  // Masih menunggu izin, atau izin ada tapi GPS belum memberi posisi.
  return (
    <Text style={styles.titikAntarText}>
      Mencari lokasi Anda... Pastikan GPS menyala.
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#222',
    marginBottom: 24,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#444',
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    marginBottom: 8,
    color: '#222',
    backgroundColor: '#fafafa',
  },
  inputError: {
    borderColor: '#dc2626',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  fieldError: {
    color: '#dc2626',
    fontSize: 12,
    marginBottom: 8,
    marginLeft: 4,
  },
  titikAntarText: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 8,
    lineHeight: 20,
  },
  retryButton: {
    marginBottom: 8,
    alignSelf: 'flex-start',
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
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  halfInput: {
    flex: 1,
  },
  loader: {
    marginTop: 16,
    marginBottom: 8,
  },
});
