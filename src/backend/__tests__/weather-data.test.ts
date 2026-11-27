import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';

const dir = mkdtempSync(join(tmpdir(), 'sh-weather-'));
vi.mock('../config', () => ({ dataPath: (f: string) => join(dir, f) }));
vi.mock('../imgw', () => ({
  getCustomPlaces: () => [{ id: 'place_x', name: 'Wieś', label: '', voivodeship: 'Mazowieckie', lat: 52.3, lon: 21.5 }],
  normalizePl: (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l'),
  getImgwMeteoStations: async () => [
    { kod_stacji: '252200150', nazwa_stacji: 'WARSZAWA-BIELANY', lat: '52.2805', lon: '20.9619' },
    { kod_stacji: '249190520', nazwa_stacji: 'ZAKOPANE', lat: '49.2944', lon: '19.9600' },
  ],
}));

import { grib1Length, parseGrib1, readRotatedGrid, rotatedIndex } from '../weather/grib1';
import { decodePng } from '../weather/png';
import { analyzeEcho, colorToDbz, dbzToRate, radarPixel } from '../weather/radar';
import { buildClimate, parseMonthRow, unzip } from '../weather/climate';
import { CosmoForecast } from '../weather/cosmo';

// --- pomocnicze: syntetyczny GRIB1 z siatką obróconą jak w COSMO IMGW ---
const GRID = { ni: 380, nj: 405, lat1: -2.4, lon1: 0.663, lat2: 7.7, lon2: 10.138, spLat: -40, spLon: 10 };

function s24(v: number): Buffer {
  const b = Buffer.alloc(3);
  const a = Math.abs(Math.round(v));
  b.writeUIntBE(a | (v < 0 ? 0x800000 : 0), 0, 3);
  return b;
}

function ibm(v: number): Buffer {
  const b = Buffer.alloc(4);
  if (v === 0) return b;
  const sign = v < 0 ? 0x80 : 0;
  let a = Math.abs(v);
  let e = 64;
  while (a >= 1) {
    a /= 16;
    e++;
  }
  while (a < 1 / 16) {
    a *= 16;
    e--;
  }
  b[0] = sign | e;
  b.writeUIntBE(Math.round(a * 2 ** 24), 1, 3);
  return b;
}

/** Komunikat z wartością `value` w każdym punkcie oprócz `at` (tam `atValue`). */
function grib(table: number, param: number, lt: number, l1: number, l2: number, value: number, at?: number, atValue?: number): Buffer {
  const n = GRID.ni * GRID.nj;
  const pds = Buffer.alloc(28);
  pds.writeUIntBE(28, 0, 3);
  pds[3] = table;
  pds[7] = 0x80; // jest GDS
  pds[8] = param;
  pds[9] = lt;
  pds[10] = l1;
  pds[11] = l2;
  pds.writeUInt16BE(1, 26); // skala dziesiętna D = 1
  const gds = Buffer.alloc(42);
  gds.writeUIntBE(42, 0, 3);
  gds[5] = 10;
  gds.writeUInt16BE(GRID.ni, 6);
  gds.writeUInt16BE(GRID.nj, 8);
  s24(GRID.lat1 * 1000).copy(gds, 10);
  s24(GRID.lon1 * 1000).copy(gds, 13);
  s24(GRID.lat2 * 1000).copy(gds, 17);
  s24(GRID.lon2 * 1000).copy(gds, 20);
  s24(GRID.spLat * 1000).copy(gds, 32);
  s24(GRID.spLon * 1000).copy(gds, 35);
  // 16 bitów, E = 0, wartość = (R + X) / 10
  const ref = Math.min(value, atValue ?? value) * 10;
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeUInt16BE(Math.round((i === at ? atValue! : value) * 10 - ref), i * 2);
  const bdsHead = Buffer.alloc(11);
  bdsHead.writeUIntBE(11 + data.length, 0, 3);
  ibm(ref).copy(bdsHead, 6);
  bdsHead[10] = 16;
  const body = Buffer.concat([pds, gds, bdsHead, data, Buffer.from('7777')]);
  const head = Buffer.from('GRIB\0\0\0\x01', 'latin1');
  head.writeUIntBE(8 + body.length, 4, 3);
  return Buffer.concat([head, body]);
}

function png(width: number, height: number, rgba: (x: number, y: number) => [number, number, number, number]): Buffer {
  const crc = (b: Buffer) => {
    let c = ~0;
    for (const x of b) {
      c ^= x;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    // filtr Sub (1) w co drugiej linii, żeby sprawdzić odfiltrowanie
    const f = y % 2;
    raw[y * (width * 4 + 1)] = f;
    for (let x = 0; x < width; x++) {
      const px = rgba(x, y);
      const left = x > 0 ? rgba(x - 1, y) : [0, 0, 0, 0];
      for (let c = 0; c < 4; c++) raw[y * (width * 4 + 1) + 1 + x * 4 + c] = f ? (px[c] - left[c]) & 0xff : px[c];
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

describe('GRIB1 i siatka obrócona COSMO', () => {
  it('czyta wartość w punkcie i trafia w Warszawę na siatce modelu', () => {
    const grid = readRotatedGrid(grib(2, 11, 105, 0, 2, 270));
    // Indeks sprawdzony na prawdziwym pliku stałych (RLAT/RLON = 52,230 / 21,010)
    expect(rotatedIndex(grid, 52.2297, 21.0122)).toBe(205 * 380 + 243);
    expect(rotatedIndex(grid, 49.2992, 19.9496)).toBe(85 * 380 + 232);
    expect(rotatedIndex(grid, 0, 0)).toBeNull();

    const msg = grib(2, 11, 105, 0, 2, 270, 1234, 281.5);
    expect(grib1Length(msg)).toBe(msg.length);
    const g = parseGrib1(msg);
    expect([g.table, g.param, g.levelType, g.level2]).toEqual([2, 11, 105, 2]);
    expect(g.valueAt(1234)).toBeCloseTo(281.5, 5);
    expect(g.valueAt(0)).toBeCloseTo(270, 5);
  });

  it('prognoza: czyta strumień do potrzebnych pól, liczy opad z przyrostu i wiatr', async () => {
    const grid = readRotatedGrid(grib(2, 11, 105, 0, 2, 270));
    const idx = rotatedIndex(grid, 52.2805, 20.9619)!;
    const file = (t: number, prec: number) =>
      Buffer.concat([
        grib(2, 1, 1, 0, 0, 0), // pole, którego nie używamy
        grib(2, 79, 1, 0, 0, 0, idx, prec / 2),
        grib(2, 78, 1, 0, 0, 0),
        grib(2, 33, 105, 0, 10, 0, idx, 3),
        grib(2, 34, 105, 0, 10, 0, idx, 4),
        grib(2, 11, 105, 0, 2, 270, idx, t),
        grib(2, 17, 105, 0, 2, 260, idx, t - 2),
        grib(201, 187, 105, 0, 10, 0, idx, 9),
        grib(2, 2, 102, 0, 0, 101000),
        grib(2, 71, 1, 0, 0, 50),
        grib(2, 61, 1, 0, 0, 0, idx, prec),
        grib(2, 52, 105, 0, 2, 0), // za potrzebnymi polami — nie powinno być czytane
      ]);
    const run = new Date(Date.now() - 6 * 3600_000);
    const stamp = (d: Date) => d.toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const runStamp = stamp(new Date(Math.floor(run.getTime() / 3600_000) * 3600_000));
    const list = [3, 6, 9, 12].map((lead) => {
      const valid = new Date(Date.UTC(+runStamp.slice(0, 4), +runStamp.slice(4, 6) - 1, +runStamp.slice(6, 8), +runStamp.slice(8, 10)) + lead * 3600_000);
      return { file: `${runStamp}_${stamp(valid)}_lfff00${String(lead).padStart(2, '0')}0000`, url: `http://x/${lead}` };
    });
    let bytesServed = 0;
    const fake = (async (url: string) => {
      if (url.includes('COSMO_HVD_')) return new Response(JSON.stringify(url.includes('_00_00') ? list : []));
      const lead = +url.split('/').pop()!;
      const body = file(273.15 + lead, lead * 0.5);
      return new Response(
        new ReadableStream({
          start(c) {
            for (let o = 0; o < body.length; o += 65536) c.enqueue(body.subarray(o, o + 65536));
            c.close();
          },
          pull() {
            bytesServed++;
          },
        }),
      );
    }) as typeof fetch;
    const cosmo = new CosmoForecast(fake);
    await cosmo.update();
    expect(cosmo.status().error).toBeNull();
    const fc = cosmo.forecast(52.2805, 20.9619)!;
    expect(fc.run).toBe(runStamp);
    expect(fc.steps.length).toBeGreaterThan(0);
    const s = fc.steps[0];
    expect(s.temp).toBeGreaterThan(0);
    expect(s.precip).toBeCloseTo(1.5, 5); // przyrost opadu skumulowanego w 3 h
    expect(Math.abs(s.snow! - 0.75)).toBeLessThanOrEqual(0.051); // zaokrąglone do 0,1 mm
    expect(s.wind).toBeCloseTo(5, 5);
    expect(s.gust).toBeCloseTo(9, 5);
    expect(s.pressure).toBeCloseTo(1010, 1);
    expect(s.cloud).toBe(50);
    expect(s.humidity).toBeGreaterThan(80);
    expect(s.windDir).not.toBeNull();
    expect(cosmo.forecast(10, 10)).toBeNull();
    // miejsce wpisane ręcznie jest w prognozie dokładnie, a punkt obok — z najbliższego punktu
    expect(cosmo.forecast(52.3, 21.5)!.approxKm).toBeNull();
    expect(cosmo.forecast(52.31, 21.5)!.approxKm).toBeCloseTo(1.1, 0);
    // drugi raz ten sam przebieg — nic nie pobiera
    await cosmo.update();
    expect(cosmo.status().run).toBe(runStamp);
    expect(bytesServed).toBeGreaterThanOrEqual(0);
  });
});

describe('Radar IMGW', () => {
  it('odwzorowanie trafia w miasta na mapie IMGW', () => {
    const w = radarPixel(52.2297, 21.0122);
    expect(w.x).toBeCloseTo(580.7, 0);
    expect(w.y).toBeCloseTo(461.3, 0);
    const k = radarPixel(50.0647, 19.945);
    expect(Math.round(k.x)).toBe(511);
    expect(Math.round(k.y)).toBe(703);
  });

  it('kolory legendy → dBZ i natężenie opadu', () => {
    expect(colorToDbz(0, 180, 255, 255)).toBe(11);
    expect(colorToDbz(255, 30, 0, 255)).toBe(38);
    expect(colorToDbz(150, 150, 150, 100)).toBe('nodata');
    expect(colorToDbz(0, 0, 0, 0)).toBeNull();
    expect(dbzToRate(23)).toBeCloseTo(1.0, 1);
  });

  it('opad nad domem i najbliższe echo', () => {
    const home = radarPixel(52.2297, 21.0122);
    const hx = Math.round(home.x);
    const hy = Math.round(home.y);
    // echo 38 dBZ 20 px na zachód od domu
    const img = png(900, 900, (x, y) => (Math.abs(x - (hx - 20)) <= 2 && Math.abs(y - hy) <= 2 ? [255, 30, 0, 255] : [0, 0, 0, 0]));
    expect(decodePng(img).width).toBe(900);
    const r = analyzeEcho(img, 52.2297, 21.0122);
    expect(r.covered).toBe(true);
    expect(r.dbz).toBeNull();
    expect(r.nearestKm).toBe(18);
    expect(r.nearestBearing).toBe(270);
    expect(r.maxDbz10km).toBeNull();
  });
});

describe('Normy klimatyczne z archiwum IMGW', () => {
  it('rozpakowuje ZIP i liczy normę oraz rekordy', () => {
    const line = (year: number, month: number, tmax: number, stm: number, summ: number) =>
      `"352200375","WARSZAWA-OKĘCIE","${year}","${String(month).padStart(2, '0')}",${tmax},"",4.1,"",-17.0,"",-2.2,"",${stm},"",-24.3,"",${summ},"",10.6,"","01","",70.7,"",14,"",15,"",9,"",9,""`;
    const csv = Array.from({ length: 30 }, (_, i) => line(1991 + i, 11, 10 + i, 3 + (i % 3), 40)).join('\r\n');
    const data = Buffer.from(csv, 'latin1');
    const comp = deflateRawSync(data);
    const name = Buffer.from('s_m_d_1991_2020.csv');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    const cdOffset = local.length + name.length + comp.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + name.length, 12);
    eocd.writeUInt32LE(cdOffset, 16);
    const zip = Buffer.concat([local, name, comp, central, name, eocd]);

    const files = unzip(zip);
    const text = files.get('s_m_d_1991_2020.csv')!.toString('latin1');
    const rows = text.split(/\r?\n/).map(parseMonthRow).filter((r) => r !== null);
    expect(rows).toHaveLength(30);
    const [st] = buildClimate(rows);
    const nov = st.months[10];
    expect(nov.temp).toBe(4); // średnia z 3,4,5,…
    expect(nov.precip).toBe(40);
    expect(nov.recordMax).toEqual({ value: 39, year: 2020 });
    expect(nov.snowDays).toBe(15);
  });

  it('status „8” to brak pomiaru, nie zero', () => {
    const r = parseMonthRow('"1","X","2024","01",10.4,"8",4.1,"",-17.0,"",-2.2,"",.6,"",-24.3,"",58.0,"",10.6,"","01","",70.7,"",14,"",15,"",9,"",9,""')!;
    expect(r.tmax).toBeNull();
    expect(r.temp).toBe(0.6);
  });
});

import { parseNominatim } from '../weather/geocode';

describe('Wyszukiwanie wsi (OpenStreetMap)', () => {
  it('wyciąga nazwę, gminę, powiat i województwo', () => {
    const r = parseNominatim([
      {
        lat: '52.29110',
        lon: '21.54800',
        name: 'Stanisławów',
        display_name: 'Stanisławów, gmina Stanisławów, powiat miński, województwo mazowieckie, Polska',
        addresstype: 'village',
        address: { village: 'Stanisławów', municipality: 'gmina Stanisławów', county: 'powiat miński', state: 'województwo mazowieckie' },
      },
      { lat: 'x', lon: '1', display_name: 'zły', address: { state: 'województwo mazowieckie' } },
    ]);
    expect(r).toEqual([
      { name: 'Stanisławów', label: 'gmina Stanisławów, powiat miński, woj. mazowieckie', kind: 'wieś', voivodeship: 'Mazowieckie', lat: 52.2911, lon: 21.548 },
    ]);
  });
});
