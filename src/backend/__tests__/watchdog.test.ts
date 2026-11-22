import { afterEach, describe, expect, it } from 'vitest';
import { createBackend, type Backend } from '../context';

const PREFIX = 'zigbee2mqtt';
const msg = (b: Backend, topic: string, payload: unknown) =>
  b.z2m.handleMessage(`${PREFIX}/${topic}`, Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)));

const devices = [
  { ieee_address: '0xa', type: 'EndDevice', friendly_name: 'Czujnik A', power_source: 'Battery', definition: { model: 'SNZB-02', exposes: [] } },
  { ieee_address: '0xb', type: 'EndDevice', friendly_name: 'Czujnik B', power_source: 'Battery', definition: { model: 'SNZB-02', exposes: [] } },
  { ieee_address: '0xc', type: 'EndDevice', friendly_name: 'Czujnik C', power_source: 'Battery', definition: { model: 'SNZB-02', exposes: [] } },
];

const alerts = (b: Backend, type: string) => b.notifier.list().filter((n) => n.type === type);

describe('watchdog: powiadomienia o utracie urządzeń i Zigbee2MQTT', () => {
  let b: Backend;
  afterEach(() => {
    b?.stop();
    b?.db.close();
  });

  const setup = () => {
    b = createBackend(':memory:');
    b.z2m.status.connected = true;
    msg(b, 'bridge/state', { state: 'online' });
    msg(b, 'bridge/devices', devices);
    for (const d of devices) msg(b, d.friendly_name, { temperature: 20, last_seen: new Date().toISOString() });
  };

  it('jedno zbiorcze powiadomienie, bez powtórzeń, i informacja o powrocie', () => {
    setup();
    b.watchdog.check();
    expect(alerts(b, 'devices_offline')).toHaveLength(0);

    msg(b, 'Czujnik A/availability', { state: 'offline' });
    msg(b, 'Czujnik B/availability', { state: 'offline' });
    b.watchdog.check();
    const lost = alerts(b, 'devices_offline');
    expect(lost).toHaveLength(1);
    expect(lost[0].message).toContain('Czujnik A');
    expect(lost[0].message).toContain('Czujnik B');
    expect(lost[0].message).not.toContain('Czujnik C');

    b.watchdog.check();
    expect(alerts(b, 'devices_offline')).toHaveLength(1);

    msg(b, 'Czujnik A/availability', { state: 'online' });
    b.watchdog.check();
    const back = alerts(b, 'devices_online');
    expect(back).toHaveLength(1);
    expect(back[0].message).toContain('Czujnik A');
    expect(b.registry.get('0xb')?.offline_alerted).toBe(true);
  });

  it('Zigbee2MQTT: alarm dopiero po 5 minutach przerwy, potem informacja o powrocie', () => {
    setup();
    const t0 = Date.now();
    msg(b, 'bridge/state', { state: 'offline' });
    b.watchdog.check(t0);
    b.watchdog.check(t0 + 4 * 60_000);
    expect(alerts(b, 'bridge_offline')).toHaveLength(0);
    b.watchdog.check(t0 + 6 * 60_000);
    b.watchdog.check(t0 + 11 * 60_000);
    expect(alerts(b, 'bridge_offline')).toHaveLength(1);

    msg(b, 'bridge/state', { state: 'online' });
    b.watchdog.check(t0 + 12 * 60_000);
    expect(alerts(b, 'bridge_restored')).toHaveLength(1);
  });

  it('krótki restart Zigbee2MQTT nie alarmuje', () => {
    setup();
    const t0 = Date.now();
    msg(b, 'bridge/state', { state: 'offline' });
    b.watchdog.check(t0);
    msg(b, 'bridge/state', { state: 'online' });
    b.watchdog.check(t0 + 6 * 60_000);
    expect(alerts(b, 'bridge_offline')).toHaveLength(0);
    expect(alerts(b, 'bridge_restored')).toHaveLength(0);
  });
});
