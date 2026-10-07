/**
 * MapScreen — render MapLibre dengan map style lokal, GPS kurir, dan
 * routing rute dari origin (GPS kurir) ke destination (alamat pengiriman).
 *
 * Offline-first: ketika area belum ter-download sebagai offline region,
 * tampilkan placeholder (jangan blank screen).
 *
 * Routing flow:
 *   1. Terima orderId dari navigation params
 *   2. Lookup order dari WatermelonDB
 *   3. Extract destination dari order.addressJson.coordinates
 *   4. Origin = GPS location kurir (currentLocation)
 *   5. Kalau keduanya tersedia → call routeService.getRoute()
 *   6. Render polyline di atas peta
 *   7. Tampilkan indikator cache/error/loading
 *
 * Pola: functional component + withDatabase HOC, sama dengan chat/Login screen.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import MapLibreGL from '@maplibre/maplibre-react-native';
import { withDatabase } from '@nozbe/watermelondb/react';
import type { Database } from '@nozbe/watermelondb';

import type { RootStackParamList } from '../../App';
import { TILE_STYLE } from '../map/assets/style';
import { offlineStorage } from '../map/offlineStorage';
import { locationService } from '../map/location';
import { networkMonitor } from '../map/networkMonitor';
import { RouteService } from '../map/routeService';
import { GraphHopperRoutingProvider } from '../map/routing';
import { haversineDistance, MATCH_RADIUS_METERS } from '../map/routeSnapshot';
import { OrderModel } from '../db/models/OrderModel';

type Props = NativeStackScreenProps<RootStackParamList, 'Map'> & {
  database: Database;
};

type LngLat = { lng: number; lat: number };

function MapScreenBase({ database }: Props): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<NativeStackScreenProps<RootStackParamList, 'Map'>['route']>();
  const { orderId } = route.params;

  // Refs
  const cameraRef = useRef<MapLibreGL.CameraRef | null>(null);

  // Titik asal rute yang dipakai panggilan getRoute terakhir — supaya update
  // GPS kecil tidak memicu hitung ulang rute. Radius sama dengan
  // MATCH_RADIUS_METERS (300 m) di routeSnapshot.
  const lastRouteOriginRef = useRef<LngLat | null>(null);

  // Sudah pernah fitBounds untuk order ini — supaya kamera tidak di-zoom
  // berulang tiap kali getRoute dipanggil ulang.
  const hasFitBoundsRef = useRef<boolean>(false);

  // Sudah pernah setCamera ke GPS pertama — supaya GPS berikutnya tidak
  // menarik kamera lagi. Tidak dibuat kalau rute sudah fitBounds duluan
  // (lihat efek posisi awal kamera di bawah).
  const hasCenteredRef = useRef<boolean>(false);

  // Nilai isOnline sebelumnya — untuk deteksi transisi false → true supaya
  // rute di-refetch sekali setelah koneksi pulih.
  const prevOnlineRef = useRef<boolean>(false);

  // Nomor permintaan rute terakhir. Naik tiap getRoute benar-benar dipanggil,
  // jadi hasil permintaan lama yang telat selesai bisa diabaikan.
  const requestIdRef = useRef<number>(0);

  // Jadi false setelah layar ditutup, supaya hasil getRoute yang telat
  // tidak dipakai lagi.
  const mountedRef = useRef<boolean>(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Titik origin/destination yang dipakai untuk fitBounds, supaya konsisten
  // dengan rute yang sedang dirender.
  const [routeOrigin, setRouteOrigin] = useState<LngLat | null>(null);
  const [routeDestination, setRouteDestination] = useState<LngLat | null>(null);

  // Memoize style object agar MapLibre tidak re-init tiap render.
  const mapStyle = useMemo(() => JSON.parse(TILE_STYLE), []);

  // Memoize RouteService instance (sekali, jangan re-create tiap render)
  const routeService = useMemo(() => {
    const provider = new GraphHopperRoutingProvider();
    return new RouteService({ routingProvider: provider, database });
  }, [database]);

  // Network state
  const [isOnline, setIsOnline] = useState<boolean>(networkMonitor.getStatus() === 'online');

  // Offline region state
  const [hasOfflineRegion, setHasOfflineRegion] = useState<boolean>(false);

  // GPS state
  const [currentLocation, setCurrentLocation] = useState<LngLat | null>(null);

  // Order state
  const [orderDestination, setOrderDestination] = useState<LngLat | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);

  // Routing state
  const [routeGeometry, setRouteGeometry] = useState<Array<[number, number]> | null>(null);
  const [isRoutingLoading, setIsRoutingLoading] = useState<boolean>(false);
  const [isFromCache, setIsFromCache] = useState<boolean>(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // ─── Network monitor subscription ─────────────────────────────────────────

  useEffect(() => {
    const unsubscribe = networkMonitor.subscribe((status) => {
      setIsOnline(status === 'online');
    });
    networkMonitor.check().catch(() => {});
    return unsubscribe;
  }, []);

  // ─── GPS subscription ────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    // Initial fix dari last-known cache — gak nunggu listener fire.
    // Kalau null (no permission / no cache), no-op; listener live tetap jalan paralel.
    locationService.getLastKnown().then((loc) => {
      if (cancelled || !loc) return;
      setCurrentLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    });

    locationService.subscribe((loc: { coords: { latitude: number; longitude: number } }) => {
      setCurrentLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
    }).then((unsub) => {
      // Kalau cleanup sudah jalan duluan (component unmount), langsung unsubscribe
      if (cancelled) {
        unsub();
      } else {
        unsubscribe = unsub;
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  // ─── Load offline regions ──────────────────────────────────────────────────

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

  // ─── Lookup order & extract destination ────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const collection = database.get<OrderModel>('orders');
        const order = await collection.find(orderId);

        if (cancelled) return;

        // addressJson adalah JSON dengan format DeliveryAddress:
        // { recipientName, phone, street, city, postalCode, coordinates?: [lng, lat] }
        // Koordinat di DeliveryAddress mengikuti GeoJSON convention: [lng, lat]
        const addressJson = order.addressJson as { coordinates?: [number, number] } | null;

        if (addressJson?.coordinates && addressJson.coordinates.length === 2) {
          // Konversi dari [lng, lat] array ke { lng, lat } object
          const [lng, lat] = addressJson.coordinates;
          setOrderDestination({ lng, lat });
        } else {
          setOrderError('Alamat pengiriman tidak memiliki koordinat yang valid.');
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[MapScreen] gagal lookup order:', err);
          setOrderError('Order tidak ditemukan.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [database, orderId]);

  // ─── Trigger route fetch saat origin & destination tersedia ─────────────────

  useEffect(() => {
    if (!currentLocation || !orderDestination) {
      // Belum punya keduanya — biarkan state rute apa adanya. GPS null sebentar
      // tidak menghapus rute yang sudah tampil.
      return;
    }

    const origin: LngLat = { lng: currentLocation.lng, lat: currentLocation.lat };
    const destination: LngLat = orderDestination;

    // Throttle: kalau kurir belum bergeser > 300 m dari titik asal rute
    // terakhir, tidak perlu hitung ulang. Radius sama dengan MATCH_RADIUS_METERS
    // di routeSnapshot supaya konsisten dengan logika fallback snapshot.
    if (lastRouteOriginRef.current) {
      const distance = haversineDistance(lastRouteOriginRef.current, origin);
      if (distance <= MATCH_RADIUS_METERS) {
        return;
      }
    }

    // Catat origin sebelum fetch supaya tick GPS berikutnya dalam radius yang
    // sama tidak menggandakan panggilan walaupun server gagal.
    lastRouteOriginRef.current = origin;

    // Permintaan ini tidak dibatalkan walau posisi GPS terus berubah.
    // Hasilnya dipakai selama nomornya masih yang terakhir.
    const requestId = ++requestIdRef.current;

    (async () => {
      setIsRoutingLoading(true);
      setRouteError(null);

      try {
        const result = await routeService.getRoute({ origin, destination });

        // Abaikan kalau sudah ada permintaan lebih baru atau layar sudah ditutup.
        if (requestIdRef.current === requestId && mountedRef.current) {
          setRouteGeometry(result.route.geometry);
          setIsFromCache(result.isFromCache);
          setRouteError(null);
          setRouteOrigin(origin);
          setRouteDestination(destination);
        }
      } catch (err) {
        if (requestIdRef.current === requestId && mountedRef.current) {
          const message = err instanceof Error ? err.message : 'Gagal memuat rute.';
          setRouteError(message);
          setRouteGeometry(null);
          setIsFromCache(false);
        }
      } finally {
        if (requestIdRef.current === requestId && mountedRef.current) {
          setIsRoutingLoading(false);
        }
      }
    })();
  }, [currentLocation, orderDestination, routeService]);

  // ─── Pemulihan online ───────────────────────────────────────────────────────
  // Saat transisi false → true, kosongkan lastRouteOriginRef supaya rute di-
  // refetch pada tick GPS pertama berikutnya. Setelah itu throttling 300 m
  // berlaku lagi sehingga tidak ada loop pemanggilan.
  useEffect(() => {
    if (isOnline && !prevOnlineRef.current) {
      lastRouteOriginRef.current = null;
    }
    prevOnlineRef.current = isOnline;
  }, [isOnline]);

  // ─── fitBounds ke rute yang baru di-render ──────────────────────────────────
  // Efek ini dipasang SEBELUM efek posisi awal kamera di bawah. Kalau MapView
  // ter-mount belakangan dan keduanya sudah siap, fitBounds jalan duluan lalu
  // setEffect posisi awal skip karena hasFitBoundsRef sudah true.
  useEffect(() => {
    if (
      hasFitBoundsRef.current ||
      !routeGeometry ||
      routeGeometry.length === 0 ||
      !routeOrigin ||
      !routeDestination ||
      !cameraRef.current
    ) {
      return;
    }
    cameraRef.current.fitBounds(
      [routeOrigin.lng, routeOrigin.lat],
      [routeDestination.lng, routeDestination.lat],
      50, // padding pixels
      1000, // durasi animasi (ms), bukan zoom
    );
    hasFitBoundsRef.current = true;
  }, [routeGeometry, routeOrigin, routeDestination, hasOfflineRegion]);

  // ─── Posisi awal kamera: GPS pertama atau fallback Denpasar ────────────────
  // Hanya dipanggil sekali, dan hanya kalau:
  //   - belum pernah fitBounds (kalau sudah, rute yang menang)
  //   - tidak ada tujuan order (kalau ada, fitBounds yang akan menang dan
  //     setCamera tidak perlu dijalankan)
  //
  // Kalau orderDestination null tapi GPS tiba, kamera di-snap ke GPS supaya
  // kurir tetap melihat posisinya walau order tidak punya koordinat tujuan.
  useEffect(() => {
    if (
      hasCenteredRef.current ||
      hasFitBoundsRef.current ||
      orderDestination ||
      !currentLocation ||
      !cameraRef.current ||
      !hasOfflineRegion
    ) {
      return;
    }
    cameraRef.current.setCamera({
      centerCoordinate: [currentLocation.lng, currentLocation.lat],
      zoomLevel: 13,
      animationMode: 'moveTo',
    });
    hasCenteredRef.current = true;
  }, [currentLocation, hasOfflineRegion, orderDestination]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* MapView — hanya render kalau ada offline region */}
      {hasOfflineRegion && (
        <MapLibreGL.MapView
          style={styles.map}
          mapStyle={mapStyle}
          logoEnabled={false}
          attributionEnabled={false}
        >
          <MapLibreGL.Camera
            ref={cameraRef}
            // defaultSettings diterapkan sekali oleh native camera (lihat
            // Camera.tsx di maplibre-react-native: useState -> defaultStop).
            // Tidak pakai centerCoordinate/zoomLevel live supaya update GPS
            // tidak menarik kamera kembali.
            defaultSettings={{
              centerCoordinate: [115.2167, -8.65],
              zoomLevel: 13,
            }}
          />

          {/* Route polyline */}
          {routeGeometry && routeGeometry.length >= 2 && (
            <MapLibreGL.ShapeSource
              id="route"
              shape={{
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: routeGeometry,
                },
                properties: null,
              }}
            >
              <MapLibreGL.LineLayer
                id="route-line"
                style={{
                  lineColor: '#2563eb',
                  lineWidth: 4,
                  lineOpacity: 0.8,
                }}
              />
            </MapLibreGL.ShapeSource>
          )}

          {/* Origin marker (kurir) */}
          {currentLocation && (
            <MapLibreGL.MarkerView coordinate={[currentLocation.lng, currentLocation.lat]}>
              <View style={styles.originMarker}>
                <Text style={styles.originMarkerText}>📍</Text>
              </View>
            </MapLibreGL.MarkerView>
          )}

          {/* Destination marker (alamat pengiriman) */}
          {orderDestination && (
            <MapLibreGL.MarkerView coordinate={[orderDestination.lng, orderDestination.lat]}>
              <View style={styles.destMarker}>
                <Text style={styles.destMarkerText}>🏁</Text>
              </View>
            </MapLibreGL.MarkerView>
          )}
        </MapLibreGL.MapView>
      )}

      {/* Atribusi OSM — hanya saat MapView tampil (di dalam cabang hasOfflineRegion yang sama). */}
      {hasOfflineRegion && (
        <TouchableOpacity
          style={styles.attribution}
          accessibilityLabel="Buka halaman hak cipta OpenStreetMap"
          onPress={() => Linking.openURL('https://www.openstreetmap.org/copyright').catch(() => {})}
        >
          <Text style={styles.attributionText}>© OpenMapTiles © OpenStreetMap contributors</Text>
        </TouchableOpacity>
      )}

      {/* Status indikator online/offline */}
      <View style={styles.statusBar}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: isOnline ? '#10b981' : '#f59e0b' },
          ]}
        />
        <Text style={styles.statusText}>{isOnline ? 'Online' : 'Offline'}</Text>
      </View>

      {/* GPS indicator */}
      <View style={styles.gpsBar}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: currentLocation ? '#2563eb' : '#9ca3af' },
          ]}
        />
        <Text style={styles.statusText}>{currentLocation ? 'GPS aktif' : 'GPS mencari'}</Text>
      </View>

      {/* Routing loading indicator */}
      {isRoutingLoading && (
        <View style={styles.routingBar}>
          <ActivityIndicator size="small" color="#2563eb" />
          <Text style={styles.routingText}>Memuat rute...</Text>
        </View>
      )}

      {/* Cache indicator */}
      {isFromCache && !isRoutingLoading && !routeError && (
        <View style={styles.cacheBar}>
          <Text style={styles.cacheText}>📦 Rute dari cache (data mungkin tidak terbaru)</Text>
        </View>
      )}

      {/* Route error */}
      {routeError && !isRoutingLoading && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{routeError}</Text>
        </View>
      )}

      {/* Order error */}
      {orderError && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{orderError}</Text>
        </View>
      )}

      {/* Settings button */}
      <TouchableOpacity
        style={styles.settingsButton}
        onPress={() => navigation.navigate('MapSettings')}
      >
        <Text style={styles.settingsButtonText}>⚙</Text>
      </TouchableOpacity>

      {/* Empty state overlay */}
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

// ─── Styles ─────────────────────────────────────────────────────────────────

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
    top: 56,
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
  routingBar: {
    position: 'absolute',
    top: 16,
    left: '50%',
    transform: [{ translateX: -50 }],
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  routingText: { fontSize: 13, fontWeight: '600', color: '#374151', marginLeft: 8 },
  cacheBar: {
    position: 'absolute',
    top: 16,
    left: '50%',
    transform: [{ translateX: -50 }],
    backgroundColor: 'rgba(254, 243, 199, 0.95)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  cacheText: { fontSize: 12, fontWeight: '500', color: '#92400e' },
  errorBar: {
    position: 'absolute',
    top: 16,
    left: '50%',
    transform: [{ translateX: -50 }],
    backgroundColor: 'rgba(254, 226, 226, 0.95)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    maxWidth: '80%',
  },
  errorText: { fontSize: 12, fontWeight: '500', color: '#991b1b', textAlign: 'center' },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  originMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  originMarkerText: { fontSize: 24 },
  destMarker: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  destMarkerText: { fontSize: 24 },
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
  attribution: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderRadius: 3,
  },
  attributionText: {
    fontSize: 10,
    color: '#000',
  },
});
