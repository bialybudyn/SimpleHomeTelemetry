import { AngularNodeAppEngine, createNodeRequestHandler, isMainModule, writeResponseToNodeResponse } from '@angular/ssr/node';
import express from 'express';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { config } from './backend/config';
import { basicAuthMiddleware, isUpgradeAuthorized } from './backend/auth';
import { createBackend, type Backend } from './backend/context';
import { initImgw } from './backend/imgw';
import { devicesRouter } from './backend/routes/devices';
import { systemRouter } from './backend/routes/system';
import { weatherRouter } from './backend/routes/weather';
import { wifiRouter } from './backend/routes/wifi';

const browserDistFolder = join(import.meta.dirname, '../browser');

/**
 * Backend (baza, sterowniki) startuje tylko przy faktycznym uruchomieniu serwera
 * (`node dist/app/server/server.mjs`) lub w trybie deweloperskim z NG_DEV_BACKEND=1.
 * Podczas `ng build` moduł jest ładowany do ekstrakcji tras — wtedy nie łączymy się z niczym.
 */
const runBackend = isMainModule(import.meta.url) || process.env['NG_DEV_BACKEND'] === '1';
const backend: Backend | null = runBackend ? createBackend() : null;

const app = express();
app.disable('x-powered-by');

if (config.panelPassword) {
  app.use(basicAuthMiddleware(config.panelUser, config.panelPassword));
} else if (runBackend) {
  console.warn('[AUTH] PANEL_PASSWORD nie jest ustawione — panel jest dostępny bez logowania dla całej sieci.');
}

app.use(express.json({ limit: '5mb' }));

if (backend) {
  app.use(devicesRouter(backend));
  app.use(wifiRouter(backend));
  app.use(systemRouter(backend));
  app.use(weatherRouter());
}
app.use('/api', (_req, res) => {
  res.status(404).json({ detail: 'Nieznany endpoint API.' });
});

app.use(express.static(browserDistFolder, { maxAge: '1y', index: false, redirect: false }));

// Panel działa w sieci lokalnej pod dowolnym IP/nazwą hosta. Ograniczenie: zmienna NG_ALLOWED_HOSTS.
const angularApp = new AngularNodeAppEngine({ allowedHosts: ['*'] });
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

if (isMainModule(import.meta.url) && backend) {
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  backend.events.attachWebSocketServer(wss);

  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws' || !isUpgradeAuthorized(req, config.panelUser, config.panelPassword)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ type: 'system_hello' }));
      ws.on('message', (data) => {
        if (data.toString().includes('"ping"')) ws.send(JSON.stringify({ type: 'pong', time: new Date().toISOString() }));
      });
    });
  });

  backend.start();
  initImgw();

  // Np. EADDRINUSE: kończymy proces, żeby systemd pokazał błąd i ponowił start,
  // zamiast zostawić żywy proces bez serwera HTTP (Angular SSR łapie uncaughtException).
  server.on('error', (err) => {
    console.error(`[HTTP] Nie można uruchomić serwera na ${config.host}:${config.port}:`, err.message);
    process.exit(1);
  });
  server.listen(config.port, config.host, () => {
    console.log(`[HTTP] Panel SimpleHome działa na http://${config.host}:${config.port} (dane: ${config.dataDir})`);
  });

  const shutdown = (signal: string) => {
    console.log(`[HTTP] ${signal} — zamykanie...`);
    backend.stop();
    backend.db.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
} else if (backend) {
  // Tryb deweloperski (ng serve): bez własnego serwera HTTP, zdarzenia przez SSE
  backend.start();
  initImgw();
}

export const reqHandler = createNodeRequestHandler(app);
