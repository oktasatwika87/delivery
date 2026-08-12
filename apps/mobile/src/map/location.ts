/**
 * location — abstraksi tipis di atas LocationManager MapLibre (v10.2.1).
 *
 * MapLibre React Native sudah include LocationManager bawaan yang:
 *   - Foreground-only (start/stop saat app aktif)
 *   - Tidak butuh internet (GPS satelit)
 *   - Meng-update state internal + emit ke subscriber tiap ada location update
 *
 * Kita pakai itu, bukannya install @react-native-community/geolocation terpisah
 * — single source of truth untuk GPS, hemat dependensi.
 *
 * Runtime Permission:
 *   - Android API 23+ mewajibkan runtime permission request via PermissionsAndroid
 *     SEBELUM LocationManager.addListener() dipanggil.
 *   - Fallback-nya: request permission di dalam subscribe(), baru aktifkan listener.
 *   - Kalau permission denied, subscriber tetap ditambahkan tapi tidak akan dapat
 *     update (silent — caller bisa panggil requestPermission() sendiri untuk
 *     menangani UI explainer).
 *
 * Catatan:
 *   - Lokasi TIDAK dikirim lewat socket.io chat — dua concern ini independen.
 *     Lokasi hanya dipakai untuk render di MapView & simpan ke routing service
 *     saat kurir butuh rute.
 *   - Saat offline, location update dari satelit GPS tetap jalan — yang
 *     butuh internet hanya sync data lain (chat, sync coordinator).
 */

import { LocationManager } from '@maplibre/maplibre-react-native';
import type { Location } from '@maplibre/maplibre-react-native';
import { Platform, PermissionsAndroid } from 'react-native';

export type { Location } from '@maplibre/maplibre-react-native';

type Listener = (location: Location) => void;

/** Minimum jarak (meter) antar-update — 0 = tiap fix. Default 5m untuk akurasi kurir. */
const DEFAULT_DISPLACEMENT_METERS = 5;
void DEFAULT_DISPLACEMENT_METERS; // TODO: wire to LocationManager.setMinDisplacement on init if needed

export type PermissionStatus = 'granted' | 'denied' | 'blocked' | 'never_asked';

interface LocationService {
  /**
   * Subscribe ke location update. Return unsubscribe function.
   * Async karena request permission runtime jika belum ada.
   */
  subscribe(listener: Listener): Promise<() => void>;
  /** Ambil location terakhir (kalau ada). */
  getLastKnown(): Promise<Location | null>;
  /** Set minimum displacement. Default 5m (akurasi kurir). */
  setMinDisplacement(meters: number): void;
  /**
   * Request lokasi permission secara eksplisit.
   * return 'granted' | 'denied' | 'blocked' | 'never_asked' | (platform lain: 'granted')
   *
   * 'granted': permission sudah diberikan
   * 'denied': permission ditolak (bisa minta lagi)
   * 'blocked': permission permanently denied (NEVER_ASK_AGAIN, harus buka Settings)
   * 'never_asked': belum pernah diminta permission
   */
  requestPermission(): Promise<PermissionStatus>;
  /** Cek apakah permission sudah granted. */
  hasPermission(): boolean;
}

class LocationServiceImpl implements LocationService {
  private readonly listeners = new Set<Listener>();
  private readonly bridgeListener: Listener;
  private permissionStatus: PermissionStatus = 'never_asked';
  private isListening = false;

  constructor() {
    this.bridgeListener = (location) => {
      this.listeners.forEach((l) => l(location));
    };
  }

  hasPermission(): boolean {
    return this.permissionStatus === 'granted';
  }

  async requestPermission(): Promise<PermissionStatus> {
    if (Platform.OS !== 'android') {
      // Platform lain (iOS, dll) tidak butuh runtime permission check di Android style
      this.permissionStatus = 'granted';
      return 'granted';
    }

    try {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Izin Lokasi',
          message: 'Aplikasi ini butuh akses lokasi untuk menampilkan posisi Anda di peta.',
          buttonNeutral: 'Tanya Nanti',
          buttonNegative: 'Tolak',
          buttonPositive: 'Izinkan',
        },
      );

      if (result === PermissionsAndroid.RESULTS.GRANTED) {
        this.permissionStatus = 'granted';
        return 'granted';
      } else if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        this.permissionStatus = 'blocked';
        console.error('[location] Permission permanently blocked — user must enable in Settings');
        return 'blocked';
      } else {
        this.permissionStatus = 'denied';
        console.warn('[location] Location permission denied');
        return 'denied';
      }
    } catch (err) {
      console.error('[location] Permission request failed:', err);
      this.permissionStatus = 'denied';
      return 'denied';
    }
  }

  async subscribe(listener: Listener): Promise<() => void> {
    // Request permission if not yet granted
    if (this.permissionStatus !== 'granted') {
      const status = await this.requestPermission();
      if (status !== 'granted') {
        // Permission denied — add listener anyway (no-op) but don't crash
        console.warn('[location] subscribe without permission — listener added but will not receive updates');
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      }
    }

    // Start native listener on first subscriber
    if (this.listeners.size === 0 && !this.isListening) {
      try {
        LocationManager.addListener(this.bridgeListener);
        this.isListening = true;
      } catch (err) {
        console.error('[location] Failed to add location listener:', err);
        // Don't add listener to set if native add fails
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      }
    }

    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.isListening) {
        // Last subscriber left — stop native listener
        try {
          LocationManager.removeListener(this.bridgeListener);
          this.isListening = false;
        } catch (err) {
          console.error('[location] Failed to remove location listener:', err);
        }
      }
    };
  }

  getLastKnown(): Promise<Location | null> {
    return LocationManager.getLastKnownLocation().catch((err) => {
      console.warn('[location] getLastKnown failed:', err);
      return null;
    });
  }

  setMinDisplacement(meters: number): void {
    LocationManager.setMinDisplacement(meters);
  }
}

export const locationService: LocationService = new LocationServiceImpl();
