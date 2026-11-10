import { Router, type Request, type Response } from 'express';
import type { Backend } from '../context';
import { PANEL_SETTING_KEYS } from '../registry';
import type { Device, DeviceCategory, TuyaDpSpec } from '../../app/models/telemetry.models';

const id = (req: Request) => String(req.params['id'] ?? '');

const CATEGORIES: DeviceCategory[] = ['climate', 'fan', 'plug', 'switch', 'sensor', 'smoke', 'contact', 'occupancy', 'water_leak'];

export function devicesRouter(b: Backend): Router {
  const r = Router();
  const pub = (d: Device) => b.registry.toPublic(d);

  r.get('/api/devices', (req, res) => {
    const all = b.registry.all();
    const includeDeleted = req.query['include_deleted'] === 'true';
    const visible = all.filter((d) => includeDeleted || !d.is_deleted);
    res.json({
      devices: visible.map(pub),
      total: all.length,
      active: all.filter((d) => !d.is_deleted && b.registry.isOnline(d)).length,
      disconnected: all.filter((d) => !d.is_deleted && !b.registry.isOnline(d)).length,
      deleted: all.filter((d) => d.is_deleted).length,
    });
  });

  r.get('/api/admin/devices', (_req, res) => {
    const all = b.registry.all();
    const active = all.filter((d) => !d.is_deleted && b.registry.isOnline(d));
    const disconnected = all.filter((d) => !d.is_deleted && !b.registry.isOnline(d));
    const deleted = all.filter((d) => d.is_deleted);
    res.json({
      total: all.length,
      active: active.map(pub),
      disconnected: disconnected.map(pub),
      deleted: deleted.map(pub),
      all: all.map(pub),
      logs: b.registry.auditLog(),
    });
  });

  r.get('/api/devices/logs', (_req, res) => {
    res.json({ logs: b.registry.auditLog() });
  });

  r.get('/api/devices/:id', (req, res) => {
    const dev = b.registry.get(id(req));
    if (!dev) return void res.status(404).json({ detail: 'Nie znaleziono urządzenia.' });
    res.json(pub(dev));
  });

  r.get('/api/devices/:id/history', (req, res) => {
    const dev = b.registry.get(id(req));
    const range = typeof req.query['range'] === 'string' ? req.query['range'] : '24h';
    const eventSensor = dev?.category === 'contact' || dev?.category === 'occupancy' || dev?.category === 'water_leak';
    const { points, stats } = b.history.query(id(req), range, Boolean(eventSensor));
    res.json({ device_ieee: id(req), range, count: points.length, stats, history: points });
  });

  /** Polecenie do urządzenia. Stan zmienia się dopiero po potwierdzeniu z urządzenia. */
  r.post('/api/devices/:id/set', async (req, res) => {
    const dev = b.registry.get(id(req));
    if (!dev) return void res.status(404).json({ status: 'error', detail: 'Nie znaleziono urządzenia.' });
    const command = (req.body ?? {}) as Record<string, unknown>;

    // Ustawienia alarmów należą do panelu — zapisujemy je lokalnie
    const panelPatch: Record<string, unknown> = {};
    for (const k of PANEL_SETTING_KEYS) if (command[k] !== undefined) panelPatch[k] = command[k];
    if (Object.keys(panelPatch).length > 0) b.registry.upsert(dev.ieee_address, panelPatch as Partial<Device>);

    const deviceCommand = Object.fromEntries(Object.entries(command).filter(([k]) => !(k in panelPatch)));
    if (Object.keys(deviceCommand).length === 0) {
      return void res.json({ status: 'ok', device: pub(dev) });
    }
    const driver = b.registry.driverFor(dev);
    if (!driver) return void res.status(400).json({ status: 'error', detail: 'Urządzenie nie ma przypisanego sterownika.' });
    const result = await driver.sendCommand(dev, deviceCommand);
    b.registry.audit(result.success ? 'control' : 'warning', dev, `${JSON.stringify(deviceCommand)} → ${result.message}`);
    if (!result.success) {
      return void res.status(502).json({ status: 'error', detail: result.message, device: pub(dev) });
    }
    res.json({ status: 'ok', message: result.message, device: pub(dev) });
  });

  /** Odczyt stanu na żądanie. Zachowana stara ścieżka /test-connection używana przez kafelki. */
  const refresh = async (req: Request, res: Response) => {
    const dev = b.registry.get(id(req));
    if (!dev) return void res.status(404).json({ success: false, message: 'Nie znaleziono urządzenia.' });
    const driver = b.registry.driverFor(dev);
    if (!driver) return void res.json({ success: false, message: 'Urządzenie nie ma przypisanego sterownika.' });
    const result = await driver.refresh(dev);
    res.json({ ...result, device: pub(dev) });
  };
  r.post('/api/devices/:id/refresh', refresh);
  r.post('/api/devices/:id/test-connection', refresh);

  r.post('/api/devices/:id/rename', async (req, res) => {
    const dev = b.registry.get(id(req));
    const name = String(req.body?.friendly_name ?? '').trim();
    if (!dev || !name) return void res.status(400).json({ success: false, message: 'Brak urządzenia lub nazwy.' });
    const driver = b.registry.driverFor(dev);
    if (driver?.rename) {
      // Zigbee2MQTT zmienia nazwę u siebie, panel zaktualizuje ją z bridge/devices
      const result = await driver.rename(dev, name);
      if (!result.success) return void res.status(502).json({ success: false, message: result.message });
    }
    b.registry.upsert(dev.ieee_address, { friendly_name: name });
    b.registry.audit('rename', dev, `Zmieniono nazwę "${dev.friendly_name}" → "${name}".`);
    b.events.broadcast({ type: 'device_renamed', device_ieee: dev.ieee_address, friendly_name: name });
    res.json({ success: true, device: pub(dev) });
  });

  /** Konfiguracja urządzenia Wi-Fi (klucze, IP, wersja, mapa DP, kategoria). */
  r.post('/api/devices/:id/configure', (req, res) => {
    const dev = b.registry.get(id(req));
    if (!dev) return void res.status(404).json({ success: false, message: 'Nie znaleziono urządzenia.' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Partial<Device> = {};
    const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : undefined);

    if (str('friendly_name')) patch.friendly_name = str('friendly_name');
    if (body['ip_address'] !== undefined) patch.ip_address = str('ip_address') || undefined;
    if (typeof body['category'] === 'string' && CATEGORIES.includes(body['category'] as DeviceCategory)) {
      patch.category = body['category'] as DeviceCategory;
    }
    // Klucze: pusty string = bez zmian (przeglądarka nigdy nie dostaje zapisanych kluczy)
    if (str('local_key')) patch.local_key = str('local_key');
    if (str('sonoff_device_key')) patch.sonoff_api_key = str('sonoff_device_key');
    if (str('sonoff_device_id')) patch.sonoff_device_id = str('sonoff_device_id');
    if (str('tuya_dev_id')) patch.tuya_dev_id = str('tuya_dev_id');
    if (str('tuya_protocol_version')) patch.tuya_protocol_version = str('tuya_protocol_version');
    if (body['tuya_dp_map'] !== undefined) {
      const map = parseDpMap(body['tuya_dp_map']);
      if (map === undefined) return void res.status(400).json({ success: false, message: 'Nieprawidłowa mapa DP (oczekiwany JSON {"1": {"code": "switch"}}).' });
      patch.tuya_dp_map = map;
    }

    const updated = b.registry.upsert(dev.ieee_address, { ...patch, last_error: null });
    if (updated.driver === 'tuya') b.tuya.sync(updated);
    b.registry.audit('control', updated, `Zmieniono konfigurację: ${Object.keys(patch).join(', ') || 'brak zmian'}.`);
    res.json({ success: true, message: 'Zapisano konfigurację.', device: pub(updated) });
  });

  r.post('/api/devices/:id/delete', (req, res) => {
    const dev = b.registry.softDelete(id(req));
    if (!dev) return void res.status(404).json({ success: false, message: 'Nie znaleziono urządzenia.' });
    res.json({ success: true, message: 'Ukryto urządzenie z pulpitu.', device: pub(dev) });
  });

  r.post('/api/devices/:id/restore', (req, res) => {
    const dev = b.registry.restore(id(req));
    if (!dev) return void res.status(404).json({ success: false, message: 'Nie znaleziono urządzenia.' });
    if (dev.driver === 'tuya') b.tuya.sync(dev);
    res.json({ success: true, message: 'Przywrócono urządzenie.', device: pub(dev) });
  });

  /** Trwałe usunięcie z panelu (z historią). Opcjonalnie także z sieci Zigbee (?from_network=true). */
  const permanentDelete = async (req: Request, res: Response) => {
    const dev = b.registry.get(id(req));
    if (!dev) return void res.status(404).json({ success: false, message: 'Nie znaleziono urządzenia.' });
    let note = '';
    if (req.query['from_network'] === 'true' || req.body?.from_network === true) {
      const result = await b.registry.driverFor(dev)?.remove?.(dev);
      if (result) {
        note = result.success
          ? ' Wysłano do Zigbee2MQTT prośbę o usunięcie z sieci.'
          : ` Nie udało się przekazać prośby o usunięcie z sieci Zigbee (${result.message}) — urządzenie pozostaje sparowane i wróci na listę.`;
      }
    } else if (dev.driver === 'zigbee2mqtt') {
      note = ' Urządzenie pozostaje sparowane w Zigbee2MQTT, więc wróci na listę przy najbliższej synchronizacji.';
    }
    if (dev.driver === 'tuya') b.tuya.forget(dev.ieee_address);
    b.registry.purge(dev.ieee_address);
    res.json({ success: true, message: `Usunięto urządzenie i jego historię.${note}` });
  };
  r.post('/api/devices/:id/permanent-delete', permanentDelete);
  r.delete('/api/devices/:id/permanent', permanentDelete);

  r.post('/api/devices/batch', (req, res) => {
    const action = String(req.body?.action ?? '');
    const list = Array.isArray(req.body?.ieee_list) ? (req.body.ieee_list as string[]) : [];
    let processed = 0;
    for (const devId of list) {
      const dev = b.registry.get(devId);
      if (!dev) continue;
      if (action === 'soft_delete') b.registry.softDelete(devId);
      else if (action === 'restore') b.registry.restore(devId);
      else if (action === 'permanent_delete') {
        if (dev.driver === 'tuya') b.tuya.forget(devId);
        b.registry.purge(devId);
      } else continue;
      processed++;
    }
    b.registry.emitAll();
    res.json({ success: true, processed_count: processed, message: `Przetworzono ${processed} urządzeń.` });
  });

  const purgeAll = (_req: Request, res: Response) => {
    b.tuya.stop();
    b.registry.purgeAll();
    b.tuya.start();
    // Ponowne połączenie z brokerem sprawia, że lista urządzeń Zigbee2MQTT (retained) wraca od razu,
    // a nie dopiero przy następnej zmianie w sieci Zigbee; gniazdka Sonoff zgłoszą się przez mDNS.
    b.z2m.reconfigure({});
    b.sonoff.query();
    res.json({ success: true, message: 'Usunięto wszystkie urządzenia i historię. Urządzenia Zigbee wracają z listy Zigbee2MQTT.' });
  };
  r.post('/api/devices/purge-all', purgeAll);
  r.post('/api/devices/reset', purgeAll);

  r.post('/api/permit-join', async (req, res) => {
    const duration = Number(req.body?.duration ?? 120);
    const result = await b.z2m.permitJoin(duration);
    if (!result.success) return void res.status(502).json({ status: 'error', detail: result.message });
    b.events.broadcast({ type: 'permit_join', duration });
    res.json({ status: 'ok', duration });
  });

  return r;
}

/** Akceptuje obiekt lub JSON w tekście: {"1": {"code": "switch", "type": "Boolean"}} albo {"1": "switch"}. */
function parseDpMap(input: unknown): Record<string, TuyaDpSpec> | null | undefined {
  if (input === null || input === '') return null;
  let obj = input;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      return undefined;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  const out: Record<string, TuyaDpSpec> = {};
  for (const [dp, spec] of Object.entries(obj as Record<string, unknown>)) {
    if (!/^\d+$/.test(dp)) return undefined;
    if (typeof spec === 'string') out[dp] = { code: spec };
    else if (spec && typeof spec === 'object' && typeof (spec as TuyaDpSpec).code === 'string') out[dp] = spec as TuyaDpSpec;
    else return undefined;
  }
  return out;
}
