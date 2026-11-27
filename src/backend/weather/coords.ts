import { getImgwMeteoStations, normalizePl, type ImgwMeteoStation, type WeatherLocation } from '../imgw';

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Skąd są współrzędne (nazwa stacji IMGW). */
  source: string;
}

export function stationCoords(m: ImgwMeteoStation): GeoPoint | null {
  const lat = Number(m.lat);
  const lon = Number(m.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0 || lon === 0) return null;
  return { lat, lon, source: m.nazwa_stacji };
}

/**
 * Współrzędne miejscowości: z powiązanej stacji meteo IMGW, a gdy jej nie ma — ze stacji
 * o tej samej nazwie co miejscowość lub stacja synoptyczna (np. „Warszawa” → „WARSZAWA-BIELANY”).
 */
export async function locationCoords(
  loc: Pick<WeatherLocation, 'name' | 'meteoStationCode' | 'synopStationName' | 'lat' | 'lon'>,
): Promise<GeoPoint | null> {
  // Miejsce wpisane ręcznie: dokładne współrzędne
  if (loc.lat !== undefined && loc.lon !== undefined) return { lat: loc.lat, lon: loc.lon, source: loc.name };
  const stations = await getImgwMeteoStations('', 5000);
  if (loc.meteoStationCode) {
    const m = stations.find((s) => s.kod_stacji === loc.meteoStationCode);
    const c = m && stationCoords(m);
    if (c) return c;
  }
  for (const name of [loc.name, loc.synopStationName]) {
    if (!name) continue;
    const n = normalizePl(name);
    const exact = stations.find((s) => normalizePl(s.nazwa_stacji) === n);
    const prefix = stations.find((s) => normalizePl(s.nazwa_stacji).startsWith(n));
    const c = (exact && stationCoords(exact)) || (prefix && stationCoords(prefix));
    if (c) return c;
  }
  return null;
}

/** Odległość po kuli [km]. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
