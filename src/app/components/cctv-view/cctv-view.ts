import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { CctvPlayers, CctvStreamCanvas } from './cctv-players';

interface Camera {
  id: string;
  name: string;
  url: string;
  sub_url: string;
  enabled: boolean;
}

type Quality = 'sub' | 'main';

interface StreamStatus {
  state: 'idle' | 'starting' | 'live' | 'error';
  error: string | null;
  viewers: number;
  fps: number;
}

interface Draft {
  id: string | null;
  name: string;
  url: string;
  sub_url: string;
  enabled: boolean;
}

const SLOTS = 9;
const EMPTY_DRAFT: Draft = { id: null, name: '', url: '', sub_url: '', enabled: true };

/**
 * CCTV: podgląd kamer RTSP na żywo w siatce 3×3, powiększenie po kliknięciu.
 * Obraz przychodzi jednym WebSocketem (/ws/cctv) jako klatki JPEG i nie jest nigdzie zapisywany.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-cctv-view',
  imports: [MatIconModule, CctvStreamCanvas],
  providers: [CctvPlayers],
  template: `
    <div class="space-y-4">
      <div class="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xl">
        <div>
          <div class="inline-flex items-center gap-2 text-xs font-mono text-rose-400 mb-1">
            <mat-icon class="text-sm !w-4 !h-4">videocam</mat-icon>
            <span>RTSP · podgląd na żywo</span>
          </div>
          <h2 class="text-xl font-bold text-white tracking-tight">Kamery CCTV</h2>
          <p class="text-xs text-slate-400 mt-1">Obraz nie jest nagrywany ani zapisywany — serwer tylko przekazuje go do przeglądarki, gdy ktoś ogląda.</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs font-mono px-2 py-1 rounded-lg border"
            [class.border-emerald-700]="socketState() === 'open'" [class.text-emerald-300]="socketState() === 'open'"
            [class.border-amber-700]="socketState() !== 'open'" [class.text-amber-300]="socketState() !== 'open'">
            {{ socketState() === 'open' ? 'połączono' : 'łączenie…' }}
          </span>
          <button (click)="toggleManage()"
            class="px-3 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 cursor-pointer">
            <mat-icon class="text-sm !w-4 !h-4">{{ manage() ? 'close' : 'settings' }}</mat-icon>
            {{ manage() ? 'Zamknij ustawienia' : 'Zarządzaj kamerami' }}
          </button>
        </div>
      </div>

      @if (message(); as m) {
        <div class="px-4 py-2 rounded-xl text-sm" [class.bg-emerald-950]="m.ok" [class.text-emerald-300]="m.ok" [class.bg-rose-950]="!m.ok" [class.text-rose-300]="!m.ok">{{ m.text }}</div>
      }

      @if (manage()) {
        <!-- Lista i formularz kamer -->
        <div class="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div class="space-y-2">
            @for (c of cameras(); track c.id; let i = $index) {
              <div class="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs">
                <span class="w-6 text-center font-mono text-slate-500">{{ i + 1 }}</span>
                <div class="min-w-0 flex-1">
                  <div class="font-bold text-white truncate">{{ c.name }} @if (!c.enabled) { <span class="text-slate-500 font-normal">(wyłączona)</span> }</div>
                  <div class="font-mono text-slate-500 truncate">{{ c.url }}</div>
                </div>
                <button (click)="move(i, -1)" [disabled]="i === 0" class="p-1 rounded hover:bg-slate-800 text-slate-400 disabled:opacity-30 cursor-pointer" title="W górę"><mat-icon class="text-sm !w-4 !h-4">arrow_upward</mat-icon></button>
                <button (click)="move(i, 1)" [disabled]="i === cameras().length - 1" class="p-1 rounded hover:bg-slate-800 text-slate-400 disabled:opacity-30 cursor-pointer" title="W dół"><mat-icon class="text-sm !w-4 !h-4">arrow_downward</mat-icon></button>
                <button (click)="edit(c)" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer">Edytuj</button>
                <button (click)="remove(c)" class="px-2 py-1 rounded-lg bg-rose-950 hover:bg-rose-900 text-rose-300 cursor-pointer">Usuń</button>
              </div>
            } @empty {
              <div class="text-sm text-slate-400">Nie dodano jeszcze żadnej kamery.</div>
            }
          </div>

          @if (cameras().length < slots || draft().id) {
            <div class="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3 text-xs">
              <div class="font-bold text-white text-sm">{{ draft().id ? 'Edycja kamery' : 'Nowa kamera' }}</div>
              <label class="block space-y-1">
                <span class="text-slate-400">Nazwa</span>
                <input [value]="draft().name" (input)="patch({ name: $any($event.target).value })" maxlength="40"
                  class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white" placeholder="np. Wjazd" />
              </label>
              <label class="block space-y-1">
                <span class="text-slate-400">Strumień główny (powiększenie)</span>
                <input [value]="draft().url" (input)="patch({ url: $any($event.target).value })" autocomplete="off" spellcheck="false"
                  class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono" placeholder="rtsp://użytkownik:hasło@192.168.1.50:554/…" />
              </label>
              <label class="block space-y-1">
                <span class="text-slate-400">Strumień pomocniczy, niska rozdzielczość (kafelek) — opcjonalny, odciąża serwer</span>
                <input [value]="draft().sub_url" (input)="patch({ sub_url: $any($event.target).value })" autocomplete="off" spellcheck="false"
                  class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono" placeholder="rtsp://…" />
              </label>
              <label class="flex items-center gap-2 text-slate-300">
                <input type="checkbox" class="accent-rose-500" [checked]="draft().enabled" (change)="patch({ enabled: $any($event.target).checked })" />
                Pokazuj na siatce
              </label>
              <details class="text-slate-400">
                <summary class="cursor-pointer">Typowe adresy RTSP</summary>
                <ul class="mt-2 space-y-1 font-mono text-[11px] text-slate-500">
                  <li>Hikvision: rtsp://user:hasło&#64;IP:554/Streaming/Channels/101 (pomocniczy: …/102)</li>
                  <li>Dahua: rtsp://user:hasło&#64;IP:554/cam/realmonitor?channel=1&amp;subtype=0 (pomocniczy: subtype=1)</li>
                  <li>Reolink: rtsp://user:hasło&#64;IP:554/h264Preview_01_main (pomocniczy: …_sub)</li>
                </ul>
              </details>

              <div class="flex flex-wrap gap-2 justify-end">
                @if (draft().id) {
                  <button (click)="resetDraft()" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer">Anuluj</button>
                }
                <button (click)="test()" [disabled]="busy() || !draft().url" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 cursor-pointer disabled:opacity-40">
                  {{ testing() ? 'Łączę…' : 'Sprawdź połączenie' }}
                </button>
                <button (click)="saveDraft()" [disabled]="busy()" class="px-4 py-1.5 rounded-lg font-bold bg-rose-700 hover:bg-rose-600 text-white cursor-pointer disabled:opacity-40">
                  {{ draft().id ? 'Zapisz zmiany' : 'Dodaj kamerę' }}
                </button>
              </div>
              @if (testImage(); as img) {
                <img [src]="img" alt="Klatka testowa z kamery" class="w-full max-w-md rounded-lg border border-slate-800" />
              }
            </div>
          }
        </div>
      }

      <!-- Siatka 3×3 -->
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        @for (slot of grid(); track $index) {
          @if (slot; as c) {
            <button (click)="zoom(c)" class="relative aspect-video rounded-xl overflow-hidden bg-black border border-slate-800 hover:border-rose-500/60 cursor-zoom-in group text-left">
              <canvas [appCctvStream]="c.id + ':sub'" [class.invisible]="!isLive(c.id, 'sub')" class="absolute inset-0 w-full h-full object-cover"></canvas>
              @if (!isLive(c.id, 'sub')) {
                <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-500 text-xs p-4 text-center">
                  <mat-icon [class.animate-pulse]="!errorOf(c.id, 'sub')">{{ errorOf(c.id, 'sub') ? 'videocam_off' : 'videocam' }}</mat-icon>
                  <span>{{ errorOf(c.id, 'sub') || (c.enabled ? 'Łączenie z kamerą…' : 'Kamera wyłączona') }}</span>
                </div>
              }
              <div class="absolute inset-x-0 top-0 p-2 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent text-[11px] font-mono">
                <span class="text-white font-bold truncate">{{ c.name }}</span>
                @if (statusOf(c.id, 'sub')?.state === 'live') {
                  <span class="flex items-center gap-1 text-rose-300"><span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>LIVE</span>
                }
              </div>
              <mat-icon class="absolute bottom-2 right-2 text-white/0 group-hover:text-white/80 transition-colors">zoom_in</mat-icon>
            </button>
          } @else {
            <button (click)="openNew()" class="aspect-video rounded-xl border border-dashed border-slate-800 bg-slate-900/40 hover:border-slate-600 text-slate-600 hover:text-slate-400 flex flex-col items-center justify-center gap-1 text-xs cursor-pointer">
              <mat-icon>add</mat-icon>
              Dodaj kamerę
            </button>
          }
        }
      </div>
    </div>

    <!-- Powiększenie -->
    @if (zoomed(); as c) {
      <div class="fixed inset-0 z-50 bg-black/95 flex flex-col" (click)="closeZoom()">
        <div class="flex items-center justify-between gap-3 p-3 text-sm" (click)="$event.stopPropagation()">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-full bg-rose-500 animate-pulse shrink-0"></span>
            <span class="font-bold text-white truncate">{{ c.name }}</span>
            @if (statusOf(c.id, 'main'); as st) {
              <span class="text-xs font-mono text-slate-400">{{ st.state === 'live' ? st.fps + ' kl/s' : '' }}</span>
            }
          </div>
          <div class="flex items-center gap-1">
            <button (click)="step(-1)" class="p-2 rounded-lg hover:bg-white/10 text-white cursor-pointer" title="Poprzednia kamera"><mat-icon>chevron_left</mat-icon></button>
            <button (click)="step(1)" class="p-2 rounded-lg hover:bg-white/10 text-white cursor-pointer" title="Następna kamera"><mat-icon>chevron_right</mat-icon></button>
            <button (click)="closeZoom()" class="p-2 rounded-lg hover:bg-white/10 text-white cursor-pointer" title="Zamknij (Esc)"><mat-icon>close</mat-icon></button>
          </div>
        </div>
        <div class="flex-1 min-h-0 flex items-center justify-center p-2">
          <canvas [appCctvStream]="c.id + ':main'" [class.hidden]="!isLive(c.id, 'main')" class="max-w-full max-h-full object-contain cursor-zoom-out"></canvas>
          @if (!isLive(c.id, 'main')) {
            <div class="text-slate-400 text-sm flex items-center gap-2">
              <mat-icon>{{ errorOf(c.id, 'main') ? 'videocam_off' : 'hourglass_top' }}</mat-icon>
              {{ errorOf(c.id, 'main') || 'Łączenie ze strumieniem głównym…' }}
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class CctvView implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly slots = SLOTS;
  readonly cameras = signal<Camera[]>([]);
  readonly manage = signal(false);
  readonly draft = signal<Draft>({ ...EMPTY_DRAFT });
  readonly busy = signal(false);
  readonly testing = signal(false);
  readonly testImage = signal<string | null>(null);
  readonly message = signal<{ text: string; ok: boolean } | null>(null);
  readonly zoomedId = signal<string | null>(null);
  readonly socketState = signal<'connecting' | 'open' | 'closed'>('connecting');
  private readonly hidden = signal(false);

  /** Odtwarzacze strumieni: równe tempo wyświetlania mimo nierównego przychodzenia klatek. */
  private readonly players = inject(CctvPlayers);
  private readonly status = signal<Record<string, Partial<Record<Quality, StreamStatus>>>>({});
  private readonly errors = signal<Record<string, string>>({});

  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private destroyed = false;
  private messageTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly decoder = new TextDecoder();
  private readonly onVisibility = () => this.hidden.set(document.hidden);

  readonly grid = computed<(Camera | null)[]>(() => {
    const list = this.cameras().slice(0, SLOTS);
    return [...list, ...Array<Camera | null>(SLOTS - list.length).fill(null)];
  });

  readonly zoomed = computed(() => this.cameras().find((c) => c.id === this.zoomedId()) ?? null);

  /** Strumienie, które trzeba teraz odbierać: powiększona kamera albo kafelki siatki. */
  private readonly wanted = computed<{ id: string; quality: Quality }[]>(() => {
    if (this.hidden()) return [];
    const z = this.zoomed();
    if (z) return [{ id: z.id, quality: 'main' }];
    return this.cameras()
      .slice(0, SLOTS)
      .filter((c) => c.enabled)
      .map((c) => ({ id: c.id, quality: 'sub' as Quality }));
  });

  constructor() {
    if (!this.browser) return;
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.load();
    this.connect();
    effect(() => {
      const streams = this.wanted();
      // Bez śledzenia klatek: inaczej każda klatka wysyłałaby subskrypcję od nowa
      untracked(() => this.sendSubscription(streams));
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (!this.browser) return;
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.ws?.close();
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    if (!this.zoomedId()) return;
    if (e.key === 'Escape') this.closeZoom();
    else if (e.key === 'ArrowRight') this.step(1);
    else if (e.key === 'ArrowLeft') this.step(-1);
  }

  // --- podgląd ---

  isLive(id: string, q: Quality): boolean {
    return this.players.live().has(`${id}:${q}`);
  }

  statusOf(id: string, q: Quality): StreamStatus | undefined {
    return this.status()[id]?.[q];
  }

  errorOf(id: string, q: Quality): string | null {
    return this.errors()[`${id}:${q}`] ?? (this.statusOf(id, q)?.state === 'error' ? this.statusOf(id, q)?.error ?? null : null);
  }

  zoom(c: Camera): void {
    if (c.enabled) this.zoomedId.set(c.id);
  }

  closeZoom(): void {
    this.zoomedId.set(null);
  }

  step(dir: number): void {
    const list = this.cameras().slice(0, SLOTS).filter((c) => c.enabled);
    if (list.length === 0) return;
    const i = list.findIndex((c) => c.id === this.zoomedId());
    this.zoomedId.set(list[(i + dir + list.length) % list.length].id);
  }

  private connect(): void {
    if (this.destroyed) return;
    this.socketState.set('connecting');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws/cctv`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.socketState.set('open');
      this.reconnectDelay = 1000;
      this.sendSubscription(this.wanted());
    };
    ws.onmessage = (ev) => (typeof ev.data === 'string' ? this.onStatus(ev.data) : this.onFrame(ev.data as ArrayBuffer));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.socketState.set('closed');
      if (this.destroyed) return;
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(15_000, this.reconnectDelay * 2);
    };
  }

  private sendSubscription(streams: { id: string; quality: Quality }[]): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'subscribe', streams }));
    // Odtwarzacze strumieni, których już nie oglądamy, nie są potrzebne
    this.players.keep(new Set(streams.map((s) => `${s.id}:${s.quality}`)));
  }

  private onFrame(buf: ArrayBuffer): void {
    const bytes = new Uint8Array(buf);
    const idLen = bytes[0];
    if (bytes.length < idLen + 3) return;
    const id = this.decoder.decode(bytes.subarray(1, 1 + idLen));
    const q: Quality = bytes[1 + idLen] === 1 ? 'main' : 'sub';
    const key = `${id}:${q}`;
    if (!this.wanted().some((s) => s.id === id && s.quality === q)) return;
    this.players.push(key, new Blob([bytes.subarray(2 + idLen)], { type: 'image/jpeg' }));
  }

  private onStatus(text: string): void {
    try {
      const msg = JSON.parse(text) as { type?: string; streams?: Record<string, Partial<Record<Quality, StreamStatus>>>; errors?: Record<string, string> };
      if (msg.type !== 'status') return;
      this.status.set(msg.streams ?? {});
      this.errors.set(msg.errors ?? {});
    } catch {
      // pomijamy
    }
  }

  // --- konfiguracja ---

  private async load(): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<{ cameras: Camera[] }>('/api/cctv'));
      this.cameras.set(res.cameras);
    } catch {
      this.flash('Nie udało się pobrać listy kamer.', false);
    }
  }

  toggleManage(): void {
    this.manage.update((v) => !v);
    this.resetDraft();
  }

  openNew(): void {
    this.manage.set(true);
    this.resetDraft();
  }

  edit(c: Camera): void {
    this.draft.set({ id: c.id, name: c.name, url: c.url, sub_url: c.sub_url, enabled: c.enabled });
    this.testImage.set(null);
  }

  resetDraft(): void {
    this.draft.set({ ...EMPTY_DRAFT });
    this.testImage.set(null);
  }

  patch(p: Partial<Draft>): void {
    this.draft.update((d) => ({ ...d, ...p }));
  }

  async saveDraft(): Promise<void> {
    const d = this.draft();
    const body = { name: d.name, url: d.url, sub_url: d.sub_url, enabled: d.enabled };
    this.busy.set(true);
    try {
      const req = d.id
        ? this.http.put<{ cameras: Camera[] }>(`/api/cctv/cameras/${encodeURIComponent(d.id)}`, body)
        : this.http.post<{ cameras: Camera[] }>('/api/cctv/cameras', body);
      const res = await firstValueFrom(req);
      this.cameras.set(res.cameras);
      this.flash(d.id ? 'Zapisano zmiany kamery.' : 'Dodano kamerę.', true);
      this.resetDraft();
      // Zmieniony adres: serwer zamknął stary strumień, więc zapisujemy się od nowa
      this.sendSubscription(this.wanted());
    } catch (err) {
      this.flash(this.errorText(err), false);
    } finally {
      this.busy.set(false);
    }
  }

  async remove(c: Camera): Promise<void> {
    if (!confirm(`Usunąć kamerę „${c.name}” z panelu?`)) return;
    try {
      const res = await firstValueFrom(this.http.delete<{ cameras: Camera[] }>(`/api/cctv/cameras/${encodeURIComponent(c.id)}`));
      this.cameras.set(res.cameras);
      if (this.draft().id === c.id) this.resetDraft();
    } catch (err) {
      this.flash(this.errorText(err), false);
    }
  }

  async move(i: number, dir: number): Promise<void> {
    const list = [...this.cameras()];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.cameras.set(list);
    try {
      const res = await firstValueFrom(this.http.post<{ cameras: Camera[] }>('/api/cctv/reorder', { ids: list.map((c) => c.id) }));
      this.cameras.set(res.cameras);
    } catch (err) {
      this.flash(this.errorText(err), false);
      void this.load();
    }
  }

  async test(): Promise<void> {
    const d = this.draft();
    this.testing.set(true);
    this.busy.set(true);
    this.testImage.set(null);
    try {
      const res = await firstValueFrom(
        this.http.post<{ success: boolean; message: string; image?: string }>('/api/cctv/test', { id: d.id ?? undefined, url: d.url }),
      );
      this.flash(res.message, res.success);
      if (res.image) this.testImage.set(`data:image/jpeg;base64,${res.image}`);
    } catch (err) {
      this.flash(this.errorText(err), false);
    } finally {
      this.testing.set(false);
      this.busy.set(false);
    }
  }

  private errorText(err: unknown): string {
    const e = err as { error?: { message?: string } };
    return e?.error?.message || 'Operacja nie powiodła się.';
  }

  private flash(text: string, ok: boolean): void {
    this.message.set({ text, ok });
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => this.message.set(null), 8000);
  }
}
