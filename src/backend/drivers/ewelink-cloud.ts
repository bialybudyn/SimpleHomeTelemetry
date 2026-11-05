import { createHmac, randomBytes } from 'node:crypto';

/**
 * Jednorazowy import urządzeń z chmury eWeLink (CoolKit API v2) — tylko po to, żeby pobrać
 * `deviceid` i `devicekey` każdego urządzenia. Dalsza komunikacja odbywa się wyłącznie w LAN.
 *
 * Aplikacje z dev.ewelink.cc (rola "Standard") NIE mają dostępu do logowania hasłem
 * (/v2/user/login → błąd 407). Dozwolone jest tylko OAuth 2.0:
 *   1. przeglądarka → https://c2ccdn.coolkit.cc/oauth/index.html?clientId=…&authorization=…
 *   2. eWeLink przekierowuje na redirectUrl?code=…&region=…
 *   3. POST https://{region}-apia.coolkit.cc/v2/user/oauth/token → accessToken
 *   4. GET  /v2/device/thing → lista urządzeń z devicekey
 * Źródło: oficjalny SDK ewelink-api-next (src/web/apis/oauth, SupportedAPI.png).
 */

export interface EwelinkCloudDevice {
  deviceid: string;
  devicekey: string;
  name: string;
  model: string;
  brand: string;
  uiid?: number;
  online: boolean;
  params: Record<string, unknown>;
}

export interface EwelinkApp {
  appId: string;
  appSecret: string;
}

const host = (region: string) => (region === 'cn' ? 'https://cn-apia.coolkit.cn' : `https://${region}-apia.coolkit.cc`);

/** HMAC-SHA256 (base64) — tak samo jak `sign()` w oficjalnym SDK. */
export function ewelinkSign(message: string, appSecret: string): string {
  return createHmac('sha256', appSecret).update(message).digest('base64');
}

/** Adres strony logowania eWeLink (OAuth 2.0). */
export function ewelinkOauthUrl(app: EwelinkApp, redirectUrl: string, state: string, seq = Date.now()): string {
  const params: Record<string, string> = {
    clientId: app.appId,
    redirectUrl,
    grantType: 'authorization_code',
    state,
    nonce: randomBytes(4).toString('hex'),
    seq: String(seq),
    authorization: ewelinkSign(`${app.appId}_${seq}`, app.appSecret),
  };
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `https://c2ccdn.coolkit.cc/oauth/index.html?${query}`;
}

/** Wymiana kodu z przekierowania na token dostępu. */
export async function ewelinkExchangeCode(app: EwelinkApp, region: string, code: string, redirectUrl: string): Promise<string> {
  const body = JSON.stringify({ code, redirectUrl, grantType: 'authorization_code' });
  const res = await fetch(`${host(region)}/v2/user/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CK-Appid': app.appId,
      Authorization: `Sign ${ewelinkSign(body, app.appSecret)}`,
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json()) as { error: number; msg?: string; data?: { accessToken?: string } };
  if (json.error !== 0 || !json.data?.accessToken) {
    throw new Error(`eWeLink odrzucił kod autoryzacji (błąd ${json.error}: ${json.msg ?? ''}). Kod jest jednorazowy i ważny krótko — zaloguj się ponownie.`);
  }
  return json.data.accessToken;
}

/** Lista urządzeń konta (z devicekey). */
export async function ewelinkListDevices(app: EwelinkApp, region: string, accessToken: string): Promise<EwelinkCloudDevice[]> {
  const res = await fetch(`${host(region)}/v2/device/thing?num=0`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'X-CK-Appid': app.appId },
    signal: AbortSignal.timeout(15_000),
  });
  const list = (await res.json()) as { error: number; msg?: string; data?: { thingList?: Array<{ itemType: number; itemData: Record<string, any> }> } };
  if (list.error !== 0) throw new Error(`Pobieranie urządzeń eWeLink nieudane (błąd ${list.error}: ${list.msg ?? ''}).`);

  return (list.data?.thingList ?? [])
    .filter((t) => t.itemType === 1 || t.itemType === 2)
    .map((t) => t.itemData)
    .filter((d) => d?.['deviceid'])
    .map((d) => ({
      deviceid: String(d['deviceid']),
      devicekey: String(d['devicekey'] ?? ''),
      name: String(d['name'] ?? d['deviceid']),
      model: String(d['productModel'] ?? d['extra']?.['model'] ?? ''),
      brand: String(d['brandName'] ?? 'SONOFF'),
      uiid: typeof d['extra']?.['uiid'] === 'number' ? d['extra']['uiid'] : undefined,
      online: Boolean(d['online']),
      params: (d['params'] ?? {}) as Record<string, unknown>,
    }));
}
