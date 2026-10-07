import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express, { Request, Response } from 'express';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { Socket } from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import mqtt, { MqttClient } from 'mqtt';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
app.use(express.json());

// Modele danych urządzeń i telemetrii
interface Device {
  ieee_address: string;
  friendly_name: string;
  model: string;
  last_seen: string | null;
  battery: number | null;
  last_temperature: number | null;
  last_humidity: number | null;
  linkquality: number | null;
  isRecentlyUpdated?: boolean;
}

interface TelemetryPoint {
  id: number;
  device_ieee: string;
  temperature: number | null;
  humidity: number | null;
  battery: number | null;
  linkquality: number | null;
  timestamp: string;
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

// Czysty rejestr urządzeń i historii (BEZ SYNTETYZOWANYCH DANYCH)
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

// Inicjalizacja połączenia z brokerem Mosquitto MQTT
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
    console.log(`[MQTT] Łączenie z brokerem: ${mqttStatus.url}...`);
    mqttClient = mqtt.connect(mqttStatus.url, {
      reconnectPeriod: 5000,
      connectTimeout: 5000,
      clientId: `iot_telemetry_panel_${Math.random().toString(16).slice(2, 8)}`,
    });

    mqttClient.on('connect', () => {
      mqttStatus.connected = true;
      mqttStatus.last_error = null;
      console.log(`[MQTT] Połączono pomyślnie z brokerem ${mqttStatus.url}`);
      mqttClient?.subscribe(`${mqttStatus.topic_prefix}/#`, (err) => {
        if (err) console.error('[MQTT] Błąd subskrypcji:', err);
      });
      broadcastEvent({ type: 'mqtt_status', data: mqttStatus });
    });

    mqttClient.on('error', (err) => {
      mqttStatus.connected = false;
      mqttStatus.last_error = err.message;
      console.warn(`[MQTT] Błąd połączenia: ${err.message}`);
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

      // 1. Obsługa stanu mostka Zigbee2MQTT
      if (subtopic === 'bridge/state') {
        const stateStr = message.toString();
        mqttStatus.bridge_state = stateStr;
        broadcastEvent({ type: 'bridge_state', state: stateStr });
        return;
      }

      // 2. Obsługa listy urządzeń wykrytych przez Zigbee2MQTT
      if (subtopic === 'bridge/devices') {
        try {
          const list = JSON.parse(message.toString());
          if (Array.isArray(list)) {
            let updated = 0;
            list.forEach((item: { ieee_address?: string; friendly_name?: string; type?: string; definition?: { description?: string; model?: string }; model_id?: string }) => {
              if (item.ieee_address && item.type !== 'Coordinator') {
                const ieee = item.ieee_address;
                const devName = item.friendly_name || `Czujnik ${ieee.slice(-4)}`;
                const modelName = item.definition?.description || item.definition?.model || item.model_id || 'Zigbee Device';
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

      // 3. Ignoruj inne tematy techniczne bridge
      if (subtopic.startsWith('bridge/')) return;

      // 4. Odczyt telemetrii z czujnika (topic: zigbee2mqtt/<device_name_or_ieee>)
      try {
        const payload = JSON.parse(message.toString());
        if (typeof payload === 'object' && payload !== null) {
          // Znajdź lub utwórz urządzenie
          let dev: Device | undefined = undefined;
          for (const d of devices.values()) {
            if (d.friendly_name === subtopic || d.ieee_address === subtopic) {
              dev = d;
              break;
            }
          }

          const nowStr = new Date().toISOString();
          const targetIeee = dev ? dev.ieee_address : (payload.ieee_address || subtopic);

          const temp = payload.temperature !== undefined && payload.temperature !== null ? parseFloat(payload.temperature) : null;
          const hum = payload.humidity !== undefined && payload.humidity !== null ? parseFloat(payload.humidity) : null;
          const bat = payload.battery !== undefined && payload.battery !== null ? parseInt(payload.battery, 10) : null;
          const lq = payload.linkquality !== undefined && payload.linkquality !== null ? parseInt(payload.linkquality, 10) : null;

          if (!dev) {
            dev = {
              ieee_address: targetIeee,
              friendly_name: subtopic,
              model: payload.model || payload.device?.model || 'Zigbee Sensor',
              last_seen: nowStr,
              battery: bat,
              last_temperature: temp,
              last_humidity: hum,
              linkquality: lq,
            };
            devices.set(targetIeee, dev);
          } else {
            if (temp !== null) dev.last_temperature = temp;
            if (hum !== null) dev.last_humidity = hum;
            if (bat !== null) dev.battery = bat;
            if (lq !== null) dev.linkquality = lq;
            dev.last_seen = nowStr;
          }

          const record: TelemetryPoint = {
            id: currentId++,
            device_ieee: targetIeee,
            temperature: dev.last_temperature,
            humidity: dev.last_humidity,
            battery: dev.battery,
            linkquality: dev.linkquality,
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

          if (dev.battery !== null && dev.battery <= 15) {
            checkBatteryLevelAndNotify(targetIeee, dev.battery, dev.friendly_name);
          }
        }
      } catch {
        // Ignoruj wiadomości niebędące JSON
      }
    });
  } catch (err: unknown) {
    mqttStatus.last_error = err instanceof Error ? err.message : String(err);
  }
}

// Uruchomienie połączenia MQTT
connectMqtt();

// --- REST API ENDPOINTS ---

// 1. Pobierz listę wszystkich czujników
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

// 3. Pobierz historię z agregacją dla zakresów: 6h, 24h, 7d, 30d, 90d, 360d, 720d
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

  // Downsampling jeśli liczba punktów przekracza 120 (dla płynnego renderowania wykresów)
  let result = filtered;
  if (filtered.length > 120) {
    const step = Math.ceil(filtered.length / 100);
    result = [];
    for (let i = 0; i < filtered.length; i += step) {
      result.push(filtered[i]);
    }
    // Zawsze dołącz najświeższy punkt
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

  // Przekaż żądanie zmiany nazwy do Zigbee2MQTT jeśli broker jest podłączony
  if (mqttClient?.connected) {
    try {
      mqttClient.publish(
        `${mqttStatus.topic_prefix}/bridge/request/device/rename`,
        JSON.stringify({ from: oldName || ieee, to: friendly_name }),
      );
    } catch (e) {
      console.warn('[MQTT] Błąd publikacji rename:', e);
    }
  }

  res.json({ status: 'ok', device_ieee: ieee, friendly_name });
});

// 5. Tryb parowania (Permit-Join 60s)
app.post('/api/permit-join', (req: Request, res: Response) => {
  const duration = req.body?.duration ? parseInt(req.body.duration, 10) : 60;
  permitJoinExpiresAt = Date.now() + duration * 1000;

  broadcastEvent({
    type: 'permit_join',
    duration,
    expires_at: permitJoinExpiresAt,
  });

  // Przekaż żądanie permit_join do Zigbee2MQTT przez MQTT
  if (mqttClient?.connected) {
    try {
      mqttClient.publish(
        `${mqttStatus.topic_prefix}/bridge/request/permit_join`,
        JSON.stringify({ value: true, time: duration }),
      );
    } catch (e) {
      console.warn('[MQTT] Błąd publikacji permit_join:', e);
    }
  }

  res.json({ status: 'ok', duration, expires_at: permitJoinExpiresAt });
});

// 6. Symulacja wstrzyknięcia pomiaru (Testing Console)
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

// 7. Pobierz listę powiadomień i alertów (bateria < 15%, etc.)
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

// 9. Punkt końcowy do wywołania/przetestowania alertu poziomu baterii
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

// 12. Test aktywnego połączenia TCP z Sonoff Dongle Max na porcie 6638
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
    done(true, `Połączono pomyślnie z gniazdem sieciowym Sonoff Dongle Max (${host}:${port})!`, latency);
  });

  socket.on('timeout', () => {
    done(false, `Przekroczono limit czasu (3500ms). Sprawdź czy Dongle Max jest włączony i podłączony do tej samej podsieci LAN.`);
  });

  socket.on('error', (err: Error) => {
    done(false, `Błąd połączenia TCP (${host}:${port}): ${err.message}. W trybie laboratoryjnym lub bez fizycznego dongla w sieci port nie odpowiada.`);
  });

  try {
    socket.connect(port, host);
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    done(false, `Błąd inicjalizacji gniazda: ${errorMsg}`);
  }
});

// 13. Szczegółowy status sprzętowy Sonoff Dongle Max (wg https://dongle.sonoff.tech/guide/dongle-m/)
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

// 14. Resetowanie wszystkich danych (powrót do czystego stanu bez danych)
app.post('/api/reset-data', (_req: Request, res: Response) => {
  devices.clear();
  telemetryStore.clear();
  notifications.length = 0;
  currentId = 1;

  broadcastEvent({
    type: 'data_reset',
    message: 'Wszystkie dane zostały wyczyszczone. System w stanie czystym bez danych.',
  });

  res.json({ status: 'ok', message: 'Wszystkie dane zostały wyczyszczone' });
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

// 16. Ponowne połączenie z brokerem MQTT (lub zmiana URL)
app.post('/api/mqtt/reconnect', (req: Request, res: Response) => {
  const url = req.body?.url ? String(req.body.url) : undefined;
  connectMqtt(url);
  res.json({ status: 'reconnecting', target_url: url || mqttStatus.url });
});

// 8. Server-Sent Events (SSE) dla pewnego streamingu na żywo
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

// 9. API do pobierania / odczytu plików źródłowych wygenerowanych dla użytkownika
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

// Obsługa plików statycznych z /browser
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

// Catch-all renderujący aplikację Angular
const angularApp = new AngularNodeAppEngine();
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
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
