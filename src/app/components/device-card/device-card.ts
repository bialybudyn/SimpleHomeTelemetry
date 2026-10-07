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
      class="group relative bg-slate-900/90 hover:bg-slate-900 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-5 transition-all duration-200 cursor-pointer shadow-md hover:shadow-xl hover:shadow-cyan-950/20 focus:outline-none focus:border-cyan-500"
      [class.telemetry-updated]="device().isRecentlyUpdated"
    >
      <!-- Górny wiersz: Badge Kategorii, Nazwa, Zmiana Nazwy oraz Bateria / Zasilanie -->
      <div class="flex items-start justify-between gap-3 mb-3.5">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 mb-1">
            <span
              class="text-[10px] font-mono uppercase px-2 py-0.5 rounded-md font-semibold tracking-wide border"
              [class]="categoryBadgeClass()"
            >
              {{ categoryBadgeLabel() }}
            </span>
            @if (device().vendor) {
              <span class="text-[10px] font-mono text-slate-500">
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
          <div class="text-[11px] font-mono text-slate-500 truncate mt-0.5">
            {{ device().model }}
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

      <!-- 3. WYŁĄCZNIK / PRZEKAŹNIK (Sonoff ZBMINIR2 / ZBMINI / Tuya Switch) -->
      @else if (category() === 'switch') {
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

      <!-- 7. STANDARDOWY CZUJNIK TEMPERATURY I WILGOTNOŚCI (SNZB-02D / LCD) -->
      @else {
        <div class="grid grid-cols-2 gap-3 mb-4">
          <!-- Kafelek Temperatura -->
          <div class="p-3 rounded-xl bg-slate-950/80 border border-slate-800/80">
            <div class="flex items-center gap-1 text-[11px] font-medium text-slate-400 mb-1">
              <mat-icon class="text-cyan-400 text-xs !w-3.5 !h-3.5">thermostat</mat-icon>
              <span>Temperatura</span>
            </div>
            <div class="flex items-baseline gap-1">
              @if (hasTemp()) {
                <span class="text-2xl font-bold font-mono text-white tabular-nums tracking-tight">
                  {{ formattedTemp() }}
                </span>
                <span class="text-xs font-mono text-cyan-400">°C</span>
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
        </div>
      }

      <!-- Stopka kafelka: Znacznik czasu oraz jakość sygnału (LQI) -->
      <div class="flex items-center justify-between text-[11px] text-slate-400 pt-3 border-t border-slate-800/60">
        <div class="flex items-center gap-1.5">
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
  readonly cardClicked = output<Device>();
  readonly renameRequested = output<Device>();
  readonly commandRequested = output<{ device: Device; command: Record<string, unknown> }>();

  readonly showAdvanced = signal<boolean>(false);
  readonly showSchedule = signal<boolean>(false);

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
    return false;
  });

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

  readonly category = computed<DeviceCategory>(() => {
    const d = this.device();
    if (d.category) return d.category;
    const m = (d.model || '').toLowerCase();
    if (m.includes('gow') || m.includes('gow 007') || m.includes('fan') || m.includes('wentylator') || d.fan_speed !== undefined) return 'fan';
    if (m.includes('trv') || m.includes('thermostat') || d.current_heating_setpoint !== undefined) return 'climate';
    if (m.includes('plug') || m.includes('s26') || m.includes('s40') || m.includes('s31') || m.includes('ts011f') || d.power !== undefined) return 'plug';
    if (m.includes('mini') || m.includes('zbmini') || m.includes('switch') || m.includes('relay') || (d.state !== undefined && d.power === undefined)) return 'switch';
    if (m.includes('snzb-04') || m.includes('contact') || d.contact !== undefined) return 'contact';
    if (m.includes('snzb-03') || m.includes('motion') || m.includes('pir') || d.occupancy !== undefined) return 'occupancy';
    if (m.includes('snzb-05') || m.includes('water') || d.water_leak !== undefined) return 'water_leak';
    return 'sensor';
  });

  readonly categoryBadgeLabel = computed(() => {
    switch (this.category()) {
      case 'fan':
        return 'Wentylator 7w1';
      case 'climate':
        return 'Głowica TRVZB';
      case 'plug':
        return 'Gniazdko 16A';
      case 'switch':
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
      case 'fan':
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
      case 'climate':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'plug':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'switch':
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
    return `${Math.floor(h / 24)} dni temu`;
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
}
