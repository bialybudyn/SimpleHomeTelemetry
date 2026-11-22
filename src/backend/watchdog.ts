import type { Notifier } from './notifications';
import type { DeviceRegistry } from './registry';
import type { Device, MqttStatus } from '../app/models/telemetry.models';

/** Co ile sprawdzamy stan. Pierwsze sprawdzenie też po tym czasie — po starcie retained availability zdąży dojść. */
export const WATCHDOG_INTERVAL_MS = 5 * 60_000;
/** Tyle Zigbee2MQTT / broker MQTT musi nie działać, zanim powiadomimy (krótkie restarty nie alarmują). */
export const BRIDGE_DOWN_ALERT_MS = 5 * 60_000;

/**
 * Strażnik: powiadamia (panel + e-mail/Telegram), gdy urządzenia Zigbee przestają odpowiadać
 * albo gdy panel traci Zigbee2MQTT. Jedno zbiorcze powiadomienie na sprawdzenie, a nie seria.
 *
 * Kiedy urządzenie jest "offline", decyduje rejestr (availability Zigbee2MQTT: urządzenia sieciowe
 * po ~10 min, bateryjne po ~25 h ciszy). Fakt wysłania alarmu jest zapisany w urządzeniu,
 * więc restart panelu nie powtarza powiadomień o tych samych urządzeniach.
 */
export class Watchdog {
  private timer: ReturnType<typeof setInterval> | null = null;
  private bridgeDownSince: number | null = null;
  private bridgeAlerted = false;

  constructor(
    private readonly registry: DeviceRegistry,
    private readonly notifier: Notifier,
    private readonly mqttStatus: () => MqttStatus,
  ) {}

  start(): void {
    this.stop();
    this.timer = setInterval(() => this.check(), WATCHDOG_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Jedno sprawdzenie (publiczne dla testów). */
  check(now = Date.now()): void {
    const bridgeUp = this.checkBridge(now);
    // Bez Zigbee2MQTT nie wiemy nic o urządzeniach — wtedy alarmuje tylko sam mostek
    if (bridgeUp) this.checkDevices(now);
  }

  private checkBridge(now: number): boolean {
    const s = this.mqttStatus();
    const up = s.connected && s.bridge_state !== 'offline';
    if (up) {
      if (this.bridgeAlerted) {
        this.notifier.system('bridge_restored', 'info', 'Zigbee2MQTT działa', 'Połączenie z Zigbee2MQTT wróciło.');
      }
      this.bridgeDownSince = null;
      this.bridgeAlerted = false;
      return true;
    }
    this.bridgeDownSince ??= now;
    if (!this.bridgeAlerted && now - this.bridgeDownSince >= BRIDGE_DOWN_ALERT_MS) {
      this.bridgeAlerted = true;
      const why = !s.connected
        ? `Brak połączenia z brokerem MQTT (${s.url})${s.last_error ? `: ${s.last_error}` : ''}.`
        : 'Zigbee2MQTT zgłasza stan "offline" (usługa zatrzymana albo brak koordynatora).';
      this.notifier.system('bridge_offline', 'critical', 'Zigbee2MQTT nie działa',
        `${why} Urządzenia Zigbee nie przesyłają danych od ${minutesAgo(this.bridgeDownSince, now)} min.`);
    }
    return false;
  }

  private checkDevices(now: number): void {
    const lost: Device[] = [];
    const back: Device[] = [];
    for (const dev of this.registry.byDriver('zigbee2mqtt')) {
      if (dev.is_deleted) continue;
      const online = this.registry.isOnline(dev);
      if (!online && !dev.offline_alerted && dev.last_seen) {
        lost.push(dev);
      } else if (online && dev.offline_alerted) {
        back.push(dev);
      }
    }
    if (lost.length > 0) {
      const lines = lost.map((d) => `• ${d.friendly_name} — ostatni kontakt ${formatSeen(d.last_seen, now)}`);
      this.notifier.system('devices_offline', 'warning',
        lost.length === 1 ? `Urządzenie nie odpowiada: ${lost[0].friendly_name}` : `${lost.length} urządzeń nie odpowiada`,
        `Urządzenia Zigbee przestały odpowiadać:\n${lines.join('\n')}\n\nJeśli nie wrócą same, sprawdź baterię i zasięg albo sparuj je ponownie (przytrzymaj przycisk ok. 5 s przy włączonym parowaniu).`);
      for (const d of lost) this.registry.upsert(d.ieee_address, { offline_alerted: true }, { silent: true });
    }
    if (back.length > 0) {
      this.notifier.system('devices_online', 'info',
        back.length === 1 ? `Urządzenie wróciło: ${back[0].friendly_name}` : `${back.length} urządzeń wróciło`,
        `Urządzenia Zigbee znowu odpowiadają: ${back.map((d) => d.friendly_name).join(', ')}.`);
      for (const d of back) this.registry.upsert(d.ieee_address, { offline_alerted: false }, { silent: true });
    }
  }
}

function minutesAgo(since: number, now: number): number {
  return Math.max(1, Math.round((now - since) / 60_000));
}

function formatSeen(lastSeen: string | null | undefined, now: number): string {
  if (!lastSeen) return 'nieznany';
  const ms = Date.parse(lastSeen);
  const hours = (now - ms) / 3600_000;
  const when = new Date(ms).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' });
  const ago = hours < 48 ? `${Math.round(hours)} h temu` : `${Math.round(hours / 24)} dni temu`;
  return `${when} (${ago})`;
}
