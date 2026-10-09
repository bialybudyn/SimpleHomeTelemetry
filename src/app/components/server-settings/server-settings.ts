import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
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
import { DevicesManager } from './devices-manager';
import { Telemetry } from '../../services/telemetry';

export type ServerSubTab =
  | 'devices'
  | 'installer'
  | 'catalog'
  | 'dongle-max'
  | 'code'
  | 'android'
  | 'simulator'
  | 'notifications';

interface SubTabItem {
  id: ServerSubTab;
  title: string;
  subtitle: string;
  icon: string;
  badge?: string;
  badgeClass?: string;
}

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
    DevicesManager,
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
            Kompletne zarządzanie flotą urządzeń, usługami systemd, bramką Sonoff Dongle Max, kodem źródłowym oraz aplikacją Android (.APK).
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

      <!-- KAFELKI POD SOBĄ Z PODZAKŁADKAMI (Zamiast niewygodnego poziomego paska) -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <!-- Lewa Kolumna: Pionowe Kafelki Podzakładek -->
        <div class="lg:col-span-4 xl:col-span-3 space-y-2.5">
          <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400 px-1 mb-1 flex items-center justify-between">
            <span>Podzakładki Administracji</span>
            <span class="text-[10px] text-cyan-400 font-mono">Wybierz moduł</span>
          </div>

          <div class="space-y-2">
            @for (tab of subTabs(); track tab.id) {
              <button
                (click)="activeSubTab.set(tab.id)"
                class="w-full text-left p-3.5 rounded-2xl border transition-all cursor-pointer relative group flex items-start gap-3 shadow-md"
                [class.bg-slate-800]="activeSubTab() === tab.id"
                [class.border-cyan-500]="activeSubTab() === tab.id"
                [class.shadow-cyan-950/40]="activeSubTab() === tab.id"
                [class.bg-slate-900/80]="activeSubTab() !== tab.id"
                [class.border-slate-800]="activeSubTab() !== tab.id"
                [class.hover:border-slate-700]="activeSubTab() !== tab.id"
                [class.hover:bg-slate-900]="activeSubTab() !== tab.id"
              >
                <!-- Lewa krawędź aktywnego kafelka -->
                @if (activeSubTab() === tab.id) {
                  <div class="absolute left-0 top-3 bottom-3 w-1 bg-gradient-to-b from-cyan-400 to-blue-500 rounded-r"></div>
                }

                <!-- Ikona kafelka -->
                <div
                  class="p-2.5 rounded-xl border shrink-0 transition-colors"
                  [class.bg-cyan-500/20]="activeSubTab() === tab.id"
                  [class.border-cyan-500/40]="activeSubTab() === tab.id"
                  [class.text-cyan-300]="activeSubTab() === tab.id"
                  [class.bg-slate-950]="activeSubTab() !== tab.id"
                  [class.border-slate-800]="activeSubTab() !== tab.id"
                  [class.text-slate-400]="activeSubTab() !== tab.id"
                >
                  <mat-icon class="text-lg !w-5 !h-5">{{ tab.icon }}</mat-icon>
                </div>

                <!-- Tytuł, opis i badge -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center justify-between gap-1.5">
                    <span
                      class="text-xs font-bold truncate transition-colors"
                      [class.text-white]="activeSubTab() === tab.id"
                      [class.text-slate-300]="activeSubTab() !== tab.id"
                      [class.group-hover:text-white]="activeSubTab() !== tab.id"
                    >
                      {{ tab.title }}
                    </span>
                    @if (tab.badge) {
                      <span
                        class="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold shrink-0 border"
                        [class]="tab.badgeClass || 'bg-slate-800 text-slate-300 border-slate-700'"
                      >
                        {{ tab.badge }}
                      </span>
                    }
                  </div>
                  <p class="text-[11px] text-slate-400 mt-0.5 leading-snug line-clamp-2">
                    {{ tab.subtitle }}
                  </p>
                </div>

                <mat-icon
                  class="text-sm !w-4 !h-4 shrink-0 transition-transform self-center"
                  [class.text-cyan-400]="activeSubTab() === tab.id"
                  [class.translate-x-0.5]="activeSubTab() === tab.id"
                  [class.text-slate-600]="activeSubTab() !== tab.id"
                  [class.group-hover:text-slate-400]="activeSubTab() !== tab.id"
                >
                  chevron_right
                </mat-icon>
              </button>
            }
          </div>
        </div>

        <!-- Prawa Kolumna: Treść Wybranej Podzakładki -->
        <div class="lg:col-span-8 xl:col-span-9 min-w-0">
          @switch (activeSubTab()) {
            @case ('devices') {
              <app-devices-manager></app-devices-manager>
            }
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
    </div>
  `,
})
export class ServerSettings {
  readonly telemetry = inject(Telemetry);

  readonly activeSubTab = signal<ServerSubTab>('devices');

  readonly subTabs = computed<SubTabItem[]>(() => {
    const allCount = this.telemetry.allDevices().length;
    const deletedCount = this.telemetry.allDevices().filter((d) => d.is_deleted).length;

    return [
      {
        id: 'devices',
        title: 'Urządzenia (Rejestr Floty)',
        subtitle: 'Aktywne, Niepołączone, Usunięte z pulpitu & Trwałe kasowanie',
        icon: 'devices_other',
        badge: deletedCount > 0 ? `${allCount} (${deletedCount} usun.)` : `${allCount}`,
        badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
      },
      {
        id: 'installer',
        title: 'Instalator & Usługi w tle',
        subtitle: 'Status procesów systemd, porty sieciowe, restarty demonów',
        icon: 'terminal',
        badge: 'systemd',
        badgeClass: 'bg-slate-800 text-slate-300 border-slate-700',
      },
      {
        id: 'catalog',
        title: 'Katalog Sonoff & Tuya',
        subtitle: 'Baza wspieranych czujników, głowic TRVZB, wentylatorów i smart plugów',
        icon: 'hub',
        badge: 'Zigbee/Wi-Fi',
        badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
      },
      {
        id: 'dongle-max',
        title: 'Dongle Max (Sieć & Wi-Fi)',
        subtitle: 'Tryb Ember EFR32MG24, punkt dostępowy SoftAP i konfiguracja TCP',
        icon: 'router',
        badge: 'TCP 6638',
        badgeClass: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
      },
      {
        id: 'code',
        title: 'Pliki Python & Wdrożenie',
        subtitle: 'Podgląd skryptów mostka TinyTuya, backendu MQTT i instalatora',
        icon: 'code',
      },
      {
        id: 'android',
        title: 'Aplikacja Android (.APK)',
        subtitle: 'Natywna aplikacja z powiadomieniami push i usługą foreground',
        icon: 'android',
        badge: '.APK',
        badgeClass: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
      },
      {
        id: 'simulator',
        title: 'Konsola Testowa',
        subtitle: 'Wstrzykiwanie testowych pakietów telemetrii i weryfikacja wykresów',
        icon: 'tune',
      },
      {
        id: 'notifications',
        title: 'Powiadomienia (SMTP & Telegram)',
        subtitle: 'Alerty e-mail oraz powiadomienia bota Telegram przy awariach i alarmach',
        icon: 'notifications',
      },
    ];
  });
}
