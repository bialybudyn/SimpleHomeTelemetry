import type { Device, DeviceCategory, Z2mExpose } from '../app/models/telemetry.models';

/**
 * Czyste funkcje (bez I/O) do tłumaczenia stanu urządzeń na płaskie pola modelu Device.
 * Wszystkie sterowniki normalizują stan do nazw atrybutów Zigbee2MQTT (state, power, temperature, ...).
 */

/** Atrybuty kopiowane 1:1 do płaskiego modelu Device. */
const DIRECT_KEYS = new Set<string>([
  'state', 'power', 'voltage', 'current', 'energy', 'energy_today', 'energy_month', 'energy_total',
  'battery', 'linkquality', 'occupancy', 'contact', 'water_leak', 'illuminance',
  'local_temperature', 'system_mode', 'running_state', 'child_lock', 'open_window',
  'local_temperature_calibration', 'frost_protection_temperature', 'temperature_sensor', 'external_temperature',
  'valve_opening_degree', 'valve_closing_degree', 'temperature_accuracy', 'smart_temperature_control',
  'timer_mode_target_temp', 'temporary_mode_duration', 'temporary_mode', 'idle_steps', 'closing_steps',
  'valve_opening_limit_voltage', 'valve_closing_limit_voltage', 'valve_motor_running_voltage',
  'weekly_schedule_sunday', 'weekly_schedule_monday', 'weekly_schedule_tuesday', 'weekly_schedule_wednesday',
  'weekly_schedule_thursday', 'weekly_schedule_friday', 'weekly_schedule_saturday',
  'power_on_behavior', 'overload_protection', 'overload_power_threshold', 'overload_current_threshold',
  'overload_voltage_threshold', 'under_voltage_threshold', 'inching_mode', 'inching_time', 'network_indicator',
  'fan_speed', 'fan_mode', 'fan_oscillation', 'fan_timer', 'fan_ionizer', 'fan_humidifier', 'fan_uv',
  'smoke_status', 'smoke_alarm', 'tamper_alarm',
]);

/** Aliasy: atrybut źródłowy -> pole w modelu Device. */
const ALIASES: Record<string, string> = {
  temperature: 'last_temperature',
  humidity: 'last_humidity',
  occupied_heating_setpoint: 'current_heating_setpoint',
  current_heating_setpoint: 'current_heating_setpoint',
  presence: 'occupancy',
  smoke: 'smoke_alarm',
  tamper: 'tamper_alarm',
  illuminance_lux: 'illuminance',
};

/** Przepisuje znormalizowany stan na płaskie pola urządzenia (mutuje `dev`). */
export function applyFlatFields(dev: Device, state: Record<string, unknown>): void {
  const target = dev as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(state)) {
    if (value === undefined) continue;
    if (DIRECT_KEYS.has(key)) target[key] = value;
    const alias = ALIASES[key];
    if (alias) target[alias] = value;
  }
  if (state['occupied_heating_setpoint'] !== undefined) {
    target['occupied_heating_setpoint'] = state['occupied_heating_setpoint'];
  }
  // Głowice podają tylko local_temperature — pokaż ją jako temperaturę kafelka
  if (state['temperature'] === undefined && typeof state['local_temperature'] === 'number') {
    target['last_temperature'] = state['local_temperature'];
  }
}

/** Zamienia stan na wartości liczbowe do historii (liczby, bool -> 1/0, ON/OFF -> 1/0). */
export function numericSamples(state: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value ? 1 : 0;
    } else if (typeof value === 'string' && (key === 'state' || key.startsWith('state_'))) {
      const v = value.toUpperCase();
      if (v === 'ON') out[key] = 1;
      else if (v === 'OFF') out[key] = 0;
    }
  }
  return out;
}

/** Spłaszcza zagnieżdżone "exposes" (switch/light/climate/fan/composite) do listy cech z `property`. */
export function flattenExposes(exposes: Z2mExpose[] | undefined): Z2mExpose[] {
  const out: Z2mExpose[] = [];
  const walk = (list: Z2mExpose[]) => {
    for (const e of list) {
      if (Array.isArray(e.features) && e.features.length > 0 && e.type !== 'composite') {
        walk(e.features);
      } else if (e.property) {
        out.push(e);
      }
    }
  };
  walk(exposes ?? []);
  return out;
}

/** Bit dostępu GET w Zigbee2MQTT (access & 0b100 = można odpytać /get). */
const ACCESS_GET = 0b100;

/**
 * Buduje payload dla tematu <name>/get: tylko atrybuty, które urządzenie pozwala odczytać.
 * Zwraca null, jeśli nic nie da się odpytać (np. czujniki bateryjne).
 */
export function buildGetPayload(exposes: Z2mExpose[] | undefined): Record<string, string> | null {
  const payload: Record<string, string> = {};
  for (const f of flattenExposes(exposes)) {
    if (f.property && typeof f.access === 'number' && (f.access & ACCESS_GET) !== 0) {
      payload[f.property] = '';
    }
  }
  return Object.keys(payload).length > 0 ? payload : null;
}

/** Ustala kategorię kafelka na podstawie exposes (zamiast zgadywania po nazwie modelu). */
export function categoryFromExposes(exposes: Z2mExpose[] | undefined): DeviceCategory {
  const top = new Set((exposes ?? []).map((e) => e.type));
  const props = new Set(flattenExposes(exposes).map((f) => f.property));
  if (top.has('climate')) return 'climate';
  if (top.has('fan')) return 'fan';
  if (props.has('smoke')) return 'smoke';
  if (props.has('water_leak')) return 'water_leak';
  if (top.has('switch') || props.has('state')) {
    return props.has('power') || props.has('energy') ? 'plug' : 'switch';
  }
  if (props.has('contact')) return 'contact';
  if (props.has('occupancy') || props.has('presence')) return 'occupancy';
  return 'sensor';
}

/**
 * Dopasowuje temat MQTT "<friendly_name>[/<reszta>]" do znanego urządzenia.
 * friendly_name może zawierać "/", więc wybierana jest najdłuższa pasująca nazwa.
 */
export function resolveTopic(subtopic: string, names: Iterable<string>): { name: string; rest: string } | null {
  let best: string | null = null;
  for (const n of names) {
    if (!n) continue;
    if (subtopic === n || subtopic.startsWith(n + '/')) {
      if (!best || n.length > best.length) best = n;
    }
  }
  if (!best) return null;
  return { name: best, rest: subtopic.slice(best.length).replace(/^\//, '') };
}
