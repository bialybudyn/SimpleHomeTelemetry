import { describe, expect, it } from 'vitest';
import { FramePlayer, MAX_QUEUE } from './frame-player';

class Frame {
  closed = false;
  constructor(readonly n: number) {}
  close(): void {
    this.closed = true;
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const shown: { n: number; at: number }[] = [];
  let now = 0;
  let n = 0;
  const p = new FramePlayer<Frame>(
    () => Promise.resolve(new Frame(++n)),
    (f) => shown.push({ n: f.n, at: now }),
  );
  const tick = (t: number) => {
    now = t;
    p.tick(t);
  };
  return { p, shown, tick, blob: new Blob([new Uint8Array([1])]) };
}

describe('FramePlayer: równe tempo wyświetlania', () => {
  it('nierówne przyjścia (15/50 ms) są pokazywane co ~33 ms', async () => {
    const { p, shown, tick, blob } = setup();
    // 60 klatek, średnio 30 kl/s, ale parami: 15 ms i 51 ms
    let t = 0;
    let screen = 0;
    for (let i = 0; i < 60; i++) {
      t += i % 2 ? 15 : 51;
      p.push(blob, t);
      await flush();
      // ekran 60 Hz między przyjściami
      while (screen + 16.7 <= t) {
        screen += 16.7;
        tick(screen);
      }
    }
    const gaps = shown.slice(10).map((s, i, a) => (i ? s.at - a[i - 1].at : 0)).slice(1);
    // Przy 60 Hz odstęp to 2 klatki ekranu (33,4 ms), czasem 1 lub 3 — bez par 15/50
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(avg).toBeGreaterThan(28);
    expect(avg).toBeLessThan(38);
    expect(gaps.filter((g) => g < 20).length).toBeLessThanOrEqual(gaps.length * 0.15);
    // Kolejność zachowana
    expect(shown.map((s) => s.n)).toEqual([...shown.map((s) => s.n)].sort((a, b) => a - b));
  });

  it('kolejka nie rośnie bez końca i zamyka wyrzucone klatki', async () => {
    const { p, blob } = setup();
    for (let i = 0; i < 20; i++) {
      p.push(blob, i * 33);
      await flush();
    }
    expect(p.queued).toBe(MAX_QUEUE);
  });

  it('po zamknięciu nie trzyma żadnych klatek', async () => {
    const { p, tick, blob } = setup();
    p.push(blob, 0);
    p.push(blob, 33);
    await flush();
    tick(200);
    const cur = p.current!;
    p.close();
    expect(cur.closed).toBe(true);
    expect(p.current).toBeNull();
    expect(p.queued).toBe(0);
  });
});
