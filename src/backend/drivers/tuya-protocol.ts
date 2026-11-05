import type { TuyaDpSpec } from '../../app/models/telemetry.models';

/**
 * Tłumaczenie punktów danych (DP) Tuya na atrybuty panelu i z powrotem.
 * Mapa DP (id -> kod funkcji, typ, zakres/skala) pochodzi z chmury Tuya (import kodem QR)
 * albo z ręcznej konfiguracji. Bez mapy DP są widoczne jako `dp_<id>`.
 */

/** Kod funkcji Tuya -> atrybut panelu. */
const CODE_TO_ATTR: Record<string, string> = {
  switch: 'state',
  switch_1: 'state',
  switch_led: 'state',
  cur_power: 'power',
  cur_voltage: 'voltage',
  cur_current: 'current',
  add_ele: 'energy',
  temp_current: 'temperature',
  va_temperature: 'temperature',
  humidity_value: 'humidity',
  va_humidity: 'humidity',
  battery_percentage: 'battery',
  va_battery: 'battery',
  smoke_sensor_status: 'smoke_status',
  smoke_sensor_state: 'smoke',
  fan_speed: 'fan_speed',
  fan_speed_enum: 'fan_speed',
  fan_speed_percent: 'fan_speed',
  mode: 'fan_mode',
  fan_mode: 'fan_mode',
  switch_horizontal: 'fan_oscillation',
  switch_vertical: 'fan_oscillation_vertical',
  shake: 'fan_oscillation',
  countdown_set: 'fan_timer',
  anion: 'fan_ionizer',
  humidifier: 'fan_humidifier',
  switch_uv: 'fan_uv',
  uv: 'fan_uv',
  sterilization: 'fan_uv',
  child_lock: 'child_lock',
  relay_status: 'power_on_behavior',
};

/** Domyślny schemat gniazdka Tuya (standardowy dla większości smart plugów z pomiarem energii). */
export const DEFAULT_PLUG_DP_MAP: Record<string, TuyaDpSpec> = {
  '1': { code: 'switch_1', type: 'Boolean' },
  '17': { code: 'add_ele', type: 'Integer', values: { scale: 3, unit: 'kWh' } },
  '18': { code: 'cur_current', type: 'Integer', values: { scale: 0, unit: 'mA' } },
  '19': { code: 'cur_power', type: 'Integer', values: { scale: 1, unit: 'W' } },
  '20': { code: 'cur_voltage', type: 'Integer', values: { scale: 1, unit: 'V' } },
};

function scaleOf(spec: TuyaDpSpec): number {
  const v = spec.values as { scale?: number } | undefined;
  return typeof v?.scale === 'number' ? v.scale : 0;
}

function unitOf(spec: TuyaDpSpec): string {
  const v = spec.values as { unit?: string } | undefined;
  return typeof v?.unit === 'string' ? v.unit : '';
}

/** Zamienia kod funkcji na atrybut panelu (switch_2 -> state_l2, nieznane -> kod). */
export function attrForCode(code: string): string {
  if (CODE_TO_ATTR[code]) return CODE_TO_ATTR[code];
  const m = code.match(/^switch_(\d+)$/);
  if (m) return `state_l${m[1]}`;
  return code;
}

/** DP -> znormalizowany stan. */
export function normalizeTuyaDps(dps: Record<string, unknown>, dpMap: Record<string, TuyaDpSpec> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [dpId, raw] of Object.entries(dps)) {
    out[`dp_${dpId}`] = raw;
    const spec = dpMap?.[dpId];
    if (!spec) continue;
    const attr = attrForCode(spec.code);
    let value: unknown = raw;
    if (typeof raw === 'number' && (spec.type === 'Integer' || spec.type === 'Value')) {
      value = raw / Math.pow(10, scaleOf(spec));
      if (attr === 'current' && unitOf(spec).toLowerCase() === 'ma') value = (value as number) / 1000;
    }
    if (attr === 'state' || attr.startsWith('state_l')) {
      value = raw === true ? 'ON' : raw === false ? 'OFF' : raw;
    }
    if (attr === 'smoke') value = raw === '1' || raw === 'alarm' || raw === true;
    out[attr] = value;
    // Pierwszy kanał listwy jest też "głównym" stanem kafelka
    if (attr === 'state_l1') out['state'] = value;
  }
  return out;
}

/** Polecenie z panelu -> DP do wysłania. Obsługuje `dps: {...}` i klucze `dp_<id>` bez mapy. */
export function commandToDps(command: Record<string, unknown>, dpMap: Record<string, TuyaDpSpec> | null | undefined): Record<string, unknown> {
  const dps: Record<string, unknown> = {};
  const raw = command['dps'];
  if (raw && typeof raw === 'object') Object.assign(dps, raw as Record<string, unknown>);

  const byAttr = new Map<string, [string, TuyaDpSpec]>();
  for (const [dpId, spec] of Object.entries(dpMap ?? {})) {
    const attr = attrForCode(spec.code);
    if (!byAttr.has(attr)) byAttr.set(attr, [dpId, spec]);
    if (attr === 'state_l1' && !byAttr.has('state')) byAttr.set('state', [dpId, spec]);
  }

  for (const [key, value] of Object.entries(command)) {
    if (key === 'dps' || value === undefined) continue;
    const dpMatch = key.match(/^dp_(\d+)$/);
    if (dpMatch) {
      dps[dpMatch[1]] = value;
      continue;
    }
    const hit = byAttr.get(key);
    if (!hit) continue;
    const [dpId, spec] = hit;
    let v: unknown = value;
    if (key === 'state' || key.startsWith('state_l')) v = String(value).toUpperCase() === 'ON' || value === true;
    else if (spec.type === 'Integer' && typeof value === 'number') v = Math.round(value * Math.pow(10, scaleOf(spec)));
    else if (spec.type === 'Enum') v = String(value);
    else if (spec.type === 'Boolean') v = Boolean(value);
    dps[dpId] = v;
  }
  return dps;
}

/**
 * Przetwarza odpowiedź chmury Tuya `dpStatusRelationDTOS` na mapę DP.
 * valueDesc to JSON w tekście, np. {"min":0,"max":99999,"scale":1,"unit":"W"} lub {"range":["1","2"]}.
 */
export function dpMapFromCloud(relations: Array<Record<string, unknown>>): Record<string, TuyaDpSpec> {
  const map: Record<string, TuyaDpSpec> = {};
  for (const r of relations) {
    const dpId = r['dpId'];
    const code = r['statusCode'];
    if (dpId === undefined || typeof code !== 'string') continue;
    let values: unknown = undefined;
    if (typeof r['valueDesc'] === 'string') {
      try {
        values = JSON.parse(r['valueDesc']);
      } catch {
        values = r['valueDesc'];
      }
    }
    map[String(dpId)] = { code, type: typeof r['valueType'] === 'string' ? r['valueType'] : undefined, values };
  }
  return map;
}
