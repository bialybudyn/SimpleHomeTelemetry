import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Telemetry } from './services/telemetry';
import { Device } from './models/telemetry.models';
import { DeviceCard } from './components/device-card/device-card';
import { AnalyticsModal } from './components/analytics-modal/analytics-modal';
import { AnalyticsView } from './components/analytics-view/analytics-view';
import { CodeViewer } from './components/code-viewer/code-viewer';
import { AndroidViewer } from './components/android-viewer/android-viewer';
import { Simulator } from './components/simulator/simulator';
import { DongleMaxManager } from './components/dongle-max/dongle-max';
import { InstallerView } from './components/installer-view/installer-view';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [
    MatIconModule,
    DeviceCard,
    AnalyticsModal,
    AnalyticsView,
    InstallerView,
    CodeViewer,
    AndroidViewer,
    Simulator,
    DongleMaxManager,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  readonly telemetry = inject(Telemetry);

  readonly activeTab = signal<'dashboard' | 'installer' | 'dongle-max' | 'analytics' | 'code' | 'android' | 'simulator'>('dashboard');
  readonly selectedDeviceForModal = signal<Device | null>(null);
  readonly renamingDevice = signal<Device | null>(null);
  readonly renameValue = signal<string>('');

  setTab(tab: 'dashboard' | 'installer' | 'dongle-max' | 'analytics' | 'code' | 'android' | 'simulator'): void {
    this.activeTab.set(tab);
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
    this.telemetry.triggerPermitJoin(60);
  }
}
