import { Directive, ElementRef, Injectable, OnDestroy, effect, inject, input, signal } from '@angular/core';
import { FramePlayer } from './frame-player';

/**
 * Odtwarzacze strumieni kamer ("<id>:<jakość>") i płótna, na których są rysowane.
 * Jedna pętla requestAnimationFrame dla wszystkich strumieni; klatki nie przechodzą przez
 * wykrywanie zmian Angulara (sygnał zmienia się tylko przy pierwszej klatce i przy zamknięciu).
 */
@Injectable()
export class CctvPlayers implements OnDestroy {
  private readonly players = new Map<string, FramePlayer<ImageBitmap>>();
  private readonly canvases = new Map<string, Set<HTMLCanvasElement>>();
  private raf = 0;
  /** Strumienie, które pokazały już obraz. */
  readonly live = signal<ReadonlySet<string>>(new Set());

  push(key: string, jpeg: Blob): void {
    let p = this.players.get(key);
    if (!p) {
      p = new FramePlayer<ImageBitmap>(
        (blob) => createImageBitmap(blob),
        (frame) => {
          for (const c of this.canvases.get(key) ?? []) drawOn(c, frame);
          if (!this.live().has(key)) this.live.update((s) => new Set(s).add(key));
        },
      );
      this.players.set(key, p);
      this.startLoop();
    }
    p.push(jpeg, performance.now());
  }

  /** Zostawia tylko odtwarzacze z podanej listy (reszta strumieni nie jest już subskrybowana). */
  keep(keys: ReadonlySet<string>): void {
    let changed = false;
    for (const [key, p] of this.players) {
      if (keys.has(key)) continue;
      p.close();
      this.players.delete(key);
      for (const c of this.canvases.get(key) ?? []) c.getContext('2d')?.clearRect(0, 0, c.width, c.height);
      changed = true;
    }
    if (changed) this.live.update((s) => new Set([...s].filter((k) => keys.has(k))));
  }

  attach(key: string, canvas: HTMLCanvasElement): void {
    let set = this.canvases.get(key);
    if (!set) this.canvases.set(key, (set = new Set()));
    set.add(canvas);
    const cur = this.players.get(key)?.current;
    if (cur) drawOn(canvas, cur);
  }

  detach(key: string, canvas: HTMLCanvasElement): void {
    const set = this.canvases.get(key);
    set?.delete(canvas);
    if (set && set.size === 0) this.canvases.delete(key);
  }

  ngOnDestroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const p of this.players.values()) p.close();
    this.players.clear();
  }

  private startLoop(): void {
    if (this.raf) return;
    const loop = (now: number) => {
      if (this.players.size === 0) {
        this.raf = 0;
        return;
      }
      for (const p of this.players.values()) p.tick(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
}

function drawOn(canvas: HTMLCanvasElement, frame: ImageBitmap): void {
  if (canvas.width !== frame.width) canvas.width = frame.width;
  if (canvas.height !== frame.height) canvas.height = frame.height;
  canvas.getContext('2d')?.drawImage(frame, 0, 0);
}

/** <canvas [appCctvStream]="'<id>:<jakość>'"> — płótno, na którym rysuje się dany strumień. */
@Directive({ selector: 'canvas[appCctvStream]' })
export class CctvStreamCanvas implements OnDestroy {
  private readonly players = inject(CctvPlayers);
  private readonly canvas = inject<ElementRef<HTMLCanvasElement>>(ElementRef).nativeElement;
  readonly appCctvStream = input.required<string>();
  private key: string | null = null;

  constructor() {
    effect(() => {
      const key = this.appCctvStream();
      if (this.key) this.players.detach(this.key, this.canvas);
      this.players.attach(key, this.canvas);
      this.key = key;
    });
  }

  ngOnDestroy(): void {
    if (this.key) this.players.detach(this.key, this.canvas);
  }
}
