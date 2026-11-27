import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dataPath } from '../config';
import { getImgwMeteoStations } from '../imgw';
import { grib1Length, parseGrib1, readRotatedGrid, rotatedIndex, type RotatedGrid } from './grib1';
import { stationCoords } from './coords';

/**
 * Prognoza z modelu COSMO IMGW (siatka 2,8 km, 4 przebiegi na dobę, 60 h do przodu).
 *
 * Każda godzina prognozy to osobny plik GRIB1 ~161 MB, a serwer IMGW nie obsługuje pobierania
 * fragmentów. Pola przy powierzchni są w pierwszych ~118 MB pliku, więc czytamy strumień tylko do
 * nich i przerywamy pobieranie. Bierzemy co 3. godzinę: ok. 12–20 plików na przebieg.
 * Wartości wyjmujemy od razu dla wszystkich stacji meteo IMGW (~800 punktów), więc zmiana
 * miejscowości w panelu nie wymaga ponownego pobierania.
 */

const LIST_URL = (cycle: string) => `https://danepubliczne.imgw.pl/api/data/product/id/COSMO_HVD_${cycle}_00`;
const CYCLES = ['00', '06', '12', '18'];
const STEP_HOURS = 3;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const STORE_FILE = 'cosmo_forecast.json';

/** Pola, które wyjmujemy (tabela, parametr, typ poziomu, poziom). */
const FIELDS = {
  t2m: [2, 11, 105, 2],
  td2m: [2, 17, 105, 2],
  u10: [2, 33, 105, 10],
  v10: [2, 34, 105, 10],
  gust: [201, 187, 105, 10],
  pmsl: [2, 2, 102, 0],
  cloud: [2, 71, 1, 0],
  snowGsp: [2, 79, 1, 0],
  snowCon: [2, 78, 1, 0],
  totPrec: [2, 61, 1, 0],
} as const satisfies Record<string, readonly [number, number, number, number]>;
type Field = keyof typeof FIELDS;
const FIELD_KEYS = Object.keys(FIELDS) as Field[];

export interface ForecastStep {
  /** Czas ważności prognozy (ISO, UTC). */
  time: string;
  temp: number | null;
  dewPoint: number | null;
  humidity: number | null;
  wind: number | null;
  windDir: number | null;
  gust: number | null;
  pressure: number | null;
  cloud: number | null;
  /** Opad w ostatnich 3 h [mm] (całkowity, w tym śnieg w przeliczeniu na wodę). */
  precip: number | null;
  /** Część opadu jako śnieg [mm wody]. */
  snow: number | null;
}

export interface PointForecast {
  run: string;
  model: string;
  steps: ForecastStep[];
}

interface RawStep {
  time: string;
  values: Partial<Record<Field, number | null>>[];
}

interface Store {
  run: string;
  generatedAt: string;
  points: { key: string; lat: number; lon: number }[];
  /** Kąt między północą siatki obróconej a geograficzną dla każdego punktu [°]. */
  northAngle: number[];
  steps: RawStep[];
}

export interface CosmoStatus {
  run: string | null;
  generatedAt: string | null;
  busy: boolean;
  progress: string | null;
  error: string | null;
}

/** „202611261200” → Date (UTC). */
function parseStamp(s: string): Date {
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12)));
}

export function pointKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

/** Kąt (stopnie, zgodnie z zegarem) północy geograficznej względem osi „v” siatki obróconej. */
function northAngle(grid: RotatedGrid, lat: number, lon: number): number {
  const rad = Math.PI / 180;
  const rot = (la: number, lo: number) => {
    const th = (90 + grid.southPoleLat) * rad;
    const ph = grid.southPoleLon * rad;
    const x = Math.cos(la * rad) * Math.cos(lo * rad - ph);
    const y = Math.cos(la * rad) * Math.sin(lo * rad - ph);
    const z = Math.sin(la * rad);
    const x2 = Math.cos(th) * x + Math.sin(th) * z;
    const z2 = -Math.sin(th) * x + Math.cos(th) * z;
    return { rlat: Math.asin(z2) / rad, rlon: Math.atan2(y, x2) / rad };
  };
  const a = rot(lat, lon);
  const b = rot(lat + 0.05, lon);
  const dx = (b.rlon - a.rlon) * Math.cos(a.rlat * rad);
  const dy = b.rlat - a.rlat;
  return Math.atan2(dx, dy) / rad;
}

export class CosmoForecast {
  private store: Store | null = null;
  private busy = false;
  private progress: string | null = null;
  private error: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {
    this.load();
  }

  start(): void {
    this.startTimer = setTimeout(() => void this.update(), 30_000);
    this.timer = setInterval(() => void this.update(), CHECK_EVERY_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startTimer) clearTimeout(this.startTimer);
    this.abort?.abort();
  }

  status(): CosmoStatus {
    return {
      run: this.store?.run ?? null,
      generatedAt: this.store?.generatedAt ?? null,
      busy: this.busy,
      progress: this.progress,
      error: this.error,
    };
  }

  /** Prognoza dla punktu (współrzędne stacji meteo IMGW) — kroki od teraz. */
  forecast(lat: number, lon: number, now = Date.now()): PointForecast | null {
    const s = this.store;
    if (!s) return null;
    const idx = s.points.findIndex((p) => p.key === pointKey(lat, lon));
    if (idx < 0) return null;
    const angle = s.northAngle[idx] ?? 0;
    const steps: ForecastStep[] = [];
    for (let k = 0; k < s.steps.length; k++) {
      const st = s.steps[k];
      const v = st.values[idx] ?? {};
      const prev = k > 0 ? s.steps[k - 1].values[idx] ?? {} : null;
      const t = new Date(st.time).getTime();
      if (t < now - STEP_HOURS * 3600_000 || !prev) continue;
      const diff = (a?: number | null, b?: number | null) => (a != null && b != null ? Math.max(0, a - b) : null);
      const snowNow = (v.snowGsp ?? 0) + (v.snowCon ?? 0);
      const snowPrev = (prev.snowGsp ?? 0) + (prev.snowCon ?? 0);
      const temp = v.t2m != null ? v.t2m - 273.15 : null;
      const dew = v.td2m != null ? v.td2m - 273.15 : null;
      const wind = v.u10 != null && v.v10 != null ? Math.hypot(v.u10, v.v10) : null;
      let dir: number | null = null;
      if (wind != null && wind > 0.2 && v.u10 != null && v.v10 != null) {
        // Kierunek, z którego wieje, w układzie siatki → poprawka do północy geograficznej
        const gridDir = (Math.atan2(-v.u10, -v.v10) * 180) / Math.PI;
        dir = (((gridDir - angle) % 360) + 360) % 360;
      }
      const cloud = v.cloud != null ? (v.cloud <= 1.0001 ? v.cloud * 100 : v.cloud) : null;
      steps.push({
        time: st.time,
        temp: round(temp, 1),
        dewPoint: round(dew, 1),
        humidity: temp != null && dew != null ? round(Math.min(100, 100 * magnus(dew) / magnus(temp)), 0) : null,
        wind: round(wind, 1),
        windDir: round(dir, 0),
        gust: round(v.gust ?? null, 1),
        pressure: round(v.pmsl != null ? v.pmsl / 100 : null, 1),
        cloud: round(cloud, 0),
        precip: round(diff(v.totPrec, prev.totPrec), 1),
        snow: round(diff(snowNow, snowPrev), 1),
      });
    }
    return { run: s.run, model: 'COSMO 2,8 km (IMGW-PIB)', steps };
  }

  /** Sprawdza, czy jest nowszy przebieg modelu, i jeśli tak — pobiera go. */
  async update(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      const latest = await this.latestRun();
      if (!latest) throw new Error('IMGW nie udostępnia teraz żadnego przebiegu modelu COSMO.');
      if (this.store?.run === latest.run) return;
      await this.process(latest.run, latest.files);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      console.warn('[COSMO]', this.error);
    } finally {
      this.busy = false;
      this.progress = null;
    }
  }

  private async latestRun(): Promise<{ run: string; files: { file: string; url: string }[] } | null> {
    let best: { run: string; files: { file: string; url: string }[] } | null = null;
    for (const cycle of CYCLES) {
      try {
        const res = await this.fetchImpl(LIST_URL(cycle), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
        if (!res.ok) continue;
        const list = (await res.json()) as { file: string; url: string }[];
        if (!Array.isArray(list)) continue;
        const files = list.filter((f) => /^\d{12}_\d{12}_lfff\d{8}$/.test(f.file));
        if (files.length === 0) continue;
        const run = files[0].file.slice(0, 12);
        if (!best || run > best.run) best = { run, files };
      } catch {
        // spróbujemy kolejnego cyklu
      }
    }
    return best;
  }

  private async process(run: string, files: { file: string; url: string }[]): Promise<void> {
    const now = Date.now();
    // Co 3 h, od kroku sprzed teraz (potrzebny do policzenia opadu w pierwszym przedziale)
    const chosen = files
      .map((f) => {
        const lead = +f.file.slice(-8, -6) * 24 + +f.file.slice(-6, -4);
        return { ...f, lead, valid: parseStamp(f.file.slice(13, 25)) };
      })
      .filter((f) => f.lead % STEP_HOURS === 0 && f.valid.getTime() >= now - 2 * STEP_HOURS * 3600_000)
      .sort((a, b) => a.lead - b.lead);
    if (chosen.length < 2) throw new Error(`Przebieg ${run} nie ma już kroków w przyszłości.`);

    const stations = await getImgwMeteoStations('', 5000);
    const points: { key: string; lat: number; lon: number }[] = [];
    const seen = new Set<string>();
    for (const m of stations) {
      const c = stationCoords(m);
      if (!c) continue;
      const key = pointKey(c.lat, c.lon);
      if (seen.has(key)) continue;
      seen.add(key);
      points.push({ key, lat: c.lat, lon: c.lon });
    }
    if (points.length === 0) throw new Error('Brak współrzędnych stacji IMGW.');

    let grid: RotatedGrid | null = null;
    let indices: (number | null)[] = [];
    const steps: RawStep[] = [];
    for (let n = 0; n < chosen.length; n++) {
      const f = chosen[n];
      this.progress = `Pobieranie prognozy: krok ${n + 1}/${chosen.length} (+${f.lead} h)`;
      const values: Partial<Record<Field, number | null>>[] = points.map(() => ({}));
      await this.readFile(f.url, (msg) => {
        if (!grid) {
          grid = readRotatedGrid(msg);
          indices = points.map((p) => rotatedIndex(grid!, p.lat, p.lon));
        }
        const g = parseGrib1(msg);
        const field = FIELD_KEYS.find((k) => {
          const [t, p, lt, lv] = FIELDS[k];
          return g.table === t && g.param === p && g.levelType === lt && (lt === 105 ? g.level2 === lv : true);
        });
        if (!field) return false;
        for (let i = 0; i < points.length; i++) {
          const idx = indices[i];
          values[i][field] = idx == null ? null : g.valueAt(idx);
        }
        return FIELD_KEYS.every((k) => k in values[0]);
      });
      steps.push({ time: f.valid.toISOString(), values });
    }
    const g = grid as RotatedGrid | null;
    this.store = {
      run,
      generatedAt: new Date().toISOString(),
      points,
      northAngle: points.map((p) => (g ? round(northAngle(g, p.lat, p.lon), 2) ?? 0 : 0)),
      steps,
    };
    this.save();
    console.log(`[COSMO] Prognoza z przebiegu ${run}: ${steps.length} kroków, ${points.length} punktów.`);
  }

  /**
   * Czyta komunikaty GRIB po kolei ze strumienia HTTP. `onMessage` zwraca true, gdy ma już wszystko —
   * wtedy przerywamy pobieranie (reszta pliku to pola, których nie używamy).
   */
  private async readFile(url: string, onMessage: (msg: Buffer) => boolean): Promise<void> {
    this.abort = new AbortController();
    const timeout = setTimeout(() => this.abort?.abort(), 5 * 60_000);
    try {
      const res = await this.fetchImpl(url, { signal: this.abort.signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      let buf = Buffer.alloc(0);
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buf = buf.length ? Buffer.concat([buf, Buffer.from(value)]) : Buffer.from(value);
        for (;;) {
          if (buf.length < 8) break;
          const len = grib1Length(buf);
          if (len == null) throw new Error('Plik prognozy nie jest w formacie GRIB1.');
          if (buf.length < len) break;
          const msg = buf.subarray(0, len);
          buf = buf.subarray(len);
          if (onMessage(msg)) {
            await reader.cancel().catch(() => undefined);
            return;
          }
        }
        if (done) return;
      }
    } finally {
      clearTimeout(timeout);
      this.abort = null;
    }
  }

  private load(): void {
    try {
      const file = dataPath(STORE_FILE);
      if (existsSync(file)) this.store = JSON.parse(readFileSync(file, 'utf-8')) as Store;
    } catch (err) {
      console.warn('[COSMO] Nie udało się wczytać zapisanej prognozy:', err);
    }
  }

  private save(): void {
    try {
      writeFileSync(dataPath(STORE_FILE), JSON.stringify(this.store));
    } catch (err) {
      console.warn('[COSMO] Nie udało się zapisać prognozy:', err);
    }
  }
}

function magnus(t: number): number {
  return Math.exp((17.62 * t) / (243.12 + t));
}

function round(v: number | null | undefined, digits: number): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
