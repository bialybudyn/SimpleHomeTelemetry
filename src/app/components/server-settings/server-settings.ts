import {
  ChangeDetectionStrategy,
  Component,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { InstallerView } from '../installer-view/installer-view';
import { DeviceCatalog } from '../device-catalog/device-catalog';
import { DongleMaxManager } from '../dongle-max/dongle-max';
import { CodeViewer } from '../code-viewer/code-viewer';
import { AndroidViewer } from '../android-viewer/android-viewer';
import { Simulator } from '../simulator/simulator';
import { NotificationsConfig } from './notifications-config';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-server-settings',
  imports: [
    MatIconModule,
    InstallerView,
    DeviceCatalog,
    DongleMaxManager,
    CodeViewer,
    AndroidViewer,
    Simulator,
    NotificationsConfig,
  ],
  template: `
    <div class="space-y-6">
      <!-- Nagłówek Zbiorczy Ustawień Serwera -->
      <div class="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/60 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
        <div class="space-y-1">
          <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <mat-icon class="text-sm !w-4 !h-4">settings</mat-icon>
            <span>Centrum Administracji i Ustawień Hosta</span>
          </div>
          <h2 class="text-2xl font-bold text-white tracking-tight">
            Ustawienia Serwera & Konfiguracja Usług Systemowych
          </h2>
          <p class="text-xs text-slate-400">
            Kompletne zarządzanie usługami systemd, katalogiem urządzeń, bramką Sonoff Dongle Max, kodem źródłowym oraz aplikacją Android (.APK).
          </p>
        </div>

        <a
          href="/api/files/SimpleHomeTelemetry.apk"
          download="SimpleHomeTelemetry.apk"
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-950/40 transition-all cursor-pointer shrink-0"
        >
          <mat-icon class="text-sm !w-4 !h-4">android</mat-icon>
          <span>Pobierz Aplikację Android (.APK) ↗</span>
        </a>
      </div>

      <!-- Pod-Nawigacja Zakładkowa dla Ustawień Serwera -->
      <div class="flex items-center gap-1.5 p-1.5 rounded-2xl bg-slate-950 border border-slate-800 overflow-x-auto text-xs font-semibold custom-scrollbar">
        <button
          (click)="activeSubTab.set('installer')"
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer"
          [class.bg-slate-800]="activeSubTab() === 'installer'"
          [class.text-white]="activeSubTab() === 'installer'"
          [class.text-slate-400]="activeSubTab() !== 'installer'"
          [class.hover:text-white]="activeSubTab() !== 'installer'"
        >
          <mat-icon class="text-sm !w-4 !h-4">terminal</mat-icon>
          <span>Instalator & Usługi w tle</span>
        </button>

        <button
          (click)="activeSubTab.set('catalog')"
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer"
          [class.bg-slate-800]="activeSubTab() === 'catalog'"
          [class.text-white]="activeSubTab() === 'catalog'"
          [class.text-slate-400]="activeSubTab() !== 'catalog'"
          [class.hover:text-white]="activeSubTab() !== 'catalog'"
        >
          <mat-icon class="text-sm !w-4 !h-4">hub</mat-icon>
          <span>Katalog Sonoff & Tuya</span>
        </button>

        <button
          (click)="activeSubTab.set('dongle-max')"
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer"
          [class.bg-slate-800]="activeSubTab() === 'dongle-max'"
          [class.text-white]="activeSubTab() === 'dongle-max'"
          [class.text-slate-400]="activeSubTab() !== 'dongle-max'"
          [class.hover:text-white]="activeSubTab() !== 'dongle-max'"
        >
          <mat-icon class="text-sm !w-4 !h-4">router</mat-icon>
          <span>Dongle Max (Sieć & Konfiguracja)</span>
        </button>

        <button
          (click)="activeSubTab.set('code')"
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer"
          [class.bg-slate-800]="activeSubTab() === 'code'"
          [class.text-white]="activeSubTab() === 'code'"
          [class.text-slate-400]="activeSubTab() !== 'code'"
          [class.hover:text-white]="activeSubTab() !== 'code'"
        >
          <mat-icon class="text-sm !w-4 !h-4">code</mat-icon>
          <span>Pliki Python & Wdrożenie</span>
        </button>

        <button
          (click)="activeSubTab.set('android')"
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer"
          [class.bg-slate-800]="activeSubTab() === 'android'"
          [class.text-white]="activeSubTab() === 'android'"
          [class.text-slate-400]="activeSubTab() !== 'android'"
          [class.hover:text-white]="activeSubTab() !== 'android'"
        >
          <mat-icon class="text-sm !w-4 !h-4">android</mat-icon>
          <span>Aplikacja Android (.APK)</span>
        </button>

        <button
          (click)="activeSubTab.set('simulator')"
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer"
          [class.bg-slate-800]="activeSubTab() === 'simulator'"
          [class.text-white]="activeSubTab() === 'simulator'"
          [class.text-slate-400]="activeSubTab() !== 'simulator'"
          [class.hover:text-white]="activeSubTab() !== 'simulator'"
        >
          <mat-icon class="text-sm !w-4 !h-4">tune</mat-icon>
          <span>Konsola Testowa</span>
        </button>

        <button
          (click)="activeSubTab.set('notifications')"
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all whitespace-nowrap cursor-pointer"
          [class.bg-slate-800]="activeSubTab() === 'notifications'"
          [class.text-white]="activeSubTab() === 'notifications'"
          [class.text-slate-400]="activeSubTab() !== 'notifications'"
          [class.hover:text-white]="activeSubTab() !== 'notifications'"
        >
          <mat-icon class="text-sm !w-4 !h-4">notifications</mat-icon>
          <span>Powiadomienia (SMTP & Telegram)</span>
        </button>
      </div>

      <!-- Treść Pod-Zakładki -->
      <div>
        @switch (activeSubTab()) {
          @case ('installer') {
            <app-installer-view></app-installer-view>
          }
          @case ('catalog') {
            <app-device-catalog></app-device-catalog>
          }
          @case ('dongle-max') {
            <app-dongle-max></app-dongle-max>
          }
          @case ('code') {
            <app-code-viewer></app-code-viewer>
          }
          @case ('android') {
            <app-android-viewer></app-android-viewer>
          }
          @case ('simulator') {
            <app-simulator></app-simulator>
          }
          @case ('notifications') {
            <app-notifications-config></app-notifications-config>
          }
        }
      </div>
    </div>
  `,
})
export class ServerSettings {
  readonly activeSubTab = signal<'installer' | 'catalog' | 'dongle-max' | 'code' | 'android' | 'simulator' | 'notifications'>('installer');
}
