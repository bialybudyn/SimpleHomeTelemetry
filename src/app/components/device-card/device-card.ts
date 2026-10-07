import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Device } from '../../models/telemetry.models';

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
      <!-- Górny wiersz: Nazwa, Adres IEEE oraz Bateria -->
      <div class="flex items-start justify-between gap-3 mb-4">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <h3 class="text-sm font-bold text-white truncate group-hover:text-cyan-300 transition-colors">
              {{ device().friendly_name || device().ieee_address }}
            </h3>
            <button
              (click)="onRenameClick($event)"
              class="text-slate-500 hover:text-cyan-400 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
              title="Zmień nazwę"
            >
              <mat-icon class="text-xs !w-3.5 !h-3.5">edit</mat-icon>
            </button>
          </div>
          <div class="text-[11px] font-mono text-slate-500 truncate mt-0.5">
            {{ device().ieee_address }}
          </div>
        </div>

        <!-- Wskaźnik zasilania (Bateria) -->
        <div
          class="flex items-center gap-1 text-xs font-mono shrink-0 px-2 py-1 rounded-md bg-slate-950/80 border border-slate-800"
          [title]="device().battery !== undefined && device().battery !== null ? 'Poziom naładowania baterii: ' + device().battery + '%' : 'Brak danych o baterii'"
        >
          <mat-icon class="text-sm !w-4 !h-4" [class]="batteryColorClass()">
            {{ batteryIcon() }}
          </mat-icon>
          <span class="tabular-nums font-semibold" [class]="batteryColorClass()">
            {{ device().battery !== undefined && device().battery !== null ? device().battery + '%' : 'brak danych' }}
          </span>
        </div>
      </div>

      <!-- Pomiary główne: Duża temperatura i wilgotność -->
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
}
