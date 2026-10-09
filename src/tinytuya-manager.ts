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
  gateway_ip?: string;
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
function runBridgeScript(payload: Record<string, unknown>, timeoutMs = 12000): Promise<string> {
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
 * Sprawdza czy adres IP należy do lokalnej podsieci prywatnej (LAN: 192.168.x.x, 10.x.x.x, 172.16-31.x.x)
 */
export function isPrivateIp(ip: string): boolean {
  if (!ip) return false;
  const parts = ip.trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 127) return true;
  return false;
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
 * Walidacja klucza Local Key (dokładnie 16 znaków ASCII, w tym litery, cyfry oraz znaki specjalne jak np. ` ) / itp.)
 */
export function isValidLocalKey(key: string): boolean {
  if (!key) return false;
  const clean = key.trim();
  // Klucze Tuya składają się z dokładnie 16 znaków ASCII (dowolne znaki drukowalne ASCII od 0x20 do 0x7E)
  return clean.length === 16 && /^[\x20-\x7E]{16}$/.test(clean);
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
      error: 'Local Key musi mieć dokładnie 16 znaków ASCII (np. z chmury Tuya lub localtuya)',
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
    gateway_ip: opts.gateway_ip || '',
  };

  try {
    const rawOutput = await runBridgeScript(payload, 10000);
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
    return { success: false, error: 'Local Key musi mieć dokładnie 16 znaków ASCII' };
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
    gateway_ip: opts.gateway_ip || '',
  };

  try {
    const rawOutput = await runBridgeScript(payload, 10000);
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
  gatewayIp = '',
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
      message: 'Klucz Local Key musi mieć dokładnie 16 znaków ASCII (np. z chmury Tuya lub biblioteki localtuya).',
    };
  }
  if (!cleanId) {
    return { success: false, message: 'Podaj Device ID (identyfikator urządzenia Tuya).' };
  }

  // Wskazówka dla użytkownika gdy podano publiczny adres WAN zamiast lokalnego IP w sieci LAN
  if (!isPrivateIp(cleanIp)) {
    console.warn(`[TINYTUYA] Podany adres ${cleanIp} to publiczny adres IP (WAN). Protokół LAN wymaga adresu lokalnego.`);
  }

  const payload = {
    action: 'test',
    ip: cleanIp,
    local_key: cleanKey,
    dev_id: cleanId,
    version,
    gateway_ip: String(gatewayIp || '').trim(),
  };

  try {
    const rawOutput = await runBridgeScript(payload, 10000);
    const parsed = JSON.parse(rawOutput);
    if (parsed.success) {
      return {
        success: true,
        message: parsed.message || 'Połączenie TinyTuya nawiązane pomyślnie!',
        dps: parsed.dps,
      };
    }
    const errText = parsed.error || 'Nie udało się nawiązać połączenia z urządzeniem.';
    if (!isPrivateIp(cleanIp) && (errText.includes('Nie można połączyć') || errText.includes('timeout') || errText.includes('Network Error'))) {
      return {
        success: false,
        message: `${errText} Wskazówka: Adres ${cleanIp} to zewnętrzny adres publiczny (WAN). Sterowanie TinyTuya w protokole 3.3/3.4 wymaga lokalnego adresu IP urządzenia w domowej sieci Wi-Fi/LAN (np. 192.168.x.x lub 10.x.x.x). Sprawdź adres IP wentylatora na routerze.`,
      };
    }
    return {
      success: false,
      message: errText,
    };
  } catch (err) {
    const errText = err instanceof Error ? err.message : String(err);
    if (!isPrivateIp(cleanIp)) {
      return {
        success: false,
        message: `Błąd połączenia z ${cleanIp}: ${errText}. Uwaga: ${cleanIp} to publiczny adres WAN. Do sterowania lokalnego TinyTuya wymagany jest lokalny adres IP w sieci LAN (np. 192.168.x.x).`,
      };
    }
    return {
      success: false,
      message: errText,
    };
  }
}

/**
 * Skanowanie sieci LAN w poszukiwaniu rozgłaszających się urządzeń Tuya
 */
export async function scanTinyTuyaLan(): Promise<TinyTuyaScanResult> {
  try {
    const rawOutput = await runBridgeScript({ action: 'scan' }, 10000);
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
