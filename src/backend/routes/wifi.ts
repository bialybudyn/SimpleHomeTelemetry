import { Router } from 'express';
import type { Backend } from '../context';
import { sonoffId } from '../drivers/sonoff';
import { tuyaId } from '../drivers/tuya';
import { DEFAULT_PLUG_DP_MAP } from '../drivers/tuya-protocol';
import { randomBytes } from 'node:crypto';
import { ewelinkExchangeCode, ewelinkListDevices, ewelinkOauthUrl, type EwelinkCloudDevice } from '../drivers/ewelink-cloud';
import { checkTuyaQrStatus, generateTuyaQrCode } from '../drivers/tuya-cloud';
import { SECRET_MASK } from '../notifications';
import type { Device, DeviceCategory } from '../../app/models/telemetry.models';

interface EwelinkSettings {
  app_id?: string;
  app_secret?: string;
  /** Adres przekierowania OAuth — musi być identyczny jak w konsoli dev.ewelink.cc. */
  redirect_url?: string;
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

  const publicEwelink = (s: EwelinkSettings) => ({ ...s, app_secret: s.app_secret ? SECRET_MASK : '' });

  r.get('/api/sonoff/ewelink/config', (_req, res) => {
    res.json({ success: true, config: publicEwelink(b.db.getSetting<EwelinkSettings>('ewelink', {})) });
  });

  r.post('/api/sonoff/ewelink/config', (req, res) => {
    const current = b.db.getSetting<EwelinkSettings>('ewelink', {});
    const body = (req.body ?? {}) as EwelinkSettings;
    const next: EwelinkSettings = {
      app_id: body.app_id?.trim() ?? current.app_id,
      app_secret: body.app_secret && body.app_secret !== SECRET_MASK ? body.app_secret.trim() : current.app_secret,
      redirect_url: body.redirect_url?.trim() ?? current.redirect_url,
    };
    b.db.setSetting('ewelink', next);
    res.json({ success: true, config: publicEwelink(next) });
  });

  /** Krok 1 OAuth: adres strony logowania eWeLink. */
  r.get('/api/sonoff/ewelink/oauth/start', (_req, res) => {
    const s = b.db.getSetting<EwelinkSettings>('ewelink', {});
    if (!s.app_id || !s.app_secret || !s.redirect_url) {
      return void res.status(400).json({ success: false, message: 'Zapisz najpierw AppID, AppSecret i adres przekierowania.' });
    }
    const state = randomBytes(8).toString('hex');
    b.db.setSetting('ewelink_oauth_state', state);
    res.json({ success: true, url: ewelinkOauthUrl({ appId: s.app_id, appSecret: s.app_secret }, s.redirect_url, state) });
  });

  const importWithCode = async (code: string, region: string): Promise<{ count: number; withKey: number }> => {
    const s = b.db.getSetting<EwelinkSettings>('ewelink', {});
    if (!s.app_id || !s.app_secret || !s.redirect_url) throw new Error('Brak konfiguracji aplikacji eWeLink.');
    const app = { appId: s.app_id, appSecret: s.app_secret };
    const token = await ewelinkExchangeCode(app, region, code, s.redirect_url);
    const list = await ewelinkListDevices(app, region, token);
    importSonoffDevices(list);
    return { count: list.length, withKey: list.filter((d) => d.devicekey).length };
  };

  const importSonoffDevices = (list: EwelinkCloudDevice[]) => {
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
        sonoff_api_key: d.devicekey || existing?.sonoff_api_key || null,
        sonoff_uiid: d.uiid,
        is_deleted: false,
        last_error: d.devicekey ? null : 'Chmura nie zwróciła devicekey dla tego urządzenia.',
      });
    }
    b.sonoff.query(); // stan pojawi się po odpowiedziach mDNS
  };

  /** Krok 2 OAuth: eWeLink przekierowuje tu przeglądarkę z ?code=…&region=… */
  r.get('/api/sonoff/ewelink/oauth/callback', async (req, res) => {
    const code = String(req.query['code'] ?? '');
    const region = String(req.query['region'] ?? 'eu');
    const state = String(req.query['state'] ?? '');
    const expected = b.db.getSetting<string>('ewelink_oauth_state', '');
    const page = (ok: boolean, msg: string) =>
      res
        .status(ok ? 200 : 400)
        .type('html')
        .send(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;background:#0f172a;color:#e2e8f0;padding:2rem"><h2>${ok ? 'Gotowe' : 'Błąd'}</h2><p>${msg.replace(/</g, '&lt;')}</p><p><a style="color:#22d3ee" href="/">Wróć do panelu</a></p></body>`);
    if (!code) return void page(false, 'Brak parametru code w przekierowaniu.');
    if (expected && state && state !== expected) return void page(false, 'Nieprawidłowy parametr state — zacznij logowanie od nowa z panelu.');
    try {
      const r2 = await importWithCode(code, region);
      page(true, `Zaimportowano ${r2.count} urządzeń (z kluczem: ${r2.withKey}). Sterowanie odbywa się lokalnie w LAN.`);
    } catch (err) {
      page(false, err instanceof Error ? err.message : String(err));
    }
  });

  /** Gdy przekierowanie nie trafia do panelu: wklejenie code i region z paska adresu. */
  r.post('/api/sonoff/ewelink/oauth/code', async (req, res) => {
    let code = String(req.body?.code ?? '').trim();
    let region = String(req.body?.region ?? '').trim();
    // Akceptujemy także cały adres URL z przekierowania
    if (code.includes('code=')) {
      const u = new URL(code.startsWith('http') ? code : `http://x/?${code.split('?').pop()}`);
      code = u.searchParams.get('code') ?? '';
      region = region || u.searchParams.get('region') || '';
    }
    if (!code) return void res.status(400).json({ success: false, message: 'Podaj kod (lub cały adres z przekierowania).' });
    try {
      const r2 = await importWithCode(code, region || 'eu');
      res.json({ success: true, message: `Zaimportowano ${r2.count} urządzeń (z kluczem: ${r2.withKey}).` });
    } catch (err) {
      res.status(400).json({ success: false, message: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Diagnostyka: co widać w sieci przez mDNS. */
  r.get('/api/sonoff/diagnostics', (_req, res) => {
    b.sonoff.query();
    res.json(b.sonoff.diagnostics());
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
