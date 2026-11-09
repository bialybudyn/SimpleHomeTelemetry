import { describe, expect, it } from 'vitest';
import { applyFlatFields, buildGetPayload, categoryFromExposes, numericSamples, resolveTopic } from '../state-mapper';
import { buildSonoffRequests, decryptParams, encryptParams, normalizeSonoffParams, paramsFromTxt } from '../drivers/sonoff-protocol';
import { commandToDps, DEFAULT_PLUG_DP_MAP, dpMapFromCloud, normalizeTuyaDps } from '../drivers/tuya-protocol';
import type { Device, Z2mExpose } from '../../app/models/telemetry.models';

const plugExposes: Z2mExpose[] = [
  { type: 'switch', features: [{ type: 'binary', property: 'state', access: 7 }] },
  { type: 'numeric', property: 'power', access: 5 },
  { type: 'numeric', property: 'linkquality', access: 1 },
];

describe('state-mapper', () => {
  it('dopasowuje nazwy z ukośnikiem (najdłuższe dopasowanie)', () => {
    const names = ['salon', 'salon/termometr'];
    expect(resolveTopic('salon/termometr', names)).toEqual({ name: 'salon/termometr', rest: '' });
    expect(resolveTopic('salon/termometr/availability', names)).toEqual({ name: 'salon/termometr', rest: 'availability' });
    expect(resolveTopic('salon/set', names)).toEqual({ name: 'salon', rest: 'set' });
    expect(resolveTopic('kuchnia', names)).toBeNull();
  });

  it('/get zawiera tylko atrybuty z bitem GET', () => {
    expect(buildGetPayload(plugExposes)).toEqual({ state: '', power: '' });
    expect(buildGetPayload([{ type: 'numeric', property: 'temperature', access: 1 }])).toBeNull();
  });

  it('kategoria z exposes', () => {
    expect(categoryFromExposes(plugExposes)).toBe('plug');
    expect(categoryFromExposes([{ type: 'climate', features: [] }])).toBe('climate');
    expect(categoryFromExposes([{ type: 'binary', property: 'contact', access: 1 }])).toBe('contact');
    expect(categoryFromExposes([{ type: 'numeric', property: 'temperature', access: 1 }])).toBe('sensor');
  });

  it('mapuje stan na płaskie pola i próbki', () => {
    const dev = { ieee_address: 'x', friendly_name: 'x', model: '', last_seen: null, battery: null, linkquality: null, last_temperature: null, last_humidity: null } as Device;
    applyFlatFields(dev, { temperature: 21.5, humidity: 40, occupied_heating_setpoint: 22, state: 'ON', presence: true });
    expect(dev.last_temperature).toBe(21.5);
    expect(dev.last_humidity).toBe(40);
    expect(dev.current_heating_setpoint).toBe(22);
    expect(dev.occupancy).toBe(true);
    expect(numericSamples({ state: 'OFF', contact: true, temperature: 20, mode: 'auto', state_l2: 'ON' })).toEqual({
      state: 0,
      contact: 1,
      temperature: 20,
      state_l2: 1,
    });
  });
});

describe('Sonoff eWeLink LAN', () => {
  const key = '12345678-90ab-cdef-1234-567890abcdef';

  it('szyfruje i odszyfrowuje parametry (AES-128-CBC, klucz MD5(devicekey))', () => {
    const enc = encryptParams({ switch: 'on' }, key);
    expect(decryptParams(enc.data, enc.iv, key)).toEqual({ switch: 'on' });
  });

  it('odczytuje stan z rekordu TXT mDNS (dane podzielone na data1..data4)', () => {
    const enc = encryptParams({ switch: 'off', voltage: 23012, power: 1250, current: 54 }, key);
    const txt = { id: '1000abcdef', encrypt: 'true', iv: enc.iv, data1: enc.data.slice(0, 10), data2: enc.data.slice(10) };
    const params = paramsFromTxt(txt, key)!;
    expect(normalizeSonoffParams(params)).toEqual({ state: 'OFF', voltage: 230.12, power: 12.5, current: 0.54 });
    expect(paramsFromTxt(txt, null)).toBeNull();
  });

  it('tryb DIY: dane jawne', () => {
    expect(paramsFromTxt({ encrypt: 'false', data1: '{"switch":"on"}' })).toEqual({ switch: 'on' });
  });

  it('kanały wielokanałowe i polecenia', () => {
    expect(normalizeSonoffParams({ switches: [{ outlet: 0, switch: 'on' }, { outlet: 1, switch: 'off' }] })).toEqual({
      state: 'ON',
      state_l1: 'ON',
      state_l2: 'OFF',
    });
    expect(buildSonoffRequests({ state: 'ON' }, false)).toEqual([{ cmd: 'switch', params: { switch: 'on' } }]);
    expect(buildSonoffRequests({ state: 'OFF' }, true)).toEqual([{ cmd: 'switches', params: { switches: [{ outlet: 0, switch: 'off' }], operSide: 1 } }]);
    expect(buildSonoffRequests({ power_on_behavior: 'previous' }, false)).toEqual([{ cmd: 'startup', params: { startup: 'stay' } }]);
  });
});

describe('Tuya DP', () => {
  it('normalizuje DP gniazdka ze skalą', () => {
    const state = normalizeTuyaDps({ '1': true, '18': 540, '19': 1250, '20': 2301, '17': 1234 }, DEFAULT_PLUG_DP_MAP);
    expect(state).toMatchObject({ state: 'ON', current: 0.54, power: 125, voltage: 230.1, energy: 1.234, dp_1: true });
  });

  it('mapa DP z chmury i polecenia wentylatora', () => {
    const map = dpMapFromCloud([
      { dpId: 1, statusCode: 'switch', valueType: 'Boolean', valueDesc: '{}' },
      { dpId: 3, statusCode: 'fan_speed', valueType: 'Integer', valueDesc: '{"min":1,"max":12,"scale":0}' },
      { dpId: 8, statusCode: 'switch_horizontal', valueType: 'Boolean', valueDesc: '{}' },
      { dpId: 2, statusCode: 'mode', valueType: 'Enum', valueDesc: '{"range":["normal","sleep"]}' },
    ]);
    expect(normalizeTuyaDps({ '1': true, '3': 5, '8': false, '2': 'sleep' }, map)).toMatchObject({
      state: 'ON',
      fan_speed: 5,
      fan_oscillation: false,
      fan_mode: 'sleep',
    });
    expect(commandToDps({ state: 'OFF', fan_speed: 7, fan_oscillation: true, fan_mode: 'normal' }, map)).toEqual({
      '1': false,
      '3': 7,
      '8': true,
      '2': 'normal',
    });
  });

  it('bez mapy: surowe dp_<id> i dps', () => {
    expect(commandToDps({ dp_101: true, dps: { '5': 2 } }, null)).toEqual({ '101': true, '5': 2 });
    expect(commandToDps({ fan_speed: 3 }, null)).toEqual({});
  });
});
