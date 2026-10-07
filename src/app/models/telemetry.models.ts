export type DeviceCategory = 'climate' | 'plug' | 'switch' | 'sensor' | 'contact' | 'occupancy' | 'water_leak';

export interface Device {
  ieee_address: string;
  friendly_name: string;
  model: string;
  category?: DeviceCategory;
  vendor?: string;
  last_seen: string | null;
  battery: number | null;
  linkquality: number | null;
  isRecentlyUpdated?: boolean;

  // Czujniki temperatury i wilgotności (Sonoff SNZB-02 / SNZB-02D / Tuya TS0201)
  last_temperature: number | null;
  last_humidity: number | null;

  // Głowice termostatyczne Sonoff TRVZB / TRVZB Gen 2 & Tuya TRV
  current_heating_setpoint?: number | null;
  local_temperature?: number | null;
  system_mode?: 'heat' | 'auto' | 'off' | string | null;
  running_state?: 'heat' | 'idle' | string | null;
  child_lock?: 'LOCK' | 'UNLOCK' | string | null;
  open_window?: boolean | null;

  // Włączniki i inteligentne gniazdka (Sonoff S26R2ZB, S40ZB, ZBMINIR2, Tuya Smart Plug)
  state?: 'ON' | 'OFF' | string | null;
  power?: number | null;      // W (Moc chwilowa)
  voltage?: number | null;    // V (Napięcie)
  current?: number | null;    // A (Natężenie)
  energy?: number | null;     // kWh (Łączne zużycie energii)

  // Czujniki kontaktronowe, ruchu, zalania (Sonoff SNZB-03/04/05, Tuya mmWave)
  contact?: boolean | null;       // true = zamknięte, false = otwarte
  occupancy?: boolean | null;     // true = ruch/obecność wykryta
  water_leak?: boolean | null;    // true = alarm zalania
  illuminance?: number | null;    // lux
}

export interface TelemetryPoint {
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

export interface DeviceCatalogItem {
  id: string;
  brand: 'Sonoff' | 'Tuya';
  model: string;
  name: string;
  category: DeviceCategory;
  description: string;
  features: string[];
  batteryPowered: boolean;
  pairingGuide: string;
}

export interface HistoryStats {
  count?: number;
  min_temp?: number;
  max_temp?: number;
  avg_temp?: number;
  min_hum?: number;
  max_hum?: number;
  avg_hum?: number;
}

export interface HistoryResponse {
  device_ieee: string;
  range: string;
  count: number;
  stats?: HistoryStats;
  history: TelemetryPoint[];
}

export interface SystemNotification {
  id: number;
  device_ieee: string;
  device_name: string;
  type: string;
  level: 'warning' | 'critical' | 'info';
  message: string;
  battery?: number;
  timestamp: string;
  acknowledged: boolean;
}

export interface SystemStatus {
  status: string;
  coordinator: string;
  chip: string;
  baudrate: number;
  firmware: string;
  active_devices: number;
  permit_join_active: boolean;
  permit_join_remaining: number;
  timestamp: string;
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

export interface DongleMaxTestResult {
  success: boolean;
  host: string;
  port: number;
  latency_ms?: number;
  message: string;
  tested_at: string;
  operating_mode: 'coordinator' | 'router';
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

export interface MqttStatusResponse {
  mqtt: MqttStatus;
  bridge: {
    state: string;
    devices_count: number;
    coordinator_topic: string;
  };
  service_instructions: {
    systemd_mosquitto: string;
    systemd_zigbee2mqtt: string;
    restart_command: string;
  };
}
