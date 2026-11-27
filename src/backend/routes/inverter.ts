import { Router } from 'express';
import type { Backend } from '../context';
import { InverterValidationError, WORK_MODES } from '../inverter/deye';

/** Panel falownika: odczyt bieżący, historia (rok), konfiguracja loggera i sterowanie. */
export function inverterRouter(b: Backend): Router {
  const r = Router();
  const inv = b.inverter;

  r.get('/api/inverter', (_req, res) => {
    res.json({
      status: inv.status,
      config: inv.getConfig(),
      live: inv.live,
      settings: inv.settings,
      info: inv.info,
      work_modes: WORK_MODES,
    });
  });

  r.get('/api/inverter/history', (req, res) => {
    // Zakres własny: ?from=ISO&to=ISO (najwyżej rok wstecz — tyle trzymamy historii)
    if (req.query['from'] !== undefined || req.query['to'] !== undefined) {
      const from = Date.parse(String(req.query['from'] ?? ''));
      const to = req.query['to'] ? Date.parse(String(req.query['to'])) : Date.now();
      if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
        return void res.status(400).json({ detail: 'Podaj poprawny zakres: data „od” musi być wcześniejsza niż „do”.' });
      }
      if (to - from > 400 * 24 * 3600_000) {
        return void res.status(400).json({ detail: 'Zakres może mieć najwyżej rok.' });
      }
      return void res.json(inv.store.historyCustom(from, to));
    }
    res.json(inv.store.history(String(req.query['range'] ?? '24h')));
  });

  r.get('/api/inverter/daily', (req, res) => {
    const days = Math.min(366, Math.max(1, Number(req.query['days']) || 30));
    res.json({ days: inv.store.daily(days) });
  });

  r.post('/api/inverter/config', (req, res) => {
    try {
      res.json({ success: true, config: inv.updateConfig(req.body ?? {}), status: inv.status });
    } catch (err) {
      res.status(400).json({ success: false, message: err instanceof Error ? err.message : String(err) });
    }
  });

  r.post('/api/inverter/discover', async (_req, res) => {
    const host = await inv.discover();
    res.json({ success: Boolean(host), host, message: inv.status.last_discovery_result, status: inv.status });
  });

  r.post('/api/inverter/refresh', async (_req, res) => {
    await inv.poll();
    res.json({ success: inv.status.connected, status: inv.status, live: inv.live, settings: inv.settings });
  });

  r.post('/api/inverter/settings', async (req, res) => {
    try {
      const result = await inv.applySettings(req.body ?? {});
      res.json({
        success: true,
        message: result.applied.length ? `Zapisano: ${result.applied.join(', ')}.` : 'Brak zmian — falownik ma już te ustawienia.',
        settings: result.settings,
      });
    } catch (err) {
      const status = err instanceof InverterValidationError ? 400 : 502;
      res.status(status).json({ success: false, message: err instanceof Error ? err.message : String(err), settings: inv.settings });
    }
  });

  return r;
}
