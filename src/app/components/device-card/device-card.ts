import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Device, DeviceCategory } from '../../models/telemetry.models';
import { formatEuropeanDateTime, formatEuropeanDate, format24hTime } from '../../utils/date-format';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-device-card',
  imports: [MatIconModule],
  template: `
    <div
      tabindex="0"
      role="button"
      (click)="cardClicked.emit(device())"
      (keydown.enter)="cardClicked.emit(device())"
      (keydown.space)="cardClicked.emit(device())"
      class="group relative bg-slate-900/90 hover:bg-slate-900 border rounded-2xl p-5 transition-all duration-300 cursor-pointer shadow-md focus:outline-none"
      [class.border-slate-800]="!tempRank()"
      [class.hover:border-slate-700/80]="!tempRank()"
      [class.hover:shadow-xl]="!tempRank()"
      [class.hover:shadow-cyan-950/20]="!tempRank()"
      [class.focus:border-cyan-500]="!tempRank()"
      [class.border-red-500]="tempRank() === 'max'"
      [class.ring-2]="!!tempRank()"
      [class.ring-red-500/70]="tempRank() === 'max'"
      [class.shadow-2xl]="!!tempRank()"
      [class.shadow-red-600/30]="tempRank() === 'max'"
      [class.bg-gradient-to-b]="!!tempRank()"
      [class.from-red-950/50]="tempRank() === 'max'"
      [class.via-slate-900/95]="!!tempRank()"
      [class.to-slate-900]="!!tempRank()"
      [class.border-sky-400]="tempRank() === 'min'"
      [class.ring-sky-400/70]="tempRank() === 'min'"
      [class.shadow-sky-500/30]="tempRank() === 'min'"
      [class.from-sky-950/50]="tempRank() === 'min'"
      [class.telemetry-updated]="device().isRecentlyUpdated"
    >
      <!-- Wskaźnik skrajnych temperatur (Najwyższa / Najniższa - wykluczając termostaty) -->
      @if (tempRank() === 'max') {
        <div class="mb-3 px-3 py-1.5 rounded-xl bg-red-500/20 border border-red-500/60 flex items-center justify-between text-red-200 text-xs font-mono font-bold animate-pulse shadow-md shadow-red-950/50">
          <div class="flex items-center gap-1.5">
            <mat-icon class="text-sm !w-4 !h-4 text-red-400">local_fire_department</mat-icon>
            <span>NAJWYŻSZA TEMPERATURA (MAX)</span>
          </div>
          <span class="text-red-200 font-extrabold text-sm">{{ formattedTemp() }}°C</span>
        </div>
      } @else if (tempRank() === 'min') {
        <div class="mb-3 px-3 py-1.5 rounded-xl bg-sky-500/20 border border-sky-400/60 flex items-center justify-between text-sky-200 text-xs font-mono font-bold animate-pulse shadow-md shadow-sky-950/50">
          <div class="flex items-center gap-1.5">
            <mat-icon class="text-sm !w-4 !h-4 text-sky-400">ac_unit</mat-icon>
            <span>NAJNIŻSZA TEMPERATURA (MIN)</span>
          </div>
          <span class="text-sky-200 font-extrabold text-sm">{{ formattedTemp() }}°C</span>
        </div>
      }

      <!-- Górny wiersz: Badge Kategorii, Nazwa, Zmiana Nazwy oraz Bateria / Zasilanie -->
      <div class="flex items-start justify-between gap-3 mb-3.5">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 mb-1 flex-wrap">
            <span
              class="text-[10px] font-mono uppercase px-2 py-0.5 rounded-md font-semibold tracking-wide border"
              [class]="categoryBadgeClass()"
            >
              {{ categoryBadgeLabel() }}
            </span>
            @if (isWifiDevice()) {
              <span class="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                <mat-icon class="text-[10px] !w-3 !h-3">wifi</mat-icon>
                <span>Wi-Fi</span>
              </span>
            }
            @if (isBasicZb1gsp()) {
              <span class="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold" title="Urządzenie na szynę DIN 35mm (32A / 7680W)">
                <mat-icon class="text-[10px] !w-3 !h-3">electrical_services</mat-icon>
                <span>Szyna DIN • 32A</span>
              </span>
              <span class="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30" title="Wzmacniacz sygnału sieci Zigbee Mesh (Router)">
                <mat-icon class="text-[10px] !w-3 !h-3">router</mat-icon>
                <span>Router Mesh</span>
              </span>
            }
            @if (category() === 'fan' || category() === 'smoke' || category() === 'plug' || isWifiDevice()) {
              @if (device().local_key) {
                <span
                  class="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  title="Sterowanie lokalne TinyTuya aktywne w sieci LAN (Local Key skonfigurowany)"
                >
                  <mat-icon class="text-[11px] !w-3 !h-3 text-emerald-400">vpn_key</mat-icon>
                  <span>TinyTuya: ••••{{ localKeyLast4() }}</span>
                </span>
              } @else {
                <button
                  (click)="openTuyaQr($event)"
                  class="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-colors cursor-pointer"
                  title="Kliknij aby pobrać klucz Tuya Local Key przez kod QR lub skonfigurować TinyTuya"
                >
                  <mat-icon class="text-[11px] !w-3 !h-3 text-amber-400">qr_code_scanner</mat-icon>
                  <span>Pobierz Local Key (QR)</span>
                </button>
              }
            }
            @if (device().vendor) {
              <span class="text-[10px] font-mono text-slate-500 truncate max-w-[120px]">
                {{ device().vendor }}
              </span>
            }
          </div>

          <div class="flex items-center gap-1.5">
            <h3 class="text-sm font-bold text-white truncate group-hover:text-cyan-300 transition-colors">
              {{ device().friendly_name || device().ieee_address }}
            </h3>
            <button
              (click)="onRenameClick($event)"
              class="text-slate-500 hover:text-cyan-400 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              title="Zmień nazwę urządzenia"
            >
              <mat-icon class="text-xs !w-3.5 !h-3.5">edit</mat-icon>
            </button>
          </div>
          <div class="flex items-center gap-2 text-[11px] font-mono text-slate-500 truncate mt-0.5">
            <span class="truncate">{{ device().model }}</span>
            @if (deviceIpAddress()) {
              <span class="text-indigo-400 font-semibold shrink-0">IP: {{ deviceIpAddress() }}</span>
            }
          </div>
        </div>

        <!-- Wskaźnik zasilania: Bateria lub Zasilanie sieciowe 230V -->
        @if (device().battery !== undefined && device().battery !== null) {
          <div
            class="flex items-center gap-1 text-xs font-mono shrink-0 px-2 py-1 rounded-md bg-slate-950/80 border border-slate-800"
            [title]="'Poziom baterii: ' + device().battery + '%'"
          >
            <mat-icon class="text-sm !w-4 !h-4" [class]="batteryColorClass()">
              {{ batteryIcon() }}
            </mat-icon>
            <span class="tabular-nums font-semibold" [class]="batteryColorClass()">
              {{ device().battery }}%
            </span>
          </div>
        } @else {
          <div
            class="flex items-center gap-1 text-[11px] font-mono shrink-0 px-2 py-1 rounded-md bg-slate-950/80 border border-slate-800 text-slate-400"
            title="Zasilanie stałe 230V AC"
          >
            <mat-icon class="text-xs !w-3.5 !h-3.5 text-cyan-400">power</mat-icon>
            <span>230V</span>
          </div>
        }
      </div>

      <!-- SEKCJA GŁÓWNA KAFELKA W ZALEŻNOŚCI OD TYPU URZĄDZENIA -->

      <!-- 1. GŁOWICA TERMOSTATYCZNA (Sonoff TRVZB / TRVZB Gen 2) -->
      @if (category() === 'climate') {
        <div class="space-y-3 mb-4">
          <!-- Główny panel nastawy temperatury z przyciskami +/- -->
          <div class="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 flex items-center justify-between gap-3">
            <div>
              <div class="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                <mat-icon class="text-rose-400 text-xs !w-3.5 !h-3.5">thermostat</mat-icon>
                <span>Nastawa zadana</span>
              </div>
              <div class="flex items-baseline gap-1 mt-0.5">
                <span class="text-2xl font-bold font-mono text-white tabular-nums tracking-tight">
                  {{ setpointTemp() }}
                </span>
                <span class="text-xs font-mono text-rose-400">°C</span>
              </div>
            </div>

            <!-- Przyciski regulacji nastawy o 0.5°C -->
            <div class="flex items-center gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800">
              <button
                (click)="adjustSetpoint(-0.5, $event)"
                class="w-7 h-7 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center font-bold text-sm transition-colors cursor-pointer"
                title="Zmniejsz temperaturę o 0.5°C"
              >
                -
              </button>
              <button
                (click)="adjustSetpoint(0.5, $event)"
                class="w-7 h-7 rounded-md bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center font-bold text-sm transition-colors cursor-pointer shadow-sm shadow-rose-950"
                title="Zwiększ temperaturę o 0.5°C"
              >
                +
              </button>
            </div>
          </div>

          <!-- Pomiary dodatkowe: Temperatura bieżąca, stan grzania, tryb -->
          <div class="grid grid-cols-2 gap-2 text-xs font-mono">
            <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
              <span class="text-slate-400 text-[11px]">Bieżąca:</span>
              <span class="text-white font-bold">{{ measuredTemp() }}°C</span>
            </div>

            <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
              <span class="text-slate-400 text-[11px]">Stan:</span>
              @if (device().running_state === 'heat') {
                <span class="text-orange-400 font-bold flex items-center gap-1">
                  <mat-icon class="text-xs !w-3 !h-3 text-orange-400">local_fire_department</mat-icon>
                  Grzeje
                </span>
              } @else {
                <span class="text-slate-400">Czuwanie</span>
              }
            </div>
          </div>

          <!-- Przełącznik trybu TRV: Heat / Auto / Off oraz blokada rodzicielska -->
          <div class="flex items-center justify-between gap-2 pt-1">
            <div class="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[10px] font-semibold">
              <button
                (click)="setSystemMode('heat', $event)"
                class="px-2 py-0.5 rounded transition-colors cursor-pointer"
                [class.bg-rose-600]="device().system_mode === 'heat'"
                [class.text-white]="device().system_mode === 'heat'"
                [class.text-slate-400]="device().system_mode !== 'heat'"
              >
                Heat
              </button>
              <button
                (click)="setSystemMode('auto', $event)"
                class="px-2 py-0.5 rounded transition-colors cursor-pointer"
                [class.bg-cyan-600]="device().system_mode === 'auto'"
                [class.text-white]="device().system_mode === 'auto'"
                [class.text-slate-400]="device().system_mode !== 'auto'"
              >
                Auto
              </button>
              <button
                (click)="setSystemMode('off', $event)"
                class="px-2 py-0.5 rounded transition-colors cursor-pointer"
                [class.bg-slate-700]="device().system_mode === 'off'"
                [class.text-white]="device().system_mode === 'off'"
                [class.text-slate-400]="device().system_mode !== 'off'"
              >
                Off
              </button>
            </div>

            <button
              (click)="toggleChildLock($event)"
              class="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300 hover:text-white transition-colors cursor-pointer"
              [title]="device().child_lock === 'LOCK' ? 'Blokada rodzicielska włączona (kliknij aby odblokować)' : 'Blokada wyłączona (kliknij aby zablokować)'"
            >
              <mat-icon class="text-xs !w-3.5 !h-3.5" [class.text-amber-400]="device().child_lock === 'LOCK'">
                {{ device().child_lock === 'LOCK' ? 'lock' : 'lock_open' }}
              </mat-icon>
              <span class="text-[10px] font-mono">{{ device().child_lock === 'LOCK' ? 'Zablok.' : 'Odblok.' }}</span>
            </button>
          </div>

          <!-- Przycisk rozwijający zaawansowane opcje -->
          <div class="pt-2 border-t border-slate-800/40">
            <button
              (click)="toggleAdvanced($event)"
              class="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-950/80 hover:bg-slate-950 border border-slate-800 text-[11px] font-bold text-slate-300 hover:text-white transition-all cursor-pointer"
            >
              <div class="flex items-center gap-1.5">
                <mat-icon class="text-xs text-indigo-400 !w-4 !h-4">tune</mat-icon>
                <span>Opcje zaawansowane głowicy</span>
              </div>
              <mat-icon class="text-xs text-slate-500 !w-4 !h-4 transition-transform duration-200" [style.transform]="showAdvanced() ? 'rotate(180deg)' : 'none'">
                expand_more
              </mat-icon>
            </button>
          </div>

          <!-- Opcje zaawansowane rozwijane -->
          @if (showAdvanced()) {
            <div
              role="button"
              tabindex="0"
              (click)="$event.stopPropagation()"
              (keydown.enter)="$event.stopPropagation()"
              (keydown.space)="$event.stopPropagation()"
              class="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] font-mono space-y-3.5 animate-fade-in"
            >
              
              <!-- 1. Kalibracja temperatury -->
              <div class="space-y-1">
                <div class="flex justify-between text-slate-400">
                  <span>Kalibracja czujnika:</span>
                  <span class="text-white font-bold">{{ device().local_temperature_calibration ?? 0 }}°C</span>
                </div>
                <div class="flex items-center gap-2">
                  <input
                    type="range"
                    min="-12.5"
                    max="12.5"
                    step="0.5"
                    [value]="device().local_temperature_calibration ?? 0"
                    (change)="setAdvancedAttr('local_temperature_calibration', $any($event.target).value)"
                    class="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>
              </div>

              <!-- 2. Detekcja otwartego okna (Open window) & Ochrona przed mrozem (Frost protection) -->
              <div class="grid grid-cols-2 gap-2">
                <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                  <span class="text-slate-400">Otwarte okno:</span>
                  <button
                    (click)="setAdvancedAttr('open_window', !device().open_window)"
                    class="px-2 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer"
                    [class.bg-emerald-500/20]="device().open_window"
                    [class.text-emerald-400]="device().open_window"
                    [class.border-emerald-500/30]="device().open_window"
                    [class.bg-slate-950]="!device().open_window"
                    [class.text-slate-500]="!device().open_window"
                    [class.border-slate-800]="!device().open_window"
                  >
                    {{ device().open_window ? 'ON' : 'OFF' }}
                  </button>
                </div>

                <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                  <span class="text-slate-400">Ochrona mróz:</span>
                  <input
                    type="number"
                    min="4"
                    max="15"
                    step="0.5"
                    [value]="device().frost_protection_temperature ?? 5.0"
                    (change)="setAdvancedAttr('frost_protection_temperature', $any($event.target).value)"
                    class="w-12 px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-white text-center focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <!-- 3. Wybór czujnika temperatury (local/remote) & Zdalna temp -->
              <div class="grid grid-cols-2 gap-2">
                <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <span class="text-slate-400 block">Czujnik źródła:</span>
                  <select
                    [value]="device().temperature_sensor ?? 'local_temperature'"
                    (change)="setAdvancedAttr('temperature_sensor', $any($event.target).value)"
                    class="w-full bg-slate-950 border border-slate-800 text-white rounded text-[10px] px-1 py-0.5"
                  >
                    <option value="local_temperature">Wbudowany</option>
                    <option value="remote_temperature">Zewnętrzny</option>
                  </select>
                </div>

                <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <span class="text-slate-400 block">Zdalna temp:</span>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    step="0.1"
                    [value]="device().external_temperature ?? 22.0"
                    (change)="setAdvancedAttr('external_temperature', $any($event.target).value)"
                    class="w-full px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <!-- 4. Stopień otwarcia zaworu (Valve opening degree) & Dokładność regulacji (Temperature accuracy) -->
              <div class="grid grid-cols-2 gap-2">
                <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <span class="text-slate-400 block">Zawór otwarcie:</span>
                  <div class="flex items-center gap-1.5 justify-between">
                    <span class="text-emerald-400 font-bold">{{ device().valve_opening_degree ?? 100 }}%</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="5"
                      [value]="device().valve_opening_degree ?? 100"
                      (change)="setAdvancedAttr('valve_opening_degree', $any($event.target).value)"
                      class="w-10 px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-white text-center text-[10px]"
                    />
                  </div>
                </div>

                <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <span class="text-slate-400 block">Dokładność regulacji:</span>
                  <select
                    [value]="device().temperature_accuracy ?? -1"
                    (change)="setAdvancedAttr('temperature_accuracy', $any($event.target).value)"
                    class="w-full bg-slate-950 border border-slate-800 text-white rounded text-[10px] px-1 py-0.5"
                  >
                    <option value="-1">-1.0°C (Default)</option>
                    <option value="-0.8">-0.8°C</option>
                    <option value="-0.6">-0.6°C</option>
                    <option value="-0.4">-0.4°C</option>
                    <option value="-0.2">-0.2°C</option>
                  </select>
                </div>
              </div>

              <!-- 5. Smart temperature control (PID) -->
              <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between">
                <span class="text-slate-400">Kontrola PID (Smart Temp):</span>
                <button
                  (click)="setAdvancedAttr('smart_temperature_control', !device().smart_temperature_control)"
                  class="px-2 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer"
                  [class.bg-emerald-500/20]="device().smart_temperature_control"
                  [class.text-emerald-400]="device().smart_temperature_control"
                  [class.border-emerald-500/30]="device().smart_temperature_control"
                  [class.bg-slate-950]="!device().smart_temperature_control"
                  [class.text-slate-500]="!device().smart_temperature_control"
                  [class.border-slate-800]="!device().smart_temperature_control"
                >
                  {{ device().smart_temperature_control ? 'WŁĄCZ' : 'WYŁĄCZ' }}
                </button>
              </div>

              <!-- 6. Tryb tymczasowy i czas trwania -->
              <div class="grid grid-cols-2 gap-2">
                <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <span class="text-slate-400 block">Tryb tymczasowy:</span>
                  <select
                    [value]="device().temporary_mode ?? 'none'"
                    (change)="setAdvancedAttr('temporary_mode', $any($event.target).value)"
                    class="w-full bg-slate-950 border border-slate-800 text-white rounded text-[10px] px-1 py-0.5 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="none">Brak (Normalny)</option>
                    <option value="boost">Boost Mode</option>
                    <option value="timer">Timer Mode</option>
                  </select>
                </div>

                <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <span class="text-slate-400 block">Czas trwania (min):</span>
                  <input
                    type="number"
                    min="0"
                    max="1440"
                    step="5"
                    [value]="device().temporary_mode_duration ?? 0"
                    (change)="setAdvancedAttr('temporary_mode_duration', $any($event.target).value)"
                    class="w-full px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500 text-center"
                  />
                </div>
              </div>

              <!-- 7. Temperatura trybu Timer i Stopień zamknięcia zaworu -->
              <div class="grid grid-cols-2 gap-2">
                <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <span class="text-slate-400 block">Temp. trybu Timer:</span>
                  <input
                    type="number"
                    min="4"
                    max="35"
                    step="0.5"
                    [value]="device().timer_mode_target_temp ?? 20"
                    (change)="setAdvancedAttr('timer_mode_target_temp', $any($event.target).value)"
                    class="w-full px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-indigo-500 text-center"
                  />
                </div>

                <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1">
                  <span class="text-slate-400 block">Zawór zamkn. stopień:</span>
                  <div class="flex items-center gap-1.5 justify-between">
                    <span class="text-orange-400 font-bold">{{ device().valve_closing_degree ?? 100 }}%</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="5"
                      [value]="device().valve_closing_degree ?? 100"
                      (change)="setAdvancedAttr('valve_closing_degree', $any($event.target).value)"
                      class="w-10 px-1 py-0.5 rounded bg-slate-950 border border-slate-800 text-white text-center text-[10px]"
                    />
                  </div>
                </div>
              </div>

              <!-- 8. Harmonogram Tygodniowy (Auto) -->
              <div class="pt-2 border-t border-slate-800/40">
                <button
                  (click)="toggleSchedule($event)"
                  class="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-slate-950/80 hover:bg-slate-950 border border-slate-800 text-[11px] font-bold text-slate-300 hover:text-white transition-all cursor-pointer"
                >
                  <div class="flex items-center gap-1.5">
                    <mat-icon class="text-xs text-amber-400 !w-4 !h-4">calendar_month</mat-icon>
                    <span>Harmonogram Tygodniowy (Auto)</span>
                  </div>
                  <mat-icon class="text-xs text-slate-500 !w-4 !h-4 transition-transform duration-200" [style.transform]="showSchedule() ? 'rotate(180deg)' : 'none'">
                    expand_more
                  </mat-icon>
                </button>
              </div>

              @if (showSchedule()) {
                <div
                  role="button"
                  tabindex="0"
                  (click)="$event.stopPropagation()"
                  (keydown.enter)="$event.stopPropagation()"
                  (keydown.space)="$event.stopPropagation()"
                  class="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] font-mono space-y-3 animate-fade-in"
                >
                  <div class="text-[10px] text-slate-400 leading-relaxed mb-1">
                    Format: oddzielone spacją 'HH:mm/temperatura' (np. '00:00/20.0 06:00/22.0'). Pierwsza zmiana od 00:00, zakres: 4-35°C (krok 0.5°C). Upisuj do 6 zmian dziennie.
                  </div>
                  
                  @for (day of daysOfWeek; track day.key) {
                    <div class="space-y-1">
                      <span class="block text-[10px] text-slate-400 uppercase font-semibold">{{ day.label }}:</span>
                      <input
                        type="text"
                        [value]="getWeeklySchedule(day.key)"
                        (change)="setAdvancedAttr('weekly_schedule_' + day.key, $any($event.target).value)"
                        class="w-full px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-amber-500 text-[11px]"
                        placeholder="np. 00:00/20.0 06:00/22.0"
                      />
                    </div>
                  }
                </div>
              }

              <!-- 9. Dane techniczne z silnika i napięć -->
              <div class="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800 text-[9px] font-mono grid grid-cols-2 gap-x-3 gap-y-1.5 text-slate-400 pt-3 border-t border-slate-800/40">
                <div>Kroki kalibr. (Idle): <span class="text-slate-200 font-semibold">{{ device().idle_steps ?? '211' }}</span></div>
                <div>Kroki zamkn. (Closing): <span class="text-slate-200 font-semibold">{{ device().closing_steps ?? '432' }}</span></div>
                <div>Napięcie otw. (Limit): <span class="text-slate-200 font-semibold">{{ device().valve_opening_limit_voltage ?? '1654' }}mV</span></div>
                <div>Napięcie zamk. (Limit): <span class="text-slate-200 font-semibold">{{ device().valve_closing_limit_voltage ?? '2597' }}mV</span></div>
                <div class="col-span-2">Napięcie silnika (Running): <span class="text-slate-200 font-semibold">{{ device().valve_motor_running_voltage ?? '1127' }}mV</span></div>
              </div>

            </div>
          }
        </div>
      }

      <!-- 1b. WENTYLATOR KOLUMNOWY 7w1 (Gotze & Jensen GOW 007 Tuya WiFi) -->
      @else if (category() === 'fan') {
        <div class="space-y-3 mb-4">
          <!-- Górny pasek wentylatora: Zasilanie + Bieg nawiewu (1-12) -->
          <div class="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 flex items-center justify-between gap-3">
            <div>
              <div class="text-[11px] font-medium text-slate-400 flex items-center gap-1.5">
                <mat-icon class="text-cyan-400 text-xs !w-3.5 !h-3.5" [class.animate-spin]="isStateOn()">mode_fan</mat-icon>
                <span>Bieg nawiewu (1-12)</span>
              </div>
              <div class="flex items-baseline gap-1 mt-0.5">
                <span class="text-2xl font-bold font-mono text-white tabular-nums tracking-tight">
                  {{ isStateOn() ? (device().fan_speed ?? 1) : 'OFF' }}
                </span>
                @if (isStateOn()) {
                  <span class="text-xs font-mono text-cyan-400">/ 12</span>
                }
              </div>
            </div>

            <div class="flex items-center gap-1.5 bg-slate-900 p-1 rounded-lg border border-slate-800">
              <button
                (click)="adjustFanSpeed(-1, $event)"
                class="w-7 h-7 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center font-bold text-sm transition-colors cursor-pointer"
                title="Zmniejsz bieg wentylatora"
              >
                -
              </button>
              <button
                (click)="adjustFanSpeed(1, $event)"
                class="w-7 h-7 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white flex items-center justify-center font-bold text-sm transition-colors cursor-pointer shadow-sm shadow-cyan-950"
                title="Zwiększ bieg wentylatora"
              >
                +
              </button>
              <button
                (click)="togglePowerState($event)"
                class="px-2.5 h-7 rounded-md font-bold text-xs flex items-center gap-1 transition-colors cursor-pointer ml-1"
                [class.bg-emerald-600]="isStateOn()"
                [class.text-white]="isStateOn()"
                [class.bg-slate-800]="!isStateOn()"
                [class.text-slate-400]="!isStateOn()"
                title="Włącz / Wyłącz wentylator"
              >
                <mat-icon class="text-xs !w-3.5 !h-3.5">power_settings_new</mat-icon>
                <span>{{ isStateOn() ? 'ON' : 'OFF' }}</span>
              </button>
            </div>
          </div>

          <!-- Funkcje 7w1: Jonizacja, Nawilżacz, Lampa UV, Oscylacja -->
          <div class="grid grid-cols-4 gap-1.5 text-[10px] font-mono">
            <button
              (click)="toggleFanFeature('fan_oscillation', $event)"
              class="p-2 rounded-lg border flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer"
              [class.bg-cyan-950/60]="device().fan_oscillation"
              [class.border-cyan-700/80]="device().fan_oscillation"
              [class.text-cyan-300]="device().fan_oscillation"
              [class.bg-slate-950]="!device().fan_oscillation"
              [class.border-slate-800]="!device().fan_oscillation"
              [class.text-slate-400]="!device().fan_oscillation"
              title="Oscylacja obrotowa"
            >
              <mat-icon class="text-xs !w-3.5 !h-3.5">sync</mat-icon>
              <span>Obrót</span>
            </button>

            <button
              (click)="toggleFanFeature('fan_ionizer', $event)"
              class="p-2 rounded-lg border flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer"
              [class.bg-emerald-950/60]="device().fan_ionizer"
              [class.border-emerald-700/80]="device().fan_ionizer"
              [class.text-emerald-300]="device().fan_ionizer"
              [class.bg-slate-950]="!device().fan_ionizer"
              [class.border-slate-800]="!device().fan_ionizer"
              [class.text-slate-400]="!device().fan_ionizer"
              title="Jonizator powietrza 7w1"
            >
              <mat-icon class="text-xs !w-3.5 !h-3.5">air</mat-icon>
              <span>Jonizator</span>
            </button>

            <button
              (click)="toggleFanFeature('fan_humidifier', $event)"
              class="p-2 rounded-lg border flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer"
              [class.bg-blue-950/60]="device().fan_humidifier"
              [class.border-blue-700/80]="device().fan_humidifier"
              [class.text-blue-300]="device().fan_humidifier"
              [class.bg-slate-950]="!device().fan_humidifier"
              [class.border-slate-800]="!device().fan_humidifier"
              [class.text-slate-400]="!device().fan_humidifier"
              title="Nawilżacz ultradźwiękowy 7w1"
            >
              <mat-icon class="text-xs !w-3.5 !h-3.5">water_drop</mat-icon>
              <span>Nawilżacz</span>
            </button>

            <button
              (click)="toggleFanFeature('fan_uv', $event)"
              class="p-2 rounded-lg border flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer"
              [class.bg-purple-950/60]="device().fan_uv"
              [class.border-purple-700/80]="device().fan_uv"
              [class.text-purple-300]="device().fan_uv"
              [class.bg-slate-950]="!device().fan_uv"
              [class.border-slate-800]="!device().fan_uv"
              [class.text-slate-400]="!device().fan_uv"
              title="Lampa UV sterylizująca 7w1"
            >
              <mat-icon class="text-xs !w-3.5 !h-3.5">wb_iridescent</mat-icon>
              <span>Lampa UV</span>
            </button>
          </div>

          <!-- Pomiary telemetryczne wentylatora (Moc, Temperatura otoczenia) -->
          <div class="grid grid-cols-2 gap-2 text-xs font-mono">
            <div class="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
              <span class="text-slate-400 text-[11px]">Moc pobierana:</span>
              <span class="text-emerald-400 font-bold">{{ device().power ?? 45 }} W</span>
            </div>
            <div class="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
              <span class="text-slate-400 text-[11px]">Tryb:</span>
              <span class="text-cyan-300 font-bold capitalize">{{ device().fan_mode ?? 'normal' }}</span>
            </div>
          </div>

          <!-- Status integracji Tuya Local Key i sterowania domowego -->
          <div class="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800 flex items-center justify-between gap-2 text-xs font-mono">
            <div class="flex items-center gap-1.5 min-w-0">
              <mat-icon
                class="text-sm !w-4 !h-4"
                [class.text-emerald-400]="device().local_key"
                [class.text-amber-400]="!device().local_key"
              >
                {{ device().local_key ? 'verified_user' : 'vpn_key_alert' }}
              </mat-icon>
              <div class="truncate">
                @if (device().local_key) {
                  <span class="text-emerald-300 font-semibold">Tuya Local:</span>
                  <span class="text-slate-300 ml-1">Klucz aktywny (••••{{ localKeyLast4() }})</span>
                } @else {
                  <span class="text-amber-400 font-semibold">Brak Local Key</span>
                  <span class="text-slate-400 ml-1 hidden sm:inline">(wymagany w sieci)</span>
                }
              </div>
            </div>

            <button
              (click)="openTuyaQr($event)"
              class="px-2.5 py-1 rounded-lg text-[10px] font-bold flex items-center gap-1 border transition-all cursor-pointer shrink-0 shadow-sm"
              [class.bg-emerald-500/15]="device().local_key"
              [class.border-emerald-500/30]="device().local_key"
              [class.text-emerald-300]="device().local_key"
              [class.hover:bg-emerald-500/25]="device().local_key"
              [class.bg-amber-500/20]="!device().local_key"
              [class.border-amber-500/50]="!device().local_key"
              [class.text-amber-300]="!device().local_key"
              [class.hover:bg-amber-500/30]="!device().local_key"
              title="Pobierz lub zaktualizuj Local Key przez skanowanie kodu QR"
            >
              <mat-icon class="text-xs !w-3.5 !h-3.5">qr_code_scanner</mat-icon>
              <span>{{ device().local_key ? 'Klucz QR' : 'Pobierz QR' }}</span>
            </button>
          </div>
        </div>
      }

      <!-- 2. INTELIGENTNE GNIAZDKO (Sonoff S26R2ZB / S40ZB / Tuya TS011F) -->
      @else if (category() === 'plug') {
        <div class="space-y-3 mb-4">
          <!-- Duży przycisk ON/OFF zasilania gniazdka -->
          <div class="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 flex items-center justify-between gap-3">
            <div>
              <div class="text-[11px] font-medium text-slate-400">Status gniazdka 16A</div>
              <div class="text-base font-bold font-mono tracking-tight mt-0.5" [class.text-emerald-400]="isStateOn()" [class.text-slate-500]="!isStateOn()">
                {{ isStateOn() ? 'WŁĄCZONE (ON)' : 'WYŁĄCZONE (OFF)' }}
              </div>
            </div>

            <button
              (click)="togglePowerState($event)"
              class="px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
              [class.bg-emerald-600]="isStateOn()"
              [class.hover:bg-emerald-500]="isStateOn()"
              [class.text-white]="isStateOn()"
              [class.shadow-emerald-950/60]="isStateOn()"
              [class.bg-slate-800]="!isStateOn()"
              [class.hover:bg-slate-700]="!isStateOn()"
              [class.text-slate-300]="!isStateOn()"
              title="Przełącz stan zasilania"
            >
              <mat-icon class="text-sm !w-4 !h-4">power_settings_new</mat-icon>
              <span>{{ isStateOn() ? 'WYŁĄCZ' : 'WŁĄCZ' }}</span>
            </button>
          </div>

          <!-- Pomiary telemetryczne energii: Moc (W), Napięcie (V), Zużycie (kWh) -->
          <div class="grid grid-cols-3 gap-2 text-xs font-mono">
            <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <div class="text-slate-400 text-[10px]">Moc</div>
              <div class="text-white font-bold text-sm mt-0.5">{{ device().power !== undefined && device().power !== null ? device().power + ' W' : '0 W' }}</div>
            </div>
            <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <div class="text-slate-400 text-[10px]">Napięcie</div>
              <div class="text-cyan-300 font-bold text-sm mt-0.5">{{ device().voltage !== undefined && device().voltage !== null ? device().voltage + ' V' : '230 V' }}</div>
            </div>
            <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
              <div class="text-slate-400 text-[10px]">Energia</div>
              <div class="text-emerald-300 font-bold text-sm mt-0.5">{{ device().energy !== undefined && device().energy !== null ? device().energy + ' kWh' : '0 kWh' }}</div>
            </div>
          </div>
        </div>
      }

      <!-- 3. WYŁĄCZNIK / PRZEKAŹNIK (Sonoff BASIC-ZB1GSP 32A DIN / ZBMINIR2 / Tuya Switch) -->
      @else if (category() === 'switch') {
        @if (isHighPowerSwitch()) {
          <div class="space-y-3 mb-4">
            <!-- Pasek statusu przekaźnika 32A z rozłączaniem dwubiegunowym L+N -->
            <div class="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 flex items-center justify-between gap-3 shadow-inner">
              <div class="min-w-0">
                <div class="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                  <mat-icon class="text-xs !w-3.5 !h-3.5 text-amber-400">power</mat-icon>
                  <span>Przekaźnik DIN 32A (Rozłączanie L+N)</span>
                </div>
                <div
                  class="text-base font-bold font-mono tracking-tight mt-0.5 flex items-center gap-2 flex-wrap"
                  [class.text-emerald-400]="isStateOn()"
                  [class.text-slate-500]="!isStateOn()"
                >
                  <span>{{ isStateOn() ? 'ZAŁĄCZONY' : 'ROZŁĄCZONY' }}</span>
                  <span
                    class="text-[10px] font-normal px-1.5 py-0.5 rounded border"
                    [class.bg-emerald-500/10]="isStateOn()"
                    [class.border-emerald-500/30]="isStateOn()"
                    [class.text-emerald-300]="isStateOn()"
                    [class.bg-slate-900]="!isStateOn()"
                    [class.border-slate-800]="!isStateOn()"
                    [class.text-slate-500]="!isStateOn()"
                  >
                    {{ isStateOn() ? 'L+N ZWARTE' : 'L+N ROZWARTE' }}
                  </span>
                </div>
              </div>

              <button
                (click)="togglePowerState($event)"
                class="px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-md cursor-pointer shrink-0"
                [class.bg-emerald-600]="isStateOn()"
                [class.hover:bg-emerald-500]="isStateOn()"
                [class.text-white]="isStateOn()"
                [class.shadow-emerald-950/60]="isStateOn()"
                [class.bg-slate-800]="!isStateOn()"
                [class.hover:bg-slate-700]="!isStateOn()"
                [class.text-slate-300]="!isStateOn()"
                title="Przełącz stan przekaźnika 32A (L+N)"
              >
                <mat-icon class="text-sm !w-4 !h-4">{{ isStateOn() ? 'power_settings_new' : 'toggle_on' }}</mat-icon>
                <span>{{ isStateOn() ? 'ROZŁĄCZ 32A' : 'ZAŁĄCZ 32A' }}</span>
              </button>
            </div>

            <!-- Ostrzeżenie o przeciążeniu lub zbliżaniu się do progu -->
            @if (isOverloadWarning()) {
              <div class="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs font-mono flex items-center gap-2 animate-pulse">
                <mat-icon class="text-rose-400 text-base shrink-0">warning</mat-icon>
                <span class="leading-tight">
                  Wysokie obciążenie obwodu! Pobór: <strong>{{ device().power }} W / {{ device().current }} A</strong> (Limit: {{ device().overload_power_threshold || 7680 }} W).
                </span>
              </div>
            }

            <!-- 4-kolumnowy panel pomiarów telemetrycznych energii -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
              <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
                <div class="text-slate-400 text-[10px] flex items-center justify-between">
                  <span>Moc czynna</span>
                  <mat-icon class="text-[11px] !w-3 !h-3 text-amber-400">bolt</mat-icon>
                </div>
                <div class="text-white font-bold text-sm mt-0.5" [class.text-amber-300]="(device().power || 0) > 3000" [class.text-rose-400]="(device().power || 0) > 6000">
                  {{ device().power !== undefined && device().power !== null ? device().power + ' W' : '0 W' }}
                </div>
              </div>

              <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
                <div class="text-slate-400 text-[10px] flex items-center justify-between">
                  <span>Napięcie</span>
                  <mat-icon class="text-[11px] !w-3 !h-3 text-cyan-400">speed</mat-icon>
                </div>
                <div class="text-cyan-300 font-bold text-sm mt-0.5">
                  {{ device().voltage !== undefined && device().voltage !== null ? device().voltage + ' V' : '230 V' }}
                </div>
              </div>

              <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
                <div class="text-slate-400 text-[10px] flex items-center justify-between">
                  <span>Prąd (32A max)</span>
                  <mat-icon class="text-[11px] !w-3 !h-3 text-emerald-400">electric_meter</mat-icon>
                </div>
                <div class="text-emerald-300 font-bold text-sm mt-0.5">
                  {{ device().current !== undefined && device().current !== null ? device().current + ' A' : '0.0 A' }}
                </div>
                <div class="w-full bg-slate-800 rounded-full h-1 mt-1 overflow-hidden" title="Wykorzystanie dopuszczalnego prądu 32A">
                  <div
                    class="h-full rounded-full transition-all"
                    [class.bg-emerald-500]="currentLoadPercent() < 60"
                    [class.bg-amber-500]="currentLoadPercent() >= 60 && currentLoadPercent() < 90"
                    [class.bg-rose-500]="currentLoadPercent() >= 90"
                    [style.width.%]="currentLoadPercent()"
                  ></div>
                </div>
              </div>

              <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80">
                <div class="text-slate-400 text-[10px] flex items-center justify-between">
                  <span>Licznik energii</span>
                  <mat-icon class="text-[11px] !w-3 !h-3 text-purple-400">energy_savings_leaf</mat-icon>
                </div>
                <div class="text-purple-300 font-bold text-sm mt-0.5">
                  {{ device().energy !== undefined && device().energy !== null ? device().energy + ' kWh' : '0.0 kWh' }}
                </div>
              </div>
            </div>

            <div class="p-2 rounded-lg bg-slate-950/60 border border-slate-800/80 text-[11px] font-mono text-slate-400 flex items-center justify-between">
              <span class="flex items-center gap-1.5">
                <mat-icon class="text-xs !w-3.5 !h-3.5 text-cyan-400">router</mat-icon>
                <span>Router Zigbee 3.0 Mesh (Szyna DIN 35mm):</span>
              </span>
              <span class="text-amber-400 font-semibold">{{ isBasicZb1gsp() ? 'SONOFF BASIC-ZB1GSP' : (device().model || 'Smart Switch') }}</span>
            </div>
          </div>
        } @else {
          <div class="space-y-3 mb-4">
            <div class="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 flex items-center justify-between gap-3">
              <div>
                <div class="text-[11px] font-medium text-slate-400">Przekaźnik obwodu</div>
                <div class="text-base font-bold font-mono tracking-tight mt-0.5" [class.text-emerald-400]="isStateOn()" [class.text-slate-500]="!isStateOn()">
                  {{ isStateOn() ? 'ZAŁĄCZONY' : 'ROZŁĄCZONY' }}
                </div>
              </div>

              <button
                (click)="togglePowerState($event)"
                class="px-4 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                [class.bg-emerald-600]="isStateOn()"
                [class.hover:bg-emerald-500]="isStateOn()"
                [class.text-white]="isStateOn()"
                [class.bg-slate-800]="!isStateOn()"
                [class.hover:bg-slate-700]="!isStateOn()"
                [class.text-slate-300]="!isStateOn()"
                title="Przełącz przekaźnik"
              >
                <mat-icon class="text-sm !w-4 !h-4">toggle_on</mat-icon>
                <span>{{ isStateOn() ? 'ROZŁĄCZ' : 'ZAŁĄCZ' }}</span>
              </button>
            </div>
            <div class="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-xs font-mono text-slate-400 flex items-center justify-between">
              <span>Sterowanie zdalne / bistabilne:</span>
              <span class="text-cyan-400 font-semibold">ZBMINIR2 Zigbee 3.0</span>
            </div>
          </div>
        }
      }

      <!-- 4. CZUJNIK KONTAKTRONOWY DRZWI / OKIEN (Sonoff SNZB-04) -->
      @else if (category() === 'contact') {
        <div class="p-4 rounded-xl bg-slate-950/90 border border-slate-800 mb-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center"
              [class.bg-emerald-950]="device().contact"
              [class.text-emerald-400]="device().contact"
              [class.bg-amber-950]="!device().contact"
              [class.text-amber-400]="!device().contact"
            >
              <mat-icon class="text-xl">{{ device().contact ? 'door_front' : 'meeting_room' }}</mat-icon>
            </div>
            <div>
              <div class="text-[11px] text-slate-400 font-medium">Stan kontaktronu</div>
              <div class="text-base font-bold font-mono" [class.text-emerald-400]="device().contact" [class.text-amber-400]="!device().contact">
                {{ device().contact ? 'ZAMKNIĘTE' : 'OTWARTE!' }}
              </div>
            </div>
          </div>
          <span class="text-xs font-mono text-slate-500">Magnetyczny</span>
        </div>
      }

      <!-- 5. CZUJNIK OBECNOŚCI / RUCHU (Sonoff SNZB-03 / Tuya mmWave) -->
      @else if (category() === 'occupancy') {
        <div class="p-4 rounded-xl bg-slate-950/90 border border-slate-800 mb-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center"
              [class.bg-cyan-950]="device().occupancy"
              [class.text-cyan-400]="device().occupancy"
              [class.bg-slate-950]="!device().occupancy"
              [class.text-slate-500]="!device().occupancy"
            >
              <mat-icon class="text-xl">{{ device().occupancy ? 'directions_walk' : 'person_off' }}</mat-icon>
            </div>
            <div>
              <div class="text-[11px] text-slate-400 font-medium">Detekcja ruchu / radar mmWave</div>
              <div class="text-base font-bold font-mono" [class.text-cyan-400]="device().occupancy" [class.text-slate-400]="!device().occupancy">
                {{ device().occupancy ? 'WYKRYTO RUCH' : 'BRAK OBECNOŚCI' }}
              </div>
            </div>
          </div>
          @if (device().illuminance !== undefined && device().illuminance !== null) {
            <div class="text-xs font-mono text-amber-400 flex items-center gap-1">
              <mat-icon class="text-xs !w-3.5 !h-3.5">light_mode</mat-icon>
              <span>{{ device().illuminance }} lux</span>
            </div>
          }
        </div>
      }

      <!-- 6. CZUJNIK ZALANIA WODĄ (Sonoff SNZB-05 / Tuya Water) -->
      @else if (category() === 'water_leak') {
        <div class="p-4 rounded-xl bg-slate-950/90 border border-slate-800 mb-4 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center"
              [class.bg-rose-950]="device().water_leak"
              [class.text-rose-400]="device().water_leak"
              [class.bg-emerald-950]="!device().water_leak"
              [class.text-emerald-400]="!device().water_leak"
            >
              <mat-icon class="text-xl">{{ device().water_leak ? 'water_damage' : 'water_drop' }}</mat-icon>
            </div>
            <div>
              <div class="text-[11px] text-slate-400 font-medium">Czujnik sondy zalania</div>
              <div class="text-base font-bold font-mono" [class.text-rose-400]="device().water_leak" [class.text-emerald-400]="!device().water_leak">
                {{ device().water_leak ? 'ALARM ZALANIA!' : 'SUCHO / BEZPIECZNIE' }}
              </div>
            </div>
          </div>
          <span class="text-xs font-mono text-slate-500">Sonda IP67</span>
        </div>
      }

      <!-- 6b. CZUJKA DYMU / SENSOR POŻAROWY (Tuya Wi-Fi Smoke Detector - TinyTuya) -->
      @else if (category() === 'smoke') {
        <div class="space-y-3 mb-4">
          <!-- Główny status dymu: BEZPIECZNIE vs WYKRYTO DYM -->
          <div
            class="p-4 rounded-xl border flex items-center justify-between transition-all"
            [class.bg-red-950/50]="isSmokeAlarm()"
            [class.border-red-500/80]="isSmokeAlarm()"
            [class.animate-pulse]="isSmokeAlarm()"
            [class.shadow-lg]="isSmokeAlarm()"
            [class.shadow-red-950/70]="isSmokeAlarm()"
            [class.bg-slate-950/90]="!isSmokeAlarm()"
            [class.border-slate-800]="!isSmokeAlarm()"
          >
            <div class="flex items-center gap-3">
              <div
                class="w-10 h-10 rounded-xl flex items-center justify-center transition-colors"
                [class.bg-red-500/20]="isSmokeAlarm()"
                [class.text-red-400]="isSmokeAlarm()"
                [class.border]="isSmokeAlarm()"
                [class.border-red-500/50]="isSmokeAlarm()"
                [class.bg-emerald-500/10]="!isSmokeAlarm()"
                [class.text-emerald-400]="!isSmokeAlarm()"
              >
                <mat-icon>{{ isSmokeAlarm() ? 'local_fire_department' : 'detector_smoke' }}</mat-icon>
              </div>
              <div>
                <span class="text-xs font-bold block" [class.text-red-300]="isSmokeAlarm()" [class.text-slate-300]="!isSmokeAlarm()">
                  {{ isSmokeAlarm() ? '⚠️ WYKRYTO DYM (ALARM!)' : 'Czujka dymu: Stan bezpieczny' }}
                </span>
                <span class="text-[11px] font-mono text-slate-400">
                  Status: <strong [class.text-red-400]="isSmokeAlarm()" [class.text-emerald-400]="!isSmokeAlarm()">{{ device().smoke_status || (isSmokeAlarm() ? 'alarm' : 'normal') }}</strong>
                </span>
              </div>
            </div>

            <!-- Przyciski akcji: Test / Wyciszenie -->
            <div class="flex items-center gap-1.5">
              @if (isSmokeAlarm()) {
                <button
                  (click)="silenceSmokeAlarm($event)"
                  class="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-bold flex items-center gap-1 shadow-md transition-all cursor-pointer"
                  title="Wycisz syrenę alarmu dymu (silence)"
                >
                  <mat-icon class="text-xs !w-3.5 !h-3.5">volume_off</mat-icon>
                  <span>Wycisz</span>
                </button>
              }
              <button
                (click)="testSmokeAlarm($event)"
                class="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-[11px] font-mono flex items-center gap-1 border border-slate-700 transition-all cursor-pointer"
                title="Przeprowadź autotest czujki dymu przez TinyTuya"
              >
                <mat-icon class="text-xs !w-3.5 !h-3.5 text-cyan-400">notifications_active</mat-icon>
                <span>Autotest</span>
              </button>
            </div>
          </div>

          <!-- Pomiary czujki dymu: Poziom baterii i sabotaż (tamper) -->
          <div class="grid grid-cols-2 gap-2 text-xs font-mono">
            <div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 flex items-center justify-between">
              <span class="text-slate-400 text-[11px]">Bateria:</span>
              <span class="font-bold flex items-center gap-1" [class.text-emerald-400]="(device().battery ?? 100) > 20" [class.text-red-400]="(device().battery ?? 100) <= 20">
                <mat-icon class="text-xs !w-3.5 !h-3.5">battery_std</mat-icon>
                {{ device().battery ?? 100 }}%
              </span>
            </div>
            <div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 flex items-center justify-between">
              <span class="text-slate-400 text-[11px]">Sabotaż (Tamper):</span>
              <span class="font-bold" [class.text-red-400]="device().tamper_alarm" [class.text-emerald-400]="!device().tamper_alarm">
                {{ device().tamper_alarm ? 'ZDJĘTA' : 'OK' }}
              </span>
            </div>
          </div>
        </div>
      }

      <!-- 7. STANDARDOWY CZUJNIK TEMPERATURY I WILGOTNOŚCI (SNZB-02D / LCD) -->
      @else {
        <div class="grid grid-cols-2 gap-3 mb-4">
          <!-- Kafelek Temperatura -->
          <div
            class="p-3 rounded-xl border transition-all"
            [class.bg-slate-950/80]="!tempRank()"
            [class.border-slate-800/80]="!tempRank()"
            [class.bg-red-950/30]="tempRank() === 'max'"
            [class.border-red-500/60]="tempRank() === 'max'"
            [class.shadow-md]="!!tempRank()"
            [class.shadow-red-950/40]="tempRank() === 'max'"
            [class.bg-sky-950/30]="tempRank() === 'min'"
            [class.border-sky-500/60]="tempRank() === 'min'"
            [class.shadow-sky-950/40]="tempRank() === 'min'"
          >
            <div class="flex items-center gap-1 text-[11px] font-medium mb-1">
              <mat-icon
                class="text-xs !w-3.5 !h-3.5"
                [class.text-cyan-400]="!tempRank()"
                [class.text-red-400]="tempRank() === 'max'"
                [class.text-sky-400]="tempRank() === 'min'"
              >
                {{ tempRank() === 'max' ? 'local_fire_department' : (tempRank() === 'min' ? 'ac_unit' : 'thermostat') }}
              </mat-icon>
              <span
                [class.text-slate-400]="!tempRank()"
                [class.text-red-300]="tempRank() === 'max'"
                [class.text-sky-300]="tempRank() === 'min'"
                [class.font-semibold]="!!tempRank()"
              >
                Temperatura
              </span>
            </div>
            <div class="flex items-baseline gap-1">
              @if (hasTemp()) {
                <span
                  class="text-2xl font-bold font-mono tabular-nums tracking-tight"
                  [class.text-white]="!tempRank()"
                  [class.text-red-400]="tempRank() === 'max'"
                  [class.text-sky-300]="tempRank() === 'min'"
                  [class.text-3xl]="!!tempRank()"
                >
                  {{ formattedTemp() }}
                </span>
                <span
                  class="text-xs font-mono"
                  [class.text-cyan-400]="!tempRank()"
                  [class.text-red-400]="tempRank() === 'max'"
                  [class.text-sky-400]="tempRank() === 'min'"
                >°C</span>
              } @else {
                <span class="text-xs font-medium font-mono text-slate-500 italic">brak danych</span>
              }
            </div>
          </div>

          <!-- Kafelek Wilgotność -->
          <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80">
            <div class="flex items-center gap-1 text-[11px] font-medium text-slate-400 mb-1">
              <mat-icon class="text-blue-400 text-xs !w-3.5 !h-3.5">water_drop</mat-icon>
              <span>Wilgotność</span>
            </div>
            <div class="flex items-baseline gap-1">
              @if (hasHum()) {
                <span class="text-2xl font-bold font-mono text-white tabular-nums tracking-tight">
                  {{ formattedHum() }}
                </span>
                <span class="text-xs font-mono text-blue-400">%</span>
              } @else {
                <span class="text-xs font-medium font-mono text-slate-500 italic">brak danych</span>
              }
            </div>
          </div>
        </div>
      }

      <!-- Alarmy dźwiękowe i powiadomienia (dla wybranych kategorii) -->
      @if (category() === 'sensor' || category() === 'climate' || category() === 'occupancy' || category() === 'contact' || category() === 'water_leak') {
        <div class="mt-3.5 pt-3 border-t border-slate-800/40 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-bold text-slate-400 flex items-center gap-1.5">
              <mat-icon class="text-sm !w-4 !h-4 text-amber-500" [class.animate-pulse]="isAlarmActive()">
                {{ isAlarmActive() ? 'notifications_active' : 'notifications' }}
              </mat-icon>
              <span>Alarm dźwiękowy</span>
            </span>
            
            @if (category() === 'occupancy') {
              <button
                (click)="toggleAlarmState('motion_alarm_enabled', $event)"
                class="px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer"
                [class.bg-rose-500/20]="device().motion_alarm_enabled"
                [class.text-rose-400]="device().motion_alarm_enabled"
                [class.border-rose-500/30]="device().motion_alarm_enabled"
                [class.bg-slate-950]="!device().motion_alarm_enabled"
                [class.text-slate-500]="!device().motion_alarm_enabled"
                [class.border-slate-800]="!device().motion_alarm_enabled"
              >
                {{ device().motion_alarm_enabled ? 'WŁĄCZONY' : 'WYŁĄCZONY' }}
              </button>
            } @else if (category() === 'contact') {
              <button
                (click)="toggleAlarmState('contact_alarm_enabled', $event)"
                class="px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer"
                [class.bg-rose-500/20]="device().contact_alarm_enabled"
                [class.text-rose-400]="device().contact_alarm_enabled"
                [class.border-rose-500/30]="device().contact_alarm_enabled"
                [class.bg-slate-950]="!device().contact_alarm_enabled"
                [class.text-slate-500]="!device().contact_alarm_enabled"
                [class.border-slate-800]="!device().contact_alarm_enabled"
              >
                {{ device().contact_alarm_enabled ? 'WŁĄCZONY' : 'WYŁĄCZONY' }}
              </button>
            } @else if (category() === 'water_leak') {
              <button
                (click)="toggleAlarmState('water_alarm_enabled', $event)"
                class="px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer"
                [class.bg-rose-500/20]="device().water_alarm_enabled"
                [class.text-rose-400]="device().water_alarm_enabled"
                [class.border-rose-500/30]="device().water_alarm_enabled"
                [class.bg-slate-950]="!device().water_alarm_enabled"
                [class.text-slate-500]="!device().water_alarm_enabled"
                [class.border-slate-800]="!device().water_alarm_enabled"
              >
                {{ device().water_alarm_enabled ? 'WŁĄCZONY' : 'WYŁĄCZONY' }}
              </button>
            } @else {
              <!-- sensor lub climate (temperatura) -->
              <button
                (click)="toggleAlarmState('temp_alarm_enabled', $event)"
                class="px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer"
                [class.bg-rose-500/20]="device().temp_alarm_enabled"
                [class.text-rose-400]="device().temp_alarm_enabled"
                [class.border-rose-500/30]="device().temp_alarm_enabled"
                [class.bg-slate-950]="!device().temp_alarm_enabled"
                [class.text-slate-500]="!device().temp_alarm_enabled"
                [class.border-slate-800]="!device().temp_alarm_enabled"
              >
                {{ device().temp_alarm_enabled ? 'WŁĄCZONY' : 'WYŁĄCZONY' }}
              </button>
            }
          </div>

          <!-- Dodatkowe progi dla alarmu temperatury -->
          @if ((category() === 'sensor' || category() === 'climate') && device().temp_alarm_enabled) {
            <div class="grid grid-cols-2 gap-2 text-[10px] font-mono pt-1.5">
              <div class="space-y-0.5">
                <span class="text-slate-500 block text-[9px]">Próg min (°C):</span>
                <input
                  type="number"
                  min="0"
                  max="40"
                  step="0.5"
                  [value]="device().temp_alarm_min ?? 16.0"
                  (click)="$event.stopPropagation()"
                  (change)="setAdvancedAttr('temp_alarm_min', $any($event.target).value)"
                  class="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-rose-500 font-mono text-center"
                />
              </div>
              <div class="space-y-0.5">
                <span class="text-slate-500 block text-[9px]">Próg max (°C):</span>
                <input
                  type="number"
                  min="0"
                  max="50"
                  step="0.5"
                  [value]="device().temp_alarm_max ?? 28.0"
                  (click)="$event.stopPropagation()"
                  (change)="setAdvancedAttr('temp_alarm_max', $any($event.target).value)"
                  class="w-full px-2 py-1 rounded bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-rose-500 font-mono text-center"
                />
              </div>
            </div>
          }

          <!-- Zaawansowana konfiguracja dla przekaźnika DIN 32A (BASIC-ZB1GSP) -->
          @if (isHighPowerSwitch()) {
            <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-3 pt-2 mt-2">
              <div class="text-[11px] font-bold text-amber-300 flex items-center gap-1.5 border-b border-slate-800 pb-1.5">
                <mat-icon class="text-xs !w-3.5 !h-3.5">tune</mat-icon>
                <span>Konfiguracja Przekaźnika DIN (BASIC-ZB1GSP)</span>
              </div>

              <!-- Power-On Behavior -->
              <div class="space-y-1 text-xs">
                <span class="text-slate-400 text-[10px] block">Stan po zaniku zasilania (Power-On Behavior):</span>
                <div class="grid grid-cols-3 gap-1.5">
                  <button
                    (click)="setPowerOnBehavior('previous', $event)"
                    class="px-2 py-1 rounded text-[10px] font-mono font-semibold border transition-all cursor-pointer"
                    [class.bg-amber-500/20]="(device().power_on_behavior || 'previous') === 'previous'"
                    [class.text-amber-300]="(device().power_on_behavior || 'previous') === 'previous'"
                    [class.border-amber-500/40]="(device().power_on_behavior || 'previous') === 'previous'"
                    [class.bg-slate-900]="(device().power_on_behavior || 'previous') !== 'previous'"
                    [class.text-slate-400]="(device().power_on_behavior || 'previous') !== 'previous'"
                    [class.border-slate-800]="(device().power_on_behavior || 'previous') !== 'previous'"
                  >
                    Poprzedni
                  </button>
                  <button
                    (click)="setPowerOnBehavior('on', $event)"
                    class="px-2 py-1 rounded text-[10px] font-mono font-semibold border transition-all cursor-pointer"
                    [class.bg-emerald-500/20]="device().power_on_behavior === 'on'"
                    [class.text-emerald-300]="device().power_on_behavior === 'on'"
                    [class.border-emerald-500/40]="device().power_on_behavior === 'on'"
                    [class.bg-slate-900]="device().power_on_behavior !== 'on'"
                    [class.text-slate-400]="device().power_on_behavior !== 'on'"
                    [class.border-slate-800]="device().power_on_behavior !== 'on'"
                  >
                    Zawsze Włącz
                  </button>
                  <button
                    (click)="setPowerOnBehavior('off', $event)"
                    class="px-2 py-1 rounded text-[10px] font-mono font-semibold border transition-all cursor-pointer"
                    [class.bg-rose-500/20]="device().power_on_behavior === 'off'"
                    [class.text-rose-300]="device().power_on_behavior === 'off'"
                    [class.border-rose-500/40]="device().power_on_behavior === 'off'"
                    [class.bg-slate-900]="device().power_on_behavior !== 'off'"
                    [class.text-slate-400]="device().power_on_behavior !== 'off'"
                    [class.border-slate-800]="device().power_on_behavior !== 'off'"
                  >
                    Zawsze Wyłącz
                  </button>
                </div>
              </div>

              <!-- Ochrona przeciążeniowa (Overload Thresholds) -->
              <div class="grid grid-cols-2 gap-2 text-xs font-mono">
                <div>
                  <span class="text-slate-400 text-[10px] block mb-1">Próg mocy (max 7680 W):</span>
                  <div class="flex items-center gap-1">
                    <input
                      type="number"
                      min="500"
                      max="7680"
                      step="100"
                      [value]="device().overload_power_threshold || 7680"
                      (click)="$event.stopPropagation()"
                      (change)="setAdvancedAttr('overload_power_threshold', $any($event.target).value)"
                      class="w-full px-2 py-1 rounded bg-slate-900 border border-slate-800 text-white text-xs font-mono focus:border-amber-500 focus:outline-none"
                    />
                    <span class="text-slate-500 text-[10px]">W</span>
                  </div>
                </div>
                <div>
                  <span class="text-slate-400 text-[10px] block mb-1">Próg prądu (max 32 A):</span>
                  <div class="flex items-center gap-1">
                    <input
                      type="number"
                      min="1"
                      max="32"
                      step="1"
                      [value]="device().overload_current_threshold || 32"
                      (click)="$event.stopPropagation()"
                      (change)="setAdvancedAttr('overload_current_threshold', $any($event.target).value)"
                      class="w-full px-2 py-1 rounded bg-slate-900 border border-slate-800 text-white text-xs font-mono focus:border-amber-500 focus:outline-none"
                    />
                    <span class="text-slate-500 text-[10px]">A</span>
                  </div>
                </div>
              </div>

              <!-- Tryb Inching (Impulsowy) oraz Dioda LED -->
              <div class="grid grid-cols-2 gap-2 text-xs font-mono pt-1 border-t border-slate-800/60">
                <div>
                  <span class="text-slate-400 text-[10px] block mb-1">Tryb impulsowy (Inching s):</span>
                  <input
                    type="number"
                    min="0"
                    max="3600"
                    step="1"
                    [value]="device().inching_time || 0"
                    (click)="$event.stopPropagation()"
                    (change)="setInchingTime($any($event.target).value)"
                    placeholder="0 (wyłączony)"
                    class="w-full px-2 py-1 rounded bg-slate-900 border border-slate-800 text-white text-xs font-mono focus:border-amber-500 focus:outline-none"
                  />
                </div>
                <div>
                  <span class="text-slate-400 text-[10px] block mb-1">Dioda LED w szafie:</span>
                  <button
                    (click)="toggleNetworkIndicator($event)"
                    class="w-full px-2 py-1 rounded text-[10px] font-mono font-semibold border transition-all cursor-pointer"
                    [class.bg-cyan-500/20]="device().network_indicator !== false"
                    [class.text-cyan-300]="device().network_indicator !== false"
                    [class.border-cyan-500/40]="device().network_indicator !== false"
                    [class.bg-slate-900]="device().network_indicator === false"
                    [class.text-slate-500]="device().network_indicator === false"
                    [class.border-slate-800]="device().network_indicator === false"
                  >
                    {{ device().network_indicator !== false ? 'ŚWIECI (WŁ)' : 'TRYB NOCNY' }}
                  </button>
                </div>
              </div>
            </div>
          }
        </div>
      }

      <!-- Stopka kafelka: Znacznik czasu oraz jakość sygnału (LQI) -->
      <div class="flex items-center justify-between text-[11px] text-slate-400 pt-3 border-t border-slate-800/60">
        <div class="flex items-center gap-1.5" [title]="formattedAbsoluteTime()">
          <mat-icon class="text-xs text-slate-500 !w-3.5 !h-3.5">schedule</mat-icon>
          <span>{{ relativeTime() }}</span>
        </div>

        <div
          class="flex items-center gap-1"
          [title]="device().linkquality !== undefined && device().linkquality !== null ? 'Jakość połączenia radiowego Zigbee: ' + device().linkquality + ' LQI' : 'Brak danych LQI'"
        >
          @if (device().linkquality !== undefined && device().linkquality !== null) {
            <mat-icon class="text-xs !w-3.5 !h-3.5" [class]="lqiColorClass()">
              signal_cellular_alt
            </mat-icon>
            <span class="font-mono text-[10px] text-slate-400">
              {{ device().linkquality }} LQI
            </span>
          } @else {
            <span class="font-mono text-[10px] text-slate-500 italic">brak danych</span>
          }
        </div>
      </div>
    </div>
  `,
})
export class DeviceCard {
  readonly device = input.required<Device>();
  readonly tempRank = input<'max' | 'min' | null>(null);
  readonly cardClicked = output<Device>();
  readonly renameRequested = output<Device>();
  readonly commandRequested = output<{ device: Device; command: Record<string, unknown> }>();
  readonly tuyaQrRequested = output<Device>();

  readonly showAdvanced = signal<boolean>(false);
  readonly showSchedule = signal<boolean>(false);

  readonly localKeyLast4 = computed(() => {
    const k = this.device().local_key;
    if (!k) return '';
    return k.length > 4 ? k.slice(-4) : k;
  });

  openTuyaQr(event: MouseEvent): void {
    event.stopPropagation();
    this.tuyaQrRequested.emit(this.device());
  }

  readonly isAlarmActive = computed(() => {
    const d = this.device();
    const cat = this.category();
    if (cat === 'sensor' || cat === 'climate') {
      if (!d.temp_alarm_enabled || d.last_temperature === null || d.last_temperature === undefined) return false;
      const minT = d.temp_alarm_min ?? 16.0;
      const maxT = d.temp_alarm_max ?? 28.0;
      return d.last_temperature < minT || d.last_temperature > maxT;
    }
    if (cat === 'occupancy') {
      return !!(d.motion_alarm_enabled && d.occupancy);
    }
    if (cat === 'contact') {
      return !!(d.contact_alarm_enabled && d.contact === false);
    }
    if (cat === 'water_leak') {
      return !!(d.water_alarm_enabled && d.water_leak);
    }
    if (cat === 'smoke') {
      return !!d.smoke_alarm;
    }
    return false;
  });

  readonly isSmokeAlarm = computed(() => {
    const d = this.device();
    return !!(d.smoke_alarm || d.smoke_status === 'alarm');
  });

  silenceSmokeAlarm(event: MouseEvent): void {
    event.stopPropagation();
    this.commandRequested.emit({
      device: this.device(),
      command: { smoke_mute: true, silence: true },
    });
  }

  testSmokeAlarm(event: MouseEvent): void {
    event.stopPropagation();
    this.commandRequested.emit({
      device: this.device(),
      command: { smoke_test: true },
    });
  }

  toggleAlarmState(feature: string, event: MouseEvent): void {
    event.stopPropagation();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentVal = Boolean((this.device() as any)[feature]);
    this.commandRequested.emit({
      device: this.device(),
      command: { [feature]: !currentVal },
    });
  }

  readonly daysOfWeek = [
    { key: 'monday', label: 'Poniedziałek' },
    { key: 'tuesday', label: 'Wtorek' },
    { key: 'wednesday', label: 'Środa' },
    { key: 'thursday', label: 'Czwartek' },
    { key: 'friday', label: 'Piątek' },
    { key: 'saturday', label: 'Sobota' },
    { key: 'sunday', label: 'Niedziela' },
  ];

  toggleAdvanced(event: MouseEvent): void {
    event.stopPropagation();
    this.showAdvanced.set(!this.showAdvanced());
  }

  toggleSchedule(event: MouseEvent): void {
    event.stopPropagation();
    this.showSchedule.set(!this.showSchedule());
  }

  getWeeklySchedule(dayKey: string): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dev = this.device() as any;
    return dev[`weekly_schedule_${dayKey}`] ?? '00:00/20.0';
  }

  setAdvancedAttr(attr: string, value: unknown): void {
    const parsedValue = typeof value === 'string' && !isNaN(Number(value)) ? Number(value) : value;
    this.commandRequested.emit({
      device: this.device(),
      command: { [attr]: parsedValue }
    });
  }

  readonly isWifiDevice = computed<boolean>(() => {
    const d = this.device();
    if (d.protocol === 'wifi') return true;
    if (d.ieee_address?.startsWith('wifi_')) return true;
    const v = (d.vendor || '').toLowerCase();
    const m = (d.model || '').toLowerCase();
    const f = (d.friendly_name || '').toLowerCase();
    return v.includes('wi-fi') || v.includes('wifi') || m.includes('wi-fi') || m.includes('wifi') || f.includes('(wi-fi)') || f.includes('wifi');
  });

  readonly deviceIpAddress = computed<string | null>(() => {
    const d = this.device();
    if (d.ip_address) return d.ip_address;
    if (d.ieee_address?.startsWith('wifi_')) {
      return d.ieee_address.replace('wifi_', '').replace(/_/g, '.');
    }
    return null;
  });

  readonly category = computed<DeviceCategory>(() => {
    const d = this.device();
    if (d.category) return d.category;
    const m = (d.model || '').toLowerCase();
    const f = (d.friendly_name || '').toLowerCase();

    if (f.includes('czujnik c') || f.includes('czujnik temp') || f.includes('temperatura') || f.includes('wilgotn') || m.includes('snzb-02d') || m.includes('snzb-02')) return 'sensor';
    if (m.includes('smoke') || m.includes('dym') || m.includes('pozar') || m.includes('pożar') || f.includes('smoke') || f.includes('dym') || d.smoke_alarm !== undefined) return 'smoke';
    if (m.includes('gow') || m.includes('gow 007') || m.includes('fan') || m.includes('wentylator') || f.includes('wentylator') || f.includes('fan') || d.fan_speed !== undefined) return 'fan';
    if (m.includes('trv') || m.includes('thermostat') || m.includes('termostat') || m.includes('sonoff trvzb') || f.includes('termostat') || f.includes('glowica') || f.includes('głowica') || (f.includes('grzejnik') && !f.includes('czujnik')) || d.occupied_heating_setpoint !== undefined) return 'climate';
    if (m.includes('plug') || m.includes('s26') || m.includes('s40') || m.includes('s31') || m.includes('ts011f') || f.includes('gniazdko') || f.includes('plug') || (d.power !== undefined && !m.includes('basic') && !m.includes('zb1gsp'))) return 'plug';
    if (m.includes('basic') || m.includes('zb1gsp') || m.includes('mini') || m.includes('zbmini') || m.includes('switch') || m.includes('relay') || f.includes('basic') || f.includes('zb1gsp') || f.includes('włącznik') || f.includes('wlacznik') || f.includes('przełącznik') || f.includes('przelacznik') || (d.state !== undefined && (d.power === undefined || m.includes('basic') || m.includes('zb1gsp')))) return 'switch';
    if (m.includes('snzb-04') || m.includes('contact') || m.includes('door') || f.includes('drzwi') || f.includes('okno') || f.includes('otwarcie') || f.includes('kontaktron') || d.contact !== undefined) return 'contact';
    if (m.includes('snzb-03') || m.includes('motion') || m.includes('pir') || m.includes('presence') || m.includes('occupancy') || f.includes('ruch') || f.includes('ruchu') || f.includes('obecno') || f.includes('korytarz') || f.includes('góra') || f.includes('gora') || d.occupancy !== undefined) return 'occupancy';
    if (m.includes('snzb-05') || m.includes('water') || m.includes('leak') || f.includes('zalani') || f.includes('woda') || d.water_leak !== undefined) return 'water_leak';
    return 'sensor';
  });

  readonly isBasicZb1gsp = computed<boolean>(() => {
    const d = this.device();
    const m = (d.model || '').toLowerCase();
    const f = (d.friendly_name || '').toLowerCase();
    return m.includes('zb1gsp') || m.includes('basic-zb1') || f.includes('zb1gsp') || f.includes('basic-zb1');
  });

  readonly isHighPowerSwitch = computed<boolean>(() => {
    const d = this.device();
    if (this.isBasicZb1gsp()) return true;
    return this.category() === 'switch' && (d.power !== undefined || d.voltage !== undefined || d.current !== undefined || d.energy !== undefined);
  });

  readonly currentLoadPercent = computed<number>(() => {
    const c = this.device().current ?? 0;
    const maxA = this.device().overload_current_threshold ?? 32;
    return Math.min(100, Math.max(0, Math.round((c / maxA) * 100)));
  });

  readonly isOverloadWarning = computed<boolean>(() => {
    const d = this.device();
    const p = d.power ?? 0;
    const pMax = d.overload_power_threshold ?? 7680;
    const c = d.current ?? 0;
    const cMax = d.overload_current_threshold ?? 32;
    return (p > 0 && p >= pMax * 0.9) || (c > 0 && c >= cMax * 0.9);
  });

  readonly categoryBadgeLabel = computed(() => {
    switch (this.category()) {
      case 'smoke':
        return 'Czujka Dymu Wi-Fi';
      case 'fan':
        return 'Wentylator 7w1';
      case 'climate':
        return 'Głowica TRVZB';
      case 'plug':
        return 'Gniazdko 16A';
      case 'switch':
        if (this.isBasicZb1gsp()) return 'Przekaźnik DIN 32A';
        return 'Wyłącznik';
      case 'contact':
        return 'Kontaktron';
      case 'occupancy':
        return 'Obecność / PIR';
      case 'water_leak':
        return 'Czujnik Zalania';
      default:
        return 'Sensor Temp/Wilg';
    }
  });

  readonly categoryBadgeClass = computed(() => {
    switch (this.category()) {
      case 'smoke':
        return 'bg-red-500/10 text-red-400 border-red-500/30';
      case 'fan':
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      case 'climate':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'plug':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'switch':
        if (this.isBasicZb1gsp()) return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      case 'contact':
        return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
      case 'occupancy':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'water_leak':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      default:
        return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  });

  readonly isStateOn = computed(() => {
    const s = this.device().state;
    return s === 'ON' || s === 'true' || s === '1';
  });

  readonly setpointTemp = computed(() => {
    const s = this.device().current_heating_setpoint;
    return s !== undefined && s !== null ? s.toFixed(1) : '21.0';
  });

  readonly measuredTemp = computed(() => {
    const t = this.device().local_temperature ?? this.device().last_temperature;
    return t !== undefined && t !== null ? t.toFixed(1) : 'brak danych';
  });

  readonly hasTemp = computed(() => {
    const t = this.device().last_temperature;
    return t !== undefined && t !== null;
  });

  readonly hasHum = computed(() => {
    const h = this.device().last_humidity;
    return h !== undefined && h !== null;
  });

  readonly formattedTemp = computed(() => {
    const t = this.device().last_temperature;
    return t !== undefined && t !== null ? t.toFixed(1) : 'brak danych';
  });

  readonly formattedHum = computed(() => {
    const h = this.device().last_humidity;
    return h !== undefined && h !== null ? h.toFixed(1) : 'brak danych';
  });

  readonly batteryIcon = computed(() => {
    const b = this.device().battery;
    if (b === undefined || b === null) return 'battery_unknown';
    if (b > 80) return 'battery_full';
    if (b > 50) return 'battery_5_bar';
    if (b > 25) return 'battery_3_bar';
    return 'battery_alert';
  });

  readonly batteryColorClass = computed(() => {
    const b = this.device().battery;
    if (b === undefined || b === null) return 'text-slate-500';
    if (b > 60) return 'text-emerald-400';
    if (b > 25) return 'text-amber-400';
    return 'text-rose-400 animate-pulse';
  });

  readonly lqiColorClass = computed(() => {
    const lqi = this.device().linkquality ?? 0;
    if (lqi > 100) return 'text-emerald-400';
    if (lqi > 50) return 'text-cyan-400';
    return 'text-amber-400';
  });

  readonly formattedAbsoluteTime = computed(() => {
    const dateStr = this.device().last_seen;
    if (!dateStr) return 'Brak zarejestrowanej transmisji';
    return `Ostatnia transmisja: ${formatEuropeanDateTime(dateStr, true)}`;
  });

  readonly relativeTime = computed(() => {
    const dateStr = this.device().last_seen;
    if (!dateStr) return 'brak danych';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;

    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diffSec < 15) return 'przed chwilą';
    if (diffSec < 60) return `${diffSec} sek temu`;
    const min = Math.floor(diffSec / 60);
    if (min === 1) return '1 minutę temu';
    if (min < 5) return `${min} minuty temu`;
    if (min < 60) return `${min} minut temu`;
    const h = Math.floor(min / 60);
    if (h === 1) return '1 godzinę temu';
    if (h < 5) return `${h} godziny temu`;
    if (h < 24) return `${h} godzin temu`;
    if (diffSec < 86400 * 2) return `Wczoraj (${format24hTime(d)})`;
    return formatEuropeanDate(d);
  });

  onRenameClick(event: MouseEvent): void {
    event.stopPropagation();
    this.renameRequested.emit(this.device());
  }

  togglePowerState(event: MouseEvent): void {
    event.stopPropagation();
    const nextState = this.isStateOn() ? 'OFF' : 'ON';
    this.commandRequested.emit({
      device: this.device(),
      command: { state: nextState },
    });
  }

  adjustSetpoint(delta: number, event: MouseEvent): void {
    event.stopPropagation();
    const current = this.device().current_heating_setpoint ?? 21.0;
    const next = Math.min(30, Math.max(5, parseFloat((current + delta).toFixed(1))));
    this.commandRequested.emit({
      device: this.device(),
      command: { current_heating_setpoint: next },
    });
  }

  setSystemMode(mode: 'heat' | 'auto' | 'off', event: MouseEvent): void {
    event.stopPropagation();
    this.commandRequested.emit({
      device: this.device(),
      command: { system_mode: mode },
    });
  }

  toggleChildLock(event: MouseEvent): void {
    event.stopPropagation();
    const nextLock = this.device().child_lock === 'LOCK' ? 'UNLOCK' : 'LOCK';
    this.commandRequested.emit({
      device: this.device(),
      command: { child_lock: nextLock },
    });
  }

  adjustFanSpeed(delta: number, event: MouseEvent): void {
    event.stopPropagation();
    const current = Number(this.device().fan_speed ?? 1);
    const next = Math.min(12, Math.max(1, current + delta));
    this.commandRequested.emit({
      device: this.device(),
      command: { fan_speed: next, state: 'ON' },
    });
  }

  toggleFanFeature(feature: 'fan_oscillation' | 'fan_ionizer' | 'fan_humidifier' | 'fan_uv', event: MouseEvent): void {
    event.stopPropagation();
    const currentVal = Boolean(this.device()[feature]);
    this.commandRequested.emit({
      device: this.device(),
      command: { [feature]: !currentVal },
    });
  }

  setPowerOnBehavior(behavior: 'previous' | 'on' | 'off', event: MouseEvent): void {
    event.stopPropagation();
    this.commandRequested.emit({
      device: this.device(),
      command: { power_on_behavior: behavior },
    });
  }

  setInchingTime(timeSec: string | number): void {
    const parsed = Number(timeSec) || 0;
    this.commandRequested.emit({
      device: this.device(),
      command: {
        inching_time: parsed,
        inching_mode: parsed > 0,
      },
    });
  }

  toggleNetworkIndicator(event: MouseEvent): void {
    event.stopPropagation();
    const current = this.device().network_indicator !== false;
    this.commandRequested.emit({
      device: this.device(),
      command: { network_indicator: !current },
    });
  }
}
