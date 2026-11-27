import { decodePng } from './png';

/**
 * Radar opadów IMGW (kompozyt POLRAD, maksimum odbiciowości CMAX, co 5 min).
 *
 * IMGW publikuje gotową mapę (z granicami, miastami i legendą) oraz obraz samych ech.
 * Siatka: 900×900 px, 1 km/px, odwzorowanie azymutalne równoodległościowe ze środkiem
 * 52,3469°N 19,0926°E (sprawdzone na znacznikach miast na mapie IMGW).
 */

const LIST_URL = 'https://danepubliczne.imgw.pl/api/data/product/id/COMPO_CMAX_250.comp.cmax';
const LIST_TTL_MS = 3 * 60_000;
const MAX_FRAMES = 12;
const CENTER = { lat: 52.3469, lon: 19.0926 };
const EARTH_R = 6370997;
const GRID = 900;

/** Kolory legendy IMGW → dolna granica przedziału [dBZ]. */
const PALETTE: [number, number, number, number][] = [
  [7, 7, 165, 0],
  [7, 7, 200, 5],
  [18, 97, 255, 8],
  [0, 180, 255, 11],
  [60, 205, 255, 14],
  [120, 230, 255, 17],
  [187, 242, 255, 20],
  [255, 255, 255, 23],
  [255, 247, 153, 26],
  [255, 238, 51, 29],
  [255, 203, 26, 32],
  [255, 115, 0, 35],
  [255, 30, 0, 38],
  [200, 0, 0, 41],
  [175, 0, 20, 44],
  [150, 0, 40, 47],
  [190, 0, 120, 50],
  [214, 17, 155, 53],
  [238, 35, 190, 56],
  [246, 70, 210, 59],
  [255, 105, 230, 62],
];

export interface RadarFrame {
  /** Znacznik czasu z nazwy pliku, np. „202611270525” (UTC). */
  stamp: string;
  time: string;
}

export interface RainNearby {
  time: string;
  /** Poza zasięgiem radarów. */
  covered: boolean;
  /** Odbiciowość nad punktem [dBZ] i natężenie opadu [mm/h] (null = brak opadu). */
  dbz: number | null;
  rate: number | null;
  /** Najsilniejsze echo w promieniu 10 km. */
  maxDbz10km: number | null;
  /** Najbliższe echo ≥ 8 dBZ (pomijamy najsłabsze, często szum). */
  nearestKm: number | null;
  nearestBearing: number | null;
  /** Odległość najbliższego echa 30 min wcześniej — czy opad się zbliża. */
  nearestKm30minAgo: number | null;
  trend: 'approaching' | 'receding' | 'steady' | null;
}

/** Współrzędne geograficzne → piksel siatki radaru (x w prawo, y w dół). */
export function radarPixel(lat: number, lon: number): { x: number; y: number } {
  const rad = Math.PI / 180;
  const la0 = CENTER.lat * rad;
  const lo0 = CENTER.lon * rad;
  const la = lat * rad;
  const lo = lon * rad;
  const cosc = Math.sin(la0) * Math.sin(la) + Math.cos(la0) * Math.cos(la) * Math.cos(lo - lo0);
  const c = Math.acos(Math.max(-1, Math.min(1, cosc)));
  const k = c === 0 ? 1 : c / Math.sin(c);
  const x = EARTH_R * k * Math.cos(la) * Math.sin(lo - lo0);
  const y = EARTH_R * k * (Math.cos(la0) * Math.sin(la) - Math.sin(la0) * Math.cos(la) * Math.cos(lo - lo0));
  return { x: GRID / 2 + x / 1000, y: GRID / 2 - y / 1000 };
}

export function colorToDbz(r: number, g: number, b: number, a: number): number | 'nodata' | null {
  if (a === 0) return null;
  if (a < 200) return 'nodata'; // półprzezroczysta szarość = poza zasięgiem
  let best: number | null = null;
  let bestDist = 30 * 30 * 3;
  for (const [pr, pg, pb, dbz] of PALETTE) {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = dbz;
    }
  }
  return best;
}

/** Marshall–Palmer: Z = 200·R^1,6. */
export function dbzToRate(dbz: number): number {
  return Math.pow(Math.pow(10, dbz / 10) / 200, 1 / 1.6);
}

function stampToIso(s: string): string {
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12))).toISOString();
}

export function analyzeEcho(png: Buffer, lat: number, lon: number): Omit<RainNearby, 'time' | 'nearestKm30minAgo' | 'trend'> {
  const img = decodePng(png);
  const { x, y } = radarPixel(lat, lon);
  const cx = Math.round(x);
  const cy = Math.round(y);
  const at = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= img.width || py >= img.height) return 'nodata' as const;
    const o = (py * img.width + px) * 4;
    return colorToDbz(img.rgba[o], img.rgba[o + 1], img.rgba[o + 2], img.rgba[o + 3]);
  };
  const here = at(cx, cy);
  if (here === 'nodata') {
    return { covered: false, dbz: null, rate: null, maxDbz10km: null, nearestKm: null, nearestBearing: null };
  }
  let max10: number | null = null;
  let nearest: number | null = null;
  let bearing: number | null = null;
  const R = 150;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > R) continue;
      const v = at(cx + dx, cy + dy);
      if (typeof v !== 'number') continue;
      if (d <= 10 && (max10 === null || v > max10)) max10 = v;
      if (v >= 8 && (nearest === null || d < nearest)) {
        nearest = d;
        bearing = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
      }
    }
  }
  const dbz = typeof here === 'number' ? here : null;
  return {
    covered: true,
    dbz,
    rate: dbz != null && dbz >= 8 ? Math.round(dbzToRate(dbz) * 10) / 10 : null,
    maxDbz10km: max10,
    nearestKm: nearest != null ? Math.round(nearest) : null,
    nearestBearing: bearing != null ? Math.round(bearing) : null,
  };
}

export class RadarService {
  private list: { stamp: string; files: Record<string, string> }[] = [];
  private listAt = 0;
  private readonly images = new Map<string, Buffer>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async frames(): Promise<RadarFrame[]> {
    await this.refreshList();
    return this.list.map((f) => ({ stamp: f.stamp, time: stampToIso(f.stamp) }));
  }

  /** Gotowa mapa IMGW (z podkładem i legendą) dla klatki. */
  async image(stamp: string, kind: 'map' | 'echo'): Promise<Buffer | null> {
    await this.refreshList();
    const frame = this.list.find((f) => f.stamp === stamp);
    const url = frame?.files[kind === 'map' ? 'png' : 'echo'];
    if (!url) return null;
    const key = `${kind}:${stamp}`;
    const cached = this.images.get(key);
    if (cached) return cached;
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    this.images.set(key, buf);
    // Trzymamy tylko klatki z bieżącej listy (ok. 2 × 12 obrazów)
    const keep = new Set(this.list.flatMap((f) => [`map:${f.stamp}`, `echo:${f.stamp}`]));
    for (const k of this.images.keys()) if (!keep.has(k)) this.images.delete(k);
    return buf;
  }

  async rainNear(lat: number, lon: number): Promise<RainNearby | null> {
    await this.refreshList();
    const latest = this.list.at(-1);
    if (!latest) return null;
    const now = analyzeEcho((await this.image(latest.stamp, 'echo'))!, lat, lon);
    let ago: number | null = null;
    const earlier = this.list.length >= 7 ? this.list[this.list.length - 7] : null;
    if (earlier && now.covered) {
      const png = await this.image(earlier.stamp, 'echo').catch(() => null);
      if (png) ago = analyzeEcho(png, lat, lon).nearestKm;
    }
    let trend: RainNearby['trend'] = null;
    if (now.nearestKm != null && ago != null) {
      trend = now.nearestKm < ago - 5 ? 'approaching' : now.nearestKm > ago + 5 ? 'receding' : 'steady';
    }
    return { time: stampToIso(latest.stamp), ...now, nearestKm30minAgo: ago, trend };
  }

  private async refreshList(): Promise<void> {
    if (Date.now() - this.listAt < LIST_TTL_MS && this.list.length) return;
    const res = await this.fetchImpl(LIST_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`IMGW radar: HTTP ${res.status}`);
    const all = (await res.json()) as { file: string; url: string }[];
    const byStamp = new Map<string, Record<string, string>>();
    for (const f of all) {
      const m = /^(\d{12})\d{4}dBZ\.cmax(\.png|_echoOnly\.png)$/.exec(f.file);
      if (!m) continue;
      const rec = byStamp.get(m[1]) ?? {};
      rec[m[2] === '.png' ? 'png' : 'echo'] = f.url;
      byStamp.set(m[1], rec);
    }
    this.list = [...byStamp.entries()]
      .filter(([, files]) => files['png'] && files['echo'])
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-MAX_FRAMES)
      .map(([stamp, files]) => ({ stamp, files }));
    this.listAt = Date.now();
  }
}
