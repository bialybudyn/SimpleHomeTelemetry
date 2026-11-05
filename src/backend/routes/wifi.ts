import { Router } from 'express';
import type { Backend } from '../context';
import { sonoffId } from '../drivers/sonoff';
import { tuyaId } from '../drivers/tuya';
import { DEFAULT_PLUG_DP_MAP } from '../drivers/tuya-protocol';
import { ewelinkImportDevices } from '../drivers/ewelink-cloud';
import { checkTuyaQrStatus, generateTuyaQrCode } from '../drivers/tuya-cloud';
import { SECRET_MASK } from '../notifications';
import type { Device, DeviceCategory } from '../../app/models/telemetry.models';

interface EwelinkSettings {
  app_id?: string;
  app_secret?: string;
  region?: string;
  login?: string;
}

/** Kategoria Tuya (z chmury) -> kafelek panelu. */
function tuyaCategory(cat: string | undefined): DeviceCategory {
  switch (cat) {
    case 'cz':
    case 'pc':
      return 'plug';
    case 'kg':
    case 'tdq':
      return 'switch';
    case 'fs':
    case 'fsd':
      return 'fan';
    case 'ywbj':
      return 'smoke';
    case 'wsdcg':
    case 'wk':
      return 'sensor';
    case 'mcs':
      return 'contact';
    case 'pir':
      return 'occupancy';
    case 'sj':
      return 'water_leak';
    default:
      return 'switch';
  }
}

export function wifiRouter(b: Backend): Router {
  const r = Router();

  // --- Sonoff / eWeLink ---

  r.get('/api/sonoff/ewelink/config', (_req, res) => {
    const s = b.db.getSetting<EwelinkSettings>('ewelink', {});
    res.json({ success: true, config: { ...s, app_secret: s.app_secret ? SECRET_MASK : '' } });
  });

  r.post('/api/sonoff/ewelink/config', (req, res) => {
    const current = b.db.getSetting<EwelinkSettings>('ewelink', {});
    const body = (req.body ?? {}) as EwelinkSettings;
    const next: EwelinkSettings = {
      app_id: body.app_id?.trim() ?? current.app_id,
      app_secret: body.app_secret && body.app_secret !== SECRET_MASK ? body.app_secret.trim() : current.app_secret,
      region: body.region?.trim() || current.region || 'eu',
      login: body.login?.trim() ?? current.login,
    };
    b.db.setSetting('ewelink', next);
    res.json({ success: true, config: { ...next, app_secret: next.app_secret ? SECRET_MASK : '' } });
  });

  /** Jednorazowy import deviceid + devicekey z konta eWeLink. Hasło nie jest zapisywane. */
  r.post('/api/sonoff/ewelink/import', async (req, res) => {
    const stored = b.db.getSetting<EwelinkSettings>('ewelink', {});
    const body = (req.body ?? {}) as EwelinkSettings & { password?: string };
    const appSecret = body.app_secret && body.app_secret !== SECRET_MASK ? body.app_secret : stored.app_secret;
    try {
      const list = await ewelinkImportDevices({
        appId: body.app_id || stored.app_id || '',
        appSecret: appSecret || '',
        login: body.login || stored.login || '',
        password: body.password || '',
        region: body.region || stored.region || 'eu',
      });
      b.db.setSetting('ewelink', {
        app_id: body.app_id || stored.app_id,
        app_secret: appSecret,
        region: body.region || stored.region || 'eu',
        login: body.login || stored.login,
      });
      for (const d of list) {
        const devId = sonoffId(d.deviceid);
        const existing = b.registry.get(devId);
        b.registry.upsert(devId, {
          driver: 'sonoff',
          protocol: 'wifi',
          friendly_name: existing && !existing.friendly_name.startsWith('Sonoff ') ? existing.friendly_name : d.name,
          model: d.model || existing?.model || 'eWeLink',
          vendor: d.brand,
          category: existing?.category ?? 'plug',
          sonoff_device_id: d.deviceid,
          sonoff_api_key: d.devicekey,
          last_error: null,
        });
      }
      b.sonoff.start(); // ponowne zapytanie mDNS — stan pojawi się od razu
      res.json({
        success: true,
        message: `Zaimportowano klucze ${list.length} urządzeń. Sterowanie odbywa się lokalnie (LAN).`,
        devices: list.map((d) => ({ deviceId: d.deviceid, name: d.name, model: d.model, online: d.online })),
      });
    } catch (err) {
      res.status(400).json({ success: false, message: err instanceof Error ? err.message : String(err), devices: [] });
    }
  });

  // --- Ręczne dodanie urządzenia Wi-Fi ---

  r.post('/api/wifi/devices', (req, res) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const driver = body['driver'];
    const name = body['name']?.trim();
    if (driver === 'sonoff') {
      const deviceid = body['device_id']?.trim();
      if (!deviceid) return void res.status(400).json({ success: false, message: 'Podaj deviceid (np. 1000abcdef).' });
      const dev = b.registry.upsert(sonoffId(deviceid), {
        driver: 'sonoff',
        protocol: 'wifi',
        friendly_name: name || `Sonoff ${deviceid}`,
        model: 'eWeLink',
        vendor: 'SONOFF',
        category: (body['category'] as DeviceCategory) || 'plug',
        sonoff_device_id: deviceid,
        sonoff_api_key: body['device_key']?.trim() || null,
        ip_address: body['ip_address']?.trim() || undefined,
        is_deleted: false,
      });
      b.sonoff.start();
      return void res.json({ success: true, message: 'Dodano urządzenie Sonoff.', device: b.registry.toPublic(dev) });
    }
    if (driver === 'tuya') {
      const devId = body['device_id']?.trim();
      const key = body['local_key']?.trim();
      if (!devId || !key) return void res.status(400).json({ success: false, message: 'Podaj Device ID i Local Key.' });
      const category = (body['category'] as DeviceCategory) || 'plug';
      const dev = b.registry.upsert(tuyaId(devId), {
        driver: 'tuya',
        protocol: 'wifi',
        friendly_name: name || `Tuya ${devId.slice(-6)}`,
        model: body['model']?.trim() || 'Tuya Wi-Fi',
        vendor: 'Tuya',
        category,
        tuya_dev_id: devId,
        local_key: key,
        ip_address: body['ip_address']?.trim() || undefined,
        tuya_protocol_version: body['version']?.trim() || '3.3',
        tuya_dp_map: category === 'plug' ? DEFAULT_PLUG_DP_MAP : null,
        is_deleted: false,
      });
      b.tuya.sync(dev);
      return void res.json({ success: true, message: 'Dodano urządzenie Tuya.', device: b.registry.toPublic(dev) });
    }
    res.status(400).json({ success: false, message: 'Nieznany typ urządzenia (sonoff | tuya).' });
  });

  // --- Tuya: import kodem QR z aplikacji Smart Life ---

  r.post('/api/tuya/qr/generate', async (req, res) => {
    res.json(await generateTuyaQrCode(String(req.body?.user_code ?? '')));
  });

  r.get('/api/tuya/qr/status', async (req, res) => {
    const status = await checkTuyaQrStatus(String(req.query['token'] ?? ''), String(req.query['user_code'] ?? ''));
    if (status.status === 'authorized' && status.devices) {
      for (const d of status.devices) {
        if (!d.local_key) continue;
        const devId = tuyaId(d.id);
        const existing = b.registry.get(devId);
        const dev = b.registry.upsert(devId, {
          driver: 'tuya',
          protocol: 'wifi',
          friendly_name: existing?.friendly_name ?? d.name,
          model: d.product_name || 'Tuya Wi-Fi',
          vendor: 'Tuya',
          category: existing?.category ?? tuyaCategory(d.category),
          tuya_dev_id: d.id,
          tuya_product_name: d.product_name,
          local_key: d.local_key,
          tuya_dp_map: d.dp_map ?? existing?.tuya_dp_map ?? null,
          tuya_protocol_version: existing?.tuya_protocol_version ?? '3.3',
          is_deleted: false,
          last_error: null,
        } satisfies Partial<Device>);
        b.tuya.sync(dev);
      }
      // Do przeglądarki nie wysyłamy kluczy
      status.devices = status.devices.map((d) => ({ ...d, local_key: d.local_key ? SECRET_MASK : '' }));
    }
    res.json(status);
  });

  return r;
}
