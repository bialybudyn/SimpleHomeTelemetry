/** Zdekodowana klatka (w przeglądarce ImageBitmap). */
export interface DecodedFrame {
  close(): void;
}

/** Ile klatek trzymamy w zapasie przed wyświetleniem — wyrównuje nierówne odstępy z sieci (~3 klatki, ok. 100 ms opóźnienia). */
export const TARGET_BUFFER = 3;
/** Powyżej tylu klatek w kolejce najstarsze są wyrzucane (np. po chwilowym zawieszeniu karty). */
export const MAX_QUEUE = 7;
/** Przy starcie lub po przerwie czekamy na zapas najwyżej tyle ms. */
const MAX_WAIT_MS = 200;
/** Ile klatek może się dekodować naraz; więcej = urządzenie nie nadąża, nowe pomijamy. */
const MAX_PENDING = 4;

/**
 * Odtwarzacz strumienia klatek JPEG: dekoduje je poza głównym wątkiem i pokazuje w równych odstępach.
 *
 * Kamera i sieć dostarczają klatki nierówno (np. 15 ms, 50 ms, 15 ms… przy średnio 30 kl/s),
 * więc wyświetlanie każdej od razu po przyjściu daje szarpanie. Tu klatki czekają w krótkiej
 * kolejce i są pokazywane co średni odstęp między nimi. Gdy kolejka rośnie, tempo lekko przyspiesza,
 * żeby opóźnienie nie narastało.
 */
export class FramePlayer<F extends DecodedFrame = DecodedFrame> {
  /** Średni odstęp między klatkami w ms. */
  interval = 1000 / 30;
  private readonly queue: F[] = [];
  private shown: F | null = null;
  private lastArrival = 0;
  private nextAt = 0;
  private waitingSince = 0;
  private pending = 0;
  private seq = 0;
  private lastQueued = 0;
  private closed = false;

  constructor(
    private readonly decode: (data: Blob) => Promise<F>,
    private readonly draw: (frame: F) => void,
  ) {}

  get queued(): number {
    return this.queue.length;
  }

  /** Ostatnio pokazana klatka (np. do narysowania na nowo dołączonym płótnie). */
  get current(): F | null {
    return this.shown;
  }

  push(data: Blob, now: number): void {
    if (this.closed) return;
    if (this.lastArrival) {
      const d = now - this.lastArrival;
      if (d > 0 && d < 1000) this.interval += (Math.min(500, Math.max(8, d)) - this.interval) * 0.05;
    }
    this.lastArrival = now;
    if (this.pending >= MAX_PENDING) return;
    this.pending++;
    const n = ++this.seq;
    this.decode(data).then(
      (frame) => {
        this.pending--;
        // Zamknięty odtwarzacz albo klatka zdekodowana po nowszej — nie pokazujemy jej
        if (this.closed || n < this.lastQueued) {
          frame.close();
          return;
        }
        this.lastQueued = n;
        this.queue.push(frame);
        while (this.queue.length > MAX_QUEUE) this.queue.shift()!.close();
      },
      () => {
        this.pending--;
      },
    );
  }

  /** Wywoływane w każdej klatce ekranu (requestAnimationFrame). */
  tick(now: number): void {
    if (this.closed || this.queue.length === 0) return;
    // Start albo długa przerwa: najpierw krótki zapas, potem równe tempo od teraz
    if (!this.nextAt || now - this.nextAt > this.interval * 4) {
      if (!this.waitingSince) this.waitingSince = now;
      if (this.queue.length < TARGET_BUFFER && now - this.waitingSince < MAX_WAIT_MS) return;
      this.waitingSince = 0;
      this.nextAt = now;
    }
    if (now < this.nextAt) return;
    this.show(this.queue.shift()!);
    const speed = this.queue.length > TARGET_BUFFER ? 0.85 : 1;
    this.nextAt += this.interval * speed;
  }

  close(): void {
    this.closed = true;
    for (const f of this.queue) f.close();
    this.queue.length = 0;
    this.shown?.close();
    this.shown = null;
  }

  private show(frame: F): void {
    this.draw(frame);
    this.shown?.close();
    this.shown = frame;
  }
}
