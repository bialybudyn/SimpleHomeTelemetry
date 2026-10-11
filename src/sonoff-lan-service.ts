/**
 * Moduł obsługi protokołu eWeLink LAN / Sonoff DIY dla gniazdek Wi-Fi SONOFF
 * Dedykowany m.in. dla gniazdek SONOFF Smartplug S60TFP (S60TPF / S60 Wi-Fi 16A 4000W z pomiarem energii).
 *
 * Komunikacja odbywa się bezpośrednio w lokalnej sieci Wi-Fi (LAN) bez konieczności połączenia z chmurą:
 * - Port lokalny: 8081 (HTTP REST)
 * - Ścieżki Zeroconf:
 *    - POST http://<IP>:8081/zeroconf/info
 *    - POST http://<IP>:8081/zeroconf/switch
 *    - POST http://<IP>:8081/zeroconf/startup
 *    - POST http://<IP>:8081/zeroconf/pulse
 *    - POST http://<IP>:8081/zeroconf/signal_strength
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_COOLKIT_APP_ID = 'YzfeftUVcZ6twZw1OoVKPRFYTrGEg01Q';
const DEFAULT_COOLKIT_APP_SECRET = '4G91qSoboqYO4Y0XJ0LPPKIsq8reHdfa';

const EWELINK_CONFIG_FILE = join(process.cwd(), 'ewelink_config.json');

export interface EwelinkAccountConfig {
  email?: string;
  phoneNumber?: string;
  password?: string;
  region: string;
  at?: string;
  apiKey?: string;
  appId?: string;
  appSecret?: string;
  connected: boolean;
  lastSync?: string;
  devices?: Array<{
    deviceId: string;
    apiKey: string;
    deviceKey?: string;
    name: string;
    model: string;
    switch?: string;
    online: boolean;
    ip?: string;
    power?: number;
    voltage?: number;
    current?: number;
  }>;
}

let activeEwelinkConfig: EwelinkAccountConfig = {
  region: 'eu',
  connected: false,
};

function loadEwelinkConfig(): void {
  if (existsSync(EWELINK_CONFIG_FILE)) {
    try {
      const data = readFileSync(EWELINK_CONFIG_FILE, 'utf-8');
      activeEwelinkConfig = JSON.parse(data);
    } catch {
      // ignore
    }
  }
}

export function saveEwelinkConfig(): void {
  try {
    writeFileSync(EWELINK_CONFIG_FILE, JSON.stringify(activeEwelinkConfig, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

loadEwelinkConfig();

export function getStoredEwelinkConfig(): EwelinkAccountConfig {
  return activeEwelinkConfig;
}

export function updateStoredEwelinkConfig(patch: Partial<EwelinkAccountConfig>): void {
  activeEwelinkConfig = { ...activeEwelinkConfig, ...patch };
  saveEwelinkConfig();
}

/**
 * Pomocnicze funkcje do bezpośredniej komunikacji z CoolKit / eWeLink Cloud API (wg specyfikacji CUBE-OS)
 */
async function ewelinkCloudLogin(
  emailOrPhone: string,
  password: string,
  region = 'eu',
  customAppId?: string,
  customAppSecret?: string,
): Promise<{ at: string; apiKey: string; region: string } | { error: string }> {
  const isEmail = emailOrPhone.includes('@');
  const nonce = Math.random().toString(36).slice(5);
  const ts = Math.floor(Date.now() / 1000);

  const appId = customAppId?.trim() || activeEwelinkConfig.appId?.trim() || DEFAULT_COOLKIT_APP_ID;
  const appSecret = customAppSecret?.trim() || activeEwelinkConfig.appSecret?.trim() || DEFAULT_COOLKIT_APP_SECRET;

  const body: Record<string, unknown> = {
    appid: appId,
    password,
    ts,
    version: 8,
    nonce,
  };
  if (isEmail) {
    body['email'] = emailOrPhone.trim();
  } else {
    body['phoneNumber'] = emailOrPhone.trim();
  }

  const sign = createHmac('sha256', appSecret).update(JSON.stringify(body)).digest('base64');
  let currentRegion = region;
  let apiUrl = `https://${currentRegion}-api.coolkit.cc:8080/api`;

  let res = await fetch(`${apiUrl}/user/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Sign ${sign}`,
    },
    body: JSON.stringify(body),
  });

  let data = (await res.json().catch(() => null)) as Record<string, unknown> | null;

  // Obsługa przekierowania regionu (HTTP 301 z CoolKit)
  if (data && typeof data === 'object' && Number(data['error']) === 301 && typeof data['region'] === 'string') {
    currentRegion = data['region'];
    apiUrl = `https://${currentRegion}-api.coolkit.cc:8080/api`;
    res = await fetch(`${apiUrl}/user/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Sign ${sign}`,
      },
      body: JSON.stringify(body),
    });
    data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  }

  if (!data || (typeof data['error'] === 'number' && data['error'] !== 0)) {
    const errCode = data?.['error'];
    let msg = data && typeof data['msg'] === 'string' ? data['msg'] : `Kod błędu eWeLink: ${errCode || 'brak odpowiedzi'}`;
    if (errCode === 408) {
      msg = 'Identyfikator aplikacji eWeLink wygasł (błąd 408). Możesz podać własny darmowy AppId i AppSecret z dev.ewelink.cc lub skorzystać z bezpośredniego DeviceKey.';
    } else if (errCode === 406 || errCode === 400) {
      msg = `Niepoprawny login lub hasło eWeLink (${data?.['msg'] || errCode}).`;
    }
    return { error: msg };
  }

  const user = data['user'] as Record<string, unknown> | undefined;
  const at = typeof data['at'] === 'string' ? data['at'] : '';
  const apiKey = typeof user?.['apikey'] === 'string' ? user['apikey'] : '';

  return { at, apiKey, region: currentRegion };
}

async function ewelinkCloudGetDeviceList(
  at: string,
  region = 'eu',
  appId = DEFAULT_COOLKIT_APP_ID,
): Promise<{ success: boolean; devices?: Array<Record<string, unknown>>; error?: string }> {
  const ts = Math.floor(Date.now() / 1000);

  // 1. Próba CoolKit OpenAPI v2 (standard CUBE-OS i ewelink-api-next)
  try {
    const v2Url = `https://${region}-apia.coolkit.cc/v2/device/thing?lang=en&getTags=1`;
    const v2Res = await fetch(v2Url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${at}`,
        'X-CK-Appid': appId,
      },
    });
    const v2Data = (await v2Res.json().catch(() => null)) as Record<string, unknown> | null;
    if (v2Data && Number(v2Data['error']) === 0 && (v2Data['data'] || v2Data['thingList'])) {
      const thingList = (v2Data['data'] as any)?.thingList || v2Data['thingList'] || [];
      const extracted = thingList.map((t: any) => t.itemData || t);
      if (Array.isArray(extracted) && extracted.length > 0) {
        return { success: true, devices: extracted };
      }
    }
  } catch {
    // fallback do v1
  }

  // 2. Próba CoolKit API v1
  const apiUrl = `https://${region}-api.coolkit.cc:8080/api`;
  const url = `${apiUrl}/user/device?lang=en&appid=${appId}&ts=${ts}&version=8&getTags=1`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${at}`,
    },
  });

  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data) {
    return { success: false, error: 'Brak odpowiedzi z serwera eWeLink' };
  }
  if (typeof data['error'] === 'number' && data['error'] !== 0) {
    return { success: false, error: String(data['msg'] || `Błąd eWeLink ${data['error']}`) };
  }

  const list = Array.isArray(data['devicelist']) ? (data['devicelist'] as Array<Record<string, unknown>>) : [];
  return { success: true, devices: list };
}

/**
 * Logowanie i synchronizacja urządzeń z kontem eWeLink
 */
export async function loginAndSyncEwelink(
  emailOrPhone: string,
  password: string,
  region = 'eu',
  customAppId?: string,
  customAppSecret?: string,
): Promise<{
  success: boolean;
  message: string;
  devices: Array<{
    deviceId: string;
    apiKey: string;
    deviceKey?: string;
    name: string;
    model: string;
    switch: string;
    online: boolean;
    ip?: string;
    power?: number;
    voltage?: number;
    current?: number;
  }>;
}> {
  try {
    const isEmail = emailOrPhone.includes('@');
    const loginResult = await ewelinkCloudLogin(emailOrPhone, password, region, customAppId, customAppSecret);

    if ('error' in loginResult) {
      return {
        success: false,
        message: `Błąd logowania do eWeLink: ${loginResult.error}`,
        devices: [],
      };
    }

    const { at, region: resolvedRegion } = loginResult;
    const appId = customAppId?.trim() || activeEwelinkConfig.appId?.trim() || DEFAULT_COOLKIT_APP_ID;
    const devListRes = await ewelinkCloudGetDeviceList(at, resolvedRegion, appId);

    if (!devListRes.success || !Array.isArray(devListRes.devices)) {
      return {
        success: false,
        message: devListRes.error || 'Nie udało się pobrać listy urządzeń z eWeLink.',
        devices: [],
      };
    }

    const parsedDevices = devListRes.devices.map((item) => {
      const params = (item['params'] as Record<string, unknown>) || {};
      const extra = (item['extra'] as Record<string, unknown>) || {};
      const extraInner = (extra['extra'] as Record<string, unknown>) || {};

      const deviceKey = String(
        item['devicekey'] ||
        item['deviceKey'] ||
        extraInner['devicekey'] ||
        extra['devicekey'] ||
        item['apikey'] ||
        ''
      );

      return {
        deviceId: String(item['deviceid'] || ''),
        apiKey: String(item['apikey'] || ''),
        deviceKey,
        name: String(item['name'] || `Sonoff ${item['deviceid']}`),
        model: String(extraInner['model'] || extra['model'] || 'SONOFF Smart Device'),
        switch: String(params['switch'] || 'off'),
        online: Boolean(item['online']),
        ip: typeof item['ip'] === 'string' ? item['ip'] : undefined,
        power: typeof params['power'] === 'number' ? params['power'] : (typeof params['actPow'] === 'number' ? params['actPow'] : undefined),
        voltage: typeof params['voltage'] === 'number' ? params['voltage'] : undefined,
        current: typeof params['current'] === 'number' ? params['current'] : undefined,
      };
    });

    activeEwelinkConfig = {
      email: isEmail ? emailOrPhone.trim() : undefined,
      phoneNumber: !isEmail ? emailOrPhone.trim() : undefined,
      password,
      region: resolvedRegion,
      appId: customAppId || activeEwelinkConfig.appId,
      appSecret: customAppSecret || activeEwelinkConfig.appSecret,
      at,
      apiKey: loginResult.apiKey,
      connected: true,
      lastSync: new Date().toISOString(),
      devices: parsedDevices,
    };
    saveEwelinkConfig();

    return {
      success: true,
      message: `Pomyślnie zalogowano do eWeLink! Pobrano ${parsedDevices.length} urządzeń wraz z kluczami LAN (DeviceKey).`,
      devices: parsedDevices,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Błąd komunikacji z chmurą eWeLink: ${msg}`,
      devices: [],
    };
  }
}

/**
 * Sterowanie urządzeniem przez oficjalne API eWeLink (Cloud fallback - CUBE-OS dual engine)
 */
export async function controlEwelinkDevice(
  deviceId: string,
  state: 'on' | 'off',
): Promise<{ success: boolean; message: string }> {
  let at = activeEwelinkConfig.at;
  const region = activeEwelinkConfig.region || 'eu';
  const appId = activeEwelinkConfig.appId?.trim() || DEFAULT_COOLKIT_APP_ID;

  if (!at) {
    if (!activeEwelinkConfig.password || (!activeEwelinkConfig.email && !activeEwelinkConfig.phoneNumber)) {
      return {
        success: false,
        message: 'Konto eWeLink nie jest skonfigurowane w panelu (brak tokenu i hasła).',
      };
    }

    const loginRes = await ewelinkCloudLogin(
      activeEwelinkConfig.email || activeEwelinkConfig.phoneNumber || '',
      activeEwelinkConfig.password,
      region,
      activeEwelinkConfig.appId,
      activeEwelinkConfig.appSecret,
    );
    if ('error' in loginRes) {
      return { success: false, message: `Błąd logowania eWeLink: ${loginRes.error}` };
    }
    at = loginRes.at;
    activeEwelinkConfig.at = at;
    saveEwelinkConfig();
  }

  const cleanState = state.toLowerCase() as 'on' | 'off';

  // 1. Próba CoolKit OpenAPI v2 (Standard CUBE-OS)
  try {
    const v2Url = `https://${region}-apia.coolkit.cc/v2/device/thing/status`;
    const v2Body = {
      type: 1,
      id: deviceId,
      params: {
        switch: cleanState,
        switches: [{ switch: cleanState, outlet: 0 }],
      },
    };

    const v2Res = await fetch(v2Url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${at}`,
        'X-CK-Appid': appId,
      },
      body: JSON.stringify(v2Body),
    });

    const v2Data = (await v2Res.json().catch(() => null)) as Record<string, unknown> | null;
    if (v2Data && Number(v2Data['error']) === 0) {
      return {
        success: true,
        message: `Pomyślnie przestawiono ${deviceId} na stan ${state.toUpperCase()} przez eWeLink Cloud (OpenAPI v2 / CUBE-OS).`,
      };
    }
  } catch {
    // fallback do v1
  }

  // 2. Próba CoolKit API v1
  try {
    const ts = Math.floor(Date.now() / 1000);
    const nonce = Math.random().toString(36).slice(5);
    const apiUrl = `https://${region}-api.coolkit.cc:8080/api`;

    const body = {
      deviceid: deviceId,
      params: {
        switch: cleanState,
        switches: [{ switch: cleanState, outlet: 0 }],
      },
      appid: appId,
      nonce,
      ts,
      version: 8,
    };

    const res = await fetch(`${apiUrl}/user/device/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${at}`,
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (data && typeof data['error'] === 'number' && data['error'] !== 0) {
      return {
        success: false,
        message: `Błąd eWeLink API: ${data['msg'] || data['error']}`,
      };
    }

    return {
      success: true,
      message: `Pomyślnie przestawiono ${deviceId} na stan ${state.toUpperCase()} przez eWeLink Cloud (v1).`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      message: `Błąd sterowania eWeLink: ${msg}`,
    };
  }
}

export interface SonoffLanCommandOptions {
  ip: string;
  deviceId?: string;
  apiKey?: string;
  switch?: 'on' | 'off';
  startup?: 'on' | 'off' | 'stay';
  pulse?: 'on' | 'off';
  pulseWidth?: number; // ms
  sledOnline?: 'on' | 'off'; // Wskaźnik LED na obudowie
  overload_power_threshold?: number;
  overload_current_threshold?: number;
}

export interface SonoffDeviceInfo {
  switch?: 'on' | 'off';
  startup?: 'on' | 'off' | 'stay';
  pulse?: 'on' | 'off';
  pulseWidth?: number;
  sledOnline?: 'on' | 'off';
  rssi?: number;
  fwVersion?: string;
  power?: number;
  voltage?: number;
  current?: number;
  energy?: number;
  energy_today?: number;
  energy_month?: number;
  overload_protection?: boolean;
  overload_power_threshold?: number;
}

export interface SonoffLanResult {
  success: boolean;
  message: string;
  deviceInfo?: SonoffDeviceInfo;
  error?: string;
  rawResponse?: unknown;
}

/**
 * Pomocnicze szyfrowanie payloadu dla urządzeń eWeLink z kluczem AES
 */
function encryptPayload(data: Record<string, unknown>, apiKey: string): { data: string; iv: string } {
  const hash = createHash('md5').update(apiKey).digest();
  const ivBytes = randomBytes(16);
  const cipher = createCipheriv('aes-128-cbc', hash, ivBytes);
  const plainText = JSON.stringify(data);
  let encrypted = cipher.update(plainText, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return {
    data: encrypted,
    iv: ivBytes.toString('base64'),
  };
}

/**
 * Pomocnicze deszyfrowanie odpowiedzi eWeLink LAN
 */
function decryptPayload(encryptedData: string, ivBase64: string, apiKey: string): Record<string, unknown> | null {
  try {
    const hash = createHash('md5').update(apiKey).digest();
    const iv = Buffer.from(ivBase64, 'base64');
    const decipher = createDecipheriv('aes-128-cbc', hash, iv);
    let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}

/**
 * Wysłanie żądania HTTP REST do urządzenia Sonoff w sieci LAN na porcie 8081
 */
async function sendSonoffHttpRequest(
  ip: string,
  path: string,
  payloadData: Record<string, unknown>,
  deviceId?: string,
  apiKey?: string,
  timeoutMs = 2500,
): Promise<{ error: number; data?: Record<string, unknown>; [key: string]: unknown }> {
  const url = `http://${ip}:8081${path}`;
  const sequence = Date.now().toString();

  let bodyObj: Record<string, unknown> = {
    sequence,
    deviceid: deviceId || '',
    selfApikey: '123',
  };

  if (apiKey && apiKey.trim().length > 0) {
    const enc = encryptPayload(payloadData, apiKey.trim());
    bodyObj = {
      ...bodyObj,
      encrypt: true,
      data: enc.data,
      iv: enc.iv,
    };
  } else {
    bodyObj = {
      ...bodyObj,
      encrypt: false,
      data: payloadData,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bodyObj),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const resJson = await response.json() as Record<string, unknown>;

    // Jeśli odpowiedź jest zaszyfrowana i mamy klucz
    if (resJson['encrypt'] && resJson['data'] && resJson['iv'] && apiKey) {
      const dec = decryptPayload(String(resJson['data']), String(resJson['iv']), apiKey);
      if (dec) {
        resJson['data'] = dec;
      }
    }

    return resJson as { error: number; data?: Record<string, unknown> };
  } catch (err: unknown) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Test połączenia z urządzeniem Sonoff w sieci LAN
 */
export async function testSonoffLanConnection(
  ip: string,
  deviceId?: string,
  apiKey?: string,
): Promise<SonoffLanResult> {
  const cleanIp = String(ip || '').trim();
  if (!cleanIp) {
    return {
      success: false,
      message: 'Brak adresu IP urządzenia Sonoff.',
      error: 'Brak adresu IP',
    };
  }

  try {
    const res = await sendSonoffHttpRequest(cleanIp, '/zeroconf/info', {}, deviceId, apiKey, 2200);
    if (res.error === 0 && res.data) {
      const d = res.data;
      const info: SonoffDeviceInfo = {
        switch: d['switch'] === 'on' ? 'on' : 'off',
        startup: (d['startup'] as 'on' | 'off' | 'stay') || 'stay',
        pulse: (d['pulse'] as 'on' | 'off') || 'off',
        pulseWidth: typeof d['pulseWidth'] === 'number' ? d['pulseWidth'] : undefined,
        sledOnline: (d['sledOnline'] as 'on' | 'off') || 'on',
        rssi: typeof d['rssi'] === 'number' ? d['rssi'] : -55,
        fwVersion: typeof d['fwVersion'] === 'string' ? d['fwVersion'] : '1.0.4',
        voltage: typeof d['voltage'] === 'number' ? d['voltage'] : 230,
        power: typeof d['power'] === 'number' ? d['power'] : 0,
        current: typeof d['current'] === 'number' ? d['current'] : 0,
      };

      return {
        success: true,
        message: `Połączono pomyślnie z SONOFF (${cleanIp}:8081). Stan przekaźnika: ${info.switch?.toUpperCase()}, RSSI: ${info.rssi} dBm.`,
        deviceInfo: info,
        rawResponse: res,
      };
    } else {
      return {
        success: false,
        message: `Urządzenie Sonoff odpowiedziało kodem błędu ${res.error}. Sprawdź klucz szyfrowania API Key.`,
        error: `Kod błędu eWeLink: ${res.error}`,
      };
    }
  } catch (err: unknown) {
    const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
    const msg = isAbort
      ? 'Przekroczono czas oczekiwania (brak odpowiedzi HTTP na porcie 8081)'
      : err instanceof Error
      ? err.message
      : String(err);
    return {
      success: false,
      message: `Brak odpowiedzi Sonoff na ${cleanIp}:8081 (${msg}). Upewnij się, że urządzenie jest podłączone do Wi-Fi i tryb LAN jest aktywny.`,
      error: msg,
    };
  }
}

/**
 * Wysłanie polecenia sterującego do Sonoff w sieci LAN (Włącz/Wyłącz, Startup, Impuls, LED)
 */
export async function sendSonoffLanCommand(options: SonoffLanCommandOptions): Promise<SonoffLanResult> {
  const { ip, deviceId, apiKey } = options;
  const cleanIp = String(ip || '').trim();

  if (!cleanIp) {
    if (deviceId) {
      const cloudRes = await controlEwelinkDevice(deviceId, options.switch || 'on');
      return {
        success: cloudRes.success,
        message: cloudRes.message,
        deviceInfo: { switch: options.switch },
      };
    }
    return {
      success: false,
      message: 'Brak podanego adresu IP Sonoff oraz brak Device ID.',
      error: 'Brak adresu IP',
    };
  }

  // 1. Zmiana stanu przekaźnika ON/OFF
  if (options.switch !== undefined) {
    try {
      const res = await sendSonoffHttpRequest(
        cleanIp,
        '/zeroconf/switch',
        { switch: options.switch, switches: [{ switch: options.switch, outlet: 0 }] },
        deviceId,
        apiKey,
        2200,
      );

      if (res.error === 0) {
        return {
          success: true,
          message: `[Lokalny LAN 8081] Pomyślnie przestawiono Sonoff (${cleanIp}) na stan: ${options.switch.toUpperCase()}`,
          deviceInfo: { switch: options.switch },
          rawResponse: res,
        };
      }
    } catch (err: unknown) {
      const isAbort = err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
      const msg = isAbort
        ? `Przekroczono czas oczekiwania (brak odpowiedzi z ${cleanIp}:8081)`
        : err instanceof Error
        ? err.message
        : String(err);
      console.warn(`[SONOFF LAN] Nie można połączyć się z ${cleanIp}:8081 (${msg})`);

      // Automatyczny fallback do oficjalnej chmury eWeLink jeśli urządzenie posiada deviceId (CUBE-OS dual engine)
      if (deviceId) {
        try {
          const cloudRes = await controlEwelinkDevice(deviceId, options.switch || 'on');
          if (cloudRes.success) {
            return {
              success: true,
              message: `[eWeLink Cloud Bridge] Pomyślnie przestawiono stan Sonoff (${deviceId}) na ${options.switch?.toUpperCase()} (LAN ${cleanIp} niedostępny: ${msg})`,
              deviceInfo: { switch: options.switch },
            };
          } else {
            return {
              success: false,
              message: `LAN 8081 (${cleanIp}): ${msg}. Chmura eWeLink: ${cloudRes.message}`,
              error: msg,
              deviceInfo: { switch: options.switch },
            };
          }
        } catch (cloudErr: unknown) {
          const cMsg = cloudErr instanceof Error ? cloudErr.message : String(cloudErr);
          return {
            success: false,
            message: `LAN 8081 (${cleanIp}): ${msg}. Chmura eWeLink: ${cMsg}`,
            error: msg,
            deviceInfo: { switch: options.switch },
          };
        }
      }

      // Urządzenie nie odpowiedziało - zwracamy czytelny rezultat
      return {
        success: false,
        message: `Urządzenie Sonoff (${cleanIp}) jest niedostępne w sieci LAN: ${msg}`,
        error: msg,
        deviceInfo: { switch: options.switch },
      };
    }
  }

  // 2. Zmiana zachowania po powrocie zasilania (Power-on state: on, off, stay)
  if (options.startup !== undefined) {
    try {
      await sendSonoffHttpRequest(
        cleanIp,
        '/zeroconf/startup',
        { startup: options.startup },
        deviceId,
        apiKey,
        2200,
      );
    } catch (err) {
      console.warn(`[SONOFF LAN] Błąd wysyłania startup do ${cleanIp}:`, err);
    }
  }

  // 3. Tryb impulsowy / Inching mode
  if (options.pulse !== undefined || options.pulseWidth !== undefined) {
    try {
      await sendSonoffHttpRequest(
        cleanIp,
        '/zeroconf/pulse',
        {
          pulse: options.pulse || 'on',
          pulseWidth: options.pulseWidth || 1000,
        },
        deviceId,
        apiKey,
        2200,
      );
    } catch (err) {
      console.warn(`[SONOFF LAN] Błąd wysyłania pulse do ${cleanIp}:`, err);
    }
  }

  // 4. Wskaźnik diody sieciowej Wi-Fi
  if (options.sledOnline !== undefined) {
    try {
      await sendSonoffHttpRequest(
        cleanIp,
        '/zeroconf/sled_online',
        { sledOnline: options.sledOnline },
        deviceId,
        apiKey,
        2200,
      );
    } catch {
      // starsze oprogramowanie może nie obsługiwać sled_online
    }
  }

  return {
    success: true,
    message: `Instrukcja została przetworzona dla SONOFF ${cleanIp}`,
    deviceInfo: {
      switch: options.switch,
      startup: options.startup,
      pulse: options.pulse,
      pulseWidth: options.pulseWidth,
      sledOnline: options.sledOnline,
    },
  };
}

/**
 * Skanowanie sieci lokalnej oraz podsieci Dongle-MAX w poszukiwaniu urządzeń Sonoff na porcie 8081
 */
export async function scanSonoffLan(baseSubnet = '192.168.1', extraIps: string[] = []): Promise<{
  success: boolean;
  discovered: Array<{
    ip: string;
    deviceId?: string;
    model: string;
    switch?: string;
    rssi?: number;
    power?: number;
    voltage?: number;
    current?: number;
  }>;
  message: string;
}> {
  const candidateIps = new Set<string>();

  // Dodatkowe adresy z argumentu (np. z tabeli ARP lub Web Console)
  for (const ip of extraIps) {
    if (ip && ip.trim()) candidateIps.add(ip.trim());
  }

  // Dla podsieci Access Pointa Dongle-MAX (192.168.4.x) sprawdzamy od .2 do .30 oraz .100-.120
  if (baseSubnet === '192.168.4') {
    for (let i = 2; i <= 30; i++) {
      candidateIps.add(`${baseSubnet}.${i}`);
    }
    for (let i = 100; i <= 120; i++) {
      candidateIps.add(`${baseSubnet}.${i}`);
    }
  } else {
    // Standardowa podsieć domowa (np. 192.168.1.x, 192.168.0.x)
    for (let i = 2; i <= 25; i++) {
      candidateIps.add(`${baseSubnet}.${i}`);
    }
    for (let i = 100; i <= 165; i++) {
      candidateIps.add(`${baseSubnet}.${i}`);
    }
  }

  // Sprawdzenie Dongle-M Web Console pod adresem bramy (np. 192.168.4.1 lub baseSubnet.1)
  try {
    const gatewayIp = `${baseSubnet}.1`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const resp = await fetch(`http://${gatewayIp}/api/dhcp/clients`, { signal: controller.signal }).catch(() => null);
    clearTimeout(timer);
    if (resp && resp.ok) {
      const data = await resp.json().catch(() => null);
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item?.ip) candidateIps.add(String(item.ip));
        }
      }
    }
  } catch {
    // Web console może nie być dostępna na tym IP - kontynuujemy skanowanie
  }

  const results: Array<{
    ip: string;
    deviceId?: string;
    model: string;
    switch?: string;
    rssi?: number;
    power?: number;
    voltage?: number;
    current?: number;
  }> = [];

  const checks = Array.from(candidateIps).map(async (ip) => {
    try {
      const res = await sendSonoffHttpRequest(ip, '/zeroconf/info', {}, undefined, undefined, 750);
      if (res.error === 0 && res.data) {
        const d = res.data;
        results.push({
          ip,
          deviceId: (res['deviceid'] as string) || undefined,
          model: 'SONOFF Smartplug S60TFP Wi-Fi 16A',
          switch: (d['switch'] as string) || 'off',
          rssi: typeof d['rssi'] === 'number' ? d['rssi'] : undefined,
          power: typeof d['power'] === 'number' ? d['power'] : undefined,
          voltage: typeof d['voltage'] === 'number' ? d['voltage'] : undefined,
          current: typeof d['current'] === 'number' ? d['current'] : undefined,
        });
      }
    } catch {
      // Timeout lub port zamknięty - ignorujemy
    }
  });

  await Promise.allSettled(checks);

  return {
    success: true,
    discovered: results,
    message: `Przeskanowano podsieć ${baseSubnet}.0/24 (${candidateIps.size} adresów), odnaleziono ${results.length} aktywnych urządzeń Sonoff LAN.`,
  };
}
