import type { InverterEnergy, InverterInfo, InverterLive, InverterSettings, TouSlot } from '../../app/models/inverter.models';

/**
 * Mapa rejestrów falownika Deye SUN-xK-SG04LP3 (trójfazowy hybrydowy LV).
 * Odczyt danych bieżących: 500–679, ustawienia: 60–179, informacje: 0–30.
 * Zgodna z odczytem z falownika (numer seryjny, zegar, napięcia faz, sumy mocy) i z profilem deye_p3 integracji Solarman.
 */

/** Bloki odczytywane w każdym cyklu (po 60 rejestrów — logger nie lubi pojedynczych zapytań). */
export const LIVE_BLOCKS: [number, number][] = [
  [500, 60],
  [560, 60],
  [620, 60],
];
/** Ustawienia i zegar falownika. */
export const SETTINGS_BLOCKS: [number, number][] = [
  [60, 60],
  [120, 60],
];
export const INFO_BLOCK: [number, number] = [0, 30];

export type Registers = Map<number, number>;

export function toRegisters(blocks: [number, number[]][]): Registers {
  const m: Registers = new Map();
  for (const [start, values] of blocks) values.forEach((v, i) => m.set(start + i, v));
  return m;
}

function reg(r: Registers, addr: number): number {
  const v = r.get(addr);
  if (v === undefined) throw new Error(`Brak rejestru ${addr} w odczycie.`);
  return v;
}

const s16 = (v: number) => (v > 32767 ? v - 65536 : v);
const u32 = (r: Registers, lo: number) => reg(r, lo) + reg(r, lo + 1) * 65536;
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;
/** Temperatury Deye: (x − 1000) × 0,1 °C */
const temp = (v: number) => round((v - 1000) / 10, 1);

const STATUS_LABELS = ['Czuwanie', 'Autotest', 'Praca', 'Alarm', 'Błąd'];

export const WORK_MODES: Record<number, string> = {
  0: 'Sprzedaż nadwyżek (Selling first)',
  1: 'Zero export — tylko na odbiory (Zero export to load)',
  2: 'Zero export wg przekładnika CT (Zero export to CT)',
};

/** Zegar falownika z rejestrów 62–64 (rok−2000/miesiąc, dzień/godzina, minuta/sekunda). */
export function inverterClock(r: Registers): Date | null {
  const a = r.get(62);
  const b = r.get(63);
  const c = r.get(64);
  if (a === undefined || b === undefined || c === undefined) return null;
  const [year, month, day, hour, minute, second] = [2000 + (a >> 8), a & 0xff, b >> 8, b & 0xff, c >> 8, c & 0xff];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  // Zegar falownika jest w czasie lokalnym — zapisujemy go jako "ścienny", bez przeliczania strefy
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

/** "2026-11-25" wg zegara falownika (klucz liczników dziennych). */
export function inverterDay(r: Registers): string | null {
  const d = inverterClock(r);
  return d ? d.toISOString().slice(0, 10) : null;
}

function energy(r: Registers, total: boolean): InverterEnergy {
  const k = (v: number) => round(v / 10, 1);
  if (!total) {
    return {
      pv: k(reg(r, 529)),
      load: k(reg(r, 526)),
      grid_import: k(reg(r, 520)),
      grid_export: k(reg(r, 521)),
      battery_charge: k(reg(r, 514)),
      battery_discharge: k(reg(r, 515)),
    };
  }
  return {
    pv: k(u32(r, 534)),
    load: k(u32(r, 527)),
    grid_import: k(u32(r, 522)),
    grid_export: k(u32(r, 524)),
    battery_charge: k(u32(r, 516)),
    battery_discharge: k(u32(r, 518)),
  };
}

/** Rejestry 500–679 (+ zegar 62–64, jeśli odczytany) → odczyt bieżący. */
export function decodeLive(r: Registers, now = new Date()): InverterLive {
  const status = reg(r, 500);
  const clock = inverterClock(r);
  const pv1 = reg(r, 672);
  const pv2 = reg(r, 673);
  return {
    timestamp: now.toISOString(),
    inverter_time: clock ? clock.toISOString().slice(0, 19).replace('T', ' ') : null,
    status,
    status_label: STATUS_LABELS[status] ?? `Nieznany (${status})`,

    pv_power: pv1 + pv2,
    pv1_power: pv1,
    pv2_power: pv2,
    pv1_voltage: round(reg(r, 676) / 10, 1),
    pv1_current: round(reg(r, 677) / 10, 1),
    pv2_voltage: round(reg(r, 678) / 10, 1),
    pv2_current: round(reg(r, 679) / 10, 1),

    battery_soc: reg(r, 588),
    battery_power: s16(reg(r, 590)),
    battery_voltage: round(reg(r, 587) / 100, 2),
    battery_current: round(s16(reg(r, 591)) / 100, 2),
    battery_temp: temp(reg(r, 586)),

    grid_power: s16(reg(r, 619)),
    grid_l1_power: s16(reg(r, 616)),
    grid_l2_power: s16(reg(r, 617)),
    grid_l3_power: s16(reg(r, 618)),
    grid_l1_voltage: round(reg(r, 598) / 10, 1),
    grid_l2_voltage: round(reg(r, 599) / 10, 1),
    grid_l3_voltage: round(reg(r, 600) / 10, 1),
    grid_frequency: round(reg(r, 609) / 100, 2),

    load_power: s16(reg(r, 653)),
    load_l1_power: s16(reg(r, 650)),
    load_l2_power: s16(reg(r, 651)),
    load_l3_power: s16(reg(r, 652)),

    inverter_power: s16(reg(r, 636)),
    radiator_temp: temp(reg(r, 541)),
    dc_temp: temp(reg(r, 540)),

    today: energy(r, false),
    total: energy(r, true),
  };
}

export function decodeInfo(r: Registers): InverterInfo {
  let serial = '';
  for (let a = 3; a <= 7; a++) {
    const v = reg(r, a);
    serial += String.fromCharCode(v >> 8, v & 0xff);
  }
  return {
    serial: serial.replace(/[^\x20-\x7e]/g, '').trim(),
    rated_power: r.has(20) && r.has(21) ? u32(r, 20) / 10 : 0,
    battery_capacity_ah: r.get(102) ?? 0,
    battery_shutdown_soc: r.get(115) ?? 0,
    battery_restart_soc: r.get(116) ?? 0,
    battery_low_soc: r.get(117) ?? 0,
  };
}

// --- ustawienia ---

export const TOU_SLOTS = 6;
const TOU_TIME = 148;
const TOU_POWER = 154;
const TOU_SOC = 166;
const TOU_CHARGE = 172;

const hhmmToText = (v: number) => `${String(Math.floor(v / 100)).padStart(2, '0')}:${String(v % 100).padStart(2, '0')}`;

export function decodeSettings(r: Registers): InverterSettings {
  const tou: TouSlot[] = [];
  for (let i = 0; i < TOU_SLOTS; i++) {
    tou.push({
      start: hhmmToText(reg(r, TOU_TIME + i)),
      power: reg(r, TOU_POWER + i),
      soc: reg(r, TOU_SOC + i),
      grid_charge: (reg(r, TOU_CHARGE + i) & 1) === 1,
    });
  }
  return {
    work_mode: reg(r, 142),
    max_sell_power: reg(r, 143),
    solar_sell: reg(r, 145) === 1,
    battery_max_charge_current: reg(r, 108),
    battery_max_discharge_current: reg(r, 109),
    grid_charge_current: reg(r, 128),
    grid_charge_enabled: reg(r, 130) === 1,
    tou_enabled: (reg(r, 146) & 1) === 1,
    tou,
  };
}

export interface RegisterWrite {
  addr: number;
  value: number;
  label: string;
}

/** Limity zapisu: poza nimi panel odmawia, zamiast wysyłać do falownika. */
export const LIMITS = {
  current: { min: 0, max: 150 },
  soc: { min: 5, max: 100 },
};

class ValidationError extends Error {}
export { ValidationError as InverterValidationError };

function int(value: unknown, min: number, max: number, what: string): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) throw new ValidationError(`${what}: dozwolone ${min}–${max} (liczba całkowita).`);
  return n;
}

function bool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw new ValidationError(`${what}: oczekiwano tak/nie.`);
  return value;
}

function parseHhmm(value: unknown, what: string): number {
  const m = typeof value === 'string' ? value.match(/^(\d{1,2}):(\d{2})$/) : null;
  const h = m ? Number(m[1]) : NaN;
  const min = m ? Number(m[2]) : NaN;
  if (!m || h > 23 || min > 59) throw new ValidationError(`${what}: oczekiwano godziny GG:MM.`);
  return h * 100 + min;
}

/**
 * Zmiany ustawień → lista zapisów rejestrów. Wszystko jest sprawdzane przed wysłaniem czegokolwiek;
 * bity, których panel nie zmienia (dni tygodnia harmonogramu, ładowanie z generatora), zostają nietknięte.
 */
export function encodeSettings(patch: Partial<InverterSettings>, current: Registers, ratedPower: number): RegisterWrite[] {
  const out: RegisterWrite[] = [];
  const maxPower = ratedPower > 0 ? ratedPower : 6000;
  const add = (addr: number, value: number, label: string) => {
    if (current.get(addr) !== value) out.push({ addr, value, label });
  };

  if (patch.work_mode !== undefined) {
    const v = int(patch.work_mode, 0, 2, 'Tryb pracy');
    add(142, v, `Tryb pracy: ${WORK_MODES[v]}`);
  }
  if (patch.max_sell_power !== undefined) add(143, int(patch.max_sell_power, 0, maxPower, 'Maks. moc oddawania (W)'), 'Maks. moc oddawania');
  if (patch.solar_sell !== undefined) add(145, bool(patch.solar_sell, 'Sprzedaż z PV') ? 1 : 0, 'Sprzedaż z PV');
  if (patch.battery_max_charge_current !== undefined) {
    add(108, int(patch.battery_max_charge_current, LIMITS.current.min, LIMITS.current.max, 'Maks. prąd ładowania (A)'), 'Maks. prąd ładowania');
  }
  if (patch.battery_max_discharge_current !== undefined) {
    add(109, int(patch.battery_max_discharge_current, LIMITS.current.min, LIMITS.current.max, 'Maks. prąd rozładowania (A)'), 'Maks. prąd rozładowania');
  }
  if (patch.grid_charge_current !== undefined) {
    add(128, int(patch.grid_charge_current, LIMITS.current.min, LIMITS.current.max, 'Prąd ładowania z sieci (A)'), 'Prąd ładowania z sieci');
  }
  if (patch.grid_charge_enabled !== undefined) add(130, bool(patch.grid_charge_enabled, 'Ładowanie z sieci') ? 1 : 0, 'Ładowanie z sieci');
  if (patch.tou_enabled !== undefined) {
    const on = bool(patch.tou_enabled, 'Harmonogram');
    const prev = reg(current, 146);
    add(146, on ? prev | 1 : prev & ~1, 'Harmonogram (time of use)');
  }

  if (patch.tou !== undefined) {
    if (!Array.isArray(patch.tou) || patch.tou.length !== TOU_SLOTS) throw new ValidationError(`Harmonogram: oczekiwano ${TOU_SLOTS} przedziałów.`);
    const times = patch.tou.map((s, i) => parseHhmm(s?.start, `Przedział ${i + 1}, początek`));
    if (times[0] !== 0) throw new ValidationError('Pierwszy przedział harmonogramu musi zaczynać się o 00:00.');
    for (let i = 1; i < times.length; i++) {
      if (times[i] <= times[i - 1]) throw new ValidationError('Godziny przedziałów muszą rosnąć (każdy kolejny później niż poprzedni).');
    }
    patch.tou.forEach((s, i) => {
      const n = i + 1;
      add(TOU_TIME + i, times[i], `Przedział ${n}: początek`);
      add(TOU_POWER + i, int(s.power, 0, maxPower, `Przedział ${n}, moc (W)`), `Przedział ${n}: moc`);
      add(TOU_SOC + i, int(s.soc, LIMITS.soc.min, LIMITS.soc.max, `Przedział ${n}, SOC (%)`), `Przedział ${n}: SOC`);
      const prev = reg(current, TOU_CHARGE + i);
      add(TOU_CHARGE + i, bool(s.grid_charge, `Przedział ${n}, ładowanie z sieci`) ? prev | 1 : prev & ~1, `Przedział ${n}: ładowanie z sieci`);
    });
  }
  return out;
}
