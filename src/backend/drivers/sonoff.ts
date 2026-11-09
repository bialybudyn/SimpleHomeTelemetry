import { request } from 'node:http';
import makeMdns from 'multicast-dns';
import type { CommandResult, DeviceRegistry, Driver } from '../registry';
import { buildSonoffRequests, decryptParams, encryptParams, normalizeSonoffParams, paramsFromTxt, parseTxt } from './sonoff-protocol';
import type { Device } from '../../app/models/telemetry.models';

const SERVICE = '_ewelink._tcp.local';
/** Jedno zapytanie mDNS co 2 minuty (jeden pakiet multicast — urządzenia odpowiadają same). */
const QUERY_INTERVAL_MS = 120_000;
/** Bez ogłoszeń przez tyle czasu urządzenie uznajemy za niedostępne. */
const OFFLINE_AFTER_MS = 6 * 60_000;
const HTTP_TIMEOUT_MS = 5000;
/**
 * Odstęp między zapytaniami do jednego urządzenia. Dokumentacja Sonoff DIY mówi o ≥ 200 ms,
 * ale S60TPF przy kilku poleceniach w ciągu kilkunastu sekund wyłącza serwer LAN na ~2–3 min.
 */
const REQUEST_GAP_MS = 1500;
/** Po braku odpowiedzi nie wysyłamy kolejnych poleceń przez ten czas (nie dokładamy połączeń zawieszonemu ESP). */
const COOLDOWN_AFTER_TIMEOUT_MS = 30_000;
/** Ile czekamy na odpowiedź mDNS przy ręcznym odczycie stanu. */
const REFRESH_TIMEOUT_MS = 5000;

/** Wynik polecenia pominiętego, bo w kolejce czekało nowsze. */
const SKIPPED = Symbol('skipped');

export const sonoffId =(deviceid: string) => `sonoff_${deviceid}`;

export interface SonoffSeen {
  deviceid: string;
  ip: string;
  type?: string;
  encrypt: boolean;
  seq?: string;
  last_seen: string;
  known: boolean;
  has_key: boolean;
  decrypt_ok: boolean | null;
}

/**
 * Sterownik gniazdek/przekaźników Sonoff Wi-Fi w trybie eWeLink LAN
 * (ten sam protokół co integracja SonoffLAN dla Home Assistant).
 * - nie skanuje sieci: stan i adres IP przychodzą z ogłoszeń mDNS urządzeń,
 * - zapytania do jednego urządzenia idą po kolei, z nagłówkiem "Connection: close"
 *   (mikrokontroler ESP ma bardzo mało gniazd TCP — nie trzymamy ich otwartych).
 */
export class SonoffDriver implements Driver {
  readonly name = 'sonoff' as const;
  private mdns: ReturnType<typeof makeMdns> | null = null;
  private queryTimer: ReturnType<typeof setInterval> | null = null;
  private offlineTimer: ReturnType<typeof setInterval> | null = null;
  private lastAnnounce = new Map<string, number>();
  private lastTxtSeq = new Map<string, string>();
  private queues = new Map<string, Promise<unknown>>();
  private seen = new Map<string, SonoffSeen>();
  /** Oczekujący na ogłoszenie mDNS danego urządzenia (ręczny odczyt stanu). */
  private refreshWaiters = new Map<string, Set<() => void>>();
  /** Numer ostatniego polecenia na urządzenie: starsze polecenia czekające w kolejce są pomijane. */
  private commandGen = new Map<string, number>();
  private cooldownUntil = new Map<string, number>();
  mdnsError: string | null = null;

  constructor(private readonly registry: DeviceRegistry) {}

  start(): void {
    this.stop();
    try {
      this.mdns = makeMdns();
      this.mdnsError = null;
    } catch (err) {
      this.mdnsError = err instanceof Error ? err.message : String(err);
      console.warn('[SONOFF] Nie można uruchomić mDNS:', this.mdnsError);
      return;
    }
    this.mdns.on('response', (packet, rinfo) => this.handleResponse(packet, rinfo.address));
    this.mdns.on('error', (err: Error) => {
      this.mdnsError = err.message;
      console.warn('[SONOFF] Błąd mDNS:', err.message);
    });
    this.query();
    this.queryTimer = setInterval(() => this.query(), QUERY_INTERVAL_MS);
    this.offlineTimer = setInterval(() => this.checkOffline(), 60_000);
  }

  stop(): void {
    if (this.queryTimer) clearInterval(this.queryTimer);
    if (this.offlineTimer) clearInterval(this.offlineTimer);
    this.queryTimer = this.offlineTimer = null;
    this.mdns?.destroy();
    this.mdns = null;
  }

  query(): void {
    this.mdns?.query({ questions: [{ name: SERVICE, type: 'PTR' }] });
  }

  /** Urządzenia eWeLink widziane w sieci (diagnostyka). */
  diagnostics(): { mdns_running: boolean; mdns_error: string | null; seen: SonoffSeen[] } {
    return { mdns_running: this.mdns !== null, mdns_error: this.mdnsError, seen: [...this.seen.values()] };
  }

  /** Obsługa odpowiedzi/ogłoszenia mDNS (publiczna dla testów). */
  handleResponse(packet: { answers?: any[]; additionals?: any[] }, sourceIp: string): void {
    const records = [...(packet.answers ?? []), ...(packet.additionals ?? [])];
    const ipByHost = new Map<string, string>();
    for (const r of records) if (r.type === 'A') ipByHost.set(r.name, r.data);

    for (const r of records) {
      if (r.type !== 'TXT' || !String(r.name).toLowerCase().endsWith(SERVICE.toLowerCase())) continue;
      const txt = parseTxt(Array.isArray(r.data) ? r.data : [r.data]);
      // Nazwa usługi: eWeLink_<deviceid>._ewelink._tcp.local
      const deviceid = txt['id'] || String(r.name).match(/^ewelink_([0-9a-z]+)\./i)?.[1];
      if (!deviceid) continue;
      const srv = records.find((x) => x.type === 'SRV' && x.name === r.name);
      const ip = (srv && ipByHost.get(srv.data?.target)) || sourceIp;
      this.handleTxt(deviceid, txt, ip);
    }
  }

  private handleTxt(deviceid: string, txt: Record<string, string>, ip: string): void {
    const id = sonoffId(deviceid);
    let dev = this.registry.get(id);
    if (!dev) {
      // Nowe urządzenie w sieci: dodajemy je; do odczytu stanu potrzebny jest devicekey
      dev = this.registry.upsert(id, {
        driver: 'sonoff',
        protocol: 'wifi',
        friendly_name: `Sonoff ${deviceid}`,
        model: txt['type'] ?? 'eWeLink',
        vendor: 'SONOFF',
        category: 'plug',
        sonoff_device_id: deviceid,
        ip_address: ip,
      });
    }
    this.lastAnnounce.set(id, Date.now());
    if (dev.ip_address?.split(':')[0] !== ip) this.registry.upsert(id, { ip_address: ip }, { silent: true });
    this.registry.setAvailability(id, true);

    const seenEntry: SonoffSeen = {
      deviceid,
      ip,
      type: txt['type'],
      encrypt: txt['encrypt'] === 'true',
      seq: txt['seq'],
      last_seen: new Date().toISOString(),
      known: !dev.is_deleted,
      has_key: Boolean(dev.sonoff_api_key),
      decrypt_ok: this.seen.get(deviceid)?.decrypt_ok ?? null,
    };
    this.seen.set(deviceid, seenEntry);
    const waiters = this.refreshWaiters.get(deviceid);
    if (waiters) {
      this.refreshWaiters.delete(deviceid);
      // Po przetworzeniu stanu poniżej (applyState jest synchroniczne)
      queueMicrotask(() => waiters.forEach((w) => w()));
    }

    // Ten sam numer sekwencji = ten sam stan (odpowiedź na nasze zapytanie okresowe)
    const seq = txt['seq'];
    if (seq && this.lastTxtSeq.get(id) === seq) return;

    try {
      const params = paramsFromTxt(txt, dev.sonoff_api_key);
      if (!params) {
        if (seenEntry.encrypt && !dev.sonoff_api_key) {
          this.registry.upsert(id, { last_error: 'Brak devicekey — zaimportuj klucze z eWeLink (OAuth) albo wpisz ręcznie.' });
        }
        return;
      }
      seenEntry.decrypt_ok = true;
      if (seq) this.lastTxtSeq.set(id, seq);
      this.applyParams(id, params);
    } catch {
      seenEntry.decrypt_ok = false;
      this.registry.setError(id, 'Nie można odszyfrować stanu — nieprawidłowy devicekey.');
    }
  }

  private applyParams(id: string, params: Record<string, unknown>): void {
    if (Array.isArray(params['switches']) && !params['switch']) {
      this.registry.upsert(id, { sonoff_multi_channel: true }, { silent: true });
    }
    this.registry.applyState(id, normalizeSonoffParams(params, this.registry.get(id)?.sonoff_uiid));
  }

  private checkOffline(): void {
    const now = Date.now();
    for (const dev of this.registry.byDriver('sonoff')) {
      const last = this.lastAnnounce.get(dev.ieee_address);
      if (last !== undefined && now - last > OFFLINE_AFTER_MS) {
        this.registry.setAvailability(dev.ieee_address, false);
      }
    }
  }

  async sendCommand(dev: Device, command: Record<string, unknown>): Promise<CommandResult> {
    const check = this.precheck(dev);
    if (check) return check;
    const requests = buildSonoffRequests(command, Boolean(dev.sonoff_multi_channel));
    if (requests.length === 0) return { success: false, message: 'To polecenie nie jest obsługiwane przez Sonoff LAN.' };

    const id = dev.ieee_address;
    const wait = (this.cooldownUntil.get(id) ?? 0) - Date.now();
    if (wait > 0) {
      return { success: false, message: `Gniazdko chwilowo nie odpowiada w sieci LAN — spróbuj za ${Math.ceil(wait / 1000)} s.` };
    }
    const gen = (this.commandGen.get(id) ?? 0) + 1;
    this.commandGen.set(id, gen);

    for (const r of requests) {
      // Szybkie klikanie: wysyłamy tylko najnowsze polecenie, pośrednie pomijamy
      const res = await this.post(dev, r.cmd, r.params, () => this.commandGen.get(id) !== gen);
      if (res === SKIPPED) return { success: true, message: 'Pominięto — w kolejce jest nowsze polecenie.' };
      if (!res.success) return res;
    }
    return { success: true, message: 'Polecenie przyjęte przez urządzenie.' };
  }

  /**
   * Odczyt stanu przez mDNS: jedno zapytanie multicast, urządzenie odpowiada rekordem TXT ze stanem.
   * Nie używamy /zeroconf/getState — S60TPF (UIID 190, firmware 1.2.0) zwraca na nie błąd 400.
   */
  async refresh(dev: Device): Promise<CommandResult> {
    if (!dev.sonoff_device_id) return { success: false, message: 'Brak deviceid urządzenia.' };
    if (!this.mdns) return { success: false, message: `mDNS nie działa${this.mdnsError ? `: ${this.mdnsError}` : ''}.` };
    const announced = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.refreshWaiters.get(dev.sonoff_device_id!)?.delete(done);
        resolve(false);
      }, REFRESH_TIMEOUT_MS);
      const done = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const set = this.refreshWaiters.get(dev.sonoff_device_id!) ?? new Set();
      set.add(done);
      this.refreshWaiters.set(dev.sonoff_device_id!, set);
    });
    // Wymuszamy przetworzenie odpowiedzi, nawet jeśli numer sekwencji się nie zmienił
    this.lastTxtSeq.delete(dev.ieee_address);
    this.query();
    return (await announced)
      ? { success: true, message: 'Stan odczytany z urządzenia.' }
      : { success: false, message: `Urządzenie nie odpowiedziało na zapytanie mDNS w ciągu ${REFRESH_TIMEOUT_MS / 1000} s.` };
  }

  private precheck(dev: Device): CommandResult | null {
    if (!dev.sonoff_device_id) return { success: false, message: 'Brak deviceid urządzenia.' };
    if (!dev.ip_address) return { success: false, message: 'Nieznany adres IP — urządzenie jeszcze nie ogłosiło się w sieci (mDNS). Możesz wpisać IP ręcznie.' };
    return null;
  }

  /** Zapytania do jednego urządzenia wykonywane po kolei (bez równoległych połączeń). */
  private post(dev: Device, cmd: string, params: Record<string, unknown>, isStale: () => boolean = () => false): Promise<CommandResult | typeof SKIPPED> {
    const key = dev.ieee_address;
    const prev = this.queues.get(key) ?? Promise.resolve();
    const run = prev
      .catch(() => undefined)
      .then(async () => {
        if (isStale()) return SKIPPED; // pominięte — nic nie wysłano
        const res = await this.doPost(dev, cmd, params);
        if (res.timedOut) this.cooldownUntil.set(key, Date.now() + COOLDOWN_AFTER_TIMEOUT_MS);
        return res;
      });
    // Odstęp wstrzymuje tylko następne zapytanie w kolejce, nie odpowiedź dla wywołującego
    this.queues.set(
      key,
      run.then((res) => (res === SKIPPED ? undefined : new Promise((r) => setTimeout(r, REQUEST_GAP_MS)))),
    );
    return run;
  }

  private async doPost(dev: Device, cmd: string, params: Record<string, unknown>): Promise<CommandResult & { timedOut?: boolean }> {
    const body: Record<string, unknown> = {
      sequence: String(Date.now()),
      deviceid: dev.sonoff_device_id,
      selfApikey: '123',
    };
    if (dev.sonoff_api_key) {
      const enc = encryptParams(params, dev.sonoff_api_key);
      Object.assign(body, { encrypt: true, iv: enc.iv, data: enc.data });
    } else {
      Object.assign(body, { encrypt: false, data: params });
    }

    let json: Record<string, unknown>;
    try {
      // Adres może zawierać port ("IP:port"), domyślnie 8081
      const [host, portStr] = dev.ip_address!.split(':');
      json = await httpPostJson(host, Number(portStr) || 8081, `/zeroconf/${cmd}`, body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        timedOut: true,
        message: `Brak odpowiedzi z ${dev.ip_address}:8081 (${msg}). Gniazdko mogło chwilowo zablokować serwer LAN — kolejne polecenia za ${COOLDOWN_AFTER_TIMEOUT_MS / 1000} s.`,
      };
    }

    const error = Number(json['error'] ?? 0);
    // Odpowiedź może zawierać aktualny stan (S60TPF odpowiada stanem na każde zapytanie)
    if (typeof json['iv'] === 'string' && typeof json['data'] === 'string' && dev.sonoff_api_key) {
      try {
        this.applyParams(dev.ieee_address, decryptParams(json['data'], json['iv'], dev.sonoff_api_key));
      } catch {
        // stan w odpowiedzi jest opcjonalny
      }
    } else if (json['data'] && typeof json['data'] === 'object') {
      this.applyParams(dev.ieee_address, json['data'] as Record<string, unknown>);
    }

    if (error === 0) return { success: true, message: 'OK' };
    if (error === 401) return { success: false, message: 'Urządzenie odrzuciło polecenie: nieprawidłowy devicekey (401).' };
    if (error === 400) return { success: false, message: 'Urządzenie odrzuciło polecenie (400 — niepoprawny format lub nieobsługiwana komenda).' };
    return { success: false, message: `Urządzenie zwróciło błąd ${error}.` };
  }
}

/** POST JSON przez node:http z "Connection: close" (fetch trzymałby połączenie keep-alive). */
function httpPostJson(host: string, port: number, path: string, payload: unknown): Promise<Record<string, unknown>> {
  const data = Buffer.from(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host,
        port,
        path,
        method: 'POST',
        agent: false,
        timeout: HTTP_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, Connection: 'close' },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(text ? (JSON.parse(text) as Record<string, unknown>) : { error: res.statusCode === 200 ? 0 : res.statusCode });
          } catch {
            reject(new Error(`niepoprawna odpowiedź HTTP ${res.statusCode}`));
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('przekroczono czas')));
    req.on('error', reject);
    req.end(data);
  });
}
