/**
 * MapScreen — render MapLibre dengan map style lokal, GPS kurir, dan
 * status koneksi. Offline-first: ketika area belum ter-download sebagai
 * offline region, tampilkan placeholder (jangan blank screen).
 *
 * Pola: functional component + withDatabase HOC, sama dengan chat/Login screen.
 *
 * Status badge online/offline (kiri atas).
 * Indikator GPS aktif/nonaktif (kanan atas).
 * Kalau tidak ada region offline yang downloaded → tampil empty state yang
 * mengajak user ke Settings (MapSettingsScreen).
 */

import React, { useEffect, useState, useRef, useMemo } from 'react';
import {
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { withDatabase } from '@nozbe/watermelondb/react';
import type { Database } from '@nozbe/watermelondb';

import type { RootStackParamList } from '../../App';
import { TILE_STYLE } from '../map/assets/style';
import { offlineStorage } from '../map/offlineStorage';
import { locationService } from '../map/location';
import { networkMonitor } from '../map/networkMonitor';

interface Props {
  database: Database;
}

function MapScreenBase({ database: _database }: Props): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [isOnline, setIsOnline] = useState<boolean>(networkMonitor.getStatus() === 'online');
  const [hasOfflineRegion, setHasOfflineRegion] = useState<boolean>(false); // false by default — tunggu load
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const cameraRef = useRef<MapLibreGL.CameraRef | null>(null);

  // Memoize style object agar MapLibre tidak re-init tiap render.
  // TILE_STYLE adalah string JSON — parse sekali di module.
  const mapStyle = useMemo(() => JSON.parse(TILE_STYLE), []);

  // Subscribe ke network status.
  useEffect(() => {
    const unsubscribe = networkMonitor.subscribe((status) => {
      setIsOnline(status === 'online');
    });
    // Probe langsung saat mount.
    networkMonitor.check().catch(() => {});
    return unsubscribe;
  }, []);

  // Subscribe GPS update — independent dari socket.io chat, isolated.
  useEffect(() => {
    const unsubscribe = locationService.subscribe((loc: { coords: { latitude: number; longitude: number } }) => {
      setCurrentLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    });
    return unsubscribe;
  }, []);

  // Load daftar pack region offline — kalau kosong, tampil empty state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const packs = await offlineStorage.listPacks();
        if (!cancelled) {
          const usable = packs.filter((p: { state: string }) => p.state === 'complete');
          setHasOfflineRegion(usable.length > 0);
        }
      } catch (err) {
        console.warn('[MapScreen] listPacks failed:', err);
        if (!cancelled) setHasOfflineRegion(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container}>
      {/* MapView hanya dirender kalau ada offline region — kalau tidak, empty state overlay
          di bawah sudah cukup. Ini mencegah MapLibre spam retry fetch saat offline. */}
      {hasOfflineRegion ? (
        <MapLibreGL.MapView
          style={styles.map}
          mapStyle={mapStyle}
          logoEnabled={false}
          attributionEnabled={false}
        >
          <MapLibreGL.Camera
            ref={cameraRef}
            zoomLevel={13}
            centerCoordinate={currentLocation ? [currentLocation.lng, currentLocation.lat] : [106.827, -6.175]}
          />
        </MapLibreGL.MapView>
      ) : null}

      {/* Status indikator online/offline (kiri atas) */}
      <View style={styles.statusBar}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: isOnline ? '#10b981' : '#f59e0b' },
          ]}
        />
        <Text style={styles.statusText}>{isOnline ? 'Online' : 'Offline'}</Text>
      </View>

      {/* GPS indicator (kanan atas) */}
      <View style={styles.gpsBar}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: currentLocation ? '#2563eb' : '#9ca3af' },
          ]}
        />
        <Text style={styles.statusText}>{currentLocation ? 'GPS aktif' : 'GPS mencari'}</Text>
      </View>

      {/* Settings button (pojok kanan bawah) */}
      <TouchableOpacity
        style={styles.settingsButton}
        onPress={() => navigation.navigate('MapSettings')}
      >
        <Text style={styles.settingsButtonText}>⚙</Text>
      </TouchableOpacity>

      {/* Empty state overlay — area belum pernah didownload */}
      {!hasOfflineRegion && (
        <View style={styles.emptyOverlay}>
          <Text style={styles.emptyTitle}>Peta offline belum tersedia</Text>
          <Text style={styles.emptySubtitle}>
            Download region area kerja Anda dari Settings supaya tetap bisa navigasi walau tanpa internet.
          </Text>
          <TouchableOpacity
            style={styles.openSettingsButton}
            onPress={() => navigation.navigate('MapSettings')}
          >
            <Text style={styles.openSettingsButtonText}>Buka Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.openSettingsTextButton}
            onPress={() => {
              // Trigger native settings so user can grant location if denied.
              Linking.openSettings().catch(() => {});
            }}
          >
            <Text style={styles.openSettingsTextButtonText}>Buka Pengaturan Lokasi</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const enhance = withDatabase(MapScreenBase);

export { enhance as MapScreen };

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  map: { flex: 1 },
  statusBar: {
    position: 'absolute',
    top: 16,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  gpsBar: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  emptyOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255,255,255,0.97)',
    padding: 24,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -3 },
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 6 },
  emptySubtitle: { fontSize: 13, color: '#6b7280', marginBottom: 16, lineHeight: 18 },
  openSettingsButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  openSettingsButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  openSettingsTextButton: { paddingVertical: 8, alignItems: 'center' },
  openSettingsTextButtonText: { color: '#2563eb', fontSize: 13, fontWeight: '500' },
  settingsButton: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  settingsButtonText: { fontSize: 22 },
});
