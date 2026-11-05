import type { Db } from './db';
import type { EventBus } from './events';
import type { History } from './history';
import type { Notifier } from './notifications';
import { applyFlatFields, numericSamples } from './state-mapper';
import type { Device, DeviceAuditLog, DeviceDriver } from '../app/models/telemetry.models';

export interface CommandResult {
  success: boolean;
  message: string;
}

/** Wspólny interfejs sterowników (Zigbee2MQTT, Sonoff LAN, Tuya LAN). */
export interface Driver {
  readonly name: DeviceDriver;
  start(): void;
  stop(): void;
  /** Wysyła polecenie do urządzenia. Stan w panelu zmienia się dopiero po potwierdzeniu z urządzenia. */
  sendCommand(dev: Device, command: Record<string, unknown>): Promise<CommandResult>;
  /** Odczyt bieżącego stanu na żądanie. */
  refresh(dev: Device): Promise<CommandResult>;
  rename?(dev: Device, newName: string): Promise<CommandResult>;
  remove?(dev: Device): Promise<CommandResult>;
}

/** Pola, których nie wolno wysłać do przeglądarki. */
const SECRET_FIELDS = ['local_key', 'sonoff_api_key'] as const;

/** Ustawienia alarmów należące do panelu, a nie do urządzenia. */
export const PANEL_SETTING_KEYS = [
  'temp_alarm_enabled', 'temp_alarm_min', 'temp_alarm_max',
  'motion_alarm_enabled', 'contact_alarm_enabled', 'water_alarm_enabled',
] as const;

const BATTERY_ALERT_LEVEL = 15;

export class DeviceRegistry {
  private devices = new Map<string, Device>();
  private dirty = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private drivers = new Map<DeviceDriver, Driver>();

  constructor(
    private readonly db: Db,
    private readonly events: EventBus,
    private readonly history: History,
    private readonly notifier: Notifier,
  ) {
    const rows = db.sql.prepare('SELECT id, data FROM devices').all() as { id: string; data: string }[];
    for (const r of rows) {
      try {
        this.devices.set(r.id, JSON.parse(r.data) as Device);
      } catch {
        console.warn(`[REGISTRY] Uszkodzony wpis urządzenia ${r.id} — pomijam.`);
      }
    }
  }

  registerDriver(driver: Driver): void {
    this.drivers.set(driver.name, driver);
  }

  driverFor(dev: Device): Driver | undefined {
    return dev.driver ? this.drivers.get(dev.driver) : undefined;
  }

  get(id: string): Device | undefined {
    return this.devices.get(id);
  }

  all(): Device[] {
    return [...this.devices.values()];
  }

  byDriver(driver: DeviceDriver): Device[] {
    return this.all().filter((d) => d.driver === driver);
  }

  /** Tworzy lub aktualizuje metadane urządzenia (bez stanu). */
  upsert(id: string, patch: Partial<Device>, opts: { silent?: boolean } = {}): Device {
    const now = new Date().toISOString();
    let dev = this.devices.get(id);
    if (!dev) {
      dev = {
        ieee_address: id,
        friendly_name: patch.friendly_name ?? id,
        model: patch.model ?? '',
        last_seen: null,
        added_at: now,
        first_seen: now,
        is_deleted: false,
        battery: null,
        linkquality: null,
        last_temperature: null,
        last_humidity: null,
        raw_state: {},
      };
      this.devices.set(id, dev);
      this.audit('created', dev, `Dodano urządzenie "${patch.friendly_name ?? id}".`);
    }
    Object.assign(dev, patch, { ieee_address: id });
    this.markDirty(id);
    if (!opts.silent) this.emitDevice(dev);
    return dev;
  }

  /** Przyjmuje znormalizowany stan zgłoszony przez urządzenie. */
  applyState(id: string, state: Record<string, unknown>): Device | undefined {
    const dev = this.devices.get(id);
    if (!dev) return undefined;
    dev.raw_state = { ...(dev.raw_state ?? {}), ...state };
    applyFlatFields(dev, state);
    dev.last_seen = new Date().toISOString();
    if (dev.available !== false) dev.connection_status = 'online';
    dev.last_error = null;
    this.markDirty(id);

    const samples = numericSamples(state);
    if (Object.keys(samples).length > 0) {
      this.history.record(id, samples);
      this.events.broadcast({ type: 'telemetry', device_ieee: id, data: { ...samples, timestamp: dev.last_seen } });
    }
    this.emitDevice(dev);
    this.checkAlarms(dev, state);
    return dev;
  }

  setAvailability(id: string, available: boolean): void {
    const dev = this.devices.get(id);
    if (!dev || dev.available === available) return;
    dev.available = available;
    dev.connection_status = available ? 'online' : 'offline';
    this.markDirty(id);
    this.emitDevice(dev);
  }

  setError(id: string, message: string): void {
    const dev = this.devices.get(id);
    if (!dev) return;
    dev.last_error = message;
    dev.connection_status = 'error';
    this.markDirty(id);
    this.emitDevice(dev);
  }

  /** Zmiana identyfikatora (np. gdy Z2M zgłosi urządzenie pod innym kluczem). Przenosi historię. */
  rekey(from: string, to: string): void {
    const dev = this.devices.get(from);
    if (!dev || from === to) return;
    this.devices.delete(from);
    dev.ieee_address = to;
    this.devices.set(to, dev);
    this.history.renameDevice(from, to);
    this.db.sql.prepare('DELETE FROM devices WHERE id = ?').run(from);
    this.markDirty(to);
  }

  softDelete(id: string): Device | undefined {
    const dev = this.devices.get(id);
    if (!dev) return undefined;
    dev.is_deleted = true;
    dev.deleted_at = new Date().toISOString();
    this.markDirty(id);
    this.audit('soft_delete', dev, `Ukryto urządzenie "${dev.friendly_name}" z pulpitu.`);
    this.events.broadcast({ type: 'device_deleted', ieee_address: id });
    return dev;
  }

  restore(id: string): Device | undefined {
    const dev = this.devices.get(id);
    if (!dev) return undefined;
    dev.is_deleted = false;
    dev.deleted_at = null;
    this.markDirty(id);
    this.audit('restore', dev, `Przywrócono urządzenie "${dev.friendly_name}".`);
    this.emitDevice(dev);
    return dev;
  }

  /** Usuwa urządzenie z panelu wraz z historią (nie usuwa go z Zigbee2MQTT — to robi sterownik). */
  purge(id: string): boolean {
    const dev = this.devices.get(id);
    if (!dev) return false;
    this.devices.delete(id);
    this.dirty.delete(id);
    this.history.deleteDevice(id);
    this.db.sql.prepare('DELETE FROM devices WHERE id = ?').run(id);
    this.audit('permanent_delete', dev, `Trwale usunięto urządzenie "${dev.friendly_name}".`);
    this.events.broadcast({ type: 'device_permanently_deleted', ieee_address: id });
    return true;
  }

  purgeAll(): void {
    this.devices.clear();
    this.dirty.clear();
    this.db.sql.exec('DELETE FROM devices');
    this.history.clear();
    this.events.broadcast({ type: 'devices_updated', devices: [] });
  }

  audit(action: DeviceAuditLog['action'] | 'control' | 'warning', dev: Pick<Device, 'ieee_address' | 'friendly_name'>, message: string): void {
    this.db.sql
      .prepare('INSERT INTO audit_log (ts, action, device, device_name, message) VALUES (?, ?, ?, ?, ?)')
      .run(Date.now(), action, dev.ieee_address, dev.friendly_name, message);
  }

  auditLog(limit = 300): DeviceAuditLog[] {
    const rows = this.db.sql
      .prepare('SELECT id, ts, action, device, device_name, message FROM audit_log ORDER BY id DESC LIMIT ?')
      .all(limit) as Array<{ id: number; ts: number; action: string; device: string; device_name: string; message: string }>;
    return rows.map((r) => ({
      id: r.id,
      timestamp: new Date(r.ts).toISOString(),
      action: r.action as DeviceAuditLog['action'],
      device_ieee: r.device,
      device_name: r.device_name,
      message: r.message,
    }));
  }

  /** Kopia urządzenia bezpieczna do wysłania do przeglądarki (bez kluczy). */
  toPublic(dev: Device): Device {
    const copy: Device = { ...dev };
    copy.has_local_key = Boolean(dev.local_key);
    copy.has_sonoff_key = Boolean(dev.sonoff_api_key);
    for (const f of SECRET_FIELDS) delete copy[f];
    copy.connection_status = this.isOnline(dev) ? (dev.connection_status ?? 'online') : 'offline';
    return copy;
  }

  isOnline(dev: Device): boolean {
    if (dev.is_deleted) return false;
    if (dev.available === false) return false;
    if (dev.available === true) return true;
    if (!dev.last_seen) return false;
    // Brak informacji o dostępności: czujniki bateryjne raportują rzadko, więc limit jest szeroki
    const limitMs = dev.battery !== null && dev.battery !== undefined ? 25 * 3600_000 : 2 * 3600_000;
    return Date.now() - new Date(dev.last_seen).getTime() <= limitMs;
  }

  emitDevice(dev: Device): void {
    this.events.broadcast({ type: 'device_updated', device: this.toPublic(dev) });
  }

  emitAll(): void {
    this.events.broadcast({ type: 'devices_updated', devices: this.all().map((d) => this.toPublic(d)) });
  }

  private markDirty(id: string): void {
    this.dirty.add(id);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 2000);
    }
  }

  flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.dirty.size === 0) return;
    const stmt = this.db.sql.prepare(
      'INSERT INTO devices (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
    );
    const now = Date.now();
    for (const id of this.dirty) {
      const dev = this.devices.get(id);
      if (dev) stmt.run(id, JSON.stringify(dev), now);
    }
    this.dirty.clear();
  }

  private checkAlarms(dev: Device, state: Record<string, unknown>): void {
    if (dev.is_deleted) return;
    if (typeof state['battery'] === 'number' && state['battery'] <= BATTERY_ALERT_LEVEL) {
      this.notifier.battery(dev, state['battery']);
    }
    const temp = typeof state['temperature'] === 'number' ? state['temperature'] : undefined;
    if (dev.temp_alarm_enabled && temp !== undefined) {
      const min = dev.temp_alarm_min ?? 16;
      const max = dev.temp_alarm_max ?? 28;
      if (temp < min) this.notifier.alarm(dev, 'temp_low', `Zbyt niska temperatura: ${temp.toFixed(1)}°C (min ${min}°C)`);
      else if (temp > max) this.notifier.alarm(dev, 'temp_high', `Zbyt wysoka temperatura: ${temp.toFixed(1)}°C (max ${max}°C)`);
    }
    if (dev.motion_alarm_enabled && (state['occupancy'] === true || state['presence'] === true)) {
      this.notifier.alarm(dev, 'motion_detected', 'Wykryto ruch.');
    }
    if (dev.contact_alarm_enabled && state['contact'] === false) {
      this.notifier.alarm(dev, 'contact_opened', 'Otwarto drzwi lub okno.');
    }
    if (dev.water_alarm_enabled && state['water_leak'] === true) {
      this.notifier.alarm(dev, 'water_leak_alarm', 'Wykryto wyciek wody!');
    }
    if (state['smoke'] === true || state['smoke_alarm'] === true) {
      this.notifier.alarm(dev, 'smoke', 'Wykryto dym!');
    }
  }
}
