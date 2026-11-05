import { createHmac } from 'node:crypto';

/**
 * Jednorazowy import urządzeń z chmury eWeLink (CoolKit API v2) — tylko po to, żeby pobrać
 * `deviceid` i `devicekey` każdego urządzenia. Dalsza komunikacja odbywa się wyłącznie w LAN.
 *
 * Wymaga własnego, darmowego AppID/AppSecret z https://dev.ewelink.cc (konto deweloperskie).
 * Hasło do konta nie jest nigdzie zapisywane.
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

export interface EwelinkLoginInput {
  appId: string;
  appSecret: string;
  login: string;
  password: string;
  region: string;
  countryCode?: string;
}

const host = (region: string) => `https://${region}-apia.coolkit.cc`;

export async function ewelinkImportDevices(input: EwelinkLoginInput): Promise<EwelinkCloudDevice[]> {
  const { appId, appSecret } = input;
  if (!appId || !appSecret) throw new Error('Podaj AppID i AppSecret z dev.ewelink.cc.');

  const isEmail = input.login.includes('@');
  const body: Record<string, string> = { password: input.password, countryCode: input.countryCode || '+48' };
  if (isEmail) body['email'] = input.login.trim();
  else body['phoneNumber'] = input.login.trim().startsWith('+') ? input.login.trim() : `+48${input.login.trim()}`;
  const bodyText = JSON.stringify(body);
  const sign = createHmac('sha256', appSecret).update(bodyText).digest('base64');

  let region = input.region || 'eu';
  let login = await postJson(`${host(region)}/v2/user/login`, bodyText, {
    'X-CK-Appid': appId,
    Authorization: `Sign ${sign}`,
  });
  // 10004 = konto w innym regionie
  if (login['error'] === 10004 && typeof (login['data'] as any)?.region === 'string') {
    region = (login['data'] as any).region;
    login = await postJson(`${host(region)}/v2/user/login`, bodyText, { 'X-CK-Appid': appId, Authorization: `Sign ${sign}` });
  }
  if (login['error'] !== 0) {
    throw new Error(`Logowanie eWeLink nieudane (kod ${login['error']}): ${login['msg'] ?? ''}`);
  }
  const at = (login['data'] as any)?.at as string;

  const res = await fetch(`${host(region)}/v2/device/thing?num=0`, {
    headers: { Authorization: `Bearer ${at}`, 'X-CK-Appid': appId },
    signal: AbortSignal.timeout(15_000),
  });
  const list = (await res.json()) as Record<string, any>;
  if (list['error'] !== 0) throw new Error(`Pobieranie urządzeń eWeLink nieudane (kod ${list['error']}): ${list['msg'] ?? ''}`);

  const things = (list['data']?.['thingList'] ?? []) as Array<{ itemType: number; itemData: Record<string, any> }>;
  return things
    .filter((t) => t.itemType === 1 || t.itemType === 2)
    .map((t) => t.itemData)
    .filter((d) => d?.['deviceid'] && d?.['devicekey'])
    .map((d) => ({
      deviceid: String(d['deviceid']),
      devicekey: String(d['devicekey']),
      name: String(d['name'] ?? d['deviceid']),
      model: String(d['productModel'] ?? d['extra']?.['model'] ?? ''),
      brand: String(d['brandName'] ?? 'SONOFF'),
      uiid: typeof d['extra']?.['uiid'] === 'number' ? d['extra']['uiid'] : undefined,
      online: Boolean(d['online']),
      params: (d['params'] ?? {}) as Record<string, unknown>,
    }));
}

async function postJson(url: string, body: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  return (await res.json()) as Record<string, unknown>;
}
