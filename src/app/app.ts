import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { CdkDragDrop, CdkDropList, CdkDrag, CdkDragHandle, moveItemInArray } from '@angular/cdk/drag-drop';
import { Telemetry } from './services/telemetry';
import { Device, DeviceCategory } from './models/telemetry.models';
import { DeviceCard } from './components/device-card/device-card';
import { AnalyticsModal } from './components/analytics-modal/analytics-modal';
import { AnalyticsView } from './components/analytics-view/analytics-view';
import { WifiPairingModal } from './components/wifi-pairing-modal/wifi-pairing-modal';
import { TopologyGraph } from './components/topology-graph/topology-graph';
import { ServerSettings } from './components/server-settings/server-settings';
import { ScenesBuilder } from './components/scenes-builder/scenes-builder';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [
    MatIconModule,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    DeviceCard,
    AnalyticsModal,
    AnalyticsView,
    WifiPairingModal,
    TopologyGraph,
    ServerSettings,
    ScenesBuilder,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly platformId = inject(PLATFORM_ID);
  readonly telemetry = inject(Telemetry);

  readonly activeTab = signal<'dashboard' | 'scenes' | 'analytics' | 'settings'>('dashboard');

  // Stany zwijania pulpitów (Pulpit Zigbee oraz Pulpit Wi-Fi)
  readonly isZigbeeCollapsed = signal<boolean>(this.loadBoolean('z2m_zigbee_collapsed', false));
  readonly isWifiCollapsed = signal<boolean>(this.loadBoolean('z2m_wifi_collapsed', false));

  // Filtry kategorii dla Pulpitu Zigbee
  readonly selectedZigbeeFilter = signal<'all' | 'climate' | 'plug' | 'switch' | 'sensor'>('all');

  // Filtry kategorii dla Pulpitu Wi-Fi
  readonly selectedWifiFilter = signal<'all' | 'plug' | 'switch' | 'fan' | 'climate' | 'sensor'>('all');

  // Własna kolejność kafelków (Drag & Drop) zapisywana w localStorage
  readonly zigbeeCustomOrder = signal<string[]>(this.loadOrder('z2m_zigbee_custom_order'));
  readonly wifiCustomOrder = signal<string[]>(this.loadOrder('z2m_wifi_custom_order'));

  readonly selectedDeviceForModal = signal<Device | null>(null);
  readonly renamingDevice = signal<Device | null>(null);
  readonly renameValue = signal<string>('');
  readonly showWifiModal = signal<boolean>(false);

  // Sprawdzanie czy urządzenie jest urządzeniem Wi-Fi (nie Zigbee)
  isWifiDevice(d: Device): boolean {
    if (d.protocol === 'wifi') return true;
    if (d.ieee_address?.startsWith('wifi_')) return true;
    const v = (d.vendor || '').toLowerCase();
    const m = (d.model || '').toLowerCase();
    const f = (d.friendly_name || '').toLowerCase();
    return v.includes('wi-fi') || v.includes('wifi') || m.includes('wi-fi') || m.includes('wifi') || f.includes('(wi-fi)') || f.includes('wifi');
  }

  // --- PULPIT ZIGBEE: Urządzenia i Kolejność Drag & Drop ---
  readonly allZigbeeDevices = computed(() => {
    return this.telemetry.devices().filter((d) => !this.isWifiDevice(d));
  });

  readonly sortedZigbeeDevices = computed(() => {
    const list = this.allZigbeeDevices();
    const order = this.zigbeeCustomOrder();
    if (order.length === 0) return list;

    const map = new Map(list.map((d) => [d.ieee_address, d]));
    const result: Device[] = [];

    // Najpierw według zdefiniowanej kolejności użytkownika
    for (const id of order) {
      const dev = map.get(id);
      if (dev) {
        result.push(dev);
        map.delete(id);
      }
    }
    // Pozostałe nowo dodane urządzenia
    for (const dev of map.values()) {
      result.push(dev);
    }
    return result;
  });

  readonly filteredZigbeeDevices = computed(() => {
    const list = this.sortedZigbeeDevices();
    const filter = this.selectedZigbeeFilter();
    if (filter === 'all') return list;

    return list.filter((d) => {
      const cat = d.category || this.inferCategory(d);
      if (filter === 'climate') return cat === 'climate';
      if (filter === 'plug') return cat === 'plug';
      if (filter === 'switch') return cat === 'switch';
      if (filter === 'sensor') return cat === 'sensor' || cat === 'contact' || cat === 'occupancy' || cat === 'water_leak';
      return true;
    });
  });

  // Liczniki kategorii Zigbee
  readonly zigbeeClimateCount = computed(() => {
    return this.allZigbeeDevices().filter((d) => (d.category || this.inferCategory(d)) === 'climate').length;
  });

  readonly zigbeePlugCount = computed(() => {
    return this.allZigbeeDevices().filter((d) => (d.category || this.inferCategory(d)) === 'plug').length;
  });

  readonly zigbeeSwitchCount = computed(() => {
    return this.allZigbeeDevices().filter((d) => (d.category || this.inferCategory(d)) === 'switch').length;
  });

  readonly zigbeeSensorCount = computed(() => {
    return this.allZigbeeDevices().filter((d) => {
      const c = d.category || this.inferCategory(d);
      return c === 'sensor' || c === 'contact' || c === 'occupancy' || c === 'water_leak';
    }).length;
  });

  // --- PULPIT WI-FI: Urządzenia i Kolejność Drag & Drop ---
  readonly allWifiDevices = computed(() => {
    return this.telemetry.devices().filter((d) => this.isWifiDevice(d));
  });

  readonly sortedWifiDevices = computed(() => {
    const list = this.allWifiDevices();
    const order = this.wifiCustomOrder();
    if (order.length === 0) return list;

    const map = new Map(list.map((d) => [d.ieee_address, d]));
    const result: Device[] = [];

    for (const id of order) {
      const dev = map.get(id);
      if (dev) {
        result.push(dev);
        map.delete(id);
      }
    }
    for (const dev of map.values()) {
      result.push(dev);
    }
    return result;
  });

  readonly filteredWifiDevices = computed(() => {
    const list = this.sortedWifiDevices();
    const filter = this.selectedWifiFilter();
    if (filter === 'all') return list;

    return list.filter((d) => {
      const cat = d.category || this.inferCategory(d);
      if (filter === 'plug') return cat === 'plug';
      if (filter === 'switch') return cat === 'switch';
      if (filter === 'fan') return cat === 'fan';
      if (filter === 'climate') return cat === 'climate';
      if (filter === 'sensor') return cat === 'sensor' || cat === 'contact' || cat === 'occupancy' || cat === 'water_leak';
      return true;
    });
  });

  readonly wifiPlugCount = computed(() => {
    return this.allWifiDevices().filter((d) => (d.category || this.inferCategory(d)) === 'plug').length;
  });

  readonly wifiSwitchCount = computed(() => {
    return this.allWifiDevices().filter((d) => (d.category || this.inferCategory(d)) === 'switch').length;
  });

  readonly wifiFanCount = computed(() => {
    return this.allWifiDevices().filter((d) => (d.category || this.inferCategory(d)) === 'fan').length;
  });

  readonly wifiClimateCount = computed(() => {
    return this.allWifiDevices().filter((d) => (d.category || this.inferCategory(d)) === 'climate').length;
  });

  readonly wifiSensorCount = computed(() => {
    return this.allWifiDevices().filter((d) => {
      const c = d.category || this.inferCategory(d);
      return c === 'sensor' || c === 'contact' || c === 'occupancy' || c === 'water_leak';
    }).length;
  });

  private inferCategory(d: Device): DeviceCategory {
    const m = (d.model || '').toLowerCase();
    const f = (d.friendly_name || '').toLowerCase();
    if (f.includes('czujnik c') || f.includes('czujnik temp') || f.includes('temperatura') || f.includes('wilgotn') || m.includes('snzb-02d') || m.includes('snzb-02')) return 'sensor';
    if (m.includes('trv') || m.includes('thermostat') || m.includes('termostat') || m.includes('sonoff trvzb') || f.includes('termostat') || f.includes('glowica') || f.includes('głowica') || d.occupied_heating_setpoint !== undefined) return 'climate';
    if (m.includes('plug') || m.includes('s26') || m.includes('s40') || m.includes('s31') || m.includes('ts011f') || f.includes('gniazdko') || d.power !== undefined) return 'plug';
    if (m.includes('mini') || m.includes('zbmini') || m.includes('switch') || m.includes('relay') || f.includes('przekaźnik') || f.includes('włącznik') || (d.state !== undefined && d.power === undefined)) return 'switch';
    if (m.includes('gow') || m.includes('fan') || f.includes('wentylator') || d.fan_speed !== undefined) return 'fan';
    if (m.includes('snzb-04') || m.includes('contact') || d.contact !== undefined) return 'contact';
    if (m.includes('snzb-03') || m.includes('motion') || m.includes('pir') || d.occupancy !== undefined) return 'occupancy';
    if (m.includes('snzb-05') || m.includes('water') || d.water_leak !== undefined) return 'water_leak';
    return 'sensor';
  }

  // --- OBSŁUGA DRAG & DROP DLA KAFELKÓW ZIGBEE ---
  onZigbeeDrop(event: CdkDragDrop<Device[]>): void {
    const currentList = [...this.sortedZigbeeDevices()];
    moveItemInArray(currentList, event.previousIndex, event.currentIndex);
    const newOrder = currentList.map((d) => d.ieee_address);
    this.zigbeeCustomOrder.set(newOrder);
    this.saveOrder('z2m_zigbee_custom_order', newOrder);
  }

  resetZigbeeOrder(): void {
    this.zigbeeCustomOrder.set([]);
    this.saveOrder('z2m_zigbee_custom_order', []);
  }

  // --- OBSŁUGA DRAG & DROP DLA KAFELKÓW WI-FI ---
  onWifiDrop(event: CdkDragDrop<Device[]>): void {
    const currentList = [...this.sortedWifiDevices()];
    moveItemInArray(currentList, event.previousIndex, event.currentIndex);
    const newOrder = currentList.map((d) => d.ieee_address);
    this.wifiCustomOrder.set(newOrder);
    this.saveOrder('z2m_wifi_custom_order', newOrder);
  }

  resetWifiOrder(): void {
    this.wifiCustomOrder.set([]);
    this.saveOrder('z2m_wifi_custom_order', []);
  }

  // --- ZWIJANIE / ROZWIJANIE PULPITÓW ---
  toggleZigbeeCollapse(): void {
    const next = !this.isZigbeeCollapsed();
    this.isZigbeeCollapsed.set(next);
    this.saveBoolean('z2m_zigbee_collapsed', next);
  }

  toggleWifiCollapse(): void {
    const next = !this.isWifiCollapsed();
    this.isWifiCollapsed.set(next);
    this.saveBoolean('z2m_wifi_collapsed', next);
  }

  setTab(tab: 'dashboard' | 'scenes' | 'analytics' | 'settings'): void {
    this.activeTab.set(tab);
  }

  setZigbeeFilter(filter: 'all' | 'climate' | 'plug' | 'switch' | 'sensor'): void {
    this.selectedZigbeeFilter.set(filter);
  }

  setWifiFilter(filter: 'all' | 'plug' | 'switch' | 'fan' | 'climate' | 'sensor'): void {
    this.selectedWifiFilter.set(filter);
  }

  openAnalytics(device: Device): void {
    this.selectedDeviceForModal.set(device);
  }

  closeAnalytics(): void {
    this.selectedDeviceForModal.set(null);
  }

  openRenameDialog(device: Device): void {
    this.renamingDevice.set(device);
    this.renameValue.set(device.friendly_name || '');
  }

  updateRenameValue(val: string): void {
    this.renameValue.set(val);
  }

  confirmRename(): void {
    const dev = this.renamingDevice();
    const val = this.renameValue().trim();
    if (dev && val) {
      this.telemetry.renameDevice(dev.ieee_address, val);
    }
    this.renamingDevice.set(null);
  }

  cancelRename(): void {
    this.renamingDevice.set(null);
  }

  triggerPairing(): void {
    this.telemetry.triggerPermitJoin(160);
  }

  openWifiModal(): void {
    this.showWifiModal.set(true);
  }

  closeWifiModal(): void {
    this.showWifiModal.set(false);
  }

  handleDeviceCommand(event: { device: Device; command: Record<string, unknown> }): void {
    this.telemetry.sendDeviceCommand(event.device.ieee_address, event.command);
  }

  resetData(): void {
    this.telemetry.resetAllData();
  }

  private loadOrder(key: string): string[] {
    if (!isPlatformBrowser(this.platformId)) return [];
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  private saveOrder(key: string, order: string[]): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      localStorage.setItem(key, JSON.stringify(order));
    } catch {
      // ignore
    }
  }

  private loadBoolean(key: string, fallback: boolean): boolean {
    if (!isPlatformBrowser(this.platformId)) return fallback;
    try {
      const val = localStorage.getItem(key);
      return val !== null ? val === 'true' : fallback;
    } catch {
      return fallback;
    }
  }

  private saveBoolean(key: string, val: boolean): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      localStorage.setItem(key, String(val));
    } catch {
      // ignore
    }
  }
}
