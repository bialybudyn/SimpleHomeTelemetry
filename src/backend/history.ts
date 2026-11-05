import type { Db } from './db';
import type { HistoryStats, TelemetryPoint } from '../app/models/telemetry.models';

const HOUR = 3600_000;
/** Ta sama wartość nie jest zapisywana częściej niż co tyle ms (oszczędza miejsce). */
const SAME_VALUE_INTERVAL = 5 * 60_000;

export const RANGE_MS: Record<string, number> = {
  '1h': HOUR,
  '6h': 6 * HOUR,
  '24h': 24 * HOUR,
  '7d': 7 * 24 * HOUR,
  '30d': 30 * 24 * HOUR,
  '90d': 90 * 24 * HOUR,
  '360d': 360 * 24 * HOUR,
  '720d': 720 * 24 * HOUR,
};

/** Klucze atrybutów zdarzeniowych — dla nich zwracamy surowe zmiany, a nie średnie. */
const EVENT_KEYS = new Set(['contact', 'occupancy', 'presence', 'water_leak', 'smoke', 'state']);

/**
 * Historia telemetrii: surowe próbki (krótka retencja) + agregaty godzinowe (długa retencja).
 */
export class History {
  private last = new Map<string, { ts: number; value: number }>();

  constructor(private readonly db: Db) {}

  record(device: string, samples: Record<string, number>, ts = Date.now()): void {
    const insertSample = this.db.sql.prepare('INSERT INTO samples (device, key, ts, value) VALUES (?, ?, ?, ?)');
    const upsertHourly = this.db.sql.prepare(`
      INSERT INTO hourly (device, key, hour, sum, min, max, count) VALUES (?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(device, key, hour) DO UPDATE SET
        sum = sum + excluded.sum,
        min = MIN(min, excluded.min),
        max = MAX(max, excluded.max),
        count = count + 1
    `);
    const hour = Math.floor(ts / HOUR) * HOUR;
    for (const [key, value] of Object.entries(samples)) {
      const cacheKey = `${device}\u0000${key}`;
      const prev = this.last.get(cacheKey);
      if (prev && prev.value === value && ts - prev.ts < SAME_VALUE_INTERVAL) continue;
      this.last.set(cacheKey, { ts, value });
      insertSample.run(device, key, ts, value);
      upsertHourly.run(device, key, hour, value, value, value);
    }
  }

  /** Usuwa stare dane zgodnie z retencją. */
  prune(rawRetentionDays: number, hourlyRetentionDays: number, now = Date.now()): void {
    this.db.sql.prepare('DELETE FROM samples WHERE ts < ?').run(now - rawRetentionDays * 24 * HOUR);
    this.db.sql.prepare('DELETE FROM hourly WHERE hour < ?').run(now - hourlyRetentionDays * 24 * HOUR);
  }

  deleteDevice(device: string): void {
    this.db.sql.prepare('DELETE FROM samples WHERE device = ?').run(device);
    this.db.sql.prepare('DELETE FROM hourly WHERE device = ?').run(device);
    for (const k of this.last.keys()) if (k.startsWith(`${device}\u0000`)) this.last.delete(k);
  }

  renameDevice(from: string, to: string): void {
    this.db.sql.prepare('UPDATE samples SET device = ? WHERE device = ?').run(to, from);
    this.db.sql.prepare('UPDATE OR REPLACE hourly SET device = ? WHERE device = ?').run(to, from);
  }

  clear(): void {
    this.db.sql.exec('DELETE FROM samples; DELETE FROM hourly;');
    this.last.clear();
  }

  /**
   * Zwraca historię w formacie oczekiwanym przez frontend (TelemetryPoint[] + statystyki).
   * Zakresy do 7 dni korzystają z surowych próbek, dłuższe z agregatów godzinowych.
   */
  query(device: string, range: string, eventSensor: boolean, now = Date.now()) {
    const span = RANGE_MS[range] ?? RANGE_MS['24h'];
    const from = now - span;
    const useRaw = span <= RANGE_MS['7d'] || eventSensor;
    const targetPoints = 150;
    const bucket = Math.max(useRaw ? 60_000 : HOUR, Math.ceil(span / targetPoints));

    type Row = { key: string; ts: number; value: number; min?: number; max?: number };
    let rows: Row[];
    if (useRaw) {
      rows = this.db.sql
        .prepare('SELECT key, ts, value FROM samples WHERE device = ? AND ts >= ? ORDER BY ts')
        .all(device, from) as Row[];
    } else {
      rows = this.db.sql
        .prepare('SELECT key, hour AS ts, sum / count AS value, min, max FROM hourly WHERE device = ? AND hour >= ? ORDER BY hour')
        .all(device, from) as Row[];
    }

    // Grupowanie w kubełki czasowe; zdarzenia (kontakt, ruch, stan) bez uśredniania
    const buckets = new Map<number, Map<string, { sum: number; n: number; last: number }>>();
    const events: { ts: number; key: string; value: number }[] = [];
    const stats = new Map<string, { min: number; max: number; sum: number; n: number }>();

    for (const r of rows) {
      const s = stats.get(r.key) ?? { min: Infinity, max: -Infinity, sum: 0, n: 0 };
      s.min = Math.min(s.min, r.min ?? r.value);
      s.max = Math.max(s.max, r.max ?? r.value);
      s.sum += r.value;
      s.n++;
      stats.set(r.key, s);

      if (EVENT_KEYS.has(r.key) && useRaw) {
        events.push({ ts: r.ts, key: r.key, value: r.value });
        continue;
      }
      const b = Math.floor(r.ts / bucket) * bucket;
      const m = buckets.get(b) ?? new Map();
      const agg = m.get(r.key) ?? { sum: 0, n: 0, last: r.value };
      agg.sum += r.value;
      agg.n++;
      agg.last = r.value;
      m.set(r.key, agg);
      buckets.set(b, m);
    }

    const points: TelemetryPoint[] = [];
    let id = 1;
    for (const [ts, m] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
      const values: Record<string, number> = {};
      for (const [k, a] of m) values[k] = Math.round((a.sum / a.n) * 100) / 100;
      points.push(toPoint(id++, device, ts, values));
    }
    for (const e of events) {
      points.push(toPoint(id++, device, e.ts, { [e.key]: e.value }));
    }
    points.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return { points, stats: buildStats(stats, events) };
  }
}

function pick(values: Record<string, number>, ...keys: string[]): number | null {
  for (const k of keys) if (values[k] !== undefined) return values[k];
  return null;
}

function toPoint(id: number, device: string, ts: number, values: Record<string, number>): TelemetryPoint {
  const bool = (k: string) => (values[k] === undefined ? null : values[k] >= 0.5);
  const state = values['state'];
  return {
    id,
    device_ieee: device,
    timestamp: new Date(ts).toISOString(),
    temperature: pick(values, 'temperature', 'local_temperature'),
    humidity: pick(values, 'humidity'),
    battery: pick(values, 'battery'),
    linkquality: pick(values, 'linkquality'),
    power: pick(values, 'power'),
    voltage: pick(values, 'voltage'),
    current: pick(values, 'current'),
    energy: pick(values, 'energy'),
    setpoint: pick(values, 'occupied_heating_setpoint', 'current_heating_setpoint'),
    state: state === undefined ? null : state >= 0.5 ? 'ON' : 'OFF',
    contact: bool('contact'),
    occupancy: values['occupancy'] !== undefined ? bool('occupancy') : bool('presence'),
    water_leak: bool('water_leak'),
    values,
  } as TelemetryPoint;
}

function buildStats(
  stats: Map<string, { min: number; max: number; sum: number; n: number }>,
  events: { ts: number; key: string; value: number }[],
): HistoryStats {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const t = stats.get('temperature') ?? stats.get('local_temperature');
  const h = stats.get('humidity');
  const count = [...stats.values()].reduce((acc, s) => Math.max(acc, s.n), 0);
  let lastEvent: string | undefined;
  let motion = 0;
  let open = 0;
  let leak = 0;
  for (const e of events) {
    if ((e.key === 'occupancy' || e.key === 'presence') && e.value === 1) motion++;
    else if (e.key === 'contact' && e.value === 0) open++;
    else if (e.key === 'water_leak' && e.value === 1) leak++;
    else continue;
    lastEvent = new Date(e.ts).toISOString();
  }
  if (count === 0) return {};
  return {
    count,
    min_temp: t ? r1(t.min) : undefined,
    max_temp: t ? r1(t.max) : undefined,
    avg_temp: t ? r1(t.sum / t.n) : undefined,
    min_hum: h ? r1(h.min) : undefined,
    max_hum: h ? r1(h.max) : undefined,
    avg_hum: h ? r1(h.sum / h.n) : undefined,
    motion_count: motion,
    open_count: open,
    leak_count: leak,
    last_event_time: lastEvent,
  };
}
