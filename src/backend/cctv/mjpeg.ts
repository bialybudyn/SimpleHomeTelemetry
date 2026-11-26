/**
 * Dzieli strumień sklejonych obrazów JPEG (ffmpeg -f image2pipe -c:v mjpeg) na pojedyncze klatki.
 * Klatka zaczyna się od SOI (FF D8) i kończy na EOI (FF D9); w danych obrazu bajt FF jest zawsze
 * „wypychany” zerem, więc FF D9 nie wystąpi wcześniej niż na końcu klatki.
 */
export class JpegSplitter {
  private buf: Buffer = Buffer.alloc(0);

  /** Górny limit bufora — chroni pamięć, gdyby strumień nie zawierał poprawnych klatek. */
  constructor(private readonly maxBytes = 8 * 1024 * 1024) {}

  push(chunk: Buffer): Buffer[] {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    const frames: Buffer[] = [];
    for (;;) {
      const start = findMarker(this.buf, 0xd8, 0);
      if (start < 0) {
        // Zostaw ostatni bajt: może być początkiem znacznika FF D8 z następnego kawałka
        this.buf = this.buf.subarray(Math.max(0, this.buf.length - 1));
        break;
      }
      const end = findMarker(this.buf, 0xd9, start + 2);
      if (end < 0) {
        this.buf = this.buf.subarray(start);
        break;
      }
      // Kopia: klatka trafia do wielu odbiorców i nie może trzymać całego bufora w pamięci
      frames.push(Buffer.from(this.buf.subarray(start, end + 2)));
      this.buf = this.buf.subarray(end + 2);
    }
    if (this.buf.length > this.maxBytes) this.buf = Buffer.alloc(0);
    return frames;
  }
}

function findMarker(buf: Buffer, second: number, from: number): number {
  let i = buf.indexOf(0xff, from);
  while (i >= 0 && i + 1 < buf.length) {
    if (buf[i + 1] === second) return i;
    i = buf.indexOf(0xff, i + 1);
  }
  return -1;
}
