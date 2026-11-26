import { afterEach, describe, expect, it } from 'vitest';
import { createBackend, type Backend } from '../context';
import { buildGetPayload } from '../state-mapper';

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

  it('stan rozsyłany przy starcie Zigbee2MQTT nie jest nowym pomiarem', () => {
    b = createBackend(':memory:');
    msg(b, 'bridge/devices', bridgeDevices);
    msg(b, 'bridge/state', { state: 'online' });
    msg(b, 'dom/salon/czujnik', { temperature: 19.5 });
    const sensor = b.registry.get('0x2')!;
    expect(sensor.last_temperature).toBe(19.5); // wartość widoczna na kafelku
    expect(sensor.last_seen).toBeNull(); // ale urządzenie nie jest "widziane przed chwilą"
    expect(b.registry.isOnline(sensor)).toBe(false);
    expect(b.history.query('0x2', '24h', false).points).toHaveLength(0);
  });

  it('korzysta z last_seen Zigbee2MQTT: stary stan nie trafia do historii, świeży tak', () => {
    b = createBackend(':memory:');
    b.z2m.status.connected = true;
    msg(b, 'bridge/devices', bridgeDevices);
    const old = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
    msg(b, 'dom/salon/czujnik', { temperature: 19.5, last_seen: old });
    const sensor = b.registry.get('0x2')!;
    expect(sensor.last_seen).toBe(old);
    expect(b.registry.isOnline(sensor)).toBe(false);
    expect(b.history.query('0x2', '24h', false).points).toHaveLength(0);

    const now = new Date().toISOString();
    msg(b, 'dom/salon/czujnik', { temperature: 20.5, last_seen: now });
    expect(sensor.last_seen).toBe(now);
    expect(b.registry.isOnline(sensor)).toBe(true);
    const { points } = b.history.query('0x2', '24h', false);
    expect(points).toHaveLength(1);
    expect(points[0].values).toEqual({ temperature: 20.5 }); // last_seen nie jest próbką
  });

  it('napięcie baterii (mV) nie miesza się z napięciem sieci', () => {
    b = createBackend(':memory:');
    msg(b, 'bridge/devices', [
      ...bridgeDevices,
      {
        ieee_address: '0x3',
        type: 'EndDevice',
        friendly_name: 'Bateryjny',
        definition: { model: 'SNZB-02', vendor: 'SONOFF', exposes: [{ type: 'numeric', property: 'voltage', unit: 'mV', access: 1 }] },
      },
    ]);
    msg(b, 'Bateryjny', { voltage: 3000 });
    const dev = b.registry.get('0x3')!;
    expect(dev.voltage).toBeUndefined();
    expect(dev.raw_state).toEqual({ battery_voltage: 3000 });
  });

  it('urządzenie usunięte z Z2M znika z pulpitu, ponowne pojawienie się je przywraca', () => {
    b = createBackend(':memory:');
    msg(b, 'bridge/devices', bridgeDevices);
    msg(b, 'bridge/devices', bridgeDevices.filter((d) => d.ieee_address !== '0x2'));
    expect(b.registry.get('0x2')?.is_deleted).toBe(true);
    msg(b, 'bridge/devices', bridgeDevices);
    expect(b.registry.get('0x2')?.is_deleted).toBe(false);
  });

  it('availability i stan przysłane przed bridge/devices nie giną', () => {
    b = createBackend(':memory:');
    msg(b, 'Gniazdko/availability', { state: 'online' });
    msg(b, 'Gniazdko', { state: 'OFF' });
    msg(b, 'bridge/devices', bridgeDevices);
    const plug = b.registry.get('0x1')!;
    expect(plug.available).toBe(true);
    expect(plug.state).toBe('OFF');
  });

  it('cisza urządzenia Zigbee krótsza niż doba nie oznacza offline', () => {
    b = createBackend(':memory:');
    b.z2m.status.connected = true;
    msg(b, 'bridge/devices', bridgeDevices.map((d) => (d.ieee_address === '0x1' ? { ...d, power_source: 'Mains (single phase)' } : d)));
    const plug = b.registry.get('0x1')!;
    expect(plug.power_source).toBe('Mains (single phase)');
    plug.last_seen = new Date(Date.now() - 5 * 3600_000).toISOString();
    expect(b.registry.isOnline(plug)).toBe(true);
    plug.last_seen = new Date(Date.now() - 26 * 3600_000).toISOString();
    expect(b.registry.isOnline(plug)).toBe(false);
  });

  it('przełącznik wielokanałowy: kafelek pokazuje i steruje pierwszym kanałem', () => {
    b = createBackend(':memory:');
    msg(b, 'bridge/devices', [
      {
        ieee_address: '0x4',
        type: 'Router',
        friendly_name: 'Podwójny',
        definition: {
          model: 'TS0002',
          exposes: [
            { type: 'switch', endpoint: 'l1', features: [{ type: 'binary', property: 'state_l1', access: 7 }] },
            { type: 'switch', endpoint: 'l2', features: [{ type: 'binary', property: 'state_l2', access: 7 }] },
          ],
        },
      },
    ]);
    msg(b, 'Podwójny', { state_l1: 'ON', state_l2: 'OFF' });
    const dev = b.registry.get('0x4')!;
    expect(dev.state).toBe('ON');
    expect(b.z2m.buildSetPayload(dev, { state: 'OFF' })).toEqual({ state_l1: 'OFF' });
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

  it('gdy Zigbee2MQTT albo broker nie działa, zapamiętane "online" nie jest prawdą', () => {
    b = createBackend(':memory:');
    b.z2m.status.connected = true;
    msg(b, 'bridge/devices', bridgeDevices);
    msg(b, 'Gniazdko/availability', { state: 'online' });
    const plug = b.registry.get('0x1')!;
    expect(b.registry.isOnline(plug)).toBe(true);

    msg(b, 'bridge/state', { state: 'offline' });
    expect(b.registry.isOnline(plug)).toBe(false);
    expect(b.registry.toPublic(plug).connection_status).toBe('offline');

    msg(b, 'bridge/state', { state: 'online' });
    expect(b.registry.isOnline(plug)).toBe(true);
    b.z2m.status.connected = false;
    expect(b.registry.isOnline(plug)).toBe(false);
  });

  it('urządzenie wyłączone w Zigbee2MQTT znika z pulpitu i wraca po włączeniu', () => {
    b = createBackend(':memory:');
    msg(b, 'bridge/devices', bridgeDevices);
    msg(b, 'bridge/devices', bridgeDevices.map((d) => (d.ieee_address === '0x2' ? { ...d, disabled: true } : d)));
    expect(b.registry.get('0x2')?.is_deleted).toBe(true);
    expect(b.registry.auditLog()[0].message).toContain('wyłączone');
    msg(b, 'bridge/devices', bridgeDevices);
    expect(b.registry.get('0x2')?.is_deleted).toBe(false);
  });

  it('agregat godzinowy liczy też powtórzone wartości (średnia i liczba pomiarów)', () => {
    b = createBackend(':memory:');
    const t0 = Date.now() - 20 * 24 * 3600_000;
    // 9 razy 0 W i raz 1000 W w tej samej godzinie: średnia 100 W, a nie 500 W
    for (let i = 0; i < 9; i++) b.history.record('p', { power: 0 }, t0 + i * 1000);
    b.history.record('p', { power: 1000 }, t0 + 10_000);
    const { stats, points } = b.history.query('p', '30d', false);
    expect(stats.count).toBe(10);
    expect(points[0].power).toBe(100);
  });

  it('/set przepuszcza tylko atrybuty zapisywalne', () => {
    b = createBackend(':memory:');
    msg(b, 'bridge/devices', bridgeDevices);
    const plug = b.registry.get('0x1')!;
    expect(b.z2m.buildSetPayload(plug, { state: 'OFF', power: 5, temp_alarm_enabled: true })).toEqual({ state: 'OFF' });
  });

  it('BASIC-ZB1GSP: ustawienia ochrony przechodzą do Zigbee2MQTT, odczyt na żądanie pyta o wybrane atrybuty', () => {
    b = createBackend(':memory:');
    const zb1 = {
      ieee_address: '0x9',
      type: 'Router',
      friendly_name: 'Bojler',
      definition: {
        model: 'BASIC-ZB1GSP',
        vendor: 'SONOFF',
        exposes: [
          { type: 'switch', features: [{ type: 'binary', property: 'state', access: 7, value_on: 'ON', value_off: 'OFF' }] },
          { type: 'numeric', property: 'power', access: 5 },
          { type: 'numeric', property: 'total_energy', access: 5 },
          { type: 'binary', property: 'ac_current_max_overload_enable', access: 7, value_on: 'ON', value_off: 'OFF' },
          { type: 'numeric', property: 'ac_current_max_overload', access: 7, value_min: 0.1, value_max: 32 },
          {
            type: 'composite',
            property: 'inching_control_set',
            access: 2,
            features: [{ type: 'numeric', property: 'inching_time', access: 2 }],
          },
        ],
      },
    };
    msg(b, 'bridge/devices', [...bridgeDevices, zb1]);
    const dev = b.registry.get('0x9')!;
    expect(dev.category).toBe('plug');
    const inching = { inching_control: 'ENABLE', inching_time: 5, inching_mode: 'ON' };
    expect(
      b.z2m.buildSetPayload(dev, { ac_current_max_overload_enable: 'ON', ac_current_max_overload: 16, inching_control_set: inching, power: 1 }),
    ).toEqual({ ac_current_max_overload_enable: 'ON', ac_current_max_overload: 16, inching_control_set: inching });

    msg(b, 'Bojler', { state: 'ON', power: 1200, total_energy: 10.5, ac_current_max_overload: 16, ac_current_max_overload_enable: 'ON' });
    const after = b.registry.get('0x9')!;
    expect(after.total_energy).toBe(10.5);
    expect(after.ac_current_max_overload).toBe(16);
    expect(after.ac_current_max_overload_enable).toBe('ON');
  });

  it('odczyt na żądanie: domyślnie pomiary, z listą kluczy tylko wskazane i odczytywalne', () => {
    b = createBackend(':memory:');
    const exposes = [
      { type: 'numeric', property: 'power', access: 5 },
      { type: 'numeric', property: 'ac_power_max_overload', access: 7 },
      { type: 'composite', property: 'inching_control_set', access: 2, features: [] },
    ];
    expect(buildGetPayload(exposes)).toEqual({ power: '' });
    expect(buildGetPayload(exposes, ['ac_power_max_overload', 'inching_control_set'])).toEqual({ ac_power_max_overload: '' });
  });

  it('zużycie dzienne liczone z przyrostu licznika total_energy (dni lokalne)', () => {
    b = createBackend(':memory:');
    const day = (offset: number, hour: number) => {
      const d = new Date();
      d.setHours(hour, 0, 0, 0);
      d.setDate(d.getDate() - offset);
      return d.getTime();
    };
    // Przedwczoraj licznik 100 -> 102, wczoraj do 105, dziś do 105.5
    b.history.record('m', { total_energy: 100 }, day(2, 1));
    b.history.record('m', { total_energy: 102 }, day(2, 22));
    b.history.record('m', { total_energy: 103 }, day(1, 8));
    b.history.record('m', { total_energy: 105 }, day(1, 20));
    b.history.record('m', { total_energy: 105.5 }, day(0, 0));
    const days = b.history.dailyEnergy('m', 30);
    expect(days.map((d) => d.energy)).toEqual([2, 3, 0.5]);
    expect(b.history.dailyEnergy('m', 1).map((d) => d.energy)).toEqual([0.5]);
  });
});
