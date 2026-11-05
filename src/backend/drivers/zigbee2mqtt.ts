import mqtt, { type MqttClient } from 'mqtt';
import type { EventBus } from '../events';
import type { CommandResult, DeviceRegistry, Driver } from '../registry';
import { PANEL_SETTING_KEYS } from '../registry';
import { buildGetPayload, categoryFromExposes, flattenExposes, resolveTopic } from '../state-mapper';
import type { Device, MqttStatus, Z2mExpose } from '../../app/models/telemetry.models';

interface Z2mBridgeDevice {
  ieee_address: string;
  type: string;
  friendly_name: string;
  disabled?: boolean;
  supported?: boolean;
  interview_completed?: boolean;
  model_id?: string;
  manufacturer?: string;
  power_source?: string;
  definition?: { model?: string; vendor?: string; description?: string; exposes?: Z2mExpose[] } | null;
}

export interface Z2mOptions {
  url: string;
  topic: string;
  username?: string;
  password?: string;
}

/** Bit dostępu SET w Zigbee2MQTT. */
const ACCESS_SET = 0b010;

/**
 * Sterownik Zigbee2MQTT.
 * - lista urządzeń i ich możliwości: retained `bridge/devices` (z `exposes`),
 * - stan: `<friendly_name>` (pełny payload, bez filtrowania pól),
 * - dostępność: `<friendly_name>/availability`,
 * - odczyt na żądanie: `<friendly_name>/get` z atrybutami, które da się odczytać.
 */
export class Zigbee2MqttDriver implements Driver {
  readonly name = 'zigbee2mqtt' as const;
  private client: MqttClient | null = null;
  private nameToId = new Map<string, string>();
  private permitJoinEnd = 0;

  readonly status: MqttStatus = {
    connected: false,
    url: '',
    topic_prefix: '',
    last_error: null,
    messages_received: 0,
    last_message_at: null,
    last_message_topic: null,
    bridge_state: null,
    devices_discovered: 0,
  };

  constructor(
    private options: Z2mOptions,
    private readonly registry: DeviceRegistry,
    private readonly events: EventBus,
  ) {
    this.status.url = options.url;
    this.status.topic_prefix = options.topic;
    for (const d of registry.byDriver('zigbee2mqtt')) this.nameToId.set(d.friendly_name, d.ieee_address);
  }

  start(): void {
    this.stop();
    const { url, username, password, topic } = this.options;
    console.log(`[Z2M] Łączenie z ${url} (temat: ${topic})`);
    const client = mqtt.connect(url, {
      username,
      password,
      reconnectPeriod: 5000,
      connectTimeout: 10_000,
      clientId: `simplehome_panel_${Math.random().toString(16).slice(2, 8)}`,
    });
    this.client = client;

    client.on('connect', () => {
      this.status.connected = true;
      this.status.last_error = null;
      client.subscribe(`${topic}/#`, (err) => {
        if (err) console.error('[Z2M] Błąd subskrypcji:', err.message);
      });
      this.emitStatus();
    });
    client.on('error', (err) => {
      this.status.last_error = err.message;
      this.emitStatus();
    });
    client.on('close', () => {
      if (this.status.connected) {
        this.status.connected = false;
        this.emitStatus();
      }
    });
    client.on('message', (t, payload) => this.handleMessage(t, payload));
  }

  stop(): void {
    this.client?.end(true);
    this.client = null;
    this.status.connected = false;
  }

  reconfigure(options: Partial<Z2mOptions>): void {
    this.options = { ...this.options, ...options };
    this.status.url = this.options.url;
    this.status.topic_prefix = this.options.topic;
    this.start();
  }

  get permitJoinRemaining(): number {
    return Math.max(0, Math.round((this.permitJoinEnd - Date.now()) / 1000));
  }

  /** Obsługa komunikatu MQTT (publiczna dla testów). */
  handleMessage(topic: string, payload: Buffer): void {
    const prefix = this.options.topic;
    if (!topic.startsWith(prefix + '/')) return;
    this.status.messages_received++;
    this.status.last_message_at = new Date().toISOString();
    this.status.last_message_topic = topic;

    const sub = topic.slice(prefix.length + 1);
    const text = payload.toString();

    if (sub.startsWith('bridge/')) {
      this.handleBridge(sub.slice('bridge/'.length), text);
      return;
    }

    const resolved = resolveTopic(sub, this.nameToId.keys());
    if (!resolved) return;
    const id = this.nameToId.get(resolved.name);
    if (!id) return;

    if (resolved.rest === '') {
      const state = parseJson(text);
      if (state && typeof state === 'object' && !Array.isArray(state)) {
        this.registry.applyState(id, state as Record<string, unknown>);
      }
    } else if (resolved.rest === 'availability') {
      const parsed = parseJson(text);
      const value = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>)['state'] : text.trim();
      if (value === 'online' || value === 'offline') this.registry.setAvailability(id, value === 'online');
    }
    // <name>/set, <name>/get i inne podtematy to polecenia, nie stan — ignorujemy
  }

  private handleBridge(sub: string, text: string): void {
    switch (sub) {
      case 'state': {
        const parsed = parseJson(text);
        const state = parsed && typeof parsed === 'object' ? String((parsed as Record<string, unknown>)['state']) : text.trim();
        this.status.bridge_state = state;
        this.events.broadcast({ type: 'bridge_state', state });
        this.emitStatus();
        return;
      }
      case 'info': {
        const info = parseJson(text) as Record<string, any> | null;
        if (!info) return;
        this.status.z2m_version = info['version'];
        this.status.channel = info['network']?.['channel'];
        this.status.coordinator_type = info['coordinator']?.['type'];
        const end = typeof info['permit_join_end'] === 'number' ? info['permit_join_end'] : info['permit_join'] ? Date.now() + 254_000 : 0;
        const wasOpen = this.permitJoinRemaining > 0;
        this.permitJoinEnd = info['permit_join'] ? end : 0;
        if (this.permitJoinRemaining > 0 && !wasOpen) {
          this.events.broadcast({ type: 'permit_join', duration: this.permitJoinRemaining });
        }
        this.emitStatus();
        return;
      }
      case 'devices': {
        const list = parseJson(text);
        if (Array.isArray(list)) this.syncDevices(list as Z2mBridgeDevice[]);
        return;
      }
      default:
        return;
    }
  }

  /** Synchronizuje rejestr z listą urządzeń Zigbee2MQTT. */
  syncDevices(list: Z2mBridgeDevice[]): void {
    const seen = new Set<string>();
    this.nameToId.clear();
    for (const item of list) {
      if (!item?.ieee_address || item.type === 'Coordinator') continue;
      const id = item.ieee_address;
      seen.add(id);
      this.nameToId.set(item.friendly_name, id);
      const exposes = item.definition?.exposes ?? [];
      const existing = this.registry.get(id);
      this.registry.upsert(
        id,
        {
          driver: 'zigbee2mqtt',
          protocol: 'zigbee',
          friendly_name: item.friendly_name,
          model: item.definition?.model ?? item.model_id ?? 'Nieznany model',
          vendor: item.definition?.vendor ?? item.manufacturer,
          description: item.definition?.description ?? null,
          exposes,
          category: categoryFromExposes(exposes),
          last_error: item.interview_completed === false ? 'Parowanie (interview) nie zostało ukończone.' : existing?.last_error ?? null,
          // Urządzenie obecne w Z2M wraca na pulpit, chyba że użytkownik je ukrył
          is_deleted: Boolean(existing?.is_deleted && !existing.deleted_by_bridge),
          deleted_by_bridge: false,
        },
        { silent: true },
      );
    }
    // Urządzenia usunięte z Zigbee2MQTT znikają z pulpitu (historia zostaje, można je trwale usunąć w ustawieniach)
    if (list.length > 0) {
      for (const dev of this.registry.byDriver('zigbee2mqtt')) {
        if (!seen.has(dev.ieee_address) && !dev.is_deleted) {
          this.registry.upsert(dev.ieee_address, { is_deleted: true, deleted_at: new Date().toISOString(), deleted_by_bridge: true }, { silent: true });
          this.registry.audit('soft_delete', dev, `Urządzenie "${dev.friendly_name}" zniknęło z Zigbee2MQTT.`);
        }
      }
    }
    this.status.devices_discovered = seen.size;
    this.registry.emitAll();
    this.emitStatus();
  }

  async sendCommand(dev: Device, command: Record<string, unknown>): Promise<CommandResult> {
    const payload = this.buildSetPayload(dev, command);
    if (Object.keys(payload).length === 0) {
      return { success: false, message: 'Brak atrybutów, które to urządzenie pozwala zmienić.' };
    }
    return this.publish(`${dev.friendly_name}/set`, payload);
  }

  async refresh(dev: Device): Promise<CommandResult> {
    const payload = buildGetPayload(dev.exposes);
    if (!payload) {
      return {
        success: false,
        message: 'To urządzenie nie obsługuje odczytu na żądanie (np. czujnik bateryjny — wysyła dane sam po wybudzeniu).',
      };
    }
    return this.publish(`${dev.friendly_name}/get`, payload);
  }

  async rename(dev: Device, newName: string): Promise<CommandResult> {
    return this.publish('bridge/request/device/rename', { from: dev.friendly_name, to: newName, homeassistant_rename: false });
  }

  async remove(dev: Device): Promise<CommandResult> {
    return this.publish('bridge/request/device/remove', { id: dev.ieee_address, force: false });
  }

  async permitJoin(seconds: number): Promise<CommandResult> {
    const time = Math.max(0, Math.min(254, Math.round(seconds)));
    const legacy = (this.status.z2m_version ?? '').startsWith('1.');
    return this.publish('bridge/request/permit_join', legacy ? { value: time > 0, time } : { time });
  }

  /** Buduje payload /set: tylko atrybuty zapisywalne wg exposes (alarmy panelu nie trafiają do urządzenia). */
  buildSetPayload(dev: Device, command: Record<string, unknown>): Record<string, unknown> {
    const writable = new Set(
      flattenExposes(dev.exposes)
        .filter((f) => typeof f.access === 'number' && (f.access & ACCESS_SET) !== 0)
        .map((f) => f.property as string),
    );
    const panelKeys = new Set<string>(PANEL_SETTING_KEYS);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(command)) {
      if (panelKeys.has(key) || value === undefined) continue;
      let target = key;
      // Starszy frontend wysyła current_heating_setpoint — TRVZB oczekuje occupied_heating_setpoint
      if (key === 'current_heating_setpoint' && !writable.has(key) && writable.has('occupied_heating_setpoint')) {
        target = 'occupied_heating_setpoint';
      }
      // Bez exposes (urządzenie nieobsługiwane przez Z2M) przepuszczamy polecenie bez zmian
      if (writable.size === 0 || writable.has(target)) out[target] = value;
    }
    return out;
  }

  private async publish(sub: string, payload: Record<string, unknown>): Promise<CommandResult> {
    const client = this.client;
    if (!client || !this.status.connected) {
      return { success: false, message: 'Brak połączenia z brokerem MQTT.' };
    }
    const topic = `${this.options.topic}/${sub}`;
    return new Promise((resolve) => {
      client.publish(topic, JSON.stringify(payload), (err) => {
        if (err) resolve({ success: false, message: `Błąd publikacji MQTT: ${err.message}` });
        else resolve({ success: true, message: `Wysłano do ${topic}` });
      });
    });
  }

  private emitStatus(): void {
    this.events.broadcast({ type: 'mqtt_status', data: this.status });
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
