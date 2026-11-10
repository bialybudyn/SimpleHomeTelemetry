import nodemailer from 'nodemailer';
import type { Db } from './db';
import type { EventBus } from './events';
import type { Device, SystemNotification } from '../app/models/telemetry.models';

export interface NotificationConfig {
  email_enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  email_from: string;
  email_to: string;
  telegram_enabled: boolean;
  telegram_token: string;
  telegram_chat_id: string;
}

const DEFAULT_CONFIG: NotificationConfig = {
  email_enabled: false,
  smtp_host: '',
  smtp_port: 587,
  smtp_user: '',
  smtp_pass: '',
  email_from: '',
  email_to: '',
  telegram_enabled: false,
  telegram_token: '',
  telegram_chat_id: '',
};

const SECRET_FIELDS: (keyof NotificationConfig)[] = ['smtp_pass', 'telegram_token'];
export const SECRET_MASK = '********';

/** Minimalny odstęp między powtórzeniami tego samego alarmu (powiadomienie w panelu i e-mail/Telegram). */
const ALARM_COOLDOWN_MS = 10 * 60_000;
const BATTERY_COOLDOWN_MS = 12 * 3600_000;

export class Notifier {
  private cooldowns = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly events: EventBus,
  ) {}

  getConfig(): NotificationConfig {
    return { ...DEFAULT_CONFIG, ...this.db.getSetting<Partial<NotificationConfig>>('notifications', {}) };
  }

  /** Konfiguracja do wyświetlenia w przeglądarce — bez haseł i tokenów. */
  getPublicConfig(): NotificationConfig {
    const cfg = this.getConfig();
    for (const f of SECRET_FIELDS) {
      if (cfg[f]) (cfg as unknown as Record<string, unknown>)[f] = SECRET_MASK;
    }
    return cfg;
  }

  updateConfig(patch: Partial<NotificationConfig>): NotificationConfig {
    const current = this.getConfig();
    const next: NotificationConfig = { ...current };
    for (const key of Object.keys(DEFAULT_CONFIG) as (keyof NotificationConfig)[]) {
      const v = patch[key];
      if (v === undefined) continue;
      // Zamaskowana wartość z formularza oznacza "bez zmian"
      if (SECRET_FIELDS.includes(key) && v === SECRET_MASK) continue;
      (next as unknown as Record<string, unknown>)[key] = key === 'smtp_port' ? Number(v) || 587 : v;
    }
    this.db.setSetting('notifications', next);
    return next;
  }

  list(limit = 200): SystemNotification[] {
    const rows = this.db.sql
      .prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT ?')
      .all(limit) as Array<{ id: number; ts: number; device: string | null; type: string; level: string; message: string; data: string | null; acknowledged: number }>;
    return rows.map((r) => {
      const data = r.data ? (JSON.parse(r.data) as Record<string, unknown>) : {};
      return {
        id: r.id,
        device_ieee: r.device ?? '',
        device_name: String(data['device_name'] ?? r.device ?? ''),
        type: r.type,
        level: r.level as SystemNotification['level'],
        message: r.message,
        battery: typeof data['battery'] === 'number' ? data['battery'] : undefined,
        timestamp: new Date(r.ts).toISOString(),
        acknowledged: r.acknowledged === 1,
      };
    });
  }

  acknowledge(id: number): boolean {
    return this.db.sql.prepare('UPDATE notifications SET acknowledged = 1 WHERE id = ?').run(id).changes > 0;
  }

  clear(): void {
    this.db.sql.exec('DELETE FROM notifications');
  }

  /** Alarm urządzenia: wpis w panelu + zdarzenie na żywo + e-mail/Telegram (z ograniczeniem częstotliwości). */
  alarm(dev: Device, type: string, message: string): void {
    const key = `${dev.ieee_address}:${type}`;
    const now = Date.now();
    if (now - (this.cooldowns.get(key) ?? 0) < ALARM_COOLDOWN_MS) return;
    this.cooldowns.set(key, now);
    this.store(dev, type, 'critical', message);
    this.events.broadcast({
      type: 'device_alarm',
      device_ieee: dev.ieee_address,
      friendly_name: dev.friendly_name,
      alarm_type: type,
      message,
      timestamp: new Date(now).toISOString(),
    });
    void this.sendExternal(`${dev.friendly_name}: ${message}`, `Alarm: ${dev.friendly_name}`);
  }

  battery(dev: Device, level: number): void {
    const key = `${dev.ieee_address}:battery`;
    const now = Date.now();
    if (now - (this.cooldowns.get(key) ?? 0) < BATTERY_COOLDOWN_MS) return;
    this.cooldowns.set(key, now);
    const message = `Niski poziom baterii (${level}%) w urządzeniu ${dev.friendly_name}.`;
    this.store(dev, 'battery_low', 'warning', message, { battery: level });
    this.events.broadcast({
      type: 'battery_alert',
      device_ieee: dev.ieee_address,
      friendly_name: dev.friendly_name,
      battery: level,
      message,
      timestamp: new Date(now).toISOString(),
    });
    void this.sendExternal(message, `Bateria: ${dev.friendly_name}`);
  }

  private store(dev: Device, type: string, level: string, message: string, extra: Record<string, unknown> = {}): void {
    this.db.sql
      .prepare('INSERT INTO notifications (ts, device, type, level, message, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(Date.now(), dev.ieee_address, type, level, message, JSON.stringify({ device_name: dev.friendly_name, ...extra }));
    // Trzymamy ostatnie 1000 wpisów
    this.db.sql.exec('DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT 1000)');
  }

  async sendExternal(text: string, subject: string): Promise<void> {
    const cfg = this.getConfig();
    const results = await Promise.allSettled([
      cfg.email_enabled ? this.sendEmail(cfg, subject, text) : Promise.resolve(),
      cfg.telegram_enabled ? this.sendTelegram(cfg, text) : Promise.resolve(),
    ]);
    // Nieudana wysyłka nie może przepaść bez śladu — trafia do dziennika usługi (journalctl -u simplehome)
    const channels = ['e-mail', 'Telegram'];
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        console.warn(`[POWIADOMIENIA] Nie wysłano (${channels[i]}) "${subject}": ${reason}`);
      }
    });
  }

  async sendEmail(cfg: NotificationConfig, subject: string, text: string): Promise<void> {
    if (!cfg.smtp_host || !cfg.email_to) throw new Error('Brak serwera SMTP lub adresu odbiorcy.');
    const transporter = nodemailer.createTransport({
      host: cfg.smtp_host,
      port: cfg.smtp_port,
      secure: cfg.smtp_port === 465,
      auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass } : undefined,
    });
    await transporter.sendMail({
      from: cfg.email_from || cfg.smtp_user,
      to: cfg.email_to,
      subject: `[SimpleHome] ${subject}`,
      text,
    });
  }

  async sendTelegram(cfg: NotificationConfig, text: string): Promise<void> {
    if (!cfg.telegram_token || !cfg.telegram_chat_id) throw new Error('Brak tokenu bota lub Chat ID.');
    const res = await fetch(`https://api.telegram.org/bot${cfg.telegram_token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.telegram_chat_id, text: `SimpleHome\n\n${text}` }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Telegram HTTP ${res.status}: ${await res.text()}`);
  }
}
