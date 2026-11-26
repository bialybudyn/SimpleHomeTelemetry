import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Konfiguracja serwera z ustawień środowiskowych (systemd: /etc/simplehome/panel.env).
 * Wszystkie dane uruchomieniowe (baza, cache pogody) trafiają do DATA_DIR, a nie do katalogu z kodem.
 */
export const config = {
  port: Number(process.env['PORT']) || 3000,
  host: process.env['HOST'] || '0.0.0.0',
  dataDir: resolve(process.env['DATA_DIR'] || join(process.cwd(), 'data')),
  mqttUrl: process.env['MQTT_URL'] || 'mqtt://127.0.0.1:1883',
  mqttUser: process.env['MQTT_USER'] || undefined,
  mqttPassword: process.env['MQTT_PASSWORD'] || undefined,
  mqttTopic: process.env['MQTT_TOPIC'] || 'zigbee2mqtt',
  /** Hasło do panelu (HTTP Basic). Puste = brak logowania (niezalecane poza siecią domową). */
  panelUser: process.env['PANEL_USER'] || 'admin',
  panelPassword: process.env['PANEL_PASSWORD'] || '',
  /** Certyfikat i klucz TLS (PEM). Ustawione = panel działa po HTTPS, a HTTP tylko przekierowuje. */
  tlsCert: process.env['TLS_CERT'] || undefined,
  tlsKey: process.env['TLS_KEY'] || undefined,
  /** Ile dni trzymać surowe próbki telemetrii (agregaty godzinowe są trzymane dłużej). */
  rawRetentionDays: Number(process.env['RAW_RETENTION_DAYS']) || 30,
  hourlyRetentionDays: Number(process.env['HOURLY_RETENTION_DAYS']) || 730,
  /** Ile dni trzymać historię falownika (próbki co 5 min i liczniki dzienne). */
  inverterRetentionDays: Number(process.env['INVERTER_RETENTION_DAYS']) || 366,
  /** Program do odbioru strumieni RTSP kamer (podgląd na żywo, bez nagrywania). */
  ffmpegPath: process.env['FFMPEG_PATH'] || 'ffmpeg',
  /** Wyłącza sterowniki — przydatne w buildzie i testach. */
  disableDrivers: process.env['DISABLE_DRIVERS'] === '1',
};

export function ensureDataDir(): string {
  mkdirSync(config.dataDir, { recursive: true });
  return config.dataDir;
}

export function dataPath(file: string): string {
  return join(ensureDataDir(), file);
}
