import TuyAPI from 'tuyapi';
import type { CommandResult, DeviceRegistry, Driver } from '../registry';
import { commandToDps, normalizeTuyaDps } from './tuya-protocol';
import type { Device } from '../../app/models/telemetry.models';

const MIN_BACKOFF_MS = 10_000;
const MAX_BACKOFF_MS = 5 * 60_000;

interface Conn {
  api: TuyAPI;
  connected: boolean;
  backoff: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Odcisk konfiguracji — zmiana klucza/IP/wersji wymusza ponowne połączenie. */
  signature: string;
}

export const tuyaId = (devId: string) => `tuya_${devId}`;

/**
 * Sterownik urządzeń Tuya Wi-Fi (protokół lokalny 3.1–3.5) przez TuyAPI.
 * Utrzymuje jedno stałe połączenie na urządzenie: zmiany stanu (także z aplikacji Smart Life
 * czy z pilota) przychodzą od razu jako zdarzenia, bez odpytywania.
 */
export class TuyaDriver implements Driver {
  readonly name = 'tuya' as const;
  private conns = new Map<string, Conn>();
  private running = false;

  constructor(private readonly registry: DeviceRegistry) {}

  start(): void {
    this.running = true;
    for (const dev of this.registry.byDriver('tuya')) this.ensure(dev);
  }

  stop(): void {
    this.running = false;
    for (const id of [...this.conns.keys()]) this.drop(id);
  }

  /** Wywoływane po zmianie konfiguracji urządzenia (klucz, IP, wersja) lub dodaniu nowego. */
  sync(dev: Device): void {
    if (!this.running) return;
    const existing = this.conns.get(dev.ieee_address);
    if (existing && existing.signature !== signatureOf(dev)) this.drop(dev.ieee_address);
    this.ensure(dev);
  }

  forget(id: string): void {
    this.drop(id);
  }

  private ensure(dev: Device): void {
    if (dev.is_deleted || this.conns.has(dev.ieee_address)) return;
    if (!dev.tuya_dev_id || !dev.local_key) {
      this.registry.upsert(dev.ieee_address, { last_error: 'Brak Device ID lub Local Key — zaimportuj urządzenie kodem QR albo uzupełnij ręcznie.' }, { silent: true });
      return;
    }
    const api = new TuyAPI({
      id: dev.tuya_dev_id,
      key: dev.local_key,
      ip: dev.ip_address || undefined,
      version: dev.tuya_protocol_version || '3.3',
      issueRefreshOnConnect: true,
    });
    const conn: Conn = { api, connected: false, backoff: MIN_BACKOFF_MS, timer: null, signature: signatureOf(dev) };
    this.conns.set(dev.ieee_address, conn);
    const id = dev.ieee_address;

    const onData = (data: { dps?: Record<string, unknown> }) => {
      if (!data?.dps) return;
      const current = this.registry.get(id);
      this.registry.applyState(id, normalizeTuyaDps(data.dps, current?.tuya_dp_map));
    };
    api.on('data', onData);
    api.on('dp-refresh', onData);
    api.on('connected', () => {
      conn.connected = true;
      conn.backoff = MIN_BACKOFF_MS;
      this.registry.setAvailability(id, true);
    });
    api.on('disconnected', () => {
      conn.connected = false;
      this.registry.setAvailability(id, false);
      this.scheduleReconnect(id);
    });
    api.on('error', (err: Error) => {
      this.registry.upsert(id, { last_error: `Tuya: ${err.message}` }, { silent: true });
    });

    void this.connect(id);
  }

  private async connect(id: string): Promise<void> {
    const conn = this.conns.get(id);
    if (!conn) return;
    try {
      // Bez IP: nasłuch rozgłoszeń UDP urządzenia (pasywnie, bez skanowania sieci)
      const dev = this.registry.get(id);
      if (!dev?.ip_address) {
        await conn.api.find({ timeout: 20 });
        const ip = (conn.api as unknown as { device: { ip?: string } }).device.ip;
        if (ip) this.registry.upsert(id, { ip_address: ip }, { silent: true });
      }
      await conn.api.connect();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.registry.upsert(id, { last_error: `Brak połączenia z urządzeniem Tuya: ${msg}`, connection_status: 'offline' });
      this.scheduleReconnect(id);
    }
  }

  private scheduleReconnect(id: string): void {
    const conn = this.conns.get(id);
    if (!conn || conn.timer || !this.running) return;
    conn.timer = setTimeout(() => {
      conn.timer = null;
      void this.connect(id);
    }, conn.backoff);
    conn.backoff = Math.min(conn.backoff * 2, MAX_BACKOFF_MS);
  }

  private drop(id: string): void {
    const conn = this.conns.get(id);
    if (!conn) return;
    if (conn.timer) clearTimeout(conn.timer);
    conn.api.removeAllListeners();
    try {
      conn.api.disconnect();
    } catch {
      // ignorujemy
    }
    this.conns.delete(id);
  }

  async sendCommand(dev: Device, command: Record<string, unknown>): Promise<CommandResult> {
    const conn = this.conns.get(dev.ieee_address);
    if (!conn?.connected) return { success: false, message: 'Brak połączenia z urządzeniem Tuya (sprawdź IP, Local Key i wersję protokołu).' };
    const dps = commandToDps(command, dev.tuya_dp_map);
    if (Object.keys(dps).length === 0) {
      return { success: false, message: 'Nie znam numeru DP dla tego polecenia — uzupełnij mapę DP urządzenia.' };
    }
    try {
      await conn.api.set({ multiple: true, data: dps as Record<string, string | number | boolean> });
      return { success: true, message: `Wysłano DP: ${JSON.stringify(dps)}` };
    } catch (err) {
      return { success: false, message: `Błąd wysyłania do Tuya: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  async refresh(dev: Device): Promise<CommandResult> {
    const conn = this.conns.get(dev.ieee_address);
    if (!conn?.connected) return { success: false, message: 'Brak połączenia z urządzeniem Tuya.' };
    try {
      const res = await conn.api.get({ schema: true });
      if (res && typeof res === 'object' && 'dps' in res) {
        this.registry.applyState(dev.ieee_address, normalizeTuyaDps((res as { dps: Record<string, unknown> }).dps, dev.tuya_dp_map));
      }
      return { success: true, message: 'Odczytano stan urządzenia.' };
    } catch (err) {
      return { success: false, message: `Błąd odczytu Tuya: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  isConnected(id: string): boolean {
    return Boolean(this.conns.get(id)?.connected);
  }
}

function signatureOf(dev: Device): string {
  return [dev.tuya_dev_id, dev.local_key, dev.ip_address, dev.tuya_protocol_version].join('|');
}
