import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Telemetry } from '../../services/telemetry';
import { DeviceCategory } from '../../models/telemetry.models';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-wifi-pairing-modal',
  imports: [MatIconModule, ReactiveFormsModule],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div class="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <!-- Nagłówek okna -->
        <div class="px-6 py-4 bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <mat-icon>wifi_find</mat-icon>
            </div>
            <div>
              <h3 class="text-lg font-bold text-white tracking-tight">
                Parowanie Urządzeń Wi-Fi
              </h3>
              <p class="text-xs text-slate-400">
                Uniwersalny provisioning przez Access Point Dongle-MAX, SmartConfig oraz sieć LAN
              </p>
            </div>
          </div>
          <button
            (click)="closeModal.emit()"
            class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <mat-icon class="text-sm !w-4 !h-4">close</mat-icon>
          </button>
        </div>

        <!-- Przełącznik metody parowania -->
        <div class="px-6 pt-4 pb-2 border-b border-slate-800/80 flex items-center gap-2 bg-slate-950/50">
          <button
            (click)="activeMethod.set('dongle_ap')"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer"
            [class.bg-indigo-600]="activeMethod() === 'dongle_ap'"
            [class.text-white]="activeMethod() === 'dongle_ap'"
            [class.text-slate-400]="activeMethod() !== 'dongle_ap'"
            [class.hover:text-white]="activeMethod() !== 'dongle_ap'"
          >
            <mat-icon class="text-xs !w-3.5 !h-3.5">router</mat-icon>
            <span>Access Point Dongle-MAX</span>
          </button>

          <button
            (click)="activeMethod.set('smartconfig')"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer"
            [class.bg-indigo-600]="activeMethod() === 'smartconfig'"
            [class.text-white]="activeMethod() === 'smartconfig'"
            [class.text-slate-400]="activeMethod() !== 'smartconfig'"
            [class.hover:text-white]="activeMethod() !== 'smartconfig'"
          >
            <mat-icon class="text-xs !w-3.5 !h-3.5">wifi</mat-icon>
            <span>SmartConfig / EZ-Mode</span>
          </button>

          <button
            (click)="activeMethod.set('manual_ip')"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer"
            [class.bg-indigo-600]="activeMethod() === 'manual_ip'"
            [class.text-white]="activeMethod() === 'manual_ip'"
            [class.text-slate-400]="activeMethod() !== 'manual_ip'"
            [class.hover:text-white]="activeMethod() !== 'manual_ip'"
          >
            <mat-icon class="text-xs !w-3.5 !h-3.5">add_circle</mat-icon>
            <span>Ręczne IP (LAN)</span>
          </button>
        </div>

        <div class="p-6 space-y-6 overflow-y-auto custom-scrollbar">

          <!-- METODA 1: WBUDOWANY ACCESS POINT DONGLE-MAX -->
          @if (activeMethod() === 'dongle_ap') {
            <div class="space-y-4">
              <!-- Stan Access Pointa w Dongle-MAX -->
              <div class="p-4 rounded-xl bg-indigo-950/40 border border-indigo-700/50 space-y-3">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2 text-indigo-300 font-bold text-xs">
                    <mat-icon class="text-sm !w-4 !h-4 text-indigo-400">cell_tower</mat-icon>
                    <span>Status Access Pointa Dongle-MAX (ESP32)</span>
                  </div>
                  @if (telemetry.dongleMaxAp().enabled && telemetry.dongleMaxAp().ssid) {
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      Aktywny (Gotowy do parowania)
                    </span>
                  } @else {
                    <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                      W gotowości (Uruchamiany przy parowaniu)
                    </span>
                  }
                </div>

                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs font-mono">
                  <div class="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800">
                    <span class="text-slate-500 text-[10px] block">SSID Access Pointa:</span>
                    <span class="text-indigo-300 font-bold">{{ telemetry.dongleMaxAp().ssid || 'Auto Dongle-MAX AP' }}</span>
                  </div>
                  <div class="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800">
                    <span class="text-slate-500 text-[10px] block">Adres IP Bramy AP:</span>
                    <span class="text-cyan-300 font-bold">{{ telemetry.dongleMaxAp().ip || telemetry.wifiLocalIp() || 'Lokalna brama' }}</span>
                  </div>
                  <div class="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 col-span-2 sm:col-span-1">
                    <span class="text-slate-500 text-[10px] block">Pula DHCP / Podsieć:</span>
                    <span class="text-white font-bold">{{ telemetry.dongleMaxAp().dhcp_range || 'Automatyczny DHCP' }}</span>
                  </div>
                </div>
              </div>

              <!-- Uniwersalna instrukcja parowania dowolnego urządzenia Wi-Fi -->
              <div class="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
                <div class="flex items-center gap-2 text-slate-200 font-semibold text-xs">
                  <mat-icon class="text-sm !w-4 !h-4 text-cyan-400">help_outline</mat-icon>
                  <span>Instrukcja uniwersalnego parowania urządzeń Wi-Fi przez Dongle-MAX:</span>
                </div>
                <ol class="text-xs text-slate-300 space-y-2 list-decimal list-inside font-sans leading-relaxed">
                  <li>
                    Wprowadź urządzenie Wi-Fi (gniazdko, przełącznik, wentylator, termostat, sensor) w tryb parowania AP — przytrzymaj przycisk zasilania/parowania przez <strong class="text-white">5–7 sekund</strong>, aż dioda zacznie migać.
                  </li>
                  <li>
                    Dongle-MAX nasłuchuje na paśmie Wi-Fi i automatycznie przechwytuje żądania rejestracji z nowych urządzeń w trybie AP.
                  </li>
                  <li>
                    Urządzenie zostanie natychmiast zarejestrowane w lokalnym Pulpicie Wi-Fi i otrzyma adres IP z puli Access Pointa lub Twojej podsieci LAN.
                  </li>
                </ol>
              </div>

              <!-- Przycisk aktywacji nasłuchu Dongle-MAX AP -->
              <button
                (click)="startPairing()"
                [disabled]="telemetry.isWifiPairing()"
                class="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold shadow-lg shadow-indigo-950/50 transition-all cursor-pointer"
              >
                <mat-icon class="text-sm !w-4 !h-4" [class.animate-spin]="telemetry.isWifiPairing()">
                  {{ telemetry.isWifiPairing() ? 'refresh' : 'cell_tower' }}
                </mat-icon>
                <span>
                  {{ telemetry.isWifiPairing() ? 'Nasłuch Dongle-MAX AP aktywny (' + telemetry.wifiPairingRemainingSeconds() + 's)...' : 'Aktywuj nasłuch parowania Dongle-MAX AP (160s)' }}
                </span>
              </button>
            </div>
          }

          <!-- METODA 2: SMARTCONFIG / EZ-MODE BROADCAST -->
          @if (activeMethod() === 'smartconfig') {
            <div class="space-y-4">
              <div class="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300 space-y-1.5">
                <div class="flex items-center gap-2 text-indigo-300 font-semibold">
                  <mat-icon class="text-sm !w-4 !h-4">settings_input_antenna</mat-icon>
                  <span>Protokół rozgłoszeniowy SmartConfig (Tuya / Espressif):</span>
                </div>
                <p class="text-slate-400 leading-relaxed">
                  Koordynator Dongle-MAX wysyła pakiety UDP broadcast zawierające dane Twojej sieci Wi-Fi (2.4GHz). Urządzenia znajdujące się w trybie szybkiego parowania automatycznie odbierają dane i łączą się z siecią.
                </p>
              </div>

              <!-- Formularz parowania Wi-Fi SmartConfig -->
              <form [formGroup]="wifiForm" (ngSubmit)="startPairing()" class="space-y-4">
                <div class="space-y-1.5">
                  <label for="wifiSsidInput" class="text-xs font-semibold text-slate-300 block">
                    Nazwa Sieci Wi-Fi (SSID 2.4GHz)
                  </label>
                  <div class="relative">
                    <input
                      id="wifiSsidInput"
                      type="text"
                      formControlName="ssid"
                      placeholder="np. Moja_Siec_WiFi_2.4G"
                      class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-indigo-500 focus:outline-none pl-9"
                    />
                    <mat-icon class="text-sm !w-4 !h-4 text-slate-500 absolute left-3 top-3">wifi</mat-icon>
                  </div>
                </div>

                <div class="space-y-1.5">
                  <label for="wifiPassInput" class="text-xs font-semibold text-slate-300 block">
                    Hasło do Wi-Fi
                  </label>
                  <div class="relative">
                    <input
                      id="wifiPassInput"
                      type="password"
                      formControlName="password"
                      placeholder="Wpisz hasło do sieci..."
                      class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-indigo-500 focus:outline-none pl-9"
                    />
                    <mat-icon class="text-sm !w-4 !h-4 text-slate-500 absolute left-3 top-3">lock</mat-icon>
                  </div>
                </div>

                <button
                  type="submit"
                  [disabled]="wifiForm.invalid || telemetry.isWifiPairing()"
                  class="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold shadow-lg shadow-indigo-950/50 transition-all cursor-pointer"
                >
                  <mat-icon class="text-sm !w-4 !h-4" [class.animate-spin]="telemetry.isWifiPairing()">
                    {{ telemetry.isWifiPairing() ? 'refresh' : 'wifi_find' }}
                  </mat-icon>
                  <span>
                    {{ telemetry.isWifiPairing() ? 'Parowanie Wi-Fi w toku (' + telemetry.wifiPairingRemainingSeconds() + 's)...' : 'Rozpocznij Parowanie Wi-Fi (160s)' }}
                  </span>
                </button>
              </form>
            </div>
          }

          <!-- METODA 3: UNIWERSALNE BEZPOŚREDNIE DODANIE PO IP -->
          @if (activeMethod() === 'manual_ip') {
            <div class="space-y-4">
              <div class="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300">
                <span class="text-cyan-300 font-semibold">Bezpośrednie dodanie urządzenia Wi-Fi:</span>
                Wpisz lokalny adres IP urządzenia połączonego z siecią domową lub punktem Dongle-MAX, aby natychmiast dodać je do Pulpitu Wi-Fi.
              </div>

              <div class="space-y-3.5">
                <div class="space-y-1.5">
                  <label for="manualIpField" class="text-xs font-semibold text-slate-300 block">
                    Adres IP urządzenia w sieci
                  </label>
                  <input
                    id="manualIpField"
                    type="text"
                    [value]="manualIp()"
                    (input)="manualIp.set($any($event.target).value)"
                    placeholder="np. 192.168.1.150 lub 192.168.4.10"
                    class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div class="space-y-1.5">
                  <label for="manualNameField" class="text-xs font-semibold text-slate-300 block">
                    Nazwa urządzenia
                  </label>
                  <input
                    id="manualNameField"
                    type="text"
                    [value]="manualName()"
                    (input)="manualName.set($any($event.target).value)"
                    placeholder="np. Gniazdko Smart Plug Wi-Fi 16A"
                    class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div class="space-y-1.5">
                  <label for="manualCategorySelect" class="text-xs font-semibold text-slate-300 block">
                    Kategoria / Typ urządzenia
                  </label>
                  <select
                    id="manualCategorySelect"
                    [value]="manualCategory()"
                    (change)="onCategoryChange($any($event.target).value)"
                    class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none cursor-pointer"
                  >
                    <option value="plug">Gniazdko inteligentne (Smart Plug Wi-Fi 16A)</option>
                    <option value="switch">Przekaźnik / Włącznik światła (Smart Switch Wi-Fi)</option>
                    <option value="fan">Wentylator / Klimatyzacja / HVAC (Smart Fan 7w1)</option>
                    <option value="climate">Termostat / Ogrzewanie (Wi-Fi Thermostat)</option>
                    <option value="sensor">Czujnik środowiskowy (Wi-Fi Sensor)</option>
                  </select>
                </div>

                <div class="space-y-1.5">
                  <label for="manualModelField" class="text-xs font-semibold text-slate-300 block">
                    Model (opcjonalny)
                  </label>
                  <input
                    id="manualModelField"
                    type="text"
                    [value]="manualModel()"
                    (input)="manualModel.set($any($event.target).value)"
                    placeholder="np. Smart Plug Wi-Fi 16A"
                    class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <button
                  (click)="addManualDevice()"
                  [disabled]="!manualIp().trim() || isAdding()"
                  class="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold shadow-lg shadow-cyan-950/50 transition-all cursor-pointer"
                >
                  <mat-icon class="text-sm !w-4 !h-4">add_circle</mat-icon>
                  <span>{{ isAdding() ? 'Dodawanie...' : 'Dodaj Urządzenie do Pulpitu Wi-Fi' }}</span>
                </button>
              </div>
            </div>
          }
        </div>

        <!-- Stopka -->
        <div class="px-6 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>Adres IP serwera w sieci LAN: <code class="text-indigo-400 font-mono">{{ telemetry.wifiLocalIp() || 'Wykrywanie IP...' }}</code></span>
          <button
            (click)="closeModal.emit()"
            class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  `,
})
export class WifiPairingModal {
  readonly telemetry = inject(Telemetry);
  readonly closeModal = output<void>();

  readonly activeMethod = signal<'dongle_ap' | 'smartconfig' | 'manual_ip'>('dongle_ap');

  readonly manualIp = signal<string>('192.168.1.150');
  readonly manualName = signal<string>('Gniazdko Smart Plug Wi-Fi 16A');
  readonly manualCategory = signal<DeviceCategory>('plug');
  readonly manualModel = signal<string>('Smart Plug 16A Wi-Fi');
  readonly isAdding = signal<boolean>(false);

  readonly wifiForm = new FormGroup({
    ssid: new FormControl('Domowa_Siec_WiFi', [Validators.required]),
    password: new FormControl(''),
  });

  onCategoryChange(cat: string): void {
    const c = cat as DeviceCategory;
    this.manualCategory.set(c);
    if (c === 'plug') {
      this.manualName.set('Gniazdko Smart Plug Wi-Fi 16A');
      this.manualModel.set('Smart Plug 16A Wi-Fi');
    } else if (c === 'switch') {
      this.manualName.set('Przekaźnik Wi-Fi');
      this.manualModel.set('Smart Switch Wi-Fi');
    } else if (c === 'fan') {
      this.manualName.set('Wentylator Wi-Fi 7w1');
      this.manualModel.set('GOW 007 7w1 (Wi-Fi)');
    } else if (c === 'climate') {
      this.manualName.set('Termostat Wi-Fi');
      this.manualModel.set('Smart Thermostat Wi-Fi');
    } else if (c === 'sensor') {
      this.manualName.set('Czujnik Środowiskowy Wi-Fi');
      this.manualModel.set('Smart Sensor Wi-Fi');
    }
  }

  startPairing(): void {
    if (this.wifiForm.invalid) return;
    const ssid = this.wifiForm.value.ssid || 'Domowa_Siec_WiFi';
    const password = this.wifiForm.value.password || '';

    this.telemetry.triggerWifiPairing(ssid, password, 160);
  }

  async addManualDevice(): Promise<void> {
    const ip = this.manualIp().trim();
    if (!ip) return;

    this.isAdding.set(true);
    const ok = await this.telemetry.addWifiDevice(
      ip,
      this.manualName().trim(),
      this.manualModel().trim(),
      this.manualCategory(),
    );
    this.isAdding.set(false);

    if (ok) {
      this.closeModal.emit();
    }
  }
}
