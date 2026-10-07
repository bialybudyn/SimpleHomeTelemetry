import {
  createNodeRequestHandler,
  isMainModule,
} from '@angular/ssr/node';
import express, { Request, Response } from 'express';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import mqtt, { MqttClient } from 'mqtt';

// Wykrywanie katalogu zasobow statycznych przegladarki (CSS, JS, Fonts)
let browserDistFolder = join(import.meta.dirname, '../browser');
if (!existsSync(browserDistFolder)) {
  const fallbackPaths = [
    join(process.cwd(), 'dist/app/browser'),
    join(process.cwd(), 'browser'),
    '/opt/zigbee-telemetry-panel/dist/app/browser',
    '/root/SimpleHomeTelemetry/dist/app/browser',
    join(process.cwd(), 'static'),
  ];
  for (const p of fallbackPaths) {
    if (existsSync(p)) {
      browserDistFolder = p;
      break;
    }
  }
}

const app = express();
app.use(express.json());

// Serwowanie plikow statycznych na samym poczatku lancucha Express dla natychmiastowego ladowania CSS i JS
app.use(express.static(browserDistFolder, { maxAge: '1y', index: false, redirect: false }));
if (existsSync(join(process.cwd(), 'dist/app/browser'))) {
  app.use(express.static(join(process.cwd(), 'dist/app/browser'), { maxAge: '1y', index: false, redirect: false }));
}
if (existsSync(join(process.cwd(), 'public'))) {
  app.use(express.static(join(process.cwd(), 'public'), { maxAge: '1y', index: false, redirect: false }));
}
if (existsSync(join(process.cwd(), 'static'))) {
  app.use(express.static(join(process.cwd(), 'static'), { index: false, redirect: false }));
}

// Modele danych urzadzen i telemetrii dla Sonoff (TRVZB, S26R2, ZBMINI), Tuya oraz Götze & Jensen GOW 007
type DeviceCategory = 'climate' | 'fan' | 'plug' | 'switch' | 'sensor' | 'contact' | 'occupancy' | 'water_leak';

interface Device {
  ieee_address: string;
  friendly_name: string;
  model: string;
  category?: DeviceCategory;
  vendor?: string;
  last_seen: string | null;
  battery: number | null;
  linkquality: number | null;
  isRecentlyUpdated?: boolean;

  // Wentylator kolumnowy Tuya / Gotze & Jensen GOW 007 7w1 (WiFi / Tuya)
  fan_speed?: number | string | null;       // 1 - 12 (biegi nawiewu)
  fan_mode?: string | null;                 // normal / natural / sleep / auto
  fan_oscillation?: boolean | null;         // Oscylacja / obrot
  fan_timer?: number | null;                // Timer wylaczenia (h)
  fan_ionizer?: boolean | null;             // Jonizacja powietrza (7w1)
  fan_humidifier?: boolean | null;          // Nawilzacz ultradzwiekowy (7w1)
  fan_uv?: boolean | null;                  // Lampa UV sterylizujaca (7w1)

  // Czujniki temperatury i wilgotnosci
  last_temperature: number | null;
  last_humidity: number | null;

  // Glowice termostatyczne Sonoff TRVZB / TRVZB Gen 2
  current_heating_setpoint?: number | null;
  local_temperature?: number | null;
  system_mode?: string | null;
  running_state?: string | null;
  child_lock?: string | null;
  open_window?: boolean | null;

  // Wlaczniki i gniazdka sterowane (Sonoff S26R2ZB, ZBMINIR2, Tuya Smart Plug)
  state?: string | null;
  power?: number | null;
  voltage?: number | null;
  current?: number | null;
  energy?: number | null;

  // Czujniki kontaktronowe, ruchu, zalania (Sonoff SNZB-03/04/05, Tuya mmWave)
  contact?: boolean | null;
  occupancy?: boolean | null;
  water_leak?: boolean | null;
  illuminance?: number | null;
}

interface TelemetryPoint {
  id: number;
  device_ieee: string;
  temperature: number | null;
  humidity: number | null;
  battery: number | null;
  linkquality: number | null;
  power?: number | null;
  energy?: number | null;
  setpoint?: number | null;
  state?: string | null;
  timestamp: string;
}

function detectDeviceCategory(model: string, payload?: Record<string, unknown>): DeviceCategory {
  const m = (model || '').toLowerCase();
  if (m.includes('gow') || m.includes('gow 007') || m.includes('fan') || m.includes('wentylator') || payload?.['fan_speed'] !== undefined || payload?.['fan_mode'] !== undefined) {
    return 'fan';
  }
  if (m.includes('trv') || m.includes('thermostat') || payload?.['current_heating_setpoint'] !== undefined) {
    return 'climate';
  }
  if (m.includes('plug') || m.includes('s26') || m.includes('s40') || m.includes('s31') || m.includes('ts011f') || payload?.['power'] !== undefined) {
    return 'plug';
  }
  if (m.includes('mini') || m.includes('zbmini') || m.includes('switch') || m.includes('relay') || m.includes('m5') || (payload?.['state'] !== undefined && payload?.['power'] === undefined)) {
    return 'switch';
  }
  if (m.includes('snzb-04') || m.includes('contact') || m.includes('door') || payload?.['contact'] !== undefined) {
    return 'contact';
  }
  if (m.includes('snzb-03') || m.includes('motion') || m.includes('pir') || m.includes('presence') || m.includes('occupancy') || payload?.['occupancy'] !== undefined) {
    return 'occupancy';
  }
  if (m.includes('snzb-05') || m.includes('water') || m.includes('leak') || payload?.['water_leak'] !== undefined) {
    return 'water_leak';
  }
  if (m.includes('snzb-02d') || m.includes('snzb-02') || m.includes('temp') || m.includes('humidity')) {
    return 'sensor';
  }
  return 'sensor';
}

interface NotificationItem {
  id: number;
  device_ieee: string;
  device_name: string;
  type: string;
  level: string;
  message: string;
  battery: number;
  timestamp: string;
  acknowledged: boolean;
}

export interface DongleMaxConfig {
  connection_mode: 'network_tcp' | 'usb_serial';
  host: string;
  port: number;
  serial_port: string;
  adapter: string;
  operating_mode: 'coordinator' | 'router';
  baudrate: number;
  rtscts: boolean;
  web_console_url: string;
}

export interface MqttStatus {
  connected: boolean;
  url: string;
  topic_prefix: string;
  last_error: string | null;
  messages_received: number;
  last_message_at: string | null;
  last_message_topic: string | null;
  bridge_state: string | null;
  devices_discovered: number;
  z2m_version?: string;
  channel?: number;
  coordinator_type?: string;
}

let dongleMaxConfig: DongleMaxConfig = {
  connection_mode: 'network_tcp',
  host: 'Dongle-M.local',
  port: 6638,
  serial_port: '/dev/ttyACM0',
  adapter: 'ember',
  operating_mode: 'coordinator',
  baudrate: 115200,
  rtscts: false,
  web_console_url: 'http://Dongle-M.local',
};

// Czysty rejestr urzadzen i historii (BEZ SYNTETYZOWANYCH DANYCH)
const devices = new Map<string, Device>();
const telemetryStore = new Map<string, TelemetryPoint[]>();
let currentId = 1;

const notifications: NotificationItem[] = [];
let notifIdCounter = 1;

// Status i klient brokera MQTT
const mqttStatus: MqttStatus = {
  connected: false,
  url: process.env['MQTT_URL'] || 'mqtt://127.0.0.1:1883',
  topic_prefix: process.env['MQTT_TOPIC'] || 'zigbee2mqtt',
  last_error: null,
  messages_received: 0,
  last_message_at: null,
  last_message_topic: null,
  bridge_state: null,
  devices_discovered: 0,
};

let mqttClient: MqttClient | null = null;

// Aktywni subskrybenci SSE (Server-Sent Events) i WebSockets
const sseClients: Response[] = [];
let permitJoinExpiresAt = 0;
let wss: WebSocketServer | null = null;

function broadcastEvent(eventData: Record<string, unknown>) {
  const jsonStr = JSON.stringify(eventData);

  for (let i = sseClients.length - 1; i >= 0; i--) {
    const res = sseClients[i];
    try {
      res.write(`data: ${jsonStr}\n\n`);
    } catch {
      sseClients.splice(i, 1);
    }
  }

  if (wss) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(jsonStr);
      }
    });
  }
}

function checkBatteryLevelAndNotify(ieee: string, battery: number, friendlyName?: string): NotificationItem | null {
  if (battery > 15) return null;

  const name = friendlyName || devices.get(ieee)?.friendly_name || `Czujnik ${ieee.slice(-4)}`;
  const twelveHoursAgo = Date.now() - 12 * 3600 * 1000;
  const recent = notifications.find(
    (n) => n.device_ieee === ieee && n.type === 'battery_low' && new Date(n.timestamp).getTime() >= twelveHoursAgo,
  );
  if (recent) return null;

  const item: NotificationItem = {
    id: notifIdCounter++,
    device_ieee: ieee,
    device_name: name,
    type: 'battery_low',
    level: 'critical',
    message: `Niski poziom baterii (${battery}%) w czujniku ${name} (${ieee}). Wymagana wymiana baterii.`,
    battery,
    timestamp: new Date().toISOString(),
    acknowledged: false,
  };
  notifications.unshift(item);

  broadcastEvent({
    type: 'battery_alert',
    device_ieee: ieee,
    friendly_name: name,
    battery,
    message: item.message,
    timestamp: item.timestamp,
  });

  return item;
}

// Inicjalizacja polaczenia z brokerem Mosquitto MQTT
function connectMqtt(customUrl?: string) {
  if (customUrl) {
    mqttStatus.url = customUrl;
  }
  if (mqttClient) {
    try {
      mqttClient.end(true);
    } catch {
      // ignore
    }
  }

  try {
    console.log(`[MQTT] Laczenie z brokerem: ${mqttStatus.url}...`);
    mqttClient = mqtt.connect(mqttStatus.url, {
      reconnectPeriod: 5000,
      connectTimeout: 5000,
      clientId: `iot_telemetry_panel_${Math.random().toString(16).slice(2, 8)}`,
    });

    mqttClient.on('connect', () => {
      mqttStatus.connected = true;
      mqttStatus.last_error = null;
      console.log(`[MQTT] Polaczono pomyslnie z brokerem ${mqttStatus.url}`);
      mqttClient?.subscribe(`${mqttStatus.topic_prefix}/#`, (err) => {
        if (err) console.error('[MQTT] Blad subskrypcji:', err);
      });
      broadcastEvent({ type: 'mqtt_status', data: mqttStatus });
    });

    mqttClient.on('error', (err) => {
      mqttStatus.connected = false;
      mqttStatus.last_error = err.message;
      console.warn(`[MQTT] Blad polaczenia: ${err.message}`);
      broadcastEvent({ type: 'mqtt_status', data: mqttStatus });
    });

    mqttClient.on('close', () => {
      mqttStatus.connected = false;
      broadcastEvent({ type: 'mqtt_status', data: mqttStatus });
    });

    mqttClient.on('message', (topic: string, message: Buffer) => {
      mqttStatus.messages_received++;
      mqttStatus.last_message_at = new Date().toISOString();
      mqttStatus.last_message_topic = topic;

      const prefix = mqttStatus.topic_prefix;
      if (!topic.startsWith(prefix)) return;

      const subtopic = topic.slice(prefix.length).replace(/^\//, '');

      // 1. Obsluga stanu mostka Zigbee2MQTT
      if (subtopic === 'bridge/state') {
        let stateStr = message.toString().trim();
        try {
          const parsed = JSON.parse(stateStr);
          if (parsed && typeof parsed === 'object' && parsed.state) {
            stateStr = String(parsed.state);
          }
        } catch {
          // raw string
        }
        mqttStatus.bridge_state = stateStr;
        broadcastEvent({ type: 'bridge_state', state: stateStr });
        broadcastEvent({ type: 'mqtt_status', data: mqttStatus });
        return;
      }

      // 2. Informacje o mostku (wersja, kanal, koordynator)
      if (subtopic === 'bridge/info') {
        try {
          const info = JSON.parse(message.toString());
          if (info.version) mqttStatus.z2m_version = info.version;
          if (info.network?.channel) mqttStatus.channel = info.network.channel;
          if (info.coordinator?.type) mqttStatus.coordinator_type = info.coordinator.type;
          broadcastEvent({ type: 'mqtt_status', data: mqttStatus });
        } catch {
          // ignore
        }
        return;
      }

      // 3. Zdarzenia parowania w czasie rzeczywistym
      if (subtopic === 'bridge/event') {
        try {
          const evt = JSON.parse(message.toString());
          if (evt.type === 'device_joined' || evt.type === 'device_interview') {
            const d = evt.data || {};
            const ieee = d.ieee_address || d.ieeeAddress || d.ieeeAddr;
            if (ieee) {
              const devName = d.friendly_name || d.friendlyName || `Czujnik ${ieee.slice(-4)}`;
              const modelName = d.definition?.description || d.definition?.model || d.model_id || 'Nowy czujnik Zigbee';
              if (!devices.has(ieee)) {
                devices.set(ieee, {
                  ieee_address: ieee,
                  friendly_name: devName,
                  model: modelName,
                  last_seen: new Date().toISOString(),
                  battery: null,
                  last_temperature: null,
                  last_humidity: null,
                  linkquality: null,
                });
                mqttStatus.devices_discovered = devices.size;
                broadcastEvent({ type: 'devices_updated', devices: Array.from(devices.values()) });
              }
            }
          }
        } catch {
          // ignore
        }
        return;
      }

interface Z2mDeviceItem {
  ieee_address?: string;
  ieeeAddress?: string;
  ieeeAddr?: string;
  type?: string;
  friendly_name?: string;
  friendlyName?: string;
  definition?: { description?: string; model?: string };
  model_id?: string;
  modelId?: string;
}

      // 4. Obsluga listy urzadzen wykrytych przez Zigbee2MQTT
      if (subtopic === 'bridge/devices') {
        try {
          const list = JSON.parse(message.toString());
          if (Array.isArray(list)) {
            let updated = 0;
            list.forEach((item: Z2mDeviceItem) => {
              const ieee = item.ieee_address || item.ieeeAddress || item.ieeeAddr;
              const isCoordinator = item.type === 'Coordinator';
              if (ieee && !isCoordinator) {
                const devName = item.friendly_name || item.friendlyName || `Czujnik ${ieee.slice(-4)}`;
                const modelName = item.definition?.description || item.definition?.model || item.model_id || item.modelId || 'Zigbee Device';
                const existing = devices.get(ieee);
                if (!existing) {
                  devices.set(ieee, {
                    ieee_address: ieee,
                    friendly_name: devName,
                    model: modelName,
                    last_seen: null,
                    battery: null,
                    last_temperature: null,
                    last_humidity: null,
                    linkquality: null,
                  });
                  updated++;
                } else {
                  existing.friendly_name = devName;
                  existing.model = modelName;
                }
              }
            });
            mqttStatus.devices_discovered = devices.size;
            if (updated > 0) {
              broadcastEvent({ type: 'devices_updated', devices: Array.from(devices.values()) });
            }
          }
        } catch {
          // ignore json error
        }
        return;
      }

      // 5. Ignoruj inne tematy techniczne bridge
      if (subtopic.startsWith('bridge/')) return;

      // 6. Odczyt telemetrii z czujnika (topic: zigbee2mqtt/<device_name_or_ieee>)
      try {
        const payload = JSON.parse(message.toString());
        if (typeof payload === 'object' && payload !== null) {
          // Znajdz lub utworz urzadzenie
          let dev: Device | undefined = undefined;
          for (const d of devices.values()) {
            if (d.friendly_name === subtopic || d.ieee_address === subtopic) {
              dev = d;
              break;
            }
          }

          const nowStr = new Date().toISOString();
          const targetIeee = dev ? dev.ieee_address : (payload.ieee_address || subtopic);

          const temp = payload.temperature !== undefined && payload.temperature !== null ? parseFloat(payload.temperature) : (payload.local_temperature !== undefined && payload.local_temperature !== null ? parseFloat(payload.local_temperature) : null);
          const hum = payload.humidity !== undefined && payload.humidity !== null ? parseFloat(payload.humidity) : null;
          const bat = payload.battery !== undefined && payload.battery !== null ? parseInt(payload.battery, 10) : null;
          const lq = payload.linkquality !== undefined && payload.linkquality !== null ? parseInt(payload.linkquality, 10) : null;

          const modelName = payload.model || payload.device?.model || (dev ? dev.model : 'Zigbee Device');
          const category = detectDeviceCategory(modelName, payload);

          if (!dev) {
            dev = {
              ieee_address: targetIeee,
              friendly_name: subtopic,
              model: modelName,
              category,
              last_seen: nowStr,
              battery: bat,
              last_temperature: temp,
              last_humidity: hum,
              linkquality: lq,
            };
            devices.set(targetIeee, dev);
          } else {
            dev.category = category;
            if (temp !== null) dev.last_temperature = temp;
            if (hum !== null) dev.last_humidity = hum;
            if (bat !== null) dev.battery = bat;
            if (lq !== null) dev.linkquality = lq;
            dev.last_seen = nowStr;
          }

          // Pola dla wentylatora Gotze & Jensen GOW 007 (Tuya WiFi)
          if (payload.fan_speed !== undefined) dev.fan_speed = payload.fan_speed as number | string;
          if (payload.fan_mode !== undefined) dev.fan_mode = String(payload.fan_mode);
          if (payload.fan_oscillation !== undefined) dev.fan_oscillation = Boolean(payload.fan_oscillation);
          if (payload.fan_timer !== undefined && payload.fan_timer !== null) dev.fan_timer = parseFloat(String(payload.fan_timer));
          if (payload.fan_ionizer !== undefined) dev.fan_ionizer = Boolean(payload.fan_ionizer);
          if (payload.fan_humidifier !== undefined) dev.fan_humidifier = Boolean(payload.fan_humidifier);
          if (payload.fan_uv !== undefined) dev.fan_uv = Boolean(payload.fan_uv);

          // Pola dla glowic termostatycznych Sonoff TRVZB / TRVZB Gen 2
          if (payload.current_heating_setpoint !== undefined && payload.current_heating_setpoint !== null) {
            dev.current_heating_setpoint = parseFloat(payload.current_heating_setpoint);
          }
          if (payload.local_temperature !== undefined && payload.local_temperature !== null) {
            dev.local_temperature = parseFloat(payload.local_temperature);
            if (dev.last_temperature === null) dev.last_temperature = dev.local_temperature;
          }
          if (payload.system_mode !== undefined) dev.system_mode = String(payload.system_mode);
          if (payload.running_state !== undefined) dev.running_state = String(payload.running_state);
          if (payload.child_lock !== undefined) dev.child_lock = String(payload.child_lock);
          if (payload.open_window !== undefined) dev.open_window = Boolean(payload.open_window);

          // Pola dla wlacznikow i inteligentnych gniazdek (Sonoff S26R2, ZBMINIR2, Tuya Plug)
          if (payload.state !== undefined) dev.state = String(payload.state);
          if (payload.power !== undefined && payload.power !== null) dev.power = parseFloat(payload.power);
          if (payload.voltage !== undefined && payload.voltage !== null) dev.voltage = parseFloat(payload.voltage);
          if (payload.current !== undefined && payload.current !== null) dev.current = parseFloat(payload.current);
          if (payload.energy !== undefined && payload.energy !== null) dev.energy = parseFloat(payload.energy);

          // Pola dla czujnikow otwarcia, ruchu, zalania (Sonoff SNZB-04/03/05, Tuya mmWave)
          if (payload.contact !== undefined) dev.contact = Boolean(payload.contact);
          if (payload.occupancy !== undefined) dev.occupancy = Boolean(payload.occupancy);
          if (payload.water_leak !== undefined) dev.water_leak = Boolean(payload.water_leak);
          if (payload.illuminance !== undefined && payload.illuminance !== null) dev.illuminance = parseFloat(payload.illuminance);

          const record: TelemetryPoint = {
            id: currentId++,
            device_ieee: targetIeee,
            temperature: dev.last_temperature,
            humidity: dev.last_humidity,
            battery: dev.battery,
            linkquality: dev.linkquality,
            power: dev.power,
            energy: dev.energy,
            setpoint: dev.current_heating_setpoint,
            state: dev.state,
            timestamp: nowStr,
          };

          const list = telemetryStore.get(targetIeee) || [];
          list.push(record);
          telemetryStore.set(targetIeee, list);

          broadcastEvent({
            type: 'telemetry',
            device_ieee: targetIeee,
            data: record,
          });

          broadcastEvent({
            type: 'device_updated',
            device: dev,
          });

          if (dev.battery !== null && dev.battery <= 15) {
            checkBatteryLevelAndNotify(targetIeee, dev.battery, dev.friendly_name);
          }
        }
      } catch {
        // Ignoruj wiadomosci niebedace JSON
      }
    });
  } catch (err: unknown) {
    mqttStatus.last_error = err instanceof Error ? err.message : String(err);
  }
}

// Automatyczne zaladowanie wykrytych wczesniej urzadzen z pliku bazy Z2M jesli istnieje
function tryLoadExistingZ2mDevices() {
  const possiblePaths = [
    '/opt/zigbee2mqtt/data/database.db',
    join(process.cwd(), 'database.db'),
  ];
  for (const dbPath of possiblePaths) {
    if (existsSync(dbPath)) {
      try {
        const content = readFileSync(dbPath, 'utf-8');
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const item = JSON.parse(trimmed);
            const ieee = item.ieeeAddr || item.ieee_address;
            if (ieee && item.type !== 'Coordinator') {
              if (!devices.has(ieee)) {
                devices.set(ieee, {
                  ieee_address: ieee,
                  friendly_name: `Czujnik ${ieee.slice(-4)}`,
                  model: item.modelId || 'Zigbee Device',
                  last_seen: null,
                  battery: null,
                  last_temperature: null,
                  last_humidity: null,
                  linkquality: null,
                });
              }
            }
          } catch {
            // line json parse
          }
        }
      } catch (err) {
        console.debug('[Z2M DB] Blad czytania bazy:', err);
      }
    }
  }
}

tryLoadExistingZ2mDevices();

// Uruchomienie polaczenia MQTT
connectMqtt();

// --- REST API ENDPOINTS ---

// 1. Pobierz liste wszystkich czujnikow
app.get('/api/devices', (_req: Request, res: Response) => {
  const devList = Array.from(devices.values());
  res.json({ devices: devList });
});

// 2. Pobierz pojedynczy czujnik
app.get('/api/devices/:ieee', (req: Request, res: Response) => {
  const ieee = String(req.params['ieee'] || '');
  const dev = devices.get(ieee);
  if (!dev) {
    res.status(404).json({ detail: 'Device not found' });
    return;
  }
  res.json({ device: dev });
});

// 3. Pobierz historie z agregacja dla zakresow: 6h, 24h, 7d, 30d, 90d, 360d, 720d
app.get('/api/devices/:ieee/history', (req: Request, res: Response) => {
  const ieee = String(req.params['ieee'] || '');
  const range = typeof req.query['range'] === 'string' ? req.query['range'] : '24h';
  const allPoints = telemetryStore.get(ieee) || [];

  const now = Date.now();
  let msLimit = 24 * 3600 * 1000;
  if (range === '6h') msLimit = 6 * 3600 * 1000;
  else if (range === '24h') msLimit = 24 * 3600 * 1000;
  else if (range === '7d') msLimit = 7 * 86400 * 1000;
  else if (range === '30d') msLimit = 30 * 86400 * 1000;
  else if (range === '90d') msLimit = 90 * 86400 * 1000;
  else if (range === '360d') msLimit = 360 * 86400 * 1000;
  else if (range === '720d') msLimit = 720 * 86400 * 1000;

  const cutoff = now - msLimit;
  const filtered = allPoints.filter((p) => new Date(p.timestamp).getTime() >= cutoff);

  // Downsampling jesli liczba punktow przekracza 120 (dla plynnego renderowania wykresow)
  let result = filtered;
  if (filtered.length > 120) {
    const step = Math.ceil(filtered.length / 100);
    result = [];
    for (let i = 0; i < filtered.length; i += step) {
      result.push(filtered[i]);
    }
    // Zawsze dolacz najswiezszy punkt
    if (result[result.length - 1] !== filtered[filtered.length - 1]) {
      result.push(filtered[filtered.length - 1]);
    }
  }

  // Obliczenie statystyk
  let tempCount = 0;
  let minTemp = 999;
  let maxTemp = -999;
  let sumTemp = 0;

  let humCount = 0;
  let minHum = 999;
  let maxHum = -999;
  let sumHum = 0;

  filtered.forEach((p) => {
    if (p.temperature !== null && p.temperature !== undefined) {
      if (p.temperature < minTemp) minTemp = p.temperature;
      if (p.temperature > maxTemp) maxTemp = p.temperature;
      sumTemp += p.temperature;
      tempCount++;
    }

    if (p.humidity !== null && p.humidity !== undefined) {
      if (p.humidity < minHum) minHum = p.humidity;
      if (p.humidity > maxHum) maxHum = p.humidity;
      sumHum += p.humidity;
      humCount++;
    }
  });

  const count = filtered.length;
  const stats =
    count > 0
      ? {
          count,
          min_temp: tempCount > 0 ? parseFloat(minTemp.toFixed(1)) : undefined,
          max_temp: tempCount > 0 ? parseFloat(maxTemp.toFixed(1)) : undefined,
          avg_temp: tempCount > 0 ? parseFloat((sumTemp / tempCount).toFixed(1)) : undefined,
          min_hum: humCount > 0 ? parseFloat(minHum.toFixed(1)) : undefined,
          max_hum: humCount > 0 ? parseFloat(maxHum.toFixed(1)) : undefined,
          avg_hum: humCount > 0 ? parseFloat((sumHum / humCount).toFixed(1)) : undefined,
        }
      : {};

  res.json({
    device_ieee: ieee,
    range,
    count: result.length,
    stats,
    history: result,
  });
});

// 4. Zmiana przyjaznej nazwy czujnika
app.post('/api/devices/:ieee/rename', (req: Request, res: Response) => {
  const ieee = String(req.params['ieee'] || '');
  const { friendly_name } = req.body;
  const dev = devices.get(ieee);
  if (!dev) {
    res.status(404).json({ detail: 'Device not found' });
    return;
  }

  const oldName = dev.friendly_name;
  dev.friendly_name = friendly_name;
  broadcastEvent({
    type: 'device_renamed',
    device_ieee: ieee,
    friendly_name,
  });

  // Przekaz zadanie zmiany nazwy do Zigbee2MQTT jesli broker jest podlaczony
  if (mqttClient?.connected) {
    try {
      mqttClient.publish(
        `${mqttStatus.topic_prefix}/bridge/request/device/rename`,
        JSON.stringify({ from: oldName || ieee, to: friendly_name }),
      );
    } catch (e) {
      console.warn('[MQTT] Blad publikacji rename:', e);
    }
  }

  res.json({ status: 'ok', device_ieee: ieee, friendly_name });
});

// 5. Tryb parowania (Permit-Join 160s)
app.post('/api/permit-join', (req: Request, res: Response) => {
  const duration = req.body?.duration ? parseInt(req.body.duration, 10) : 160;
  permitJoinExpiresAt = Date.now() + duration * 1000;

  broadcastEvent({
    type: 'permit_join',
    duration,
    expires_at: permitJoinExpiresAt,
  });

  // Przekaz zadanie permit_join do Zigbee2MQTT przez MQTT na oba oficjalne tematy (kompatybilnosc Z2M v1 i v2)
  if (mqttClient?.connected) {
    try {
      mqttClient.publish(
        `${mqttStatus.topic_prefix}/bridge/request/permit_join`,
        JSON.stringify({ value: true, time: duration }),
      );
      mqttClient.publish(
        `${mqttStatus.topic_prefix}/bridge/config/permit_join`,
        JSON.stringify({ value: true, time: duration }),
      );
    } catch (e) {
      console.warn('[MQTT] Blad publikacji permit_join:', e);
    }
  }

  res.json({ status: 'ok', duration, expires_at: permitJoinExpiresAt });
});

// 5a. Sterowanie urzadzeniem (TRVZB nastawa/tryb, Smart Plug ON/OFF, Przekaznik ZBMINIR2)
app.post('/api/devices/:ieee/set', (req: Request, res: Response) => {
  const ieee = String(req.params['ieee'] || '');
  const dev = devices.get(ieee);
  if (!dev) {
    res.status(404).json({ detail: 'Device not found' });
    return;
  }

  const cmd = req.body;
  if (!cmd || typeof cmd !== 'object') {
    res.status(400).json({ detail: 'Invalid payload' });
    return;
  }

  // Zastosowanie natychmiastowe w pamieci serwera (optimistic update)
  if (cmd.state !== undefined) dev.state = String(cmd.state);
  if (cmd.current_heating_setpoint !== undefined) dev.current_heating_setpoint = parseFloat(cmd.current_heating_setpoint);
  if (cmd.system_mode !== undefined) dev.system_mode = String(cmd.system_mode);
  if (cmd.child_lock !== undefined) dev.child_lock = String(cmd.child_lock);

  // Sterowanie wentylatorem GOW 007 (Tuya WiFi)
  if (cmd.fan_speed !== undefined) dev.fan_speed = cmd.fan_speed;
  if (cmd.fan_mode !== undefined) dev.fan_mode = String(cmd.fan_mode);
  if (cmd.fan_oscillation !== undefined) dev.fan_oscillation = Boolean(cmd.fan_oscillation);
  if (cmd.fan_timer !== undefined) dev.fan_timer = parseFloat(String(cmd.fan_timer));
  if (cmd.fan_ionizer !== undefined) dev.fan_ionizer = Boolean(cmd.fan_ionizer);
  if (cmd.fan_humidifier !== undefined) dev.fan_humidifier = Boolean(cmd.fan_humidifier);
  if (cmd.fan_uv !== undefined) dev.fan_uv = Boolean(cmd.fan_uv);

  dev.last_seen = new Date().toISOString();

  // Przekazanie polecenia do brokera Mosquitto MQTT dla Zigbee2MQTT
  if (mqttClient?.connected) {
    const targetTopic = `${mqttStatus.topic_prefix}/${dev.friendly_name || ieee}/set`;
    try {
      mqttClient.publish(targetTopic, JSON.stringify(cmd));
      console.log(`[MQTT SET] Wyslano do ${targetTopic}:`, JSON.stringify(cmd));
    } catch (e) {
      console.warn(`[MQTT SET] Blad publikacji do ${targetTopic}:`, e);
    }
  }

  broadcastEvent({
    type: 'device_updated',
    device: dev,
  });

  res.json({ status: 'ok', device: dev, sent_to_mqtt: !!mqttClient?.connected });
});

// 5b. Endpoint czyszczenia / restartu urzadzen (Reset do stanu czystego)
app.post('/api/devices/reset', (_req: Request, res: Response) => {
  devices.clear();
  telemetryStore.clear();
  broadcastEvent({ type: 'devices_updated', devices: [] });
  res.json({ success: true, message: 'Rejestr urzadzen zresetowany. Oczekiwanie na rzeczywiste transmisje MQTT/Zigbee.' });
});

// 5d. Oficjalna lista wspieranych modeli Sonoff & Tuya (katalog statyczny)
app.get('/api/catalog', (_req: Request, res: Response) => {
  res.json({
    brands: ['Sonoff', 'Tuya'],
    supported_categories: ['climate', 'plug', 'switch', 'sensor', 'contact', 'occupancy', 'water_leak'],
    featured: [
      { id: 'trvzb-gen2', brand: 'Sonoff', name: 'TRVZB Gen 2', type: 'climate', desc: 'Glowica termostatyczna nowej generacji z silnikiem krokowym i PID' },
      { id: 'trvzb', brand: 'Sonoff', name: 'TRVZB', type: 'climate', desc: 'Inteligentna glowica grzejnikowa Zigbee 3.0 M30x1.5' },
      { id: 's26r2zb', brand: 'Sonoff', name: 'S26R2ZB', type: 'plug', desc: 'Gniazdko sterowane 16A 4000W z funkcja routera Zigbee' },
      { id: 's40zb', brand: 'Sonoff', name: 'S40ZB / S31', type: 'plug', desc: 'Gniazdko z pomiarem mocy chwilowej (W) i zuzycia energii (kWh)' },
      { id: 'zbminir2', brand: 'Sonoff', name: 'ZBMINIR2', type: 'switch', desc: 'Kompaktowy przekaznik dopuszkowy Zigbee 3.0 do puszek podtynkowych' },
      { id: 'zbmini-l2', brand: 'Sonoff', name: 'ZBMINI-L2', type: 'switch', desc: 'Przekaznik dopuszkowy bez przewodu neutralnego N' },
      { id: 'snzb-04', brand: 'Sonoff', name: 'SNZB-04', type: 'contact', desc: 'Kontaktron magnetyczny do drzwi i okien' },
      { id: 'snzb-03', brand: 'Sonoff', name: 'SNZB-03', type: 'occupancy', desc: 'Bezprzewodowy czujnik ruchu PIR 110°' },
      { id: 'snzb-05', brand: 'Sonoff', name: 'SNZB-05', type: 'water_leak', desc: 'Czujnik zalania woda ze zlota sonda IP67' },
      { id: 'snzb-02d', brand: 'Sonoff', name: 'SNZB-02D', type: 'sensor', desc: 'Czujnik temperatury i wilgotnosci z ekranem LCD' },
      { id: 'ts011f', brand: 'Tuya', name: 'TS011F Smart Plug', type: 'plug', desc: 'Gniazdko Tuya 16A z dokladnym licznikiem energii elektrycznej' },
      { id: 'ts0601-radar', brand: 'Tuya', name: 'TS0601 Radar mmWave', type: 'occupancy', desc: 'Radar mikrofalowy 24GHz do wykrywania obecnosci i oddechu' },
    ],
  });
});

// 6. Symulacja wstrzykniecia pomiaru (Testing Console)
app.post('/api/simulate', (req: Request, res: Response) => {
  const { device_ieee, temperature, humidity, battery, linkquality } = req.body;
  if (!device_ieee) {
    res.status(400).json({ detail: 'device_ieee required' });
    return;
  }

  let dev = devices.get(device_ieee);
  const nowStr = new Date().toISOString();

  if (!dev) {
    dev = {
      ieee_address: device_ieee,
      friendly_name: `Czujnik ${device_ieee.slice(-4)}`,
      model: 'Zigbee Sensor',
      last_seen: nowStr,
      battery: battery !== undefined && battery !== null ? parseInt(battery, 10) : null,
      last_temperature: temperature !== undefined && temperature !== null ? parseFloat(temperature) : null,
      last_humidity: humidity !== undefined && humidity !== null ? parseFloat(humidity) : null,
      linkquality: linkquality !== undefined && linkquality !== null ? parseInt(linkquality, 10) : null,
    };
    devices.set(device_ieee, dev);
  } else {
    if (temperature !== undefined) dev.last_temperature = temperature !== null ? parseFloat(temperature) : null;
    if (humidity !== undefined) dev.last_humidity = humidity !== null ? parseFloat(humidity) : null;
    if (battery !== undefined) dev.battery = battery !== null ? parseInt(battery, 10) : null;
    if (linkquality !== undefined) dev.linkquality = linkquality !== null ? parseInt(linkquality, 10) : null;
    dev.last_seen = nowStr;
  }

  const record: TelemetryPoint = {
    id: currentId++,
    device_ieee,
    temperature: dev.last_temperature,
    humidity: dev.last_humidity,
    battery: dev.battery,
    linkquality: dev.linkquality,
    timestamp: nowStr,
  };

  const list = telemetryStore.get(device_ieee) || [];
  list.push(record);
  telemetryStore.set(device_ieee, list);

  broadcastEvent({
    type: 'telemetry',
    device_ieee,
    data: record,
  });

  if (dev.battery !== undefined && dev.battery !== null && dev.battery <= 15) {
    checkBatteryLevelAndNotify(device_ieee, dev.battery, dev.friendly_name);
  }

  res.json({ status: 'simulated', record });
});

// 7. Pobierz liste powiadomien i alertow (bateria < 15%, etc.)
app.get('/api/notifications', (_req: Request, res: Response) => {
  res.json({ notifications });
});

// 8. Oznacz powiadomienie jako potwierdzone
app.post('/api/notifications/:id/acknowledge', (req: Request, res: Response) => {
  const id = parseInt(String(req.params['id'] || ''), 10);
  const notif = notifications.find((n) => n.id === id);
  if (notif) {
    notif.acknowledged = true;
    res.json({ status: 'ok', acknowledged: true });
  } else {
    res.status(404).json({ detail: 'Notification not found' });
  }
});

// 9. Punkt koncowy do wywolania/przetestowania alertu poziomu baterii
app.post('/api/alerts/battery', (req: Request, res: Response) => {
  const { device_ieee, battery } = req.body;
  if (!device_ieee || battery === undefined) {
    res.status(400).json({ detail: 'device_ieee and battery required' });
    return;
  }
  const batNum = parseInt(battery, 10);
  const alert = checkBatteryLevelAndNotify(device_ieee, batNum);
  res.json({ status: 'ok', alert, battery: batNum });
});

// 10. Status systemu i koordynatora
app.get('/api/system/status', (_req: Request, res: Response) => {
  res.json({
    status: 'online',
    coordinator: 'Sonoff Zigbee 3.0 Dongle Max (Dongle-M)',
    chip: 'Silicon Labs EFR32MG24 + Espressif ESP32-D0WD',
    baudrate: dongleMaxConfig.baudrate,
    firmware: 'EZSP / Ember v7.4.x',
    active_devices: devices.size,
    permit_join_active: Date.now() < permitJoinExpiresAt,
    permit_join_remaining: Math.max(0, Math.round((permitJoinExpiresAt - Date.now()) / 1000)),
    network_connection: dongleMaxConfig.connection_mode === 'network_tcp' ? `tcp://${dongleMaxConfig.host}:${dongleMaxConfig.port}` : dongleMaxConfig.serial_port,
    operating_mode: dongleMaxConfig.operating_mode,
    timestamp: new Date().toISOString(),
  });
});

// 11. Konfiguracja sieciowa Sonoff Dongle Max (Dongle-M)
app.get('/api/dongle-max/config', (_req: Request, res: Response) => {
  res.json({ config: dongleMaxConfig });
});

app.post('/api/dongle-max/config', (req: Request, res: Response) => {
  const body = req.body || {};
  dongleMaxConfig = {
    ...dongleMaxConfig,
    ...body,
  };
  broadcastEvent({
    type: 'dongle_max_config_updated',
    config: dongleMaxConfig,
  });
  res.json({ status: 'ok', config: dongleMaxConfig });
});

// 12. Test aktywnego polaczenia TCP z Sonoff Dongle Max na porcie 6638
app.post('/api/dongle-max/test-connection', (req: Request, res: Response) => {
  const host = String(req.body?.host || dongleMaxConfig.host || 'Dongle-M.local');
  const port = parseInt(req.body?.port || dongleMaxConfig.port || 6638, 10);
  const startTime = Date.now();

  const socket = new Socket();
  let finished = false;

  const done = (success: boolean, message: string, latencyMs?: number) => {
    if (finished) return;
    finished = true;
    socket.destroy();
    res.json({
      success,
      host,
      port,
      latency_ms: latencyMs,
      message,
      tested_at: new Date().toISOString(),
      operating_mode: dongleMaxConfig.operating_mode,
    });
  };

  socket.setTimeout(3500);

  socket.on('connect', () => {
    const latency = Date.now() - startTime;
    done(true, `Polaczono pomyslnie z gniazdem sieciowym Sonoff Dongle Max (${host}:${port})!`, latency);
  });

  socket.on('timeout', () => {
    done(false, `Przekroczono limit czasu (3500ms). Sprawdz czy Dongle Max jest wlaczony i podlaczony do tej samej podsieci LAN.`);
  });

  socket.on('error', (err: Error) => {
    done(false, `Blad polaczenia TCP (${host}:${port}): ${err.message}. W trybie laboratoryjnym lub bez fizycznego dongla w sieci port nie odpowiada.`);
  });

  try {
    socket.connect(port, host);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    done(false, `Blad inicjalizacji gniazda: ${errorMsg}`);
  }
});

// 13. Szczegolowy status sprzetowy Sonoff Dongle Max (wg https://dongle.sonoff.tech/guide/dongle-m/)
app.get('/api/dongle-max/status', (_req: Request, res: Response) => {
  res.json({
    device: 'ITEAD Sonoff Dongle Max (Dongle-M / PMG24)',
    chip_zigbee: 'Silicon Labs EFR32MG24 (+20dBm, dual 5dBi external antennas)',
    chip_network: 'Espressif ESP32-D0WD (Wi-Fi 802.11 b/g/n, 10/100M Ethernet with IEEE 802.3af PoE)',
    default_port: 6638,
    mdns_hostname: 'http://Dongle-M.local',
    official_guide: 'https://dongle.sonoff.tech/guide/dongle-m/',
    modes_supported: ['coordinator', 'router'],
    current_config: dongleMaxConfig,
  });
});

// 14. Resetowanie wszystkich danych (powrot do czystego stanu bez danych)
app.post('/api/reset-data', (_req: Request, res: Response) => {
  devices.clear();
  telemetryStore.clear();
  notifications.length = 0;
  currentId = 1;

  broadcastEvent({
    type: 'data_reset',
    message: 'Wszystkie dane zostaly wyczyszczone. System w stanie czystym bez danych.',
  });

  res.json({ status: 'ok', message: 'Wszystkie dane zostaly wyczyszczone' });
});

// 15. Status brokera MQTT i mostka Zigbee2MQTT
app.get('/api/mqtt/status', (_req: Request, res: Response) => {
  res.json({
    mqtt: mqttStatus,
    bridge: {
      state: mqttStatus.bridge_state || 'offline',
      devices_count: mqttStatus.devices_discovered,
      coordinator_topic: `${mqttStatus.topic_prefix}/bridge`,
    },
    service_instructions: {
      systemd_mosquitto: 'systemctl status mosquitto',
      systemd_zigbee2mqtt: 'systemctl status zigbee2mqtt',
      restart_command: 'sudo systemctl restart mosquitto zigbee2mqtt',
    },
  });
});

// 16. Ponowne polaczenie z brokerem MQTT (lub zmiana URL)
app.post('/api/mqtt/reconnect', (req: Request, res: Response) => {
  const url = req.body?.url ? String(req.body.url) : undefined;
  connectMqtt(url);
  res.json({ status: 'reconnecting', target_url: url || mqttStatus.url });
});

// 8. Server-Sent Events (SSE) dla pewnego streamingu na zywo
app.get('/api/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  sseClients.push(res);
  res.write(`data: ${JSON.stringify({ type: 'system_hello', message: 'SSE Stream active' })}\n\n`);

  req.on('close', () => {
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
  });
});

// 17. Audyt zainstalowanych uslug i weryfikacja poprawnosci konfiguracji
app.get('/api/system/inspect-services', (_req: Request, res: Response) => {
  const servicesReport: {
    service: string;
    name: string;
    installed: boolean;
    active: boolean;
    config_path?: string;
    config_exists: boolean;
    config_valid: boolean;
    config_summary?: string;
    notes?: string;
    recommendation?: string;
  }[] = [];

  // A. Mosquitto Broker MQTT
  const mosquittoConfPath = '/etc/mosquitto/conf.d/iot-zigbee.conf';
  const mainMosquittoConf = '/etc/mosquitto/mosquitto.conf';
  let mosqInstalled = existsSync('/usr/sbin/mosquitto') || existsSync('/usr/bin/mosquitto');
  let mosqActive = false;
  let mosqValid = false;
  let mosqSummary = '';

  try {
    const status = execSync('systemctl is-active mosquitto 2>/dev/null', { encoding: 'utf-8' }).trim();
    mosqActive = status === 'active';
    mosqInstalled = true;
  } catch {
    mosqActive = false;
  }

  const mosqConfExists = existsSync(mosquittoConfPath) || existsSync(mainMosquittoConf);
  if (mosqConfExists) {
    try {
      const content = existsSync(mosquittoConfPath) ? readFileSync(mosquittoConfPath, 'utf-8') : readFileSync(mainMosquittoConf, 'utf-8');
      const has1883 = content.includes('1883');
      const hasAnon = content.includes('allow_anonymous true');
      mosqValid = has1883 && hasAnon;
      mosqSummary = `Port 1883: ${has1883 ? 'TAK' : 'NIE'}, Dostep anonimowy: ${hasAnon ? 'TAK' : 'NIE'}`;
    } catch {
      mosqSummary = 'Brak mozliwosci odczytu pliku conf';
    }
  }

  servicesReport.push({
    service: 'mosquitto',
    name: 'Eclipse Mosquitto (Broker MQTT)',
    installed: mosqInstalled,
    active: mosqActive || mqttStatus.connected,
    config_path: mosquittoConfPath,
    config_exists: mosqConfExists,
    config_valid: mosqValid,
    config_summary: mosqSummary || 'Wymaga: listener 1883 oraz allow_anonymous true',
    recommendation: mosqValid ? 'Konfiguracja prawidlowa' : 'Zalecane utworzenie /etc/mosquitto/conf.d/iot-zigbee.conf',
  });

  // B. Zigbee2MQTT
  const z2mDir = '/opt/zigbee2mqtt';
  const z2mConfigPath = '/opt/zigbee2mqtt/data/configuration.yaml';
  const z2mInstalled = existsSync(`${z2mDir}/index.js`);
  let z2mActive = false;
  let z2mValid = false;
  let z2mSummary = '';

  try {
    const status = execSync('systemctl is-active zigbee2mqtt 2>/dev/null', { encoding: 'utf-8' }).trim();
    z2mActive = status === 'active';
  } catch {
    z2mActive = !!mqttStatus.bridge_state && mqttStatus.bridge_state !== 'offline';
  }

  const z2mConfExists = existsSync(z2mConfigPath);
  if (z2mConfExists) {
    try {
      const yaml = readFileSync(z2mConfigPath, 'utf-8');
      const hasEmber = yaml.includes('adapter: ember');
      const hasPort = yaml.includes('port:') && (yaml.includes('6638') || yaml.includes('ttyACM'));
      const hasBase = yaml.includes('base_topic: zigbee2mqtt');
      const frontendPortMatch = yaml.match(/frontend:[\s\S]*?port:\s*([^\r\n]+)/);
      const frontendPortValid = !frontendPortMatch || /^\s*\d+\s*$/.test(frontendPortMatch[1]);
      
      z2mValid = hasEmber && hasBase && frontendPortValid;
      z2mSummary = `Adapter ember: ${hasEmber ? 'TAK' : 'NIE'}, Port: ${hasPort ? 'OK' : 'Sprawdz'}, Frontend port 8080: ${frontendPortValid ? 'OK' : 'BLAD (musi byc liczba)'}`;
    } catch {
      z2mSummary = 'Blad odczytu configuration.yaml';
    }
  }

  servicesReport.push({
    service: 'zigbee2mqtt',
    name: 'Zigbee2MQTT Daemon',
    installed: z2mInstalled,
    active: z2mActive,
    config_path: z2mConfigPath,
    config_exists: z2mConfExists,
    config_valid: z2mValid,
    config_summary: z2mSummary || 'Wymaga adaptera ember oraz poprawnego portu koordynatora',
    recommendation: z2mValid ? 'Konfiguracja zgodna z Sonoff Dongle-M' : 'Upewnij sie, ze w configuration.yaml ustawiono adapter: ember',
  });

  // C. Usluga Panelu SimpleHomeTelemetry
  const panelDir = '/opt/zigbee-telemetry-panel';
  let panelActive = true;
  try {
    const status = execSync('systemctl is-active iot-telemetry 2>/dev/null', { encoding: 'utf-8' }).trim();
    panelActive = status === 'active';
  } catch {
    panelActive = true;
  }

  servicesReport.push({
    service: 'iot-telemetry',
    name: 'SimpleHomeTelemetry Web Service',
    installed: existsSync(panelDir) || existsSync(process.cwd()),
    active: panelActive,
    config_path: '/etc/systemd/system/iot-telemetry.service',
    config_exists: existsSync('/etc/systemd/system/iot-telemetry.service'),
    config_valid: true,
    config_summary: 'Port: 3000, Usluga Node.js / Angular SSR',
    recommendation: 'Usluga panelu dziala poprawnie',
  });

  res.json({
    timestamp: new Date().toISOString(),
    overall_status: servicesReport.every((s) => s.config_valid && (s.active || s.installed)) ? 'ok' : 'needs_attention',
    services: servicesReport,
    environment: {
      node_version: process.version,
      current_dir: process.cwd(),
    },
  });
});

// 18. Aktualizacja oprogramowania SimpleHomeTelemetry z Git / GitHub
app.post('/api/system/git-update', (_req: Request, res: Response) => {
  try {
    let beforeCommit = 'unknown';
    try {
      beforeCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    } catch {
      // ignore
    }

    // Wykonaj git fetch oraz git pull
    const pullOutput = execSync('git fetch origin && git pull origin main 2>&1 || git pull 2>&1', {
      encoding: 'utf-8',
      timeout: 30000,
    });

    let afterCommit = beforeCommit;
    try {
      afterCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    } catch {
      // ignore
    }

    const updated = beforeCommit !== afterCommit || pullOutput.includes('Updating') || pullOutput.includes('Fast-forward');

    res.json({
      success: true,
      updated,
      current_commit: afterCommit,
      remote_commit: afterCommit,
      message: updated
        ? `Pomyslnie zaktualizowano z commita ${beforeCommit} do ${afterCommit}!`
        : 'Repozytorium jest juz w najnowszej wersji (Already up to date).',
      output: pullOutput,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      updated: false,
      message: `Blad podczas git pull: ${msg}`,
      output: msg,
    });
  }
});

// 9. API do pobierania / odczytu plikow zrodlowych wygenerowanych dla uzytkownika
app.get('/api/files/:filename', (req: Request, res: Response) => {
  const allowed = [
    'install.sh',
    'install.ps1',
    'docker-install.sh',
    'database.py',
    'backend_native.py',
    'backend_mqtt.py',
    'requirements.txt',
    'docker-compose.yml',
    'mosquitto.conf',
    'configuration.yaml',
    'DEPLOYMENT.md',
    'static_index.html',
    'static_app.js',
    'android_MainActivity.kt',
    'android_TelemetryForegroundService.kt',
  ];

  const filename = String(req.params['filename'] || '');
  let targetPath = '';

  if (filename === 'static_index.html') targetPath = join(process.cwd(), 'static/index.html');
  else if (filename === 'static_app.js') targetPath = join(process.cwd(), 'static/app.js');
  else if (filename === 'android_MainActivity.kt')
    targetPath = join(process.cwd(), 'android_app/app/src/main/java/com/iot/zigbeemonitor/MainActivity.kt');
  else if (filename === 'android_TelemetryForegroundService.kt')
    targetPath = join(process.cwd(), 'android_app/app/src/main/java/com/iot/zigbeemonitor/service/TelemetryForegroundService.kt');
  else if (allowed.includes(filename)) targetPath = join(process.cwd(), filename);

  if (targetPath && existsSync(targetPath)) {
    const content = readFileSync(targetPath, 'utf-8');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(content);
  } else {
    res.status(404).send('File not found');
  }
});

// Obsluga plikow statycznych z /browser (CSS, JS, Fonts, Icons, Images)
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

// Dodatkowy fallback dla zasobow ze sciezki roboczej
if (existsSync(join(process.cwd(), 'dist/app/browser'))) {
  app.use(express.static(join(process.cwd(), 'dist/app/browser'), { maxAge: '1y', index: false, redirect: false }));
}
if (existsSync(join(process.cwd(), 'static'))) {
  app.use(express.static(join(process.cwd(), 'static'), { index: false, redirect: false }));
}

// Catch-all SPA: serwowanie glownego interfejsu (index.html) dla kazdej trasy bez posrednictwa SSR engine
app.use((req: Request, res: Response, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }

  const possibleIndexes = [
    join(browserDistFolder, 'index.html'),
    join(browserDistFolder, 'index.csr.html'),
    join(process.cwd(), 'dist/app/browser/index.html'),
    join(process.cwd(), 'dist/app/browser/index.csr.html'),
    '/opt/zigbee-telemetry-panel/dist/app/browser/index.html',
    '/root/SimpleHomeTelemetry/dist/app/browser/index.html',
    join(process.cwd(), 'static/index.html'),
  ];

  for (const idx of possibleIndexes) {
    if (existsSync(idx)) {
      return res.sendFile(idx);
    }
  }

  res.status(404).send('SimpleHomeTelemetry: index.html not found. Please build the application.');
});

// WebSocket Server
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 3000;
  const server = createServer(app);
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket) => {
    ws.send(JSON.stringify({ type: 'system_hello', message: 'WebSocket live stream connected' }));
    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        if (parsed.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', time: new Date().toISOString() }));
        }
      } catch (err) {
        console.debug('WS parse error:', err);
      }
    });
  });

  server.listen(port, () => {
    console.log(`Serwer IoT Zigbee Dongle-M uruchomiony na http://0.0.0.0:${port}`);
  });
}

export const reqHandler = createNodeRequestHandler(app);
