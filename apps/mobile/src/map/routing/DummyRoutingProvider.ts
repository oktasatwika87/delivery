/**
 * DummyRoutingProvider, provider bawaan yang selalu melempar Error.
 *
 * App memakai `GraphHopperRoutingProvider`. Kelas ini hanya nilai bawaan
 * yang langsung gagal kalau provider lain belum dipasang.
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
