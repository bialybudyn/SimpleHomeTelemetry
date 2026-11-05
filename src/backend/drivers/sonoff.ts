import makeMdns from 'multicast-dns';
import type { CommandResult, DeviceRegistry, Driver } from '../registry';
import { buildSonoffRequests, encryptParams, normalizeSonoffParams, paramsFromTxt, parseTxt } from './sonoff-protocol';
import type { Device } from '../../app/models/telemetry.models';

const SERVICE = '_ewelink._tcp.local';
/** Jedno zapytanie mDNS co 2 minuty (jeden pakiet multicast — urządzenia odpowiadają same). */
const QUERY_INTERVAL_MS = 120_000;
/** Bez ogłoszeń przez tyle czasu urządzenie uznajemy za niedostępne. */
const OFFLINE_AFTER_MS = 6 * 60_000;
const HTTP_TIMEOUT_MS = 4000;

export const sonoffId = (deviceid: string) => `sonoff_${deviceid}`;

/**
 * Sterownik gniazdek/przekaźników Sonoff Wi-Fi w trybie eWeLink LAN.
 * Nie skanuje sieci: stan i adres IP przychodzą z ogłoszeń mDNS urządzeń.
 * Każde polecenie to dokładnie jedno żądanie HTTP do urządzenia.
 */
export class SonoffDriver implements Driver {
  readonly name = 'sonoff' as const;
  private mdns: ReturnType<typeof makeMdns> | null = null;
  private queryTimer: ReturnType<typeof setInterval> | null = null;
  private offlineTimer: ReturnType<typeof setInterval> | null = null;
  private lastAnnounce = new Map<string, number>();
  private lastTxtSeq = new Map<string, string>();

  constructor(private readonly registry: DeviceRegistry) {}

  start(): void {
    this.stop();
    try {
      this.mdns = makeMdns();
    } catch (err) {
      console.warn('[SONOFF] Nie można uruchomić mDNS:', err);
      return;
    }
    this.mdns.on('response', (packet, rinfo) => this.handleResponse(packet, rinfo.address));
    this.mdns.on('error', (err: Error) => console.warn('[SONOFF] Błąd mDNS:', err.message));
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

  private query(): void {
    this.mdns?.query({ questions: [{ name: SERVICE, type: 'PTR' }] });
  }

  /** Obsługa odpowiedzi/ogłoszenia mDNS (publiczna dla testów). */
  handleResponse(packet: { answers?: any[]; additionals?: any[] }, sourceIp: string): void {
    const records = [...(packet.answers ?? []), ...(packet.additionals ?? [])];
    const ipByHost = new Map<string, string>();
    for (const r of records) if (r.type === 'A') ipByHost.set(r.name, r.data);

    for (const r of records) {
      if (r.type !== 'TXT' || !String(r.name).endsWith(SERVICE)) continue;
      const txt = parseTxt(Array.isArray(r.data) ? r.data : [r.data]);
      const deviceid = txt['id'];
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
      // Nowe urządzenie w sieci: dodajemy je, ale do odczytu stanu potrzebny jest devicekey
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
    if (dev.ip_address !== ip) this.registry.upsert(id, { ip_address: ip }, { silent: true });
    this.registry.setAvailability(id, true);

    // Ten sam numer sekwencji = ten sam stan (odpowiedź na nasze zapytanie okresowe)
    const seq = txt['seq'];
    if (seq && this.lastTxtSeq.get(id) === seq) return;

    try {
      const params = paramsFromTxt(txt, dev.sonoff_api_key);
      if (!params) {
        if (txt['encrypt'] === 'true' && !dev.sonoff_api_key) {
          this.registry.upsert(id, { last_error: 'Brak devicekey — zaimportuj urządzenia z eWeLink albo wpisz klucz ręcznie.' });
        }
        return;
      }
      if (seq) this.lastTxtSeq.set(id, seq);
      if (Array.isArray(params['switches']) && dev.category !== 'switch') {
        this.registry.upsert(id, { sonoff_multi_channel: true } as Partial<Device>, { silent: true });
      }
      this.registry.applyState(id, normalizeSonoffParams(params));
    } catch {
      this.registry.setError(id, 'Nie można odszyfrować stanu — nieprawidłowy devicekey.');
    }
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
    if (!dev.ip_address) return { success: false, message: 'Nieznany adres IP — urządzenie jeszcze się nie ogłosiło w sieci (mDNS).' };
    if (!dev.sonoff_device_id) return { success: false, message: 'Brak deviceid urządzenia.' };
    const multi = Boolean((dev as Device & { sonoff_multi_channel?: boolean }).sonoff_multi_channel);
    const requests = buildSonoffRequests(command, multi);
    if (requests.length === 0) return { success: false, message: 'To polecenie nie jest obsługiwane przez Sonoff LAN.' };

    for (const r of requests) {
      const res = await this.post(dev, r.cmd, r.params);
      if (!res.success) return res;
    }
    return { success: true, message: 'Polecenie przyjęte przez urządzenie.' };
  }

  /** Odczyt stanu: zapytanie mDNS (urządzenie odpowiada rekordem TXT z aktualnym stanem). */
  async refresh(_dev: Device): Promise<CommandResult> {
    this.query();
    return { success: true, message: 'Wysłano zapytanie mDNS — stan odświeży się po odpowiedzi urządzenia.' };
  }

  private async post(dev: Device, cmd: string, params: Record<string, unknown>): Promise<CommandResult> {
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
    try {
      const res = await fetch(`http://${dev.ip_address}:8081/zeroconf/${cmd}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const error = Number(json['error'] ?? (res.ok ? 0 : res.status));
      if (error === 0) return { success: true, message: 'OK' };
      if (error === 401) return { success: false, message: 'Urządzenie odrzuciło polecenie: nieprawidłowy devicekey (401).' };
      return { success: false, message: `Urządzenie zwróciło błąd ${error}.` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Brak odpowiedzi z ${dev.ip_address}:8081 (${msg}).` };
    }
  }
}
