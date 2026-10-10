import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  output,
  signal,
} from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Telemetry } from '../../services/telemetry';
import { DeviceCategory } from '../../models/telemetry.models';

interface DetectedSonoffPlug {
  ip: string;
  deviceId?: string;
  model: string;
  switch?: string;
  rssi?: number;
  power?: number;
  voltage?: number;
  current?: number;
  isAlreadyAdded: boolean;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-wifi-pairing-modal',
  imports: [MatIconModule, ReactiveFormsModule],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in">
      <div class="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        <!-- NAGŁÓWEK OKNA -->
        <div class="px-6 py-4 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 border-b border-slate-800 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-indigo-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0">
              <mat-icon>settings_input_antenna</mat-icon>
            </div>
            <div>
              <h3 class="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <span>Parowanie i Dodawanie Urządzeń Wi-Fi</span>
                <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800/60 uppercase">
                  LAN / SoftAP
                </span>
              </h3>
              <p class="text-xs text-slate-400">
                Automatyczne wykrywanie w sieci Sonoff Dongle-MAX oraz integracja z Tuya Smart Life
              </p>
            </div>
          </div>
          <button
            (click)="closeModal.emit()"
            class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Zamknij"
          >
            <mat-icon class="text-sm !w-4 !h-4">close</mat-icon>
          </button>
        </div>

        <!-- GŁÓWNY PRZEŁĄCZNIK EKOSYSTEMU: SONOFF vs TUYA -->
        <div class="p-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-center gap-3">
          <button
            (click)="activeBrand.set('sonoff')"
            class="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer border"
            [class.bg-gradient-to-r]="activeBrand() === 'sonoff'"
            [class.from-cyan-600]="activeBrand() === 'sonoff'"
            [class.to-blue-600]="activeBrand() === 'sonoff'"
            [class.border-cyan-400]="activeBrand() === 'sonoff'"
            [class.text-white]="activeBrand() === 'sonoff'"
            [class.shadow-lg]="activeBrand() === 'sonoff'"
            [class.shadow-cyan-950/60]="activeBrand() === 'sonoff'"
            [class.bg-slate-900]="activeBrand() !== 'sonoff'"
            [class.border-slate-800]="activeBrand() !== 'sonoff'"
            [class.text-slate-400]="activeBrand() !== 'sonoff'"
            [class.hover:text-white]="activeBrand() !== 'sonoff'"
          >
            <mat-icon class="text-base !w-4 !h-4">power</mat-icon>
            <div class="text-left leading-tight">
              <div>SONOFF / Dongle-MAX</div>
              <div class="text-[10px] font-normal opacity-80">S60TFP, eWeLink LAN, SoftAP 192.168.4.x</div>
            </div>
          </button>

          <button
            (click)="activeBrand.set('tuya')"
            class="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer border"
            [class.bg-gradient-to-r]="activeBrand() === 'tuya'"
            [class.from-amber-600]="activeBrand() === 'tuya'"
            [class.to-orange-600]="activeBrand() === 'tuya'"
            [class.border-amber-400]="activeBrand() === 'tuya'"
            [class.text-white]="activeBrand() === 'tuya'"
            [class.shadow-lg]="activeBrand() === 'tuya'"
            [class.shadow-amber-950/60]="activeBrand() === 'tuya'"
            [class.bg-slate-900]="activeBrand() !== 'tuya'"
            [class.border-slate-800]="activeBrand() !== 'tuya'"
            [class.text-slate-400]="activeBrand() !== 'tuya'"
            [class.hover:text-white]="activeBrand() !== 'tuya'"
          >
            <mat-icon class="text-base !w-4 !h-4">offline_bolt</mat-icon>
            <div class="text-left leading-tight">
              <div>TUYA / Smart Life</div>
              <div class="text-[10px] font-normal opacity-80">GOW 007, Gniazdka 16A, TinyTuya LAN</div>
            </div>
          </button>
        </div>

        <!-- ZAWARTOŚĆ ZAKŁADKI -->
        <div class="p-4 sm:p-6 space-y-6 overflow-y-auto custom-scrollbar flex-1">

          <!-- ========================================================================= -->
          <!-- SEKCJA 1: SONOFF & DONGLE-MAX (AUTOMATYCZNE WYKRYWANIE W SIECI AP / LAN)   -->
          <!-- ========================================================================= -->
          @if (activeBrand() === 'sonoff') {
            <div class="space-y-5">
              
              <!-- KARTA STATUSU ACCESS POINTA DONGLE-MAX -->
              <div class="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3 relative overflow-hidden">
                <div class="absolute right-0 top-0 w-32 h-32 bg-cyan-500/5 rounded-full blur-2xl pointer-events-none"></div>

                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                  <div class="flex items-center gap-2">
                    <mat-icon class="text-cyan-400 text-lg !w-5 !h-5">cell_tower</mat-icon>
                    <span class="text-xs font-bold text-white tracking-wide uppercase">Sieć Access Pointa Sonoff Dongle-MAX</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <a
                      href="https://dongle.sonoff.tech/guide/dongle-m/web_console/"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 underline flex items-center gap-1"
                    >
                      <span>Web Console Dongle-M</span>
                      <mat-icon class="text-[11px] !w-3 !h-3">open_in_new</mat-icon>
                    </a>
                    <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                      AP Gotowy
                    </span>
                  </div>
                </div>

                <!-- Parametry sieci Dongle-MAX -->
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
                  <div class="p-2 rounded-lg bg-slate-900 border border-slate-800/80">
                    <span class="text-slate-500 text-[10px] block">SSID Access Pointa:</span>
                    <span class="text-cyan-300 font-bold truncate block">
                      {{ telemetry.dongleMaxAp().ssid || (telemetry.dongleMaxConfig()?.wifi_softap_ssid || 'Dongle-M_AP / Sonoff') }}
                    </span>
                  </div>
                  <div class="p-2 rounded-lg bg-slate-900 border border-slate-800/80">
                    <span class="text-slate-500 text-[10px] block">Brama AP / Konsola:</span>
                    <span class="text-white font-bold block">192.168.4.1</span>
                  </div>
                  <div class="p-2 rounded-lg bg-slate-900 border border-slate-800/80 col-span-2 sm:col-span-1">
                    <span class="text-slate-500 text-[10px] block">Podsieć DHCP gniazdek:</span>
                    <span class="text-emerald-400 font-bold block">192.168.4.0/24</span>
                  </div>
                </div>

                <!-- Instrukcja szybkiego łączenia przyciskiem -->
                <div class="p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-800/40 text-xs text-slate-300 space-y-1">
                  <div class="flex items-center gap-1.5 text-cyan-300 font-semibold text-[11px]">
                    <mat-icon class="text-xs !w-3.5 !h-3.5">touch_app</mat-icon>
                    <span>Jak działa automatyczne połączenie przyciskiem:</span>
                  </div>
                  <p class="text-[11px] text-slate-300 leading-relaxed">
                    Gdy przytrzymasz przycisk na gniazdku Sonoff (np. S60TFP) przez <strong class="text-white">5 sekund</strong>, gniazdko wchodzi w tryb parowania i natychmiast łączy się z wystawionym przez Dongle-MAX Access Pointem lub Twoją siecią Wi-Fi. Poniższy automat samoczynnie przeczyta podsieć i zarejestruje gniazdko w panelu.
                  </p>
                </div>
              </div>

              <!-- GŁÓWNY PRZYCISK AUTOMATU SKANUJĄCEGO -->
              <div class="space-y-3">
                <button
                  type="button"
                  (click)="runDongleMaxAutoScan()"
                  [disabled]="isAutoScanning()"
                  class="w-full flex items-center justify-center gap-2.5 px-5 py-3.5 rounded-xl bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-white text-xs sm:text-sm font-bold shadow-xl shadow-cyan-950/60 transition-all cursor-pointer border border-cyan-400/30"
                >
                  <mat-icon class="text-base !w-5 !h-5" [class.animate-spin]="isAutoScanning()">
                    {{ isAutoScanning() ? 'radar' : 'auto_mode' }}
                  </mat-icon>
                  <span>
                    {{ isAutoScanning() ? 'Przeszukiwanie sieci Dongle-MAX & eWeLink LAN...' : 'Uruchom automat wyszukiwania gniazdek w sieci Dongle-MAX' }}
                  </span>
                </button>

                @if (autoScanStatusMessage()) {
                  <div class="p-3 rounded-xl bg-slate-950 border border-cyan-800/60 flex items-center justify-between text-xs font-mono">
                    <span class="text-cyan-300 flex items-center gap-2">
                      <mat-icon class="text-xs !w-3.5 !h-3.5 text-cyan-400">info</mat-icon>
                      {{ autoScanStatusMessage() }}
                    </span>
                    <span class="text-[10px] text-slate-400">Podsieci: 192.168.4.x, LAN</span>
                  </div>
                }
              </div>

              <!-- LISTA WYKRYTYCH GNIAZDEK W PODSIECI DONGLE-MAX -->
              @if (detectedSonoffPlugs().length > 0) {
                <div class="p-4 rounded-xl bg-slate-950 border border-cyan-500/40 space-y-3">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2 text-xs font-bold text-white">
                      <mat-icon class="text-emerald-400 text-sm !w-4 !h-4">check_circle</mat-icon>
                      <span>Wykryte gniazdka w sieci ({{ detectedSonoffPlugs().length }})</span>
                    </div>
                    <span class="text-[10px] text-slate-400 font-mono">eWeLink Zeroconf Port 8081</span>
                  </div>

                  <div class="space-y-2 max-h-56 overflow-y-auto">
                    @for (plug of detectedSonoffPlugs(); track plug.ip) {
                      <div class="p-3 rounded-lg bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
                        <div class="space-y-0.5">
                          <div class="flex items-center gap-2">
                            <span class="font-bold text-white">{{ plug.ip }}</span>
                            <span class="text-[10px] px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800/60">
                              {{ plug.model }}
                            </span>
                            @if (plug.switch) {
                              <span
                                class="text-[10px] px-1.5 py-0.2 rounded font-bold"
                                [class.bg-emerald-950]="plug.switch === 'on'"
                                [class.text-emerald-300]="plug.switch === 'on'"
                                [class.bg-slate-800]="plug.switch !== 'on'"
                                [class.text-slate-400]="plug.switch !== 'on'"
                              >
                                {{ plug.switch === 'on' ? 'STAN: ON' : 'STAN: OFF' }}
                              </span>
                            }
                          </div>
                          <div class="text-[11px] text-slate-400 flex items-center gap-3">
                            @if (plug.deviceId) {
                              <span>Device ID: {{ plug.deviceId }}</span>
                            }
                            @if (plug.rssi) {
                              <span>RSSI: {{ plug.rssi }} dBm</span>
                            }
                            @if (plug.power !== undefined && plug.power !== null) {
                              <span class="text-amber-300 font-semibold">Moc: {{ plug.power }} W</span>
                            }
                          </div>
                        </div>

                        <div>
                          @if (plug.isAlreadyAdded) {
                            <span class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-xs font-bold">
                              <mat-icon class="text-xs !w-3.5 !h-3.5">verified</mat-icon>
                              <span>W Pulpicie</span>
                            </span>
                          } @else {
                            <button
                              type="button"
                              (click)="addDiscoveredSonoff(plug)"
                              class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-emerald-950/50 transition-all cursor-pointer"
                            >
                              <mat-icon class="text-xs !w-3.5 !h-3.5">add</mat-icon>
                              <span>Dodaj automatycznie</span>
                            </button>
                          }
                        </div>
                      </div>
                    }
                  </div>
                </div>
              }

              <!-- ROZWIJANA OPCJA RĘCZNEGO DODANIA PO IP DLA SONOFF -->
              <div class="border-t border-slate-800/80 pt-3">
                <button
                  type="button"
                  (click)="showManualSonoff.set(!showManualSonoff())"
                  class="flex items-center gap-1 text-xs text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer"
                >
                  <mat-icon class="text-xs !w-3.5 !h-3.5">{{ showManualSonoff() ? 'expand_less' : 'expand_more' }}</mat-icon>
                  <span>{{ showManualSonoff() ? 'Ukryj ręczne dodawanie po IP dla Sonoff' : 'Dodaj gniazdko Sonoff po wpisanym IP ręcznie (opcjonalnie)' }}</span>
                </button>

                @if (showManualSonoff()) {
                  <div class="mt-3 p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div class="space-y-1">
                        <label for="sonoffManualIp" class="text-[11px] font-semibold text-slate-300 block">Adres IP gniazdka Sonoff</label>
                        <input
                          id="sonoffManualIp"
                          type="text"
                          [value]="sonoffManualIp()"
                          (input)="sonoffManualIp.set($any($event.target).value)"
                          placeholder="np. 192.168.4.12 lub 192.168.1.160"
                          class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                      <div class="space-y-1">
                        <label for="sonoffManualName" class="text-[11px] font-semibold text-slate-300 block">Nazwa w panelu</label>
                        <input
                          id="sonoffManualName"
                          type="text"
                          [value]="sonoffManualName()"
                          (input)="sonoffManualName.set($any($event.target).value)"
                          placeholder="np. Gniazdko S60TFP Kuchnia"
                          class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div class="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        (click)="testSonoffManual()"
                        [disabled]="isTestingSonoff() || !sonoffManualIp().trim()"
                        class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-300 border border-cyan-500/40 flex items-center gap-1 transition-all cursor-pointer"
                      >
                        <mat-icon class="text-xs !w-3.5 !h-3.5" [class.animate-spin]="isTestingSonoff()">network_check</mat-icon>
                        <span>{{ isTestingSonoff() ? 'Test...' : 'Testuj połączenie Sonoff (Port 8081)' }}</span>
                      </button>

                      <button
                        type="button"
                        (click)="addSonoffManual()"
                        [disabled]="isAddingSonoff() || !sonoffManualIp().trim()"
                        class="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all cursor-pointer"
                      >
                        <span>{{ isAddingSonoff() ? 'Dodawanie...' : 'Zarejestruj w Panelu' }}</span>
                      </button>
                    </div>

                    @if (sonoffTestMsg()) {
                      <span class="text-[11px] font-mono block text-cyan-400">{{ sonoffTestMsg() }}</span>
                    }
                  </div>
                }
              </div>

            </div>
          }

          <!-- ========================================================================= -->
          <!-- SEKCJA 2: TUYA & SMART LIFE (SKAN LAN, KOD QR ORAZ RĘCZNE DODAWANIE)       -->
          <!-- ========================================================================= -->
          @if (activeBrand() === 'tuya') {
            <div class="space-y-5">
              
              <!-- BANER TRYBU TUYA: AUTOMATYCZNY SKAN LUB RĘCZNIE -->
              <div class="flex items-center justify-between flex-wrap gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800">
                <div class="flex items-center gap-2">
                  <mat-icon class="text-amber-400 text-base !w-4 !h-4">radar</mat-icon>
                  <span class="text-xs font-bold text-white">Wykrywanie Urządzeń Tuya LAN (TinyTuya)</span>
                </div>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    (click)="scanTuyaLan()"
                    [disabled]="isScanningTuya()"
                    class="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 disabled:bg-slate-800 text-white flex items-center gap-1.5 transition-all cursor-pointer shadow-md shadow-amber-950/50"
                  >
                    <mat-icon class="text-xs !w-3.5 !h-3.5" [class.animate-spin]="isScanningTuya()">radar</mat-icon>
                    <span>{{ isScanningTuya() ? 'Skanowanie...' : 'Skanuj sieć Tuya LAN' }}</span>
                  </button>
                  <button
                    type="button"
                    (click)="openTuyaQrModal.emit()"
                    class="px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 flex items-center gap-1.5 transition-all cursor-pointer"
                    title="Uruchom skaner kodu QR Tuya, aby automatycznie pobrać klucze"
                  >
                    <mat-icon class="text-xs !w-3.5 !h-3.5 text-cyan-400">qr_code_scanner</mat-icon>
                    <span>Skaner QR (Auto-Key)</span>
                  </button>
                </div>
              </div>

              <!-- WYNIKI AUTOMATYCZNEGO SKANOWANIA TUYA -->
              @if (tuyaDiscovered().length > 0) {
                <div class="p-3.5 rounded-xl bg-amber-950/30 border border-amber-600/40 space-y-2">
                  <div class="flex items-center justify-between text-xs font-mono text-amber-300">
                    <span class="font-bold">Znalezione urządzenia Tuya w sieci (kliknij aby wybrać):</span>
                    <span class="text-[10px] text-slate-400">{{ tuyaDiscovered().length }} urządzeń</span>
                  </div>
                  <div class="space-y-1.5 max-h-36 overflow-y-auto">
                    @for (dev of tuyaDiscovered(); track dev.id) {
                      <div
                        role="button"
                        tabindex="0"
                        (click)="selectTuyaDiscovered(dev)"
                        (keydown.enter)="selectTuyaDiscovered(dev)"
                        class="p-2 rounded-lg bg-slate-900 hover:bg-amber-950/60 border border-slate-800 hover:border-amber-500/50 flex items-center justify-between text-xs font-mono cursor-pointer transition-colors"
                      >
                        <div class="flex items-center gap-2">
                          <mat-icon class="text-xs !w-3.5 !h-3.5 text-amber-400">devices</mat-icon>
                          <span class="text-white font-bold">{{ dev.ip }}</span>
                          <span class="text-slate-400 truncate max-w-[150px]">ID: {{ dev.id }}</span>
                        </div>
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 border border-slate-700">
                          Protokół v{{ dev.version }}
                        </span>
                      </div>
                    }
                  </div>
                </div>
              }

              <!-- FORMULARZ DODAWANIA URZĄDZENIA TUYA -->
              <div class="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3.5">
                <div class="text-xs font-semibold text-slate-300">
                  Konfiguracja parametrów lokalnych TinyTuya:
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div class="space-y-1">
                    <label for="tuyaIpField" class="text-[11px] font-semibold text-slate-300 block">Adres IP w sieci</label>
                    <input
                      id="tuyaIpField"
                      type="text"
                      [value]="tuyaIp()"
                      (input)="tuyaIp.set($any($event.target).value)"
                      placeholder="np. 192.168.1.150"
                      class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                  <div class="space-y-1">
                    <label for="tuyaNameField" class="text-[11px] font-semibold text-slate-300 block">Nazwa własna urządzenia</label>
                    <input
                      id="tuyaNameField"
                      type="text"
                      [value]="tuyaName()"
                      (input)="tuyaName.set($any($event.target).value)"
                      placeholder="np. Götze & Jensen GOW 007 / Gniazdko 16A"
                      class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div class="space-y-1">
                    <label for="tuyaCategorySelect" class="text-[11px] font-semibold text-slate-300 block">Kategoria urządzenia</label>
                    <select
                      id="tuyaCategorySelect"
                      [value]="tuyaCategory()"
                      (change)="onTuyaCategoryChange($any($event.target).value)"
                      class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:border-amber-400 focus:outline-none cursor-pointer"
                    >
                      <option value="plug">Gniazdko inteligentne (Tuya Smart Plug 16A)</option>
                      <option value="fan">Wentylator kolumnowy / HVAC (GOW 007 7w1)</option>
                      <option value="smoke">Czujka dymu / Sensor pożarowy (Smoke Detector)</option>
                      <option value="switch">Przekaźnik / Włącznik światła (Smart Switch)</option>
                      <option value="climate">Termostat / Ogrzewanie (Smart Thermostat)</option>
                      <option value="sensor">Czujnik środowiskowy (Sensor Wi-Fi)</option>
                    </select>
                  </div>
                  <div class="space-y-1">
                    <label for="tuyaModelField" class="text-[11px] font-semibold text-slate-300 block">Model (opcjonalny)</label>
                    <input
                      id="tuyaModelField"
                      type="text"
                      [value]="tuyaModel()"
                      (input)="tuyaModel.set($any($event.target).value)"
                      placeholder="np. TS011F, GOW 007, TS0601"
                      class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div class="space-y-1">
                    <label for="tuyaDevIdField" class="text-[11px] font-semibold text-slate-300 block">Device ID (Tuya ID)</label>
                    <input
                      id="tuyaDevIdField"
                      type="text"
                      [value]="tuyaDevId()"
                      (input)="tuyaDevId.set($any($event.target).value)"
                      placeholder="np. bf9123456789abcdef"
                      class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                  <div class="space-y-1">
                    <label for="tuyaLocalKeyField" class="text-[11px] font-semibold text-slate-300 block">
                      Local Key (16-znakowy klucz AES)
                    </label>
                    <input
                      id="tuyaLocalKeyField"
                      type="text"
                      [value]="tuyaLocalKey()"
                      (input)="tuyaLocalKey.set($any($event.target).value)"
                      placeholder="np. a1b2c3d4e5f6g7h8"
                      class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                </div>

                <!-- Test połączenia TinyTuya -->
                <div class="flex items-center justify-between flex-wrap gap-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    (click)="testTuyaConnection()"
                    [disabled]="isTestingTuya() || !tuyaIp().trim() || !tuyaLocalKey().trim() || !tuyaDevId().trim()"
                    class="px-3 py-2 rounded-lg text-xs font-semibold bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <mat-icon class="text-xs !w-3.5 !h-3.5" [class.animate-spin]="isTestingTuya()">network_check</mat-icon>
                    <span>{{ isTestingTuya() ? 'Testowanie...' : 'Testuj połączenie TinyTuya LAN' }}</span>
                  </button>

                  <button
                    type="button"
                    (click)="addTuyaDevice()"
                    [disabled]="isAddingTuya() || !tuyaIp().trim()"
                    class="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-lg shadow-amber-950/60 transition-all cursor-pointer"
                  >
                    <span>{{ isAddingTuya() ? 'Rejestracja...' : 'Dodaj Urządzenie Tuya do Panelu' }}</span>
                  </button>
                </div>

                @if (tuyaTestMsg()) {
                  <span class="text-[11px] font-mono block" [class.text-emerald-400]="tuyaTestOk()" [class.text-rose-400]="!tuyaTestOk()">
                    {{ tuyaTestMsg() }}
                  </span>
                }
              </div>

            </div>
          }

        </div>

        <!-- STOPKA OKNA -->
        <div class="px-6 py-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
            <span>Koordynator Dongle-MAX: <strong class="text-cyan-300 font-mono">EFR32MG24 (Dongle-M)</strong></span>
          </div>
          <button
            (click)="closeModal.emit()"
            class="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-semibold transition-colors cursor-pointer"
          >
            Zamknij
          </button>
        </div>

      </div>
    </div>
  `,
})
export class WifiPairingModal implements OnInit {
  readonly telemetry = inject(Telemetry);
  readonly closeModal = output<void>();
  readonly openTuyaQrModal = output<void>();

  // Główny podział: 'sonoff' | 'tuya'
  readonly activeBrand = signal<'sonoff' | 'tuya'>('sonoff');

  // --- SONOFF & DONGLE-MAX STATE ---
  readonly isAutoScanning = signal<boolean>(false);
  readonly autoScanStatusMessage = signal<string>('');
  readonly detectedSonoffPlugs = signal<DetectedSonoffPlug[]>([]);
  readonly showManualSonoff = signal<boolean>(false);
  readonly sonoffManualIp = signal<string>('192.168.4.10');
  readonly sonoffManualName = signal<string>('Gniazdko Sonoff S60TFP Wi-Fi');
  readonly isTestingSonoff = signal<boolean>(false);
  readonly isAddingSonoff = signal<boolean>(false);
  readonly sonoffTestMsg = signal<string>('');

  // --- TUYA STATE ---
  readonly isScanningTuya = signal<boolean>(false);
  readonly tuyaDiscovered = signal<{ id: string; ip: string; version: string }[]>([]);
  readonly tuyaIp = signal<string>('');
  readonly tuyaName = signal<string>('Gniazdko Tuya Smart Plug 16A');
  readonly tuyaCategory = signal<DeviceCategory>('plug');
  readonly tuyaModel = signal<string>('Tuya Wi-Fi Smart Device');
  readonly tuyaDevId = signal<string>('');
  readonly tuyaLocalKey = signal<string>('');
  readonly isTestingTuya = signal<boolean>(false);
  readonly isAddingTuya = signal<boolean>(false);
  readonly tuyaTestMsg = signal<string>('');
  readonly tuyaTestOk = signal<boolean>(false);

  ngOnInit(): void {
    // Na starcie pobierz już wykryte urządzenia z serwisu telemetrycznego jeśli istnieją
    const cached = this.telemetry.dongleMaxDiscoveredDevices();
    if (cached && cached.length > 0) {
      this.detectedSonoffPlugs.set(cached);
    }
  }

  // --- METODY SONOFF & DONGLE-MAX ---

  async runDongleMaxAutoScan(): Promise<void> {
    this.isAutoScanning.set(true);
    this.autoScanStatusMessage.set('Skanowanie podsieci Access Pointa Dongle-MAX (192.168.4.x) oraz sieci domowej...');

    try {
      const res = await this.telemetry.autoDiscoverDongleMaxSubnet();
      this.isAutoScanning.set(false);
      this.autoScanStatusMessage.set(res.message);

      if (res.allDetected && res.allDetected.length > 0) {
        this.detectedSonoffPlugs.set(res.allDetected);
      }
    } catch {
      this.isAutoScanning.set(false);
      this.autoScanStatusMessage.set('Błąd podczas wykonywania skanu sieci Dongle-MAX.');
    }
  }

  async addDiscoveredSonoff(plug: DetectedSonoffPlug): Promise<void> {
    const ok = await this.telemetry.addSonoffDevice({
      ip_address: plug.ip,
      name: `Gniazdko Sonoff S60 (${plug.ip})`,
      device_id: plug.deviceId,
    });

    if (ok) {
      plug.isAlreadyAdded = true;
      this.detectedSonoffPlugs.update((list) =>
        list.map((p) => (p.ip === plug.ip ? { ...p, isAlreadyAdded: true } : p)),
      );
    }
  }

  testSonoffManual(): void {
    const ip = this.sonoffManualIp().trim();
    if (!ip) return;

    this.isTestingSonoff.set(true);
    this.sonoffTestMsg.set('');

    this.telemetry.testSonoffDevice({ ip }).subscribe({
      next: (res) => {
        this.isTestingSonoff.set(false);
        this.sonoffTestMsg.set(res.message);
      },
      error: (err) => {
        this.isTestingSonoff.set(false);
        this.sonoffTestMsg.set(err?.error?.message || 'Brak odpowiedzi portu 8081 eWeLink LAN.');
      },
    });
  }

  async addSonoffManual(): Promise<void> {
    const ip = this.sonoffManualIp().trim();
    if (!ip) return;

    this.isAddingSonoff.set(true);
    const ok = await this.telemetry.addSonoffDevice({
      ip_address: ip,
      name: this.sonoffManualName().trim(),
    });
    this.isAddingSonoff.set(false);

    if (ok) {
      this.closeModal.emit();
    }
  }

  // --- METODY TUYA ---

  scanTuyaLan(): void {
    this.isScanningTuya.set(true);
    this.tuyaTestMsg.set('');

    this.telemetry.scanTinyTuya().subscribe({
      next: (res) => {
        this.isScanningTuya.set(false);
        if (res.devices && res.devices.length > 0) {
          this.tuyaDiscovered.set(res.devices);
        } else {
          this.tuyaTestMsg.set('Brak odpowiedzi urządzeń Tuya w pasywnym nasłuchu UDP (broadcast 6666/6667).');
          this.tuyaTestOk.set(false);
        }
      },
      error: (err) => {
        this.isScanningTuya.set(false);
        this.tuyaTestMsg.set(err?.error?.message || 'Błąd podczas skanowania sieci Tuya.');
        this.tuyaTestOk.set(false);
      },
    });
  }

  selectTuyaDiscovered(dev: { id: string; ip: string; version: string }): void {
    this.tuyaIp.set(dev.ip);
    this.tuyaDevId.set(dev.id);
    if (!this.tuyaName() || this.tuyaName() === 'Gniazdko Tuya Smart Plug 16A') {
      this.tuyaName.set(`Urządzenie Tuya (${dev.ip})`);
    }
  }

  onTuyaCategoryChange(cat: string): void {
    this.tuyaCategory.set(cat as DeviceCategory);
  }

  testTuyaConnection(): void {
    const ip = this.tuyaIp().trim();
    const key = this.tuyaLocalKey().trim();
    const devId = this.tuyaDevId().trim();
    if (!ip || !key || !devId) return;

    this.isTestingTuya.set(true);
    this.tuyaTestMsg.set('');

    this.telemetry.testTinyTuya({ ip, local_key: key, dev_id: devId }).subscribe({
      next: (res) => {
        this.isTestingTuya.set(false);
        this.tuyaTestOk.set(res.success);
        this.tuyaTestMsg.set(res.message);
      },
      error: (err) => {
        this.isTestingTuya.set(false);
        this.tuyaTestOk.set(false);
        this.tuyaTestMsg.set(err?.error?.message || 'Błąd autoryzacji TinyTuya (błędny Local Key lub Device ID).');
      },
    });
  }

  async addTuyaDevice(): Promise<void> {
    const ip = this.tuyaIp().trim();
    if (!ip) return;

    this.isAddingTuya.set(true);
    const extra = {
      local_key: this.tuyaLocalKey().trim() || undefined,
      tuya_dev_id: this.tuyaDevId().trim() || undefined,
      tuya_protocol_version: '3.3',
    };

    const ok = await this.telemetry.addWifiDevice(
      ip,
      this.tuyaName().trim(),
      this.tuyaModel().trim(),
      this.tuyaCategory(),
      undefined,
      extra,
    );
    this.isAddingTuya.set(false);

    if (ok) {
      this.closeModal.emit();
    }
  }
}
