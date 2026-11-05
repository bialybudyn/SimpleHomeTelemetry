/**
 * Import urządzeń z chmury Tuya przez logowanie kodem QR w aplikacji Smart Life / Tuya Smart
 * (ten sam mechanizm "Device Sharing", z którego korzysta integracja Tuya w Home Assistant).
 * Pobiera Device ID, Local Key oraz mapę DP każdego urządzenia — dalsze sterowanie jest lokalne.
 */

import * as https from 'https';
import * as crypto from 'crypto';
import QRCode from 'qrcode';
import { dpMapFromCloud } from './tuya-protocol';
import type { TuyaDpSpec } from '../../app/models/telemetry.models';

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
  dp_map?: Record<string, TuyaDpSpec>;
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
 * Mapa DP urządzenia (dpId -> kod funkcji, typ, zakres/skala) — dzięki niej wiadomo np.,
 * który DP wentylatora to prędkość, a który oscylacja.
 */
async function fetchDpMap(authResult: Record<string, unknown>, deviceId: string): Promise<Record<string, TuyaDpSpec> | undefined> {
  try {
    const resp = await customerApiRequest(authResult, `/v1.0/m/life/devices/${encodeURIComponent(deviceId)}/status`);
    const result = resp?.['result'] as Record<string, unknown> | undefined;
    const relations = result?.['dpStatusRelationDTOS'];
    if (Array.isArray(relations)) return dpMapFromCloud(relations as Array<Record<string, unknown>>);
  } catch (err) {
    console.warn(`[TUYA] Nie udało się pobrać mapy DP dla ${deviceId}:`, err);
  }
  return undefined;
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
          category: String(d['category'] || ''),
          product_name: String(d['product_name'] || ''),
          product_id: d['product_id'] ? String(d['product_id']) : undefined,
          // Chmura zwraca publiczny adres IP — lokalny zostanie ustalony z rozgłoszeń UDP urządzenia
          online: Boolean(d['online']),
          dp_map: await fetchDpMap(authResult, String(d['id'])),
        });
      }
    }
  } catch (err) {
    console.warn('[TUYA FETCH] Błąd podczas pobierania domów/urządzeń Tuya:', err);
  }

  return devicesList;
}
