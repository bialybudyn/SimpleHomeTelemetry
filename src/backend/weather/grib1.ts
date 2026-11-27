/**
 * Minimalny odczyt GRIB1 (prosty zapis bitowy, siatka obrócona lat/lon) — tyle, ile trzeba,
 * żeby z pliku modelu COSMO IMGW wyjąć wartości w kilku punktach.
 */

export interface Grib1Message {
  /** Tabela parametrów (2 = WMO, 201 = DWD/COSMO). */
  table: number;
  param: number;
  levelType: number;
  level1: number;
  level2: number;
  /** Wartość w punkcie siatki o podanym indeksie (j * Ni + i). */
  valueAt(index: number): number | null;
  ni: number;
  nj: number;
}

function ibmFloat(b: Buffer, o: number): number {
  const sign = b[o] & 0x80 ? -1 : 1;
  const exp = (b[o] & 0x7f) - 64;
  const mant = b.readUIntBE(o + 1, 3);
  return sign * mant * Math.pow(16, exp - 6);
}

function signed16(b: Buffer, o: number): number {
  const v = b.readUInt16BE(o);
  return v & 0x8000 ? -(v & 0x7fff) : v;
}

export function signed24(b: Buffer, o: number): number {
  const v = b.readUIntBE(o, 3);
  return v & 0x800000 ? -(v & 0x7fffff) : v;
}

/** Długość komunikatu z nagłówka „GRIB” (null, jeśli to nie jest początek komunikatu GRIB1). */
export function grib1Length(buf: Buffer, offset = 0): number | null {
  if (buf.length < offset + 8) return null;
  if (buf.toString('latin1', offset, offset + 4) !== 'GRIB' || buf[offset + 7] !== 1) return null;
  return buf.readUIntBE(offset + 4, 3);
}

export function parseGrib1(msg: Buffer): Grib1Message {
  const pds = 8;
  const pdsLen = msg.readUIntBE(pds, 3);
  const flags = msg[pds + 7];
  const table = msg[pds + 3];
  const param = msg[pds + 8];
  const levelType = msg[pds + 9];
  const level1 = msg[pds + 10];
  const level2 = msg[pds + 11];
  const decimalScale = signed16(msg, pds + 26);

  const gds = pds + pdsLen;
  const gdsLen = flags & 0x80 ? msg.readUIntBE(gds, 3) : 0;
  const ni = gdsLen ? msg.readUInt16BE(gds + 6) : 0;
  const nj = gdsLen ? msg.readUInt16BE(gds + 8) : 0;
  const bms = gds + gdsLen;
  const bmsLen = flags & 0x40 ? msg.readUIntBE(bms, 3) : 0;
  const bds = bms + bmsLen;
  const bdsFlags = msg[bds + 3];
  const binaryScale = signed16(msg, bds + 4);
  const ref = ibmFloat(msg, bds + 6);
  const bits = msg[bds + 10];
  const data = bds + 11;

  if (bmsLen) throw new Error('GRIB1: mapa bitowa nie jest obsługiwana');
  if (bdsFlags & 0xc0) throw new Error('GRIB1: obsługiwany jest tylko prosty zapis punktów siatki');

  const scale = Math.pow(2, binaryScale);
  const dscale = Math.pow(10, -decimalScale);
  return {
    table,
    param,
    levelType,
    level1,
    level2,
    ni,
    nj,
    valueAt(index: number): number | null {
      if (index < 0 || index >= ni * nj) return null;
      if (bits === 0) return ref * dscale;
      const bitPos = index * bits;
      let x = 0;
      for (let k = 0; k < bits; k++) {
        const p = bitPos + k;
        const byte = msg[data + (p >> 3)];
        x = x * 2 + ((byte >> (7 - (p & 7))) & 1);
      }
      return (ref + x * scale) * dscale;
    },
  };
}

/** Siatka obrócona COSMO IMGW (2,8 km), sprawdzona na polach RLAT/RLON z pliku stałych. */
export interface RotatedGrid {
  ni: number;
  nj: number;
  /** Pierwszy punkt w układzie obróconym [°]. */
  lat1: number;
  lon1: number;
  dlat: number;
  dlon: number;
  /** Biegun południowy układu obróconego. */
  southPoleLat: number;
  southPoleLon: number;
}

export function readRotatedGrid(msg: Buffer): RotatedGrid {
  const pds = 8;
  const pdsLen = msg.readUIntBE(pds, 3);
  const g = pds + pdsLen;
  const type = msg[g + 5];
  if (type !== 10) throw new Error(`GRIB1: nieoczekiwany typ siatki ${type}`);
  const ni = msg.readUInt16BE(g + 6);
  const nj = msg.readUInt16BE(g + 8);
  const lat1 = signed24(msg, g + 10) / 1000;
  const lon1 = signed24(msg, g + 13) / 1000;
  const lat2 = signed24(msg, g + 17) / 1000;
  const lon2 = signed24(msg, g + 20) / 1000;
  return {
    ni,
    nj,
    lat1,
    lon1,
    dlat: (lat2 - lat1) / (nj - 1),
    dlon: (lon2 - lon1) / (ni - 1),
    southPoleLat: signed24(msg, g + 32) / 1000,
    southPoleLon: signed24(msg, g + 35) / 1000,
  };
}

/** Najbliższy punkt siatki obróconej dla współrzędnych geograficznych (lub null poza obszarem modelu). */
export function rotatedIndex(grid: RotatedGrid, lat: number, lon: number): number | null {
  const rad = Math.PI / 180;
  const th = (90 + grid.southPoleLat) * rad;
  const ph = grid.southPoleLon * rad;
  const la = lat * rad;
  const lo = lon * rad;
  const x = Math.cos(la) * Math.cos(lo - ph);
  const y = Math.cos(la) * Math.sin(lo - ph);
  const z = Math.sin(la);
  const x2 = Math.cos(th) * x + Math.sin(th) * z;
  const z2 = -Math.sin(th) * x + Math.cos(th) * z;
  const rlat = Math.asin(z2) / rad;
  const rlon = Math.atan2(y, x2) / rad;
  const i = Math.round((rlon - grid.lon1) / grid.dlon);
  const j = Math.round((rlat - grid.lat1) / grid.dlat);
  if (i < 0 || j < 0 || i >= grid.ni || j >= grid.nj) return null;
  return j * grid.ni + i;
}
