export type DeviceCategory = 'climate' | 'fan' | 'plug' | 'switch' | 'sensor' | 'contact' | 'occupancy' | 'water_leak';

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

  // Wentylator kolumnowy Tuya / Gotze & Jensen GOW 007 7w1 (WiFi / Tuya)
  fan_speed?: number | string | null;       // 1 - 12 (biegi nawiewu)
  fan_mode?: 'normal' | 'natural' | 'sleep' | 'auto' | string | null;
  fan_oscillation?: boolean | null;         // Oscylacja pozioma / obrót
  fan_timer?: number | null;                // Timer wyłączenia (h)
  fan_ionizer?: boolean | null;             // Jonizacja powietrza (7w1)
  fan_humidifier?: boolean | null;          // Nawilżacz ultradźwiękowy (7w1)
  fan_uv?: boolean | null;                  // Lampa UV sterylizująca (7w1)

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
  local_temperature_calibration?: number | null;
  frost_protection_temperature?: number | null;
  temperature_sensor?: string | null;
  external_temperature?: number | null;
  valve_opening_degree?: number | null;
  temperature_accuracy?: number | null;
  smart_temperature_control?: boolean | null;

  // Dodatkowe opcje TRVZB zgloszone przez uzytkownika
  timer_mode_target_temp?: number | null;
  temporary_mode_duration?: number | null;
  temporary_mode?: 'none' | 'boost' | 'timer' | string | null;
  valve_closing_degree?: number | null;
  idle_steps?: number | null;
  closing_steps?: number | null;
  valve_opening_limit_voltage?: number | null;
  valve_closing_limit_voltage?: number | null;
  valve_motor_running_voltage?: number | null;
  
  // Harmonogramy tygodniowe
  weekly_schedule_sunday?: string | null;
  weekly_schedule_monday?: string | null;
  weekly_schedule_tuesday?: string | null;
  weekly_schedule_wednesday?: string | null;
  weekly_schedule_thursday?: string | null;
  weekly_schedule_friday?: string | null;
  weekly_schedule_saturday?: string | null;

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

  // Alarmy lokalne z poziomu przeglądarki i powiadomienia
  temp_alarm_enabled?: boolean | null;
  temp_alarm_min?: number | null;
  temp_alarm_max?: number | null;
  motion_alarm_enabled?: boolean | null;
  contact_alarm_enabled?: boolean | null;
  water_alarm_enabled?: boolean | null;
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
  // SoftAP Mode (Dongle-M tworzy własną sieć Wi-Fi Access Point dla urządzeń IoT)
  wifi_softap_mode?: boolean;
  wifi_softap_ssid?: string;
  wifi_softap_password?: string;
  wifi_softap_channel?: number;
  wifi_softap_ip?: string;
  wifi_softap_dhcp_start?: string;
  wifi_softap_dhcp_end?: string;
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

export interface ServiceInspectionResult {
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
}

export interface ServicesInspectionReport {
  timestamp: string;
  overall_status: 'ok' | 'needs_attention' | 'missing';
  services: ServiceInspectionResult[];
  environment: {
    node_version: string;
    os_info?: string;
    current_dir: string;
  };
}

export interface GitUpdateResult {
  success: boolean;
  message: string;
  current_commit?: string;
  remote_commit?: string;
  updated: boolean;
  output: string;
}

export interface WifiPairingRequest {
  ssid: string;
  password?: string;
  duration?: number;
}

export interface WifiPairingStatus {
  active: boolean;
  duration: number;
  remaining_seconds: number;
  ssid: string;
  local_ip: string;
  broadcast_ip: string;
  discovered_devices: {
    ip: string;
    mac?: string;
    model: string;
    name: string;
  }[];
}

export interface TuyaFanConfig {
  device_id: string;
  local_key?: string;
  ip_address: string;
  protocol_version: '3.3' | '3.4' | '3.5';
}

export type LogicQuantifier = 'IF' | 'IF_NOT' | 'AND' | 'OR';
export type TriggerMetric = 'temperature' | 'humidity' | 'battery' | 'contact' | 'occupancy' | 'time' | 'manual';
export type MetricOperator = '>' | '<' | '==' | '!=' | '<=';

export interface SceneCondition {
  quantifier: LogicQuantifier;
  device_ieee?: string;
  metric: TriggerMetric;
  operator: MetricOperator;
  value: number | string | boolean;
  description: string;
}

export interface SceneAction {
  step_number: number;
  type: 'device_command' | 'notification' | 'delay';
  target_ieee?: string;
  target_name?: string;
  command?: Record<string, unknown>;
  delay_seconds?: number;
  notification_message?: string;
  description: string;
}

export interface AutomationScene {
  id: string;
  name: string;
  description: string;
  icon: string;
  enabled: boolean;
  conditions: SceneCondition[];
  actions: SceneAction[];
  last_triggered_at?: string | null;
  trigger_count: number;
}
