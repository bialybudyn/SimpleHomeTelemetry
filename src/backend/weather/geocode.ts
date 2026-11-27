/**
 * Wyszukiwanie dowolnej miejscowości (także wsi i przysiółków) w OpenStreetMap — Nominatim.
 *
 * Zasady usługi: najwyżej 1 zapytanie na sekundę, nazwa aplikacji w User-Agent, bez podpowiedzi
 * „w trakcie pisania”. Dlatego szukamy tylko po zatwierdzeniu (Enter / przycisk), wyniki trzymamy
 * w pamięci, a zapytania idą po kolei.
 */

const URL_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'SimpleHomeTelemetry/1.0 (home weather panel)';
const MIN_GAP_MS = 1100;
const CACHE_MAX = 200;

export interface GeocodeResult {
  name: string;
  /** Gmina, powiat, województwo. */
  label: string;
  /** Np. „wieś”, „miasto”, „osada”. */
  kind: string;
  voivodeship: string;
  lat: number;
  lon: number;
}

const KIND: Record<string, string> = {
  city: 'miasto',
  town: 'miasto',
  village: 'wieś',
  hamlet: 'przysiółek',
  isolated_dwelling: 'osada',
  suburb: 'dzielnica',
  quarter: 'osiedle',
  neighbourhood: 'osiedle',
  locality: 'miejscowość',
  farm: 'kolonia',
  house: 'adres',
  residential: 'ulica',
};

interface NominatimItem {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  addresstype?: string;
  type?: string;
  address?: Record<string, string>;
}

export function parseNominatim(items: NominatimItem[]): GeocodeResult[] {
  const out: GeocodeResult[] = [];
  for (const it of items) {
    const lat = Number(it.lat);
    const lon = Number(it.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const a = it.address ?? {};
    const state = (a['state'] ?? '').replace(/^województwo\s+/i, '');
    if (!state) continue;
    const name = it.name || a['village'] || a['town'] || a['city'] || a['hamlet'] || it.display_name.split(',')[0];
    const parts = [a['municipality'], a['county'], state ? `woj. ${state}` : ''].filter((x): x is string => !!x && x !== name);
    const voiv = state.charAt(0).toUpperCase() + state.slice(1);
    const kind = KIND[it.addresstype ?? ''] ?? KIND[it.type ?? ''] ?? 'miejsce';
    if (out.some((o) => o.name === name && Math.abs(o.lat - lat) < 0.005 && Math.abs(o.lon - lon) < 0.005)) continue;
    out.push({ name, label: parts.join(', '), kind, voivodeship: voiv, lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5 });
  }
  return out;
}

export class Geocoder {
  private readonly cache = new Map<string, GeocodeResult[]>();
  private queue: Promise<unknown> = Promise.resolve();
  private last = 0;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  search(query: string): Promise<GeocodeResult[]> {
    const q = query.trim().replace(/\s+/g, ' ');
    if (q.length < 2 || q.length > 120) return Promise.resolve([]);
    const key = q.toLowerCase();
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve(hit);
    const run = this.queue.then(async () => {
      const again = this.cache.get(key);
      if (again) return again;
      const wait = this.last + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      const params = new URLSearchParams({ q, format: 'jsonv2', addressdetails: '1', countrycodes: 'pl', limit: '10', 'accept-language': 'pl' });
      const res = await this.fetchImpl(`${URL_BASE}?${params}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Wyszukiwarka OpenStreetMap: HTTP ${res.status}`);
      const results = parseNominatim((await res.json()) as NominatimItem[]);
      this.cache.set(key, results);
      if (this.cache.size > CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
      return results;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
