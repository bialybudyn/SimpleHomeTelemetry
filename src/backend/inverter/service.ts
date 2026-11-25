import { Socket } from 'node:net';
import { networkInterfaces } from 'node:os';
import type { Db } from '../db';
import type { Notifier } from '../notifications';
import type { DeviceRegistry } from '../registry';
import type {
  InverterConfig,
  InverterInfo,
  InverterLive,
  InverterSettings,
  InverterStatus,
} from '../../app/models/inverter.models';
import {
  INFO_BLOCK,
  LIVE_BLOCKS,
  SETTINGS_BLOCKS,
  decodeInfo,
  decodeLive,
  decodeSettings,
  encodeSettings,
  inverterDay,
  toRegisters,
  type Registers,
} from './deye';
import { withSolarman, type SolarmanConnection, type SolarmanTarget } from './solarman';
import { InverterStore } from './store';

const DEFAULT_CONFIG: InverterConfig = {
  enabled: true,
  host: '',
  port: 8899,
  logger_serial: '',
  slave: 1,
  poll_seconds: 30,
  control_enabled: false,
};

/** Po tylu nieudanych odczytach z rzędu szukamy loggera w sieci (DHCP mógł dać mu nowy adres). */
const FAILS_BEFORE_DISCOVERY = 2;
/** Szukanie w sieci nie częściej niż co tyle — to 254 próby połączenia. */
const DISCOVERY_INTERVAL_MS = 5 * 60_000;
/** Powiadomienie, gdy falownik nie odpowiada dłużej niż tyle. */
const OFFLINE_ALERT_MS = 15 * 60_000;
const AUDIT_DEVICE = { ieee_address: 'inverter', friendly_name: 'Falownik' };

export interface InverterServiceOptions {
  retentionDays: number;
  /** Port loggera używany przy wyszukiwaniu (testy podstawiają własny). */
  discoveryPort?: number;
}

/**
 * Falownik Deye przez logger Solarman: odczyt co `poll_seconds`, historia na rok,
 * wyszukiwanie loggera w sieci po zmianie adresu i (po włączeniu) zapis wybranych ustawień.
 * Wszystkie połączenia z loggerem idą po kolei — logger dobrze obsługuje tylko jedno naraz.
 */
export class InverterService {
  readonly store: InverterStore;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private running = false;
  private fails = 0;
  private lastDiscovery = 0;
  private offlineSince: number | null = null;
  private offlineAlerted = false;

  live: InverterLive | null = null;
  settings: InverterSettings | null = null;
  info: InverterInfo | null = null;
  /** Rejestry 0–29 (numer seryjny, moc znamionowa) — czytane raz na połączenie z danym loggerem. */
  private infoRegs: Registers | null = null;

  readonly status: InverterStatus = {
    configured: false,
    enabled: false,
    connected: false,
    host: '',
    port: 8899,
    last_ok: null,
    last_error: null,
    discovering: false,
    last_discovery: null,
    last_discovery_result: null,
    control_enabled: false,
  };

  constructor(
    private readonly db: Db,
    private readonly registry: DeviceRegistry,
    private readonly notifier: Notifier,
    private readonly options: InverterServiceOptions,
  ) {
    this.store = new InverterStore(db);
    this.syncStatus();
  }

  getConfig(): InverterConfig {
    return { ...DEFAULT_CONFIG, ...this.db.getSetting<Partial<InverterConfig>>('inverter', {}) };
  }

  updateConfig(patch: Partial<InverterConfig>): InverterConfig {
    const cur = this.getConfig();
    const next: InverterConfig = { ...cur };
    if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
    if (typeof patch.host === 'string') next.host = patch.host.trim();
    if (patch.port !== undefined) next.port = clampInt(patch.port, 1, 65535, cur.port);
    if (typeof patch.logger_serial === 'string' || typeof patch.logger_serial === 'number') {
      const sn = String(patch.logger_serial).trim();
      if (sn !== '' && !/^\d{1,10}$/.test(sn)) throw new Error('Numer seryjny loggera to liczba (do 10 cyfr).');
      next.logger_serial = sn;
    }
    if (patch.slave !== undefined) next.slave = clampInt(patch.slave, 1, 247, cur.slave);
    if (patch.poll_seconds !== undefined) next.poll_seconds = clampInt(patch.poll_seconds, 10, 600, cur.poll_seconds);
    if (typeof patch.control_enabled === 'boolean' && patch.control_enabled !== cur.control_enabled) {
      next.control_enabled = patch.control_enabled;
      this.registry.audit('control', AUDIT_DEVICE, patch.control_enabled ? 'Włączono sterowanie falownikiem z panelu.' : 'Wyłączono sterowanie falownikiem z panelu.');
    }
    this.db.setSetting('inverter', next);
    if (next.host !== cur.host || next.logger_serial !== cur.logger_serial) {
      this.infoRegs = null;
      this.fails = 0;
      this.lastDiscovery = 0;
    }
    this.syncStatus();
    if (this.running) this.schedule(0);
    return next;
  }

  start(): void {
    this.running = true;
    this.schedule(1000);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.store.flush();
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.cycle(), ms);
    this.timer.unref?.();
  }

  private async cycle(): Promise<void> {
    const cfg = this.getConfig();
    try {
      if (cfg.enabled && cfg.logger_serial) await this.poll();
    } finally {
      if (this.running) this.schedule(cfg.poll_seconds * 1000);
    }
  }

  private target(cfg = this.getConfig(), host = cfg.host): SolarmanTarget {
    return { host, port: cfg.port, loggerSerial: Number(cfg.logger_serial), slave: cfg.slave };
  }

  /** Zadania na loggerze wykonują się po kolei. */
  private exclusive<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Jeden cykl: odczyt, a po kolejnych błędach — szukanie loggera w sieci. */
  async poll(now = Date.now()): Promise<void> {
    const cfg = this.getConfig();
    if (!cfg.host) {
      await this.discover();
      if (!this.getConfig().host) return;
    }
    try {
      await this.exclusive(() => withSolarman(this.target(), (c) => this.readAll(c)));
      this.fails = 0;
      this.status.connected = true;
      this.status.last_ok = new Date(now).toISOString();
      this.status.last_error = null;
      this.onRecovered();
    } catch (err) {
      this.fails++;
      this.status.connected = false;
      this.status.last_error = err instanceof Error ? err.message : String(err);
      this.offlineSince ??= now;
      if (this.fails >= FAILS_BEFORE_DISCOVERY && now - this.lastDiscovery >= DISCOVERY_INTERVAL_MS) {
        await this.discover();
      }
      this.checkOffline(now);
    }
    this.syncStatus();
  }

  private async readAll(c: SolarmanConnection): Promise<void> {
    this.infoRegs ??= toRegisters([[INFO_BLOCK[0], await c.readHolding(...INFO_BLOCK)]]);
    const blocks: [number, number[]][] = [];
    for (const [start, count] of [...SETTINGS_BLOCKS, ...LIVE_BLOCKS]) blocks.push([start, await c.readHolding(start, count)]);
    const regs = toRegisters(blocks);
    this.settings = decodeSettings(regs);
    // Numer seryjny i moc z bloku informacji, parametry baterii z bloku ustawień
    this.info = decodeInfo(new Map([...this.infoRegs, ...regs]));
    const live = decodeLive(regs);
    this.live = live;
    this.store.add(live, Date.parse(live.timestamp), inverterDay(regs));
  }

  /**
   * Szuka loggera w sieci: próba połączenia z portem 8899 w podsieci /24 ostatniego adresu
   * (i podsieciach /24 serwera), potem zapytanie V5 z numerem seryjnym loggera — odpowie tylko właściwy.
   */
  async discover(hosts?: string[]): Promise<string | null> {
    const cfg = this.getConfig();
    if (!cfg.logger_serial || this.status.discovering) return null;
    this.status.discovering = true;
    this.lastDiscovery = Date.now();
    this.syncStatus();
    try {
      const candidates = hosts ?? candidateHosts(cfg.host);
      const port = this.options.discoveryPort ?? cfg.port;
      const open = await scanPort(candidates, port);
      for (const host of open) {
        try {
          const regs = await this.exclusive(() =>
            withSolarman({ ...this.target(cfg, host), port }, (c) => c.readHolding(...INFO_BLOCK), 3000),
          );
          const info = decodeInfo(toRegisters([[INFO_BLOCK[0], regs]]));
          if (this.info?.serial && info.serial !== this.info.serial) continue;
          if (host !== cfg.host) {
            this.registry.audit('control', AUDIT_DEVICE, `Logger falownika znaleziony pod nowym adresem ${host} (poprzednio ${cfg.host || 'brak'}).`);
            this.db.setSetting('inverter', { ...this.getConfig(), host, port });
          }
          this.status.last_discovery_result = `Znaleziono logger pod ${host} (falownik ${info.serial}).`;
          return host;
        } catch {
          // port otwarty, ale to nie nasz logger
        }
      }
      this.status.last_discovery_result = `Nie znaleziono loggera (sprawdzono ${candidates.length} adresów, port ${port} otwarty na ${open.length}).`;
      return null;
    } finally {
      this.status.discovering = false;
      this.status.last_discovery = new Date().toISOString();
      this.syncStatus();
    }
  }

  /** Zapis ustawień: walidacja, zapis po jednym rejestrze, odczyt kontrolny i wpis w dzienniku. */
  async applySettings(patch: Partial<InverterSettings>): Promise<{ applied: string[]; settings: InverterSettings }> {
    const cfg = this.getConfig();
    if (!cfg.control_enabled) throw new Error('Sterowanie falownikiem jest wyłączone w ustawieniach panelu.');
    if (!cfg.host || !cfg.logger_serial) throw new Error('Falownik nie jest skonfigurowany.');
    return this.exclusive(() =>
      withSolarman(this.target(), async (c) => {
        const read = async () => {
          const blocks: [number, number[]][] = [];
          for (const [start, count] of SETTINGS_BLOCKS) blocks.push([start, await c.readHolding(start, count)]);
          return toRegisters(blocks);
        };
        // Zawsze świeży stan — ktoś mógł zmienić ustawienia w aplikacji Solarman albo na falowniku
        const before = await read();
        const writes = encodeSettings(patch, before, this.info?.rated_power ?? 0);
        for (const w of writes) await c.writeMultiple(w.addr, [w.value]);
        const after = await read();
        const failed = writes.filter((w) => after.get(w.addr) !== w.value);
        this.settings = decodeSettings(after);
        for (const w of writes.filter((x) => !failed.includes(x))) {
          this.registry.audit('control', AUDIT_DEVICE, `${w.label}: ${before.get(w.addr)} → ${w.value} (rejestr ${w.addr}).`);
        }
        if (failed.length > 0) {
          const list = failed.map((w) => `${w.label} (rejestr ${w.addr}: oczekiwano ${w.value}, jest ${after.get(w.addr)})`).join('; ');
          this.registry.audit('warning', AUDIT_DEVICE, `Falownik nie przyjął: ${list}.`);
          throw new Error(`Falownik nie przyjął części zmian: ${list}.`);
        }
        return { applied: writes.map((w) => w.label), settings: this.settings };
      }),
    );
  }

  prune(): void {
    this.store.prune(this.options.retentionDays);
  }

  private checkOffline(now: number): void {
    if (this.offlineAlerted || this.offlineSince === null || now - this.offlineSince < OFFLINE_ALERT_MS) return;
    this.offlineAlerted = true;
    this.notifier.system('inverter_offline', 'warning', 'Falownik nie odpowiada',
      `Brak odczytu z loggera falownika od ${Math.round((now - this.offlineSince) / 60_000)} min. ` +
      `Ostatni błąd: ${this.status.last_error ?? 'nieznany'}. ${this.status.last_discovery_result ?? ''}`.trim());
  }

  private onRecovered(): void {
    if (this.offlineAlerted) {
      this.notifier.system('inverter_online', 'info', 'Falownik odpowiada', `Odczyt z loggera falownika (${this.getConfig().host}) znowu działa.`);
    }
    this.offlineSince = null;
    this.offlineAlerted = false;
  }

  private syncStatus(): void {
    const cfg = this.getConfig();
    this.status.configured = Boolean(cfg.logger_serial);
    this.status.enabled = cfg.enabled;
    this.status.host = cfg.host;
    this.status.port = cfg.port;
    this.status.control_enabled = cfg.control_enabled;
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Adresy do sprawdzenia: podsieć /24 ostatniego adresu loggera i podsieci /24 interfejsów serwera. */
export function candidateHosts(lastHost: string): string[] {
  const prefixes = new Set<string>();
  const own = new Set<string>();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(lastHost)) prefixes.add(lastHost.split('.').slice(0, 3).join('.'));
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      own.add(a.address);
      // Tylko sieci /24 — większych (np. VPN /22) nie przeszukujemy
      if (a.netmask === '255.255.255.0') prefixes.add(a.address.split('.').slice(0, 3).join('.'));
    }
  }
  const hosts: string[] = [];
  // Ostatni znany adres pierwszy
  if (lastHost && !own.has(lastHost)) hosts.push(lastHost);
  for (const p of prefixes) {
    for (let i = 1; i <= 254; i++) {
      const h = `${p}.${i}`;
      if (!own.has(h) && h !== lastHost) hosts.push(h);
    }
  }
  return hosts;
}

/** Które adresy mają otwarty port (krótki timeout, ograniczona liczba równoległych prób). */
export async function scanPort(hosts: string[], port: number, timeoutMs = 600, concurrency = 24): Promise<string[]> {
  const open: string[] = [];
  let next = 0;
  const probe = (host: string) =>
    new Promise<boolean>((resolve) => {
      const s = new Socket();
      const done = (ok: boolean) => {
        s.destroy();
        resolve(ok);
      };
      s.setTimeout(timeoutMs, () => done(false));
      s.once('error', () => done(false));
      s.connect(port, host, () => done(true));
    });
  const worker = async () => {
    while (next < hosts.length) {
      const host = hosts[next++];
      if (await probe(host)) open.push(host);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
  // Zachowaj kolejność (ostatni znany adres pierwszy)
  return hosts.filter((h) => open.includes(h));
}
