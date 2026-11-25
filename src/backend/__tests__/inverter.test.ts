import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createBackend, type Backend } from '../context';
import { decodeLive, decodeSettings, encodeSettings, InverterValidationError, type Registers } from '../inverter/deye';
import { buildV5Request, crc16Modbus, modbusFromV5, readHoldingRtu, takeV5Frame } from '../inverter/solarman';

const LOGGER_SN = 1234567890;

/** Rejestry przykładowego falownika (wartości jak w opisie rejestrów Deye SG04LP3). */
function sampleRegisters(): Registers {
  const r: Registers = new Map();
  for (let a = 0; a < 700; a++) r.set(a, 0);
  const set = (a: number, v: number) => r.set(a, v < 0 ? v + 65536 : v);
  set(0, 5);
  'SN12345678'.match(/../g)!.forEach((p, i) => set(3 + i, (p.charCodeAt(0) << 8) | p.charCodeAt(1)));
  set(20, 60000); // 6000 W × 10
  // zegar: 2026-11-25 14:34:36
  set(62, (26 << 8) | 11);
  set(63, (25 << 8) | 14);
  set(64, (34 << 8) | 36);
  // ustawienia
  set(102, 200);
  set(108, 100);
  set(109, 100);
  set(115, 6);
  set(116, 20);
  set(117, 12);
  set(128, 60);
  set(130, 1);
  set(142, 2);
  set(143, 6000);
  set(145, 1);
  set(146, 255);
  [0, 600, 1000, 1400, 1800, 2200].forEach((v, i) => set(148 + i, v));
  for (let i = 0; i < 6; i++) {
    set(154 + i, 6000);
    set(166 + i, 15);
  }
  [3, 2, 2, 2, 2, 3].forEach((v, i) => set(172 + i, v));
  // dane bieżące
  set(500, 2);
  set(514, 18);
  set(515, 17);
  set(520, 64);
  set(526, 109);
  set(529, 61);
  set(534, 42859 % 65536);
  set(535, Math.floor(42859 / 65536));
  set(540, 1250);
  set(541, 1500);
  set(586, 1220);
  set(587, 5036);
  set(588, 15);
  set(590, 8);
  set(591, 19);
  set(598, 2419);
  set(599, 2365);
  set(600, 2359);
  set(609, 4995);
  set(616, 389);
  set(617, 158);
  set(618, 43);
  set(619, 590);
  set(636, 54);
  set(650, 358);
  set(651, 198);
  set(652, 76);
  set(653, 632);
  set(672, 11);
  set(673, 84);
  set(676, 1939);
  set(678, 3776);
  set(679, 2);
  return r;
}

/** Udawany logger Solarman: odpowiada na 0x03 i 0x10 dla swojego numeru seryjnego. */
function fakeLogger(regs: Registers, opts: { rejectWrites?: number[] } = {}): Promise<{ server: Server; port: number; writes: number[] }> {
  const writes: number[] = [];
  const server = createServer((sock) => {
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const t = takeV5Frame(buf);
        if (!t) return;
        buf = Buffer.from(t.rest);
        const req = t.frame;
        if (req.readUInt32LE(7) !== LOGGER_SN) continue; // obcy numer — logger milczy
        const rtu = req.subarray(26, req.length - 2);
        const [slave, fn] = [rtu[0], rtu[1]];
        const start = rtu.readUInt16BE(2);
        const count = rtu.readUInt16BE(4);
        let resp: Buffer;
        if (fn === 0x03) {
          resp = Buffer.alloc(3 + count * 2);
          resp[0] = slave;
          resp[1] = 0x03;
          resp[2] = count * 2;
          for (let i = 0; i < count; i++) resp.writeUInt16BE(regs.get(start + i) ?? 0, 3 + i * 2);
        } else {
          for (let i = 0; i < count; i++) {
            writes.push(start + i);
            if (!opts.rejectWrites?.includes(start + i)) regs.set(start + i, rtu.readUInt16BE(7 + i * 2));
          }
          resp = Buffer.from(rtu.subarray(0, 6));
        }
        const crc = crc16Modbus(resp);
        const modbus = Buffer.concat([resp, Buffer.from([crc & 0xff, crc >> 8])]);
        const payload = Buffer.concat([Buffer.from([0x02, 0x01]), Buffer.alloc(12), modbus]);
        const header = Buffer.alloc(11);
        header[0] = 0xa5;
        header.writeUInt16LE(payload.length, 1);
        header[3] = 0x10;
        header[4] = 0x15;
        header.writeUInt16LE(req.readUInt16LE(5), 5);
        header.writeUInt32LE(LOGGER_SN, 7);
        const body = Buffer.concat([header, payload]);
        let sum = 0;
        for (let i = 1; i < body.length; i++) sum += body[i];
        sock.write(Buffer.concat([body, Buffer.from([sum & 0xff, 0x15])]));
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as { port: number }).port, writes })));
}

describe('falownik: protokół Solarman V5', () => {
  it('buduje ramkę z poprawną sumą kontrolną i rozpoznaje ją w strumieniu', () => {
    const frame = buildV5Request(LOGGER_SN, 7, readHoldingRtu(1, 500, 60));
    expect(frame[0]).toBe(0xa5);
    expect(frame[frame.length - 1]).toBe(0x15);
    let sum = 0;
    for (let i = 1; i < frame.length - 2; i++) sum += frame[i];
    expect(frame[frame.length - 2]).toBe(sum & 0xff);
    const t = takeV5Frame(Buffer.concat([Buffer.from([0x00]), frame, frame.subarray(0, 5)]));
    expect(t?.frame.equals(frame)).toBe(true);
    expect(t?.rest.length).toBe(5);
  });

  it('odrzuca odpowiedź z innym numerem loggera i pustą ramkę Modbus', () => {
    const empty = Buffer.concat([Buffer.from([0xa5, 14, 0, 0x10, 0x15, 0, 0]), Buffer.alloc(4), Buffer.alloc(14), Buffer.from([0, 0x15])]);
    empty.writeUInt32LE(LOGGER_SN, 7);
    expect(() => modbusFromV5(empty, LOGGER_SN)).toThrow(/pusta ramka/);
    expect(() => modbusFromV5(empty, 42)).toThrow(/innym numerze/);
  });
});

describe('falownik: rejestry Deye', () => {
  it('dekoduje dane bieżące (znaki, skale, liczniki 32-bit)', () => {
    const live = decodeLive(sampleRegisters());
    expect(live.status_label).toBe('Praca');
    expect(live.inverter_time).toBe('2026-11-25 14:34:36');
    expect(live.pv_power).toBe(95);
    expect(live.battery_soc).toBe(15);
    expect(live.battery_voltage).toBe(50.36);
    expect(live.battery_temp).toBe(22);
    expect(live.grid_power).toBe(590);
    expect(live.grid_frequency).toBe(49.95);
    expect(live.load_power).toBe(632);
    expect(live.today.pv).toBe(6.1);
    expect(live.total.pv).toBe(4285.9);
    const r = sampleRegisters();
    r.set(619, 65536 - 1200); // oddawanie do sieci
    expect(decodeLive(r).grid_power).toBe(-1200);
  });

  it('dekoduje harmonogram i ustawienia', () => {
    const s = decodeSettings(sampleRegisters());
    expect(s.work_mode).toBe(2);
    expect(s.tou_enabled).toBe(true);
    expect(s.tou[0]).toEqual({ start: '00:00', power: 6000, soc: 15, grid_charge: true });
    expect(s.tou[5].start).toBe('22:00');
    expect(s.tou[1].grid_charge).toBe(false);
  });

  it('zapis: tylko zmienione rejestry, bez ruszania pozostałych bitów, z walidacją', () => {
    const regs = sampleRegisters();
    const tou = decodeSettings(regs).tou.map((t) => ({ ...t }));
    tou[1].grid_charge = true; // 2 (generator) → 3
    tou[0].soc = 30;
    const writes = encodeSettings({ tou, tou_enabled: false, work_mode: 2 }, regs, 6000);
    expect(writes.map((w) => [w.addr, w.value])).toEqual([
      [146, 254], // dni tygodnia zostają
      [166, 30],
      [173, 3],
    ]);
    expect(() => encodeSettings({ max_sell_power: 9000 }, regs, 6000)).toThrow(InverterValidationError);
    expect(() => encodeSettings({ battery_max_charge_current: 500 }, regs, 6000)).toThrow(/0–150/);
    tou[2].start = '05:00';
    expect(() => encodeSettings({ tou }, regs, 6000)).toThrow(/rosnąć/);
  });
});

describe('falownik: usługa (odczyt, wyszukiwanie, sterowanie, historia)', () => {
  let b: Backend;
  let server: Server | null = null;
  afterEach(() => {
    b?.stop();
    b?.db.close();
    server?.close();
    server = null;
  });

  it('odczytuje dane, zapisuje historię i liczniki dzienne', async () => {
    const logger = await fakeLogger(sampleRegisters());
    server = logger.server;
    b = createBackend(':memory:');
    b.inverter.updateConfig({ host: '127.0.0.1', port: logger.port, logger_serial: String(LOGGER_SN) });
    await b.inverter.poll();
    expect(b.inverter.status.connected).toBe(true);
    expect(b.inverter.info?.serial).toBe('SN12345678');
    expect(b.inverter.info?.rated_power).toBe(6000);
    expect(b.inverter.live?.load_power).toBe(632);
    b.inverter.store.flush();
    const h = b.inverter.store.history('24h');
    expect(h.points).toHaveLength(1);
    expect(h.points[0].pv_power).toBe(95);
    expect(b.inverter.store.daily(30)).toEqual([
      { day: '2026-11-25', pv: 6.1, load: 10.9, grid_import: 6.4, grid_export: 0, battery_charge: 1.8, battery_discharge: 1.7 },
    ]);
  });

  it('znajduje logger pod nowym adresem po zmianie IP', async () => {
    const logger = await fakeLogger(sampleRegisters());
    server = logger.server;
    b = createBackend(':memory:');
    b.inverter.updateConfig({ host: '10.255.255.1', port: logger.port, logger_serial: String(LOGGER_SN) });
    const host = await b.inverter.discover(['10.255.255.2', '127.0.0.1']);
    expect(host).toBe('127.0.0.1');
    expect(b.inverter.getConfig().host).toBe('127.0.0.1');
    expect(b.registry.auditLog()[0].message).toContain('nowym adresem 127.0.0.1');
  });

  it('nie zapisuje, dopóki sterowanie nie jest włączone; potem zapisuje i sprawdza odczytem', async () => {
    const regs = sampleRegisters();
    const logger = await fakeLogger(regs);
    server = logger.server;
    b = createBackend(':memory:');
    b.inverter.updateConfig({ host: '127.0.0.1', port: logger.port, logger_serial: String(LOGGER_SN) });
    await b.inverter.poll();

    await expect(b.inverter.applySettings({ max_sell_power: 3000 })).rejects.toThrow(/wyłączone/);
    expect(logger.writes).toEqual([]);

    b.inverter.updateConfig({ control_enabled: true });
    const res = await b.inverter.applySettings({ max_sell_power: 3000, work_mode: 2 });
    expect(logger.writes).toEqual([143]); // tryb pracy bez zmian — nie zapisujemy
    expect(res.settings.max_sell_power).toBe(3000);
    expect(b.registry.auditLog()[0].message).toContain('6000 → 3000');
  });

  it('zgłasza zmianę, której falownik nie przyjął', async () => {
    const logger = await fakeLogger(sampleRegisters(), { rejectWrites: [108] });
    server = logger.server;
    b = createBackend(':memory:');
    b.inverter.updateConfig({ host: '127.0.0.1', port: logger.port, logger_serial: String(LOGGER_SN), control_enabled: true });
    await b.inverter.poll();
    await expect(b.inverter.applySettings({ battery_max_charge_current: 50 })).rejects.toThrow(/nie przyjął/);
  });

  it('historia: średnie z okna 5 min i kubełki dla dłuższych zakresów', () => {
    b = createBackend(':memory:');
    const live = decodeLive(sampleRegisters());
    const t0 = Math.floor(Date.now() / 300_000) * 300_000 - 3600_000;
    b.inverter.store.add({ ...live, pv_power: 100 }, t0);
    b.inverter.store.add({ ...live, pv_power: 300 }, t0 + 60_000);
    b.inverter.store.add({ ...live, pv_power: 1000 }, t0 + 300_000); // kolejne okno — zapisuje poprzednie
    b.inverter.store.flush();
    const pts = b.inverter.store.history('24h').points;
    expect(pts.map((p) => p.pv_power)).toEqual([200, 1000]);
    expect(b.inverter.store.history('365d').points).toHaveLength(1);
    b.inverter.store.prune(0, Date.now() + 1000);
    expect(b.inverter.store.history('24h').points).toHaveLength(0);
  });
});

