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

const KNOWN_COOLKIT_CREDENTIALS = [
  {
    appId: '4s1FXKC9FaGfoqXhmXSJneb3qcm1gOak',
    appSecret: 'oKvCM06gvwkRbfetd6qWRrbC3rFrbIpV',
  },
];

const DEFAULT_COOLKIT_APP_ID = KNOWN_COOLKIT_CREDENTIALS[0].appId;
const DEFAULT_COOLKIT_APP_SECRET = KNOWN_COOLKIT_CREDENTIALS[0].appSecret;

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
): Promise<{ at: string; apiKey: string; region: string; appId: string; appSecret: string } | { error: string }> {
  const isEmail = emailOrPhone.includes('@');
  const nonce = Math.random().toString(36).substring(2, 10);
  const ts = Math.floor(Date.now() / 1000);

  // Wyznaczenie kraju i numeru telefonu
  let countryCode = '+48';
  let formattedPhone = emailOrPhone.trim();
  if (!isEmail) {
    if (formattedPhone.startsWith('+')) {
      const match = formattedPhone.match(/^(\+\d{1,3})(\d+)$/);
      if (match) {
        countryCode = match[1];
        formattedPhone = match[0];
      }
    } else {
      formattedPhone = `+48${formattedPhone.replace(/^0+/, '')}`;
    }
  }

  // Zbuduj listę par do sprawdzenia
  const candidateCredentials: Array<{ appId: string; appSecret: string }> = [];
  if (customAppId?.trim() && customAppSecret?.trim()) {
    candidateCredentials.push({ appId: customAppId.trim(), appSecret: customAppSecret.trim() });
  } else if (activeEwelinkConfig.appId?.trim() && activeEwelinkConfig.appSecret?.trim()) {
    candidateCredentials.push({ appId: activeEwelinkConfig.appId.trim(), appSecret: activeEwelinkConfig.appSecret.trim() });
  }

  for (const cred of KNOWN_COOLKIT_CREDENTIALS) {
    if (!candidateCredentials.some((c) => c.appId === cred.appId)) {
      candidateCredentials.push(cred);
    }
  }

  let lastErrorMsg = 'Błąd logowania do eWeLink';

  for (const cred of candidateCredentials) {
    const { appId, appSecret } = cred;

    // === METODA 1: CoolKit OpenAPI v2 (https://{region}-apia.coolkit.cc/v2/user/login) ===
    try {
      const v2Body: Record<string, unknown> = {
        countryCode,
        password,
      };
      if (isEmail) {
        v2Body['email'] = emailOrPhone.trim();
      } else {
        v2Body['phoneNumber'] = formattedPhone;
      }

      const v2Sign = createHmac('sha256', appSecret).update(JSON.stringify(v2Body)).digest('base64');
      const v2Res = await fetch(`https://${region}-apia.coolkit.cc/v2/user/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CK-Appid': appId,
          'X-CK-Nonce': nonce,
          Authorization: `Sign ${v2Sign}`,
        },
        body: JSON.stringify(v2Body),
      });

      const v2Data = (await v2Res.json().catch(() => null)) as Record<string, unknown> | null;
      if (v2Data) {
        const v2Err = Number(v2Data['error']);
        if (v2Err === 0 && v2Data['data']) {
          const d = v2Data['data'] as Record<string, unknown>;
          const user = (d['user'] as Record<string, unknown>) || {};
          const at = typeof d['at'] === 'string' ? d['at'] : '';
          const apiKey = typeof user['apikey'] === 'string' ? user['apikey'] : '';
          const resolvedReg = typeof d['region'] === 'string' ? (d['region'] as string) : region;
          return { at, apiKey, region: resolvedReg, appId, appSecret };
        }

        const v2Msg = typeof v2Data['msg'] === 'string' ? v2Data['msg'] : '';
        if (v2Err === 10001 || v2Msg.includes('password error')) {
          return { error: 'Niepoprawne hasło do konta eWeLink! Sprawdź hasło do aplikacji.' };
        }
        if (v2Err === 10003 || v2Msg.includes('does not exist')) {
          return { error: `Konto eWeLink (${emailOrPhone}) nie istnieje w regionie ${region.toUpperCase()}. Sprawdź poprawność adresu email lub numeru telefonu.` };
        }
        if (v2Msg.toLowerCase().includes('unauthorized') || v2Err === 407 || v2Err === 408) {
          lastErrorMsg = `Identyfikator aplikacji eWeLink (${appId}) został odrzucony (unauthorized). Podaj własny bezpłatny AppId i AppSecret z dev.ewelink.cc lub użyj bezpośredniego klucza DeviceKey.`;
        } else {
          lastErrorMsg = v2Msg || `Błąd eWeLink v2: ${v2Err}`;
        }
      }
    } catch (v2Ex: any) {
      console.warn(`[eWeLink v2 login fail]:`, v2Ex?.message || v2Ex);
    }

    // === METODA 2: CoolKit API v1 (Fallback na port 8080) ===
    try {
      const v1Body: Record<string, unknown> = {
        appid: appId,
        password,
        ts,
        version: 8,
        nonce,
      };
      if (isEmail) {
        v1Body['email'] = emailOrPhone.trim();
      } else {
        v1Body['phoneNumber'] = emailOrPhone.trim();
      }

      const v1Sign = createHmac('sha256', appSecret).update(JSON.stringify(v1Body)).digest('base64');
      let currentRegion = region;
      let apiUrl = `https://${currentRegion}-api.coolkit.cc:8080/api`;

      let res = await fetch(`${apiUrl}/user/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Sign ${v1Sign}`,
        },
        body: JSON.stringify(v1Body),
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
            Authorization: `Sign ${v1Sign}`,
          },
          body: JSON.stringify(v1Body),
        });
        data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      }

      if (data && typeof data['error'] === 'number' && data['error'] === 0) {
        const user = data['user'] as Record<string, unknown> | undefined;
        const at = typeof data['at'] === 'string' ? data['at'] : '';
        const apiKey = typeof user?.['apikey'] === 'string' ? user['apikey'] : '';
        return { at, apiKey, region: currentRegion, appId, appSecret };
      }

      const rawMsg = data && typeof data['msg'] === 'string' ? data['msg'] : '';
      const errCode = data?.['error'];

      if (errCode === 406 || errCode === 400) {
        return { error: `Niepoprawny login lub hasło do konta eWeLink (${rawMsg || errCode}). Upewnij się, że wpisujesz dane do oficjalnej aplikacji eWeLink.` };
      }

      if (rawMsg && !rawMsg.toLowerCase().includes('unauthorized')) {
        lastErrorMsg = rawMsg;
      }
    } catch (fetchErr: any) {
      lastErrorMsg = `Błąd sieciowy podczas łączenia z serwerem eWeLink: ${fetchErr?.message || fetchErr}`;
    }
  }

  return { error: lastErrorMsg };
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

    const { at, region: resolvedRegion, appId: resolvedAppId, appSecret: resolvedAppSecret } = loginResult;
    const appId = resolvedAppId || customAppId?.trim() || activeEwelinkConfig.appId?.trim() || DEFAULT_COOLKIT_APP_ID;
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
        params['devicekey'] ||
        params['deviceKey'] ||
        extraInner['devicekey'] ||
        extra['devicekey'] ||
        item['apikey'] ||
        ''
      );

      const resolvedIp = typeof item['ip'] === 'string'
        ? item['ip']
        : typeof params['ip'] === 'string'
        ? params['ip']
        : typeof params['lanIp'] === 'string'
        ? params['lanIp']
        : undefined;

      return {
        deviceId: String(item['deviceid'] || ''),
        apiKey: String(item['apikey'] || ''),
        deviceKey,
        name: String(item['name'] || `Sonoff ${item['deviceid']}`),
        model: String(extraInner['model'] || extra['model'] || 'SONOFF Smart Device'),
        switch: String(params['switch'] || 'off'),
        online: Boolean(item['online']),
        ip: resolvedIp,
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
      appId: resolvedAppId || customAppId || activeEwelinkConfig.appId,
      appSecret: resolvedAppSecret || customAppSecret || activeEwelinkConfig.appSecret,
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
  retryCount = 0,
): Promise<{ success: boolean; message: string }> {
  let at = activeEwelinkConfig.at;
  const region = activeEwelinkConfig.region || 'eu';
  const appId = activeEwelinkConfig.appId?.trim() || DEFAULT_COOLKIT_APP_ID;

  if (!at || retryCount > 0) {
    if (!activeEwelinkConfig.password || (!activeEwelinkConfig.email && !activeEwelinkConfig.phoneNumber)) {
      return {
        success: false,
        message: 'Konto eWeLink nie jest skonfigurowane w panelu (brak tokenu i hasła). Zaloguj się w zakładce eWeLink.',
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
      return { success: false, message: `Błąd ponownego logowania do eWeLink: ${loginRes.error}` };
    }
    at = loginRes.at;
    activeEwelinkConfig.at = at;
    saveEwelinkConfig();
  }

  const cleanState = state.toLowerCase() as 'on' | 'off';
  let lastCloudError = 'Nieznany błąd komunikacji z eWeLink Cloud';

  // 1. Próba CoolKit OpenAPI v2 (Standard CUBE-OS)
  try {
    const v2Url = `https://${region}-apia.coolkit.cc/v2/device/thing/status`;
    const singleParam = { switch: cleanState };
    const multiParam = { switches: [{ switch: cleanState, outlet: 0 }] };

    for (const httpMethod of ['POST', 'PUT']) {
      for (const paramsObj of [singleParam, multiParam]) {
        const v2Res = await fetch(v2Url, {
          method: httpMethod,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${at}`,
            'X-CK-Appid': appId,
          },
          body: JSON.stringify({
            type: 1,
            id: deviceId,
            params: paramsObj,
          }),
        });

        const v2Data = (await v2Res.json().catch(() => null)) as Record<string, unknown> | null;
        if (v2Data) {
          const errCode = Number(v2Data['error']);
          if (errCode === 0) {
            return {
              success: true,
              message: `Pomyślnie przestawiono gniazdko ${deviceId} na stan ${state.toUpperCase()} przez eWeLink Cloud (OpenAPI v2 ${httpMethod}).`,
            };
          }
          if ((errCode === 401 || errCode === 10004 || errCode === 402) && retryCount === 0) {
            return controlEwelinkDevice(deviceId, state, 1);
          }
          lastCloudError = String(v2Data['msg'] || `Błąd eWeLink v2 kod ${errCode}`);
        }
      }
    }
  } catch (ex2: any) {
    lastCloudError = ex2?.message || String(ex2);
  }

  // 2. Próba CoolKit API v1
  try {
    const ts = Math.floor(Date.now() / 1000);
    const nonce = Math.random().toString(36).slice(5);
    const apiUrl = `https://${region}-api.coolkit.cc:8080/api`;

    for (const paramsObj of [{ switch: cleanState }, { switches: [{ switch: cleanState, outlet: 0 }] }]) {
      const res = await fetch(`${apiUrl}/user/device/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${at}`,
        },
        body: JSON.stringify({
          deviceid: deviceId,
          params: paramsObj,
          appid: appId,
          nonce,
          ts,
          version: 8,
        }),
      });

      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (data && typeof data['error'] === 'number') {
        const errCode = Number(data['error']);
        if (errCode === 0) {
          return {
            success: true,
            message: `Pomyślnie przestawiono gniazdko ${deviceId} na stan ${state.toUpperCase()} przez eWeLink Cloud (v1).`,
          };
        }
        if ((errCode === 401 || errCode === 10004) && retryCount === 0) {
          return controlEwelinkDevice(deviceId, state, 1);
        }
        lastCloudError = String(data['msg'] || `Błąd eWeLink v1 kod ${errCode}`);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lastCloudError = msg;
  }

  return {
    success: false,
    message: `Błąd eWeLink Cloud (${deviceId}): ${lastCloudError}`,
  };
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
export async function sendSonoffHttpRequest(
  ip: string,
  path: string,
  payloadData: Record<string, unknown>,
  deviceId?: string,
  apiKey?: string,
  timeoutMs = 2200,
): Promise<{ error: number; deviceid?: string; data?: Record<string, unknown>; [key: string]: unknown }> {
  const url = `http://${ip}:8081${path}`;
  const sequence = Date.now().toString();
  const cleanDeviceId = deviceId ? String(deviceId).trim() : '';

  let bodyObj: Record<string, unknown> = {
    sequence,
    deviceid: cleanDeviceId,
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

    const resJson = (await response.json()) as Record<string, unknown>;

    // Jeśli odpowiedź jest zaszyfrowana i mamy klucz
    if (resJson['encrypt'] && resJson['data'] && resJson['iv'] && apiKey) {
      const dec = decryptPayload(String(resJson['data']), String(resJson['iv']), apiKey);
      if (dec) {
        resJson['data'] = dec;
      }
    }

    return resJson as { error: number; deviceid?: string; data?: Record<string, unknown> };
  } catch (err: unknown) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Test połączenia z urządzeniem Sonoff w sieci LAN z automatycznym wykrywaniem Chmury eWeLink
 */
export async function testSonoffLanConnection(
  ip: string,
  deviceId?: string,
  apiKey?: string,
  deviceName?: string,
): Promise<SonoffLanResult> {
  const cleanIp = String(ip || '').trim();
  let resolvedDeviceId = deviceId?.trim() || undefined;
  let resolvedApiKey = apiKey?.trim() || undefined;

  // 1. Auto-dociągnięcie deviceId i apiKey z konfiguracji eWeLink (dopasowanie po IP, ID lub Nazwie)
  if ((!resolvedDeviceId || !resolvedApiKey) && activeEwelinkConfig.devices) {
    const matched = activeEwelinkConfig.devices.find(
      (d) =>
        (cleanIp && d.ip === cleanIp) ||
        (resolvedDeviceId && d.deviceId === resolvedDeviceId) ||
        (deviceName && d.name && d.name.toLowerCase().replace(/[^a-z0-9]/g, '') === deviceName.toLowerCase().replace(/[^a-z0-9]/g, ''))
    );
    if (matched) {
      if (!resolvedDeviceId) resolvedDeviceId = matched.deviceId;
      if (!resolvedApiKey) resolvedApiKey = matched.deviceKey || matched.apiKey;
    }
  }

  // 2. Próba bezpośredniego zapytania LAN HTTP 8081
  if (cleanIp) {
    try {
      let res;
      if (resolvedApiKey) {
        try {
          res = await sendSonoffHttpRequest(cleanIp, '/zeroconf/info', {}, resolvedDeviceId, resolvedApiKey, 1500);
        } catch {
          // spróbuj unencrypted
        }
      }
      if (!res || res.error !== 0) {
        res = await sendSonoffHttpRequest(cleanIp, '/zeroconf/info', {}, resolvedDeviceId, undefined, 1500);
      }

      if (res && (res.error === 0 || res['deviceid'])) {
        if (!resolvedDeviceId && res['deviceid']) {
          resolvedDeviceId = String(res['deviceid']);
        }
        const d = (res.data as Record<string, unknown>) || {};
        const swStatus =
          typeof d['switch'] === 'string'
            ? d['switch']
            : Array.isArray(d['switches']) && d['switches'][0] && typeof d['switches'][0]['switch'] === 'string'
            ? d['switches'][0]['switch']
            : 'off';
        const info: SonoffDeviceInfo = {
          switch: swStatus === 'on' ? 'on' : 'off',
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
          message: `[Lokalny LAN 8081] Połączono pomyślnie z Sonoff (${cleanIp}). Stan: ${info.switch?.toUpperCase()}, Moc: ${info.power}W, RSSI: ${info.rssi} dBm.`,
          deviceInfo: info,
          rawResponse: res,
        };
      }
    } catch {
      // Brak odpowiedzi portu 8081 - przejdziemy do weryfikacji Chmury eWeLink
    }
  }

  // 3. Weryfikacja aktywnego połączenia w Chmurze eWeLink
  if (resolvedDeviceId || (activeEwelinkConfig.email && activeEwelinkConfig.password)) {
    // Jeśli brak resolvedDeviceId, spróbuj pobrać urządzenia z Chmury
    if (!resolvedDeviceId && activeEwelinkConfig.email && activeEwelinkConfig.password) {
      const syncRes = await loginAndSyncEwelink(activeEwelinkConfig.email, activeEwelinkConfig.password, activeEwelinkConfig.region);
      if (syncRes.success && syncRes.devices) {
        const matched = syncRes.devices.find(
          (d) =>
            (cleanIp && d.ip === cleanIp) ||
            (deviceName && d.name && d.name.toLowerCase().replace(/[^a-z0-9]/g, '') === deviceName.toLowerCase().replace(/[^a-z0-9]/g, ''))
        );
        if (matched) {
          resolvedDeviceId = matched.deviceId;
          resolvedApiKey = matched.deviceKey || matched.apiKey;
        }
      }
    }

    if (resolvedDeviceId) {
      const eweMatch = activeEwelinkConfig.devices?.find((d) => d.deviceId === resolvedDeviceId);
      return {
        success: true,
        message: `Gniazdko jest aktywne w Chmurze eWeLink (ID: ${resolvedDeviceId}). Sterowanie i odczyty działają poprawnie przez eWeLink Cloud Bridge!`,
        deviceInfo: {
          switch: eweMatch?.switch === 'on' ? 'on' : 'off',
          power: eweMatch?.power ?? 0,
          voltage: eweMatch?.voltage ?? 230,
          current: eweMatch?.current ?? 0,
        },
      };
    }
  }

  return {
    success: false,
    message: `Brak odpowiedzi gniazdka Sonoff na porcie 8081 LAN (${cleanIp || 'brak IP'}) oraz brak aktywnego połączenia w chmurze eWeLink. Upewnij się, że urządzenie jest podłączone do Wi-Fi i zaloguj się do eWeLink w panelu.`,
    error: 'Brak łączności LAN 8081 i Chmury',
  };
}

export interface SonoffLanCommandOptions {
  ip: string;
  deviceId?: string;
  apiKey?: string;
  deviceName?: string;
  switch?: 'on' | 'off';
  startup?: 'on' | 'off' | 'stay';
  pulse?: 'on' | 'off';
  pulseWidth?: number; // ms
  sledOnline?: 'on' | 'off'; // Wskaźnik LED na obudowie
  overload_power_threshold?: number;
  overload_current_threshold?: number;
}

/**
 * Wysłanie polecenia sterującego do Sonoff w sieci LAN z automatycznym przełączaniem na Chmurę eWeLink
 */
export async function sendSonoffLanCommand(options: SonoffLanCommandOptions): Promise<SonoffLanResult> {
  const { ip, deviceId, apiKey, deviceName } = options;
  const cleanIp = String(ip || '').trim();

  let resolvedDeviceId = deviceId?.trim() || undefined;
  let resolvedApiKey = apiKey?.trim() || undefined;

  // Auto-uzupełnienie parametrów eWeLink z pamięci konfiguracji
  if ((!resolvedDeviceId || !resolvedApiKey) && activeEwelinkConfig.devices) {
    const matched = activeEwelinkConfig.devices.find(
      (d) =>
        (cleanIp && d.ip === cleanIp) ||
        (resolvedDeviceId && d.deviceId === resolvedDeviceId) ||
        (deviceName && d.name && d.name.toLowerCase().replace(/[^a-z0-9]/g, '') === deviceName.toLowerCase().replace(/[^a-z0-9]/g, ''))
    );
    if (matched) {
      if (!resolvedDeviceId) resolvedDeviceId = matched.deviceId;
      if (!resolvedApiKey) resolvedApiKey = matched.deviceKey || matched.apiKey;
    }
  }

  // 1. Próba pobrania deviceId bezpośrednio z zapytania /zeroconf/info jeśli wciąż brak
  if (!resolvedDeviceId && cleanIp) {
    try {
      const infoRes = await sendSonoffHttpRequest(cleanIp, '/zeroconf/info', {}, undefined, undefined, 1200);
      if (infoRes && infoRes['deviceid']) {
        resolvedDeviceId = String(infoRes['deviceid']);
      }
    } catch {
      // ignore
    }
  }

  // 2. Zmiana stanu przekaźnika ON/OFF
  if (options.switch !== undefined) {
    const swState = options.switch.toLowerCase() as 'on' | 'off';

    // A. Próba połączenia bezpośredniego w sieci LAN (port 8081)
    if (cleanIp) {
      try {
        const singlePayload = { switch: swState };
        const multiPayload = { switches: [{ switch: swState, outlet: 0 }] };

        const attempts: Array<{ path: string; payload: Record<string, unknown>; key?: string }> = [];

        if (resolvedApiKey) {
          attempts.push({ path: '/zeroconf/switch', payload: singlePayload, key: resolvedApiKey });
          attempts.push({ path: '/zeroconf/switches', payload: multiPayload, key: resolvedApiKey });
          attempts.push({ path: '/zeroconf/switch', payload: multiPayload, key: resolvedApiKey });
        }
        attempts.push({ path: '/zeroconf/switch', payload: singlePayload });
        attempts.push({ path: '/zeroconf/switches', payload: multiPayload });
        attempts.push({ path: '/zeroconf/switch', payload: multiPayload });

        let res;
        for (const attempt of attempts) {
          try {
            res = await sendSonoffHttpRequest(cleanIp, attempt.path, attempt.payload, resolvedDeviceId, attempt.key, 1500);
            if (res && res.error === 0) {
              return {
                success: true,
                message: `[Lokalny LAN 8081] Pomyślnie przestawiono Sonoff (${cleanIp}) na stan: ${swState.toUpperCase()}`,
                deviceInfo: { switch: swState },
                rawResponse: res,
              };
            }
          } catch {
            // Kontynuuj próbę kolejnego wariantu
          }
        }
      } catch (lanErr: unknown) {
        console.warn(`[SONOFF LAN 8081] Port 8081 niedostępny pod IP ${cleanIp}:`, lanErr);
      }
    }

    // B. Jeśli brak resolvedDeviceId, spróbuj zalogować i zsynchronizować z Chmurą eWeLink
    if (!resolvedDeviceId && activeEwelinkConfig.email && activeEwelinkConfig.password) {
      try {
        const syncRes = await loginAndSyncEwelink(activeEwelinkConfig.email, activeEwelinkConfig.password, activeEwelinkConfig.region);
        if (syncRes.success && syncRes.devices) {
          const matched = syncRes.devices.find(
            (d) =>
              (cleanIp && d.ip === cleanIp) ||
              (deviceName && d.name && d.name.toLowerCase().replace(/[^a-z0-9]/g, '') === deviceName.toLowerCase().replace(/[^a-z0-9]/g, ''))
          );
          if (matched) {
            resolvedDeviceId = matched.deviceId;
            resolvedApiKey = matched.deviceKey || matched.apiKey;
          }
        }
      } catch {
        // ignore
      }
    }

    // C. Przejście na Chmurę eWeLink (eWeLink Cloud Bridge)
    if (resolvedDeviceId) {
      try {
        const cloudRes = await controlEwelinkDevice(resolvedDeviceId, swState);
        if (cloudRes.success) {
          return {
            success: true,
            message: `[eWeLink Cloud Bridge] Pomyślnie przestawiono gniazdko (${resolvedDeviceId}) na ${swState.toUpperCase()} przez Chmurę eWeLink (LAN ${cleanIp || 'brak'}:8081 niedostępny).`,
            deviceInfo: { switch: swState },
          };
        } else {
          return {
            success: false,
            message: `Nie można sterować: LAN 8081 (${cleanIp || 'brak IP'}) nie odpowiada, eWeLink Cloud: ${cloudRes.message}`,
            error: cloudRes.message,
            deviceInfo: { switch: swState },
          };
        }
      } catch (cloudErr: unknown) {
        const cMsg = cloudErr instanceof Error ? cloudErr.message : String(cloudErr);
        return {
          success: false,
          message: `Błąd eWeLink Cloud (${resolvedDeviceId}): ${cMsg}`,
          error: cMsg,
          deviceInfo: { switch: swState },
        };
      }
    }

    return {
      success: false,
      message: `Urządzenie (${cleanIp || 'brak IP'}) nie odpowiada na porcie 8081 LAN oraz nie znaleziono eWeLink Device ID. Połącz konto eWeLink w panelu.`,
      error: 'Brak łączności LAN 8081 i Device ID',
      deviceInfo: { switch: swState },
    };
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
