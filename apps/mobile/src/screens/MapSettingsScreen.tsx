/**
 * MapSettingsScreen — manage offline regions.
 *
 * Fungsi:
 *   - Lihat daftar pack yang sudah ter-download (nama + ukuran + state).
 *   - Trigger download region baru (default beberapa kota kerja).
 *   - Hapus pack.
 *
 * Pola: functional component + withDatabase. Observe lewat offlineStorage.listPacks().
 * Tidak observe WatermelonDB table karena data offline region tidak di-cache
 * di sana — pack info langsung dari native layer (MapLibre OfflineManager).
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { withDatabase } from '@nozbe/watermelondb/react';
import type { Database } from '@nozbe/watermelondb';

import { offlineStorage, type PackInfo, type Bounds } from '../map/offlineStorage';
import { TILE_STYLE_URL } from '../map/assets/style';

interface PresetRegion {
  name: string;
  label: string;
  bounds: Bounds;
}

// Default presets — beberapa kota kerja kurir di Indonesia.
// User bisa tambah preset baru dari UI advanced (TODO), atau override via
// config / API nanti.
const PRESETS: PresetRegion[] = [
  {
    name: 'jakarta',
    label: 'Jakarta',
    bounds: [
      [106.7, -6.1],
      [106.95, -6.35],
    ],
  },
  {
    name: 'bandung',
    label: 'Bandung',
    bounds: [
      [107.5, -6.85],
      [107.75, -7.0],
    ],
  },
  {
    name: 'surabaya',
    label: 'Surabaya',
    bounds: [
      [112.6, -7.2],
      [112.85, -7.35],
    ],
  },
];

interface Props {
  database: Database;
}

function MapSettingsBase(_props: Props): React.JSX.Element {
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingName, setDownloadingName] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await offlineStorage.listPacks();
      setPacks(list);
    } catch (err) {
      console.warn('[MapSettings] listPacks failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleDownload = useCallback(
    async (preset: PresetRegion) => {
      setDownloadingName(preset.name);
      setDownloadProgress(0);

      const warning = await offlineStorage.checkStorageBeforeDownload();
      if (warning) setStorageWarning(warning);

      try {
        await offlineStorage.downloadRegion(
          {
            name: preset.name,
            // Untuk demo maplibre tile server (placeholder production).
            styleURL: TILE_STYLE_URL,
            bounds: preset.bounds,
            minZoom: 10,
            maxZoom: 16,
          },
          (progress) => {
            setDownloadProgress(progress.percentage);
          },
          (error) => {
            Alert.alert('Download error', error.message);
          },
        );
        await refresh();
      } catch (err) {
        // Error sudah di-handle di onError.
        console.warn('[MapSettings] download failed:', err);
      } finally {
        setDownloadingName(null);
        setDownloadProgress(0);
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (name: string) => {
      Alert.alert('Hapus region', `Hapus offline region "${name}"? Tile akan dihapus dari device.`, [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: async () => {
            try {
              await offlineStorage.deletePack(name);
              await refresh();
            } catch (err) {
              Alert.alert('Gagal hapus', err instanceof Error ? err.message : 'unknown');
            }
          },
        },
      ]);
    },
    [refresh],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Offline Regions</Text>
      <Text style={styles.subtitle}>
        Download area kerja kurir supaya tetap bisa navigasi walau tanpa internet.
      </Text>

      {storageWarning && (
        <View style={styles.warningBanner}>
          <Text style={styles.warningText}>{storageWarning}</Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Download Preset</Text>
      <View style={styles.presetList}>
        {PRESETS.map((preset) => {
          const existing = packs.find((p) => p.name === preset.name);
          const isDownloading = downloadingName === preset.name;
          return (
            <View key={preset.name} style={styles.presetRow}>
              <View style={styles.presetInfo}>
                <Text style={styles.presetLabel}>{preset.label}</Text>
                {existing && (
                  <Text style={styles.presetMeta}>{formatBytes(existing.completedTileSize)} · {existing.state}</Text>
                )}
                {isDownloading && (
                  <Text style={styles.presetMeta}>Mendownload… {Math.round(downloadProgress)}%</Text>
                )}
              </View>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleDownload(preset)}
                disabled={isDownloading || existing?.state === 'active'}
              >
                <Text style={styles.actionButtonText}>
                  {existing ? 'Update' : 'Download'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>Region Terdownload</Text>
      <FlatList
        data={packs}
        keyExtractor={(p) => p.name}
        renderItem={({ item }) => (
          <View style={styles.packRow}>
            <View style={styles.packInfo}>
              <Text style={styles.packName}>{item.name}</Text>
              <Text style={styles.packMeta}>
                {formatBytes(item.completedTileSize)} · {item.state} · {Math.round(item.percentage)}%
              </Text>
            </View>
            <TouchableOpacity style={styles.deleteButton} onPress={() => handleDelete(item.name)}>
              <Text style={styles.deleteButtonText}>Hapus</Text>
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text>Belum ada region terdownload.</Text>
          </View>
        }
      />
    </View>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const enhance = withDatabase(MapSettingsBase);

export { enhance as MapSettingsScreen };

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 13, color: '#6b7280', marginTop: 4, marginBottom: 16 },
  warningBanner: {
    backgroundColor: '#fef3c7',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  warningText: { color: '#92400e', fontSize: 13 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 12,
    marginBottom: 8,
  },
  presetList: { marginBottom: 16 },
  presetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  presetInfo: { flex: 1 },
  presetLabel: { fontSize: 15, fontWeight: '600', color: '#111827' },
  presetMeta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  actionButton: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  actionButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  packRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  packInfo: { flex: 1 },
  packName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  packMeta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  deleteButton: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  deleteButtonText: { color: '#991b1b', fontSize: 13, fontWeight: '500' },
  empty: { padding: 24, alignItems: 'center' },
});
