import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type RequestListener, type Server as HttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer, type Server as NetServer, type Socket } from 'node:net';

/** Pierwszy bajt powitania TLS (rekord "handshake"). */
const TLS_HANDSHAKE = 0x16;

export interface PanelListener {
  /** Serwer obsługujący panel (zdarzenie 'upgrade' dla WebSocketa). */
  server: HttpServer;
  /** Serwer, który faktycznie nasłuchuje na porcie. */
  listener: NetServer;
  secure: boolean;
}

/**
 * Tworzy serwer panelu. Z certyfikatem (TLS_CERT + TLS_KEY) panel działa po HTTPS, a zwykłe HTTP
 * na tym samym porcie dostaje tylko przekierowanie 301 — bez stron, API i okna logowania,
 * więc login i hasło nie są wysyłane otwartym tekstem.
 */
export function createPanelListener(app: RequestListener, tls: { cert?: string; key?: string }): PanelListener {
  if (!tls.cert || !tls.key) {
    const server = createHttpServer(app);
    return { server, listener: server, secure: false };
  }

  const server = createHttpsServer({ cert: readFileSync(tls.cert), key: readFileSync(tls.key) }, app) as unknown as HttpServer;
  const redirect = createHttpServer(redirectToHttps);

  // Jeden port dla obu protokołów: po pierwszym bajcie poznajemy, czy klient zaczyna TLS
  const listener = createNetServer({ pauseOnConnect: true }, (socket: Socket) => {
    socket.on('error', () => socket.destroy());
    socket.setTimeout(10_000, () => socket.destroy());
    socket.once('data', (chunk: Buffer) => {
      socket.pause();
      socket.setTimeout(0);
      socket.unshift(chunk);
      (chunk[0] === TLS_HANDSHAKE ? server : redirect).emit('connection', socket);
      process.nextTick(() => socket.resume());
    });
    socket.resume();
  });
  listener.on('close', () => {
    server.close(() => undefined);
    redirect.close(() => undefined);
  });
  return { server, listener, secure: true };
}

/** Nazwa hosta z nagłówka Host, tylko jeśli wygląda jak nazwa/IP (bez wstrzykiwania w Location). */
function safeHost(req: IncomingMessage): string | null {
  const host = req.headers.host ?? '';
  return /^[A-Za-z0-9.\-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/.test(host) ? host : null;
}

function redirectToHttps(req: IncomingMessage, res: import('node:http').ServerResponse): void {
  const host = safeHost(req);
  if (!host) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Panel działa tylko po HTTPS.');
    return;
  }
  const path = (req.url ?? '/').startsWith('/') ? req.url ?? '/' : '/';
  res.writeHead(301, { Location: `https://${host}${path}`, 'Cache-Control': 'no-store', Connection: 'close' });
  res.end();
}
