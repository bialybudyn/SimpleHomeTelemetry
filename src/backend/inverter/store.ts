import type { Db } from '../db';
import type { InverterDaily, InverterHistoryPoint, InverterLive } from '../../app/models/inverter.models';

/** Wielkości zapisywane w historii (średnie z okna 5 min). */
export const SAMPLE_KEYS = [
  'pv_power', 'pv1_power', 'pv2_power', 'load_power', 'grid_power', 'battery_power', 'battery_soc',
  'battery_voltage', 'battery_temp', 'inverter_power', 'radiator_temp', 'dc_temp',
  'grid_l1_power', 'grid_l2_power', 'grid_l3_power', 'load_l1_power', 'load_l2_power', 'load_l3_power',
  'grid_l1_voltage', 'grid_l2_voltage', 'grid_l3_voltage', 'grid_frequency',
] as const;
type SampleKey = (typeof SAMPLE_KEYS)[number];

export const SAMPLE_WINDOW_MS = 5 * 60_000;
const DAY_MS = 24 * 3600_000;

/** Zakres wykresu → szerokość kubełka (ok. 150–350 punktów). */
export const RANGES: Record<string, { span: number; bucket: number }> = {
  '24h': { span: DAY_MS, bucket: SAMPLE_WINDOW_MS },
  '7d': { span: 7 * DAY_MS, bucket: 30 * 60_000 },
  '30d': { span: 30 * DAY_MS, bucket: 2 * 3600_000 },
  '365d': { span: 365 * DAY_MS, bucket: DAY_MS },
};

/**
 * Historia falownika: próbki co 5 min (średnia z odczytów w oknie) i liczniki dzienne wg zegara falownika.
 * Oddzielnie od historii czujników, bo falownik ma kilkadziesiąt wielkości i własną retencję (rok).
 */
export class InverterStore {
  private window: { start: number; sums: Map<SampleKey, { sum: number; n: number }> } | null = null;

  constructor(private readonly db: Db) {
    db.sql.exec(`
      CREATE TABLE IF NOT EXISTS inverter_samples (ts INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS inverter_daily (
        day TEXT PRIMARY KEY,
        pv REAL, load REAL, grid_import REAL, grid_export REAL, battery_charge REAL, battery_discharge REAL,
        updated_at INTEGER NOT NULL
      );
    `);
    // Kolumny dodawane po kolei — nowe wielkości nie wymagają ręcznej migracji
    const have = new Set((db.sql.prepare('PRAGMA table_info(inverter_samples)').all() as { name: string }[]).map((c) => c.name));
    for (const k of SAMPLE_KEYS) if (!have.has(k)) db.sql.exec(`ALTER TABLE inverter_samples ADD COLUMN ${k} REAL`);
  }

  /** Dodaje odczyt do bieżącego okna; po przejściu do następnego okna zapisuje średnie. */
  add(live: InverterLive, ts = Date.now(), day: string | null = null): void {
    const start = Math.floor(ts / SAMPLE_WINDOW_MS) * SAMPLE_WINDOW_MS;
    if (this.window && this.window.start !== start) this.flush();
    if (!this.window) this.window = { start, sums: new Map() };
    for (const k of SAMPLE_KEYS) {
      const v = live[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const s = this.window.sums.get(k) ?? { sum: 0, n: 0 };
      s.sum += v;
      s.n++;
      this.window.sums.set(k, s);
    }
    if (day) this.saveDaily(day, live, ts);
  }

  flush(): void {
    const w = this.window;
    this.window = null;
    if (!w || w.sums.size === 0) return;
    const keys = [...w.sums.keys()];
    const values = keys.map((k) => {
      const s = w.sums.get(k)!;
      return Math.round((s.sum / s.n) * 100) / 100;
    });
    this.db.sql
      .prepare(`INSERT OR REPLACE INTO inverter_samples (ts, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`)
      .run(w.start, ...values);
  }

  /** Liczniki dzienne falownika rosną przez cały dzień — zapisujemy ostatnią wartość. */
  private saveDaily(day: string, live: InverterLive, ts: number): void {
    const t = live.today;
    this.db.sql
      .prepare(`INSERT INTO inverter_daily (day, pv, load, grid_import, grid_export, battery_charge, battery_discharge, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(day) DO UPDATE SET pv = excluded.pv, load = excluded.load, grid_import = excluded.grid_import,
          grid_export = excluded.grid_export, battery_charge = excluded.battery_charge,
          battery_discharge = excluded.battery_discharge, updated_at = excluded.updated_at`)
      .run(day, t.pv, t.load, t.grid_import, t.grid_export, t.battery_charge, t.battery_discharge, ts);
  }

  history(range: string, now = Date.now()): { range: string; bucket_seconds: number; points: InverterHistoryPoint[] } {
    const r = RANGES[range] ?? RANGES['24h'];
    // Kubełki dobowe wg czasu lokalnego serwera, a nie UTC (inaczej noc trafiałaby do poprzedniego dnia)
    const offset = r.bucket >= DAY_MS ? -new Date(now).getTimezoneOffset() * 60_000 : 0;
    const cols = ['pv_power', 'load_power', 'grid_power', 'battery_power', 'battery_soc', 'battery_temp', 'radiator_temp',
      'grid_l1_voltage', 'grid_l2_voltage', 'grid_l3_voltage'] as const;
    const rows = this.db.sql
      // CAST: node:sqlite przekazuje liczby jako REAL, więc samo "/" nie obcinałoby do pełnych kubełków
      .prepare(`SELECT CAST((ts + ?) / ? AS INTEGER) * ? - ? AS t, ${cols.map((c) => `ROUND(AVG(${c}), 1) AS ${c}`).join(', ')}
        FROM inverter_samples WHERE ts >= ? GROUP BY t ORDER BY t`)
      .all(offset, r.bucket, r.bucket, offset, now - r.span) as Array<Record<string, number | null>>;
    return {
      range: range in RANGES ? range : '24h',
      bucket_seconds: r.bucket / 1000,
      points: rows.map((row) => {
        const p: Record<string, unknown> = { timestamp: new Date(Number(row['t'])).toISOString() };
        for (const c of cols) p[c] = row[c] ?? null;
        return p as unknown as InverterHistoryPoint;
      }),
    };
  }

  daily(days: number, now = new Date()): InverterDaily[] {
    const from = new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
    return this.db.sql
      .prepare('SELECT day, pv, load, grid_import, grid_export, battery_charge, battery_discharge FROM inverter_daily WHERE day > ? ORDER BY day')
      .all(from) as unknown as InverterDaily[];
  }

  prune(retentionDays: number, now = Date.now()): void {
    const cutoff = now - retentionDays * DAY_MS;
    this.db.sql.prepare('DELETE FROM inverter_samples WHERE ts < ?').run(cutoff);
    this.db.sql.prepare('DELETE FROM inverter_daily WHERE day < ?').run(new Date(cutoff).toISOString().slice(0, 10));
  }
}
