import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Db } from '../db';
import { JpegSplitter } from '../cctv/mjpeg';
import { CctvService, CctvValidationError, explainFfmpegError, ffmpegArgs, maskUrl, resolveUrl } from '../cctv/service';

const jpeg = (fill: number, len = 20) => Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(len, fill), Buffer.from([0xff, 0xd9])]);

/** Udawany proces ffmpeg: testy piszą do jego stdout/stderr i kończą go ręcznie. */
class FakeProc extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;
  constructor(readonly args: string[]) {
    super();
  }
  kill(): boolean {
    this.killed = true;
    this.finish(null);
    return true;
  }
  finish(code: number | null): void {
    if (this.exitCode !== null) return;
    this.exitCode = code ?? 137;
    this.emit('exit', code);
  }
}

describe('CCTV: podgląd RTSP bez zapisu', () => {
  let db: Db;
  let procs: FakeProc[];
  let cctv: CctvService;

  beforeEach(() => {
    db = new Db(':memory:');
    procs = [];
    cctv = new CctvService(db, {
      spawn: (args) => {
        const p = new FakeProc(args);
        procs.push(p);
        return p as unknown as ChildProcess;
      },
    });
  });

  afterEach(() => {
    cctv.stop();
    db.close();
    vi.useRealTimers();
  });

  it('dzieli strumień MJPEG na klatki także na granicy kawałków', () => {
    const s = new JpegSplitter();
    const a = jpeg(1);
    const b = jpeg(2);
    const all = Buffer.concat([Buffer.from([0x00, 0x11]), a, b]);
    expect(s.push(all.subarray(0, 15))).toEqual([]);
    const frames = [...s.push(all.subarray(15, 30)), ...s.push(all.subarray(30))];
    expect(frames).toEqual([a, b]);
  });

  it('ffmpeg pisze tylko na stdout — bez żadnego pliku wyjściowego', () => {
    const args = ffmpegArgs('rtsp://u:p@10.0.0.5/s', 'sub');
    expect(args.slice(-3)).toEqual(['-f', 'image2pipe', 'pipe:1']);
    expect(args.filter((a) => a.startsWith('/') || a.includes('.jpg') || a.includes('.mp4'))).toEqual([]);
    expect(args).toContain('-an');
  });

  it('hasło kamery nie wychodzi z serwera i zostaje przy zapisie zamaskowanego adresu', () => {
    expect(maskUrl('rtsp://admin:tajne@10.0.0.5:554/a')).toBe('rtsp://admin:••••••@10.0.0.5:554/a');
    expect(maskUrl('rtsp://10.0.0.5/a')).toBe('rtsp://10.0.0.5/a');

    const cam = cctv.add({ name: 'Wjazd', url: 'rtsp://admin:tajne@10.0.0.5:554/a' });
    expect(cam.url).toBe('rtsp://admin:••••••@10.0.0.5:554/a');
    expect(JSON.stringify(cctv.cameras())).not.toContain('tajne');

    cctv.update(cam.id, { name: 'Brama', url: cam.url });
    expect(db.getSetting<{ url: string }[]>('cctv_cameras', [])[0].url).toBe('rtsp://admin:tajne@10.0.0.5:554/a');
    // Zmieniony host z zamaskowanym hasłem: trzeba wpisać hasło od nowa
    expect(() => cctv.update(cam.id, { url: 'rtsp://admin:••••••@10.0.0.6:554/a' })).toThrow(CctvValidationError);
    expect(() => resolveUrl('rtsp://a:••••••@h/x', undefined)).toThrow(CctvValidationError);
  });

  it('sprawdza adresy i limit 9 kamer', () => {
    expect(() => cctv.add({ name: 'X', url: 'http://10.0.0.5/a' })).toThrow(/rtsp/);
    expect(() => cctv.add({ name: '', url: 'rtsp://10.0.0.5/a' })).toThrow(/Nazwa/);
    for (let i = 0; i < 9; i++) cctv.add({ name: `K${i}`, url: `rtsp://10.0.0.${i}/a` });
    expect(() => cctv.add({ name: 'K10', url: 'rtsp://10.0.0.10/a' })).toThrow(/9/);
  });

  it('jeden ffmpeg na strumień dla wielu widzów, zatrzymany po odejściu ostatniego', () => {
    vi.useFakeTimers();
    const cam = cctv.add({ name: 'Ogród', url: 'rtsp://10.0.0.5/main', sub_url: 'rtsp://10.0.0.5/sub' });
    const a: Buffer[] = [];
    const b: Buffer[] = [];
    const sa = cctv.subscribe(cam.id, 'sub', (f) => a.push(f));
    const sb = cctv.subscribe(cam.id, 'sub', (f) => b.push(f));
    expect(procs).toHaveLength(1);
    expect(procs[0].args).toContain('rtsp://10.0.0.5/sub');

    procs[0].stdout.write(jpeg(7));
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(cctv.status()[cam.id].sub?.state).toBe('live');

    if ('unsubscribe' in sa) sa.unsubscribe();
    if ('unsubscribe' in sb) sb.unsubscribe();
    expect(procs[0].killed).toBe(false);
    vi.advanceTimersByTime(9000);
    expect(procs[0].killed).toBe(true);
    expect(cctv.status()[cam.id]).toBeUndefined();

    // Powiększenie używa strumienia głównego
    cctv.subscribe(cam.id, 'main', () => undefined);
    expect(procs[1].args).toContain('rtsp://10.0.0.5/main');
  });

  it('błąd kamery jest opisany i strumień jest ponawiany', () => {
    vi.useFakeTimers();
    const cam = cctv.add({ name: 'Garaż', url: 'rtsp://10.0.0.7/a' });
    cctv.subscribe(cam.id, 'sub', () => undefined);
    procs[0].stderr.write('[rtsp] method DESCRIBE failed: 401 Unauthorized\n');
    procs[0].finish(1);
    expect(cctv.status()[cam.id].sub?.error).toBe('Kamera odrzuciła login lub hasło.');
    vi.advanceTimersByTime(2500);
    expect(procs).toHaveLength(2);
    expect(explainFfmpegError('Error: spawn ffmpeg ENOENT')).toContain('ffmpeg');
  });

  it('test połączenia zwraca jedną klatkę jako obraz', async () => {
    const pending = cctv.test({ url: 'rtsp://10.0.0.9/a' });
    expect(procs[0].args).toContain('-frames:v');
    procs[0].stdout.write(jpeg(3));
    const res = await pending;
    expect(res.success).toBe(true);
    expect(Buffer.from(res.image!, 'base64')).toEqual(jpeg(3));
  });
});
