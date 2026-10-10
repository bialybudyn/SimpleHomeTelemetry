import { Injectable, signal, computed, inject, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  Device,
  DeviceCategory,
  DongleMaxConfig,
  DongleMaxTestResult,
  GitUpdateResult,
  HistoryResponse,
  MqttStatus,
  MqttStatusResponse,
  ServicesInspectionReport,
  SystemNotification,
  SystemStatus,
  TelemetryPoint,
  TuyaQrGenerateResponse,
  TuyaQrStatusResponse,
  TinyTuyaTestResponse,
  TinyTuyaScanResponse,
  DeviceAuditLog,
} from '../models/telemetry.models';
import { format24hTime } from '../utils/date-format';

@Injectable({
  providedIn: 'root',
})
export class Telemetry {
  private http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);
  private destroyRef = inject(DestroyRef);

  // Reaktywne sygnały stanu
  readonly devices = signal<Device[]>([]);
  readonly allDevices = signal<Device[]>([]);
  readonly adminDevicesData = signal<{
    total: number;
    active: Device[];
    disconnected: Device[];
    deleted: Device[];
    all: Device[];
    logs: DeviceAuditLog[];
  } | null>(null);
  readonly deviceAuditLogs = signal<DeviceAuditLog[]>([]);
  readonly isActionProcessing = signal<boolean>(false);
  readonly connectionStatus = signal<'connected' | 'connecting' | 'disconnected'>('connecting');
  readonly isPairing = signal<boolean>(false);
  readonly pairingRemainingSeconds = signal<number>(0);
  readonly systemStatus = signal<SystemStatus | null>(null);
  readonly lastTransmissionTime = signal<string>('brak danych');
  readonly activeAlert = signal<{ message: string; type: 'warning' | 'info' } | null>(null);

  // Status brokera Mosquitto MQTT i Zigbee2MQTT
  readonly mqttStatus = signal<MqttStatus | null>(null);
  readonly bridgeState = signal<string>('offline');
  readonly isReconnectingMqtt = signal<boolean>(false);

  // Konfiguracja sieciowa Sonoff Dongle Max
  readonly dongleMaxConfig = signal<DongleMaxConfig | null>(null);
  readonly dongleMaxTestResult = signal<DongleMaxTestResult | null>(null);
  readonly isTestingDongleMax = signal<boolean>(false);

  // Stan parowania Czystego Wi-Fi (Dongle-MAX AP & SmartConfig)
  readonly isWifiPairing = signal<boolean>(false);
  readonly wifiPairingRemainingSeconds = signal<number>(0);
  readonly wifiSsid = signal<string>('');
  readonly wifiLocalIp = signal<string>('');
  readonly wifiDiscoveredDevices = signal<{ ip: string; mac?: string; model: string; name: string }[]>([]);
  readonly dongleMaxAp = signal<{
    enabled: boolean;
    ssid: string;
    ip: string;
    channel: number;
    dhcp_range: string;
  }>({
    enabled: false,
    ssid: '',
    ip: '',
    channel: 0,
    dhcp_range: '',
  });
  private wifiPairingTimer: ReturnType<typeof setInterval> | null = null;

  // Powiadomienia systemowe (w tym alerty baterii < 15%)
  readonly notifications = signal<SystemNotification[]>([]);
  readonly batteryAlertToast = signal<SystemNotification | null>(null);

  // Inspekcja usług i aktualizacja Git
  readonly servicesReport = signal<ServicesInspectionReport | null>(null);
  readonly isInspectingServices = signal<boolean>(false);
  readonly isUpdatingGit = signal<boolean>(false);
  readonly gitUpdateResult = signal<GitUpdateResult | null>(null);

  // Progi alarmowe
  readonly isMuted = signal<boolean>(false);
  readonly tempMaxLimit = signal<number>(28.0);
  readonly tempMinLimit = signal<number>(16.0);
  readonly batteryMinLimit = signal<number>(15); // Próg 15% zgodnie ze specyfikacją

  // Czujniki ze stanem baterii poniżej 15%
  readonly lowBatteryDevices = computed(() => {
    return this.devices().filter((d) => d.battery !== undefined && d.battery !== null && d.battery <= 15);
  });

  // Liczba urządzeń z alarmem
  readonly alertCount = computed(() => {
    const list = this.devices();
    const maxT = this.tempMaxLimit();
    const minT = this.tempMinLimit();
    const minB = this.batteryMinLimit();

    return list.filter(
      (d) =>
        (d.last_temperature !== undefined && d.last_temperature !== null && (d.last_temperature > maxT || d.last_temperature < minT)) ||
        (d.battery !== undefined && d.battery !== null && d.battery <= minB),
    ).length;
  });

  private pairingTimer: ReturnType<typeof setInterval> | null = null;
  private ws: WebSocket | null = null;
  private sse: EventSource | null = null;
  private pulseResetTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.fetchDevices();
      this.fetchSystemStatus();
      this.fetchMqttStatus();
      this.fetchWifiStatus();
      this.fetchNotifications();
      this.loadEwelinkConfig();
      this.fetchDongleMaxConfig();
      this.initRealtime();

      // Odświeżanie statusu systemu i powiadomień co 15s
      const statusInterval = setInterval(() => {
        this.fetchSystemStatus();
        this.fetchMqttStatus();
        this.fetchWifiStatus();
        this.fetchNotifications();
        this.fetchDongleMaxConfig();
      }, 15000);

      this.destroyRef.onDestroy(() => {
        clearInterval(statusInterval);
        if (this.pairingTimer) clearInterval(this.pairingTimer);
        if (this.ws) this.ws.close();
        if (this.sse) this.sse.close();
      });
    }
  }

  fetchMqttStatus(): void {
    this.http.get<MqttStatusResponse>('/api/mqtt/status').subscribe({
      next: (res) => {
        if (res?.mqtt) {
          this.mqttStatus.set(res.mqtt);
        }
        if (res?.bridge?.state) {
          this.bridgeState.set(res.bridge.state);
        }
      },
      error: (err) => console.debug('Błąd pobierania statusu MQTT:', err),
    });
  }

  reconnectMqtt(customUrl?: string): Promise<boolean> {
    this.isReconnectingMqtt.set(true);
    return new Promise((resolve) => {
      this.http.post('/api/mqtt/reconnect', { url: customUrl }).subscribe({
        next: () => {
          setTimeout(() => {
            this.fetchMqttStatus();
            this.isReconnectingMqtt.set(false);
            resolve(true);
          }, 1500);
        },
        error: () => {
          this.isReconnectingMqtt.set(false);
          resolve(false);
        },
      });
    });
  }

  fetchNotifications(): void {
    this.http.get<{ notifications: SystemNotification[] }>('/api/notifications').subscribe({
      next: (res) => {
        if (res?.notifications) {
          this.notifications.set(res.notifications);
        }
      },
      error: (err) => console.debug('Błąd pobierania powiadomień:', err),
    });
  }

  acknowledgeNotification(id: number): void {
    this.http.post(`/api/notifications/${id}/acknowledge`, {}).subscribe({
      next: () => {
        this.notifications.update((list) =>
          list.map((n) => (n.id === id ? { ...n, acknowledged: true } : n)),
        );
      },
      error: (err) => console.debug('Błąd potwierdzania powiadomienia:', err),
    });
  }

  dismissBatteryToast(): void {
    this.batteryAlertToast.set(null);
  }

  fetchDevices(): void {
    this.http.get<{ devices: Device[] }>('/api/devices').subscribe({
      next: (res) => {
        if (res?.devices) {
          this.devices.set(res.devices);
        }
      },
      error: (err) => console.warn('Błąd pobierania czujników:', err),
    });
    this.fetchAdminDevices();
  }

  fetchAdminDevices(): void {
    this.http.get<{
      total: number;
      active: Device[];
      disconnected: Device[];
      deleted: Device[];
      all: Device[];
      logs: DeviceAuditLog[];
    }>('/api/admin/devices').subscribe({
      next: (res) => {
        if (res) {
          this.adminDevicesData.set(res);
          this.allDevices.set(res.all || []);
          if (res.logs) {
            this.deviceAuditLogs.set(res.logs);
          }
        }
      },
      error: (err) => console.debug('Błąd pobierania danych urządzeń admina:', err),
    });
  }

  deleteDevice(ieee: string): Promise<boolean> {
    this.isActionProcessing.set(true);
    return new Promise((resolve) => {
      this.http.post<{ success: boolean; message: string; device: Device }>(`/api/devices/${encodeURIComponent(ieee)}/delete`, {}).subscribe({
        next: () => {
          this.isActionProcessing.set(false);
          this.devices.update((list) => list.filter((d) => d.ieee_address !== ieee));
          this.fetchAdminDevices();
          resolve(true);
        },
        error: (err) => {
          this.isActionProcessing.set(false);
          console.error('Błąd usuwania urządzenia:', err);
          resolve(false);
        },
      });
    });
  }

  restoreDevice(ieee: string): Promise<boolean> {
    this.isActionProcessing.set(true);
    return new Promise((resolve) => {
      this.http.post<{ success: boolean; message: string; device: Device }>(`/api/devices/${encodeURIComponent(ieee)}/restore`, {}).subscribe({
        next: (res) => {
          this.isActionProcessing.set(false);
          if (res?.device) {
            this.devices.update((list) => {
              const idx = list.findIndex((d) => d.ieee_address === ieee);
              if (idx >= 0) {
                const copy = [...list];
                copy[idx] = res.device;
                return copy;
              }
              return [...list, res.device];
            });
          }
          this.fetchDevices();
          resolve(true);
        },
        error: (err) => {
          this.isActionProcessing.set(false);
          console.error('Błąd przywracania urządzenia:', err);
          resolve(false);
        },
      });
    });
  }

  permanentDeleteDevice(ieee: string): Promise<boolean> {
    this.isActionProcessing.set(true);
    return new Promise((resolve) => {
      this.http.post<{ success: boolean; message: string }>(`/api/devices/${encodeURIComponent(ieee)}/permanent-delete`, {}).subscribe({
        next: () => {
          this.isActionProcessing.set(false);
          this.devices.update((list) => list.filter((d) => d.ieee_address !== ieee));
          this.allDevices.update((list) => list.filter((d) => d.ieee_address !== ieee));
          this.fetchAdminDevices();
          resolve(true);
        },
        error: (err) => {
          this.isActionProcessing.set(false);
          console.error('Błąd trwałego usuwania urządzenia:', err);
          resolve(false);
        },
      });
    });
  }

  batchDeviceAction(action: 'soft_delete' | 'restore' | 'permanent_delete', ieee_list: string[]): Promise<boolean> {
    this.isActionProcessing.set(true);
    return new Promise((resolve) => {
      this.http.post<{ success: boolean; processed_count: number; message: string }>('/api/devices/batch', { action, ieee_list }).subscribe({
        next: () => {
          this.isActionProcessing.set(false);
          this.fetchDevices();
          this.fetchAdminDevices();
          resolve(true);
        },
        error: (err) => {
          this.isActionProcessing.set(false);
          console.error('Błąd operacji zbiorczej:', err);
          resolve(false);
        },
      });
    });
  }

  testDeviceConnection(ieee: string): Promise<{ success: boolean; message: string; device?: Device }> {
    return new Promise((resolve) => {
      this.http.post<{ success: boolean; message: string; device?: Device }>(`/api/devices/${encodeURIComponent(ieee)}/test-connection`, {}).subscribe({
        next: (res) => {
          if (res?.device) {
            this.devices.update((list) => list.map((d) => (d.ieee_address === ieee ? { ...d, ...res.device } : d)));
          }
          this.fetchAdminDevices();
          resolve(res);
        },
        error: (err) => {
          resolve({ success: false, message: err?.error?.message || 'Błąd połączenia' });
        },
      });
    });
  }

  syncMqttDevices(): void {
    this.http.post<{ status: string; message: string }>('/api/mqtt/sync', {}).subscribe({
      next: () => {
        setTimeout(() => this.fetchDevices(), 800);
      },
      error: (err) => console.debug('Błąd synchronizacji MQTT:', err),
    });
  }

  fetchSystemStatus(): void {
    this.http.get<SystemStatus>('/api/system/status').subscribe({
      next: (status) => {
        this.systemStatus.set(status);
        if (status.permit_join_active && status.permit_join_remaining > 0) {
          this.startPairingCountdown(status.permit_join_remaining);
        }
      },
      error: (err) => console.debug('Błąd pobierania statusu systemu:', err),
    });
  }

  triggerPermitJoin(duration = 160): void {
    this.http.post<{ status: string; duration: number }>('/api/permit-join', { duration }).subscribe({
      next: (res) => {
        this.startPairingCountdown(res.duration || duration);
      },
      error: (err) => {
        console.error('Błąd permit-join:', err);
        this.startPairingCountdown(duration);
      },
    });
  }

  triggerWifiPairing(ssid: string, password = '', duration = 160): void {
    this.wifiSsid.set(ssid);
    this.http.post<{ status: string; duration: number; local_ip: string }>('/api/wifi/pair-smartconfig', { ssid, password, duration }).subscribe({
      next: (res) => {
        if (res?.local_ip) this.wifiLocalIp.set(res.local_ip);
        this.startWifiPairingCountdown(res.duration || duration);
      },
      error: (err) => {
        console.error('Błąd parowania Wi-Fi:', err);
        this.startWifiPairingCountdown(duration);
      },
    });
  }

  startWifiPairingCountdown(seconds: number): void {
    if (this.wifiPairingTimer) clearInterval(this.wifiPairingTimer);
    this.isWifiPairing.set(true);
    this.wifiPairingRemainingSeconds.set(seconds);

    this.wifiPairingTimer = setInterval(() => {
      const cur = this.wifiPairingRemainingSeconds();
      if (cur <= 1) {
        if (this.wifiPairingTimer) clearInterval(this.wifiPairingTimer);
        this.isWifiPairing.set(false);
        this.wifiPairingRemainingSeconds.set(0);
        this.fetchDevices();
      } else {
        this.wifiPairingRemainingSeconds.set(cur - 1);
      }
    }, 1000);
  }

  fetchWifiStatus(): void {
    this.http.get<{
      active: boolean;
      remaining_seconds: number;
      ssid: string;
      local_ip: string;
      discovered_devices: { ip: string; mac?: string; model: string; name: string }[];
      dongle_ap?: { enabled: boolean; ssid: string; ip: string; channel: number; dhcp_range: string };
    }>('/api/wifi/status').subscribe({
      next: (res) => {
        if (res) {
          if (res.ssid) this.wifiSsid.set(res.ssid);
          if (res.local_ip) this.wifiLocalIp.set(res.local_ip);
          if (res.discovered_devices) this.wifiDiscoveredDevices.set(res.discovered_devices);
          if (res.dongle_ap) this.dongleMaxAp.set(res.dongle_ap);
          if (res.active && res.remaining_seconds > 0 && !this.isWifiPairing()) {
            this.startWifiPairingCountdown(res.remaining_seconds);
          }
        }
      },
      error: (err) => console.debug('Błąd pobierania statusu Wi-Fi:', err),
    });
  }

  addWifiDevice(
    ip_address: string,
    name?: string,
    model?: string,
    category: DeviceCategory = 'plug',
    vendor?: string,
    extra?: { local_key?: string; tuya_dev_id?: string; tuya_protocol_version?: string; tuya_product_name?: string },
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this.http.post<{ success: boolean; device: Device }>('/api/wifi/add-device', {
        ip_address,
        name,
        model,
        category,
        vendor,
        ...extra,
      }).subscribe({
        next: (res) => {
          if (res?.device) {
            this.devices.update((list) => {
              const idx = list.findIndex((d) => d.ieee_address === res.device.ieee_address);
              if (idx >= 0) {
                const copy = [...list];
                copy[idx] = res.device;
                return copy;
              }
              return [...list, res.device];
            });
            this.fetchDevices();
            resolve(true);
          } else {
            resolve(false);
          }
        },
        error: () => resolve(false),
      });
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

  renameDevice(ieee: string, friendly_name: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.http.post(`/api/devices/${encodeURIComponent(ieee)}/rename`, { friendly_name }).subscribe({
        next: () => {
          this.devices.update((list) =>
            list.map((d) => (d.ieee_address === ieee ? { ...d, friendly_name } : d)),
          );
          resolve(true);
        },
        error: () => resolve(false),
      });
    });
  }

  fetchDeviceHistory(ieee: string, range = '24h') {
    return this.http.get<HistoryResponse>(
      `/api/devices/${encodeURIComponent(ieee)}/history?range=${range}`,
    );
  }

  simulatePacket(payload: Partial<TelemetryPoint> & Record<string, unknown>) {
    return this.http.post('/api/simulate', payload);
  }

  fetchDongleMaxConfig(): void {
    this.http.get<{ config: DongleMaxConfig }>('/api/dongle-max/config').subscribe({
      next: (res) => {
        if (res?.config) {
          this.dongleMaxConfig.set(res.config);
        }
      },
      error: (err) => console.debug('Błąd pobierania konfiguracji Dongle Max:', err),
    });
  }

  saveDongleMaxConfig(updated: Partial<DongleMaxConfig>): Promise<boolean> {
    return new Promise((resolve) => {
      this.http.post<{ status: string; config: DongleMaxConfig }>('/api/dongle-max/config', updated).subscribe({
        next: (res) => {
          if (res?.config) {
            this.dongleMaxConfig.set(res.config);
          }
          this.fetchSystemStatus();
          resolve(true);
        },
        error: () => resolve(false),
      });
    });
  }

  testDongleMaxConnection(host?: string, port?: number): Promise<DongleMaxTestResult> {
    this.isTestingDongleMax.set(true);
    this.dongleMaxTestResult.set(null);
    return new Promise((resolve) => {
      this.http.post<DongleMaxTestResult>('/api/dongle-max/test-connection', { host, port }).subscribe({
        next: (res) => {
          this.isTestingDongleMax.set(false);
          this.dongleMaxTestResult.set(res);
          resolve(res);
        },
        error: (err) => {
          this.isTestingDongleMax.set(false);
          const failResult: DongleMaxTestResult = {
            success: false,
            host: host || 'Dongle-M.local',
            port: port || 6638,
            message: `Błąd połączenia: ${err.message || 'Nieosiągalny host/port'}`,
            tested_at: new Date().toISOString(),
            operating_mode: this.dongleMaxConfig()?.operating_mode || 'coordinator',
          };
          this.dongleMaxTestResult.set(failResult);
          resolve(failResult);
        },
      });
    });
  }

  sendDeviceCommand(ieee: string, command: Record<string, unknown>): Promise<boolean> {
    return new Promise((resolve) => {
      // Optymistyczna aktualizacja lokalnego stanu urządzenia
      this.devices.update((list) =>
        list.map((d) => (d.ieee_address === ieee ? { ...d, ...command } : d)),
      );

      this.http.post<{ status: string; device: Device }>(`/api/devices/${encodeURIComponent(ieee)}/set`, command).subscribe({
        next: (res) => {
          if (res?.device) {
            this.devices.update((list) =>
              list.map((d) => (d.ieee_address === ieee ? { ...d, ...res.device } : d)),
            );
          }
          resolve(true);
        },
        error: () => resolve(false),
      });
    });
  }

  inspectServices(): Promise<ServicesInspectionReport | null> {
    this.isInspectingServices.set(true);
    return new Promise((resolve) => {
      this.http.get<ServicesInspectionReport>('/api/system/inspect-services').subscribe({
        next: (rep) => {
          this.servicesReport.set(rep);
          this.isInspectingServices.set(false);
          resolve(rep);
        },
        error: (err) => {
          console.error('Błąd inspekcji usług:', err);
          this.isInspectingServices.set(false);
          resolve(null);
        },
      });
    });
  }

  runGitUpdate(): Promise<GitUpdateResult | null> {
    this.isUpdatingGit.set(true);
    return new Promise((resolve) => {
      this.http.post<GitUpdateResult>('/api/system/git-update', {}).subscribe({
        next: (res) => {
          this.gitUpdateResult.set(res);
          this.isUpdatingGit.set(false);
          resolve(res);
        },
        error: (err) => {
          console.error('Błąd git pull:', err);
          const failRes: GitUpdateResult = {
            success: false,
            updated: false,
            message: 'Błąd połączenia z serwerem podczas aktualizacji Git',
            output: String(err?.message || err),
          };
          this.gitUpdateResult.set(failRes);
          this.isUpdatingGit.set(false);
          resolve(failRes);
        },
      });
    });
  }

  resetAllData(): Promise<boolean> {
    return new Promise((resolve) => {
      this.http.post('/api/devices/reset', {}).subscribe({
        next: () => {
          this.devices.set([]);
          this.notifications.set([]);
          this.lastTransmissionTime.set('brak danych');
          this.batteryAlertToast.set(null);
          resolve(true);
        },
        error: () => resolve(false),
      });
    });
  }

  private initRealtime(): void {
    // 1. Próba nawiązania połączenia WebSocket
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.connectionStatus.set('connected');
      };

      this.ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          this.handleIncomingEvent(data);
        } catch (err) {
          console.debug('WS parse error:', err);
        }
      };

      this.ws.onclose = () => {
        this.connectionStatus.set('connecting');
        this.initSseFallback();
      };

      this.ws.onerror = () => {
        this.initSseFallback();
      };
    } catch (err) {
      console.debug('WS setup error:', err);
      this.initSseFallback();
    }
  }

  private initSseFallback(): void {
    if (this.sse) return;
    try {
      this.sse = new EventSource('/api/events');
      this.sse.onopen = () => {
        this.connectionStatus.set('connected');
      };
      this.sse.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data);
          this.handleIncomingEvent(data);
        } catch (err) {
          console.debug('SSE parse error:', err);
        }
      };
      this.sse.onerror = () => {
        this.connectionStatus.set('disconnected');
      };
    } catch {
      this.connectionStatus.set('disconnected');
    }
  }

  private handleIncomingEvent(event: Record<string, unknown>): void {
    const type = event['type'] as string;

    if (type === 'telemetry') {
      const ieee = event['device_ieee'] as string;
      const data = event['data'] as Partial<TelemetryPoint>;
      if (ieee && data) {
        this.updateDeviceFromTelemetry(ieee, data);
      }
    } else if (type === 'battery_alert') {
      const item: SystemNotification = {
        id: Date.now(),
        device_ieee: (event['device_ieee'] as string) || '',
        device_name: (event['friendly_name'] as string) || (event['device_ieee'] as string) || 'Czujnik',
        type: 'battery_low',
        level: 'critical',
        message: (event['message'] as string) || `Niski poziom baterii (${event['battery']}%)!`,
        battery: (event['battery'] as number) || 0,
        timestamp: (event['timestamp'] as string) || new Date().toISOString(),
        acknowledged: false,
      };
      this.notifications.update((list) => [item, ...list.filter((n) => n.device_ieee !== item.device_ieee || n.type !== 'battery_low')]);
      this.batteryAlertToast.set(item);
    } else if (type === 'device_alarm') {
      this.playAlarmAudio();
      const item: SystemNotification = {
        id: Date.now(),
        device_ieee: (event['device_ieee'] as string) || '',
        device_name: (event['friendly_name'] as string) || 'Urządzenie',
        type: (event['alarm_type'] as string) || 'alarm',
        level: 'critical',
        message: (event['message'] as string) || 'Zdarzenie alarmowe!',
        battery: 100,
        timestamp: (event['timestamp'] as string) || new Date().toISOString(),
        acknowledged: false,
      };
      this.notifications.update((list) => [item, ...list]);
    } else if (type === 'permit_join') {
      const dur = (event['duration'] as number) || 60;
      this.startPairingCountdown(dur);
    } else if (type === 'device_renamed') {
      const ieee = event['device_ieee'] as string;
      const name = event['friendly_name'] as string;
      if (ieee && name) {
        this.devices.update((list) =>
          list.map((d) => (d.ieee_address === ieee ? { ...d, friendly_name: name } : d)),
        );
      }
    } else if (type === 'mqtt_status') {
      const status = event['data'] as MqttStatus;
      if (status) {
        this.mqttStatus.set(status);
      }
    } else if (type === 'bridge_state') {
      const state = event['state'] as string;
      if (state) {
        this.bridgeState.set(state);
      }
    } else if (type === 'device_deleted') {
      const ieee = event['ieee_address'] as string;
      if (ieee) {
        this.devices.update((list) => list.filter((d) => d.ieee_address !== ieee));
        this.fetchAdminDevices();
      }
    } else if (type === 'device_permanently_deleted') {
      const ieee = event['ieee_address'] as string;
      if (ieee) {
        this.devices.update((list) => list.filter((d) => d.ieee_address !== ieee));
        this.allDevices.update((list) => list.filter((d) => d.ieee_address !== ieee));
        this.fetchAdminDevices();
      }
    } else if (type === 'device_updated') {
      const dev = event['device'] as Device;
      if (dev && dev.ieee_address) {
        if (dev.is_deleted) {
          this.devices.update((list) => list.filter((d) => d.ieee_address !== dev.ieee_address));
        } else {
          this.devices.update((list) => {
            const idx = list.findIndex((d) => d.ieee_address === dev.ieee_address);
            if (idx >= 0) {
              const copy = [...list];
              copy[idx] = { ...copy[idx], ...dev };
              return copy;
            }
            return [...list, dev];
          });
        }
        this.allDevices.update((list) => {
          const idx = list.findIndex((d) => d.ieee_address === dev.ieee_address);
          if (idx >= 0) {
            const copy = [...list];
            copy[idx] = { ...copy[idx], ...dev };
            return copy;
          }
          return [...list, dev];
        });
      }
    } else if (type === 'devices_updated') {
      const devList = event['devices'] as Device[];
      if (Array.isArray(devList)) {
        this.devices.set(devList.filter((d) => !d.is_deleted));
        this.allDevices.set(devList);
      }
    } else if (type === 'dongle_max_config_updated') {
      const cfg = event['config'] as DongleMaxConfig;
      if (cfg) {
        this.dongleMaxConfig.set(cfg);
        this.fetchSystemStatus();
      }
    } else if (type === 'data_reset') {
      this.devices.set([]);
      this.notifications.set([]);
      this.lastTransmissionTime.set('brak danych');
      this.batteryAlertToast.set(null);
    }
  }

  private updateDeviceFromTelemetry(ieee: string, data: Partial<TelemetryPoint>): void {
    this.lastTransmissionTime.set(format24hTime(new Date(), true));

    // Wyzwolenie efektu pulsu na karcie
    this.devices.update((list) => {
      let found = false;
      const updatedList = list.map((d) => {
        if (d.ieee_address === ieee) {
          found = true;
          return {
            ...d,
            last_temperature: data.temperature !== undefined ? data.temperature : d.last_temperature,
            last_humidity: data.humidity !== undefined ? data.humidity : d.last_humidity,
            battery: data.battery !== undefined ? data.battery : d.battery,
            linkquality: data.linkquality !== undefined ? data.linkquality : d.linkquality,
            power: data.power !== undefined ? data.power : d.power,
            energy: data.energy !== undefined ? data.energy : d.energy,
            current_heating_setpoint: data.setpoint !== undefined ? data.setpoint : d.current_heating_setpoint,
            state: data.state !== undefined ? data.state : d.state,
            last_seen: data.timestamp ?? new Date().toISOString(),
            isRecentlyUpdated: true,
          };
        }
        return d;
      });

      if (!found) {
        // Nowy czujnik dodany w locie - brak syntetyzowania nieznanych wartości!
        updatedList.push({
          ieee_address: ieee,
          friendly_name: `Czujnik ${ieee.slice(-4)}`,
          model: 'Zigbee Sensor',
          last_seen: data.timestamp ?? new Date().toISOString(),
          battery: data.battery !== undefined && data.battery !== null ? data.battery : null,
          last_temperature: data.temperature !== undefined && data.temperature !== null ? data.temperature : null,
          last_humidity: data.humidity !== undefined && data.humidity !== null ? data.humidity : null,
          linkquality: data.linkquality !== undefined && data.linkquality !== null ? data.linkquality : null,
          isRecentlyUpdated: true,
        });
      }

      return updatedList;
    });

    // Wycofaj flagę pulsu po 1.2 sekundy
    if (this.pulseResetTimeouts.has(ieee)) {
      clearTimeout(this.pulseResetTimeouts.get(ieee));
    }
    const timer = setTimeout(() => {
      this.devices.update((list) =>
        list.map((d) => (d.ieee_address === ieee ? { ...d, isRecentlyUpdated: false } : d)),
      );
      this.pulseResetTimeouts.delete(ieee);
    }, 1200);
    this.pulseResetTimeouts.set(ieee, timer);
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

  // ==========================================
  // METODY DLA TUYA LOCAL KEY (SKANOWANIE KODU QR)
  // ==========================================

  generateTuyaQr(userCode: string) {
    return this.http.post<TuyaQrGenerateResponse>('/api/tuya/qr/generate', { user_code: userCode });
  }

  checkTuyaQrStatus(token: string, userCode: string) {
    return this.http.get<TuyaQrStatusResponse>(
      `/api/tuya/qr/status?token=${encodeURIComponent(token)}&user_code=${encodeURIComponent(userCode)}`
    );
  }

  bindTuyaDevice(payload: {
    ieee_address: string;
    local_key: string;
    tuya_dev_id?: string;
    ip_address?: string;
    product_name?: string;
    protocol_version?: string;
  }) {
    return this.http.post<{ success: boolean; device: Device; message?: string }>(
      '/api/tuya/device/bind',
      payload
    );
  }

  testTuyaLocal(payload: {
    ip_address: string;
    local_key: string;
    tuya_dev_id?: string;
    protocol_version?: string;
  }) {
    return this.http.post<{ success: boolean; message: string }>('/api/tuya/device/test', payload);
  }

  // ==========================================
  // METODY DLA TINYTUYA (ZARZĄDZANIE WI-FI / LOCAL KEY / STATUS / SCAN)
  // ==========================================

  testTinyTuya(payload: {
    ip: string;
    local_key: string;
    dev_id: string;
    version?: string;
  }) {
    return this.http.post<TinyTuyaTestResponse>('/api/tinytuya/device/test', payload);
  }

  scanTinyTuya() {
    return this.http.post<TinyTuyaScanResponse>('/api/tinytuya/scan', {});
  }

  getTinyTuyaDeviceStatus(payload: {
    ip: string;
    local_key: string;
    dev_id: string;
    version?: string;
    category?: DeviceCategory;
  }) {
    return this.http.post<{
      success: boolean;
      device_data?: Record<string, unknown>;
      raw_dps?: Record<string, unknown>;
      message?: string;
      error?: string;
    }>('/api/tinytuya/device/status', payload);
  }

  sendTinyTuyaDirectCommand(payload: {
    ip: string;
    local_key: string;
    dev_id: string;
    version?: string;
    category?: DeviceCategory;
    command?: Record<string, unknown>;
    dps?: Record<string, unknown>;
  }) {
    return this.http.post<{
      success: boolean;
      message?: string;
      error?: string;
      device_data?: Record<string, unknown>;
    }>('/api/tinytuya/device/set', payload);
  }

  saveDeviceTuyaConfig(ieee_address: string, config: {
    local_key: string;
    tuya_dev_id?: string;
    tuya_protocol_version?: string;
    ip_address?: string;
    category?: DeviceCategory;
    friendly_name?: string;
  }) {
    return this.http.post<{ success: boolean; message: string; device?: Device }>(
      '/api/tinytuya/device/config',
      { ieee_address, ...config }
    );
  }

  // ==========================================
  // METODY DLA SONOFF SMARTPLUG S60TFP WI-FI (eWeLink LAN)
  // ==========================================

  testSonoffDevice(payload: { ip: string; device_id?: string; api_key?: string }) {
    return this.http.post<{ success: boolean; message: string; deviceInfo?: Record<string, unknown> }>(
      '/api/sonoff/device/test',
      payload
    );
  }

  scanSonoffLan() {
    return this.http.post<{
      success: boolean;
      discovered: Array<{ ip: string; deviceId?: string; model: string; switch?: string }>;
      message: string;
    }>('/api/sonoff/scan', {});
  }

  addSonoffDevice(payload: { ip_address: string; name?: string; device_id?: string; api_key?: string }): Promise<boolean> {
    return new Promise((resolve) => {
      this.http.post<{ success: boolean; message: string; device: Device }>('/api/sonoff/device/add', payload).subscribe({
        next: (res) => {
          if (res?.device) {
            this.devices.update((list) => {
              const idx = list.findIndex((d) => d.ieee_address === res.device.ieee_address);
              if (idx >= 0) {
                const copy = [...list];
                copy[idx] = res.device;
                return copy;
              }
              return [...list, res.device];
            });
            this.fetchDevices();
            resolve(true);
          } else {
            resolve(false);
          }
        },
        error: () => resolve(false),
      });
    });
  }

  purgeAllDevices(): Promise<boolean> {
    return new Promise((resolve) => {
      this.http.post<{ success: boolean; message: string }>('/api/devices/purge-all', {}).subscribe({
        next: (res) => {
          if (res?.success) {
            this.devices.set([]);
            this.fetchDevices();
            resolve(true);
          } else {
            resolve(false);
          }
        },
        error: () => resolve(false),
      });
    });
  }

  readonly isAutoDiscovering = signal<boolean>(false);
  readonly dongleMaxDiscoveredDevices = signal<Array<{
    ip: string;
    deviceId?: string;
    model: string;
    switch?: string;
    rssi?: number;
    power?: number;
    voltage?: number;
    current?: number;
    isAlreadyAdded: boolean;
  }>>([]);

  readonly ewelinkConfig = signal<{
    email?: string;
    phoneNumber?: string;
    region?: string;
    connected?: boolean;
    lastSync?: string;
    devices?: Array<{
      deviceId: string;
      apiKey: string;
      name: string;
      model: string;
      switch?: string;
      online: boolean;
      ip?: string;
    }>;
  }>({ region: 'eu', connected: false });

  loadEwelinkConfig(): void {
    this.http.get<{ success: boolean; config: unknown }>('/api/sonoff/ewelink/config').subscribe({
      next: (res) => {
        if (res && res.config) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          this.ewelinkConfig.set(res.config as any);
        }
      },
      error: () => {},
    });
  }

  loginEwelink(emailOrPhone: string, password: string, region = 'eu'): Promise<{ success: boolean; message: string; devicesCount: number }> {
    return new Promise((resolve) => {
      this.http.post<{ success: boolean; message: string; devices: unknown[] }>('/api/sonoff/ewelink/login', {
        email_or_phone: emailOrPhone,
        password,
        region,
      }).subscribe({
        next: (res) => {
          this.fetchDevices();
          this.loadEwelinkConfig();
          resolve({
            success: res?.success || false,
            message: res?.message || 'Zalogowano pomyślnie do eWeLink!',
            devicesCount: res?.devices?.length || 0,
          });
        },
        error: (err) => {
          resolve({
            success: false,
            message: err?.error?.message || 'Błąd logowania do eWeLink.',
            devicesCount: 0,
          });
        },
      });
    });
  }

  controlEwelinkDevice(deviceId: string, state: 'on' | 'off'): Promise<{ success: boolean; message: string }> {
    return new Promise((resolve) => {
      this.http.post<{ success: boolean; message: string }>('/api/sonoff/ewelink/control', {
        device_id: deviceId,
        state,
      }).subscribe({
        next: (res) => {
          this.fetchDevices();
          resolve(res);
        },
        error: (err) => {
          resolve({
            success: false,
            message: err?.error?.message || 'Błąd sterowania eWeLink.',
          });
        },
      });
    });
  }

  autoDiscoverDongleMaxSubnet(subnet?: string): Promise<{
    success: boolean;
    message: string;
    discoveredCount: number;
    allDetected: Array<{
      ip: string;
      deviceId?: string;
      model: string;
      switch?: string;
      rssi?: number;
      power?: number;
      voltage?: number;
      current?: number;
      isAlreadyAdded: boolean;
    }>;
  }> {
    this.isAutoDiscovering.set(true);
    return new Promise((resolve) => {
      this.http
        .post<{
          success: boolean;
          message: string;
          discovered: Device[];
          allDetected?: Array<{
            ip: string;
            deviceId?: string;
            model: string;
            switch?: string;
            rssi?: number;
            power?: number;
            voltage?: number;
            current?: number;
            isAlreadyAdded: boolean;
          }>;
        }>('/api/dongle-max/auto-discover', { subnet })
        .subscribe({
          next: (res) => {
            this.isAutoDiscovering.set(false);
            if (res?.allDetected) {
              this.dongleMaxDiscoveredDevices.set(res.allDetected);
            }
            this.fetchDevices();
            resolve({
              success: res?.success || false,
              message: res?.message || 'Ukończono skanowanie podsieci.',
              discoveredCount: res?.discovered?.length || 0,
              allDetected: res?.allDetected || [],
            });
          },
          error: (err) => {
            this.isAutoDiscovering.set(false);
            resolve({
              success: false,
              message: `Błąd podczas auto-odkrywania: ${err.message || 'Brak odpowiedzi'}`,
              discoveredCount: 0,
              allDetected: [],
            });
          },
        });
    });
  }
}

