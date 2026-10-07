import { Injectable, signal, computed, inject, PLATFORM_ID, DestroyRef } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  Device,
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
} from '../models/telemetry.models';

@Injectable({
  providedIn: 'root',
})
export class Telemetry {
  private http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);
  private destroyRef = inject(DestroyRef);

  // Reaktywne sygnały stanu
  readonly devices = signal<Device[]>([]);
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

  // Stan parowania Czystego Wi-Fi (SmartConfig bez Zigbee)
  readonly isWifiPairing = signal<boolean>(false);
  readonly wifiPairingRemainingSeconds = signal<number>(0);
  readonly wifiSsid = signal<string>('');
  readonly wifiLocalIp = signal<string>('');
  readonly wifiDiscoveredDevices = signal<{ ip: string; mac?: string; model: string; name: string }[]>([]);
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
    this.http.get<{ active: boolean; remaining_seconds: number; ssid: string; local_ip: string; discovered_devices: { ip: string; mac?: string; model: string; name: string }[] }>('/api/wifi/status').subscribe({
      next: (res) => {
        if (res) {
          if (res.ssid) this.wifiSsid.set(res.ssid);
          if (res.local_ip) this.wifiLocalIp.set(res.local_ip);
          if (res.discovered_devices) this.wifiDiscoveredDevices.set(res.discovered_devices);
          if (res.active && res.remaining_seconds > 0 && !this.isWifiPairing()) {
            this.startWifiPairingCountdown(res.remaining_seconds);
          }
        }
      },
      error: (err) => console.debug('Błąd pobierania statusu Wi-Fi:', err),
    });
  }

  addWifiDevice(ip_address: string, name?: string, model?: string, category = 'fan'): Promise<boolean> {
    return new Promise((resolve) => {
      this.http.post<{ success: boolean; device: Device }>('/api/wifi/add-device', { ip_address, name, model, category }).subscribe({
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

  simulatePacket(payload: Partial<TelemetryPoint>) {
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
    } else if (type === 'device_updated') {
      const dev = event['device'] as Device;
      if (dev && dev.ieee_address) {
        this.devices.update((list) =>
          list.map((d) => (d.ieee_address === dev.ieee_address ? { ...d, ...dev } : d)),
        );
      }
    } else if (type === 'devices_updated') {
      const devList = event['devices'] as Device[];
      if (Array.isArray(devList)) {
        this.devices.set(devList);
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
    this.lastTransmissionTime.set(new Date().toLocaleTimeString());

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
}
