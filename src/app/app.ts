import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
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
  readonly telemetry = inject(Telemetry);

  readonly activeTab = signal<'dashboard' | 'scenes' | 'analytics' | 'settings'>('dashboard');
  readonly selectedCategoryFilter = signal<'all' | 'fan' | 'climate' | 'plug' | 'switch' | 'sensor'>('all');

  readonly selectedDeviceForModal = signal<Device | null>(null);
  readonly renamingDevice = signal<Device | null>(null);
  readonly renameValue = signal<string>('');
  readonly showWifiModal = signal<boolean>(false);

  readonly filteredDevices = computed(() => {
    const list = this.telemetry.devices();
    const filter = this.selectedCategoryFilter();
    if (filter === 'all') return list;

    return list.filter((d) => {
      const cat = d.category || this.inferCategory(d);
      if (filter === 'fan') return cat === 'fan';
      if (filter === 'climate') return cat === 'climate';
      if (filter === 'plug') return cat === 'plug';
      if (filter === 'switch') return cat === 'switch';
      if (filter === 'sensor') return cat === 'sensor' || cat === 'contact' || cat === 'occupancy' || cat === 'water_leak';
      return true;
    });
  });

  readonly fanCount = computed(() => {
    return this.telemetry.devices().filter((d) => (d.category || this.inferCategory(d)) === 'fan').length;
  });

  readonly climateCount = computed(() => {
    return this.telemetry.devices().filter((d) => (d.category || this.inferCategory(d)) === 'climate').length;
  });

  readonly plugCount = computed(() => {
    return this.telemetry.devices().filter((d) => (d.category || this.inferCategory(d)) === 'plug').length;
  });

  readonly switchCount = computed(() => {
    return this.telemetry.devices().filter((d) => (d.category || this.inferCategory(d)) === 'switch').length;
  });

  readonly sensorCount = computed(() => {
    return this.telemetry.devices().filter((d) => {
      const c = d.category || this.inferCategory(d);
      return c === 'sensor' || c === 'contact' || c === 'occupancy' || c === 'water_leak';
    }).length;
  });

  private inferCategory(d: Device): DeviceCategory {
    const m = (d.model || '').toLowerCase();
    if (m.includes('trv') || m.includes('thermostat') || d.current_heating_setpoint !== undefined) return 'climate';
    if (m.includes('plug') || m.includes('s26') || m.includes('s40') || m.includes('s31') || m.includes('ts011f') || d.power !== undefined) return 'plug';
    if (m.includes('mini') || m.includes('zbmini') || m.includes('switch') || m.includes('relay') || (d.state !== undefined && d.power === undefined)) return 'switch';
    if (m.includes('snzb-04') || m.includes('contact') || d.contact !== undefined) return 'contact';
    if (m.includes('snzb-03') || m.includes('motion') || m.includes('pir') || d.occupancy !== undefined) return 'occupancy';
    if (m.includes('snzb-05') || m.includes('water') || d.water_leak !== undefined) return 'water_leak';
    return 'sensor';
  }

  setTab(tab: 'dashboard' | 'scenes' | 'analytics' | 'settings'): void {
    this.activeTab.set(tab);
  }

  setCategoryFilter(filter: 'all' | 'fan' | 'climate' | 'plug' | 'switch' | 'sensor'): void {
    this.selectedCategoryFilter.set(filter);
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
}
