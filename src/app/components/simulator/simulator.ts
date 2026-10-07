import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Telemetry } from '../../services/telemetry';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-simulator',
  imports: [MatIconModule],
  template: `
    <div class="space-y-6">
      <div class="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 class="text-lg font-bold text-white flex items-center gap-2">
            <mat-icon class="text-cyan-400">tune</mat-icon>
            Konsola wstrzykiwania telemetrii & Testów laboratoryjnych
          </h2>
          <p class="text-xs text-slate-400 mt-1 max-w-2xl">
            Pozwala symulować nadejście surowych ramek ZCL z czujnika lub komunikatów MQTT z Zigbee2MQTT, aby przetestować działanie bazy danych, animacji pulsu kafelków i alarmów w aplikacji Android.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            (click)="resetSystemData()"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-950/80 hover:bg-rose-900 border border-rose-800 text-rose-300 text-xs font-semibold transition-colors cursor-pointer"
            title="Czyści całą pamięć telemetryczną i powiadomienia, przywracając czysty stan zerowy"
          >
            <mat-icon class="text-sm !w-4 !h-4">delete_sweep</mat-icon>
            <span>Wyczyść wszystkie dane (Reset do: brak danych)</span>
          </button>
        </div>
      </div>

      <!-- Presety testowe -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <button
          (click)="injectPreset('overheat')"
          class="p-3.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-rose-700/80 text-left transition-all group"
        >
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-xs font-bold text-white group-hover:text-rose-400 transition-colors">Alarm: Przegrzanie</span>
            <mat-icon class="text-rose-400 text-sm !w-4 !h-4">local_fire_department</mat-icon>
          </div>
          <p class="text-[11px] text-slate-400">
            Wstrzyknij 32.8°C do Serwerowni (wywoła alert w Androidzie).
          </p>
        </button>

        <button
          (click)="injectPreset('freeze')"
          class="p-3.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-cyan-700/80 text-left transition-all group"
        >
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-xs font-bold text-white group-hover:text-cyan-400 transition-colors">Alarm: Mróz</span>
            <mat-icon class="text-cyan-400 text-sm !w-4 !h-4">ac_unit</mat-icon>
          </div>
          <p class="text-[11px] text-slate-400">
            Wstrzyknij -4.5°C na Taras Zewnętrzny (spadek poniżej normy).
          </p>
        </button>

        <button
          (click)="injectPreset('low_battery')"
          class="p-3.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-amber-700/80 text-left transition-all group"
        >
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-xs font-bold text-white group-hover:text-amber-400 transition-colors">Alert: Bateria &lt; 15% (11%)</span>
            <mat-icon class="text-amber-400 text-sm !w-4 !h-4">battery_alert</mat-icon>
          </div>
          <p class="text-[11px] text-slate-400">
            Wstrzyknij 11% baterii do czujnika (uruchamia system powiadomień REST API & WebSocket).
          </p>
        </button>

        <button
          (click)="injectPreset('new_sensor')"
          class="p-3.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-emerald-700/80 text-left transition-all group"
        >
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-xs font-bold text-white group-hover:text-emerald-400 transition-colors">Nowy czujnik</span>
            <mat-icon class="text-emerald-400 text-sm !w-4 !h-4">add_circle</mat-icon>
          </div>
          <p class="text-[11px] text-slate-400">
            Zasymuluj sparowanie nowego urządzenia z donglem Sonoff.
          </p>
        </button>

        <button
          (click)="injectPreset('null_data_sensor')"
          class="p-3.5 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-600 text-left transition-all group"
        >
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-xs font-bold text-white group-hover:text-slate-300 transition-colors">Test: Brak danych</span>
            <mat-icon class="text-slate-400 text-sm !w-4 !h-4">help_outline</mat-icon>
          </div>
          <p class="text-[11px] text-slate-400">
            Dodaj czujnik bez żadnych pomiarów (weryfikacja stanu "brak danych").
          </p>
        </button>
      </div>

      <!-- Panel manualnej kontroli -->
      <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800">
        <h3 class="text-sm font-bold text-white mb-4 flex items-center gap-2">
          <mat-icon class="text-cyan-400 text-base">tune</mat-icon>
          Ręczne definiowanie parametrów ramki
        </h3>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
          <!-- Wybór urządzenia -->
          <div>
            <label for="targetSensorSelect" class="block text-xs font-medium text-slate-400 mb-1.5">Docelowy czujnik (IEEE)</label>
            <select
              id="targetSensorSelect"
              #targetSelect
              class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:outline-none focus:border-cyan-500"
            >
              @for (d of telemetry.devices(); track d.ieee_address) {
                <option [value]="d.ieee_address">{{ d.friendly_name }} ({{ d.ieee_address }})</option>
              }
            </select>
          </div>

          <!-- Temperatura -->
          <div>
            <div class="flex items-center justify-between text-xs font-medium text-slate-400 mb-1.5">
              <span>Temperatura (°C)</span>
              <span class="font-mono text-cyan-400">{{ manualTemp() }} °C</span>
            </div>
            <input
              type="range"
              min="-10"
              max="45"
              step="0.5"
              [value]="manualTemp()"
              (input)="updateManualTemp($event)"
              class="w-full accent-cyan-500 cursor-pointer"
            />
          </div>

          <!-- Wilgotność -->
          <div>
            <div class="flex items-center justify-between text-xs font-medium text-slate-400 mb-1.5">
              <span>Wilgotność (%)</span>
              <span class="font-mono text-blue-400">{{ manualHum() }} %</span>
            </div>
            <input
              type="range"
              min="10"
              max="99"
              step="1"
              [value]="manualHum()"
              (input)="updateManualHum($event)"
              class="w-full accent-blue-500 cursor-pointer"
            />
          </div>

          <!-- Bateria -->
          <div>
            <div class="flex items-center justify-between text-xs font-medium text-slate-400 mb-1.5">
              <span>Bateria (%)</span>
              <span class="font-mono text-emerald-400">{{ manualBat() }} %</span>
            </div>
            <input
              type="range"
              min="5"
              max="100"
              step="5"
              [value]="manualBat()"
              (input)="updateManualBat($event)"
              class="w-full accent-emerald-500 cursor-pointer"
            />
          </div>
        </div>

        <div class="flex items-center justify-between pt-4 border-t border-slate-800/80">
          <span class="text-xs text-slate-500 font-mono">
            Payload: &#123; "temperature": {{ manualTemp() }}, "humidity": {{ manualHum() }}, "battery": {{ manualBat() }} &#125;
          </span>
          <button
            (click)="sendManualPacket(targetSelect.value)"
            class="flex items-center gap-2 px-5 py-2.5 text-xs font-bold rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-900/30 transition-all cursor-pointer"
          >
            <mat-icon class="text-sm !w-4 !h-4">send</mat-icon>
            <span>Wyślij ramkę do systemu</span>
          </button>
        </div>
      </div>
    </div>
  `,
})
export class Simulator {
  readonly telemetry = inject(Telemetry);

  readonly manualTemp = signal<number>(23.5);
  readonly manualHum = signal<number>(52.0);
  readonly manualBat = signal<number>(85);

  updateManualTemp(e: Event): void {
    this.manualTemp.set(parseFloat((e.target as HTMLInputElement).value));
  }

  updateManualHum(e: Event): void {
    this.manualHum.set(parseFloat((e.target as HTMLInputElement).value));
  }

  updateManualBat(e: Event): void {
    this.manualBat.set(parseInt((e.target as HTMLInputElement).value, 10));
  }

  sendManualPacket(ieee: string): void {
    if (!ieee) return;
    this.telemetry.simulatePacket({
      device_ieee: ieee,
      temperature: this.manualTemp(),
      humidity: this.manualHum(),
      battery: this.manualBat(),
      linkquality: 110,
    }).subscribe();
  }

  resetSystemData(): void {
    this.telemetry.resetAllData();
  }

  injectPreset(preset: 'overheat' | 'freeze' | 'low_battery' | 'new_sensor' | 'null_data_sensor'): void {
    if (preset === 'overheat') {
      this.telemetry.simulatePacket({
        device_ieee: '0x00124b0028e34c56',
        temperature: 33.2,
        humidity: 34.0,
        battery: 74,
        linkquality: 130,
      }).subscribe();
    } else if (preset === 'freeze') {
      this.telemetry.simulatePacket({
        device_ieee: '0x00158d0006f120aa',
        temperature: -3.8,
        humidity: 82.0,
        battery: 38,
        linkquality: 65,
      }).subscribe();
    } else if (preset === 'low_battery') {
      this.telemetry.simulatePacket({
        device_ieee: '0xa4c138290fa8b742',
        temperature: 21.0,
        humidity: 62.0,
        battery: 11,
        linkquality: 70,
      }).subscribe();
    } else if (preset === 'new_sensor') {
      const randomHex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
      const newIeee = `0x00124b00${randomHex}`;
      this.telemetry.simulatePacket({
        device_ieee: newIeee,
        temperature: 21.8,
        humidity: 49.5,
        battery: 88,
        linkquality: 125,
      }).subscribe();
    } else if (preset === 'null_data_sensor') {
      const randomHex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
      const newIeee = `0x00124b00${randomHex}`;
      // Wstrzykujemy czujnik z wartościami null (sprawdzenie stanu "brak danych")
      this.telemetry.simulatePacket({
        device_ieee: newIeee,
        temperature: null,
        humidity: null,
        battery: null,
        linkquality: null,
      }).subscribe();
    }
  }
}
