import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Protokół eWeLink LAN (gniazdka i przekaźniki Sonoff Wi-Fi z oryginalnym firmware).
 *
 * - Stan: urządzenie ogłasza się przez mDNS `_ewelink._tcp.local`; rekord TXT zawiera
 *   pola `iv` i `data1..data4` = AES-128-CBC(JSON parametrów), klucz = MD5(devicekey).
 * - Sterowanie: POST http://IP:8081/zeroconf/<polecenie> z tym samym szyfrowaniem.
 * - Tryb DIY: `encrypt` = false, dane jawnym tekstem, klucz niepotrzebny.
 */

function keyFor(deviceKey: string): Buffer {
  return createHash('md5').update(deviceKey, 'utf8').digest();
}

export function encryptParams(params: Record<string, unknown>, deviceKey: string, iv: Buffer = randomBytes(16)): { data: string; iv: string } {
  const cipher = createCipheriv('aes-128-cbc', keyFor(deviceKey), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(params), 'utf8'), cipher.final()]).toString('base64');
  return { data, iv: iv.toString('base64') };
}

export function decryptParams(dataB64: string, ivB64: string, deviceKey: string): Record<string, unknown> {
  const decipher = createDecipheriv('aes-128-cbc', keyFor(deviceKey), Buffer.from(ivB64, 'base64'));
  const text = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(text) as Record<string, unknown>;
}

/** Parsuje rekord TXT mDNS (lista buforów "klucz=wartość"). */
export function parseTxt(entries: (Buffer | string)[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) {
    const s = typeof e === 'string' ? e : e.toString('utf8');
    const i = s.indexOf('=');
    if (i > 0) out[s.slice(0, i)] = s.slice(i + 1);
  }
  return out;
}

/** Odszyfrowuje parametry z rekordu TXT. Zwraca null, gdy brakuje klucza. */
export function paramsFromTxt(txt: Record<string, string>, deviceKey?: string | null): Record<string, unknown> | null {
  const data = ['data1', 'data2', 'data3', 'data4'].map((k) => txt[k] ?? '').join('');
  if (!data) return null;
  if (txt['encrypt'] === 'true') {
    if (!deviceKey || !txt['iv']) return null;
    return decryptParams(data, txt['iv'], deviceKey);
  }
  return JSON.parse(data) as Record<string, unknown>;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/**
 * Normalizuje parametry eWeLink do nazw atrybutów używanych w panelu (jak w Zigbee2MQTT).
 * Wartości pomiarowe bywają w setnych częściach (np. POWR3/S60: voltage 23012 = 230.12 V).
 */
export function normalizeSonoffParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof params['switch'] === 'string') out['state'] = params['switch'] === 'on' ? 'ON' : 'OFF';
  if (Array.isArray(params['switches'])) {
    for (const s of params['switches'] as Array<{ outlet?: number; switch?: string }>) {
      if (typeof s?.outlet !== 'number' || typeof s.switch !== 'string') continue;
      const v = s.switch === 'on' ? 'ON' : 'OFF';
      out[`state_l${s.outlet + 1}`] = v;
      if (s.outlet === 0) out['state'] = v;
    }
  }
  if (typeof params['startup'] === 'string') out['power_on_behavior'] = params['startup'] === 'stay' ? 'previous' : params['startup'];
  if (typeof params['sledOnline'] === 'string') out['network_indicator'] = params['sledOnline'] === 'on';
  const rssi = num(params['rssi']);
  if (rssi !== undefined) out['rssi'] = rssi;

  let power = num(params['power']);
  let voltage = num(params['voltage']);
  let current = num(params['current']);
  const centi = voltage !== undefined && voltage > 1000;
  if (centi) {
    voltage = voltage! / 100;
    if (power !== undefined) power /= 100;
    if (current !== undefined) current /= 100;
  }
  if (power !== undefined) out['power'] = power;
  if (voltage !== undefined) out['voltage'] = voltage;
  if (current !== undefined) out['current'] = current;

  const temp = num(params['currentTemperature'] ?? params['temperature']);
  if (temp !== undefined) out['temperature'] = temp;
  const hum = num(params['currentHumidity'] ?? params['humidity']);
  if (hum !== undefined) out['humidity'] = hum;
  if (typeof params['fwVersion'] === 'string') out['firmware'] = params['fwVersion'];
  return out;
}

/** Tłumaczy polecenie z panelu na listę żądań /zeroconf/<cmd>. */
export function buildSonoffRequests(command: Record<string, unknown>, multiChannel: boolean): Array<{ cmd: string; params: Record<string, unknown> }> {
  const reqs: Array<{ cmd: string; params: Record<string, unknown> }> = [];
  const onOff = (v: unknown) => (String(v).toUpperCase() === 'ON' || v === true ? 'on' : 'off');

  const switches: Array<{ outlet: number; switch: string }> = [];
  for (const [key, value] of Object.entries(command)) {
    const m = key.match(/^state_l(\d+)$/);
    if (m) switches.push({ outlet: Number(m[1]) - 1, switch: onOff(value) });
  }
  if (command['state'] !== undefined) {
    if (multiChannel) switches.push({ outlet: 0, switch: onOff(command['state']) });
    else reqs.push({ cmd: 'switch', params: { switch: onOff(command['state']) } });
  }
  if (switches.length > 0) reqs.push({ cmd: 'switches', params: { switches } });

  const pob = command['power_on_behavior'];
  if (typeof pob === 'string') reqs.push({ cmd: 'startup', params: { startup: pob === 'previous' ? 'stay' : pob } });
  if (command['network_indicator'] !== undefined) {
    reqs.push({ cmd: 'sledonline', params: { sledOnline: command['network_indicator'] ? 'on' : 'off' } });
  }
  return reqs;
}
