import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
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
                Bezpośrednie sterowanie Sonoff S60TPF, pobieranie kluczy eWeLink oraz integracja z Tuya
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
              <div>SONOFF / eWeLink LAN</div>
              <div class="text-[10px] font-normal opacity-80">S60TPF (192.168.4.4), Dongle-MAX, eWeLink Sync</div>
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
          <!-- SEKCJA 1: SONOFF & DONGLE-MAX                                             -->
          <!-- ========================================================================= -->
          @if (activeBrand() === 'sonoff') {
            <div class="space-y-5">
              
              <!-- 1. DEDYKOWANA KARTA WYKRYTEGO GNIAZDKA S60TPF Z TWOJEJ SIECI -->
              <div class="p-4 rounded-xl bg-gradient-to-r from-cyan-950/60 via-slate-900 to-slate-950 border border-cyan-500/40 space-y-3 relative overflow-hidden">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span class="text-xs font-bold text-white tracking-wide uppercase">
                      Twoje Gniazdko SONOFF S60TPF (Wykryte w sieci Dongle-MAX)
                    </span>
                  </div>
                  @if (isS60InPanel()) {
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      <mat-icon class="text-xs !w-3.5 !h-3.5 text-emerald-400">check_circle</mat-icon>
                      Zarejestrowane w Panelu
                    </span>
                  } @else {
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      Wykryte w sieci (Gotowe)
                    </span>
                  }
                </div>

                <!-- Dane techniczne ze zrzutu ekranu Bonjour / mDNS -->
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                  <div class="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
                    <span class="text-slate-500 text-[10px] block">Adres IP w sieci:</span>
                    <span class="text-cyan-300 font-bold block">192.168.4.4</span>
                  </div>
                  <div class="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
                    <span class="text-slate-500 text-[10px] block">Device ID (eWeLink):</span>
                    <span class="text-white font-bold block">1002729f67</span>
                  </div>
                  <div class="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
                    <span class="text-slate-500 text-[10px] block">Model sprzętowy:</span>
                    <span class="text-emerald-400 font-bold block">S60TPF (ESP32-C3)</span>
                  </div>
                  <div class="p-2 rounded-lg bg-slate-900/90 border border-slate-800">
                    <span class="text-slate-500 text-[10px] block">Szyfrowanie Zeroconf:</span>
                    <span class="text-amber-300 font-bold block">encrypt = true (Port 8081)</span>
                  </div>
                </div>

                <div class="flex items-center justify-between pt-1">
                  <p class="text-[11px] text-slate-300">
                    Gniazdko jest widoczne w sieci Dongle-MAX. Zarejestruj je bezpośrednio w panelu jednym kliknięciem:
                  </p>
                  <button
                    type="button"
                    (click)="addS60Directly()"
                    class="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md shadow-cyan-950/60 flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <mat-icon class="text-xs !w-4 !h-4">power</mat-icon>
                    <span>{{ isS60InPanel() ? 'Odśwież Gniazdko w Pulpicie' : 'Dodaj Gniazdko S60TPF do Pulpitu' }}</span>
                  </button>
                </div>
              </div>

              <!-- 2. SYNCHRONIZACJA Z KONTEM EWELINK (AUTOMATYCZNE POBRANIE KLUCZY ENCRYPT=TRUE) -->
              <div class="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3.5">
                <div class="flex items-center justify-between flex-wrap gap-2 border-b border-slate-800/80 pb-2.5">
                  <div class="flex items-center gap-2">
                    <mat-icon class="text-cyan-400 text-base !w-4 !h-4">cloud_sync</mat-icon>
                    <span class="text-xs font-bold text-white uppercase tracking-wider">
                      Synchronizacja z kontem eWeLink (Pobieranie DeviceKey / API Key)
                    </span>
                  </div>
                  @if (telemetry.ewelinkConfig().connected) {
                    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      Połączono z eWeLink ({{ telemetry.ewelinkConfig().devices?.length || 0 }} urządzeń)
                    </span>
                  }
                </div>

                <div class="p-3 rounded-lg bg-cyan-950/30 border border-cyan-800/40 text-xs text-slate-300 space-y-1.5">
                  <div class="font-semibold text-cyan-300 text-[11px] flex items-center gap-1.5">
                    <mat-icon class="text-xs !w-3.5 !h-3.5 text-cyan-400">vpn_key</mat-icon>
                    <span>Dlaczego to jest klucz do bezpośredniego sterowania:</span>
                  </div>
                  <p class="text-[11px] text-slate-300 leading-relaxed">
                    Jak widać na Twoim zrzucie ekranu z Bonjour mDNS, gniazdko ma włączone <code class="text-amber-300 font-mono">encrypt = true</code>. Do bezpośredniego sterowania w sieci LAN (port 8081) wymaga unikalnego 32-znakowego klucza <strong class="text-white">DeviceKey</strong> przypisanego przez eWeLink. Po zalogowaniu panel pobierze ten klucz z Twojego konta i umożliwi natychmiastowe sterowanie lokalne i chmurowe!
                  </p>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div class="space-y-1">
                    <label for="ewelinkEmailField" class="text-[11px] font-semibold text-slate-300 block">
                      Email lub numer telefonu do aplikacji eWeLink
                    </label>
                    <input
                      id="ewelinkEmailField"
                      type="text"
                      [value]="ewelinkEmail()"
                      (input)="ewelinkEmail.set($any($event.target).value)"
                      placeholder="np. user@example.com lub +48600100200"
                      class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                  <div class="space-y-1">
                    <label for="ewelinkPasswordField" class="text-[11px] font-semibold text-slate-300 block">
                      Hasło do konta eWeLink
                    </label>
                    <input
                      id="ewelinkPasswordField"
                      type="password"
                      [value]="ewelinkPassword()"
                      (input)="ewelinkPassword.set($any($event.target).value)"
                      placeholder="Wpisz hasło eWeLink..."
                      class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div class="flex items-center justify-between flex-wrap gap-2 pt-1">
                  <div class="flex items-center gap-2">
                    <span class="text-[11px] text-slate-400">Region:</span>
                    <select
                      [value]="ewelinkRegion()"
                      (change)="ewelinkRegion.set($any($event.target).value)"
                      class="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-white text-xs font-mono cursor-pointer"
                    >
                      <option value="eu">EU (Europa - zalecane)</option>
                      <option value="us">US (Ameryka)</option>
                      <option value="as">AS (Azja)</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    (click)="loginEwelinkAccount()"
                    [disabled]="isLoggingEwelink() || !ewelinkEmail().trim() || !ewelinkPassword().trim()"
                    class="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:from-slate-800 disabled:to-slate-800 text-white text-xs font-bold shadow-md shadow-cyan-950/50 flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <mat-icon class="text-xs !w-4 !h-4" [class.animate-spin]="isLoggingEwelink()">sync</mat-icon>
                    <span>{{ isLoggingEwelink() ? 'Logowanie i pobieranie kluczy...' : '🔑 Pobierz klucze urządzeń z eWeLink' }}</span>
                  </button>
                </div>

                @if (ewelinkMessage()) {
                  <div
                    class="p-2.5 rounded-lg border text-xs font-mono"
                    [class.bg-emerald-950/40]="ewelinkSuccess()"
                    [class.border-emerald-700/60]="ewelinkSuccess()"
                    [class.text-emerald-300]="ewelinkSuccess()"
                    [class.bg-rose-950/40]="!ewelinkSuccess()"
                    [class.border-rose-700/60]="!ewelinkSuccess()"
                    [class.text-rose-300]="!ewelinkSuccess()"
                  >
                    {{ ewelinkMessage() }}
                  </div>
                }
              </div>

              <!-- 3. RĘCZNE WPROWADZENIE AP I KLUCZA (PORT 8081) -->
              <div class="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                <button
                  type="button"
                  (click)="showManualKeySection.set(!showManualKeySection())"
                  class="flex items-center justify-between w-full text-xs font-bold text-slate-300 hover:text-white transition-colors cursor-pointer"
                >
                  <div class="flex items-center gap-2">
                    <mat-icon class="text-xs !w-4 !h-4 text-cyan-400">tune</mat-icon>
                    <span>Ręczne wpisanie DeviceKey (dla zaawansowanych)</span>
                  </div>
                  <mat-icon class="text-xs !w-4 !h-4">{{ showManualKeySection() ? 'expand_less' : 'expand_more' }}</mat-icon>
                </button>

                @if (showManualKeySection()) {
                  <div class="space-y-3 pt-2 border-t border-slate-800/80">
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div class="space-y-1">
                        <label for="manualS60Ip" class="text-[10px] font-semibold text-slate-400 block">Adres IP</label>
                        <input
                          id="manualS60Ip"
                          type="text"
                          [value]="manualIpField()"
                          (input)="manualIpField.set($any($event.target).value)"
                          class="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-white text-xs font-mono"
                        />
                      </div>
                      <div class="space-y-1">
                        <label for="manualS60Id" class="text-[10px] font-semibold text-slate-400 block">Device ID</label>
                        <input
                          id="manualS60Id"
                          type="text"
                          [value]="manualIdField()"
                          (input)="manualIdField.set($any($event.target).value)"
                          class="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-white text-xs font-mono"
                        />
                      </div>
                      <div class="space-y-1">
                        <label for="manualS60Key" class="text-[10px] font-semibold text-slate-400 block">Klucz API Key / DeviceKey</label>
                        <input
                          id="manualS60Key"
                          type="text"
                          [value]="manualKeyField()"
                          (input)="manualKeyField.set($any($event.target).value)"
                          placeholder="32 znaki..."
                          class="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-white text-xs font-mono"
                        />
                      </div>
                    </div>

                    <div class="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        (click)="testManualSonoffKey()"
                        class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600/20 hover:bg-cyan-600/40 text-cyan-300 border border-cyan-500/40 flex items-center gap-1 transition-all cursor-pointer"
                      >
                        <mat-icon class="text-xs !w-3.5 !h-3.5">network_check</mat-icon>
                        <span>Testuj połączenie szyfrowane AES (Port 8081)</span>
                      </button>

                      <button
                        type="button"
                        (click)="saveManualSonoffWithKey()"
                        class="px-4 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all cursor-pointer"
                      >
                        <span>Zapisz w Panelu</span>
                      </button>
                    </div>

                    @if (manualTestMsg()) {
                      <span class="text-[11px] font-mono text-cyan-400 block">{{ manualTestMsg() }}</span>
                    }
                  </div>
                }
              </div>

            </div>
          }

          <!-- ========================================================================= -->
          <!-- SEKCJA 2: TUYA & SMART LIFE                                               -->
          <!-- ========================================================================= -->
          @if (activeBrand() === 'tuya') {
            <div class="space-y-5">
              
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
                  Parametry lokalne TinyTuya:
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
                      placeholder="np. Wentylator GOW 007 / Gniazdko 16A"
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

  // Sprawdzenie czy S60TPF jest już w panelu
  readonly isS60InPanel = computed(() => {
    return this.telemetry.devices().some((d) => d.ip_address === '192.168.4.4' || d.sonoff_device_id === '1002729f67');
  });

  // --- EWELINK SYNC STATE ---
  readonly ewelinkEmail = signal<string>('b.zbudniewek@gmail.com');
  readonly ewelinkPassword = signal<string>('');
  readonly ewelinkRegion = signal<string>('eu');
  readonly isLoggingEwelink = signal<boolean>(false);
  readonly ewelinkMessage = signal<string>('');
  readonly ewelinkSuccess = signal<boolean>(false);

  // --- MANUAL KEY STATE ---
  readonly showManualKeySection = signal<boolean>(false);
  readonly manualIpField = signal<string>('192.168.4.4');
  readonly manualIdField = signal<string>('1002729f67');
  readonly manualKeyField = signal<string>('');
  readonly manualTestMsg = signal<string>('');

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
    const cfg = this.telemetry.ewelinkConfig();
    if (cfg?.email) {
      this.ewelinkEmail.set(cfg.email);
    }
  }

  // Bezpośrednie 1-klikowe dodanie S60TPF z rozpoznanych danych Bonjour
  async addS60Directly(): Promise<void> {
    const ok = await this.telemetry.addSonoffDevice({
      ip_address: '192.168.4.4',
      name: 'Gniazdko Sonoff S60TPF',
      device_id: '1002729f67',
    });

    if (ok) {
      this.closeModal.emit();
    }
  }

  // Synchronizacja z kontem eWeLink
  async loginEwelinkAccount(): Promise<void> {
    const login = this.ewelinkEmail().trim();
    const pass = this.ewelinkPassword().trim();
    if (!login || !pass) return;

    this.isLoggingEwelink.set(true);
    this.ewelinkMessage.set('');

    try {
      const res = await this.telemetry.loginEwelink(login, pass, this.ewelinkRegion());
      this.isLoggingEwelink.set(false);
      this.ewelinkSuccess.set(res.success);
      this.ewelinkMessage.set(res.message);
    } catch {
      this.isLoggingEwelink.set(false);
      this.ewelinkSuccess.set(false);
      this.ewelinkMessage.set('Błąd połączenia z serwerem logowania eWeLink.');
    }
  }

  testManualSonoffKey(): void {
    const ip = this.manualIpField().trim();
    const id = this.manualIdField().trim();
    const key = this.manualKeyField().trim();
    if (!ip) return;

    this.manualTestMsg.set('Testowanie połączenia AES port 8081...');
    this.telemetry.testSonoffDevice({ ip, device_id: id, api_key: key }).subscribe({
      next: (res) => {
        this.manualTestMsg.set(res.message);
      },
      error: (err) => {
        this.manualTestMsg.set(err?.error?.message || 'Brak odpowiedzi portu 8081.');
      },
    });
  }

  async saveManualSonoffWithKey(): Promise<void> {
    const ip = this.manualIpField().trim();
    const id = this.manualIdField().trim();
    const key = this.manualKeyField().trim();
    if (!ip) return;

    const ok = await this.telemetry.addSonoffDevice({
      ip_address: ip,
      name: 'Gniazdko Sonoff S60TPF',
      device_id: id || undefined,
      api_key: key || undefined,
    });

    if (ok) {
      this.closeModal.emit();
    }
  }

  // --- TUYA METHODS ---

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
