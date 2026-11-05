import { Injectable, signal, computed, inject, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  BackupImportResponse,
  Device,
  DeviceAuditLog,
  HistoryResponse,
  MqttStatus,
  MqttStatusResponse,
  SystemBackupPackage,
  SystemNotification,
  SystemStatus,
  TuyaQrGenerateResponse,
  TuyaQrStatusResponse,
} from '../models/telemetry.models';
import { format24hTime } from '../utils/date-format';

export interface EwelinkSettings {
  app_id?: string;
  app_secret?: string;
  redirect_url?: string;
}

export interface SonoffDiagnostics {
  mdns_running: boolean;
  mdns_error: string | null;
  seen: {
    deviceid: string;
    ip: string;
    type?: string;
    encrypt: boolean;
    last_seen: string;
    has_key: boolean;
    decrypt_ok: boolean | null;
  }[];
}

export interface WifiDeviceInput {
  driver: 'sonoff' | 'tuya';
  name?: string;
  device_id: string;
  device_key?: string;
  local_key?: string;
  ip_address?: string;
  version?: string;
  category?: string;
}

export interface DeviceConfigPatch {
  friendly_name?: string;
  ip_address?: string;
  category?: string;
  local_key?: string;
  sonoff_device_id?: string;
  sonoff_device_key?: string;
  tuya_dev_id?: string;
  tuya_protocol_version?: string;
  tuya_dp_map?: string | null;
}

type ApiResult = { success: boolean; message: string; device?: Device };

/**
 * Stan panelu po stronie przeglądarki: lista urządzeń, zdarzenia na żywo (WebSocket / SSE) i wywołania API.
 * Stan urządzeń zmienia się wyłącznie na podstawie danych z serwera (potwierdzonych przez urządzenia).
 */
@Injectable({
  providedIn: 'root',
})
export class Telemetry {
  private http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);
  private destroyRef = inject(DestroyRef);

  readonly devices = signal<Device[]>([]);
  readonly allDevices = signal<Device[]>([]);
  readonly adminDevicesData = signal<{
    total: number;
    active: Device[];
    disconnected: Device[];
    deleted: Device[];
    all: Device[];
    logs?: DeviceAuditLog[];
  } | null>(null);
  readonly deviceAuditLogs = signal<DeviceAuditLog[]>([]);
  readonly isActionProcessing = signal<boolean>(false);
  readonly connectionStatus = signal<'connected' | 'connecting' | 'disconnected'>('connecting');
  readonly isPairing = signal<boolean>(false);
  readonly pairingRemainingSeconds = signal<number>(0);
  readonly systemStatus = signal<SystemStatus | null>(null);
  readonly lastTransmissionTime = signal<string>('brak danych');

  readonly mqttStatus = signal<MqttStatus | null>(null);
  readonly bridgeState = signal<string>('offline');
  readonly isReconnectingMqtt = signal<boolean>(false);

  readonly notifications = signal<SystemNotification[]>([]);
  readonly batteryAlertToast = signal<SystemNotification | null>(null);

  readonly isMuted = signal<boolean>(false);
  readonly tempMaxLimit = signal<number>(28.0);
  readonly tempMinLimit = signal<number>(16.0);
  readonly batteryMinLimit = signal<number>(15);

  readonly isExportingBackup = signal<boolean>(false);
  readonly isImportingBackup = signal<boolean>(false);
  readonly lastImportResult = signal<BackupImportResponse | null>(null);

  readonly lowBatteryDevices = computed(() =>
    this.devices().filter((d) => d.battery !== undefined && d.battery !== null && d.battery <= this.batteryMinLimit()),
  );

  readonly alertCount = computed(() => {
    const maxT = this.tempMaxLimit();
    const minT = this.tempMinLimit();
    const minB = this.batteryMinLimit();
    return this.devices().filter(
      (d) =>
        (d.last_temperature !== undefined && d.last_temperature !== null && (d.last_temperature > maxT || d.last_temperature < minT)) ||
        (d.battery !== undefined && d.battery !== null && d.battery <= minB),
    ).length;
  });

  private pairingTimer: ReturnType<typeof setInterval> | null = null;
  private ws: WebSocket | null = null;
  private sse: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pulseResetTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;
    this.fetchDevices();
    this.fetchSystemStatus();
    this.fetchMqttStatus();
    this.fetchNotifications();
    this.initRealtime();

    // Stan na żywo przychodzi przez WebSocket; okresowo odświeżamy tylko status systemu
    const statusInterval = setInterval(() => {
      this.fetchSystemStatus();
      this.fetchMqttStatus();
    }, 30000);

    this.destroyRef.onDestroy(() => {
      clearInterval(statusInterval);
      if (this.pairingTimer) clearInterval(this.pairingTimer);
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.ws?.close();
      this.sse?.close();
    });
  }

  // ---------------------------------------------------------------- urządzenia

  fetchDevices(): void {
    this.http.get<{ devices: Device[] }>('/api/devices?include_deleted=true').subscribe({
      next: (res) => {
        const list = res?.devices ?? [];
        this.allDevices.set(list);
        this.devices.set(list.filter((d) => !d.is_deleted));
      },
      error: (err) => console.debug('Błąd pobierania urządzeń:', err),
    });
  }

  fetchAdminDevices(): void {
    this.http
      .get<{ total: number; active: Device[]; disconnected: Device[]; deleted: Device[]; all: Device[]; logs: DeviceAuditLog[] }>('/api/admin/devices')
      .subscribe({
        next: (res) => {
          this.adminDevicesData.set(res);
          this.allDevices.set(res.all ?? []);
          this.deviceAuditLogs.set(res.logs ?? []);
        },
        error: (err) => console.debug('Błąd pobierania danych urządzeń:', err),
      });
  }

  private async action(url: string, body: unknown = {}): Promise<boolean> {
    this.isActionProcessing.set(true);
    try {
      await firstValueFrom(this.http.post(url, body));
      return true;
    } catch (err) {
      console.error(`Błąd ${url}:`, err);
      return false;
    } finally {
      this.isActionProcessing.set(false);
      this.fetchDevices();
      this.fetchAdminDevices();
    }
  }

  deleteDevice(ieee: string): Promise<boolean> {
    return this.action(`/api/devices/${encodeURIComponent(ieee)}/delete`);
  }

  restoreDevice(ieee: string): Promise<boolean> {
    return this.action(`/api/devices/${encodeURIComponent(ieee)}/restore`);
  }

  permanentDeleteDevice(ieee: string): Promise<boolean> {
    return this.action(`/api/devices/${encodeURIComponent(ieee)}/permanent-delete`);
  }

  batchDeviceAction(action: 'soft_delete' | 'restore' | 'permanent_delete', ieee_list: string[]): Promise<boolean> {
    return this.action('/api/devices/batch', { action, ieee_list });
  }

  purgeAllDevices(): Promise<boolean> {
    return this.action('/api/devices/purge-all');
  }

  resetAllData(): Promise<boolean> {
    return this.action('/api/reset-data').then((ok) => {
      if (ok) {
        this.notifications.set([]);
        this.batteryAlertToast.set(null);
      }
      return ok;
    });
  }

  /** Odczyt stanu urządzenia na żądanie. */
  testDeviceConnection(ieee: string): Promise<ApiResult> {
    return firstValueFrom(this.http.post<ApiResult>(`/api/devices/${encodeURIComponent(ieee)}/refresh`, {})).catch((err) => ({
      success: false,
      message: err?.error?.message || 'Brak odpowiedzi serwera.',
    }));
  }

  /** Odczyt na żądanie wszystkich urządzeń, które to obsługują. */
  syncMqttDevices(): void {
    this.http.post('/api/mqtt/sync', {}).subscribe({ error: (err) => console.debug('Błąd synchronizacji:', err) });
  }

  renameDevice(ieee: string, friendly_name: string): Promise<boolean> {
    return firstValueFrom(this.http.post(`/api/devices/${encodeURIComponent(ieee)}/rename`, { friendly_name }))
      .then(() => {
        this.patchLocal(ieee, { friendly_name });
        return true;
      })
      .catch(() => false);
  }

  fetchDeviceHistory(ieee: string, range = '24h') {
    return this.http.get<HistoryResponse>(`/api/devices/${encodeURIComponent(ieee)}/history?range=${range}`);
  }

  /**
   * Wysyła polecenie do urządzenia. Kafelek zmieni stan dopiero, gdy urządzenie potwierdzi zmianę
   * (zdarzenie device_updated) — dzięki temu panel nie pokazuje stanu, którego nie ma.
   */
  sendDeviceCommand(ieee: string, command: Record<string, unknown>): Promise<boolean> {
    return firstValueFrom(this.http.post<{ status: string; device: Device }>(`/api/devices/${encodeURIComponent(ieee)}/set`, command))
      .then((res) => {
        if (res?.device) this.patchLocal(ieee, res.device);
        return true;
      })
      .catch((err) => {
        this.patchLocal(ieee, { last_error: err?.error?.detail || 'Polecenie nie zostało wykonane.' });
        return false;
      });
  }

  configureDevice(ieee: string, payload: DeviceConfigPatch): Promise<ApiResult> {
    return firstValueFrom(this.http.post<ApiResult>(`/api/devices/${encodeURIComponent(ieee)}/configure`, payload))
      .then((res) => {
        if (res.device) this.patchLocal(ieee, res.device);
        return res;
      })
      .catch((err) => ({ success: false, message: err?.error?.message || 'Błąd zapisu konfiguracji.' }));
  }

  /** Szybka zmiana adresu IP urządzenia Wi-Fi. */
  assignDeviceIp(ieee: string, ip: string): Promise<boolean> {
    return this.configureDevice(ieee, { ip_address: ip }).then((r) => r.success);
  }

  // ---------------------------------------------------------------- Wi-Fi (Sonoff, Tuya)

  addWifiDevice(input: WifiDeviceInput): Promise<ApiResult> {
    return firstValueFrom(this.http.post<ApiResult>('/api/wifi/devices', input))
      .then((res) => {
        this.fetchDevices();
        return res;
      })
      .catch((err) => ({ success: false, message: err?.error?.message || 'Nie udało się dodać urządzenia.' }));
  }

  getEwelinkSettings(): Promise<EwelinkSettings> {
    return firstValueFrom(this.http.get<{ config: EwelinkSettings }>('/api/sonoff/ewelink/config'))
      .then((r) => r.config ?? {})
      .catch(() => ({}));
  }

  saveEwelinkSettings(settings: EwelinkSettings): Promise<boolean> {
    return firstValueFrom(this.http.post('/api/sonoff/ewelink/config', settings))
      .then(() => true)
      .catch(() => false);
  }

  /** Adres strony logowania eWeLink (OAuth 2.0). */
  startEwelinkOauth(): Promise<{ success: boolean; url?: string; message?: string }> {
    return firstValueFrom(this.http.get<{ success: boolean; url?: string; message?: string }>('/api/sonoff/ewelink/oauth/start')).catch((err) => ({
      success: false,
      message: err?.error?.message || 'Błąd serwera.',
    }));
  }

  /** Ręczne przekazanie kodu (lub całego adresu) z przekierowania eWeLink. */
  submitEwelinkCode(code: string, region: string): Promise<{ success: boolean; message: string }> {
    return firstValueFrom(this.http.post<{ success: boolean; message: string }>('/api/sonoff/ewelink/oauth/code', { code, region }))
      .then((res) => {
        this.fetchDevices();
        return res;
      })
      .catch((err) => ({ success: false, message: err?.error?.message || 'Błąd importu z eWeLink.' }));
  }

  getSonoffDiagnostics(): Promise<SonoffDiagnostics | null> {
    return firstValueFrom(this.http.get<SonoffDiagnostics>('/api/sonoff/diagnostics')).catch(() => null);
  }

  generateTuyaQr(userCode: string) {
    return this.http.post<TuyaQrGenerateResponse>('/api/tuya/qr/generate', { user_code: userCode });
  }

  checkTuyaQrStatus(token: string, userCode: string) {
    return this.http.get<TuyaQrStatusResponse>(
      `/api/tuya/qr/status?token=${encodeURIComponent(token)}&user_code=${encodeURIComponent(userCode)}`,
    );
  }

  // ---------------------------------------------------------------- system

  fetchSystemStatus(): void {
    this.http.get<SystemStatus>('/api/system/status').subscribe({
      next: (status) => {
        this.systemStatus.set(status);
        if (status.permit_join_active && status.permit_join_remaining > 0 && !this.isPairing()) {
          this.startPairingCountdown(status.permit_join_remaining);
        }
      },
      error: (err) => console.debug('Błąd pobierania statusu systemu:', err),
    });
  }

  fetchMqttStatus(): void {
    this.http.get<MqttStatusResponse>('/api/mqtt/status').subscribe({
      next: (res) => {
        if (res?.mqtt) this.mqttStatus.set(res.mqtt);
        if (res?.bridge?.state) this.bridgeState.set(res.bridge.state);
      },
      error: (err) => console.debug('Błąd pobierania statusu MQTT:', err),
    });
  }

  reconnectMqtt(customUrl?: string): Promise<boolean> {
    this.isReconnectingMqtt.set(true);
    return firstValueFrom(this.http.post('/api/mqtt/reconnect', { url: customUrl }))
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => {
          this.fetchMqttStatus();
          this.isReconnectingMqtt.set(false);
        }, 1500);
      });
  }

  triggerPermitJoin(duration = 120): void {
    this.http.post<{ status: string; duration: number }>('/api/permit-join', { duration }).subscribe({
      next: (res) => this.startPairingCountdown(res.duration || duration),
      error: (err) => console.error('Błąd włączania parowania:', err),
    });
  }

  startPairingCountdown(seconds: number): void {
    if (this.pairingTimer) clearInterval(this.pairingTimer);
    this.isPairing.set(true);
    this.pairingRemainingSeconds.set(seconds);
    this.pairingTimer = setInterval(() => {
      const cur = this.pairingRemainingSeconds();
      if (cur <= 1) {
        if (this.pairingTimer) clearInterval(this.pairingTimer);
        this.isPairing.set(false);
        this.pairingRemainingSeconds.set(0);
        this.fetchDevices();
      } else {
        this.pairingRemainingSeconds.set(cur - 1);
      }
    }, 1000);
  }

  fetchNotifications(): void {
    this.http.get<{ notifications: SystemNotification[] }>('/api/notifications').subscribe({
      next: (res) => this.notifications.set(res?.notifications ?? []),
      error: (err) => console.debug('Błąd pobierania powiadomień:', err),
    });
  }

  acknowledgeNotification(id: number): void {
    this.http.post(`/api/notifications/${id}/acknowledge`, {}).subscribe({
      next: () => this.notifications.update((list) => list.map((n) => (n.id === id ? { ...n, acknowledged: true } : n))),
    });
  }

  dismissBatteryToast(): void {
    this.batteryAlertToast.set(null);
  }

  // ---------------------------------------------------------------- kopia zapasowa

  getBackupPackage(): Promise<{ success: boolean; data?: SystemBackupPackage; message?: string }> {
    this.isExportingBackup.set(true);
    return firstValueFrom(this.http.get<SystemBackupPackage>('/api/backup/export'))
      .then((data) => ({ success: true, data }))
      .catch((err) => ({ success: false, message: err?.error?.message || 'Błąd podczas generowania kopii zapasowej.' }))
      .finally(() => this.isExportingBackup.set(false));
  }

  async triggerBackupDownload(): Promise<boolean> {
    const res = await this.getBackupPackage();
    if (!res.success || !res.data || !isPlatformBrowser(this.platformId)) return false;
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `simplehome-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    return true;
  }

  restoreBackupPackage(backupData: SystemBackupPackage, mode: 'replace' | 'merge' = 'replace'): Promise<BackupImportResponse> {
    this.isImportingBackup.set(true);
    return firstValueFrom(this.http.post<BackupImportResponse>('/api/backup/import', { backup: backupData, mode }))
      .catch(
        (err): BackupImportResponse => ({
          success: false,
          message: err?.error?.message || 'Błąd podczas wgrywania kopii zapasowej.',
          mode,
          restored_counts: { devices: 0, zigbee: 0, wifi: 0, sonoff: 0, tuya: 0, credentials: 0 },
          dongle_max_restored: false,
          ewelink_restored: false,
          notifications_restored: false,
          errors: [String(err?.message || err)],
        }),
      )
      .then((res) => {
        this.lastImportResult.set(res);
        this.fetchDevices();
        return res;
      })
      .finally(() => this.isImportingBackup.set(false));
  }

  // ---------------------------------------------------------------- zdarzenia na żywo

  private initRealtime(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    try {
      this.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    } catch {
      this.initSseFallback();
      return;
    }
    this.ws.onopen = () => {
      this.connectionStatus.set('connected');
      // Po ponownym połączeniu dociągamy stan, który mógł się zmienić w trakcie przerwy
      this.fetchDevices();
    };
    this.ws.onmessage = (evt) => {
      try {
        this.handleIncomingEvent(JSON.parse(evt.data));
      } catch (err) {
        console.debug('WS parse error:', err);
      }
    };
    this.ws.onclose = () => {
      this.connectionStatus.set('connecting');
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.initRealtime(), 5000);
    };
  }

  /** Tryb deweloperski (ng serve) nie ma WebSocketa — wtedy SSE. */
  private initSseFallback(): void {
    if (this.sse) return;
    this.sse = new EventSource('/api/events');
    this.sse.onopen = () => this.connectionStatus.set('connected');
    this.sse.onmessage = (evt) => {
      try {
        this.handleIncomingEvent(JSON.parse(evt.data));
      } catch (err) {
        console.debug('SSE parse error:', err);
      }
    };
    this.sse.onerror = () => this.connectionStatus.set('disconnected');
  }

  private patchLocal(ieee: string, patch: Partial<Device>): void {
    const apply = (list: Device[]) => list.map((d) => (d.ieee_address === ieee ? { ...d, ...patch } : d));
    this.devices.update(apply);
    this.allDevices.update(apply);
  }

  private upsertLocal(dev: Device): void {
    const upsert = (list: Device[]) => {
      const idx = list.findIndex((d) => d.ieee_address === dev.ieee_address);
      if (idx < 0) return [...list, dev];
      const copy = [...list];
      copy[idx] = { ...copy[idx], ...dev };
      return copy;
    };
    this.allDevices.update(upsert);
    if (dev.is_deleted) this.devices.update((list) => list.filter((d) => d.ieee_address !== dev.ieee_address));
    else this.devices.update(upsert);
  }

  private handleIncomingEvent(event: Record<string, unknown>): void {
    switch (event['type']) {
      case 'telemetry': {
        const ieee = event['device_ieee'] as string;
        if (ieee) this.pulse(ieee);
        break;
      }
      case 'device_updated': {
        const dev = event['device'] as Device;
        if (dev?.ieee_address) this.upsertLocal(dev);
        break;
      }
      case 'devices_updated': {
        const list = event['devices'] as Device[];
        if (Array.isArray(list)) {
          this.allDevices.set(list);
          this.devices.set(list.filter((d) => !d.is_deleted));
        }
        break;
      }
      case 'device_deleted':
      case 'device_permanently_deleted': {
        const ieee = event['ieee_address'] as string;
        this.devices.update((list) => list.filter((d) => d.ieee_address !== ieee));
        if (event['type'] === 'device_permanently_deleted') {
          this.allDevices.update((list) => list.filter((d) => d.ieee_address !== ieee));
        }
        break;
      }
      case 'device_renamed': {
        const ieee = event['device_ieee'] as string;
        const name = event['friendly_name'] as string;
        if (ieee && name) this.patchLocal(ieee, { friendly_name: name });
        break;
      }
      case 'battery_alert': {
        const item: SystemNotification = {
          id: Date.now(),
          device_ieee: String(event['device_ieee'] ?? ''),
          device_name: String(event['friendly_name'] ?? ''),
          type: 'battery_low',
          level: 'warning',
          message: String(event['message'] ?? ''),
          battery: Number(event['battery'] ?? 0),
          timestamp: String(event['timestamp'] ?? new Date().toISOString()),
          acknowledged: false,
        };
        this.batteryAlertToast.set(item);
        this.fetchNotifications();
        break;
      }
      case 'device_alarm':
        this.playAlarmAudio();
        this.fetchNotifications();
        break;
      case 'permit_join':
        this.startPairingCountdown(Number(event['duration'] ?? 60));
        break;
      case 'mqtt_status':
        if (event['data']) this.mqttStatus.set(event['data'] as MqttStatus);
        break;
      case 'bridge_state':
        if (event['state']) this.bridgeState.set(String(event['state']));
        break;
      case 'data_reset':
        this.notifications.set([]);
        this.batteryAlertToast.set(null);
        break;
    }
  }

  /** Krótkie podświetlenie kafelka po nadejściu nowych danych. */
  private pulse(ieee: string): void {
    this.lastTransmissionTime.set(format24hTime(new Date(), true));
    this.patchLocal(ieee, { isRecentlyUpdated: true });
    const prev = this.pulseResetTimeouts.get(ieee);
    if (prev) clearTimeout(prev);
    this.pulseResetTimeouts.set(
      ieee,
      setTimeout(() => {
        this.patchLocal(ieee, { isRecentlyUpdated: false });
        this.pulseResetTimeouts.delete(ieee);
      }, 1200),
    );
  }

  /**
   * Odtwarza głośny, donośny alarm w stylu klasycznego budzika (kadencja 4 ostrych pisków x 2 serie)
   * Używa kompresora dynamiki i dwóch zsynchronizowanych generatorów piezo/square dla maksymalnej słyszalności.
   */
  playAlarmAudio(force = false): void {
    if (!force && this.isMuted()) return;
    if (typeof window === 'undefined') return;
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();

      // Kompresor dynamiki dla podbicia głośności i zapobiegania przesterom
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-18, ctx.currentTime);
      compressor.knee.setValueAtTime(24, ctx.currentTime);
      compressor.ratio.setValueAtTime(12, ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, ctx.currentTime);
      compressor.release.setValueAtTime(0.2, ctx.currentTime);

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0.85, ctx.currentTime);

      compressor.connect(masterGain);
      masterGain.connect(ctx.destination);

      // Kadencja budzika cyfrowego: 4 impulsy 'BEEP-BEEP-BEEP-BEEP', przerwa 0.25s, i ponowne 4 impulsy
      const beepDuration = 0.085;
      const pauseDuration = 0.045;
      const cyclePause = 0.24;

      let currentTimeOffset = 0.02;

      // 2 serie budzika
      for (let cycle = 0; cycle < 2; cycle++) {
        for (let beep = 0; beep < 4; beep++) {
          const startTime = ctx.currentTime + currentTimeOffset;
          const endTime = startTime + beepDuration;

          // Dwa oscylatory: wysoki przenikliwy ton budzika 2048Hz + harmoniczny 1024Hz
          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();
          const beepGain = ctx.createGain();

          osc1.type = 'square';
          osc2.type = 'sawtooth';

          osc1.frequency.setValueAtTime(2048, startTime);
          osc2.frequency.setValueAtTime(1024, startTime);

          // Szybki, ostry atak piezo
          beepGain.gain.setValueAtTime(0, startTime);
          beepGain.gain.linearRampToValueAtTime(0.9, startTime + 0.008);
          beepGain.gain.setValueAtTime(0.9, endTime - 0.01);
          beepGain.gain.exponentialRampToValueAtTime(0.01, endTime);

          osc1.connect(beepGain);
          osc2.connect(beepGain);
          beepGain.connect(compressor);

          osc1.start(startTime);
          osc2.start(startTime);
          osc1.stop(endTime);
          osc2.stop(endTime);

          currentTimeOffset += beepDuration + pauseDuration;
        }
        currentTimeOffset += cyclePause;
      }

      // Bezpieczne zamknięcie kontekstu po zakończeniu sekwencji
      setTimeout(() => {
        try {
          ctx.close();
        } catch (closeErr) {
          console.debug('AudioContext close error:', closeErr);
        }
      }, (currentTimeOffset + 0.3) * 1000);
    } catch (err) {
      console.debug('Failed to play alarm audio:', err);
    }
  }
}
