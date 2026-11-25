import { Socket } from 'node:net';

/**
 * Protokół Solarman V5: ramka Modbus RTU opakowana w nagłówek loggera Wi-Fi (port 8899).
 * Logger nie ma hasła — wymaga tylko swojego numeru seryjnego w każdej ramce.
 *
 * Zapytanie:  A5 | dł. payloadu (LE16) | 10 45 | sekwencja (LE16) | SN loggera (LE32)
 *             | 02 | 00 00 | 3 × 4 B zer | ramka Modbus RTU | suma kontrolna | 15
 * Odpowiedź:  A5 | dł. | 10 15 | sekwencja | SN | 02 | status | 3 × 4 B | ramka Modbus RTU | suma | 15
 */

const START = 0xa5;
const END = 0x15;
const HEADER_LEN = 11;
/** Początek ramki Modbus w odpowiedzi (nagłówek 11 B + typ, status i trzy czasy 14 B). */
const RESPONSE_MODBUS_OFFSET = 25;

export class SolarmanError extends Error {}

export function crc16Modbus(data: Uint8Array): number {
  let crc = 0xffff;
  for (const b of data) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

/** Dokleja CRC16 (młodszy bajt pierwszy) do ramki Modbus RTU. */
function withCrc(frame: Buffer): Buffer {
  const crc = crc16Modbus(frame);
  return Buffer.concat([frame, Buffer.from([crc & 0xff, crc >> 8])]);
}

export function readHoldingRtu(slave: number, start: number, count: number): Buffer {
  const f = Buffer.alloc(6);
  f.writeUInt8(slave, 0);
  f.writeUInt8(0x03, 1);
  f.writeUInt16BE(start, 2);
  f.writeUInt16BE(count, 4);
  return withCrc(f);
}

/** Zapis rejestrów funkcją 0x10 (Deye nie obsługuje pojedynczego zapisu 0x06 we wszystkich rejestrach). */
export function writeMultipleRtu(slave: number, start: number, values: number[]): Buffer {
  const f = Buffer.alloc(7 + values.length * 2);
  f.writeUInt8(slave, 0);
  f.writeUInt8(0x10, 1);
  f.writeUInt16BE(start, 2);
  f.writeUInt16BE(values.length, 4);
  f.writeUInt8(values.length * 2, 6);
  values.forEach((v, i) => f.writeUInt16BE(v & 0xffff, 7 + i * 2));
  return withCrc(f);
}

export function buildV5Request(loggerSerial: number, seq: number, modbus: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from([0x02, 0x00, 0x00]), Buffer.alloc(12), modbus]);
  const header = Buffer.alloc(HEADER_LEN);
  header.writeUInt8(START, 0);
  header.writeUInt16LE(payload.length, 1);
  header.writeUInt8(0x10, 3);
  header.writeUInt8(0x45, 4);
  header.writeUInt16LE(seq & 0xffff, 5);
  header.writeUInt32LE(loggerSerial >>> 0, 7);
  const body = Buffer.concat([header, payload]);
  let sum = 0;
  for (let i = 1; i < body.length; i++) sum += body[i];
  return Buffer.concat([body, Buffer.from([sum & 0xff, END])]);
}

/** Wyjmuje kompletną ramkę V5 z bufora (albo null, jeśli jeszcze nie doszła cała). */
export function takeV5Frame(buf: Buffer): { frame: Buffer; rest: Buffer } | null {
  const start = buf.indexOf(START);
  if (start < 0 || buf.length - start < HEADER_LEN) return null;
  const len = buf.readUInt16LE(start + 1);
  const total = HEADER_LEN + len + 2;
  if (buf.length - start < total) return null;
  return { frame: buf.subarray(start, start + total), rest: buf.subarray(start + total) };
}

/** Z ramki odpowiedzi V5 wyciąga ramkę Modbus RTU i sprawdza jej CRC. */
export function modbusFromV5(frame: Buffer, loggerSerial: number): Buffer {
  if (frame[0] !== START || frame[frame.length - 1] !== END) throw new SolarmanError('Uszkodzona ramka loggera.');
  if (frame[3] !== 0x10 || frame[4] !== 0x15) throw new SolarmanError(`Nieoczekiwany typ ramki loggera 0x${frame[4].toString(16)}${frame[3].toString(16)}.`);
  if (frame.readUInt32LE(7) !== loggerSerial >>> 0) throw new SolarmanError('Odpowiedź od loggera o innym numerze seryjnym.');
  const rtu = frame.subarray(RESPONSE_MODBUS_OFFSET, frame.length - 2);
  if (rtu.length < 5) throw new SolarmanError('Logger nie dostał odpowiedzi od falownika (pusta ramka Modbus).');
  const crc = crc16Modbus(rtu.subarray(0, rtu.length - 2));
  if (rtu.readUInt16LE(rtu.length - 2) !== crc) throw new SolarmanError('Błędna suma CRC odpowiedzi Modbus.');
  if (rtu[1] & 0x80) throw new SolarmanError(`Falownik odrzucił polecenie (wyjątek Modbus ${rtu[2]}).`);
  return rtu;
}

export interface SolarmanTarget {
  host: string;
  port: number;
  loggerSerial: number;
  slave: number;
}

/**
 * Jedno połączenie z loggerem: kolejne zapytania idą po kolei (logger źle znosi równoległe).
 * Połączenie otwieramy na czas jednego cyklu odczytu, żeby nie blokować chmury Solarman.
 */
export class SolarmanConnection {
  private socket: Socket | null = null;
  private buffer = Buffer.alloc(0);
  private seq = Math.floor(Math.random() * 0xff);
  private waiter: ((frame: Buffer | Error) => void) | null = null;

  constructor(
    readonly target: SolarmanTarget,
    private readonly timeoutMs = 5000,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = new Socket();
      const fail = (err: Error) => {
        s.destroy();
        reject(err);
      };
      s.setTimeout(this.timeoutMs, () => fail(new SolarmanError(`Brak odpowiedzi od ${this.target.host}:${this.target.port}.`)));
      s.once('error', fail);
      s.connect(this.target.port, this.target.host, () => {
        s.off('error', fail);
        s.setTimeout(0);
        s.on('error', (err) => this.waiter?.(err));
        s.on('close', () => this.waiter?.(new SolarmanError('Logger zamknął połączenie.')));
        s.on('data', (d) => this.onData(d));
        this.socket = s;
        resolve();
      });
    });
  }

  close(): void {
    this.socket?.destroy();
    this.socket = null;
  }

  private onData(d: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, d]);
    for (;;) {
      const taken = takeV5Frame(this.buffer);
      if (!taken) return;
      this.buffer = Buffer.from(taken.rest);
      // Logger wysyła też własne ramki (heartbeat) — interesują nas tylko odpowiedzi 0x1510
      if (taken.frame[3] === 0x10 && taken.frame[4] === 0x15) this.waiter?.(Buffer.from(taken.frame));
    }
  }

  private request(rtu: Buffer): Promise<Buffer> {
    const socket = this.socket;
    if (!socket) return Promise.reject(new SolarmanError('Brak połączenia z loggerem.'));
    this.seq = (this.seq + 1) & 0xffff;
    const frame = buildV5Request(this.target.loggerSerial, this.seq, rtu);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        reject(new SolarmanError('Logger nie odpowiedział na czas.'));
      }, this.timeoutMs);
      this.waiter = (res) => {
        clearTimeout(timer);
        this.waiter = null;
        if (res instanceof Error) return reject(res);
        try {
          resolve(modbusFromV5(res, this.target.loggerSerial));
        } catch (err) {
          reject(err);
        }
      };
      socket.write(frame);
    });
  }

  /** Odczyt rejestrów (funkcja 0x03). Jedna ponowna próba — logger czasem gubi odpowiedź. */
  async readHolding(start: number, count: number): Promise<number[]> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const rtu = await this.request(readHoldingRtu(this.target.slave, start, count));
        if (rtu[1] !== 0x03) throw new SolarmanError(`Nieoczekiwana funkcja Modbus ${rtu[1]}.`);
        const n = rtu[2];
        if (n !== count * 2) throw new SolarmanError(`Falownik zwrócił ${n / 2} rejestrów zamiast ${count}.`);
        const out: number[] = [];
        for (let i = 0; i < count; i++) out.push(rtu.readUInt16BE(3 + i * 2));
        return out;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }

  /** Zapis rejestrów (funkcja 0x10). Bez ponawiania — powtórny zapis rozstrzyga odczyt kontrolny. */
  async writeMultiple(start: number, values: number[]): Promise<void> {
    const rtu = await this.request(writeMultipleRtu(this.target.slave, start, values));
    if (rtu[1] !== 0x10 || rtu.readUInt16BE(2) !== start || rtu.readUInt16BE(4) !== values.length) {
      throw new SolarmanError('Falownik nie potwierdził zapisu.');
    }
  }
}

/** Otwiera połączenie, wykonuje zadanie i zawsze je zamyka. */
export async function withSolarman<T>(target: SolarmanTarget, job: (c: SolarmanConnection) => Promise<T>, timeoutMs = 5000): Promise<T> {
  const c = new SolarmanConnection(target, timeoutMs);
  await c.connect();
  try {
    return await job(c);
  } finally {
    c.close();
  }
}
