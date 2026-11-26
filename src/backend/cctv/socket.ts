import { WebSocket } from 'ws';
import type { CctvService, Quality } from './service';

/** Klient wolniejszy niż strumień: powyżej tylu bajtów w kolejce gubimy klatki, zamiast zapychać pamięć. */
const MAX_BUFFERED = 1.5 * 1024 * 1024;

/**
 * Jeden WebSocket na ekran z kamerami — wszystkie kafelki idą jednym połączeniem
 * (przeglądarka pozwala na 6 zwykłych połączeń HTTP do serwera, a kamer może być 9).
 *
 * Klient → serwer (JSON): {"type":"subscribe","streams":[{"id":"…","quality":"sub"|"main"}]}
 * Serwer → klient:
 *  - binarnie: [długość id: 1 B][id UTF-8][jakość: 0 = sub, 1 = main][obraz JPEG]
 *  - JSON co 2 s: {"type":"status","streams":{…},"errors":{"<id>:<q>":"opis"}}
 */
export function handleCctvSocket(ws: WebSocket, cctv: CctvService): void {
  const subs = new Map<string, () => void>();
  const errors: Record<string, string> = {};

  const unsubscribeAll = () => {
    for (const off of subs.values()) off();
    subs.clear();
  };

  const subscribe = (list: { id: string; quality: Quality }[]) => {
    unsubscribeAll();
    for (const k of Object.keys(errors)) delete errors[k];
    for (const { id, quality } of list.slice(0, 12)) {
      const key = `${id}:${quality}`;
      if (subs.has(key)) continue;
      const header = Buffer.concat([Buffer.from([Buffer.byteLength(id)]), Buffer.from(id), Buffer.from([quality === 'main' ? 1 : 0])]);
      const res = cctv.subscribe(id, quality, (frame) => {
        if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > MAX_BUFFERED) return;
        ws.send(Buffer.concat([header, frame]), { binary: true });
      });
      if ('error' in res) errors[key] = res.error;
      else subs.set(key, res.unsubscribe);
    }
  };

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    try {
      const msg = JSON.parse(data.toString()) as { type?: string; streams?: unknown };
      if (msg.type !== 'subscribe' || !Array.isArray(msg.streams)) return;
      const list = msg.streams
        .filter((s): s is { id: string; quality: Quality } =>
          !!s && typeof s.id === 'string' && s.id.length > 0 && s.id.length < 100 && (s.quality === 'sub' || s.quality === 'main'))
        .map((s) => ({ id: s.id, quality: s.quality }));
      subscribe(list);
    } catch {
      // niepoprawna wiadomość — pomijamy
    }
  });

  const statusTimer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'status', streams: cctv.status(), errors }));
  }, 2000);

  ws.on('close', () => {
    clearInterval(statusTimer);
    unsubscribeAll();
  });
}
