/** Typy panelu falownika (wspólne dla serwera i przeglądarki). */

/** Bieżący odczyt falownika. Moce w W, energia w kWh, napięcia w V, temperatury w °C. */
export interface InverterLive {
  timestamp: string;
  /** Data i godzina wg zegara falownika (liczniki dzienne zerują się o jego północy). */
  inverter_time: string | null;
  status: number;
  status_label: string;

  pv_power: number;
  pv1_power: number;
  pv2_power: number;
  pv1_voltage: number;
  pv1_current: number;
  pv2_voltage: number;
  pv2_current: number;

  battery_soc: number;
  /** + rozładowanie, − ładowanie */
  battery_power: number;
  battery_voltage: number;
  battery_current: number;
  battery_temp: number;

  /** + pobór z sieci, − oddawanie (przekładnik CT) */
  grid_power: number;
  grid_l1_power: number;
  grid_l2_power: number;
  grid_l3_power: number;
  grid_l1_voltage: number;
  grid_l2_voltage: number;
  grid_l3_voltage: number;
  grid_frequency: number;

  load_power: number;
  load_l1_power: number;
  load_l2_power: number;
  load_l3_power: number;

  inverter_power: number;
  radiator_temp: number;
  dc_temp: number;

  today: InverterEnergy;
  total: InverterEnergy;
}

export interface InverterEnergy {
  pv: number;
  load: number;
  grid_import: number;
  grid_export: number;
  battery_charge: number;
  battery_discharge: number;
}

export interface InverterDaily extends InverterEnergy {
  day: string;
}

export interface TouSlot {
  /** "HH:MM" — początek przedziału (trwa do początku następnego). */
  start: string;
  /** Maksymalna moc z baterii w przedziale, W. */
  power: number;
  /** Minimalny SOC baterii w przedziale, %. */
  soc: number;
  /** Ładowanie baterii z sieci do tego SOC. */
  grid_charge: boolean;
}

/** Ustawienia falownika, którymi panel steruje. */
export interface InverterSettings {
  work_mode: number;
  max_sell_power: number;
  solar_sell: boolean;
  battery_max_charge_current: number;
  battery_max_discharge_current: number;
  grid_charge_current: number;
  grid_charge_enabled: boolean;
  tou_enabled: boolean;
  tou: TouSlot[];
}

export interface InverterInfo {
  serial: string;
  rated_power: number;
  battery_capacity_ah: number;
  battery_shutdown_soc: number;
  battery_restart_soc: number;
  battery_low_soc: number;
}

export interface InverterConfig {
  enabled: boolean;
  /** Ostatni znany adres loggera (DHCP — panel szuka go sam, gdy przestanie odpowiadać). */
  host: string;
  port: number;
  logger_serial: string;
  slave: number;
  poll_seconds: number;
  /** Sterowanie (zapis ustawień) jest domyślnie wyłączone. */
  control_enabled: boolean;
}

export interface InverterStatus {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  host: string;
  port: number;
  last_ok: string | null;
  last_error: string | null;
  discovering: boolean;
  last_discovery: string | null;
  last_discovery_result: string | null;
  control_enabled: boolean;
}

export interface InverterHistoryPoint {
  timestamp: string;
  pv_power: number | null;
  load_power: number | null;
  grid_power: number | null;
  battery_power: number | null;
  battery_soc: number | null;
  battery_temp: number | null;
  radiator_temp: number | null;
  grid_l1_voltage: number | null;
  grid_l2_voltage: number | null;
  grid_l3_voltage: number | null;
}
