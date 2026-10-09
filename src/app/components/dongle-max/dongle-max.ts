import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Telemetry } from '../../services/telemetry';
import { DongleMaxConfig } from '../../models/telemetry.models';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-dongle-max',
  imports: [MatIconModule, ReactiveFormsModule],
  template: `
    <div class="space-y-6">
      <!-- Karta Tytułowa i Specyfikacja Sprzętowa -->
      <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div class="space-y-2">
          <div class="flex items-center gap-2">
            <span class="px-2.5 py-1 rounded-full bg-cyan-950/80 border border-cyan-800 text-cyan-400 font-mono text-xs font-semibold flex items-center gap-1.5">
              <mat-icon class="text-sm !w-4 !h-4">router</mat-icon>
              ITEAD Sonoff Dongle Max (Dongle-M)
            </span>
            <span class="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800 text-emerald-300 font-mono text-[11px]">
              Silicon Labs EFR32MG24 + ESP32-D0WD
            </span>
          </div>

          <h2 class="text-xl font-extrabold text-white tracking-tight">
            Obsługa sieciowa i tryb routera Sonoff Dongle Max
          </h2>

          <p class="text-xs text-slate-400 max-w-3xl leading-relaxed">
            Sonoff Dongle Max (Dongle-M) to wielozadaniowa bramka Zigbee/Thread wyposażona w port 
            <strong>Ethernet z PoE (802.3af)</strong>, moduł <strong>Wi-Fi 2.4GHz</strong> oraz gniazdo USB-C. 
            Działa bez Home Assistanta, udostępniając strumień szeregowy przez sieć TCP na domyślnym porcie 
            <span class="font-mono text-cyan-400 font-bold">6638</span> lub pełniąc rolę potężnego routera zasięgowego mesh.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-3 shrink-0">
          <a
            href="https://dongle.sonoff.tech/guide/dongle-m/"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
          >
            <mat-icon class="text-sm !w-4 !h-4 text-cyan-400">open_in_new</mat-icon>
            <span>Oficjalny przewodnik Sonoff</span>
          </a>

          <a
            [href]="webConsoleHref()"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-lg shadow-cyan-950/40 transition-colors cursor-pointer"
          >
            <mat-icon class="text-sm !w-4 !h-4">settings_ethernet</mat-icon>
            <span>Otwórz Web Console ({{ currentHost() }})</span>
          </a>
        </div>
      </div>

      <!-- Kafelki architektury (Koordynator vs Router) -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
        <!-- Kafelek Tryb 1: Koordynator Sieciowy -->
        <div
          class="p-5 rounded-2xl border transition-all"
          [class.bg-slate-900]="configForm.get('operating_mode')?.value === 'coordinator'"
          [class.border-cyan-500]="configForm.get('operating_mode')?.value === 'coordinator'"
          [class.shadow-lg]="configForm.get('operating_mode')?.value === 'coordinator'"
          [class.shadow-cyan-950/30]="configForm.get('operating_mode')?.value === 'coordinator'"
          [class.bg-slate-900/40]="configForm.get('operating_mode')?.value !== 'coordinator'"
          [class.border-slate-800]="configForm.get('operating_mode')?.value !== 'coordinator'"
        >
          <div class="flex items-start justify-between gap-3 mb-3">
            <div class="flex items-center gap-2.5">
              <div class="w-9 h-9 rounded-xl bg-cyan-950 border border-cyan-800 flex items-center justify-center text-cyan-400 shrink-0">
                <mat-icon class="text-lg">hub</mat-icon>
              </div>
              <div>
                <h3 class="text-sm font-bold text-white">Tryb Koordynatora (Coordinator Mode)</h3>
                <span class="text-[11px] font-mono text-cyan-400">Port TCP: 6638 · EmberZNet EZSP</span>
              </div>
            </div>
            <span class="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-cyan-900/60 text-cyan-200 border border-cyan-700">
              Centralny węzeł PAN
            </span>
          </div>

          <p class="text-xs text-slate-400 leading-relaxed mb-4">
            Dongle Max tworzy własną sieć Zigbee 3.0 i odbiera ramki telemetryczne (temperatura, wilgotność, stan baterii) 
            ze wszystkich sparowanych czujników. Strumień szeregowy jest przekazywany bezpośrednio po sieci LAN 
            do naszego backendu Python (zigpy / Zigbee2MQTT).
          </p>

          <div class="p-3 rounded-xl bg-slate-950 border border-slate-800/80 font-mono text-[11px] text-slate-300">
            <div class="text-slate-500 text-[10px] uppercase mb-1">Ciąg połączenia sieciowego:</div>
            <code class="text-cyan-400">tcp://{{ currentHost() }}:{{ currentPort() }}</code>
          </div>
        </div>

        <!-- Kafelek Tryb 2: Router po sieci / wzmacniacz zasięgu -->
        <div
          class="p-5 rounded-2xl border transition-all"
          [class.bg-slate-900]="configForm.get('operating_mode')?.value === 'router'"
          [class.border-emerald-500]="configForm.get('operating_mode')?.value === 'router'"
          [class.shadow-lg]="configForm.get('operating_mode')?.value === 'router'"
          [class.shadow-emerald-950/30]="configForm.get('operating_mode')?.value === 'router'"
          [class.bg-slate-900/40]="configForm.get('operating_mode')?.value !== 'router'"
          [class.border-slate-800]="configForm.get('operating_mode')?.value !== 'router'"
        >
          <div class="flex items-start justify-between gap-3 mb-3">
            <div class="flex items-center gap-2.5">
              <div class="w-9 h-9 rounded-xl bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-400 shrink-0">
                <mat-icon class="text-lg">cell_tower</mat-icon>
              </div>
              <div>
                <h3 class="text-sm font-bold text-white">Tryb Routera Mesh (Dongle-M Router)</h3>
                <span class="text-[11px] font-mono text-emerald-400">+20 dBm · 2x Antena 5dBi · PoE</span>
              </div>
            </div>
            <span class="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-emerald-900/60 text-emerald-200 border border-emerald-700">
              Wzmacniacz zasięgu
            </span>
          </div>

          <p class="text-xs text-slate-400 leading-relaxed mb-4">
            Według oficjalnej dokumentacji <a href="https://dongle.sonoff.tech/guide/dongle-m/" target="_blank" rel="noopener noreferrer" class="text-emerald-400 underline">Sonoff Web Flasher</a>, 
            urządzenie można sflashować oprogramowaniem układowym <strong>Router</strong>. Dongle Max zasilany przez PoE 
            retransmituje pakiety z bateryjnych czujników z odległych pomieszczeń, tworząc stabilną siatkę mesh.
          </p>

          <div class="p-3 rounded-xl bg-slate-950 border border-slate-800/80 font-mono text-[11px] text-slate-300">
            <div class="text-slate-500 text-[10px] uppercase mb-1">Dostęp do konsoli diagnostycznej Routera:</div>
            <code class="text-emerald-400">http://{{ currentHost() }} (Zarządzanie LQI i sąsiadami)</code>
          </div>
        </div>
      </div>

      <!-- Formularz konfiguracji i tester aktywnego połączenia TCP -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Lewa kolumna (2/3): Formularz parametrów -->
        <div class="lg:col-span-2 p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
          <div class="flex items-center justify-between mb-5">
            <div class="flex items-center gap-2">
              <mat-icon class="text-cyan-400">tune</mat-icon>
              <h3 class="text-sm font-bold text-white">Parametry komunikacji sieciowej Dongle Max</h3>
            </div>
            @if (saveSuccess()) {
              <span class="text-xs font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-2 py-0.5 rounded animate-in fade-in">
                Zapisano pomyślnie!
              </span>
            }
          </div>

          <form [formGroup]="configForm" (ngSubmit)="saveConfig()" class="space-y-6">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <!-- Tryb połączenia -->
              <div>
                <label for="connectionModeSelect" class="block text-xs font-medium text-slate-400 mb-1.5">Typ połączenia z donglem</label>
                <select
                  id="connectionModeSelect"
                  formControlName="connection_mode"
                  class="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-cyan-500"
                >
                  <option value="network_tcp">Połączenie sieciowe TCP (Ethernet / PoE / Wi-Fi)</option>
                  <option value="usb_serial">Port szeregowy USB (ttyACM0 / COM)</option>
                </select>
              </div>

              <!-- Rola sprzętowa -->
              <div>
                <label for="operatingModeSelect" class="block text-xs font-medium text-slate-400 mb-1.5">Rola w sieci Zigbee</label>
                <select
                  id="operatingModeSelect"
                  formControlName="operating_mode"
                  class="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-cyan-500"
                >
                  <option value="coordinator">Koordynator (Coordinator) — centralna stacja bazowa</option>
                  <option value="router">Router — wzmacniacz i węzeł tranzytowy mesh</option>
                </select>
              </div>

              <!-- Adres Hosta / mDNS -->
              <div>
                <label for="hostInput" class="block text-xs font-medium text-slate-400 mb-1.5">
                  Adres IP lub mDNS
                  <span class="text-slate-500">(domyślnie: Dongle-M.local)</span>
                </label>
                <input
                  id="hostInput"
                  type="text"
                  formControlName="host"
                  placeholder="Dongle-M.local lub 192.168.1.120"
                  class="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <!-- Port TCP -->
              <div>
                <label for="portInput" class="block text-xs font-medium text-slate-400 mb-1.5">
                  Port TCP Serial-over-IP
                  <span class="text-slate-500">(standard: 6638)</span>
                </label>
                <input
                  id="portInput"
                  type="number"
                  formControlName="port"
                  placeholder="6638"
                  class="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <!-- SEKCJA PUNKTU DOSTĘPOWEGO SOFTAP (DONGLE-M BROADCASTING OWN WI-FI NETWORK) -->
            <div class="p-4 rounded-xl bg-indigo-950/30 border border-indigo-800/60 space-y-3">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 text-indigo-300 font-bold text-xs">
                  <mat-icon class="text-indigo-400 text-sm !w-4 !h-4">wifi_tethering</mat-icon>
                  <span>Własny Punkt Dostępny Wi-Fi (Dongle-M Access Point / SoftAP)</span>
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-bold">
                  Natywny ESP32 SoftAP
                </span>
              </div>

              <p class="text-[11px] text-slate-300 leading-relaxed">
                Moduł ESP32 w Dongle Max potrafi nadawać własną bezprzewodową sieć Wi-Fi! Urządzenia wykonawcze (wentylatory GOW 007, gniazdka Wi-Fi, przekaźniki) łączą się bezpośrednio do Dongle-M bez pośrednictwa domowego routera.
              </p>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label for="apSsidInput" class="block text-[11px] font-semibold text-slate-400 mb-1">Nazwa Sieci AP (SSID)</label>
                  <input
                    id="apSsidInput"
                    type="text"
                    formControlName="wifi_softap_ssid"
                    class="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label for="apPassInput" class="block text-[11px] font-semibold text-slate-400 mb-1">Hasło WPA2-PSK (min. 8 znaków)</label>
                  <input
                    id="apPassInput"
                    type="text"
                    formControlName="wifi_softap_password"
                    class="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label for="apIpInput" class="block text-[11px] font-semibold text-slate-400 mb-1">Adres IP Bramki SoftAP</label>
                  <input
                    id="apIpInput"
                    type="text"
                    formControlName="wifi_softap_ip"
                    class="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label for="apChannelInput" class="block text-[11px] font-semibold text-slate-400 mb-1">Kanał Wi-Fi 2.4GHz</label>
                  <input
                    id="apChannelInput"
                    type="number"
                    formControlName="wifi_softap_channel"
                    class="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <!-- Przyciski akcji -->
            <div class="pt-3 flex items-center justify-between border-t border-slate-800/80">
              <span class="text-[11px] text-slate-500 font-mono">
                Połączenie: {{ configForm.get('connection_mode')?.value === 'network_tcp' ? 'Gniazdo sieciowe TCP' : 'Port szeregowy USB' }}
              </span>

              <div class="flex items-center gap-3">
                <button
                  type="button"
                  (click)="testCurrentConnection()"
                  [disabled]="telemetry.isTestingDongleMax()"
                  class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
                >
                  <mat-icon class="text-sm !w-4 !h-4 text-cyan-400" [class.animate-spin]="telemetry.isTestingDongleMax()">
                    {{ telemetry.isTestingDongleMax() ? 'refresh' : 'network_check' }}
                  </mat-icon>
                  <span>{{ telemetry.isTestingDongleMax() ? 'Testowanie...' : 'Testuj port 6638' }}</span>
                </button>

                <button
                  type="submit"
                  class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md shadow-cyan-900/30 transition-colors cursor-pointer"
                >
                  <mat-icon class="text-sm !w-4 !h-4">save</mat-icon>
                  <span>Zapisz konfigurację</span>
                </button>
              </div>
            </div>
          </form>
        </div>

        <!-- Prawa kolumna (1/3): Aktywna diagnostyka TCP i stan portu -->
        <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl flex flex-col justify-between">
          <div>
            <div class="flex items-center gap-2 mb-4">
              <mat-icon class="text-cyan-400">speed</mat-icon>
              <h3 class="text-sm font-bold text-white">Diagnostyka połączenia TCP</h3>
            </div>

            @if (telemetry.dongleMaxTestResult(); as testRes) {
              <div
                class="p-4 rounded-xl border mb-4 animate-in fade-in"
                [class.bg-emerald-950/40]="testRes.success"
                [class.border-emerald-800]="testRes.success"
                [class.bg-rose-950/40]="!testRes.success"
                [class.border-rose-800]="!testRes.success"
              >
                <div class="flex items-start gap-2.5">
                  <mat-icon
                    class="text-lg shrink-0 mt-0.5"
                    [class.text-emerald-400]="testRes.success"
                    [class.text-rose-400]="!testRes.success"
                  >
                    {{ testRes.success ? 'check_circle' : 'error' }}
                  </mat-icon>
                  <div>
                    <h4 class="text-xs font-bold text-white">
                      {{ testRes.success ? 'Port 6638 aktywny' : 'Brak odpowiedzi na porcie 6638' }}
                    </h4>
                    <p class="text-[11px] mt-1 leading-relaxed" [class.text-emerald-200]="testRes.success" [class.text-rose-200]="!testRes.success">
                      {{ testRes.message }}
                    </p>
                    @if (testRes.latency_ms !== undefined) {
                      <div class="mt-2 text-xs font-mono font-bold text-emerald-300">
                        Opóźnienie: {{ testRes.latency_ms }} ms
                      </div>
                    }
                  </div>
                </div>
              </div>
            } @else {
              <div class="p-4 rounded-xl bg-slate-950 border border-slate-800/80 text-center mb-4">
                <mat-icon class="text-slate-600 text-3xl mb-1">wifi_find</mat-icon>
                <p class="text-xs text-slate-400 font-medium">Brak aktywnego testu</p>
                <p class="text-[11px] text-slate-500 mt-1">
                  Kliknij przycisk poniżej, aby wysłać pakiet próbny TCP do Dongle Max (port 6638).
                </p>
              </div>
            }

            <div class="space-y-2 text-xs font-mono text-slate-400">
              <div class="flex items-center justify-between py-1.5 border-b border-slate-800/60">
                <span class="text-slate-500">Host docelowy:</span>
                <span class="text-white">{{ currentHost() }}</span>
              </div>
              <div class="flex items-center justify-between py-1.5 border-b border-slate-800/60">
                <span class="text-slate-500">Gniazdo TCP:</span>
                <span class="text-cyan-400 font-bold">{{ currentPort() }}</span>
              </div>
              <div class="flex items-center justify-between py-1.5 border-b border-slate-800/60">
                <span class="text-slate-500">Rola urządzenia:</span>
                <span class="text-white uppercase font-bold">{{ configForm.get('operating_mode')?.value }}</span>
              </div>
              <div class="flex items-center justify-between py-1.5">
                <span class="text-slate-500">PoE (Zasilanie LAN):</span>
                <span class="text-emerald-400">IEEE 802.3af zgodne</span>
              </div>
            </div>
          </div>

          <div class="pt-4 border-t border-slate-800/80 mt-4">
            <button
              (click)="testCurrentConnection()"
              [disabled]="telemetry.isTestingDongleMax()"
              class="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold transition-all cursor-pointer"
            >
              <mat-icon class="text-sm !w-4 !h-4" [class.animate-spin]="telemetry.isTestingDongleMax()">
                {{ telemetry.isTestingDongleMax() ? 'refresh' : 'network_check' }}
              </mat-icon>
              <span>Przetestuj gniazdo TCP ({{ currentHost() }}:{{ currentPort() }})</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Gotowe konfiguracje dla Zigbee2MQTT i natywnego skryptu Python -->
      <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <mat-icon class="text-cyan-400">integration_instructions</mat-icon>
            <h3 class="text-sm font-bold text-white">Gotowe definicje połączenia po sieci do skopiowania</h3>
          </div>
          <span class="text-xs text-slate-500 font-mono">Zgodne z oficjalnym przewodnikiem dongle.sonoff.tech</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- Wariant 1: Zigbee2MQTT -->
          <div class="p-4 rounded-xl bg-slate-950 border border-slate-800">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-bold text-white">1. Zigbee2MQTT (configuration.yaml)</span>
              <button
                (click)="copySnippet(z2mSnippet())"
                class="text-xs text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1 cursor-pointer"
              >
                <mat-icon class="text-xs !w-3.5 !h-3.5">content_copy</mat-icon>
                <span>Kopiuj</span>
              </button>
            </div>
            <pre class="text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed"><code>{{ z2mSnippet() }}</code></pre>
          </div>

          <!-- Wariant 2: Natywny skrypt zigpy (backend_native.py) -->
          <div class="p-4 rounded-xl bg-slate-950 border border-slate-800">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-bold text-white">2. Natywny Python zigpy (backend_native.py)</span>
              <button
                (click)="copySnippet(zigpySnippet())"
                class="text-xs text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1 cursor-pointer"
              >
                <mat-icon class="text-xs !w-3.5 !h-3.5">content_copy</mat-icon>
                <span>Kopiuj</span>
              </button>
            </div>
            <pre class="text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed"><code>{{ zigpySnippet() }}</code></pre>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class DongleMaxManager {
  readonly telemetry = inject(Telemetry);
  readonly saveSuccess = signal<boolean>(false);

  readonly configForm = new FormGroup({
    connection_mode: new FormControl<'network_tcp' | 'usb_serial'>('network_tcp', { nonNullable: true }),
    operating_mode: new FormControl<'coordinator' | 'router'>('coordinator', { nonNullable: true }),
    host: new FormControl<string>('Dongle-M.local', { nonNullable: true, validators: [Validators.required] }),
    port: new FormControl<number>(6638, { nonNullable: true, validators: [Validators.required] }),
    serial_port: new FormControl<string>('/dev/ttyACM0', { nonNullable: true }),
    adapter: new FormControl<string>('ember', { nonNullable: true }),
    wifi_softap_mode: new FormControl<boolean>(false, { nonNullable: true }),
    wifi_softap_ssid: new FormControl<string>('', { nonNullable: true }),
    wifi_softap_password: new FormControl<string>('', { nonNullable: true }),
    wifi_softap_channel: new FormControl<number>(6, { nonNullable: true }),
    wifi_softap_ip: new FormControl<string>('', { nonNullable: true }),
  });

  constructor() {
    const cur = this.telemetry.dongleMaxConfig();
    if (cur) {
      this.patchForm(cur);
    }
  }

  patchForm(cur: DongleMaxConfig): void {
    this.configForm.patchValue({
      connection_mode: cur.connection_mode || 'network_tcp',
      operating_mode: cur.operating_mode || 'coordinator',
      host: cur.host || '',
      port: cur.port || 6638,
      serial_port: cur.serial_port || '/dev/ttyACM0',
      adapter: cur.adapter || 'ember',
      wifi_softap_mode: cur.wifi_softap_mode ?? false,
      wifi_softap_ssid: cur.wifi_softap_ssid || '',
      wifi_softap_password: cur.wifi_softap_password || '',
      wifi_softap_channel: cur.wifi_softap_channel || 6,
      wifi_softap_ip: cur.wifi_softap_ip || '',
    });
  }

  currentHost(): string {
    return this.configForm.get('host')?.value || '';
  }

  currentPort(): number {
    return this.configForm.get('port')?.value || 6638;
  }

  webConsoleHref = computed(() => {
    const h = this.currentHost();
    return h.startsWith('http') ? h : `http://${h}`;
  });

  z2mSnippet = computed(() => {
    const h = this.currentHost();
    const p = this.currentPort();
    return `# Konfiguracja Zigbee2MQTT dla Sonoff Dongle Max po sieci\nserial:\n  port: tcp://${h}:${p}\n  adapter: ember\n  baudrate: 115200\nadvanced:\n  channel: 15\n  log_level: info`;
  });

  zigpySnippet = computed(() => {
    const h = this.currentHost();
    const p = this.currentPort();
    return `# Uruchomienie backend_native.py z połączeniem sieciowym TCP:\nexport ZIGBEE_PORT="socket://${h}:${p}"\nexport ZIGBEE_BAUDRATE=115200\nexport ZIGBEE_FLOW_CONTROL=none\n\npython backend_native.py`;
  });

  async saveConfig(): Promise<void> {
    if (this.configForm.invalid) return;
    const formVal = this.configForm.getRawValue();
    const ok = await this.telemetry.saveDongleMaxConfig(formVal);
    if (ok) {
      this.saveSuccess.set(true);
      setTimeout(() => this.saveSuccess.set(false), 3000);
    }
  }

  testCurrentConnection(): void {
    const host = this.currentHost();
    const port = this.currentPort();
    this.telemetry.testDongleMaxConnection(host, port);
  }

  copySnippet(text: string): void {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(text);
    }
  }
}
