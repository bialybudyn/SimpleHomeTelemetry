import { hostname } from 'node:os';
import { Router } from 'express';
import type { Backend, MqttSettings } from '../context';
import { config } from '../config';
import { SECRET_MASK, type NotificationConfig } from '../notifications';
import type { Device } from '../../app/models/telemetry.models';

const BACKUP_VERSION = '2';

export function systemRouter(b: Backend): Router {
  const r = Router();

  r.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: 'system_hello' })}\n\n`);
    b.events.addSseClient(res);
  });

  r.get('/api/system/status', (_req, res) => {
    const s = b.z2m.status;
    const remaining = b.z2m.permitJoinRemaining;
    res.json({
      status: s.connected ? 'online' : 'offline',
      coordinator: s.coordinator_type ?? 'nieznany',
      chip: s.coordinator_type ?? '',
      baudrate: 0,
      firmware: s.z2m_version ? `Zigbee2MQTT ${s.z2m_version}` : '',
      active_devices: b.registry.all().filter((d) => !d.is_deleted && b.registry.isOnline(d)).length,
      permit_join_active: remaining > 0,
      permit_join_remaining: remaining,
      timestamp: new Date().toISOString(),
    });
  });

  r.get('/api/mqtt/status', (_req, res) => {
    const s = b.z2m.status;
    res.json({
      mqtt: s,
      bridge: {
        state: s.bridge_state ?? 'unknown',
        devices_count: s.devices_discovered,
        coordinator_topic: `${s.topic_prefix}/bridge/state`,
      },
      service_instructions: {
        systemd_mosquitto: 'systemctl status mosquitto',
        systemd_zigbee2mqtt: 'systemctl status zigbee2mqtt',
        restart_command: 'systemctl restart simplehome',
      },
    });
  });

  r.post('/api/mqtt/reconnect', (req, res) => {
    const patch: MqttSettings = {};
    if (typeof req.body?.url === 'string' && req.body.url.trim()) patch.url = req.body.url.trim();
    if (typeof req.body?.topic === 'string' && req.body.topic.trim()) patch.topic = req.body.topic.trim();
    if (Object.keys(patch).length > 0) {
      b.db.setSetting('mqtt', { ...b.db.getSetting<MqttSettings>('mqtt', {}), ...patch });
    }
    b.z2m.reconfigure(patch);
    res.json({ status: 'ok', mqtt: b.z2m.status });
  });

  /** "Synchronizuj": odczyt na żądanie wszystkich urządzeń, które na to pozwalają (z odstępem, by nie zalać sieci Zigbee). */
  r.post('/api/mqtt/sync', async (_req, res) => {
    const devices = b.registry.all().filter((d) => !d.is_deleted);
    let sent = 0;
    for (const dev of devices) {
      const result = await b.registry.driverFor(dev)?.refresh(dev);
      if (result?.success) sent++;
      await new Promise((r) => setTimeout(r, 150));
    }
    const skipped = devices.length - sent;
    res.json({
      status: 'ok',
      message: `Wysłano zapytanie o stan do ${sent} urządzeń — odpowiedzi pojawią się na kafelkach.` + (skipped > 0 ? ` ${skipped} nie obsługuje odczytu na żądanie lub nie odpowiedziało.` : ''),
    });
  });

  // --- powiadomienia ---

  r.get('/api/notifications', (_req, res) => {
    res.json({ notifications: b.notifier.list() });
  });

  r.post('/api/notifications/:id/acknowledge', (req, res) => {
    const ok = b.notifier.acknowledge(Number(req.params['id']));
    res.status(ok ? 200 : 404).json({ success: ok });
  });

  r.get('/api/notifications/config', (_req, res) => {
    res.json({ config: b.notifier.getPublicConfig() });
  });

  r.post('/api/notifications/config', (req, res) => {
    b.notifier.updateConfig(req.body ?? {});
    res.json({ success: true, config: b.notifier.getPublicConfig() });
  });

  const testConfig = (body: Partial<NotificationConfig>): NotificationConfig => {
    const stored = b.notifier.getConfig();
    const merged = { ...stored, ...body } as NotificationConfig;
    if (body.smtp_pass === SECRET_MASK) merged.smtp_pass = stored.smtp_pass;
    if (body.telegram_token === SECRET_MASK) merged.telegram_token = stored.telegram_token;
    return merged;
  };

  r.post('/api/notifications/test-email', async (req, res) => {
    try {
      await b.notifier.sendEmail(testConfig(req.body ?? {}), 'Test powiadomień', 'Wiadomość testowa z panelu SimpleHome.');
      res.json({ success: true, message: 'Wysłano wiadomość testową.' });
    } catch (err) {
      res.json({ success: false, message: `Błąd SMTP: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  r.post('/api/notifications/test-telegram', async (req, res) => {
    try {
      await b.notifier.sendTelegram(testConfig(req.body ?? {}), 'Wiadomość testowa z panelu SimpleHome.');
      res.json({ success: true, message: 'Wysłano wiadomość testową.' });
    } catch (err) {
      res.json({ success: false, message: `Błąd Telegram: ${err instanceof Error ? err.message : String(err)}` });
    }
  });

  r.post('/api/reset-data', (_req, res) => {
    b.notifier.clear();
    b.history.clear();
    b.events.broadcast({ type: 'data_reset' });
    res.json({ success: true, message: 'Wyczyszczono historię i powiadomienia.' });
  });

  // --- kopia zapasowa ---

  r.get('/api/backup/summary', (_req, res) => {
    const all = b.registry.all();
    res.json({
      total_devices: all.length,
      zigbee_devices: all.filter((d) => d.driver === 'zigbee2mqtt').length,
      sonoff_devices: all.filter((d) => d.driver === 'sonoff').length,
      tuya_devices: all.filter((d) => d.driver === 'tuya').length,
    });
  });

  /** Pełna kopia (z kluczami urządzeń). Zawiera sekrety — dostępna tylko po zalogowaniu. */
  r.get('/api/backup/export', (_req, res) => {
    b.registry.flush();
    const all = b.registry.all();
    res.json({
      metadata: {
        app_name: 'SimpleHomeTelemetry',
        version: BACKUP_VERSION,
        exported_at: new Date().toISOString(),
        export_hostname: hostname(),
        description: 'Kopia urządzeń i ustawień panelu (bez historii pomiarów).',
        counts: {
          total_devices: all.length,
          zigbee_devices: all.filter((d) => d.driver === 'zigbee2mqtt').length,
          wifi_devices: all.filter((d) => d.protocol === 'wifi').length,
          sonoff_devices: all.filter((d) => d.driver === 'sonoff').length,
          tuya_devices: all.filter((d) => d.driver === 'tuya').length,
          with_ip_count: all.filter((d) => d.ip_address).length,
          credentials_count: all.filter((d) => d.local_key || d.sonoff_api_key).length,
        },
      },
      devices: all,
      ewelink: b.db.getSetting('ewelink', {}),
      notifications: b.notifier.getConfig(),
      mqtt: b.db.getSetting('mqtt', {}),
    });
  });

  r.post('/api/backup/import', (req, res) => {
    const backup = req.body?.backup as { devices?: Device[]; ewelink?: unknown; notifications?: Partial<NotificationConfig>; mqtt?: MqttSettings } | undefined;
    const mode = req.body?.mode === 'merge' ? 'merge' : 'replace';
    if (!backup || !Array.isArray(backup.devices)) {
      return void res.status(400).json({ success: false, message: 'Nieprawidłowy plik kopii zapasowej.', mode });
    }
    if (mode === 'replace') {
      b.tuya.stop();
      for (const d of b.registry.all()) b.registry.purge(d.ieee_address);
    }
    let count = 0;
    for (const d of backup.devices) {
      if (!d?.ieee_address) continue;
      b.registry.upsert(d.ieee_address, d, { silent: true });
      count++;
    }
    if (backup.ewelink) b.db.setSetting('ewelink', backup.ewelink);
    if (backup.notifications) b.notifier.updateConfig(backup.notifications);
    if (backup.mqtt) {
      b.db.setSetting('mqtt', backup.mqtt);
      // Odtworzone ustawienia brokera działają od razu, a nie dopiero po restarcie usługi
      b.z2m.reconfigure({ url: backup.mqtt.url || undefined, topic: backup.mqtt.topic || undefined });
    }
    b.registry.flush();
    b.tuya.stop();
    b.tuya.start();
    b.sonoff.query(); // stan gniazdek Sonoff wróci z odpowiedzi mDNS
    b.registry.emitAll();
    const all = b.registry.all();
    res.json({
      success: true,
      message: `Odtworzono ${count} urządzeń (${mode === 'replace' ? 'zastąpienie' : 'scalenie'}).`,
      mode,
      restored_counts: {
        devices: count,
        zigbee: all.filter((d) => d.driver === 'zigbee2mqtt').length,
        wifi: all.filter((d) => d.protocol === 'wifi').length,
        sonoff: all.filter((d) => d.driver === 'sonoff').length,
        tuya: all.filter((d) => d.driver === 'tuya').length,
        credentials: all.filter((d) => d.local_key || d.sonoff_api_key).length,
      },
      dongle_max_restored: false,
      ewelink_restored: Boolean(backup.ewelink),
      notifications_restored: Boolean(backup.notifications),
    });
  });

  r.get('/api/health', (_req, res) => {
    res.json({ ok: true, mqtt: b.z2m.status.connected, auth: Boolean(config.panelPassword) });
  });

  return r;
}
