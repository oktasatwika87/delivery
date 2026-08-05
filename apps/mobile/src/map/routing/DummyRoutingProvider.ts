/**
 * DummyRoutingProvider — default implementation yang throw Error.
 *
 * Digunakan sampai provider konkret (OSRM / GraphHopper / Valhalla / Mapbox
 * Directions / etc) dipilih dan diimplementasi.
 *
 * Untuk aktivasi provider konkret, buat file baru implementasi
 * `RoutingProvider` interface (mis. `OsrmRoutingProvider.ts`),
 * daftarkan di `src/map/routing/index.ts`, dan swap binding di sini
 * atau lewat DI dari component.
 *
 * TODO(user): implementasi concrete provider. Lihat keputusan #5 di spec —
 * interface provider-agnostic dulu, concrete provider menyusul.
 */

import type { RouteRequest, Route, RoutingProvider } from './RoutingProvider';

export class DummyRoutingProvider implements RoutingProvider {
  async getRoute(_request: RouteRequest): Promise<Route> {
    throw new Error(
      'RoutingProvider belum diimplementasi. ' +
        'Pilih provider (OSRM/GraphHopper/Valhalla/Mapbox Directions) dan ' +
        'implementasikan interface RoutingProvider.',
    );
  }
}

export const defaultRoutingProvider: RoutingProvider = new DummyRoutingProvider();
