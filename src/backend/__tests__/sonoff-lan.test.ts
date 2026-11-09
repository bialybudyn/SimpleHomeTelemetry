import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackend, type Backend } from '../context';
import { sonoffId } from '../drivers/sonoff';
import { decryptParams, encryptParams } from '../drivers/sonoff-protocol';
import { ewelinkOauthUrl, ewelinkSign } from '../drivers/ewelink-cloud';

const KEY = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const DEVICEID = '1000abcdef';

/** Emulator gniazdka S60TPF w trybie eWeLink LAN (szyfrowanie devicekey, odpowiedź ze stanem). */
function fakePlug() {
  const state: Record<string, unknown> = { switch: 'off', voltage: 23012, power: 0, current: 0 };
  const requests: { path: string; connection?: string; params: Record<string, unknown> }[] = [];
  const server: Server = createServer((req: IncomingMessage, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = JSON.parse(body);
      let params: Record<string, unknown>;
      try {
        params = decryptParams(json.data, json.iv, KEY);
      } catch {
        res.end(JSON.stringify({ seq: 1, error: 401 }));
        return;
      }
      requests.push({ path: req.url!, connection: req.headers.connection, params });
      if (req.url === '/zeroconf/switch') {
        state['switch'] = params['switch'];
        state['power'] = params['switch'] === 'on' ? 1250 : 0;
      }
      const enc = encryptParams(state, KEY);
      res.end(JSON.stringify({ seq: 2, sequence: json.sequence, error: 0, encrypt: true, iv: enc.iv, data: enc.data }));
    });
  });
  return { server, state, requests };
}

describe('Sonoff eWeLink LAN — emulowane gniazdko', () => {
  let b: Backend;
  let plug: ReturnType<typeof fakePlug>;
  afterEach(() => {
    plug?.server.close();
    b?.stop();
    b?.db.close();
  });

  it('wykrywa urządzenie z mDNS, steruje nim i odczytuje stan z odpowiedzi', async () => {
    plug = fakePlug();
    await new Promise<void>((r) => plug.server.listen(0, '127.0.0.1', r));
    const port = (plug.server.address() as AddressInfo).port;

    b = createBackend(':memory:');
    // Ogłoszenie mDNS (rekord TXT z zaszyfrowanym stanem), jak wysyła urządzenie
    const enc = encryptParams({ switch: 'off' }, KEY);
    const txt = [`id=${DEVICEID}`, 'type=plug', 'encrypt=true', `iv=${enc.iv}`, `data1=${enc.data}`, 'seq=1', 'txtvers=1', 'apivers=1'];
    b.sonoff.handleResponse({ answers: [{ type: 'TXT', name: `eWeLink_${DEVICEID}._ewelink._tcp.local`, data: txt.map((t) => Buffer.from(t)) }] }, '127.0.0.1');

    const id = sonoffId(DEVICEID);
    expect(b.registry.get(id)?.last_error).toMatch(/devicekey/);

    // Klucz z importu OAuth
    b.registry.upsert(id, { sonoff_api_key: KEY });
    b.sonoff.handleResponse({ answers: [{ type: 'TXT', name: `eWeLink_${DEVICEID}._ewelink._tcp.local`, data: [...txt.slice(0, 5), 'seq=2'].map((t) => Buffer.from(t)) }] }, '127.0.0.1');
    expect(b.registry.get(id)?.state).toBe('OFF');

    // Emulator słucha na losowym porcie (adres w formacie IP:port)
    b.registry.upsert(id, { ip_address: `127.0.0.1:${port}` });

    const on = await b.sonoff.sendCommand(b.registry.get(id)!, { state: 'ON' });
    expect(on.success).toBe(true);
    expect(plug.requests.at(-1)).toMatchObject({ path: '/zeroconf/switch', connection: 'close', params: { switch: 'on' } });
    expect(b.registry.get(id)?.state).toBe('ON');
    expect(b.registry.get(id)?.power).toBe(12.5);
    expect(b.registry.get(id)?.voltage).toBe(230.12);

    // Odczyt stanu idzie przez zapytanie mDNS (S60TPF odrzuca /zeroconf/getState błędem 400)
    const requestsBefore = plug.requests.length;
    const encOn = encryptParams({ switch: 'on', voltage: 23050, power: 0, current: 0 }, KEY);
    const txtOn = [`id=${DEVICEID}`, 'type=plug', 'encrypt=true', `iv=${encOn.iv}`, `data1=${encOn.data}`, 'seq=2'];
    (b.sonoff as unknown as { mdns: unknown }).mdns = {
      query: () =>
        setTimeout(() =>
          b.sonoff.handleResponse({ answers: [{ type: 'TXT', name: `eWeLink_${DEVICEID}._ewelink._tcp.local`, data: txtOn.map((t) => Buffer.from(t)) }] }, '127.0.0.1'),
        ),
      destroy: () => undefined,
    };
    const refreshed = await b.sonoff.refresh(b.registry.get(id)!);
    expect(refreshed.success).toBe(true);
    expect(plug.requests.length).toBe(requestsBefore); // żadnego zapytania HTTP
    expect(b.registry.get(id)?.voltage).toBe(230.5); // seq=2 jak wcześniej, ale stan i tak przetworzony

    b.registry.upsert(id, { sonoff_api_key: 'zly-klucz' });
    const bad = await b.sonoff.sendCommand(b.registry.get(id)!, { state: 'OFF' });
    expect(bad.success).toBe(false);
    expect(bad.message).toMatch(/401/);
  });
});

describe('Sonoff — ochrona gniazdka przed serią poleceń', () => {
  let b: Backend;
  let plug: ReturnType<typeof fakePlug>;
  afterEach(() => {
    plug?.server.close();
    b?.stop();
    b?.db.close();
  });

  it('przy szybkim klikaniu wysyła tylko ostatnie polecenie', async () => {
    plug = fakePlug();
    await new Promise<void>((r) => plug.server.listen(0, '127.0.0.1', r));
    const port = (plug.server.address() as AddressInfo).port;
    b = createBackend(':memory:');
    const id = sonoffId(DEVICEID);
    b.registry.upsert(id, { driver: 'sonoff', protocol: 'wifi', friendly_name: 'Test', sonoff_device_id: DEVICEID, sonoff_api_key: KEY, ip_address: `127.0.0.1:${port}` });

    const results = await Promise.all(['ON', 'OFF', 'ON'].map((state) => b.sonoff.sendCommand(b.registry.get(id)!, { state })));
    expect(results.every((r) => r.success)).toBe(true);
    expect(results[0].message).toMatch(/Pominięto/);
    expect(results[1].message).toMatch(/Pominięto/);
    expect(plug.requests.map((r) => r.params['switch'])).toEqual(['on']);
    expect(b.registry.get(id)?.state).toBe('ON');
  });

  it('po braku odpowiedzi wstrzymuje kolejne polecenia', async () => {
    b = createBackend(':memory:');
    const id = sonoffId(DEVICEID);
    // Port 9 (discard) na 127.0.0.1 zwykle odrzuca połączenie od razu — symulujemy timeout ręcznie
    b.registry.upsert(id, { driver: 'sonoff', protocol: 'wifi', friendly_name: 'Test', sonoff_device_id: DEVICEID, sonoff_api_key: KEY, ip_address: '127.0.0.1:9' });
    (b.sonoff as unknown as { cooldownUntil: Map<string, number> }).cooldownUntil.set(id, Date.now() + 10_000);
    const res = await b.sonoff.sendCommand(b.registry.get(id)!, { state: 'ON' });
    expect(res.success).toBe(false);
    expect(res.message).toMatch(/spróbuj za \d+ s/);
  });
});

describe('eWeLink OAuth', () => {
  it('buduje adres logowania z podpisem jak oficjalny SDK', () => {
    const url = new URL(ewelinkOauthUrl({ appId: 'APPID', appSecret: 'SECRET' }, 'http://192.168.1.10:3000/cb', 'st', 1700000000000));
    expect(url.origin + url.pathname).toBe('https://c2ccdn.coolkit.cc/oauth/index.html');
    expect(url.searchParams.get('clientId')).toBe('APPID');
    expect(url.searchParams.get('redirectUrl')).toBe('http://192.168.1.10:3000/cb');
    expect(url.searchParams.get('grantType')).toBe('authorization_code');
    expect(url.searchParams.get('seq')).toBe('1700000000000');
    expect(url.searchParams.get('authorization')).toBe(ewelinkSign('APPID_1700000000000', 'SECRET'));
  });
});
