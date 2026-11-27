import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db';
import { JpegSplitter } from './mjpeg';

/**
 * Podgląd kamer RTSP na żywo. Nic nie jest nagrywane: ffmpeg czyta strumień z kamery, przerabia go
 * w pamięci na klatki JPEG i oddaje je przez stdout, a serwis rozsyła je oglądającym.
 * ffmpeg dostaje tylko wyjście na pipe — nie ma żadnego pliku wyjściowego.
 * Strumień działa tylko wtedy, gdy ktoś go ogląda.
 */

export const MAX_CAMERAS = 9;
export type Quality = 'sub' | 'main';

export interface CameraConfig {
  id: string;
  name: string;
  /** Strumień główny (pełna rozdzielczość) — powiększony podgląd. */
  url: string;
  /** Strumień pomocniczy (niska rozdzielczość) — kafelek siatki. Pusty = główny, zmniejszony. */
  sub_url: string;
  enabled: boolean;
}

/** Kamera bez haseł w adresach — tak wychodzi do przeglądarki. */
export type PublicCamera = CameraConfig;

export interface StreamStatus {
  state: 'idle' | 'starting' | 'live' | 'error';
  error: string | null;
  viewers: number;
  fps: number;
}

export class CctvValidationError extends Error {}

/**
 * fps to górny limit: wolniejsza kamera idzie ze swoją prędkością (klatki nigdy nie są dublowane).
 * Wartości są dzielnikami 30 — przy 30 kl/s z kamery odstępy między klatkami są równe.
 */
const QUALITY: Record<Quality, { fps: number; width: number; q: number }> = {
  sub: { fps: 15, width: 640, q: 8 },
  main: { fps: 30, width: 1920, q: 6 },
};

/** Ile procesów ffmpeg może działać naraz (9 kafelków + powiększenia z kilku ekranów). */
const MAX_STREAMS = 14;
/** Po odejściu ostatniego widza strumień trwa jeszcze chwilę (np. przełączenie kafelek ↔ powiększenie). */
const IDLE_STOP_MS = 8000;
/** Kamera nie dała klatki tak długo = zawieszony ffmpeg, restartujemy. */
const STALL_MS = 20_000;

const PASSWORD_RE = /^(rtsps?:\/\/[^:/@\s]*:)([^@\s]*)(@)/i;
const MASK = '••••••';

/** Ukrywa hasło w adresie RTSP (rtsp://user:hasło@host → rtsp://user:••••••@host). */
export function maskUrl(url: string): string {
  return url.replace(PASSWORD_RE, (_m, a: string, _p: string, c: string) => `${a}${MASK}${c}`);
}

/**
 * Adres z formularza: jeśli zawiera zamaskowane hasło i poza nim nie różni się od zapisanego,
 * zostaje zapisane hasło (przeglądarka nigdy go nie widzi).
 */
export function resolveUrl(input: string, stored: string | undefined): string {
  if (!input.includes(MASK)) return input;
  if (stored && maskUrl(stored) === input) return stored;
  throw new CctvValidationError('Adres zmienił się — wpisz ponownie hasło do kamery.');
}

function validateUrl(url: string, field: string, required: boolean): string {
  const v = url.trim();
  if (!v) {
    if (required) throw new CctvValidationError(`${field}: podaj adres RTSP kamery.`);
    return '';
  }
  if (!/^rtsps?:\/\/[^\s/]+/i.test(v)) throw new CctvValidationError(`${field}: adres musi zaczynać się od rtsp:// lub rtsps://.`);
  if (v.length > 500) throw new CctvValidationError(`${field}: adres jest za długi.`);
  return v;
}

/** Zamienia komunikat ffmpeg na zrozumiały opis problemu. */
export function explainFfmpegError(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('enoent')) return 'Na serwerze nie ma programu ffmpeg (apt install ffmpeg).';
  if (t.includes('401') || t.includes('unauthorized')) return 'Kamera odrzuciła login lub hasło.';
  if (t.includes('404') || t.includes('not found')) return 'Kamera nie ma strumienia pod tą ścieżką.';
  if (t.includes('connection refused')) return 'Kamera odmówiła połączenia (zły port RTSP?).';
  if (t.includes('timed out') || t.includes('timeout')) return 'Kamera nie odpowiada (zły adres albo jest wyłączona).';
  if (t.includes('no route to host') || t.includes('network is unreachable')) return 'Brak trasy do kamery w sieci.';
  const line = text.trim().split('\n').filter(Boolean).pop() ?? '';
  return line ? `Błąd strumienia: ${line.slice(0, 200)}` : 'Strumień się zakończył.';
}

export function ffmpegArgs(url: string, quality: Quality, frames?: number): string[] {
  const { fps, width, q } = QUALITY[quality];
  // Filtr fps dorabiałby brakujące klatki (25 kl/s → 30 kl/s); select tylko pomija nadmiarowe.
  // Próg 0,9 odstępu: drobne wahania znaczników czasu z RTSP nie gubią klatek.
  const minGap = (0.9 / fps).toFixed(4);
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    ...(url.toLowerCase().startsWith('rtsp://') ? ['-rtsp_transport', 'tcp'] : []),
    '-timeout', '10000000',
    '-i', url,
    '-an', '-sn', '-dn',
    '-vf', `select='isnan(prev_selected_t)+gte(t-prev_selected_t,${minGap})',scale='min(${width},iw)':-2`,
    '-fps_mode', 'passthrough',
    '-c:v', 'mjpeg',
    '-q:v', String(q),
    ...(frames ? ['-frames:v', String(frames)] : []),
    '-f', 'image2pipe',
    'pipe:1',
  ];
}

export type SpawnFfmpeg = (args: string[]) => ChildProcess;
export type FrameListener = (frame: Buffer) => void;

export interface CctvOptions {
  ffmpegPath?: string;
  /** Podmiana procesu (testy). */
  spawn?: SpawnFfmpeg;
}

/** Jeden działający strumień (kamera + jakość) dzielony między wszystkich oglądających. */
class LiveStream {
  readonly listeners = new Set<FrameListener>();
  state: StreamStatus['state'] = 'idle';
  error: string | null = null;
  lastFrame: Buffer | null = null;
  private proc: ChildProcess | null = null;
  private stderr = '';
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private stallTimer: ReturnType<typeof setInterval> | null = null;
  private retryDelay = 2000;
  private lastFrameAt = 0;
  private frameTimes: number[] = [];

  constructor(
    private readonly url: string,
    private readonly quality: Quality,
    private readonly spawnFfmpeg: SpawnFfmpeg,
    private readonly onIdle: () => void,
  ) {}

  get fps(): number {
    const now = Date.now();
    this.frameTimes = this.frameTimes.filter((t) => now - t < 5000);
    if (!this.frameTimes.length) return 0;
    // Świeży strumień: dzielimy przez czas, od kiedy są klatki (min. 1 s), a nie zawsze przez 5 s
    const span = Math.min(5, Math.max(1, (now - this.frameTimes[0]) / 1000));
    return Math.round((this.frameTimes.length / span) * 10) / 10;
  }

  add(fn: FrameListener): void {
    this.listeners.add(fn);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    if (this.lastFrame) fn(this.lastFrame);
    if (!this.proc && !this.retryTimer) this.start();
  }

  remove(fn: FrameListener): void {
    this.listeners.delete(fn);
    if (this.listeners.size === 0 && !this.stopTimer) {
      this.stopTimer = setTimeout(() => {
        this.stopTimer = null;
        if (this.listeners.size === 0) {
          this.stop();
          this.onIdle();
        }
      }, IDLE_STOP_MS);
    }
  }

  private start(): void {
    this.state = this.error ? 'error' : 'starting';
    this.stderr = '';
    const splitter = new JpegSplitter();
    let proc: ChildProcess;
    try {
      proc = this.spawnFfmpeg(ffmpegArgs(this.url, this.quality));
    } catch (err) {
      this.fail(String(err));
      return;
    }
    this.proc = proc;
    this.lastFrameAt = Date.now();
    proc.stdout?.on('data', (chunk: Buffer) => {
      for (const frame of splitter.push(chunk)) this.emit(frame);
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-2000);
    });
    proc.on('error', (err) => {
      if (this.proc === proc) this.fail(String(err));
    });
    proc.on('exit', () => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.fail(this.stderr);
    });
    this.stallTimer = setInterval(() => {
      if (Date.now() - this.lastFrameAt > STALL_MS) {
        this.stderr = this.stderr || 'timeout';
        proc.kill('SIGKILL');
      }
    }, 5000);
  }

  private emit(frame: Buffer): void {
    this.lastFrame = frame;
    this.lastFrameAt = Date.now();
    this.frameTimes.push(this.lastFrameAt);
    // Okno czasowe, nie liczba klatek (dawny limit 100 klatek zaniżał 30 kl/s do 20)
    while (this.frameTimes.length && this.lastFrameAt - this.frameTimes[0] >= 5000) this.frameTimes.shift();
    this.state = 'live';
    this.error = null;
    this.retryDelay = 2000;
    for (const fn of this.listeners) fn(frame);
  }

  private fail(reason: string): void {
    this.clearProc();
    if (this.retryTimer) return;
    this.state = 'error';
    this.error = explainFfmpegError(reason);
    this.lastFrame = null;
    if (this.listeners.size === 0) return;
    // Ponawiamy z rosnącą przerwą (kamera po restarcie, chwilowy brak sieci)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.listeners.size > 0) this.start();
    }, this.retryDelay);
    this.retryDelay = Math.min(30_000, this.retryDelay * 2);
  }

  private clearProc(): void {
    if (this.stallTimer) clearInterval(this.stallTimer);
    this.stallTimer = null;
    const p = this.proc;
    this.proc = null;
    if (p && p.exitCode === null) p.kill('SIGKILL');
  }

  stop(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.retryTimer = null;
    this.stopTimer = null;
    this.clearProc();
    this.state = 'idle';
    this.lastFrame = null;
  }

  status(): StreamStatus {
    return { state: this.state, error: this.error, viewers: this.listeners.size, fps: this.fps };
  }
}

export class CctvService {
  private readonly streams = new Map<string, LiveStream>();
  private readonly spawnFfmpeg: SpawnFfmpeg;

  constructor(
    private readonly db: Db,
    options: CctvOptions = {},
  ) {
    const path = options.ffmpegPath || 'ffmpeg';
    // stdin zamknięte, wyjście tylko na pipe; ffmpeg nie dostaje ścieżki do żadnego pliku
    this.spawnFfmpeg = options.spawn ?? ((args) => spawn(path, args, { stdio: ['ignore', 'pipe', 'pipe'] }));
  }

  // --- konfiguracja kamer ---

  private load(): CameraConfig[] {
    const list = this.db.getSetting<CameraConfig[]>('cctv_cameras', []);
    return Array.isArray(list) ? list : [];
  }

  private save(list: CameraConfig[]): void {
    this.db.setSetting('cctv_cameras', list);
  }

  cameras(): PublicCamera[] {
    return this.load().map((c) => ({ ...c, url: maskUrl(c.url), sub_url: maskUrl(c.sub_url) }));
  }

  private find(id: string): CameraConfig | undefined {
    return this.load().find((c) => c.id === id);
  }

  private normalize(input: Partial<CameraConfig>, stored?: CameraConfig): CameraConfig {
    const name = String(input.name ?? stored?.name ?? '').trim();
    if (!name || name.length > 40) throw new CctvValidationError('Nazwa kamery: od 1 do 40 znaków.');
    const url = validateUrl(resolveUrl(String(input.url ?? stored?.url ?? ''), stored?.url), 'Strumień główny', true);
    const sub = validateUrl(resolveUrl(String(input.sub_url ?? stored?.sub_url ?? ''), stored?.sub_url), 'Strumień pomocniczy', false);
    return { id: stored?.id ?? randomUUID(), name, url, sub_url: sub, enabled: input.enabled ?? stored?.enabled ?? true };
  }

  add(input: Partial<CameraConfig>): PublicCamera {
    const list = this.load();
    if (list.length >= MAX_CAMERAS) throw new CctvValidationError(`Siatka 3×3 mieści ${MAX_CAMERAS} kamer.`);
    const cam = this.normalize(input);
    this.save([...list, cam]);
    return this.cameras().find((c) => c.id === cam.id)!;
  }

  update(id: string, input: Partial<CameraConfig>): PublicCamera {
    const list = this.load();
    const i = list.findIndex((c) => c.id === id);
    if (i < 0) throw new CctvValidationError('Nie ma takiej kamery.');
    const cam = this.normalize(input, list[i]);
    list[i] = cam;
    this.save(list);
    this.stopCamera(id); // nowy adres: oglądający połączą się ponownie
    return this.cameras().find((c) => c.id === id)!;
  }

  remove(id: string): void {
    this.save(this.load().filter((c) => c.id !== id));
    this.stopCamera(id);
  }

  reorder(ids: string[]): PublicCamera[] {
    const list = this.load();
    const byId = new Map(list.map((c) => [c.id, c]));
    const ordered = ids.map((id) => byId.get(id)).filter((c): c is CameraConfig => Boolean(c));
    const rest = list.filter((c) => !ids.includes(c.id));
    this.save([...ordered, ...rest]);
    return this.cameras();
  }

  // --- strumienie ---

  private key(id: string, quality: Quality): string {
    return `${id}:${quality}`;
  }

  /** Zapisuje oglądającego; zwraca funkcję wypisania albo opis, dlaczego się nie da. */
  subscribe(id: string, quality: Quality, fn: FrameListener): { unsubscribe: () => void } | { error: string } {
    const cam = this.find(id);
    if (!cam) return { error: 'Nie ma takiej kamery.' };
    if (!cam.enabled) return { error: 'Kamera jest wyłączona.' };
    const key = this.key(id, quality);
    let stream = this.streams.get(key);
    if (!stream) {
      if (this.streams.size >= MAX_STREAMS) return { error: 'Za dużo jednoczesnych podglądów na serwerze.' };
      const url = quality === 'sub' && cam.sub_url ? cam.sub_url : cam.url;
      const created: LiveStream = new LiveStream(url, quality, this.spawnFfmpeg, () => {
        if (this.streams.get(key) === created) this.streams.delete(key);
      });
      this.streams.set(key, created);
      stream = created;
    }
    const s = stream;
    s.add(fn);
    return { unsubscribe: () => s.remove(fn) };
  }

  status(): Record<string, Partial<Record<Quality, StreamStatus>>> {
    const out: Record<string, Partial<Record<Quality, StreamStatus>>> = {};
    for (const [key, s] of this.streams) {
      const [id, q] = key.split(':') as [string, Quality];
      (out[id] ??= {})[q] = s.status();
    }
    return out;
  }

  private stopCamera(id: string): void {
    for (const q of ['sub', 'main'] as Quality[]) {
      const s = this.streams.get(this.key(id, q));
      if (!s) continue;
      // Oglądający zostają; stream wystartuje ponownie z nowym adresem przy ich następnym połączeniu
      s.stop();
      this.streams.delete(this.key(id, q));
    }
  }

  /** Pobiera jedną klatkę (sprawdzenie adresu w formularzu). Nic nie trafia na dysk. */
  async test(input: { id?: string; url: string }): Promise<{ success: boolean; message: string; image?: string }> {
    let url: string;
    try {
      const stored = input.id ? this.find(input.id) : undefined;
      const candidates = [stored?.url, stored?.sub_url];
      const match = candidates.find((u) => u && maskUrl(u) === input.url);
      url = validateUrl(match ?? resolveUrl(input.url, undefined), 'Adres', true);
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
    return new Promise((resolve) => {
      const splitter = new JpegSplitter();
      let stderr = '';
      let done = false;
      let proc: ChildProcess;
      const finish = (r: { success: boolean; message: string; image?: string }) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (proc.exitCode === null) proc.kill('SIGKILL');
        resolve(r);
      };
      try {
        proc = this.spawnFfmpeg(ffmpegArgs(url, 'main', 1));
      } catch (err) {
        resolve({ success: false, message: explainFfmpegError(String(err)) });
        return;
      }
      const timer = setTimeout(() => finish({ success: false, message: explainFfmpegError(stderr || 'timeout') }), 15_000);
      proc.stdout?.on('data', (chunk: Buffer) => {
        const [frame] = splitter.push(chunk);
        if (frame) finish({ success: true, message: 'Połączono — obraz z kamery poniżej.', image: frame.toString('base64') });
      });
      proc.stderr?.on('data', (c: Buffer) => (stderr = (stderr + c.toString()).slice(-2000)));
      proc.on('error', (err) => finish({ success: false, message: explainFfmpegError(String(err)) }));
      proc.on('exit', () => setTimeout(() => finish({ success: false, message: explainFfmpegError(stderr) }), 50));
    });
  }

  stop(): void {
    for (const s of this.streams.values()) s.stop();
    this.streams.clear();
  }
}
