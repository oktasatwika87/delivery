/**
 * Order Create Screen.
 *
 * Flow:
 *   1. User isi form (alamat, barang, catatan)
 *   2. Submit → createOrder() → sukses/error
 *   3. Sukses → Alert konfirmasi + tombol "Lihat Status" (panggil onCreateSuccess)
 *
 * Online-only — tidak ada offline queue.
 *
 * Tier 3: tambah prop onCreateSuccess. CustomerStack pass callback yang
 * navigate ke OrderTrackingScreen pakai navigation.replace — jadi back
 * dari tracking langsung ke home (bukan balik ke form create).
 */

import React, { useState } from 'react';
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
import type { CreateOrderInput } from '@delivery/shared';

interface OrderCreateScreenProps {
  onBack: () => void;
  /**
   * Dipanggil saat create order sukses dengan order.id yang baru dibuat.
   * CustomerStack pakai ini untuk navigation.replace ke OrderTrackingScreen.
   * Opsional — kalau tidak disediakan, fallback ke onBack (legacy Tier 2 flow).
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
}

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

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (): Promise<void> => {
    if (!validate()) {
      return;
    }

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
        },
        notes: form.notes.trim() || undefined,
      };

      const order = await createOrder(input);

      // Tier 3: kalau onCreateSuccess disediakan, pakai untuk navigate
      // langsung ke OrderTrackingScreen (auto-navigate, no double-tap).
      // Fallback ke onBack kalau prop tidak ada — preserve legacy behavior.
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
