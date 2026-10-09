/**
 * Moduł menedżera TinyTuya dla backendu Express / Node.js
 * Zarządza lokalną komunikacją Wi-Fi z urządzeniami Tuya w sieci domowej:
 * - Gniazdka (Smart Plug 16A)
 * - Wentylatory (np. GÖTZE & JENSEN GOW 007 7w1)
 * - Czujki dymu (Smoke Detectors / sensory pożarowe)
 * - Przełączniki, czujniki zalania, termostaty
 */

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export interface TinyTuyaCommandOptions {
  ip: string;
  local_key: string;
  dev_id: string;
  version?: string | number;
  category?: string;
  command?: Record<string, unknown>;
  dps?: Record<string, unknown>;
}

export interface TinyTuyaResult {
  success: boolean;
  message?: string;
  error?: string;
  sent_dps?: Record<string, unknown>;
  raw_dps?: Record<string, unknown>;
  device_data?: {
    state?: 'ON' | 'OFF';
    current?: number;
    current_ma?: number;
    power?: number;
    voltage?: number;
    fan_speed?: number;
    fan_mode?: string;
    fan_oscillation?: boolean;
    fan_timer?: number;
    fan_ionizer?: boolean;
    fan_humidifier?: boolean;
    fan_uv?: boolean;
    smoke_alarm?: boolean;
    smoke_status?: 'normal' | 'alarm' | 'silence';
    battery?: number;
    tamper_alarm?: boolean;
    raw_dps?: Record<string, unknown>;
  };
  raw_response?: unknown;
}

export interface TinyTuyaDiscoveredDevice {
  id: string;
  ip: string;
  version: string;
  product_key?: string;
}

export interface TinyTuyaScanResult {
  success: boolean;
  discovered_count: number;
  devices: TinyTuyaDiscoveredDevice[];
  message: string;
  error?: string;
}

const scriptPath = join(process.cwd(), 'scripts', 'tinytuya_bridge.py');

/**
 * Bezpieczne wywołanie skryptu Python tinytuya_bridge.py
 */
function runBridgeScript(payload: Record<string, unknown>, timeoutMs = 4500): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!existsSync(scriptPath)) {
      reject(new Error(`Nie odnaleziono skryptu pomocniczego TinyTuya: ${scriptPath}`));
      return;
    }

    const child = execFile(
      'python3',
      [scriptPath],
      {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          if (error.killed) {
            reject(new Error('Przekroczono limit czasu połączenia TinyTuya (timeout)'));
            return;
          }
          // Jeśli skrypt zwrócił stdout z błędem w formacie JSON
          if (stdout && stdout.trim().startsWith('{')) {
            resolve(stdout.trim());
            return;
          }
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout.trim());
      },
    );

    // Przekazanie danych bezpiecznie przez stdin, aby uniknąć problemów z powłoką shell
    if (child.stdin) {
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    }
  });
}

/**
 * Walidacja adresu IP
 */
export function isValidIp(ip: string): boolean {
  if (!ip) return false;
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    const n = Number(p);
    return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
  });
}

/**
 * Walidacja klucza Local Key (dokładnie 16 znaków alfanumerycznych/hex)
 */
export function isValidLocalKey(key: string): boolean {
  if (!key) return false;
  const clean = key.trim();
  return clean.length === 16 && /^[a-zA-Z0-9]+$/.test(clean);
}

/**
 * Wykonanie polecenia sterującego przez TinyTuya (zapis DPS)
 */
export async function executeTinyTuyaCommand(
  opts: TinyTuyaCommandOptions,
): Promise<TinyTuyaResult> {
  const ip = String(opts.ip || '').trim();
  const localKey = String(opts.local_key || '').trim();
  const devId = String(opts.dev_id || '').trim();

  if (!isValidIp(ip)) {
    return {
      success: false,
      error: `Niepoprawny format adresu IP urządzenia: "${ip}"`,
    };
  }
  if (!isValidLocalKey(localKey)) {
    return {
      success: false,
      error: 'Local Key musi mieć dokładnie 16 znaków alfanumerycznych (np. a1b2c3d4e5f6g7h8)',
    };
  }
  if (!devId) {
    return {
      success: false,
      error: 'Wymagane jest podanie Device ID urządzenia Tuya',
    };
  }

  const payload = {
    action: 'command',
    ip,
    local_key: localKey,
    dev_id: devId,
    version: opts.version || '3.3',
    category: opts.category || '',
    command: opts.command || {},
    dps: opts.dps,
  };

  try {
    const rawOutput = await runBridgeScript(payload, 4500);
    const parsed = JSON.parse(rawOutput) as TinyTuyaResult;
    return parsed;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Odczyt bieżącego stanu i telemetrii przez TinyTuya (odczyt statusu DPS)
 */
export async function getTinyTuyaStatus(
  opts: Omit<TinyTuyaCommandOptions, 'command' | 'dps'>,
): Promise<TinyTuyaResult> {
  const ip = String(opts.ip || '').trim();
  const localKey = String(opts.local_key || '').trim();
  const devId = String(opts.dev_id || '').trim();

  if (!isValidIp(ip)) {
    return { success: false, error: `Niepoprawny adres IP: ${ip}` };
  }
  if (!isValidLocalKey(localKey)) {
    return { success: false, error: 'Local Key musi mieć 16 znaków alfanumerycznych' };
  }
  if (!devId) {
    return { success: false, error: 'Brak Device ID' };
  }

  const payload = {
    action: 'status',
    ip,
    local_key: localKey,
    dev_id: devId,
    version: opts.version || '3.3',
    category: opts.category || '',
  };

  try {
    const rawOutput = await runBridgeScript(payload, 4000);
    const parsed = JSON.parse(rawOutput) as TinyTuyaResult;
    return parsed;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Szybki test połączenia i walidacji klucza Local Key w sieci LAN
 */
export async function testTinyTuyaConnection(
  ip: string,
  localKey: string,
  devId: string,
  version = '3.3',
): Promise<{ success: boolean; message: string; dps?: Record<string, unknown> }> {
  const cleanIp = String(ip || '').trim();
  const cleanKey = String(localKey || '').trim();
  const cleanId = String(devId || '').trim();

  if (!isValidIp(cleanIp)) {
    return { success: false, message: `Niepoprawny adres IP: "${cleanIp}"` };
  }
  if (!isValidLocalKey(cleanKey)) {
    return {
      success: false,
      message: 'Klucz Local Key musi mieć dokładnie 16 znaków (np. 16 liter/cyfr wyciągniętych z Tuya).',
    };
  }
  if (!cleanId) {
    return { success: false, message: 'Podaj Device ID (identyfikator urządzenia Tuya).' };
  }

  const payload = {
    action: 'test',
    ip: cleanIp,
    local_key: cleanKey,
    dev_id: cleanId,
    version,
  };

  try {
    const rawOutput = await runBridgeScript(payload, 3500);
    const parsed = JSON.parse(rawOutput);
    if (parsed.success) {
      return {
        success: true,
        message: parsed.message || 'Połączenie TinyTuya nawiązane pomyślnie!',
        dps: parsed.dps,
      };
    }
    return {
      success: false,
      message: parsed.error || 'Nie udało się nawiązać połączenia z urządzeniem.',
    };
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Skanowanie sieci LAN w poszukiwaniu rozgłaszających się urządzeń Tuya
 */
export async function scanTinyTuyaLan(): Promise<TinyTuyaScanResult> {
  try {
    const rawOutput = await runBridgeScript({ action: 'scan' }, 4000);
    const parsed = JSON.parse(rawOutput) as TinyTuyaScanResult;
    return parsed;
  } catch (err) {
    return {
      success: false,
      discovered_count: 0,
      devices: [],
      message: 'Błąd podczas skanowania sieci przez TinyTuya',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
