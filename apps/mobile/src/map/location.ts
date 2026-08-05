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
 * Catatan:
 *   - Lokasi TIDAK dikirim lewat socket.io chat — dua concern ini independen.
 *     Lokasi hanya dipakai untuk render di MapView & simpan ke routing service
 *     saat kurir butuh rute.
 *   - Saat offline, location update dari satelit GPS tetap jalan — yang
 *     butuh internet hanya sync data lain (chat, sync coordinator).
 */

import { LocationManager } from '@maplibre/maplibre-react-native';
import type { Location } from '@maplibre/maplibre-react-native';

export type { Location } from '@maplibre/maplibre-react-native';

type Listener = (location: Location) => void;

/** Minimum jarak (meter) antar-update — 0 = tiap fix. Default 5m untuk akurasi kurir. */
const DEFAULT_DISPLACEMENT_METERS = 5;
void DEFAULT_DISPLACEMENT_METERS; // TODO: wire to LocationManager.setMinDisplacement on init if needed

interface LocationService {
  /** Subscribe ke location update. Return unsubscribe. */
  subscribe(listener: Listener): () => void;
  /** Ambil location terakhir (kalau ada). */
  getLastKnown(): Promise<Location | null>;
  /** Set minimum displacement. Default 5m (akurasi kurir). */
  setMinDisplacement(meters: number): void;
}

class LocationServiceImpl implements LocationService {
  private readonly listeners = new Set<Listener>();
  private readonly bridgeListener: Listener;

  constructor() {
    this.bridgeListener = (location) => {
      this.listeners.forEach((l) => l(location));
    };
  }

  subscribe(listener: Listener): () => void {
    if (this.listeners.size === 0) {
      // Subscribe pertama → start native location updates.
      LocationManager.addListener(this.bridgeListener);
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        // Subscriber terakhir unsubscribe → stop native update (hemat baterai).
        LocationManager.removeListener(this.bridgeListener);
      }
    };
  }

  getLastKnown(): Promise<Location | null> {
    return LocationManager.getLastKnownLocation();
  }

  setMinDisplacement(meters: number): void {
    LocationManager.setMinDisplacement(meters);
  }
}

export const locationService: LocationService = new LocationServiceImpl();
