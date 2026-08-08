/**
 * GraphHopperRoutingProvider — implementasi RoutingProvider via GraphHopper Directions API.
 *
 * Pakai free tier GraphHopper API (https://graphhopper.com).
 * API key dibaca dari react-native-config (GRAPHHOPPER_API_KEY).
 *
 * Catatan desain:
 *   - Timeout 10 detik — jangan hang kalau API lambat/down.
 *   - Throw Error dengan pesan actionable untuk semua failure case.
 *   - Geometry dikembalikan sebagai GeoJSON LineString [lng, lat].
 *   - Caller (routeSnapshot service) akan catch + fallback ke snapshot.
 */

import Config from 'react-native-config';

import type { Route, RouteRequest, RoutingProvider } from './RoutingProvider';
import { InvalidConfigError } from './RoutingProvider';

const GRAPHHOPPER_BASE_URL = 'https://graphhopper.com/api/1';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_PROFILE = 'car';

/**
 * Decode polyline Google-encoded string ke array [lng, lat].
 * GraphHopper return encoded polyline di field `points`.
 */
function decodePolyline(encoded: string): Array<[number, number]> {
  const coords: Array<[number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coords.push([lng / 1e5, lat / 1e5]);
  }

  return coords;
}

/**
 * Fetch dengan timeout via AbortController.
 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('GraphHopper request timeout — API lambat atau tidak reachable');
    }
    throw err;
  }
}

export interface GraphHopperProviderOptions {
  /** API key GraphHopper. Default dari react-native-config GRAPHHOPPER_API_KEY. */
  apiKey?: string;
  /** Timeout request dalam ms. Default 10000. */
  timeoutMs?: number;
  /** Profil routing. Default 'car'. */
  profile?: 'car' | 'foot' | 'bike';
}

interface GraphHopperPath {
  distance: number; // meter
  time: number; // milidetik
  points: string; // encoded polyline
  points_encoded: boolean;
}

interface GraphHopperResponse {
  paths: GraphHopperPath[];
  message?: string;
  hints?: { message: string }[];
}

export class GraphHopperRoutingProvider implements RoutingProvider {
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly profile: string;

  constructor(options: GraphHopperProviderOptions = {}) {
    const apiKey = options.apiKey ?? Config.GRAPHHOPPER_API_KEY;
    if (!apiKey) {
      throw new InvalidConfigError(
        'GRAPHHOPPER_API_KEY tidak ditemukan. ' +
          'Set GRAPHHOPPER_API_KEY di .env (contoh: GRAPHHOPPER_API_KEY=your_key).',
      );
    }
    this.apiKey = apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.profile = options.profile ?? DEFAULT_PROFILE;
  }

  async getRoute(request: RouteRequest): Promise<Route> {
    const profile = request.profile === 'walking' ? 'foot' : request.profile === 'cycling' ? 'bike' : this.profile;

    const params = new URLSearchParams();
    params.append('point', `${request.origin.lat},${request.origin.lng}`);
    params.append('point', `${request.destination.lat},${request.destination.lng}`);
    params.append('vehicle', profile);
    params.append('locale', 'id');
    params.append('calc_points', 'true');
    params.append('points_encoded', 'true');
    params.append('key', this.apiKey);

    const url = `${GRAPHHOPPER_BASE_URL}/route?${params.toString()}`;

    let response: Response;
    try {
      response = await fetchWithTimeout(url, this.timeoutMs);
    } catch (err) {
      if (err instanceof TypeError && err.message.includes('Network request failed')) {
        throw new Error('Network error — cek koneksi internet atau VPN.');
      }
      throw err;
    }

    if (!response.ok) {
      // 401/403 = invalid/revoked API key — config error, bukan transient
      if (response.status === 401 || response.status === 403) {
        throw new InvalidConfigError(
          `GraphHopper API unauthorized (HTTP ${response.status}). ` +
            'API key mungkin invalid atau telah di-revoke. Cek GRAPHHOPPER_API_KEY di .env.',
        );
      }
      throw new Error(`GraphHopper API error: HTTP ${response.status} ${response.statusText}`);
    }

    let data: GraphHopperResponse;
    try {
      data = await response.json();
    } catch {
      throw new Error('GraphHopper response bukan valid JSON.');
    }

    // GraphHopper error response via message field
    if (data.message) {
      throw new Error(`GraphHopper API error: ${data.message}`);
    }
    if (data.hints?.length) {
      throw new Error(`GraphHopper hint: ${data.hints[0].message}`);
    }

    if (!data.paths || data.paths.length === 0) {
      throw new Error('No route found — pastikan origin & destination valid.');
    }

    const path = data.paths[0];

    let geometry: Array<[number, number]>;
    if (path.points_encoded && path.points) {
      geometry = decodePolyline(path.points);
    } else if (path.points && Array.isArray(path.points)) {
      // Fallback: kalau tidak encoded (GeoJSON format)
      geometry = path.points.map(
        (p: { lat: number; lng: number }) => [p.lng, p.lat] as [number, number],
      );
    } else {
      geometry = [];
    }

    return {
      origin: request.origin,
      destination: request.destination,
      geometry,
      distanceMeters: Math.round(path.distance),
      durationSeconds: Math.round(path.time / 1000),
    };
  }
}
