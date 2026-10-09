/**
 * Moduł integracji Tuya Sharing SDK oraz sterowania lokalnego TuyAPI.
 * Umożliwia pobieranie kluczy Tuya Local Key poprzez skanowanie kodu QR
 * w aplikacji Tuya Smart / Smart Life (bez konta dewelopera Tuya IoT).
 */

import * as https from 'https';
import * as crypto from 'crypto';
import QRCode from 'qrcode';

const URL_PATH = 'apigw.iotbing.com';
const CONF_CLIENT_ID = 'HA_3y9q4ak7g4ephrvke';
const CONF_SCHEMA = 'haauthorize';
const APP_QR_CODE_HEADER = 'tuyaSmart--qrLogin/?token=';

export interface TuyaDeviceExtracted {
  id: string;
  name: string;
  local_key: string;
  category: string;
  product_name: string;
  product_id?: string;
  ip?: string;
  online?: boolean;
}

export interface PendingQrSession {
  token: string;
  user_code: string;
  client_id: string;
  created_at: number;
}

const pendingSessions = new Map<string, PendingQrSession>();

// Pomocnicze funkcje kryptograficzne specyficzne dla protokołu Tuya Device Sharing SDK
function randomNonce(e = 32): string {
  const t = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
  let n = '';
  for (let i = 0; i < e; i++) {
    n += t[Math.floor(Math.random() * t.length)];
  }
  return n;
}

function aesGcmEncrypt(rawData: string, secret: string): string {
  const nonce = Buffer.from(randomNonce(12), 'utf8');
  const cipher = crypto.createCipheriv('aes-128-gcm', Buffer.from(secret, 'utf8'), nonce);
  const enc = Buffer.concat([cipher.update(rawData, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, enc, tag]).toString('base64');
}

function aexGcmDecrypt(cipherDataB64: string, secret: string): string {
  const buf = Buffer.from(cipherDataB64, 'base64');
  const nonce = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(12, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', Buffer.from(secret, 'utf8'), nonce);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(ciphertext, undefined, 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function secretGenerating(rid: string, sid: string, hashKey: string): string {
  let message = hashKey;
  const mod = 16;
  if (sid) {
    const len = Math.min(sid.length, mod);
    let ecode = '';
    for (let i = 0; i < len; i++) {
      const idx = sid.charCodeAt(i) % mod;
      ecode += sid[idx] || '';
    }
    message += '_' + ecode;
  }
  const hmac = crypto.createHmac('sha256', rid);
  hmac.update(message, 'utf8');
  return hmac.digest('hex').substring(0, 16);
}

function restfulSign(
  hashKey: string,
  queryEncdata: string,
  bodyEncdata: string,
  headers: Record<string, string>,
): string {
  const headerKeys = ['X-appKey', 'X-requestId', 'X-sid', 'X-time', 'X-token'];
  let headerSignStr = '';
  for (const k of headerKeys) {
    const v = headers[k] || '';
    if (v) headerSignStr += k + '=' + v + '||';
  }
  let signStr = headerSignStr.slice(0, -2);
  if (queryEncdata) signStr += queryEncdata;
  if (bodyEncdata) signStr += bodyEncdata;
  const hmac = crypto.createHmac('sha256', hashKey);
  hmac.update(signStr, 'utf8');
  return hmac.digest('hex');
}

function makeHttpRequest(
  urlStr: string,
  method = 'GET',
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method,
      headers: {
        'User-Agent': 'HomeAssistant/2024.1 (TuyaSharingClient)',
        ...headers,
      },
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode || 200, data }));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Limit czasu żądania do serwera Tuya'));
    });

    req.on('error', (err) => reject(err));

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Generowanie tokenu i obrazu QR kodu dla podanego User Code z aplikacji Tuya/Smart Life
 */
export async function generateTuyaQrCode(userCode: string): Promise<{
  success: boolean;
  token?: string;
  qr_data_url?: string;
  qr_string?: string;
  expires_in?: number;
  error?: string;
}> {
  const cleanedCode = String(userCode || '').trim();
  if (!cleanedCode) {
    return {
      success: false,
      error: 'Proszę podać Kod Użytkownika (User Code) z aplikacji Tuya Smart / Smart Life.',
    };
  }

  const endpoint = `https://${URL_PATH}/v1.0/m/life/home-assistant/qrcode/tokens?clientid=${CONF_CLIENT_ID}&usercode=${encodeURIComponent(
    cleanedCode,
  )}&schema=${CONF_SCHEMA}`;

  try {
    const res = await makeHttpRequest(endpoint, 'POST');
    const parsed = JSON.parse(res.data);

    if (!parsed.success) {
      const msg = parsed.msg || 'Błędny User Code lub błąd Tuya API';
      return { success: false, error: msg };
    }

    const token = parsed.result?.qrcode;
    if (!token) {
      return { success: false, error: 'Serwer Tuya nie zwrócił tokenu QR' };
    }

    const qrContent = APP_QR_CODE_HEADER + token;
    const qrDataUrl = await QRCode.toDataURL(qrContent, {
      width: 320,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });

    pendingSessions.set(token, {
      token,
      user_code: cleanedCode,
      client_id: CONF_CLIENT_ID,
      created_at: Date.now(),
    });

    return {
      success: true,
      token,
      qr_data_url: qrDataUrl,
      qr_string: qrContent,
      expires_in: 180,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Nie udało się połączyć z bramą Tuya: ${errorMsg}`,
    };
  }
}

/**
 * Sprawdzenie statusu autoryzacji tokenu QR i pobranie urządzeń po zatwierdzeniu w telefonie
 */
export async function checkTuyaQrStatus(
  token: string,
  userCode: string,
): Promise<{
  status: 'waiting' | 'authorized' | 'expired' | 'error';
  message: string;
  username?: string;
  devices?: TuyaDeviceExtracted[];
  raw_auth?: Record<string, unknown>;
}> {
  const session = pendingSessions.get(token);
  const activeUserCode = userCode || session?.user_code;
  if (!activeUserCode) {
    return {
      status: 'error',
      message: 'Brak aktywnej sesji QR lub kodu użytkownika',
    };
  }

  // Weryfikacja czasu życia (3 minuty)
  if (session && Date.now() - session.created_at > 185000) {
    pendingSessions.delete(token);
    return {
      status: 'expired',
      message: 'Kod QR wygasł. Proszę wygenerować nowy kod.',
    };
  }

  const endpoint = `https://${URL_PATH}/v1.0/m/life/home-assistant/qrcode/tokens/${encodeURIComponent(
    token,
  )}?clientid=${CONF_CLIENT_ID}&usercode=${encodeURIComponent(activeUserCode)}`;

  try {
    const res = await makeHttpRequest(endpoint, 'GET');
    const parsed = JSON.parse(res.data);

    if (!parsed.success) {
      return {
        status: 'waiting',
        message: 'Oczekiwanie na zeskanowanie kodu QR i zatwierdzenie w aplikacji Tuya...',
      };
    }

    const authResult = parsed.result;
    if (!authResult || !authResult.access_token) {
      return {
        status: 'waiting',
        message: 'Sesja w toku autoryzacji...',
      };
    }

    // Użytkownik zatwierdził logowanie!
    pendingSessions.delete(token);

    // Pobranie listy urządzeń i Local Key
    const extractedDevices = await fetchTuyaDevices(authResult);

    return {
      status: 'authorized',
      message: `Pomyślnie zalogowano konto Tuya (${authResult.username || 'Użytkownik'})! Wykryto urządzeń: ${extractedDevices.length}`,
      username: authResult.username,
      devices: extractedDevices,
      raw_auth: authResult,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      status: 'error',
      message: `Błąd weryfikacji Tuya: ${errorMsg}`,
    };
  }
}

/**
 * Klient API Tuya Customer OpenAPI z autoryzacją AES-GCM
 */
async function customerApiRequest(
  authResult: Record<string, unknown>,
  path: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const host = String(authResult['endpoint'] || 'https://apigw.iotbing.com').replace(/\/$/, '');
  const accessToken = String(authResult['access_token'] || '');
  const refreshToken = String(authResult['refresh_token'] || '');

  const rid = crypto.randomUUID();
  const sid = '';

  const md5 = crypto.createHash('md5');
  md5.update(rid + refreshToken, 'utf8');
  const hashKey = md5.digest('hex');

  const secret = secretGenerating(rid, sid, hashKey);

  let queryEncdata = '';
  let urlParams = '';

  if (Object.keys(params).length > 0) {
    const formJson = JSON.stringify(params);
    queryEncdata = aesGcmEncrypt(formJson, secret);
    urlParams = `?encdata=${encodeURIComponent(queryEncdata)}`;
  }

  const t = Date.now().toString();
  const headers: Record<string, string> = {
    'X-appKey': CONF_CLIENT_ID,
    'X-requestId': rid,
    'X-sid': sid,
    'X-time': t,
    'X-token': accessToken,
  };

  const sign = restfulSign(hashKey, queryEncdata, '', headers);
  headers['X-sign'] = sign;

  const fullUrl = `${host}${path}${urlParams}`;
  const response = await makeHttpRequest(fullUrl, 'GET', headers);
  const parsed = JSON.parse(response.data);

  if (!parsed.success) {
    return parsed;
  }

  if (parsed.result) {
    try {
      const decrypted = aexGcmDecrypt(parsed.result, secret);
      parsed.result = JSON.parse(decrypted);
    } catch {
      // Ignoruj błąd jeśli odpowiedź była już zdekodowana
    }
  }

  return parsed;
}

/**
 * Pobranie urządzeń i wyciągnięcie Local Key z zarejestrowanych domów w Tuya
 */
async function fetchTuyaDevices(
  authResult: Record<string, unknown>,
): Promise<TuyaDeviceExtracted[]> {
  const devicesList: TuyaDeviceExtracted[] = [];

  try {
    const homesResp = await customerApiRequest(authResult, '/v1.0/m/life/users/homes');
    const rawHomes = homesResp?.['result'];
    const homes = Array.isArray(rawHomes) ? (rawHomes as Record<string, unknown>[]) : [];

    for (const home of homes) {
      const homeId = home['ownerId'] || home['id'];
      if (!homeId) continue;

      const devResp = await customerApiRequest(authResult, '/v1.0/m/life/ha/home/devices', {
        homeId: String(homeId),
      });

      const rawDevs = devResp?.['result'];
      const devicesArr = Array.isArray(rawDevs) ? (rawDevs as Record<string, unknown>[]) : [];
      for (const d of devicesArr) {
        if (!d['id']) continue;
        devicesList.push({
          id: String(d['id']),
          name: String(d['name'] || d['product_name'] || 'Urządzenie Tuya'),
          local_key: String(d['local_key'] || ''),
          category: String(d['category'] || 'fan'),
          product_name: String(d['product_name'] || ''),
          product_id: d['product_id'] ? String(d['product_id']) : undefined,
          ip: d['ip'] ? String(d['ip']) : undefined,
          online: Boolean(d['online']),
        });
      }
    }
  } catch (err) {
    console.warn('[TUYA FETCH] Błąd podczas pobierania domów/urządzeń Tuya:', err);
  }

  return devicesList;
}

/**
 * Wykonanie rzeczywistego polecenia sterującego przez TuyAPI na lokalnej sieci Wi-Fi
 */
export async function sendTuyaLocalCommand(
  ipAddress: string,
  localKey: string,
  devId: string,
  cmd: Record<string, unknown>,
  protocolVersion = '3.3',
): Promise<{ success: boolean; message: string }> {
  if (!ipAddress || !localKey || !devId) {
    return {
      success: false,
      message: 'Brak wymaganego adresu IP, klucza Local Key lub ID urządzenia',
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const TuyAPI = require('tuyapi');
  const tuyaDevice = new TuyAPI({
    id: devId,
    key: localKey,
    ip: ipAddress,
    version: protocolVersion || '3.3',
    issueGetOnConnect: false,
  });

  // Mapowanie komend do standardowych kodów DPS Tuya (Wentylator / Gniazdko / Przekaźnik)
  const dps: Record<string, unknown> = {};

  if (cmd['state'] !== undefined) {
    dps['1'] = cmd['state'] === 'ON' || cmd['state'] === true;
  }
  if (cmd['fan_speed'] !== undefined) {
    dps['3'] = Number(cmd['fan_speed']);
  }
  if (cmd['fan_mode'] !== undefined) {
    dps['2'] = String(cmd['fan_mode']);
  }
  if (cmd['fan_oscillation'] !== undefined) {
    dps['8'] = Boolean(cmd['fan_oscillation']);
  }
  if (cmd['fan_timer'] !== undefined) {
    dps['5'] = Number(cmd['fan_timer']);
  }
  if (cmd['fan_ionizer'] !== undefined) {
    dps['101'] = Boolean(cmd['fan_ionizer']);
  }
  if (cmd['fan_humidifier'] !== undefined) {
    dps['102'] = Boolean(cmd['fan_humidifier']);
  }
  if (cmd['fan_uv'] !== undefined) {
    dps['103'] = Boolean(cmd['fan_uv']);
  }

  return new Promise((resolve) => {
    let completed = false;

    const timeout = setTimeout(() => {
      if (!completed) {
        completed = true;
        try {
          tuyaDevice.disconnect();
        } catch (e) {
          console.debug('TuyAPI timeout disconnect error:', e);
        }
        resolve({
          success: false,
          message: `Przekroczono limit czasu (3s) połączenia z urządzeniem Tuya ${ipAddress}:6668. Upewnij się, że wentylator jest włączony w sieci.`,
        });
      }
    }, 3500);

    // Jeśli mamy adres IP urządzenia, łączymy się bezpośrednio po gnieździe TCP 6668,
    // a jeśli bezpośrednie połączenie zgłosi błąd, próbujemy odnalezienia w podsieci przez find()
    const connectAction = ipAddress
      ? tuyaDevice.connect().catch((directErr: unknown) => {
          console.debug('TuyAPI direct connect failed, trying find():', directErr);
          return tuyaDevice.find({ timeout: 2 }).then(() => tuyaDevice.connect());
        })
      : tuyaDevice.find({ timeout: 2 }).then(() => tuyaDevice.connect());

    connectAction
      .then(() => {
        if (Object.keys(dps).length > 0) {
          return tuyaDevice.set({ multiple: true, data: dps });
        }
        return true;
      })
      .then(() => {
        if (!completed) {
          completed = true;
          clearTimeout(timeout);
          try {
            tuyaDevice.disconnect();
          } catch (e) {
            console.debug('TuyAPI success disconnect error:', e);
          }
          resolve({
            success: true,
            message: `Wysłano pomyślnie instrukcję Tuya Local do urządzenia ${ipAddress}!`,
          });
        }
      })
      .catch((err: unknown) => {
        if (!completed) {
          completed = true;
          clearTimeout(timeout);
          try {
            tuyaDevice.disconnect();
          } catch (e) {
            console.debug('TuyAPI catch disconnect error:', e);
          }
          const msg = err instanceof Error ? err.message : String(err);
          resolve({
            success: false,
            message: `Błąd komunikacji Tuya Local (${msg})`,
          });
        }
      });
  });
}
