import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { dataPath } from '../config';
import { normalizePl } from '../imgw';

/**
 * Normy klimatyczne i rekordy ze stacji synoptycznych IMGW (archiwum miesięczne).
 * Norma = średnia z lat 1991–2020 (standard WMO); rekordy z całego pobranego okresu.
 * Archiwum pobieramy raz (~1 MB), a potem odświeżamy co 30 dni (dochodzi nowy rok).
 */

const BASE = 'https://danepubliczne.imgw.pl/data/dane_pomiarowo_obserwacyjne/dane_meteorologiczne/miesieczne/synop';
const STORE_FILE = 'climate_normals.json';
const REFRESH_MS = 30 * 24 * 3600_000;
const NORMAL_FROM = 1991;
const NORMAL_TO = 2020;

export interface MonthNormal {
  month: number;
  /** Średnie z 1991–2020. */
  temp: number | null;
  tempMax: number | null;
  tempMin: number | null;
  precip: number | null;
  sunshine: number | null;
  snowDays: number | null;
  /** Rekordy z całego okresu. */
  recordMax: { value: number; year: number } | null;
  recordMin: { value: number; year: number } | null;
  recordPrecip: { value: number; year: number } | null;
  years: number;
}

export interface StationClimate {
  code: string;
  name: string;
  firstYear: number;
  lastYear: number;
  months: MonthNormal[];
  /** Ostatnie lata: średnia temperatura i suma opadu miesiąca (do porównania z normą). */
  recent: { year: number; month: number; temp: number | null; precip: number | null }[];
}

interface Store {
  generatedAt: string;
  stations: StationClimate[];
}

/** Pliki ZIP archiwum: 1991_1995 … 1996_2000 (pięciolatki), potem roczne. */
export function archiveFiles(lastYear: number): string[] {
  const out = ['1991_1995/1991_1995_m_s.zip', '1996_2000/1996_2000_m_s.zip'];
  for (let y = 2001; y <= lastYear; y++) out.push(`${y}/${y}_m_s.zip`);
  return out;
}

/** Wypakowanie wszystkich plików z ZIP (deflate lub bez kompresji). */
export function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Uszkodzony plik ZIP.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Uszkodzony katalog ZIP.');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('latin1', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + csize);
    out.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

interface MonthRow {
  code: string;
  name: string;
  year: number;
  month: number;
  tmax: number | null;
  tmaxMean: number | null;
  tmin: number | null;
  tminMean: number | null;
  temp: number | null;
  precip: number | null;
  precipMaxDay: number | null;
  sunshine: number | null;
  snowDays: number | null;
}

/** Wiersz pliku s_m_d (dane miesięczne z obserwacji dobowych). Status „8” = brak pomiaru. */
export function parseMonthRow(line: string): MonthRow | null {
  const f = parseCsvLine(line.trim());
  if (f.length < 30) return null;
  const num = (i: number) => {
    if (f[i + 1] === '8') return null;
    const v = parseFloat(f[i]);
    return Number.isFinite(v) ? v : null;
  };
  const year = parseInt(f[2], 10);
  const month = parseInt(f[3], 10);
  if (!year || !month) return null;
  return {
    code: f[0],
    name: f[1],
    year,
    month,
    tmax: num(4),
    tmaxMean: num(6),
    tmin: num(8),
    tminMean: num(10),
    temp: num(12),
    precip: num(16),
    precipMaxDay: num(18),
    sunshine: num(22),
    snowDays: num(26), // liczba dni z pokrywą śnieżną
  };
}

const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

export function buildClimate(rows: MonthRow[]): StationClimate[] {
  const byStation = new Map<string, MonthRow[]>();
  for (const r of rows) {
    const list = byStation.get(r.code) ?? [];
    list.push(r);
    byStation.set(r.code, list);
  }
  const out: StationClimate[] = [];
  for (const [code, list] of byStation) {
    const years = list.map((r) => r.year);
    const lastYear = Math.max(...years);
    const months: MonthNormal[] = [];
    for (let m = 1; m <= 12; m++) {
      const all = list.filter((r) => r.month === m);
      const normal = all.filter((r) => r.year >= NORMAL_FROM && r.year <= NORMAL_TO);
      const rec = (pick: (r: MonthRow) => number | null, better: (a: number, b: number) => boolean) => {
        let best: { value: number; year: number } | null = null;
        for (const r of all) {
          const v = pick(r);
          if (v != null && (!best || better(v, best.value))) best = { value: v, year: r.year };
        }
        return best;
      };
      months.push({
        month: m,
        temp: mean(normal.map((r) => r.temp)),
        tempMax: mean(normal.map((r) => r.tmaxMean)),
        tempMin: mean(normal.map((r) => r.tminMean)),
        precip: mean(normal.map((r) => r.precip)),
        sunshine: mean(normal.map((r) => r.sunshine)),
        snowDays: mean(normal.map((r) => r.snowDays)),
        recordMax: rec((r) => r.tmax, (a, b) => a > b),
        recordMin: rec((r) => r.tmin, (a, b) => a < b),
        recordPrecip: rec((r) => r.precipMaxDay, (a, b) => a > b),
        years: normal.length,
      });
    }
    if (months.every((m) => m.years < 10)) continue; // za krótka seria na normę
    out.push({
      code,
      name: list[list.length - 1].name,
      firstYear: Math.min(...years),
      lastYear,
      months,
      recent: list
        .filter((r) => r.year >= lastYear - 2)
        .sort((a, b) => a.year - b.year || a.month - b.month)
        .map((r) => ({ year: r.year, month: r.month, temp: r.temp, precip: r.precip })),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

export class ClimateNormals {
  private store: Store | null = null;
  private busy: Promise<void> | null = null;
  private error: string | null = null;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {
    try {
      const file = dataPath(STORE_FILE);
      if (existsSync(file)) this.store = JSON.parse(readFileSync(file, 'utf-8')) as Store;
    } catch {
      this.store = null;
    }
  }

  status(): { generatedAt: string | null; stations: number; busy: boolean; error: string | null } {
    return { generatedAt: this.store?.generatedAt ?? null, stations: this.store?.stations.length ?? 0, busy: !!this.busy, error: this.error };
  }

  /** Klimat stacji synoptycznej dopasowanej po nazwie (np. „Warszawa” → „WARSZAWA-OKĘCIE”). */
  async forStation(name: string): Promise<StationClimate | null> {
    await this.ensure();
    const stations = this.store?.stations ?? [];
    const n = normalizePl(name).replace(/[^a-z]/g, '');
    if (!n) return null;
    const norm = (s: string) => normalizePl(s).replace(/[^a-z]/g, '');
    return stations.find((s) => norm(s.name) === n) ?? stations.find((s) => norm(s.name).startsWith(n)) ?? stations.find((s) => n.startsWith(norm(s.name))) ?? null;
  }

  async ensure(): Promise<void> {
    const fresh = this.store && Date.now() - new Date(this.store.generatedAt).getTime() < REFRESH_MS;
    if (fresh) return;
    if (!this.busy) {
      this.busy = this.download().finally(() => {
        this.busy = null;
      });
    }
    // Pierwsze pobranie: czekamy; odświeżenie: oddajemy stare dane od razu
    if (!this.store) await this.busy;
  }

  private async download(): Promise<void> {
    this.error = null;
    try {
      const rows: MonthRow[] = [];
      const thisYear = new Date().getFullYear();
      for (const file of archiveFiles(thisYear - 1)) {
        const res = await this.fetchImpl(`${BASE}/${file}`, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) continue; // roku może jeszcze nie być w archiwum
        const entries = unzip(Buffer.from(await res.arrayBuffer()));
        for (const [name, data] of entries) {
          if (!/^s_m_d_/.test(name)) continue;
          const text = new TextDecoder('windows-1250').decode(data);
          for (const line of text.split(/\r?\n/)) {
            const r = line ? parseMonthRow(line) : null;
            if (r) rows.push(r);
          }
        }
      }
      if (rows.length === 0) throw new Error('Nie udało się pobrać archiwum IMGW.');
      this.store = { generatedAt: new Date().toISOString(), stations: buildClimate(rows) };
      writeFileSync(dataPath(STORE_FILE), JSON.stringify(this.store));
      console.log(`[KLIMAT] Normy dla ${this.store.stations.length} stacji z ${rows.length} miesięcy pomiarów.`);
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      console.warn('[KLIMAT]', this.error);
    }
  }
}
