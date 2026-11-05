import { afterEach, describe, expect, it } from 'vitest';
import { createBackend, type Backend } from '../context';

const PREFIX = 'zigbee2mqtt';
const msg = (b: Backend, topic: string, payload: unknown) =>
  b.z2m.handleMessage(`${PREFIX}/${topic}`, Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)));

const bridgeDevices = [
  { ieee_address: '0x0', type: 'Coordinator', friendly_name: 'Coordinator' },
  {
    ieee_address: '0x1',
    type: 'Router',
    friendly_name: 'Gniazdko',
    definition: {
      model: 'S26R2ZB',
      vendor: 'SONOFF',
      exposes: [{ type: 'switch', features: [{ type: 'binary', property: 'state', access: 7 }] }],
    },
  },
  {
    ieee_address: '0x2',
    type: 'EndDevice',
    friendly_name: 'dom/salon/czujnik',
    definition: { model: 'SNZB-02', vendor: 'SONOFF', exposes: [{ type: 'numeric', property: 'temperature', access: 1 }] },
  },
];

describe('backend: Zigbee2MQTT -> rejestr -> historia', () => {
  let b: Backend;
  afterEach(() => {
    b?.stop();
    b?.db.close();
  });

  it('synchronizuje urządzenia, stan, dostępność i historię', () => {
    b = createBackend(':memory:');
    msg(b, 'bridge/devices', bridgeDevices);
    expect(b.registry.all().map((d) => d.ieee_address).sort()).toEqual(['0x1', '0x2']);

    msg(b, 'Gniazdko', { state: 'ON', linkquality: 100 });
    msg(b, 'dom/salon/czujnik', { temperature: 21.5, voc: 120 });
    msg(b, 'Nieznany', { temperature: 50 });
    expect(b.registry.all()).toHaveLength(2);

    // Komunikat availability nie może nadpisać stanu ON/OFF
    msg(b, 'Gniazdko/availability', { state: 'offline' });
    const plug = b.registry.get('0x1')!;
    expect(plug.state).toBe('ON');
    expect(plug.available).toBe(false);
    expect(b.registry.isOnline(plug)).toBe(false);

    const sensor = b.registry.get('0x2')!;
    expect(sensor.last_temperature).toBe(21.5);
    expect(sensor.raw_state?.['voc']).toBe(120);

    const { points, stats } = b.history.query('0x2', '24h', false);
    expect(points).toHaveLength(1);
    expect(points[0].values).toEqual({ temperature: 21.5, voc: 120 });
    expect(stats.avg_temp).toBe(21.5);
  });

  it('urządzenie usunięte z Z2M znika z pulpitu, ponowne pojawienie się je przywraca', () => {
    b = createBackend(':memory:');
    msg(b, 'bridge/devices', bridgeDevices);
    msg(b, 'bridge/devices', bridgeDevices.filter((d) => d.ieee_address !== '0x2'));
    expect(b.registry.get('0x2')?.is_deleted).toBe(true);
    msg(b, 'bridge/devices', bridgeDevices);
    expect(b.registry.get('0x2')?.is_deleted).toBe(false);
  });

  it('nie wysyła kluczy do przeglądarki', () => {
    b = createBackend(':memory:');
    b.registry.upsert('tuya_abc', { driver: 'tuya', local_key: 'secret', friendly_name: 'Wentylator' });
    const pub = b.registry.toPublic(b.registry.get('tuya_abc')!);
    expect(pub.local_key).toBeUndefined();
    expect(pub.has_local_key).toBe(true);
  });

  it('alarm nie powtarza się przy każdym odczycie', () => {
    b = createBackend(':memory:');
    msg(b, 'bridge/devices', bridgeDevices);
    b.registry.upsert('0x2', { temp_alarm_enabled: true, temp_alarm_max: 25 });
    for (let i = 0; i < 5; i++) msg(b, 'dom/salon/czujnik', { temperature: 30 + i });
    expect(b.notifier.list().filter((n) => n.type === 'temp_high')).toHaveLength(1);
  });

  it('/set przepuszcza tylko atrybuty zapisywalne', () => {
    b = createBackend(':memory:');
    msg(b, 'bridge/devices', bridgeDevices);
    const plug = b.registry.get('0x1')!;
    expect(b.z2m.buildSetPayload(plug, { state: 'OFF', power: 5, temp_alarm_enabled: true })).toEqual({ state: 'OFF' });
  });
});
