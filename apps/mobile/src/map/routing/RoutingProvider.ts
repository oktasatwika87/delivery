/**
 * RoutingProvider — interface provider-agnostic untuk fetch rute.
 *
 * Implementasi konkret (OSRM / GraphHopper / Valhalla / Mapbox Directions / dll)
 * akan ditentukan nanti. Untuk sekarang kita sediakan interface + dummy default
 * yang throw Error, supaya UI/snapshot logic bisa ditulis tanpa dependent pada
 * provider spesifik.
 *
 * Konvensi:
 *   - Geometry dikembalikan sebagai GeoJSON LineString (lng, lat) — konsisten
 *     dengan konvensi `coordinates` di packages/shared (lihat DeliveryAddress).
 *   - Fetch gagal → throw Error dengan pesan actionable. Caller (routeSnapshot
 *     service) akan catch + fallback ke snapshot terakhir.
 *   - Implementasi konkret diharapkan cek network — kalau offline, throw Error
 *     supaya caller tidak menyimpan snapshot invalid.
 */

/** Lat/lng sebuah titik — pakai [lng, lat] agar konsisten GeoJSON. */
export interface LngLat {
  lng: number;
  lat: number;
}

/** Hasil rute yang siap di-render. */
export interface Route {
  origin: LngLat;
  destination: LngLat;
  /**
   * GeoJSON LineString sebagai array koordinat [lng, lat].
   * Boleh kosong kalau provider tidak return geometry detail.
   */
  geometry: Array<[number, number]>;
  /** Jarak total dalam meter (optional). */
  distanceMeters?: number;
  /** Estimasi durasi dalam detik (optional). */
  durationSeconds?: number;
}

/** Input request rute. */
export interface RouteRequest {
  origin: LngLat;
  destination: LngLat;
  /** Optional override profil — "driving" | "walking" | "cycling". */
  profile?: 'driving' | 'walking' | 'cycling';
}

export interface RoutingProvider {
  /**
   * Fetch rute live dari provider.
   * HARUS throw Error kalau offline atau provider error — caller akan fallback
   * ke snapshot. Jangan return null/undefined — gunakan throw saja.
   *
   * Catatan: untuk error konfigurasi (API key missing/invalid, 401/403),
   * throws InvalidConfigError supaya caller bisa bedakan dari transient error.
   */
  getRoute(request: RouteRequest): Promise<Route>;
}

/**
 * Error untuk masalah konfigurasi provider (missing API key, unauthorized, dll).
 * Caller bisa instanceof-check untuk bedakan dari transient error (network/timeout).
 */
export class InvalidConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConfigError';
  }
}
