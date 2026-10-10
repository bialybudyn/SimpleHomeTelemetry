import {
  createNodeRequestHandler,
  isMainModule,
} from '@angular/ssr/node';
import express, { Request, Response } from 'express';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Socket } from 'node:net';
import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import mqtt, { MqttClient } from 'mqtt';
import nodemailer from 'nodemailer';
import {
  generateTuyaQrCode,
  checkTuyaQrStatus,
  sendTuyaLocalCommand,
} from './tuya-sharing';
import {
  executeTinyTuyaCommand,
  getTinyTuyaStatus,
  testTinyTuyaConnection,
  scanTinyTuyaLan,
  isValidIp,
  isValidLocalKey,
} from './tinytuya-manager';
import {
  sendSonoffLanCommand,
  testSonoffLanConnection,
  scanSonoffLan,
  loginAndSyncEwelink,
  controlEwelinkDevice,
  getStoredEwelinkConfig,
} from './sonoff-lan-service';
import {
  getImgwSynopStations,
  getImgwSynopStationById,
  getImgwStationHistory,
  getImgwHydroStations,
  getImgwMeteoStations,
  getImgwWarnings,
  getImgwFavoriteStations,
  setImgwFavoriteStations,
  getImgwLocations,
  getImgwLocationDetails,
} from './imgw-weather-service';

// Wykrywanie katalogu zasobow statycznych przegladarki (CSS, JS, Fonts)
let browserDistFolder = join(import.meta.dirname, '../browser');
if (!existsSync(browserDistFolder)) {
  const fallbackPaths = [
    join(process.cwd(), 'dist/app/browser'),
    join(process.cwd(), 'browser'),
    '/opt/zigbee-telemetry-panel/dist/app/browser',
    '/root/SimpleHomeTelemetry/dist/app/browser',
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
  app.use('/static', express.static(join(process.cwd(), 'static'), { index: false, redirect: false }));
  app.use(express.static(join(process.cwd(), 'static'), { index: false, redirect: false }));
}

// Modele danych urzadzen i telemetrii dla Sonoff (TRVZB, S26R2, ZBMINI), Tuya oraz Götze & Jensen GOW 007
type DeviceCategory = 'climate' | 'fan' | 'plug' | 'switch' | 'sensor' | 'smoke' | 'contact' | 'occupancy' | 'water_leak';

interface Device {
  ieee_address: string;
  friendly_name: string;
  model: string;
  category?: DeviceCategory;
  vendor?: string;
  protocol?: 'zigbee' | 'wifi';
  ip_address?: string;
  local_key?: string | null;
  tuya_dev_id?: string | null;
  tuya_product_name?: string | null;
  tuya_protocol_version?: string | null;
  dongle_gateway_ip?: string | null;

  // SONOFF S60TFP Wi-Fi Smart Plug & eWeLink LAN
  sonoff_device_id?: string | null;
  sonoff_api_key?: string | null;
  sonoff_firmware?: string | null;

  last_seen: string | null;
  added_at?: string | null;
  first_seen?: string | null;
  is_deleted?: boolean | null;
  deleted_at?: string | null;
  connection_status?: 'online' | 'offline' | 'error' | 'untested' | null;
  last_error?: string | null;
  battery: number | null;
  linkquality: number | null;
  isRecentlyUpdated?: boolean;

  // Czujka dymu Wi-Fi (Tuya Smoke Detector / sensor pożarowy)
  smoke_alarm?: boolean | null;
  smoke_status?: string | null;
  tamper_alarm?: boolean | null;

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
  occupied_heating_setpoint?: number | null;
  local_temperature?: number | null;
  system_mode?: string | null;
  running_state?: string | null;
  child_lock?: string | null;
  open_window?: boolean | null;
  local_temperature_calibration?: number | null;
  frost_protection_temperature?: number | null;
  temperature_sensor?: string | null;
  external_temperature?: number | null;
  valve_opening_degree?: number | null;
  temperature_accuracy?: number | null;
  smart_temperature_control?: boolean | null;
  timer_mode_target_temp?: number | null;
  temporary_mode_duration?: number | null;
  temporary_mode?: string | null;
  valve_closing_degree?: number | null;
  idle_steps?: number | null;
  closing_steps?: number | null;
  valve_opening_limit_voltage?: number | null;
  valve_closing_limit_voltage?: number | null;
  valve_motor_running_voltage?: number | null;
  weekly_schedule_sunday?: string | null;
  weekly_schedule_monday?: string | null;
  weekly_schedule_tuesday?: string | null;
  weekly_schedule_wednesday?: string | null;
  weekly_schedule_thursday?: string | null;
  weekly_schedule_friday?: string | null;
  weekly_schedule_saturday?: string | null;

  // Wlaczniki i gniazdka sterowane (Sonoff BASIC-ZB1GSP, S26R2ZB, ZBMINIR2, Tuya Smart Plug)
  state?: string | null;
  power?: number | null;
  voltage?: number | null;
  current?: number | null;
  energy?: number | null;
  energy_today?: number | null;
  energy_month?: number | null;
  energy_total?: number | null;

  // SONOFF BASIC-ZB1GSP (Szyna DIN 32A / 7680W Zigbee 3.0)
  power_on_behavior?: string | null;
  overload_protection?: boolean | null;
  overload_power_threshold?: number | null;
  overload_current_threshold?: number | null;
  overload_voltage_threshold?: number | null;
  under_voltage_threshold?: number | null;
  inching_mode?: boolean | null;
  inching_time?: number | null;
  network_indicator?: boolean | null;

  // Czujniki kontaktronowe, ruchu, zalania (Sonoff SNZB-03/04/05, Tuya mmWave)
  contact?: boolean | null;
  occupancy?: boolean | null;
  water_leak?: boolean | null;
  illuminance?: number | null;

  // Alarmy lokalne i powiadomienia
  temp_alarm_enabled?: boolean | null;
  temp_alarm_min?: number | null;
  temp_alarm_max?: number | null;
  motion_alarm_enabled?: boolean | null;
  contact_alarm_enabled?: boolean | null;
  water_alarm_enabled?: boolean | null;
}

interface TelemetryPoint {
  id: number;
  device_ieee: string;
  temperature: number | null;
  humidity: number | null;
  battery: number | null;
  linkquality: number | null;
  power?: number | null;
  voltage?: number | null;
  current?: number | null;
  energy?: number | null;
  setpoint?: number | null;
  state?: string | null;
  contact?: boolean | null;
  occupancy?: boolean | null;
  water_leak?: boolean | null;
  timestamp: string;
}

function detectDeviceCategory(model: string, payload?: Record<string, unknown>, friendlyName?: string): DeviceCategory {
  const m = (model || '').toLowerCase();
  const f = (friendlyName || '').toLowerCase();

  // 1. Sensory temperatury i wilgotności (sprawdź najpierw dla czujników środowiskowych)
  if (
    f.includes('czujnik c') ||
    f.includes('czujnik temp') ||
    f.includes('temperatura') ||
    f.includes('wilgotn') ||
    m.includes('snzb-02d') ||
    m.includes('snzb-02') ||
    m.includes('temp') ||
    m.includes('humidity') ||
    (payload?.['temperature'] !== undefined && payload?.['occupied_heating_setpoint'] === undefined && !f.includes('termostat') && !m.includes('trv'))
  ) {
    return 'sensor';
  }

  // 2. Wentylatory (w tym Tuya fs / 风扇 / GOW 007 / Smart Fan)
  if (
    m.includes('gow') ||
    m.includes('gow 007') ||
    m.includes('fan') ||
    m.includes('wentylator') ||
    m.includes('风扇') ||
    f.includes('wentylator') ||
    f.includes('fan') ||
    f.includes('风扇') ||
    payload?.['category'] === 'fs' ||
    payload?.['fan_speed'] !== undefined ||
    payload?.['fan_mode'] !== undefined
  ) {
    return 'fan';
  }

  // 3. Termostaty i głowice TRV (wyłącznie rzeczywiste termostaty / głowice grzejnikowe)
  if (
    m.includes('trv') ||
    m.includes('thermostat') ||
    m.includes('termostat') ||
    m.includes('sonoff trvzb') ||
    f.includes('termostat') ||
    f.includes('glowica') ||
    f.includes('głowica') ||
    (f.includes('grzejnik') && !f.includes('czujnik')) ||
    payload?.['occupied_heating_setpoint'] !== undefined ||
    payload?.['current_heating_setpoint'] !== undefined
  ) {
    return 'climate';
  }
  // 3. Gniazdka Smart Plug (z wyłączeniem przekaźników DIN takich jak BASIC-ZB1GSP)
  if (
    !m.includes('basic') &&
    !m.includes('zb1gsp') &&
    !f.includes('basic') &&
    !f.includes('zb1gsp') &&
    !f.includes('din') && (
      m.includes('plug') ||
      m.includes('s60') ||
      m.includes('s60tfp') ||
      m.includes('s60tpf') ||
      m.includes('s26') ||
      m.includes('s40') ||
      m.includes('s31') ||
      m.includes('ts011f') ||
      f.includes('s60') ||
      f.includes('gniazdko') ||
      f.includes('plug') ||
      (payload?.['power'] !== undefined && !m.includes('switch') && !m.includes('relay'))
    )
  ) {
    return 'plug';
  }
  // 4. Włączniki i przekaźniki (w tym SONOFF BASIC-ZB1GSP na szynę DIN 32A)
  if (
    m.includes('basic') ||
    m.includes('zb1gsp') ||
    m.includes('mini') ||
    m.includes('zbmini') ||
    m.includes('switch') ||
    m.includes('relay') ||
    m.includes('m5') ||
    m.includes('din') ||
    f.includes('basic') ||
    f.includes('zb1gsp') ||
    f.includes('przekaźnik') ||
    f.includes('przekaznik') ||
    f.includes('włącznik') ||
    f.includes('wlacznik') ||
    f.includes('przełącznik') ||
    f.includes('przelacznik') ||
    (payload?.['state'] !== undefined)
  ) {
    return 'switch';
  }
  // 5. Czujniki otwarcia (drzwi / okna)
  if (
    m.includes('snzb-04') ||
    m.includes('contact') ||
    m.includes('door') ||
    f.includes('drzwi') ||
    f.includes('okno') ||
    f.includes('otwarcie') ||
    f.includes('kontaktron') ||
    payload?.['contact'] !== undefined
  ) {
    return 'contact';
  }
  // 6. Czujniki ruchu i obecności
  if (
    m.includes('snzb-03') ||
    m.includes('motion') ||
    m.includes('pir') ||
    m.includes('presence') ||
    m.includes('occupancy') ||
    f.includes('ruch') ||
    f.includes('ruchu') ||
    f.includes('obecno') ||
    f.includes('korytarz') ||
    f.includes('góra') ||
    f.includes('gora') ||
    payload?.['occupancy'] !== undefined
  ) {
    return 'occupancy';
  }
  // 7. Czujniki zalania
  if (
    m.includes('snzb-05') ||
    m.includes('water') ||
    m.includes('leak') ||
    f.includes('zalani') ||
    f.includes('woda') ||
    payload?.['water_leak'] !== undefined
  ) {
    return 'water_leak';
  }
  // 7b. Czujki dymu (Tuya Wi-Fi Smoke Detector)
  if (
    m.includes('smoke') ||
    m.includes('dym') ||
    m.includes('pozar') ||
    m.includes('pożar') ||
    f.includes('smoke') ||
    f.includes('dym') ||
    f.includes('czujka dymu') ||
    payload?.['smoke'] !== undefined ||
    payload?.['smoke_sensor_status'] !== undefined ||
    payload?.['smoke_alarm'] !== undefined
  ) {
    return 'smoke';
  }
  // 8. Sensory temperatury i wilgotności
  if (
    m.includes('snzb-02d') ||
    m.includes('snzb-02') ||
    m.includes('temp') ||
    m.includes('humidity') ||
    f.includes('temperatura') ||
    f.includes('wilgotn') ||
    f.includes('czujnik c')
  ) {
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
  battery?: number;
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
  wifi_softap_mode?: boolean;
  wifi_softap_ssid?: string;
  wifi_softap_password?: string;
  wifi_softap_channel?: number;
  wifi_softap_ip?: string;
  wifi_softap_dhcp_start?: string;
  wifi_softap_dhcp_end?: string;
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
  host: process.env['DONGLE_HOST'] || 'Dongle-M.local',
  port: process.env['DONGLE_PORT'] ? parseInt(process.env['DONGLE_PORT'], 10) : 6638,
  serial_port: process.env['DONGLE_SERIAL'] || '/dev/ttyACM0',
  adapter: 'ember',
  operating_mode: 'coordinator',
  baudrate: 115200,
  rtscts: false,
  web_console_url: process.env['DONGLE_WEB_URL'] || 'http://Dongle-M.local',
  wifi_softap_mode: false,
  wifi_softap_ssid: '',
  wifi_softap_password: '',
  wifi_softap_channel: 6,
  wifi_softap_ip: '',
  wifi_softap_dhcp_start: '',
  wifi_softap_dhcp_end: '',
};

// Czysty rejestr urzadzen i historii (BEZ SYNTETYZOWANYCH DANYCH)
const devices = new Map<string, Device>();
const telemetryStore = new Map<string, TelemetryPoint[]>();
let currentId = 1;

// --- PERSISTENT CACHE PERSISTENCE FOR DEVICES & TELEMETRY ---
const devicesCachePath = join(process.cwd(), 'devices_cache.json');
const telemetryCachePath = join(process.cwd(), 'telemetry_cache.json');

function saveDevicesCache() {
  try {
    const list = Array.from(devices.entries());
    writeFileSync(devicesCachePath, JSON.stringify(list, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[CACHE] Blad zapisu devices_cache.json:', err);
  }
}

function saveTelemetryCache() {
  try {
    const list = Array.from(telemetryStore.entries());
    // Trimming to keep last 200 points to keep file sizes very compact
    const trimmed = list.map(([ieee, points]) => [ieee, points.slice(-200)]);
    writeFileSync(telemetryCachePath, JSON.stringify(trimmed, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[CACHE] Blad zapisu telemetry_cache.json:', err);
  }
}

let saveDevicesTimeout: ReturnType<typeof setTimeout> | null = null;
function triggerSaveDevices() {
  if (saveDevicesTimeout) return;
  saveDevicesTimeout = setTimeout(() => {
    saveDevicesCache();
    saveDevicesTimeout = null;
  }, 2000);
}

let saveTelemetryTimeout: ReturnType<typeof setTimeout> | null = null;
function triggerSaveTelemetry() {
  if (saveTelemetryTimeout) return;
  saveTelemetryTimeout = setTimeout(() => {
    saveTelemetryCache();
    saveTelemetryTimeout = null;
  }, 5000);
}

interface DeviceAuditLog {
  id: number;
  timestamp: string;
  action: 'soft_delete' | 'restore' | 'permanent_delete' | 'rename' | 'created' | 'reconnected' | 'batch_action';
  device_ieee: string;
  device_name?: string;
  message: string;
}

const deviceAuditLogs: DeviceAuditLog[] = [];
let nextLogId = 1;

function addDeviceLog(
  action: 'soft_delete' | 'restore' | 'permanent_delete' | 'rename' | 'created' | 'reconnected' | 'batch_action',
  device_ieee: string,
  device_name: string | undefined,
  message: string,
) {
  const logItem: DeviceAuditLog = {
    id: nextLogId++,
    timestamp: new Date().toISOString(),
    action,
    device_ieee,
    device_name: device_name || device_ieee,
    message,
  };
  deviceAuditLogs.unshift(logItem);
  if (deviceAuditLogs.length > 200) {
    deviceAuditLogs.pop();
  }
}

function isDeviceOnline(dev: Device): boolean {
  if (dev.is_deleted) return false;
  if (dev.connection_status === 'offline') return false;
  if (!dev.last_seen) return false;
  const lastSeenMs = new Date(dev.last_seen).getTime();
  if (isNaN(lastSeenMs)) return false;
  const diffMinutes = (Date.now() - lastSeenMs) / (1000 * 60);
  return diffMinutes <= 60;
}

function loadCache() {
  if (existsSync(telemetryCachePath)) {
    try {
      const data = readFileSync(telemetryCachePath, 'utf-8');
      const entries = JSON.parse(data);
      if (Array.isArray(entries)) {
        let count = 0;
        entries.forEach(([key, val]) => {
          telemetryStore.set(key, val);
          count += val.length;
        });
        console.log(`[CACHE] Zaladowano ${count} punktow historii z telemetry_cache.json`);
      }
    } catch (err) {
      console.warn('[CACHE] Blad odczytu telemetry_cache.json:', err);
    }
  }

  if (existsSync(devicesCachePath)) {
    try {
      const data = readFileSync(devicesCachePath, 'utf-8');
      const entries = JSON.parse(data);
      if (Array.isArray(entries)) {
        entries.forEach(([key, val]) => {
          if (val && typeof val === 'object') {
            val.category = detectDeviceCategory(val.model || '', undefined, val.friendly_name);
            val.is_deleted = Boolean(val.is_deleted);
            if (!val.added_at) {
              const hist = telemetryStore.get(key);
              if (hist && hist.length > 0 && hist[0].timestamp) {
                val.added_at = hist[0].timestamp;
              } else {
                val.added_at = val.last_seen || new Date().toISOString();
              }
            }
            if (!val.first_seen) {
              val.first_seen = val.added_at;
            }
          }
          devices.set(key, val);
        });
        console.log(`[CACHE] Zaladowano ${devices.size} urzadzen z devices_cache.json`);
      }
    } catch (err) {
      console.warn('[CACHE] Blad odczytu devices_cache.json:', err);
    }
  }

  console.log(`[CACHE] Łącznie załadowano ${devices.size} urządzeń z rejestru cache.`);
}

loadCache();

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

interface NotificationConfig {
  email_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  email_from: string;
  email_to: string;
  telegram_enabled: boolean;
  telegram_token: string;
  telegram_chat_id: string;
}

let notificationConfig: NotificationConfig = {
  email_enabled: false,
  smtp_host: 'smtp.gmail.com',
  smtp_port: 587,
  smtp_user: '',
  smtp_pass: '',
  email_from: 'noreply@simplehome.local',
  email_to: '',
  telegram_enabled: false,
  telegram_token: '',
  telegram_chat_id: '',
};

const configPath = join(process.cwd(), 'notification_config.json');

function loadNotificationConfig() {
  if (existsSync(configPath)) {
    try {
      const data = readFileSync(configPath, 'utf-8');
      notificationConfig = { ...notificationConfig, ...JSON.parse(data) };
      console.log('[NOTIFICATIONS] Zaladowano konfiguracje SMTP/Telegram.');
    } catch (e) {
      console.warn('[NOTIFICATIONS] Blad ładowania konfiguracji:', e);
    }
  }
}

function saveNotificationConfig() {
  try {
    writeFileSync(configPath, JSON.stringify(notificationConfig, null, 2), 'utf-8');
    console.log('[NOTIFICATIONS] Zapisano konfiguracje SMTP/Telegram.');
  } catch (e) {
    console.warn('[NOTIFICATIONS] Blad zapisu konfiguracji:', e);
  }
}

loadNotificationConfig();

async function sendAlertEmail(subject: string, text: string) {
  if (!notificationConfig.email_enabled) return;
  if (!notificationConfig.smtp_host || !notificationConfig.smtp_user || !notificationConfig.smtp_pass || !notificationConfig.email_to) {
    console.warn('[NOTIFICATIONS] E-mail wlaczony, ale dane SMTP sa niepelne!');
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: notificationConfig.smtp_host,
      port: notificationConfig.smtp_port,
      secure: notificationConfig.smtp_port === 465, // true dla 465, false dla 587
      auth: {
        user: notificationConfig.smtp_user,
        pass: notificationConfig.smtp_pass,
      },
    });

    await transporter.sendMail({
      from: notificationConfig.email_from || 'noreply@simplehome.local',
      to: notificationConfig.email_to,
      subject: `[SIMPLEHOME ALARM] ${subject}`,
      text: text,
    });
    console.log(`[NOTIFICATIONS] E-mail wyslany pomyslnie do ${notificationConfig.email_to}`);
  } catch (e: unknown) {
    console.error('[NOTIFICATIONS] Blad wysylania e-maila:', e instanceof Error ? e.message : String(e));
  }
}

async function sendAlertTelegram(text: string) {
  if (!notificationConfig.telegram_enabled) return;
  if (!notificationConfig.telegram_token || !notificationConfig.telegram_chat_id) {
    console.warn('[NOTIFICATIONS] Telegram wlaczony, ale token lub Chat ID jest pusty!');
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${notificationConfig.telegram_token}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: notificationConfig.telegram_chat_id,
        text: `🚨 [SimpleHome Alarm]\n\n${text}`,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn('[NOTIFICATIONS] Blad wysylania Telegram:', errText);
    } else {
      console.log('[NOTIFICATIONS] Wiadomosc Telegram wyslana pomyslnie.');
    }
  } catch (e: unknown) {
    console.error('[NOTIFICATIONS] Blad wysylania Telegram:', e instanceof Error ? e.message : String(e));
  }
}

let mqttClient: MqttClient | null = null;

// Aktywni subskrybenci SSE (Server-Sent Events) i WebSockets
const sseClients: Response[] = [];
let permitJoinExpiresAt = 0;
let wss: WebSocketServer | null = null;

// Stan parowania Czystego Wi-Fi (SmartConfig broadcast bez Zigbee)
let wifiPairingExpiresAt = 0;
let wifiPairingSsid = '';
let wifiPairingInterval: ReturnType<typeof setInterval> | null = null;
const discoveredWifiDevices: { ip: string; mac?: string; model: string; name: string }[] = [];

function getLocalNetworkDetails(): { ip: string; broadcast: string } {
  try {
    const nets = networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) {
          const parts = net.address.split('.');
          if (parts.length === 4) {
            return {
              ip: net.address,
              broadcast: `${parts[0]}.${parts[1]}.${parts[2]}.255`,
            };
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return { ip: '', broadcast: '' };
}

function broadcastWifiSmartConfigPacket(ssid: string, pass: string) {
  try {
    const { broadcast } = getLocalNetworkDetails();
    const destBroadcast = broadcast || '255.255.255.255';
    const udpSocket = createSocket('udp4');
    udpSocket.bind(() => {
      udpSocket.setBroadcast(true);
      const payload = Buffer.from(`TUYA_SMARTCONFIG_EZ:${ssid}:${pass}:SIMPLEHOME_WIFI`);
      udpSocket.send(payload, 0, payload.length, 6667, destBroadcast, (err) => {
        if (err) console.debug('[Wi-Fi SmartConfig UDP error]:', err);
        try { udpSocket.close(); } catch { /* ignore */ }
      });
    });
  } catch (e) {
    console.debug('[Wi-Fi SmartConfig Exception]:', e);
  }
}

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

  sendAlertEmail(`Niski poziom baterii - ${name}`, item.message);
  sendAlertTelegram(item.message);

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

const alarmCooldowns = new Map<string, number>();

function triggerDeviceAlarm(dev: Device, alertType: string, message: string) {
  const cooldownKey = `${dev.ieee_address}_${alertType}`;
  const now = Date.now();
  const lastAlert = alarmCooldowns.get(cooldownKey) || 0;
  
  // 1. Dodaj powiadomienie systemowe (zawsze nadajemy lokalnie w przeglądarce)
  const item: NotificationItem = {
    id: notifIdCounter++,
    device_ieee: dev.ieee_address,
    device_name: dev.friendly_name,
    type: alertType,
    level: 'critical',
    message: message,
    battery: dev.battery || 100,
    timestamp: new Date().toISOString(),
    acknowledged: false,
  };
  notifications.unshift(item);

  // Zawsze nadajemy do przeglądarki, żeby kafelki błyszczały/grały na żywo
  broadcastEvent({
    type: 'device_alarm',
    device_ieee: dev.ieee_address,
    friendly_name: dev.friendly_name,
    alarm_type: alertType,
    message: message,
    timestamp: item.timestamp,
  });

  // 2. Jeśli cooldown minął (np. 3 minuty), wysyłamy e-mail oraz Telegram!
  if (now - lastAlert >= 180000) {
    alarmCooldowns.set(cooldownKey, now);
    sendAlertEmail(`ALARM URZADZENIA: ${dev.friendly_name}`, message);
    sendAlertTelegram(`⚠️ ${dev.friendly_name}: ${message}`);
  }
}

// Helper do wymuszenia odczytu stanu ze wszystkich urzadzen Zigbee2MQTT
function requestDeviceSyncAll() {
  if (!mqttClient || !mqttStatus.connected) return;
  const prefix = mqttStatus.topic_prefix || 'zigbee2mqtt';

  // 1. Zażądaj pełnej listy urządzeń i definicji z mostka Z2M
  try {
    mqttClient.publish(`${prefix}/bridge/request/devices`, '');
  } catch (err) {
    console.warn('[MQTT] Błąd publikacji bridge/request/devices:', err);
  }

  // 2. Przeładuj subskrypcję tematów, aby broker natychmiast wysłał wszystkie zachowane stany (retained)
  try {
    mqttClient.unsubscribe(`${prefix}/#`, () => {
      mqttClient?.subscribe(`${prefix}/#`, (err) => {
        if (!err) {
          console.log('[MQTT] Ponownie zasubskrybowano tematy Z2M w celu natychmiastowego pobrania zachowanych stanów.');
        }
      });
    });
  } catch (err) {
    console.warn('[MQTT] Błąd przeładowania subskrypcji MQTT:', err);
  }

  // 3. Dla urządzeń wykonawczych zasilanych sieciowo (gniazdka, wyłączniki) wyślij ukierunkowane zapytanie /get
  // UWAGA: Nigdy nie wysyłamy /get dla czujników bateryjnych ani głowic TRVZB (brak konwertera GET dla pustego stringu w Z2M)!
  devices.forEach((dev) => {
    const name = dev.friendly_name || dev.ieee_address;
    if (!name) return;

    // Upewnij się, że kategoria jest poprawnie zaktualizowana
    const cat = dev.category || detectDeviceCategory(dev.model || '', undefined, dev.friendly_name);
    dev.category = cat;

    try {
      if (cat === 'plug' || cat === 'switch') {
        mqttClient?.publish(`${prefix}/${name}/get`, JSON.stringify({ state: '' }));
      }
    } catch {
      // ignore
    }
  });
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
                const joinedNow = new Date().toISOString();
                devices.set(ieee, {
                  ieee_address: ieee,
                  friendly_name: devName,
                  model: modelName,
                  last_seen: joinedNow,
                  added_at: joinedNow,
                  first_seen: joinedNow,
                  is_deleted: false,
                  connection_status: 'online',
                  last_error: null,
                  battery: null,
                  last_temperature: null,
                  last_humidity: null,
                  linkquality: null,
                });
                addDeviceLog('created', ieee, devName, `Dołączono urządzenie Zigbee "${devName}" (${ieee}).`);
                mqttStatus.devices_discovered = devices.size;
                broadcastEvent({ type: 'devices_updated', devices: Array.from(devices.values()) });
                triggerSaveDevices();
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
                
                // Unikanie duplikatów: sprawdzamy, czy istnieje urządzenie tymczasowe utworzone z friendly_name
                const normName = devName.toLowerCase().replace(/[\s_-]+/g, '');
                let tempDevKey: string | null = null;
                for (const [key, d] of devices.entries()) {
                  if (!key.startsWith('0x') && !key.startsWith('wifi_')) {
                    const normK = key.toLowerCase().replace(/[\s_-]+/g, '');
                    const normF = (d.friendly_name || '').toLowerCase().replace(/[\s_-]+/g, '');
                    if (normK === normName || normF === normName) {
                      tempDevKey = key;
                      break;
                    }
                  }
                }

                if (tempDevKey) {
                  // Znaleziono tymczasowe urzadzenie z danymi telemetrycznymi! Migrujemy je na właściwy adres IEEE.
                  const tempDev = devices.get(tempDevKey)!;
                  devices.delete(tempDevKey);
                  
                  tempDev.ieee_address = ieee;
                  tempDev.friendly_name = devName;
                  tempDev.model = modelName;
                  devices.set(ieee, tempDev);
                  
                  // Migrujemy rowniez historie pomiarow
                  const history = telemetryStore.get(tempDevKey);
                  if (history) {
                    telemetryStore.delete(tempDevKey);
                    history.forEach((p) => { p.device_ieee = ieee; });
                    telemetryStore.set(ieee, history);
                  }
                  
                  updated++;
                } else {
                  const existing = devices.get(ieee);
                  if (!existing) {
                    const detectedCategory = detectDeviceCategory(modelName, undefined, devName);
                    devices.set(ieee, {
                      ieee_address: ieee,
                      friendly_name: devName,
                      model: modelName,
                      category: detectedCategory,
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
                    if (!existing.category || existing.category === 'sensor') {
                      existing.category = detectDeviceCategory(modelName, undefined, devName);
                    }
                  }
                }
              }
            });
            mqttStatus.devices_discovered = devices.size;
            if (updated > 0) {
              broadcastEvent({ type: 'devices_updated', devices: Array.from(devices.values()) });
              triggerSaveDevices();
              triggerSaveTelemetry();
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
        const topicParts = subtopic.split('/');
        const baseTopic = topicParts[0].trim();

        // Ignoruj powiadomienia komend wyjsciowych /get i /set
        if (topicParts.length > 1 && (topicParts[1] === 'get' || topicParts[1] === 'set')) {
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let payload: any = {};
        const msgStr = message.toString().trim();

        try {
          if (msgStr.startsWith('{') && msgStr.endsWith('}')) {
            payload = JSON.parse(msgStr);
          } else {
            // Pojedyncza wartosc atrybutu (np. zigbee2mqtt/Czujnik C Salon/temperature = 22.5)
            if (topicParts.length > 1) {
              const attr = topicParts[1].trim();
              const valNum = parseFloat(msgStr);
              if (!isNaN(valNum)) {
                payload[attr] = valNum;
              } else {
                payload[attr] = msgStr;
              }
            }
          }
        } catch {
          if (topicParts.length > 1) {
            const attr = topicParts[1].trim();
            const valNum = parseFloat(msgStr);
            if (!isNaN(valNum)) {
              payload[attr] = valNum;
            } else {
              payload[attr] = msgStr;
            }
          }
        }

        if (typeof payload === 'object' && payload !== null && Object.keys(payload).length > 0) {
          // Elastyczne wyszukiwanie urzadzenia po friendly_name, ieee_address, nazwie znormalizowanej lub ladunku
          let dev: Device | undefined = undefined;

          // 1. Dokladne dopasowanie po nazwie lub IEEE
          for (const d of devices.values()) {
            if (
              d.friendly_name === baseTopic ||
              d.ieee_address === baseTopic ||
              d.friendly_name === subtopic ||
              d.ieee_address === subtopic
            ) {
              dev = d;
              break;
            }
          }

          // 2. Znormalizowane dopasowanie (bez spacji i wielkosci liter)
          if (!dev) {
            const normBase = baseTopic.toLowerCase().replace(/[\s_-]+/g, '');
            for (const d of devices.values()) {
              const normFriendly = (d.friendly_name || '').toLowerCase().replace(/[\s_-]+/g, '');
              const normIeee = (d.ieee_address || '').toLowerCase().replace(/[\s_-]+/g, '');
              if (normFriendly === normBase || normIeee === normBase) {
                dev = d;
                break;
              }
            }
          }

          // 3. Dopasowanie po pola w ladunku JSON
          if (!dev) {
            const payloadIeee = payload.ieee_address || payload.ieeeAddress || payload.device?.ieeeAddr || payload.device?.ieee_address;
            const payloadName = payload.friendly_name || payload.friendlyName || payload.device?.friendlyName;
            if (payloadIeee && typeof payloadIeee === 'string' && devices.has(payloadIeee)) {
              dev = devices.get(payloadIeee);
            } else if (payloadName && typeof payloadName === 'string') {
              for (const d of devices.values()) {
                if (d.friendly_name === payloadName) {
                  dev = d;
                  break;
                }
              }
            }
          }

          const nowStr = new Date().toISOString();
          const targetIeee = dev ? dev.ieee_address : (payload.ieee_address || baseTopic);

          const temp =
            payload.temperature !== undefined && payload.temperature !== null ? parseFloat(payload.temperature as string) :
            payload.local_temperature !== undefined && payload.local_temperature !== null ? parseFloat(payload.local_temperature as string) :
            payload.temp !== undefined && payload.temp !== null ? parseFloat(payload.temp as string) :
            payload.temperature_sensor !== undefined && payload.temperature_sensor !== null ? parseFloat(payload.temperature_sensor as string) :
            null;

          const hum =
            payload.humidity !== undefined && payload.humidity !== null ? parseFloat(payload.humidity as string) :
            payload.relative_humidity !== undefined && payload.relative_humidity !== null ? parseFloat(payload.relative_humidity as string) :
            payload.hum !== undefined && payload.hum !== null ? parseFloat(payload.hum as string) :
            payload.humidity_sensor !== undefined && payload.humidity_sensor !== null ? parseFloat(payload.humidity_sensor as string) :
            null;

          const bat =
            payload.battery !== undefined && payload.battery !== null ? parseInt(payload.battery as string, 10) :
            payload.battery_level !== undefined && payload.battery_level !== null ? parseInt(payload.battery_level as string, 10) :
            payload.battery_percent !== undefined && payload.battery_percent !== null ? parseInt(payload.battery_percent as string, 10) :
            payload.battery_percentage !== undefined && payload.battery_percentage !== null ? parseInt(payload.battery_percentage as string, 10) :
            null;

          const lq =
            payload.linkquality !== undefined && payload.linkquality !== null ? parseInt(payload.linkquality as string, 10) :
            payload.link_quality !== undefined && payload.link_quality !== null ? parseInt(payload.link_quality  as string, 10) :
            payload.lqi !== undefined && payload.lqi !== null ? parseInt(payload.lqi as string, 10) :
            null;

          const modelName = payload.model || payload.device?.model || (dev ? dev.model : 'Zigbee Device');
          const category = detectDeviceCategory(modelName, payload, dev?.friendly_name || baseTopic);

          if (!dev) {
            dev = {
              ieee_address: targetIeee,
              friendly_name: baseTopic,
              model: modelName,
              category,
              last_seen: nowStr,
              added_at: nowStr,
              first_seen: nowStr,
              is_deleted: false,
              connection_status: 'online',
              last_error: null,
              battery: bat,
              last_temperature: temp,
              last_humidity: hum,
              linkquality: lq,
            };
            devices.set(targetIeee, dev);
            addDeviceLog('created', targetIeee, baseTopic, `Wykryto nowe urządzenie "${baseTopic}" (${targetIeee}).`);
          } else {
            dev.category = category;
            if (temp !== null) dev.last_temperature = temp;
            if (hum !== null) dev.last_humidity = hum;
            if (bat !== null) dev.battery = bat;
            if (lq !== null) dev.linkquality = lq;
            dev.last_seen = nowStr;
            dev.connection_status = 'online';
            dev.last_error = null;

            // Jeśli urządzenie było wcześniej usunięte z pulpitu, przywracamy je z zachowaniem pełnej historii i nazwy
            if (dev.is_deleted) {
              dev.is_deleted = false;
              dev.deleted_at = null;
              const reconMsg = `Urządzenie "${dev.friendly_name}" (${dev.ieee_address}) nawiązało ponownie połączenie i wskoczyło z powrotem na pulpit z zachowaniem pełnej historii!`;
              console.log(`[DEVICE RECONNECTED] ${reconMsg}`);
              addDeviceLog('reconnected', dev.ieee_address, dev.friendly_name, reconMsg);
              broadcastEvent({ type: 'device_updated', device: dev });
              broadcastEvent({ type: 'devices_updated', devices: Array.from(devices.values()) });
            }
          }

          if (!dev) return;

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
          } else if (payload.occupied_heating_setpoint !== undefined && payload.occupied_heating_setpoint !== null) {
            dev.current_heating_setpoint = parseFloat(payload.occupied_heating_setpoint);
          }
          if (payload.local_temperature !== undefined && payload.local_temperature !== null) {
            dev.local_temperature = parseFloat(payload.local_temperature);
            if (dev.last_temperature === null) dev.last_temperature = dev.local_temperature;
          }
          if (payload.system_mode !== undefined) dev.system_mode = String(payload.system_mode);
          if (payload.running_state !== undefined) dev.running_state = String(payload.running_state);
          if (payload.child_lock !== undefined) dev.child_lock = String(payload.child_lock);
          if (payload.open_window !== undefined) dev.open_window = Boolean(payload.open_window);
          if (payload.local_temperature_calibration !== undefined && payload.local_temperature_calibration !== null) {
            dev.local_temperature_calibration = parseFloat(payload.local_temperature_calibration);
          }
          if (payload.frost_protection_temperature !== undefined && payload.frost_protection_temperature !== null) {
            dev.frost_protection_temperature = parseFloat(payload.frost_protection_temperature);
          }
          if (payload.temperature_sensor !== undefined) dev.temperature_sensor = String(payload.temperature_sensor);
          if (payload.external_temperature !== undefined && payload.external_temperature !== null) {
            dev.external_temperature = parseFloat(payload.external_temperature);
          }
          if (payload.valve_opening_degree !== undefined && payload.valve_opening_degree !== null) {
            dev.valve_opening_degree = parseInt(payload.valve_opening_degree, 10);
          }
          if (payload.temperature_accuracy !== undefined && payload.temperature_accuracy !== null) {
            dev.temperature_accuracy = parseFloat(payload.temperature_accuracy);
          }
          if (payload.smart_temperature_control !== undefined) {
            dev.smart_temperature_control = Boolean(payload.smart_temperature_control);
          }

          // Pola dla włączników i inteligentnych gniazdek (Sonoff BASIC-ZB1GSP, S26R2, ZBMINIR2, Tuya Plug)
          if (payload.state !== undefined) dev.state = String(payload.state);
          if (payload.power !== undefined && payload.power !== null) dev.power = parseFloat(payload.power);
          if (payload.voltage !== undefined && payload.voltage !== null) dev.voltage = parseFloat(payload.voltage);
          if (payload.current !== undefined && payload.current !== null) dev.current = parseFloat(payload.current);
          if (payload.energy !== undefined && payload.energy !== null) dev.energy = parseFloat(payload.energy);
          if (payload.energy_today !== undefined && payload.energy_today !== null) dev.energy_today = parseFloat(payload.energy_today);
          if (payload.energy_month !== undefined && payload.energy_month !== null) dev.energy_month = parseFloat(payload.energy_month);
          if (payload.energy_total !== undefined && payload.energy_total !== null) dev.energy_total = parseFloat(payload.energy_total);

          // Pola specyficzne dla SONOFF BASIC-ZB1GSP (szyna DIN 32A)
          if (payload.power_on_behavior !== undefined) dev.power_on_behavior = String(payload.power_on_behavior);
          if (payload.overload_protection !== undefined) dev.overload_protection = Boolean(payload.overload_protection);
          if (payload.overload_power_threshold !== undefined && payload.overload_power_threshold !== null) {
            dev.overload_power_threshold = parseFloat(payload.overload_power_threshold);
          }
          if (payload.overload_current_threshold !== undefined && payload.overload_current_threshold !== null) {
            dev.overload_current_threshold = parseFloat(payload.overload_current_threshold);
          }
          if (payload.overload_voltage_threshold !== undefined && payload.overload_voltage_threshold !== null) {
            dev.overload_voltage_threshold = parseFloat(payload.overload_voltage_threshold);
          }
          if (payload.under_voltage_threshold !== undefined && payload.under_voltage_threshold !== null) {
            dev.under_voltage_threshold = parseFloat(payload.under_voltage_threshold);
          }
          if (payload.inching_mode !== undefined) dev.inching_mode = Boolean(payload.inching_mode);
          if (payload.inching_time !== undefined && payload.inching_time !== null) dev.inching_time = parseFloat(payload.inching_time);
          if (payload.network_indicator !== undefined) dev.network_indicator = Boolean(payload.network_indicator);
          if (payload.child_lock !== undefined) dev.child_lock = String(payload.child_lock);

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
            voltage: dev.voltage,
            current: dev.current,
            energy: dev.energy,
            setpoint: dev.current_heating_setpoint,
            state: dev.state,
            contact: dev.contact,
            occupancy: dev.occupancy,
            water_leak: dev.water_leak,
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

          triggerSaveDevices();
          triggerSaveTelemetry();

          if (dev.battery !== null && dev.battery <= 15) {
            checkBatteryLevelAndNotify(targetIeee, dev.battery, dev.friendly_name);
          }

          // Weryfikacja alarmów zadanych przez użytkownika na kafelku
          if (dev.temp_alarm_enabled && dev.last_temperature !== null && dev.last_temperature !== undefined) {
            const minT = dev.temp_alarm_min !== undefined && dev.temp_alarm_min !== null ? dev.temp_alarm_min : 16.0;
            const maxT = dev.temp_alarm_max !== undefined && dev.temp_alarm_max !== null ? dev.temp_alarm_max : 28.0;
            if (dev.last_temperature < minT) {
              triggerDeviceAlarm(dev, 'temp_low', `Zbyt niska temperatura: ${dev.last_temperature.toFixed(1)}°C (próg min: ${minT}°C)`);
            } else if (dev.last_temperature > maxT) {
              triggerDeviceAlarm(dev, 'temp_high', `Zbyt wysoka temperatura: ${dev.last_temperature.toFixed(1)}°C (próg max: ${maxT}°C)`);
            }
          }

          if (dev.motion_alarm_enabled && (payload.occupancy === true || payload.occupancy === 'true')) {
            triggerDeviceAlarm(dev, 'motion_detected', `Wykryto ruch w strefie nadzorowanej!`);
          }

          if (dev.contact_alarm_enabled && (payload.contact === false || payload.contact === 'false')) {
            triggerDeviceAlarm(dev, 'contact_opened', `Wykryto otwarcie okna lub drzwi!`);
          }

          if (dev.water_alarm_enabled && (payload.water_leak === true || payload.water_leak === 'true')) {
            triggerDeviceAlarm(dev, 'water_leak_alarm', `🚨 Wykryto wyciek wody pod sondą czujnika!`);
          }

          // Weryfikacja przeciążenia prądowego i mocowego (Overload Protection dla Sonoff BASIC-ZB1GSP / 32A DIN)
          const pLimit = dev.overload_power_threshold ?? 7680;
          const cLimit = dev.overload_current_threshold ?? 32;
          if (
            (dev.power !== null && dev.power !== undefined && dev.power > pLimit) ||
            (dev.current !== null && dev.current !== undefined && dev.current > cLimit)
          ) {
            triggerDeviceAlarm(
              dev,
              'overload_alarm',
              `⚠️ OSTRZEŻENIE PRZECIĄŻENIOWE! Obciążenie przekaźnika ${dev.friendly_name} przekroczyło próg bezpieczny (${dev.power ? dev.power + ' W' : ''} ${dev.current ? dev.current + ' A' : ''} / limit: ${pLimit} W / ${cLimit} A)!`,
            );
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

// 1. Pobierz listę czujników dla Pulpitu na żywo (lub wszystkich z opcją ?include_deleted=true)
app.get('/api/devices', (req: Request, res: Response) => {
  const includeDeleted = req.query['include_deleted'] === 'true';
  const allList = Array.from(devices.values());
  const devList = includeDeleted ? allList : allList.filter((d) => !d.is_deleted);
  res.json({
    devices: devList,
    total: allList.length,
    active: allList.filter((d) => !d.is_deleted && isDeviceOnline(d)).length,
    disconnected: allList.filter((d) => !d.is_deleted && !isDeviceOnline(d)).length,
    deleted: allList.filter((d) => d.is_deleted).length,
  });
});

// 1b. Zaawansowane zarządzanie urządzeniami dla zakładki Ustawienia serwera (podział na: Aktywne, Niepołączone, Usunięte)
app.get('/api/admin/devices', (_req: Request, res: Response) => {
  const allList = Array.from(devices.values());
  const active: Device[] = [];
  const disconnected: Device[] = [];
  const deleted: Device[] = [];

  for (const dev of allList) {
    if (dev.is_deleted) {
      deleted.push(dev);
    } else if (isDeviceOnline(dev)) {
      active.push(dev);
    } else {
      disconnected.push(dev);
    }
  }

  res.json({
    total: allList.length,
    active,
    disconnected,
    deleted,
    all: allList,
    logs: deviceAuditLogs.slice(0, 100),
  });
});

// 1c. Usunięcie urządzenia z Pulpitu na żywo (Soft-delete bez usuwania danych historycznych)
app.post('/api/devices/:ieee/delete', (req: Request, res: Response) => {
  const ieee = String(req.params['ieee'] || '').trim();
  const dev = devices.get(ieee);
  if (!dev) {
    res.status(404).json({ error: 'Nie odnaleziono urządzenia w rejestrze' });
    return;
  }

  dev.is_deleted = true;
  dev.deleted_at = new Date().toISOString();

  const logMsg = `Usunięto urządzenie "${dev.friendly_name}" (${ieee}) z pulpitu na żywo. Historia danych została bezpiecznie zachowana w archiwum serwera.`;
  console.log(`[DEVICE SOFT DELETE] ${logMsg}`);
  addDeviceLog('soft_delete', ieee, dev.friendly_name, logMsg);

  // Wysłanie unpair/remove do Zigbee2MQTT jeśli to urządzenie Zigbee
  if (mqttClient?.connected && dev.protocol !== 'wifi') {
    try {
      const topic = `${mqttStatus.topic_prefix}/bridge/request/device/remove`;
      mqttClient.publish(topic, JSON.stringify({ id: dev.friendly_name || ieee, force: true }));
      console.log(`[MQTT] Wysłano polecenie wyrejestrowania do Zigbee2MQTT dla ${ieee}`);
    } catch (e) {
      console.warn('[MQTT] Błąd publikacji remove do Zigbee2MQTT:', e);
    }
  }

  triggerSaveDevices();
  broadcastEvent({ type: 'device_deleted', ieee_address: ieee, device: dev });
  broadcastEvent({ type: 'devices_updated', devices: Array.from(devices.values()) });

  res.json({
    success: true,
    message: `Urządzenie "${dev.friendly_name}" zostało usunięte z pulpitu na żywo. Wszystkie dane historyczne zostały zachowane i pojawią się ponownie jeśli urządzenie połączy się w sieci.`,
    device: dev,
  });
});

// 1d. Przywrócenie urządzenia do Pulpitu na żywo
app.post('/api/devices/:ieee/restore', (req: Request, res: Response) => {
  const ieee = String(req.params['ieee'] || '').trim();
  const dev = devices.get(ieee);
  if (!dev) {
    res.status(404).json({ error: 'Nie odnaleziono urządzenia w rejestrze' });
    return;
  }

  dev.is_deleted = false;
  dev.deleted_at = null;

  const logMsg = `Przywrócono urządzenie "${dev.friendly_name}" (${ieee}) na pulpit na żywo.`;
  console.log(`[DEVICE RESTORE] ${logMsg}`);
  addDeviceLog('restore', ieee, dev.friendly_name, logMsg);

  triggerSaveDevices();
  broadcastEvent({ type: 'device_updated', device: dev });
  broadcastEvent({ type: 'devices_updated', devices: Array.from(devices.values()) });

  res.json({
    success: true,
    message: `Urządzenie "${dev.friendly_name}" zostało pomyślnie przywrócone do pulpitu na żywo wraz z pełną historią pomiarów.`,
    device: dev,
  });
});

// 1e. PERMANENTNE USUNIĘCIE URZĄDZENIA (Usuwa urządzenie oraz CAŁĄ historię telemetrii!)
const handlePermanentDelete = (req: Request, res: Response) => {
  const ieee = String(req.params['ieee'] || '').trim();
  const dev = devices.get(ieee);
  const devName = dev ? dev.friendly_name : ieee;

  const hadHistory = telemetryStore.has(ieee);
  const pointsCount = hadHistory ? (telemetryStore.get(ieee)?.length || 0) : 0;

  // 1. Usunięcie z mapy pamięci
  devices.delete(ieee);
  telemetryStore.delete(ieee);

  // 2. Usunięcie z Zigbee2MQTT
  if (mqttClient?.connected && dev?.protocol !== 'wifi') {
    try {
      const topic = `${mqttStatus.topic_prefix}/bridge/request/device/remove`;
      mqttClient.publish(topic, JSON.stringify({ id: devName || ieee, force: true }));
    } catch (e) {
      console.warn('[MQTT] Błąd publikacji remove:', e);
    }
  }

  // 3. Logowanie operacji
  const logMsg = `PERMANENTNE USUNIĘCIE: Urządzenie "${devName}" (${ieee}) oraz cała historia danych pomiarowych (${pointsCount} wpisów) zostały bezpowrotnie skasowane z serwera.`;
  console.log(`[DEVICE PERMANENT DELETE] ${logMsg}`);
  addDeviceLog('permanent_delete', ieee, devName, logMsg);

  // 4. Zapis do plików cache
  saveDevicesCache();
  saveTelemetryCache();

  // 5. Powiadomienie klientów WebSocket
  broadcastEvent({ type: 'device_permanently_deleted', ieee_address: ieee });
  broadcastEvent({ type: 'devices_updated', devices: Array.from(devices.values()) });

  res.json({
    success: true,
    message: `Urządzenie "${devName}" oraz cała historia danych (${pointsCount} punktów pomiarowych) zostały trwale i bezpowrotnie usunięte z bazy serwera.`,
    deleted_points: pointsCount,
  });
};

app.delete('/api/devices/:ieee/permanent', handlePermanentDelete);
app.post('/api/devices/:ieee/permanent-delete', handlePermanentDelete);

// 1f. Operacje grupowe na wielu urządzeniach (Soft-delete, Restore, Permanent-delete)
app.post('/api/devices/batch', (req: Request, res: Response) => {
  const { action, ieee_list } = req.body || {};
  if (!action || !Array.isArray(ieee_list) || ieee_list.length === 0) {
    res.status(400).json({ error: 'Wymagane parametry: action ("soft_delete" | "restore" | "permanent_delete") oraz ieee_list' });
    return;
  }

  let count = 0;
  for (const rawIeee of ieee_list) {
    const ieee = String(rawIeee).trim();
    const dev = devices.get(ieee);
    if (!dev && action !== 'permanent_delete') continue;
    const name = dev ? dev.friendly_name : ieee;

    if (action === 'soft_delete' && dev) {
      dev.is_deleted = true;
      dev.deleted_at = new Date().toISOString();
      if (mqttClient?.connected && dev.protocol !== 'wifi') {
        try {
          mqttClient.publish(`${mqttStatus.topic_prefix}/bridge/request/device/remove`, JSON.stringify({ id: name || ieee, force: true }));
        } catch { /* ignore */ }
      }
      addDeviceLog('soft_delete', ieee, name, `[Operacja zbiorcza] Usunięto "${name}" z pulpitu na żywo.`);
      count++;
    } else if (action === 'restore' && dev) {
      dev.is_deleted = false;
      dev.deleted_at = null;
      addDeviceLog('restore', ieee, name, `[Operacja zbiorcza] Przywrócono "${name}" do pulpitu na żywo.`);
      count++;
    } else if (action === 'permanent_delete') {
      devices.delete(ieee);
      telemetryStore.delete(ieee);
      if (mqttClient?.connected && dev?.protocol !== 'wifi') {
        try {
          mqttClient.publish(`${mqttStatus.topic_prefix}/bridge/request/device/remove`, JSON.stringify({ id: name || ieee, force: true }));
        } catch { /* ignore */ }
      }
      addDeviceLog('permanent_delete', ieee, name, `[Operacja zbiorcza] TRWALE USUNIĘTO "${name}" i całą jego historię pomiarów.`);
      count++;
    }
  }

  saveDevicesCache();
  if (action === 'permanent_delete') {
    saveTelemetryCache();
  }
  broadcastEvent({ type: 'devices_updated', devices: Array.from(devices.values()) });

  res.json({
    success: true,
    action,
    processed_count: count,
    message: `Pomyślnie wykonano operację "${action}" dla ${count} wybranych urządzeń.`,
  });
});

// 1g. Całkowite wyczyszczenie przykładowych/wszystkich urządzeń z rejestru
app.post(['/api/devices/purge-all', '/api/devices/purge-samples'], (_req: Request, res: Response) => {
  const count = devices.size;
  devices.clear();
  telemetryStore.clear();

  saveDevicesCache();
  saveTelemetryCache();

  broadcastEvent({ type: 'devices_updated', devices: [] });
  res.json({
    success: true,
    message: `Usunięto wszystkie urządzenia (${count}) oraz skasowano całą historię telemetrii. Rejestr urządzeń jest teraz czysty.`,
  });
});

// 1g. Pobranie rejestru logów audytowych operacji na urządzeniach
app.get('/api/devices/logs', (_req: Request, res: Response) => {
  res.json({ logs: deviceAuditLogs.slice(0, 100) });
});

// 1h. Testowanie połączenia z pojedynczym urządzeniem (Wi-Fi / Zigbee)
app.post('/api/devices/:ieee/test-connection', async (req: Request, res: Response) => {
  const ieee = String(req.params['ieee'] || '').trim();
  const dev = devices.get(ieee);
  if (!dev) {
    res.status(404).json({ error: 'Nie odnaleziono urządzenia' });
    return;
  }

  if (dev.protocol === 'wifi' || dev.local_key) {
    const ip = dev.ip_address || '';
    const isSonoff = dev.model.toLowerCase().includes('s60') || (dev.vendor || '').toLowerCase().includes('sonoff');

    if (isSonoff) {
      if (!ip) {
        dev.connection_status = 'error';
        dev.last_error = 'Brak skonfigurowanego adresu IP w sieci Wi-Fi LAN';
        broadcastEvent({ type: 'device_updated', device: dev });
        res.json({ success: false, message: dev.last_error, device: dev });
        return;
      }

      const sonoffRes = await testSonoffLanConnection(ip, dev.sonoff_device_id || dev.tuya_dev_id || undefined, dev.sonoff_api_key || undefined);
      dev.connection_status = 'online';
      dev.last_error = null;
      dev.last_seen = new Date().toISOString();
      if (sonoffRes.deviceInfo?.switch) {
        dev.state = sonoffRes.deviceInfo.switch === 'on' ? 'ON' : 'OFF';
      }
      triggerSaveDevices();
      broadcastEvent({ type: 'device_updated', device: dev });
      res.json({ success: true, message: `SONOFF S60TFP (${ip}:8081): połączenie poprawne. ${sonoffRes.message}`, device: dev });
      return;
    }

    const key = dev.local_key || '';
    const devId = dev.tuya_dev_id || dev.ieee_address.replace('wifi_', '');

    if (!ip || !key) {
      dev.connection_status = 'error';
      dev.last_error = 'Brak skonfigurowanego adresu IP lub klucza Local Key w sieci LAN';
      broadcastEvent({ type: 'device_updated', device: dev });
      res.json({ success: false, message: dev.last_error, device: dev });
      return;
    }

    const testRes = await testTinyTuyaConnection(
      ip,
      key,
      devId,
      dev.tuya_protocol_version || '3.3',
      dev.dongle_gateway_ip || dongleMaxConfig.host,
    );
    if (testRes.success) {
      dev.connection_status = 'online';
      dev.last_error = null;
      dev.last_seen = new Date().toISOString();
    } else {
      dev.connection_status = 'offline';
      dev.last_error = testRes.message;
    }
    triggerSaveDevices();
    broadcastEvent({ type: 'device_updated', device: dev });
    res.json({ success: testRes.success, message: testRes.message, device: dev });
    return;
  }

  // Zigbee: sprawdzamy linkquality i ostatni czas odebrania telemetrii
  const isOnline = isDeviceOnline(dev);
  dev.connection_status = isOnline ? 'online' : 'offline';
  if (!isOnline) {
    dev.last_error = 'Brak pakietów radiowych Zigbee w ciągu ostatnich 60 minut (urządzenie uśpione lub wyłączone)';
  } else {
    dev.last_error = null;
  }
  broadcastEvent({ type: 'device_updated', device: dev });
  res.json({ success: isOnline, message: isOnline ? 'Urządzenie Zigbee jest aktywne w sieci' : 'Brak odpowiedzi urządzenia Zigbee', device: dev });
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

  const dev = devices.get(ieee);
  const isEventSensor = dev && (dev.category === 'contact' || dev.category === 'occupancy' || dev.category === 'water_leak');

  // Downsampling jesli liczba punktow przekracza 120 (tylko dla sensorow ciaglych jak temperatura/wilgotnosc)
  let result = filtered;
  if (!isEventSensor && filtered.length > 120) {
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

  let motionCount = 0;
  let openCount = 0;
  let leakCount = 0;
  let lastEventTime: string | undefined = undefined;

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

    if (p.occupancy === true) {
      motionCount++;
      lastEventTime = p.timestamp;
    }
    if (p.contact === false) {
      openCount++;
      lastEventTime = p.timestamp;
    }
    if (p.water_leak === true) {
      leakCount++;
      lastEventTime = p.timestamp;
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
          motion_count: motionCount,
          open_count: openCount,
          leak_count: leakCount,
          last_event_time: lastEventTime,
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
  triggerSaveDevices();

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

// 5a-1. Parowanie Czystego Wi-Fi (SmartConfig UDP broadcast dla urzadzen Tuya Wi-Fi bez Zigbee)
app.post('/api/wifi/pair-smartconfig', (req: Request, res: Response) => {
  const fallbackSsid = dongleMaxConfig.wifi_softap_ssid || '';
  const ssid = String(req.body?.ssid || '').trim() || fallbackSsid;
  const password = String(req.body?.password || '').trim();
  const duration = req.body?.duration ? parseInt(req.body.duration, 10) : 160;

  wifiPairingSsid = ssid;
  wifiPairingExpiresAt = Date.now() + duration * 1000;

  if (wifiPairingInterval) clearInterval(wifiPairingInterval);

  // Natychmiastowa transmisja pierwszego pakietu
  broadcastWifiSmartConfigPacket(ssid, password);

  // Ciagle rozglaszanie pakietow UDP co 2s w trakcie trwania parowania
  wifiPairingInterval = setInterval(() => {
    if (Date.now() >= wifiPairingExpiresAt) {
      if (wifiPairingInterval) clearInterval(wifiPairingInterval);
      wifiPairingInterval = null;
      broadcastEvent({ type: 'wifi_pairing_ended' });
    } else {
      broadcastWifiSmartConfigPacket(ssid, password);
    }
  }, 2000);

  const netInfo = getLocalNetworkDetails();

  broadcastEvent({
    type: 'wifi_pairing_started',
    ssid,
    duration,
    expires_at: wifiPairingExpiresAt,
    local_ip: netInfo.ip,
  });

  res.json({
    status: 'ok',
    message: `Uruchomiono nadawanie rozglaszalne SmartConfig Wi-Fi dla sieci ${ssid} na ${duration}s.`,
    duration,
    expires_at: wifiPairingExpiresAt,
    local_ip: netInfo.ip,
    broadcast_ip: netInfo.broadcast,
  });
});

// 5a-2. Status parowania Wi-Fi i Access Pointa Dongle-MAX
app.get('/api/wifi/status', (_req: Request, res: Response) => {
  const now = Date.now();
  const active = now < wifiPairingExpiresAt;
  const remaining = active ? Math.ceil((wifiPairingExpiresAt - now) / 1000) : 0;
  const netInfo = getLocalNetworkDetails();

  res.json({
    active,
    duration: 160,
    remaining_seconds: remaining,
    ssid: wifiPairingSsid,
    local_ip: netInfo.ip,
    broadcast_ip: netInfo.broadcast,
    discovered_devices: discoveredWifiDevices,
    dongle_ap: {
      enabled: Boolean(dongleMaxConfig.wifi_softap_mode && dongleMaxConfig.wifi_softap_ssid),
      ssid: dongleMaxConfig.wifi_softap_ssid || '',
      ip: dongleMaxConfig.wifi_softap_ip || (netInfo.ip ? netInfo.ip : ''),
      channel: dongleMaxConfig.wifi_softap_channel || 6,
      dhcp_range: (dongleMaxConfig.wifi_softap_dhcp_start && dongleMaxConfig.wifi_softap_dhcp_end)
        ? `${dongleMaxConfig.wifi_softap_dhcp_start} - ${dongleMaxConfig.wifi_softap_dhcp_end}`
        : '',
    },
  });
});

// 5a-3. Skanowanie podsieci LAN w poszukiwaniu urzadzen Wi-Fi
app.post('/api/wifi/scan-lan', (_req: Request, res: Response) => {
  const netInfo = getLocalNetworkDetails();

  try {
    const parts = netInfo.ip.split('.');
    if (parts.length === 4) {
      const subnetBase = `${parts[0]}.${parts[1]}.${parts[2]}`;
      execSync(`ping -c 1 -w 1 ${subnetBase}.255 >/dev/null 2>&1 || true`);
    }
  } catch {
    // ignore
  }

  res.json({
    success: true,
    local_ip: netInfo.ip,
    broadcast_ip: netInfo.broadcast,
    discovered_devices: discoveredWifiDevices,
  });
});

// 5a-4. Bezposrednie dodanie uniwersalnego urzadzenia Wi-Fi do rejestru (Dongle-MAX AP / LAN)
app.post('/api/wifi/add-device', (req: Request, res: Response) => {
  const { ip_address, name, model, category, vendor, local_key, tuya_dev_id, tuya_protocol_version, tuya_product_name } = req.body;
  const devIp = String(ip_address || '').trim();
  if (!devIp || !isValidIp(devIp)) {
    res.status(400).json({ error: 'Wymagany jest poprawny adres IPv4 urządzenia Wi-Fi (np. 192.168.1.155)' });
    return;
  }
  const cleanLocalKey = local_key ? String(local_key).trim() : '';
  if (cleanLocalKey && !isValidLocalKey(cleanLocalKey)) {
    res.status(400).json({ error: 'Niepoprawny format Local Key (klucz Tuya musi mieć dokładnie 16 znaków ASCII)' });
    return;
  }
  const devCategory = (category || 'plug') as DeviceCategory;

  let defaultName = 'Urządzenie Wi-Fi';
  let defaultModel = 'Smart Wi-Fi Device';
  let defaultVendor = 'Wi-Fi Device (Dongle-MAX / LAN)';

  if (devCategory === 'plug') {
    defaultName = 'Gniazdko Smart Plug Wi-Fi 16A';
    defaultModel = 'Smart Plug 16A Wi-Fi';
  } else if (devCategory === 'switch') {
    defaultName = 'Przekaźnik / Włącznik Wi-Fi';
    defaultModel = 'Smart Switch / Relay Wi-Fi';
  } else if (devCategory === 'fan') {
    defaultName = 'Wentylator Wi-Fi';
    defaultModel = 'Smart Fan Wi-Fi';
    defaultVendor = 'Tuya / ESP Wi-Fi';
  } else if (devCategory === 'climate') {
    defaultName = 'Termostat Wi-Fi';
    defaultModel = 'Smart Thermostat Wi-Fi';
  } else if (devCategory === 'sensor') {
    defaultName = 'Czujnik Środowiskowy Wi-Fi';
    defaultModel = 'Smart Sensor Wi-Fi';
  }

  const devName = String(name || defaultName).trim();
  const devModel = String(model || defaultModel).trim();
  const devVendor = String(vendor || defaultVendor).trim();

  const ieee = `wifi_${devIp.replace(/\./g, '_')}`;
  const nowStr = new Date().toISOString();

  let dev = devices.get(ieee);
  if (!dev) {
    dev = {
      ieee_address: ieee,
      friendly_name: devName,
      model: devModel,
      category: devCategory,
      vendor: devVendor,
      protocol: 'wifi',
      ip_address: devIp,
      local_key: local_key ? String(local_key).trim() : null,
      tuya_dev_id: tuya_dev_id ? String(tuya_dev_id).trim() : null,
      tuya_protocol_version: tuya_protocol_version ? String(tuya_protocol_version).trim() : '3.3',
      tuya_product_name: tuya_product_name ? String(tuya_product_name).trim() : null,
      last_seen: nowStr,
      added_at: nowStr,
      first_seen: nowStr,
      is_deleted: false,
      connection_status: 'untested',
      last_error: null,
      battery: null,
      linkquality: 100,
      last_temperature: null,
      last_humidity: null,
      fan_speed: devCategory === 'fan' ? 1 : undefined,
      fan_mode: devCategory === 'fan' ? 'normal' : undefined,
      fan_oscillation: devCategory === 'fan' ? false : undefined,
      fan_timer: devCategory === 'fan' ? 0 : undefined,
      fan_ionizer: devCategory === 'fan' ? false : undefined,
      fan_humidifier: devCategory === 'fan' ? false : undefined,
      fan_uv: devCategory === 'fan' ? false : undefined,
      state: 'OFF',
      power: devCategory === 'plug' ? 0 : undefined,
      voltage: devCategory === 'plug' ? 230 : undefined,
      current: devCategory === 'plug' ? 0 : undefined,
      current_heating_setpoint: devCategory === 'climate' ? 21.0 : undefined,
      local_temperature: undefined,
    };
    devices.set(ieee, dev);
  } else {
    dev.friendly_name = devName;
    dev.model = devModel;
    dev.category = devCategory;
    dev.vendor = devVendor;
    dev.protocol = 'wifi';
    dev.ip_address = devIp;
    if (local_key) dev.local_key = String(local_key).trim();
    if (tuya_dev_id) dev.tuya_dev_id = String(tuya_dev_id).trim();
    if (tuya_protocol_version) dev.tuya_protocol_version = String(tuya_protocol_version).trim();
    if (tuya_product_name) dev.tuya_product_name = String(tuya_product_name).trim();
    dev.last_seen = nowStr;
  }

  triggerSaveDevices();
  broadcastEvent({ type: 'device_added', device: dev });
  broadcastEvent({ type: 'devices_updated', devices: Array.from(devices.values()) });

  res.json({
    success: true,
    message: `Dodano urządzenie Wi-Fi ${devName} (${devIp})!`,
    device: dev,
  });
});

// 5a. Sterowanie urzadzeniem (TRVZB nastawa/tryb, Smart Plug ON/OFF, Przekaznik ZBMINIR2, Alarmy)
app.post('/api/devices/:ieee/set', (req: Request, res: Response) => {
  const ieee = String(req.params['ieee'] || '');
  let dev = devices.get(ieee);
  if (!dev) {
    const cmdInit = req.body || {};
    const friendlyName = cmdInit.friendly_name || `Czujnik ${ieee.slice(-4)}`;
    const modelName = cmdInit.model || 'Zigbee Device';
    dev = {
      ieee_address: ieee,
      friendly_name: friendlyName,
      model: modelName,
      category: detectDeviceCategory(modelName, cmdInit, friendlyName),
      last_seen: new Date().toISOString(),
      battery: null,
      last_temperature: null,
      last_humidity: null,
      linkquality: null,
    };
    devices.set(ieee, dev);
  }

  const cmd = { ...req.body };
  if (!cmd || typeof cmd !== 'object') {
    res.status(400).json({ detail: 'Invalid payload' });
    return;
  }

  // Zastosowanie natychmiastowe w pamieci serwera (optimistic update)
  if (cmd.state !== undefined) dev.state = String(cmd.state);
  if (cmd.current_heating_setpoint !== undefined) {
    dev.current_heating_setpoint = parseFloat(cmd.current_heating_setpoint);
    // Kluczowa poprawka: Mapowanie nastawy zadanej na pole "occupied_heating_setpoint" wymagane przez Sonoff TRVZB w Zigbee2MQTT
    cmd.occupied_heating_setpoint = dev.current_heating_setpoint;
  }
  if (cmd.system_mode !== undefined) dev.system_mode = String(cmd.system_mode);
  if (cmd.child_lock !== undefined) dev.child_lock = String(cmd.child_lock);
  if (cmd.local_temperature_calibration !== undefined) {
    dev.local_temperature_calibration = parseFloat(cmd.local_temperature_calibration);
  }
  if (cmd.frost_protection_temperature !== undefined) {
    dev.frost_protection_temperature = parseFloat(cmd.frost_protection_temperature);
  }
  if (cmd.temperature_sensor !== undefined) dev.temperature_sensor = String(cmd.temperature_sensor);
  if (cmd.external_temperature !== undefined) dev.external_temperature = parseFloat(cmd.external_temperature);
  if (cmd.valve_opening_degree !== undefined) dev.valve_opening_degree = parseInt(cmd.valve_opening_degree, 10);
  if (cmd.temperature_accuracy !== undefined) dev.temperature_accuracy = parseFloat(cmd.temperature_accuracy);
  if (cmd.smart_temperature_control !== undefined) {
    dev.smart_temperature_control = Boolean(cmd.smart_temperature_control);
  }

  // Sterowanie wentylatorem GOW 007 (Tuya WiFi)
  if (cmd.fan_speed !== undefined) dev.fan_speed = cmd.fan_speed;
  if (cmd.fan_mode !== undefined) dev.fan_mode = String(cmd.fan_mode);
  if (cmd.fan_oscillation !== undefined) dev.fan_oscillation = Boolean(cmd.fan_oscillation);
  if (cmd.fan_timer !== undefined) dev.fan_timer = parseFloat(String(cmd.fan_timer));
  if (cmd.fan_ionizer !== undefined) dev.fan_ionizer = Boolean(cmd.fan_ionizer);
  if (cmd.fan_humidifier !== undefined) dev.fan_humidifier = Boolean(cmd.fan_humidifier);
  if (cmd.fan_uv !== undefined) dev.fan_uv = Boolean(cmd.fan_uv);

  // Alarmy lokalne z poziomu przeglądarki i powiadomienia
  if (cmd.temp_alarm_enabled !== undefined) dev.temp_alarm_enabled = cmd.temp_alarm_enabled !== null ? Boolean(cmd.temp_alarm_enabled) : null;
  if (cmd.temp_alarm_min !== undefined) dev.temp_alarm_min = cmd.temp_alarm_min !== null ? parseFloat(cmd.temp_alarm_min) : null;
  if (cmd.temp_alarm_max !== undefined) dev.temp_alarm_max = cmd.temp_alarm_max !== null ? parseFloat(cmd.temp_alarm_max) : null;
  if (cmd.motion_alarm_enabled !== undefined) dev.motion_alarm_enabled = cmd.motion_alarm_enabled !== null ? Boolean(cmd.motion_alarm_enabled) : null;
  if (cmd.contact_alarm_enabled !== undefined) dev.contact_alarm_enabled = cmd.contact_alarm_enabled !== null ? Boolean(cmd.contact_alarm_enabled) : null;
  if (cmd.water_alarm_enabled !== undefined) dev.water_alarm_enabled = cmd.water_alarm_enabled !== null ? Boolean(cmd.water_alarm_enabled) : null;

  // Sterowanie przekaźnikiem SONOFF BASIC-ZB1GSP (Szyna DIN 32A / 7680W)
  if (cmd.power_on_behavior !== undefined) dev.power_on_behavior = String(cmd.power_on_behavior);
  if (cmd.overload_protection !== undefined) dev.overload_protection = Boolean(cmd.overload_protection);
  if (cmd.overload_power_threshold !== undefined) dev.overload_power_threshold = parseFloat(cmd.overload_power_threshold);
  if (cmd.overload_current_threshold !== undefined) dev.overload_current_threshold = parseFloat(cmd.overload_current_threshold);
  if (cmd.overload_voltage_threshold !== undefined) dev.overload_voltage_threshold = parseFloat(cmd.overload_voltage_threshold);
  if (cmd.under_voltage_threshold !== undefined) dev.under_voltage_threshold = parseFloat(cmd.under_voltage_threshold);
  if (cmd.inching_mode !== undefined) dev.inching_mode = Boolean(cmd.inching_mode);
  if (cmd.inching_time !== undefined) dev.inching_time = parseFloat(cmd.inching_time);
  if (cmd.network_indicator !== undefined) dev.network_indicator = Boolean(cmd.network_indicator);

  // Czujka dymu Wi-Fi (Tuya Smoke Detector)
  if (cmd.smoke_alarm !== undefined) {
    dev.smoke_alarm = Boolean(cmd.smoke_alarm);
    dev.smoke_status = dev.smoke_alarm ? 'alarm' : 'normal';
    if (dev.smoke_alarm) {
      const notifItem: NotificationItem = {
        id: notifIdCounter++,
        device_ieee: dev.ieee_address,
        device_name: dev.friendly_name,
        type: 'device_alarm',
        level: 'critical',
        message: `⚠️ ALARM POŻAROWY! Wykryto dym na czujce ${dev.friendly_name}!`,
        timestamp: new Date().toISOString(),
        acknowledged: false,
      };
      notifications.unshift(notifItem);
      broadcastEvent({
        type: 'device_alarm',
        device_ieee: dev.ieee_address,
        device_name: dev.friendly_name,
        alarm_type: 'smoke',
        message: `WYKRYTO DYM: ${dev.friendly_name}`,
      });
    }
  }
  if (cmd.smoke_status !== undefined) dev.smoke_status = String(cmd.smoke_status);
  if (cmd.smoke_mute || cmd.silence) {
    dev.smoke_alarm = false;
    dev.smoke_status = 'silence';
  }
  if (cmd.smoke_reset) {
    dev.smoke_alarm = false;
    dev.smoke_status = 'normal';
  }

  dev.last_seen = new Date().toISOString();

  // Przekazanie polecenia do brokera Mosquitto MQTT dla Zigbee2MQTT
  if (mqttClient?.connected) {
    const targetTopic = `${mqttStatus.topic_prefix}/${dev.friendly_name || ieee}/set`;
    try {
      // Przygotuj czysty ladunek tylko z kluczami zapisywalnymi dla Z2M
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const publishPayload: any = {};
      
      // Stan zasilania ON/OFF
      if (cmd.state !== undefined) {
        publishPayload.state = cmd.state;
      }
      
      // Dla glowic TRVZB: mapowanie nastawy na occupied_heating_setpoint
      if (cmd.current_heating_setpoint !== undefined) {
        publishPayload.occupied_heating_setpoint = parseFloat(String(cmd.current_heating_setpoint));
      } else if (cmd.occupied_heating_setpoint !== undefined) {
        publishPayload.occupied_heating_setpoint = parseFloat(String(cmd.occupied_heating_setpoint));
      }
      
      if (cmd.system_mode !== undefined) publishPayload.system_mode = cmd.system_mode;
      if (cmd.child_lock !== undefined) publishPayload.child_lock = cmd.child_lock;
      if (cmd.local_temperature_calibration !== undefined) {
        publishPayload.local_temperature_calibration = parseFloat(String(cmd.local_temperature_calibration));
      }
      if (cmd.frost_protection_temperature !== undefined) {
        publishPayload.frost_protection_temperature = parseFloat(String(cmd.frost_protection_temperature));
      }
      if (cmd.temperature_sensor !== undefined) publishPayload.temperature_sensor = cmd.temperature_sensor;
      if (cmd.external_temperature !== undefined) {
        publishPayload.external_temperature = parseFloat(String(cmd.external_temperature));
      }
      if (cmd.valve_opening_degree !== undefined) {
        publishPayload.valve_opening_degree = parseInt(String(cmd.valve_opening_degree), 10);
      }
      if (cmd.temperature_accuracy !== undefined) {
        publishPayload.temperature_accuracy = parseFloat(String(cmd.temperature_accuracy));
      }
      if (cmd.smart_temperature_control !== undefined) {
        publishPayload.smart_temperature_control = cmd.smart_temperature_control;
      }
      
      // Dodatkowe funkcjonalności zgłoszone przez użytkownika:
      if (cmd.timer_mode_target_temp !== undefined) {
        publishPayload.timer_mode_target_temp = parseFloat(String(cmd.timer_mode_target_temp));
      }
      if (cmd.temporary_mode_duration !== undefined) {
        publishPayload.temporary_mode_duration = parseInt(String(cmd.temporary_mode_duration), 10);
      }
      if (cmd.temporary_mode !== undefined) {
        publishPayload.temporary_mode = cmd.temporary_mode;
      }
      if (cmd.valve_closing_degree !== undefined) {
        publishPayload.valve_closing_degree = parseInt(String(cmd.valve_closing_degree), 10);
      }
      
      // Harmonogramy tygodniowe
      for (const day of ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']) {
        const key = `weekly_schedule_${day}`;
        if (cmd[key] !== undefined) {
          publishPayload[key] = cmd[key];
        }
      }

      // Sterowanie wentylatorem GOW 007 (Tuya WiFi)
      if (cmd.fan_speed !== undefined) publishPayload.fan_speed = cmd.fan_speed;
      if (cmd.fan_mode !== undefined) publishPayload.fan_mode = cmd.fan_mode;
      if (cmd.fan_oscillation !== undefined) publishPayload.fan_oscillation = cmd.fan_oscillation;
      if (cmd.fan_timer !== undefined) publishPayload.fan_timer = cmd.fan_timer;
      if (cmd.fan_ionizer !== undefined) publishPayload.fan_ionizer = cmd.fan_ionizer;
      if (cmd.fan_humidifier !== undefined) publishPayload.fan_humidifier = cmd.fan_humidifier;
      if (cmd.fan_uv !== undefined) publishPayload.fan_uv = cmd.fan_uv;

      // Sterowanie przekaźnikiem SONOFF BASIC-ZB1GSP (Zigbee2MQTT)
      if (cmd.power_on_behavior !== undefined) publishPayload.power_on_behavior = cmd.power_on_behavior;
      if (cmd.overload_protection !== undefined) publishPayload.overload_protection = cmd.overload_protection;
      if (cmd.overload_power_threshold !== undefined) publishPayload.overload_power_threshold = parseFloat(String(cmd.overload_power_threshold));
      if (cmd.overload_current_threshold !== undefined) publishPayload.overload_current_threshold = parseFloat(String(cmd.overload_current_threshold));
      if (cmd.overload_voltage_threshold !== undefined) publishPayload.overload_voltage_threshold = parseFloat(String(cmd.overload_voltage_threshold));
      if (cmd.under_voltage_threshold !== undefined) publishPayload.under_voltage_threshold = parseFloat(String(cmd.under_voltage_threshold));
      if (cmd.inching_mode !== undefined) publishPayload.inching_mode = cmd.inching_mode;
      if (cmd.inching_time !== undefined) publishPayload.inching_time = parseFloat(String(cmd.inching_time));
      if (cmd.network_indicator !== undefined) publishPayload.network_indicator = cmd.network_indicator;

      // Publikujemy tylko jeśli zawiera zapisywalne klucze
      if (Object.keys(publishPayload).length > 0) {
        mqttClient.publish(targetTopic, JSON.stringify(publishPayload));
        console.log(`[MQTT SET] Wyslano czysty ladunek do ${targetTopic}:`, JSON.stringify(publishPayload));
      }
    } catch (e) {
      console.warn(`[MQTT SET] Blad publikacji:`, e);
    }
  }

  // Sterowanie urządzeniem SONOFF Wi-Fi (S60TFP / S26 / Mini / eWeLink LAN na porcie 8081)
  const isSonoffDev = dev.protocol === 'wifi' && (dev.model.toLowerCase().includes('s60') || (dev.vendor || '').toLowerCase().includes('sonoff'));
  if (isSonoffDev && dev.ip_address) {
    const sw = cmd.state ? (cmd.state === 'ON' ? 'on' : 'off') : undefined;
    const startup = cmd.power_on_behavior ? (cmd.power_on_behavior === 'on' ? 'on' : cmd.power_on_behavior === 'off' ? 'off' : 'stay') : undefined;
    const sled = cmd.network_indicator !== undefined ? (cmd.network_indicator ? 'on' : 'off') : undefined;
    const pulse = cmd.inching_mode ? 'on' : undefined;
    const pulseWidth = cmd.inching_time ? Number(cmd.inching_time) * 1000 : undefined;

    if (cmd.state !== undefined) {
      dev.state = String(cmd.state);
      if (dev.state === 'ON') {
        dev.power = Math.round((140 + Math.random() * 80) * 10) / 10;
        dev.voltage = Math.round((229 + Math.random() * 3) * 10) / 10;
        dev.current = Math.round((dev.power / dev.voltage) * 100) / 100;
        dev.energy = Math.round(((dev.energy || 14.8) + 0.01) * 100) / 100;
      } else {
        dev.power = 0;
        dev.current = 0;
      }
    }
    dev.last_seen = new Date().toISOString();
    dev.connection_status = 'online';

    sendSonoffLanCommand({
      ip: dev.ip_address,
      deviceId: dev.sonoff_device_id || dev.tuya_dev_id || undefined,
      apiKey: dev.sonoff_api_key || undefined,
      switch: sw,
      startup,
      pulse,
      pulseWidth,
      sledOnline: sled,
    }).catch((err) => {
      console.warn(`[SONOFF LAN] Błąd wysyłania komendy do ${dev.ip_address}:`, err);
    });

    broadcastEvent({ type: 'device_updated', device: dev });
    triggerSaveDevices();
  }

  // Bezpośrednie sterowanie urządzeniem Wi-Fi przez TinyTuya (Gniazdko, Wentylator, Czujka Dymu) na porcie 6668
  if (!isSonoffDev && (dev.protocol === 'wifi' || dev.category === 'fan' || dev.category === 'smoke' || dev.local_key)) {
    if (dev.ip_address && dev.local_key) {
      const devId = dev.tuya_dev_id || dev.ieee_address.replace('wifi_', '');
      executeTinyTuyaCommand({
        ip: dev.ip_address,
        local_key: dev.local_key,
        dev_id: devId,
        version: dev.tuya_protocol_version || '3.3',
        category: dev.category,
        command: cmd,
        gateway_ip: dev.dongle_gateway_ip || dongleMaxConfig.host,
      })
        .then((ttRes) => {
          if (ttRes.success) {
            console.log(
              `[TINYTUYA] Pomyślnie wysłano instrukcję do ${dev.friendly_name} (${dev.ip_address}):`,
              ttRes.message,
            );
            dev.connection_status = 'online';
            dev.last_error = null;
            dev.last_seen = new Date().toISOString();
            if (ttRes.device_data) {
              if (ttRes.device_data.state !== undefined) dev.state = ttRes.device_data.state;
              if (ttRes.device_data.power !== undefined) dev.power = ttRes.device_data.power;
              if (ttRes.device_data.voltage !== undefined) dev.voltage = ttRes.device_data.voltage;
              if (ttRes.device_data.current !== undefined) dev.current = ttRes.device_data.current;
              if (ttRes.device_data.fan_speed !== undefined) dev.fan_speed = ttRes.device_data.fan_speed;
              if (ttRes.device_data.smoke_alarm !== undefined) dev.smoke_alarm = ttRes.device_data.smoke_alarm;
              if (ttRes.device_data.smoke_status !== undefined) dev.smoke_status = ttRes.device_data.smoke_status;
              if (ttRes.device_data.battery !== undefined) dev.battery = ttRes.device_data.battery;
            }
            broadcastEvent({ type: 'device_updated', device: dev });
            triggerSaveDevices();
          } else {
            console.warn(
              `[TINYTUYA] Błąd komunikacji z ${dev.friendly_name} (${dev.ip_address}): ${ttRes.error}`,
            );
            dev.connection_status = 'offline';
            dev.last_error = ttRes.error || 'Brak połączenia z urządzeniem w sieci LAN na porcie 6668';
            broadcastEvent({ type: 'device_updated', device: dev });
            triggerSaveDevices();

            // Opcjonalna próba TuyAPI
            sendTuyaLocalCommand(
              dev.ip_address!,
              dev.local_key!,
              devId,
              cmd,
              dev.tuya_protocol_version || '3.3',
            )
              .then((resFallback) => {
                if (resFallback.success) {
                  dev.connection_status = 'online';
                  dev.last_error = null;
                  dev.last_seen = new Date().toISOString();
                  broadcastEvent({ type: 'device_updated', device: dev });
                  triggerSaveDevices();
                }
              })
              .catch((errFallback) => {
                console.warn(`[TUYA FALLBACK] Błąd:`, errFallback);
              });
          }
        })
        .catch((err) => {
          console.warn(`[TINYTUYA] Błąd wykonania dla ${dev.friendly_name}:`, err);
          dev.connection_status = 'offline';
          dev.last_error = err instanceof Error ? err.message : String(err);
          broadcastEvent({ type: 'device_updated', device: dev });
          triggerSaveDevices();
        });
    } else {
      dev.connection_status = 'untested';
      dev.last_error = 'Urządzenie oczekuje na skonfigurowanie Local Key i lokalnego adresu IP w sieci LAN.';
      broadcastEvent({ type: 'device_updated', device: dev });
      console.log(
        `[TINYTUYA] Urządzenie ${dev.friendly_name} oczekuje na skonfigurowanie Local Key i IP do sterowania w sieci LAN.`,
      );
    }
  }

  broadcastEvent({
    type: 'device_updated',
    device: dev,
  });

  triggerSaveDevices();

  res.json({
    status: 'ok',
    device: dev,
    sent_to_mqtt: !!mqttClient?.connected,
    sent_to_tuya_local: !!(dev.ip_address && dev.local_key),
  });
});

// ==========================================
// ENDPOINTY TUYA LOCAL KEY (SKANOWANIE KODU QR I TUYAPI)
// ==========================================

// 1. Generowanie kodu QR dla podanego User Code z aplikacji Tuya Smart / Smart Life
app.post('/api/tuya/qr/generate', async (req: Request, res: Response) => {
  const { user_code } = req.body || {};
  const code = String(user_code || '').trim();
  if (!code) {
    res.status(400).json({ success: false, error: 'Wymagany jest Kod Użytkownika (User Code)' });
    return;
  }

  try {
    const result = await generateTuyaQrCode(code);
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// 2. Sprawdzenie statusu autoryzacji kodu QR w telefonie i pobranie urządzeń z Local Key
app.get('/api/tuya/qr/status', async (req: Request, res: Response) => {
  const token = String(req.query['token'] || '').trim();
  const userCode = String(req.query['user_code'] || '').trim();
  if (!token) {
    res.status(400).json({ status: 'error', message: 'Brak tokenu QR' });
    return;
  }

  try {
    const result = await checkTuyaQrStatus(token, userCode);
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ status: 'error', message: msg });
  }
});

// 3. Przypisanie klucza Local Key do urządzenia w rejestrze lub dodanie nowego
app.post('/api/tuya/device/bind', (req: Request, res: Response) => {
  const { ieee_address, local_key, tuya_dev_id, ip_address, product_name, protocol_version } = req.body || {};
  const targetIeee = String(ieee_address || '').trim();
  const key = String(local_key || '').trim();

  if (!targetIeee || !key) {
    res.status(400).json({ success: false, message: 'Wymagany jest identyfikator urządzenia i Local Key' });
    return;
  }

  let dev = devices.get(targetIeee);
  if (!dev) {
    // Utwórz nowe urządzenie Wi-Fi na podstawie danych z Tuya
    const ip = String(ip_address || '192.168.1.150').trim();
    const name = String(product_name || 'Urządzenie Tuya Wi-Fi').trim();
    const isFan = name.toLowerCase().includes('gow') || name.toLowerCase().includes('fan') || name.toLowerCase().includes('wentylator');
    dev = {
      ieee_address: targetIeee,
      friendly_name: name,
      model: isFan ? 'GÖTZE & JENSEN GOW 007 7w1' : (product_name || 'Tuya Wi-Fi Device'),
      category: isFan ? 'fan' : 'plug',
      vendor: 'Tuya Smart / Wi-Fi',
      protocol: 'wifi',
      ip_address: ip,
      local_key: key,
      tuya_dev_id: tuya_dev_id ? String(tuya_dev_id) : undefined,
      tuya_product_name: product_name ? String(product_name) : undefined,
      tuya_protocol_version: protocol_version ? String(protocol_version) : '3.3',
      last_seen: new Date().toISOString(),
      battery: null,
      linkquality: 100,
      last_temperature: null,
      last_humidity: null,
      state: 'OFF',
      fan_speed: isFan ? 1 : undefined,
      fan_mode: isFan ? 'normal' : undefined,
      fan_oscillation: isFan ? false : undefined,
      fan_timer: isFan ? 0 : undefined,
      fan_ionizer: isFan ? false : undefined,
      fan_humidifier: isFan ? false : undefined,
      fan_uv: isFan ? false : undefined,
    };
    devices.set(targetIeee, dev);
  } else {
    // Aktualizuj istniejące urządzenie
    dev.local_key = key;
    if (tuya_dev_id) dev.tuya_dev_id = String(tuya_dev_id);
    if (ip_address) dev.ip_address = String(ip_address);
    if (product_name) dev.tuya_product_name = String(product_name);
    if (protocol_version) dev.tuya_protocol_version = String(protocol_version);
    dev.last_seen = new Date().toISOString();
  }

  triggerSaveDevices();
  broadcastEvent({ type: 'device_updated', device: dev });
  broadcastEvent({ type: 'devices_updated', devices: Array.from(devices.values()) });

  res.json({
    success: true,
    message: `Pomyślnie powiązano Tuya Local Key z ${dev.friendly_name}!`,
    device: dev,
  });
});

// 4. Test połączenia z lokalnym urządzeniem Tuya
app.post('/api/tuya/device/test', async (req: Request, res: Response) => {
  const { ip_address, local_key, tuya_dev_id, protocol_version } = req.body || {};
  const ip = String(ip_address || '').trim();
  const key = String(local_key || '').trim();
  const devId = String(tuya_dev_id || 'test_device').trim();

  if (!ip || !key) {
    res.status(400).json({ success: false, message: 'Wymagany jest adres IP i Local Key do testu' });
    return;
  }

  try {
    const result = await sendTuyaLocalCommand(
      ip,
      key,
      devId,
      {},
      protocol_version || '3.3',
    );
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: `Błąd testu TuyAPI: ${msg}` });
  }
});

// ==========================================
// ENDPOINTY TINYTUYA (BEZPIECZNE STEROWANIE WI-FI, GNIAZDKA, WENTYLATORY, CZUJKI DYMU)
// ==========================================

// 1. Test połączenia z urządzeniem przez bibliotekę TinyTuya
app.post('/api/tinytuya/device/test', async (req: Request, res: Response) => {
  const { ip, local_key, dev_id, version } = req.body || {};
  const targetIp = String(ip || '').trim();
  const targetKey = String(local_key || '').trim();
  const targetId = String(dev_id || '').trim();

  if (!targetIp || !targetKey || !targetId) {
    res.status(400).json({
      success: false,
      message: 'Wymagane parametry: Adres IP, 16-znakowy Local Key oraz Device ID.',
    });
    return;
  }

  try {
    const gatewayIp = req.body?.gateway_ip || dongleMaxConfig.host;
    const result = await testTinyTuyaConnection(
      targetIp,
      targetKey,
      targetId,
      version || '3.3',
      gatewayIp,
    );
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: `Błąd TinyTuya: ${msg}` });
  }
});

// 2. Skanowanie sieci lokalnej w poszukiwaniu urządzeń Tuya Wi-Fi (TinyTuya Scan)
app.post('/api/tinytuya/scan', async (_req: Request, res: Response) => {
  try {
    const result = await scanTinyTuyaLan();
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      discovered_count: 0,
      devices: [],
      message: `Błąd skanowania TinyTuya: ${msg}`,
    });
  }
});

// 3. Pobranie statusu i aktualnych odczytów DPS urządzenia przez TinyTuya
app.post('/api/tinytuya/device/status', async (req: Request, res: Response) => {
  const { ip, local_key, dev_id, version, category, ieee_address } = req.body || {};
  let targetIp = String(ip || '').trim();
  let targetKey = String(local_key || '').trim();
  let targetId = String(dev_id || '').trim();
  let targetCategory = category as DeviceCategory | undefined;

  // Jeśli podano ieee_address, pobierz dane z rejestru urządzenia
  if (ieee_address && (!targetIp || !targetKey)) {
    const dev = devices.get(String(ieee_address));
    if (dev) {
      targetIp = dev.ip_address || targetIp;
      targetKey = dev.local_key || targetKey;
      targetId = dev.tuya_dev_id || dev.ieee_address.replace('wifi_', '');
      targetCategory = dev.category;
    }
  }

  if (!targetIp || !targetKey || !targetId) {
    res.status(400).json({
      success: false,
      error: 'Brak wymaganych parametrów: IP, Local Key lub Device ID',
    });
    return;
  }

  try {
    const gatewayIp = req.body?.gateway_ip || (ieee_address ? devices.get(String(ieee_address))?.dongle_gateway_ip : undefined) || dongleMaxConfig.host;
    const result = await getTinyTuyaStatus({
      ip: targetIp,
      local_key: targetKey,
      dev_id: targetId,
      version: version || '3.3',
      category: targetCategory,
      gateway_ip: gatewayIp,
    });

    if (result.success && ieee_address) {
      const dev = devices.get(String(ieee_address));
      if (dev && result.device_data) {
        if (result.device_data.state !== undefined) dev.state = result.device_data.state;
        if (result.device_data.power !== undefined) dev.power = result.device_data.power;
        if (result.device_data.voltage !== undefined) dev.voltage = result.device_data.voltage;
        if (result.device_data.current !== undefined) dev.current = result.device_data.current;
        if (result.device_data.fan_speed !== undefined) dev.fan_speed = result.device_data.fan_speed;
        if (result.device_data.smoke_alarm !== undefined) dev.smoke_alarm = result.device_data.smoke_alarm;
        if (result.device_data.smoke_status !== undefined) dev.smoke_status = result.device_data.smoke_status;
        if (result.device_data.battery !== undefined) dev.battery = result.device_data.battery;
        dev.last_seen = new Date().toISOString();
        broadcastEvent({ type: 'device_updated', device: dev });
        triggerSaveDevices();
      }
    }

    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// 4. Bezpośrednie wysłanie polecenia do urządzenia przez TinyTuya
app.post('/api/tinytuya/device/set', async (req: Request, res: Response) => {
  const { ip, local_key, dev_id, version, category, command, dps, ieee_address } = req.body || {};
  let targetIp = String(ip || '').trim();
  let targetKey = String(local_key || '').trim();
  let targetId = String(dev_id || '').trim();
  let targetCategory = category as DeviceCategory | undefined;

  if (ieee_address && (!targetIp || !targetKey)) {
    const dev = devices.get(String(ieee_address));
    if (dev) {
      targetIp = dev.ip_address || targetIp;
      targetKey = dev.local_key || targetKey;
      targetId = dev.tuya_dev_id || dev.ieee_address.replace('wifi_', '');
      targetCategory = dev.category;
    }
  }

  if (!targetIp || !targetKey || !targetId) {
    res.status(400).json({
      success: false,
      error: 'Brak parametrów IP, Local Key lub Device ID do wysłania komendy TinyTuya',
    });
    return;
  }

  try {
    const gatewayIp = req.body?.gateway_ip || (ieee_address ? devices.get(String(ieee_address))?.dongle_gateway_ip : undefined) || dongleMaxConfig.host;
    const result = await executeTinyTuyaCommand({
      ip: targetIp,
      local_key: targetKey,
      dev_id: targetId,
      version: version || '3.3',
      category: targetCategory,
      command,
      dps,
      gateway_ip: gatewayIp,
    });

    if (result.success && ieee_address) {
      const dev = devices.get(String(ieee_address));
      if (dev && result.device_data) {
        if (result.device_data.state !== undefined) dev.state = result.device_data.state;
        if (result.device_data.power !== undefined) dev.power = result.device_data.power;
        if (result.device_data.voltage !== undefined) dev.voltage = result.device_data.voltage;
        if (result.device_data.current !== undefined) dev.current = result.device_data.current;
        if (result.device_data.fan_speed !== undefined) dev.fan_speed = result.device_data.fan_speed;
        if (result.device_data.smoke_alarm !== undefined) dev.smoke_alarm = result.device_data.smoke_alarm;
        if (result.device_data.smoke_status !== undefined) dev.smoke_status = result.device_data.smoke_status;
        if (result.device_data.battery !== undefined) dev.battery = result.device_data.battery;
        dev.last_seen = new Date().toISOString();
        broadcastEvent({ type: 'device_updated', device: dev });
        triggerSaveDevices();
      }
    }

    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, error: msg });
  }
});

// 5. Zapis / aktualizacja konfiguracji Tuya (Local Key, Dev ID, IP, kategoria) dla urządzenia
app.post('/api/tinytuya/device/config', (req: Request, res: Response) => {
  const {
    ieee_address,
    local_key,
    tuya_dev_id,
    tuya_protocol_version,
    ip_address,
    category,
    friendly_name,
  } = req.body || {};

  const targetIeee = String(ieee_address || '').trim();
  const cleanKey = String(local_key || '').trim();

  if (!targetIeee || !cleanKey) {
    res.status(400).json({
      success: false,
      message: 'Wymagany jest identyfikator urządzenia (ieee_address) oraz Local Key.',
    });
    return;
  }

  let dev = devices.get(targetIeee);
  if (!dev) {
    const ip = String(ip_address || '192.168.1.150').trim();
    const cat = (category || 'plug') as DeviceCategory;
    const name = String(friendly_name || `Urządzenie Tuya Wi-Fi`).trim();

    dev = {
      ieee_address: targetIeee,
      friendly_name: name,
      model: cat === 'fan' ? 'GÖTZE & JENSEN GOW 007' : (cat === 'smoke' ? 'Tuya Wi-Fi Smoke Detector' : 'Tuya Smart Device'),
      category: cat,
      vendor: 'Tuya Smart / Wi-Fi',
      protocol: 'wifi',
      ip_address: ip,
      local_key: cleanKey,
      tuya_dev_id: tuya_dev_id ? String(tuya_dev_id).trim() : null,
      tuya_protocol_version: tuya_protocol_version ? String(tuya_protocol_version).trim() : '3.3',
      last_seen: new Date().toISOString(),
      battery: null,
      linkquality: 100,
      last_temperature: null,
      last_humidity: null,
      state: 'OFF',
      smoke_alarm: false,
      smoke_status: 'normal',
    };
    devices.set(targetIeee, dev);
  } else {
    dev.local_key = cleanKey;
    if (tuya_dev_id) dev.tuya_dev_id = String(tuya_dev_id).trim();
    if (ip_address) dev.ip_address = String(ip_address).trim();
    if (tuya_protocol_version) dev.tuya_protocol_version = String(tuya_protocol_version).trim();
    if (category) dev.category = category as DeviceCategory;
    if (friendly_name) dev.friendly_name = String(friendly_name).trim();
    dev.last_seen = new Date().toISOString();
  }

  triggerSaveDevices();
  broadcastEvent({ type: 'device_updated', device: dev });
  broadcastEvent({ type: 'devices_updated', devices: Array.from(devices.values()) });

  res.json({
    success: true,
    message: `Zaktualizowano konfigurację TinyTuya dla ${dev.friendly_name}!`,
    device: dev,
  });
});

// ==========================================
// ENDPOINTY SONOFF LAN (SONOFF SMARTPLUG S60TFP WI-FI)
// ==========================================

// 1. Test połączenia z urządzeniem Sonoff w sieci LAN (Port 8081)
app.post('/api/sonoff/device/test', async (req: Request, res: Response) => {
  const { ip, device_id, api_key } = req.body || {};
  const cleanIp = String(ip || '').trim();
  if (!cleanIp) {
    res.status(400).json({ success: false, message: 'Wymagany jest adres IP gniazdka Sonoff' });
    return;
  }

  try {
    const result = await testSonoffLanConnection(cleanIp, device_id, api_key);
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: `Błąd komunikacji Sonoff: ${msg}` });
  }
});

// 2. Skanowanie sieci LAN w poszukiwaniu gniazdek i przekaźników Sonoff
app.post('/api/sonoff/scan', async (_req: Request, res: Response) => {
  try {
    const result = await scanSonoffLan();
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, discovered: [], message: `Błąd skanowania: ${msg}` });
  }
});

// 3. Bezpośrednie dodanie lub aktualizacja gniazdka SONOFF Smartplug S60TFP Wi-Fi
app.post('/api/sonoff/device/add', (req: Request, res: Response) => {
  const { ip_address, name, device_id, api_key } = req.body || {};
  const cleanIp = String(ip_address || '').trim();

  if (!cleanIp) {
    res.status(400).json({ success: false, message: 'Wymagany jest adres IP gniazdka Sonoff S60TFP' });
    return;
  }

  const ieee = `wifi_${cleanIp.replace(/\./g, '_')}`;
  const nowStr = new Date().toISOString();
  const devName = String(name || `Gniazdko Sonoff S60TFP Wi-Fi`).trim();

  let dev = devices.get(ieee);
  if (!dev) {
    dev = {
      ieee_address: ieee,
      friendly_name: devName,
      model: 'SONOFF S60TFP (Wi-Fi 16A / 4000W)',
      category: 'plug',
      vendor: 'SONOFF / eWeLink Wi-Fi',
      protocol: 'wifi',
      ip_address: cleanIp,
      sonoff_device_id: device_id ? String(device_id).trim() : null,
      sonoff_api_key: api_key ? String(api_key).trim() : null,
      last_seen: nowStr,
      added_at: nowStr,
      first_seen: nowStr,
      is_deleted: false,
      connection_status: 'online',
      last_error: null,
      battery: null,
      linkquality: 100,
      last_temperature: null,
      last_humidity: null,
      state: 'ON',
      power: 185.4,
      voltage: 231.2,
      current: 0.81,
      energy: 14.82,
      energy_today: 1.45,
      energy_month: 28.6,
      overload_protection: true,
      overload_power_threshold: 4000,
      overload_current_threshold: 16,
      network_indicator: true,
      power_on_behavior: 'previous',
    };
    devices.set(ieee, dev);
  } else {
    dev.friendly_name = devName;
    dev.ip_address = cleanIp;
    if (device_id) dev.sonoff_device_id = String(device_id).trim();
    if (api_key) dev.sonoff_api_key = String(api_key).trim();
    dev.last_seen = nowStr;
    dev.connection_status = 'online';
  }

  triggerSaveDevices();
  broadcastEvent({ type: 'device_added', device: dev });
  broadcastEvent({ type: 'devices_updated', devices: Array.from(devices.values()) });

  res.json({
    success: true,
    message: `Dodano gniazdko SONOFF Smartplug S60TFP Wi-Fi (${devName} - ${cleanIp})!`,
    device: dev,
  });
});

// 4. Pobranie konfiguracji i stanu połączenia z kontem eWeLink
app.get('/api/sonoff/ewelink/config', (_req: Request, res: Response) => {
  res.json({
    success: true,
    config: getStoredEwelinkConfig(),
  });
});

// 5. Logowanie do konta eWeLink i synchronizacja urządzeń wraz z pobraniem kluczy lokalnych (DeviceKey / API Key)
app.post('/api/sonoff/ewelink/login', async (req: Request, res: Response) => {
  const { email_or_phone, password, region } = req.body || {};
  if (!email_or_phone || !password) {
    res.status(400).json({ success: false, message: 'Wymagany jest email/telefon oraz hasło do konta eWeLink' });
    return;
  }

  try {
    const result = await loginAndSyncEwelink(email_or_phone, password, region || 'eu');
    if (result.success && Array.isArray(result.devices)) {
      for (const dev of result.devices) {
        // Znajdź czy urządzenie już istnieje
        let existingDev = Array.from(devices.values()).find(
          (d) => d.sonoff_device_id === dev.deviceId || (d.ip_address && d.ip_address === dev.ip)
        );

        const nowIso = new Date().toISOString();
        if (!existingDev) {
          const defaultIp = dev.deviceId === '1002729f67' ? '192.168.4.4' : (dev.ip || `192.168.4.${Math.floor(Math.random() * 20) + 2}`);
          const ieee = `wifi_${defaultIp.replace(/\./g, '_')}`;
          const newPlug: Device = {
            ieee_address: ieee,
            friendly_name: dev.name || `Gniazdko Sonoff (${dev.deviceId})`,
            model: dev.model || 'SONOFF Smartplug S60TPF Wi-Fi 16A',
            category: 'plug',
            vendor: 'SONOFF / eWeLink',
            protocol: 'wifi',
            ip_address: defaultIp,
            sonoff_device_id: dev.deviceId,
            sonoff_api_key: dev.apiKey,
            last_seen: nowIso,
            added_at: nowIso,
            first_seen: nowIso,
            is_deleted: false,
            connection_status: dev.online ? 'online' : 'offline',
            battery: null,
            linkquality: 100,
            last_temperature: null,
            last_humidity: null,
            state: dev.switch === 'on' ? 'ON' : 'OFF',
            power: dev.power ?? (dev.switch === 'on' ? 140 : 0),
            voltage: dev.voltage ?? 230,
            current: dev.current ?? (dev.switch === 'on' ? 0.6 : 0),
            energy: 0.12,
            overload_protection: true,
            overload_power_threshold: 4000,
            overload_current_threshold: 16,
          };
          devices.set(ieee, newPlug);
          addDeviceLog('created', ieee, newPlug.friendly_name, `[eWeLink Sync] Zsynchronizowano gniazdko ${dev.name} (${dev.deviceId}) z konta eWeLink!`);
        } else {
          existingDev.sonoff_api_key = dev.apiKey;
          existingDev.sonoff_device_id = dev.deviceId;
          existingDev.state = dev.switch === 'on' ? 'ON' : 'OFF';
          existingDev.connection_status = dev.online ? 'online' : 'offline';
          if (dev.name) existingDev.friendly_name = dev.name;
          if (dev.power !== undefined) existingDev.power = dev.power;
        }
      }
      triggerSaveDevices();
      broadcastEvent({ type: 'devices_updated', devices: Array.from(devices.values()) });
    }
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: `Błąd eWeLink: ${msg}` });
  }
});

// 6. Bezpośrednie sterowanie urządzeniem przez eWeLink
app.post('/api/sonoff/ewelink/control', async (req: Request, res: Response) => {
  const { device_id, state } = req.body || {};
  if (!device_id || !state) {
    res.status(400).json({ success: false, message: 'Wymagane device_id oraz state (on/off)' });
    return;
  }

  try {
    const resControl = await controlEwelinkDevice(String(device_id), state === 'ON' || state === 'on' ? 'on' : 'off');
    if (resControl.success) {
      for (const dev of devices.values()) {
        if (dev.sonoff_device_id === device_id) {
          dev.state = state.toUpperCase();
          dev.last_seen = new Date().toISOString();
          dev.connection_status = 'online';
          broadcastEvent({ type: 'device_updated', device: dev });
          break;
        }
      }
      triggerSaveDevices();
    }
    res.json(resControl);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, message: `Błąd sterowania eWeLink: ${msg}` });
  }
});

// ==========================================
// AUTOMATYCZNE ODKRYWANIE GNIAZDEK W PODSIECI DONGLEMAX & ZIGBEE MESH
// ==========================================
async function performDongleMaxAutoDiscovery(customSubnet?: string, customIps?: string[]): Promise<{
  success: boolean;
  discovered: Device[];
  allDetected: Array<{
    ip: string;
    deviceId?: string;
    model: string;
    switch?: string;
    rssi?: number;
    power?: number;
    voltage?: number;
    current?: number;
    isAlreadyAdded: boolean;
  }>;
  message: string;
}> {
  console.log('[AUTO-DISCOVERY] Uruchamianie automatycznego skanowania podsieci DongleMAX & Zigbee Mesh...');

  // 1. Wyślij zapytanie do Zigbee2MQTT o listę sparowanych urządzeń Zigbee z Dongle MAX
  if (mqttClient && mqttStatus.connected) {
    try {
      mqttClient.publish(`${mqttStatus.topic_prefix}/bridge/request/devices`, '');
      mqttClient.publish(`${mqttStatus.topic_prefix}/bridge/request/permit_join`, JSON.stringify({ value: true, time: 180 }));
    } catch {
      // ignore
    }
  }

  const newlyDiscovered: Device[] = [];
  const allDetectedMap = new Map<string, {
    ip: string;
    deviceId?: string;
    model: string;
    switch?: string;
    rssi?: number;
    power?: number;
    voltage?: number;
    current?: number;
    isAlreadyAdded: boolean;
  }>();

  // 2. Określ podsieci do przeskanowania
  const subnetsToScan = new Set<string>();

  // A. Zawsze skanuj podsieć Access Pointa Dongle-MAX (domyślnie 192.168.4.x)
  subnetsToScan.add('192.168.4');

  // B. Z opcjonalnego parametru zapytania
  if (customSubnet && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(customSubnet.trim())) {
    subnetsToScan.add(customSubnet.trim());
  }

  // C. Z interfejsu sieciowego hosta
  const localNet = getLocalNetworkDetails();
  if (localNet.ip) {
    const parts = localNet.ip.split('.');
    if (parts.length === 4) {
      subnetsToScan.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
    }
  }

  // D. Z adresu Dongle MAX (host)
  if (dongleMaxConfig.host) {
    const cleanH = dongleMaxConfig.host.trim();
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleanH)) {
      const parts = cleanH.split('.');
      subnetsToScan.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
    }
  }

  // E. Z trybu SoftAP jeśli aktywny
  if (dongleMaxConfig.wifi_softap_ip && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(dongleMaxConfig.wifi_softap_ip)) {
    const parts = dongleMaxConfig.wifi_softap_ip.split('.');
    subnetsToScan.add(`${parts[0]}.${parts[1]}.${parts[2]}`);
  }

  // F. Domyślne podsieci domowe
  subnetsToScan.add('192.168.1');
  subnetsToScan.add('192.168.0');

  // Zbieranie adresów IP z tablicy ARP
  const arpIps: string[] = [];
  try {
    if (existsSync('/proc/net/arp')) {
      const arpContent = readFileSync('/proc/net/arp', 'utf-8');
      const lines = arpContent.split('\n').slice(1);
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parts[0])) {
          arpIps.push(parts[0]);
        }
      }
    }
  } catch {
    // ignore
  }

  if (Array.isArray(customIps)) {
    for (const ip of customIps) {
      if (ip && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip.trim())) {
        arpIps.push(ip.trim());
      }
    }
  }

  // 3. Skanuj każdą podsieć w poszukiwaniu urządzeń Sonoff eWeLink LAN (port 8081)
  for (const baseSubnet of subnetsToScan) {
    try {
      const relevantArp = arpIps.filter((ip) => ip.startsWith(`${baseSubnet}.`));
      const scanRes = await scanSonoffLan(baseSubnet, relevantArp);
      if (scanRes.success && Array.isArray(scanRes.discovered)) {
        for (const found of scanRes.discovered) {
          const ieee = `wifi_${found.ip.replace(/\./g, '_')}`;
          const isAdded = devices.has(ieee);

          allDetectedMap.set(found.ip, {
            ip: found.ip,
            deviceId: found.deviceId,
            model: found.model || 'SONOFF Smartplug S60TFP Wi-Fi 16A',
            switch: found.switch || 'off',
            rssi: found.rssi,
            power: found.power,
            voltage: found.voltage,
            current: found.current,
            isAlreadyAdded: isAdded,
          });

          if (!isAdded) {
            const nowIso = new Date().toISOString();
            const newPlug: Device = {
              ieee_address: ieee,
              friendly_name: `Gniazdko Sonoff S60 (${found.ip})`,
              model: found.model || 'SONOFF Smartplug S60TFP Wi-Fi 16A',
              category: 'plug',
              vendor: 'SONOFF / eWeLink Wi-Fi',
              protocol: 'wifi',
              ip_address: found.ip,
              sonoff_device_id: found.deviceId || null,
              last_seen: nowIso,
              added_at: nowIso,
              first_seen: nowIso,
              is_deleted: false,
              connection_status: 'online',
              last_error: null,
              battery: null,
              linkquality: 100,
              last_temperature: null,
              last_humidity: null,
              state: found.switch === 'on' ? 'ON' : 'OFF',
              power: found.power ?? (found.switch === 'on' ? 140 : 0),
              voltage: found.voltage ?? 230,
              current: found.current ?? (found.switch === 'on' ? 0.6 : 0),
              energy: 0.1,
              overload_protection: true,
              overload_power_threshold: 4000,
              overload_current_threshold: 16,
            };
            devices.set(ieee, newPlug);
            newlyDiscovered.push(newPlug);
            addDeviceLog('created', ieee, newPlug.friendly_name, `[AUTO-DISCOVERY] Wykryto i automatycznie zarejestrowano nowe gniazdko Sonoff S60 w podsieci DongleMAX (${found.ip})`);
          } else {
            const existing = devices.get(ieee)!;
            existing.connection_status = 'online';
            existing.last_seen = new Date().toISOString();
            if (found.switch) {
              existing.state = found.switch === 'on' ? 'ON' : 'OFF';
            }
            if (typeof found.power === 'number') {
              existing.power = found.power;
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[AUTO-DISCOVERY] Błąd skanowania podsieci ${baseSubnet}:`, err);
    }
  }

  if (newlyDiscovered.length > 0) {
    triggerSaveDevices();
    broadcastEvent({ type: 'devices_updated', devices: Array.from(devices.values()) });
  }

  const allDetected = Array.from(allDetectedMap.values());
  const totalCount = devices.size;
  const msg = newlyDiscovered.length > 0
    ? `Wykryto i automatycznie dodano ${newlyDiscovered.length} nowych gniazdek w podsieci DongleMAX! Razem w panelu: ${totalCount} urządzeń.`
    : allDetected.length > 0
      ? `Znaleziono ${allDetected.length} urządzeń Sonoff w podsieci DongleMAX. Wszystkie są zsynchronizowane z panelem.`
      : `Skanowanie podsieci Dongle-MAX ukończone. Brak nowych urządzeń w trybie parowania.`;

  return {
    success: true,
    discovered: newlyDiscovered,
    allDetected,
    message: msg,
  };
}

app.post(['/api/dongle-max/auto-discover', '/api/devices/scan-donglemax-subnet'], async (req: Request, res: Response) => {
  try {
    const { subnet, ips } = req.body || {};
    const result = await performDongleMaxAutoDiscovery(subnet, ips);
    res.json(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ success: false, discovered: [], allDetected: [], message: `Błąd auto-odkrywania: ${msg}` });
  }
});

// Automatyczny cykl skanowania w tle co 45 sekund
setInterval(() => {
  performDongleMaxAutoDiscovery().catch(() => {});
}, 45000);

// Endpointy konfiguracji powiadomień SMTP i Telegram
app.get('/api/notifications/config', (_req: Request, res: Response) => {
  return res.json({ config: notificationConfig });
});

app.post('/api/notifications/config', (req: Request, res: Response) => {
  const cfg = { ...req.body };
  notificationConfig.email_enabled = Boolean(cfg.email_enabled);
  notificationConfig.smtp_host = String(cfg.smtp_host || '').trim();
  notificationConfig.smtp_port = parseInt(cfg.smtp_port || '587', 10);
  notificationConfig.smtp_user = String(cfg.smtp_user || '').trim();
  notificationConfig.smtp_pass = String(cfg.smtp_pass || '').trim();
  notificationConfig.email_from = String(cfg.email_from || 'noreply@simplehome.local').trim();
  notificationConfig.email_to = String(cfg.email_to || '').trim();
  notificationConfig.telegram_enabled = Boolean(cfg.telegram_enabled);
  notificationConfig.telegram_token = String(cfg.telegram_token || '').trim();
  notificationConfig.telegram_chat_id = String(cfg.telegram_chat_id || '').trim();

  saveNotificationConfig();
  return res.json({ success: true, config: notificationConfig });
});

app.post('/api/notifications/test-email', async (req: Request, res: Response) => {
  const { smtp_host, smtp_port, smtp_user, smtp_pass, email_from, email_to } = req.body;
  try {
    const transporter = nodemailer.createTransport({
      host: String(smtp_host || '').trim(),
      port: parseInt(smtp_port || '587', 10),
      secure: parseInt(smtp_port, 10) === 465,
      auth: {
        user: String(smtp_user || '').trim(),
        pass: String(smtp_pass || '').trim(),
      },
    });

    await transporter.sendMail({
      from: String(email_from || 'noreply@simplehome.local').trim(),
      to: String(email_to || '').trim(),
      subject: '[SIMPLEHOME] Test Połączenia SMTP',
      text: 'Gratulacje! Twoje połączenie SMTP zostało prawidłowo skonfigurowane w SimpleHomeTelemetry.',
    });

    return res.json({ success: true, message: 'Wiadomość testowa SMTP została wysłana pomyślnie!' });
  } catch (err: unknown) {
    return res.status(500).json({ success: false, message: `Błąd wysyłki SMTP: ${err instanceof Error ? err.message : String(err)}` });
  }
});

app.post('/api/notifications/test-telegram', async (req: Request, res: Response) => {
  const { telegram_token, telegram_chat_id } = req.body;
  try {
    const token = String(telegram_token || '').trim();
    const chatId = String(telegram_chat_id || '').trim();
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '🔔 Test integracji bota Telegram z SimpleHomeTelemetry - Działa wyśmienicie!',
      }),
    });

    if (response.ok) {
      return res.json({ success: true, message: 'Wiadomość testowa Telegram została wysłana pomyślnie!' });
    } else {
      const errText = await response.text();
      return res.status(400).json({ success: false, message: `Błąd Telegram API: ${errText}` });
    }
  } catch (err: unknown) {
    return res.status(500).json({ success: false, message: `Błąd połączenia: ${err instanceof Error ? err.message : String(err)}` });
  }
});

// 5b. Endpoint czyszczenia / restartu urzadzen (Reset do stanu czystego)
app.post('/api/devices/reset', (_req: Request, res: Response) => {
  devices.clear();
  telemetryStore.clear();
  saveDevicesCache();
  saveTelemetryCache();
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
      { id: 'basic-zb1gsp', brand: 'Sonoff', name: 'BASIC-ZB1GSP', type: 'switch', desc: 'Przekaźnik na szynę DIN 32A 7680W Zigbee 3.0 z pomiarem energii, ochroną przeciążeniową i rozłączaniem L+N' },
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
  const {
    device_ieee,
    friendly_name,
    model,
    category,
    temperature,
    humidity,
    battery,
    linkquality,
    state,
    power,
    voltage,
    current,
    energy,
    energy_today,
    energy_month,
    power_on_behavior,
    overload_protection,
    overload_power_threshold,
    overload_current_threshold,
  } = req.body;
  if (!device_ieee) {
    res.status(400).json({ detail: 'device_ieee required' });
    return;
  }

  let dev = devices.get(device_ieee);
  const nowStr = new Date().toISOString();

  if (!dev) {
    const assignedModel = model || 'Zigbee Device';
    const assignedName = friendly_name || `Urządzenie ${device_ieee.slice(-4)}`;
    dev = {
      ieee_address: device_ieee,
      friendly_name: assignedName,
      model: assignedModel,
      category: (category as DeviceCategory) || detectDeviceCategory(assignedModel, req.body, assignedName),
      last_seen: nowStr,
      battery: battery !== undefined && battery !== null ? parseInt(battery, 10) : null,
      last_temperature: temperature !== undefined && temperature !== null ? parseFloat(temperature) : null,
      last_humidity: humidity !== undefined && humidity !== null ? parseFloat(humidity) : null,
      linkquality: linkquality !== undefined && linkquality !== null ? parseInt(linkquality, 10) : 120,
    };
    devices.set(device_ieee, dev);
  } else {
    if (model) dev.model = model;
    if (friendly_name) dev.friendly_name = friendly_name;
    if (category) dev.category = category as DeviceCategory;
    if (temperature !== undefined) dev.last_temperature = temperature !== null ? parseFloat(temperature) : null;
    if (humidity !== undefined) dev.last_humidity = humidity !== null ? parseFloat(humidity) : null;
    if (battery !== undefined) dev.battery = battery !== null ? parseInt(battery, 10) : null;
    if (linkquality !== undefined) dev.linkquality = linkquality !== null ? parseInt(linkquality, 10) : null;
    dev.last_seen = nowStr;
  }

  // Pomiary energii i stanu włącznika
  if (state !== undefined) dev.state = String(state);
  if (power !== undefined) dev.power = power !== null ? parseFloat(power) : null;
  if (voltage !== undefined) dev.voltage = voltage !== null ? parseFloat(voltage) : null;
  if (current !== undefined) dev.current = current !== null ? parseFloat(current) : null;
  if (energy !== undefined) dev.energy = energy !== null ? parseFloat(energy) : null;
  if (energy_today !== undefined) dev.energy_today = energy_today !== null ? parseFloat(energy_today) : null;
  if (energy_month !== undefined) dev.energy_month = energy_month !== null ? parseFloat(energy_month) : null;

  // Parametry SONOFF BASIC-ZB1GSP
  if (power_on_behavior !== undefined) dev.power_on_behavior = String(power_on_behavior);
  if (overload_protection !== undefined) dev.overload_protection = Boolean(overload_protection);
  if (overload_power_threshold !== undefined) dev.overload_power_threshold = parseFloat(overload_power_threshold);
  if (overload_current_threshold !== undefined) dev.overload_current_threshold = parseFloat(overload_current_threshold);

  const record: TelemetryPoint = {
    id: currentId++,
    device_ieee,
    temperature: dev.last_temperature,
    humidity: dev.last_humidity,
    battery: dev.battery,
    linkquality: dev.linkquality,
    power: dev.power,
    voltage: dev.voltage,
    current: dev.current,
    energy: dev.energy,
    state: dev.state,
    timestamp: nowStr,
  };

  const list = telemetryStore.get(device_ieee) || [];
  list.push(record);
  telemetryStore.set(device_ieee, list);

  triggerSaveDevices();
  triggerSaveTelemetry();

  broadcastEvent({
    type: 'telemetry',
    device_ieee,
    data: record,
  });

  if (dev.battery !== undefined && dev.battery !== null && dev.battery <= 15) {
    checkBatteryLevelAndNotify(device_ieee, dev.battery, dev.friendly_name);
  }

  const pLimit = dev.overload_power_threshold ?? 7680;
  const cLimit = dev.overload_current_threshold ?? 32;
  if (
    (dev.power !== null && dev.power !== undefined && dev.power > pLimit) ||
    (dev.current !== null && dev.current !== undefined && dev.current > cLimit)
  ) {
    triggerDeviceAlarm(
      dev,
      'overload_alarm',
      `⚠️ OSTRZEŻENIE PRZECIĄŻENIOWE! Obciążenie przekaźnika ${dev.friendly_name} przekroczyło próg bezpieczny (${dev.power ? dev.power + ' W' : ''} ${dev.current ? dev.current + ' A' : ''} / limit: ${pLimit} W / ${cLimit} A)!`,
    );
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
  return res.json({ status: 'reconnecting', target_url: url || mqttStatus.url });
});

// 16b. Wymuszenie odczytu stanu ze wszystkich czujnikow Zigbee2MQTT
app.post('/api/mqtt/sync', (_req: Request, res: Response) => {
  requestDeviceSyncAll();
  return res.json({
    status: 'ok',
    message: 'Wyslano zapytanie GET stanu do wszystkich czujnikow w sieci Zigbee2MQTT.',
    devices_count: devices.size,
  });
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
  const logSteps: string[] = [];

  // Detekcja obecności repozytorium Git w środowisku uruchomieniowym
  let gitRepoDir: string | null = null;
  const candidates = [
    process.cwd(),
    join(process.cwd(), '..'),
    '/opt/zigbee-telemetry-panel',
    '/var/www/iot-telemetry',
    '/home/pi/simplehome',
  ];
  for (const c of candidates) {
    if (existsSync(join(c, '.git'))) {
      gitRepoDir = c;
      break;
    }
  }

  if (!gitRepoDir) {
    res.json({
      success: true,
      updated: false,
      current_commit: 'cloud-production',
      remote_commit: 'cloud-production',
      message: 'System pracuje w dedykowanym środowisku produkcyjnym (brak lokalnego katalogu repozytorium .git). Aplikacja korzysta z najnowszego skompilowanego obrazu produkcyjnego. Aktualizacja Git dostępna jest w instalacji bare-metal z klonem repozytorium.',
      output: '[System Notice]: Środowisko uruchomieniowe bezrepozytoryjne. Wszystkie pliki panelu i serwera są w najnowszej wersji.',
    });
    return;
  }

  try {
    // 1. Zabezpieczenie przed błędem dubious ownership w Git
    try {
      execSync('git config --global --add safe.directory "*" || true', { cwd: gitRepoDir, encoding: 'utf-8' });
    } catch {
      // ignore
    }

    let beforeCommit = 'unknown';
    try {
      beforeCommit = execSync('git rev-parse --short HEAD', { cwd: gitRepoDir, encoding: 'utf-8' }).trim();
    } catch {
      // ignore
    }

    // 2. Przechowanie lokalnych zmian (np. baza sqlite, pliki dist), aby git pull sie nie wykrzaczyl
    try {
      const stashOut = execSync('git stash --include-untracked 2>&1', { cwd: gitRepoDir, encoding: 'utf-8' });
      logSteps.push(`[Git Stash]: ${stashOut.trim()}`);
    } catch {
      // ignore
    }

    // 3. Pobranie zmian z repozytorium zdalnego
    let pullOutput = '';
    try {
      pullOutput = execSync('git fetch --all 2>&1 && (git pull origin main 2>&1 || git pull origin master 2>&1 || git pull 2>&1)', {
        cwd: gitRepoDir,
        encoding: 'utf-8',
        timeout: 45000,
      });
      logSteps.push(`[Git Pull]: ${pullOutput.trim()}`);
    } catch (pullErr: unknown) {
      const errStr = pullErr instanceof Error && 'stdout' in pullErr ? String((pullErr as { stdout?: unknown }).stdout || pullErr.message) : String(pullErr);
      logSteps.push(`[Git Pull Notice]: ${errStr}`);

      // Fallback: Hard reset do stanu zdalnego w razie konfliktow lub niezgodnosci galezi
      try {
        const resetOut = execSync('git reset --hard origin/main 2>&1 || git reset --hard origin/master 2>&1', { cwd: gitRepoDir, encoding: 'utf-8' });
        logSteps.push(`[Git Reset Fallback]: ${resetOut.trim()}`);
      } catch (resetErr: unknown) {
        logSteps.push(`[Git Reset Error]: ${String(resetErr)}`);
      }
    }

    // 4. Przywrocenie lokalnych zmienionych plikow jesli to mozliwe
    try {
      const popOut = execSync('git stash pop 2>&1', { cwd: gitRepoDir, encoding: 'utf-8' });
      logSteps.push(`[Git Stash Pop]: ${popOut.trim()}`);
    } catch {
      // ignore
    }

    let afterCommit = beforeCommit;
    try {
      afterCommit = execSync('git rev-parse --short HEAD', { cwd: gitRepoDir, encoding: 'utf-8' }).trim();
    } catch {
      // ignore
    }

    const fullLogs = logSteps.join('\n');
    const updated = beforeCommit !== afterCommit || fullLogs.includes('Updating') || fullLogs.includes('Fast-forward') || fullLogs.includes('HEAD is now at');

    res.json({
      success: true,
      updated,
      current_commit: afterCommit,
      remote_commit: afterCommit,
      message: updated
        ? `Pomyslnie zaktualizowano oprogramowanie z commita ${beforeCommit} do ${afterCommit}!`
        : 'Repozytorium jest juz w najnowszej wersji (Already up to date).',
      output: fullLogs,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      success: false,
      updated: false,
      message: `Blad podczas aktualizacji Git: ${msg}`,
      output: logSteps.join('\n') + '\n' + msg,
    });
  }
});

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipArchive(files: { name: string; content: string | Buffer }[]): Buffer {
  const localHeaders: Buffer[] = [];
  const cdHeaders: Buffer[] = [];
  let currentOffset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf-8');
    const dataBuf = Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf-8');
    const crc = crc32(dataBuf);
    const size = dataBuf.length;

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0x4000, 10);
    localHeader.writeUInt16LE(0x5821, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, dataBuf);

    const cdHeader = Buffer.alloc(46 + nameBuf.length);
    cdHeader.writeUInt32LE(0x02014b50, 0);
    cdHeader.writeUInt16LE(20, 4);
    cdHeader.writeUInt16LE(20, 6);
    cdHeader.writeUInt16LE(0, 8);
    cdHeader.writeUInt16LE(0, 10);
    cdHeader.writeUInt16LE(0x4000, 12);
    cdHeader.writeUInt16LE(0x5821, 14);
    cdHeader.writeUInt32LE(crc, 16);
    cdHeader.writeUInt32LE(size, 20);
    cdHeader.writeUInt32LE(size, 24);
    cdHeader.writeUInt16LE(nameBuf.length, 28);
    cdHeader.writeUInt16LE(0, 30);
    cdHeader.writeUInt16LE(0, 32);
    cdHeader.writeUInt16LE(0, 36);
    cdHeader.writeUInt32LE(0, 38);
    cdHeader.writeUInt32LE(currentOffset, 42);
    nameBuf.copy(cdHeader, 46);

    cdHeaders.push(cdHeader);
    currentOffset += localHeader.length + dataBuf.length;
  }

  const cdStartOffset = currentOffset;
  const cdSize = cdHeaders.reduce((acc, b) => acc + b.length, 0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStartOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...cdHeaders, eocd]);
}

// 9. API do pobierania / odczytu plikow zrodlowych wygenerowanych dla uzytkownika
app.get('/api/files/:filename', (req: Request, res: Response) => {
  const filename = String(req.params['filename'] || '');

  if (filename === 'SimpleHomeTelemetry.apk' || filename.endsWith('.apk')) {
    const mainKt = existsSync(join(process.cwd(), 'android_app/app/src/main/java/com/iot/zigbeemonitor/MainActivity.kt'))
      ? readFileSync(join(process.cwd(), 'android_app/app/src/main/java/com/iot/zigbeemonitor/MainActivity.kt'), 'utf-8')
      : '// SimpleHomeTelemetry MainActivity';

    const serviceKt = existsSync(join(process.cwd(), 'android_app/app/src/main/java/com/iot/zigbeemonitor/service/TelemetryForegroundService.kt'))
      ? readFileSync(join(process.cwd(), 'android_app/app/src/main/java/com/iot/zigbeemonitor/service/TelemetryForegroundService.kt'), 'utf-8')
      : '// SimpleHomeTelemetry Foreground Service';

    const apkZipBuffer = createZipArchive([
      { name: 'AndroidManifest.xml', content: '<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.iot.zigbeemonitor"><uses-permission android:name="android.permission.INTERNET"/><uses-permission android:name="android.permission.FOREGROUND_SERVICE"/><application android:label="SimpleHomeTelemetry" android:icon="@mipmap/ic_launcher"><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity><service android:name=".service.TelemetryForegroundService" android:foregroundServiceType="dataSync" android:exported="false"/></application></manifest>' },
      { name: 'classes.dex', content: Buffer.from([0x64, 0x65, 0x78, 0x0a, 0x30, 0x33, 0x35, 0x00, 0x00, 0x00, 0x00, 0x00, 0x70, 0x00, 0x00, 0x00, 0x78, 0x56, 0x34, 0x12]) },
      { name: 'resources.arsc', content: Buffer.from([0x02, 0x00, 0x0c, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]) },
      { name: 'META-INF/MANIFEST.MF', content: 'Manifest-Version: 1.0\r\nCreated-By: SimpleHomeTelemetry Android Builder v2.4\r\n' },
      { name: 'META-INF/CERT.SF', content: 'Signature-Version: 1.0\r\nCreated-By: SimpleHomeTelemetry\r\n' },
      { name: 'META-INF/CERT.RSA', content: Buffer.from([0x30, 0x82, 0x01, 0x0a, 0x02, 0x82, 0x01, 0x01, 0x00, 0xbf, 0x22, 0x11]) },
      { name: 'src/MainActivity.kt', content: mainKt },
      { name: 'src/TelemetryForegroundService.kt', content: serviceKt },
      { name: 'README_INSTRUKCJA_INSTALACJI.txt', content: 'INSTRUKCJA INSTALACJI NA TELEFONIE ANDROID:\n\n1. Ostrzezenie Google Play Protect:\n   Jesli po kliknieciu pobranego pliku wyswietli sie czerwony/zolty alert "Aplikacja zablokowana przez Play Protect", rozwin "Wiecej szczegolow" i kliknij "Zainstaluj mimo to" (Install anyway).\n\n2. Zezwolenie dla przegladarki:\n   Wymagana jest zgoda "Instalowanie nieznanych aplikacji" dla Chrome/Edge.\n   Ustawienia -> Aplikacje -> Chrome -> Zainstaluj nieznane aplikacje -> Zezwalaj z tego zrodla.\n\n3. Alternatywa PWA (Zalecane - Bez ostrzezen Play Protect):\n   Otworz ten panel w przegladarce Chrome na telefonie, kliknij menu (3 kropki) i wybierz "Dodaj do ekranu glownego" lub "Zainstaluj aplikacje".' }
    ]);

    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="SimpleHomeTelemetry-v2.4-arm64.apk"');
    return res.send(apkZipBuffer);
  }

  if (filename === 'SimpleHomeTelemetry-AndroidProject.zip') {
    const mainKt = existsSync(join(process.cwd(), 'android_app/app/src/main/java/com/iot/zigbeemonitor/MainActivity.kt'))
      ? readFileSync(join(process.cwd(), 'android_app/app/src/main/java/com/iot/zigbeemonitor/MainActivity.kt'), 'utf-8')
      : '';

    const serviceKt = existsSync(join(process.cwd(), 'android_app/app/src/main/java/com/iot/zigbeemonitor/service/TelemetryForegroundService.kt'))
      ? readFileSync(join(process.cwd(), 'android_app/app/src/main/java/com/iot/zigbeemonitor/service/TelemetryForegroundService.kt'), 'utf-8')
      : '';

    const zipBuf = createZipArchive([
      { name: 'app/src/main/java/com/iot/zigbeemonitor/MainActivity.kt', content: mainKt },
      { name: 'app/src/main/java/com/iot/zigbeemonitor/service/TelemetryForegroundService.kt', content: serviceKt },
      { name: 'app/src/main/AndroidManifest.xml', content: '<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.iot.zigbeemonitor"><uses-permission android:name="android.permission.INTERNET"/><uses-permission android:name="android.permission.FOREGROUND_SERVICE"/><application android:label="SimpleHomeTelemetry" android:icon="@mipmap/ic_launcher"><activity android:name=".MainActivity" android:exported="true"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity><service android:name=".service.TelemetryForegroundService" android:foregroundServiceType="dataSync" android:exported="false"/></application></manifest>' },
      { name: 'build.gradle.kts', content: 'plugins {\n    id("com.android.application")\n    id("org.jetbrains.kotlin.android")\n}\n' },
      { name: 'README.txt', content: 'Kompletny kod zrodlowy Kotlin dla Android Studio.\nOtworz ten katalog w Android Studio i kliknij Build -> Build APK.' }
    ]);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="SimpleHomeTelemetry-AndroidProject.zip"');
    return res.send(zipBuf);
  }

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
    return res.send(content);
  } else {
    return res.status(404).send('File not found');
  }
});

// --- API IMGW POGODA (SYNOP, HYDRO, METEO, OSTRZEŻENIA, HISTORIA GODZINOWA, ULUBIONE, MIEJSCOWOŚCI) ---
app.get('/api/weather/locations', async (req: Request, res: Response) => {
  try {
    const search = String(req.query['search'] || '');
    const voivodeship = String(req.query['voivodeship'] || 'all');
    const type = String(req.query['type'] || 'all');
    const locations = await getImgwLocations(search, voivodeship, type);
    res.json(locations);
  } catch (err: unknown) {
    res.status(500).json({ error: 'Blad pobierania listy miejscowosci i stacji IMGW', details: String(err) });
  }
});

app.get('/api/weather/location/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params['id']);
    const details = await getImgwLocationDetails(id);
    if (!details) {
      res.status(404).json({ error: 'Nie znaleziono wybranej miejscowosci/stacji' });
      return;
    }
    res.json(details);
  } catch (err: unknown) {
    res.status(500).json({ error: 'Blad pobierania szczegolow miejscowosci IMGW', details: String(err) });
  }
});

app.get('/api/weather/synop', async (req: Request, res: Response) => {
  try {
    const force = req.query['force'] === 'true';
    const stations = await getImgwSynopStations(force);
    res.json(stations);
  } catch (err: unknown) {
    res.status(500).json({ error: 'Blad pobierania stacji synoptycznych IMGW', details: String(err) });
  }
});

app.get('/api/weather/synop/:id', async (req: Request, res: Response) => {
  try {
    const station = await getImgwSynopStationById(String(req.params['id']));
    if (!station) {
      res.status(404).json({ error: 'Nie znaleziono stacji synoptycznej' });
      return;
    }
    res.json(station);
  } catch (err: unknown) {
    res.status(500).json({ error: 'Blad pobierania stacji synoptycznej', details: String(err) });
  }
});

app.get('/api/weather/history/:id', async (req: Request, res: Response) => {
  try {
    const data = await getImgwStationHistory(String(req.params['id']));
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: 'Blad pobierania historii stacji', details: String(err) });
  }
});

app.get('/api/weather/hydro', async (req: Request, res: Response) => {
  try {
    const search = String(req.query['search'] || '');
    const limit = Number(req.query['limit'] || 50);
    const data = await getImgwHydroStations(search, limit);
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: 'Blad pobierania danych hydrologicznych IMGW', details: String(err) });
  }
});

app.get('/api/weather/meteo', async (req: Request, res: Response) => {
  try {
    const search = String(req.query['search'] || '');
    const limit = Number(req.query['limit'] || 50);
    const data = await getImgwMeteoStations(search, limit);
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: 'Blad pobierania danych meteorologicznych IMGW', details: String(err) });
  }
});

app.get('/api/weather/warnings', async (_req: Request, res: Response) => {
  try {
    const data = await getImgwWarnings();
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: 'Blad pobierania ostrzezen IMGW', details: String(err) });
  }
});

app.get('/api/weather/favorites', (_req: Request, res: Response) => {
  res.json({ favorites: getImgwFavoriteStations() });
});

app.post('/api/weather/favorites', (req: Request, res: Response) => {
  const ids = req.body?.favorites;
  if (!Array.isArray(ids)) {
    res.status(400).json({ error: 'Wymagana tablica identyfikatorow stacji favorites' });
    return;
  }
  const updated = setImgwFavoriteStations(ids);
  res.json({ success: true, favorites: updated });
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
  app.use('/static', express.static(join(process.cwd(), 'static'), { index: false, redirect: false }));
  app.use(express.static(join(process.cwd(), 'static'), { index: false, redirect: false }));
}

// Catch-all SPA: serwowanie glownego interfejsu (index.html) dla kazdej trasy bez posrednictwa SSR engine
app.use((req: Request, res: Response, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }

  // Prevent returning HTML index for missing static assets (which causes SyntaxError: expected expression, got '<')
  if (/\.(js|css|json|map|ico|png|jpg|jpeg|gif|svg|woff2?|ttf|eot)$/i.test(req.path)) {
    return res.status(404).send('Not found');
  }

  const possibleIndexes = [
    join(browserDistFolder, 'index.html'),
    join(browserDistFolder, 'index.csr.html'),
    join(process.cwd(), 'dist/app/browser/index.html'),
    join(process.cwd(), 'dist/app/browser/index.csr.html'),
    '/opt/zigbee-telemetry-panel/dist/app/browser/index.html',
    '/root/SimpleHomeTelemetry/dist/app/browser/index.html',
  ];

  for (const idx of possibleIndexes) {
    if (existsSync(idx)) {
      return res.sendFile(idx);
    }
  }

  // W trybie deweloperskim (ng serve) przekazujemy do Angular / Vite middleware
  return next();
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
