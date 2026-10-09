import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Device, HistoryResponse, HistoryStats, TelemetryPoint } from '../../models/telemetry.models';
import { Telemetry } from '../../services/telemetry';
import { Chart, ChartDataset, registerables } from 'chart.js';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { formatEuropeanDateTime, formatChartTimeLabel } from '../../utils/date-format';

export interface DeviceHistoryData {
  device: Device;
  history: TelemetryPoint[];
  stats: HistoryStats | null;
}

export interface MergedBinaryEvent {
  id: string | number;
  timestamp: string;
  device_ieee: string;
  device_name: string;
  category: string;
  event_type: 'motion_detected' | 'motion_clear' | 'contact_opened' | 'contact_closed' | 'water_leak_detected' | 'water_leak_dry';
  event_label: string;
  battery: number | null;
  linkquality: number | null;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-analytics-view',
  imports: [MatIconModule],
  template: `
    <div class="space-y-6">
      <!-- Pasek nagłówka sekcji analityki -->
      <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-950/60 border border-cyan-800/80 text-cyan-400 text-xs font-mono mb-2">
            <mat-icon class="text-sm !w-4 !h-4">{{ hasBinarySensors() ? 'list_alt' : 'insights' }}</mat-icon>
            <span>{{ hasBinarySensors() ? 'Dziennik Zdarzeń Sensorów Binarnych · Wielourządzeniowa Oś Czasu' : 'Chart.js · SQLite Dynamic Downsampling' }}</span>
          </div>
          <h2 class="text-xl font-bold text-white tracking-tight">
            {{ hasBinarySensors() ? 'Chronologiczny dziennik zdarzeń sensorów (detekcja, otwarcie, zalanie)' : 'Wielozakresowa analityka trendów środowiskowych' }}
          </h2>
          <p class="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
            @if (hasBinarySensors()) {
              Zunifikowany, chronologiczny rejestr zdarzeń z wielu wybranych czujników (ruch, kontaktrony, zalanie) z precyzyjnym timestampem. Brak syntetycznych danych.
            } @else {
              Przebiegi parametrów z bazy SQLite z automatyczną agregacją dla długich okresów (6h, 24h, 7 dni, 30 dni, 90 dni, 360 dni, 720 dni). Możesz porównywać wiele czujników na jednym wykresie.
            }
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            (click)="exportToCsv()"
            [disabled]="totalRecordsCount() === 0"
            class="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white border border-slate-700 transition-colors cursor-pointer"
          >
            <mat-icon class="text-sm !w-4 !h-4">download</mat-icon>
            <span>Eksportuj CSV</span>
          </button>
        </div>
      </div>

      <!-- Wybór czujników (Multi-select) i zakresu czasowego -->
      <div class="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <!-- Etykieta i przyciski szybkiego zaznaczania -->
          <div class="flex items-center gap-3">
            <span class="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <mat-icon class="text-sm text-cyan-400 !w-4 !h-4">checklist</mat-icon>
              Wybór czujników (Multi-select):
            </span>
            <div class="inline-flex gap-1.5">
              <button
                type="button"
                (click)="selectAllSensors()"
                class="px-2.5 py-1 text-[11px] rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition-colors cursor-pointer"
              >
                Zaznacz wszystkie
              </button>
              <button
                type="button"
                (click)="selectOnlyBinarySensors()"
                class="px-2.5 py-1 text-[11px] rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 transition-colors cursor-pointer"
              >
                Tylko binarne (ruch/drzwi/zalanie)
              </button>
              <button
                type="button"
                (click)="selectOnlyEnvSensors()"
                class="px-2.5 py-1 text-[11px] rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700 transition-colors cursor-pointer"
              >
                Tylko temp/wilg
              </button>
              <button
                type="button"
                (click)="clearAllSensors()"
                class="px-2.5 py-1 text-[11px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700 transition-colors cursor-pointer"
              >
                Wyczyść
              </button>
            </div>
          </div>

          <!-- Przełącznik zakresów czasowych (6h, 24h, 7d, 30d, 90d, 360d, 720d) -->
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs font-medium text-slate-400 mr-1">Przedział:</span>
            <div class="inline-flex rounded-xl bg-slate-950 border border-slate-800 p-1 gap-1 text-xs font-mono">
              @for (r of ranges; track r.key) {
                <button
                  (click)="setRange(r.key)"
                  class="px-3 py-1.5 rounded-lg transition-all whitespace-nowrap cursor-pointer"
                  [class.bg-cyan-600]="activeRange() === r.key"
                  [class.text-white]="activeRange() === r.key"
                  [class.font-bold]="activeRange() === r.key"
                  [class.shadow-md]="activeRange() === r.key"
                  [class.shadow-cyan-900/30]="activeRange() === r.key"
                  [class.text-slate-400]="activeRange() !== r.key"
                  [class.hover:text-white]="activeRange() !== r.key"
                >
                  {{ r.label }}
                </button>
              }
            </div>
          </div>
        </div>

        <!-- Lista chipów / kafelków czujników do zaznaczania -->
        <div class="flex flex-wrap gap-2 pt-2 border-t border-slate-800/80">
          @for (dev of telemetry.devices(); track dev.ieee_address) {
            @let isSelected = selectedIeees().includes(dev.ieee_address);
            @let devCat = getDeviceCategory(dev);
            @let isBin = isBinaryCategory(devCat);
            <button
              type="button"
              (click)="toggleSensor(dev.ieee_address)"
              class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-mono border transition-all cursor-pointer"
              [class.bg-cyan-950/80]="isSelected && !isBin"
              [class.border-cyan-500]="isSelected && !isBin"
              [class.text-cyan-200]="isSelected && !isBin"
              [class.bg-amber-950/80]="isSelected && isBin"
              [class.border-amber-500]="isSelected && isBin"
              [class.text-amber-200]="isSelected && isBin"
              [class.bg-slate-950]="!isSelected"
              [class.border-slate-800]="!isSelected"
              [class.text-slate-400]="!isSelected"
              [class.hover:border-slate-700]="!isSelected"
              [class.hover:text-slate-200]="!isSelected"
            >
              <mat-icon class="text-sm !w-4 !h-4">
                {{ isSelected ? 'check_box' : 'check_box_outline_blank' }}
              </mat-icon>
              <mat-icon class="text-xs !w-3.5 !h-3.5" [class.text-amber-400]="isBin" [class.text-cyan-400]="!isBin">
                {{ getDeviceIcon(dev, devCat) }}
              </mat-icon>
              <span class="font-medium text-slate-200">{{ dev.friendly_name }}</span>
              <span class="text-[10px] opacity-75">
                @if (isBin) {
                  [{{ devCat === 'occupancy' ? 'Ruch' : (devCat === 'contact' ? 'Drzwi' : 'Zalanie') }}]
                } @else if (dev.last_temperature !== undefined && dev.last_temperature !== null) {
                  [{{ dev.last_temperature }}°C]
                }
              </span>
            </button>
          }
        </div>
      </div>

      <!-- KAFELKI PODSUMOWANIA WYBRANYCH CZUJNIKÓW -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div class="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span>Wybrane czujniki</span>
            <mat-icon class="text-cyan-400 text-sm !w-4 !h-4">sensors</mat-icon>
          </div>
          <div class="text-2xl font-bold font-mono text-cyan-400 tabular-nums">
            {{ selectedIeees().length }}
          </div>
          <div class="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-800/80">
            Binarne: {{ binarySelectedCount() }} · Środowiskowe: {{ envSelectedCount() }}
          </div>
        </div>

        <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div class="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span>Zdarzenia binarne (Oś czasu)</span>
            <mat-icon class="text-amber-400 text-sm !w-4 !h-4">history_toggle_off</mat-icon>
          </div>
          <div class="text-2xl font-bold font-mono text-amber-400 tabular-nums">
            {{ mergedBinaryEvents().length }}
          </div>
          <div class="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-800/80">
            Ruch: {{ totalMotionEvents() }} · Otwarcia: {{ totalOpenEvents() }} · Zalania: {{ totalLeakEvents() }}
          </div>
        </div>

        <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div class="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span>Ostatnie zdarzenie binarne</span>
            <mat-icon class="text-slate-400 text-sm !w-4 !h-4">schedule</mat-icon>
          </div>
          <div class="text-sm font-bold font-mono text-white truncate">
            {{ latestBinaryEventTimeFormatted() }}
          </div>
          <div class="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-800/80 truncate">
            {{ latestBinaryEventDescription() }}
          </div>
        </div>

        <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div class="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span>Łącznie próbek w bazie</span>
            <mat-icon class="text-emerald-400 text-sm !w-4 !h-4">storage</mat-icon>
          </div>
          <div class="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
            {{ totalRecordsCount() }}
          </div>
          <div class="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-800/80">
            Zakres: {{ activeRangeLabel() }}
          </div>
        </div>
      </div>

      <!-- SEKCJA 1: DZIENNIK ZDARZEŃ DLA CZUJNIKÓW BINARNYCH (POKAZYWANY GDY WYBRANO CO NAJMNIEJ JEDEN CZUJNIK BINARNY) -->
      @if (hasBinarySensors()) {
        <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 relative shadow-xl space-y-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <div class="flex items-center gap-2">
              <mat-icon class="text-amber-400 text-sm !w-4 !h-4">list_alt</mat-icon>
              <h3 class="text-sm font-bold text-white uppercase tracking-wider">
                Chronologiczny Dziennik Zdarzeń Sensorów Binarnych
              </h3>
              <span class="text-xs px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-800 text-amber-300 font-mono">
                Wybrano czujników: {{ binarySelectedCount() }}
              </span>
            </div>
            <div class="flex items-center gap-3 text-xs font-mono text-slate-400">
              <span>Zdarzenia uporządkowane chronologicznie (od najnowszych) z timestampem</span>
            </div>
          </div>

          <div class="relative min-h-[360px] bg-slate-950 rounded-xl p-4 border border-slate-800/80">
            @if (isLoading()) {
              <div class="flex items-center justify-center py-20 text-cyan-400">
                <div class="flex items-center gap-2 text-xs font-mono">
                  <mat-icon class="animate-spin text-base">refresh</mat-icon>
                  Pobieranie i synchronizowanie historii zdarzeń...
                </div>
              </div>
            } @else if (mergedBinaryEvents().length > 0) {
              <div class="overflow-x-auto max-h-[460px] overflow-y-auto">
                <table class="w-full text-left text-xs font-mono">
                  <thead class="text-[11px] text-slate-400 border-b border-slate-800/60 sticky top-0 bg-slate-950 z-10">
                    <tr>
                      <th class="py-2.5 px-3">Godzina i Data (Timestamp)</th>
                      <th class="py-2.5 px-3">Czujnik / Nazwa urządzenia</th>
                      <th class="py-2.5 px-3">Zdarzenie / Detekcja</th>
                      <th class="py-2.5 px-3">Stan Baterii</th>
                      <th class="py-2.5 px-3">Jakość Sygnału (LQI)</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-900">
                    @for (ev of mergedBinaryEvents(); track ev.id) {
                      <tr class="hover:bg-slate-900/50 transition-colors">
                        <td class="py-2.5 px-3 text-slate-200 font-bold whitespace-nowrap">
                          {{ formatPointTime(ev.timestamp) }}
                        </td>
                        <td class="py-2.5 px-3 whitespace-nowrap">
                          <span class="font-semibold text-white">{{ ev.device_name }}</span>
                          <span class="text-[10px] text-slate-500 block">({{ ev.device_ieee }})</span>
                        </td>
                        <td class="py-2.5 px-3">
                          @switch (ev.event_type) {
                            @case ('motion_detected') {
                              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-cyan-950/80 text-cyan-300 border border-cyan-800 text-[11px] font-bold">
                                <mat-icon class="text-xs !w-3.5 !h-3.5">directions_walk</mat-icon>
                                Wykryto ruch
                              </span>
                            }
                            @case ('motion_clear') {
                              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 text-slate-400 border border-slate-800 text-[11px]">
                                <mat-icon class="text-xs !w-3.5 !h-3.5">person_off</mat-icon>
                                Brak obecności
                              </span>
                            }
                            @case ('contact_opened') {
                              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-950/80 text-rose-300 border border-rose-800 text-[11px] font-bold">
                                <mat-icon class="text-xs !w-3.5 !h-3.5">meeting_room</mat-icon>
                                Otwarto drzwi / okno
                              </span>
                            }
                            @case ('contact_closed') {
                              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/80 text-emerald-300 border border-emerald-800 text-[11px]">
                                <mat-icon class="text-xs !w-3.5 !h-3.5">door_front</mat-icon>
                                Zamknięto
                              </span>
                            }
                            @case ('water_leak_detected') {
                              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-950/80 text-rose-300 border border-rose-800 text-[11px] font-bold animate-pulse">
                                <mat-icon class="text-xs !w-3.5 !h-3.5">water_damage</mat-icon>
                                WYKRYTO ZALANIE!
                              </span>
                            }
                            @case ('water_leak_dry') {
                              <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-950/80 text-emerald-300 border border-emerald-800 text-[11px]">
                                <mat-icon class="text-xs !w-3.5 !h-3.5">water_drop</mat-icon>
                                Sucho / norma
                              </span>
                            }
                          }
                        </td>
                        <td class="py-2.5 px-3 text-slate-400">
                          {{ ev.battery !== undefined && ev.battery !== null ? ev.battery + '%' : '—' }}
                        </td>
                        <td class="py-2.5 px-3 text-slate-400">
                          {{ ev.linkquality !== undefined && ev.linkquality !== null ? ev.linkquality + ' LQI' : '—' }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <div class="flex flex-col items-center justify-center h-[340px] text-center p-6 border border-dashed border-slate-800/80 rounded-xl">
                <mat-icon class="text-4xl text-slate-600 mb-2">event_busy</mat-icon>
                <p class="text-sm font-semibold text-slate-300">Brak zarejestrowanych zdarzeń</p>
                <p class="text-xs text-slate-500 max-w-sm mt-1">
                  W wybranym przedziale czasu ({{ activeRangeLabel() }}) żaden z wybranych czujników binarnych nie zarejestrował zmian stanu. Aplikacja nie generuje sztucznych zdarzeń.
                </p>
              </div>
            }
          </div>
        </div>
      }

      <!-- SEKCJA 2: WYKRES WIELOCZUJNIKOWY DLA CZUJNIKÓW ŚRODOWISKOWYCH (POKAZYWANY GDY WYBRANO CZUJNIKI TEMPERATURY/WILGOTNOŚCI) -->
      @if (hasEnvSensors()) {
        <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 relative shadow-xl space-y-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <div class="flex items-center gap-2">
              <mat-icon class="text-cyan-400 text-sm !w-4 !h-4">show_chart</mat-icon>
              <h3 class="text-sm font-bold text-white uppercase tracking-wider">
                Wykres Porównawczy: Temperatura i Wilgotność
              </h3>
              <span class="text-xs px-2 py-0.5 rounded-full bg-cyan-950/80 border border-cyan-800 text-cyan-300 font-mono">
                Wybrano czujników: {{ envSelectedCount() }}
              </span>
            </div>
            <div class="flex items-center gap-3 text-xs">
              <span class="text-slate-400 font-mono">Linie ciągłe: Temperatura (°C) · Linie przerywane: Wilgotność (%)</span>
            </div>
          </div>

          <div class="relative min-h-[380px] bg-slate-950 rounded-xl p-4 border border-slate-800/80">
            @if (isLoading()) {
              <div class="absolute inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center text-cyan-400 z-10 rounded-xl">
                <div class="flex items-center gap-2 text-xs font-mono">
                  <mat-icon class="animate-spin text-base">refresh</mat-icon>
                  Pobieranie historii z bazy SQLite (/api/devices/:ieee/history)...
                </div>
              </div>
            }
            @if (hasEnvDataPoints()) {
              <div class="w-full h-[380px]">
                <canvas #analyticsCanvas></canvas>
              </div>
            } @else if (!isLoading()) {
              <div class="flex flex-col items-center justify-center h-[360px] text-center p-6 border border-dashed border-slate-800/80 rounded-xl">
                <mat-icon class="text-4xl text-slate-600 mb-2">signal_wifi_bad</mat-icon>
                <p class="text-sm font-semibold text-slate-300">Brak próbek pomiarowych</p>
                <p class="text-xs text-slate-500 max-w-sm mt-1">
                  Brak odnotowanych próbek w bazie SQLite dla wybranego zakresu czasu ({{ activeRangeLabel() }}). Aplikacja nie syntetyzuje sztucznych danych.
                </p>
              </div>
            }
          </div>
        </div>
      }

      <!-- Brak zaznaczonych czujników -->
      @if (selectedIeees().length === 0) {
        <div class="p-12 rounded-2xl bg-slate-900 border border-dashed border-slate-800 text-center">
          <mat-icon class="text-5xl text-slate-600 mb-3">touch_app</mat-icon>
          <h3 class="text-base font-bold text-slate-200">Wybierz co najmniej jeden czujnik z listy powyżej</h3>
          <p class="text-xs text-slate-500 max-w-md mx-auto mt-1">
            Możesz zaznaczyć wiele czujników ruchu, drzwi i zalania, aby przeglądać ich chronologiczną oś zdarzeń, lub czujniki temperatury do porównania na wykresie.
          </p>
          <div class="mt-4">
            <button
              (click)="selectAllSensors()"
              class="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors cursor-pointer"
            >
              Zaznacz wszystkie czujniki
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class AnalyticsView {
  readonly telemetry = inject(Telemetry);
  private platformId = inject(PLATFORM_ID);
  private analyticsCanvas = viewChild<ElementRef<HTMLCanvasElement>>('analyticsCanvas');

  readonly ranges = [
    { key: '6h', label: '6h' },
    { key: '24h', label: '24h' },
    { key: '7d', label: '7 dni' },
    { key: '30d', label: '30 dni' },
    { key: '90d', label: '90 dni' },
    { key: '360d', label: '360 dni' },
    { key: '720d', label: '720 dni' },
  ];

  readonly activeRange = signal<string>('24h');
  readonly selectedIeees = signal<string[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly devicesHistoryData = signal<Map<string, DeviceHistoryData>>(new Map());

  // Paleta wyrazistych kolorów dla wykresu wielu czujników
  private readonly palette = [
    '#06b6d4', // cyan
    '#3b82f6', // blue
    '#10b981', // emerald
    '#f59e0b', // amber
    '#ec4899', // pink
    '#8b5cf6', // purple
    '#14b8a6', // teal
    '#f97316', // orange
    '#a855f7', // violet
    '#e11d48', // rose
  ];

  private chartInstance: Chart | null = null;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      Chart.register(...registerables);
    }

    // Automatycznie zainicjuj zaznaczenie: domyślnie zaznacz wszystkie dostępne czujniki
    effect(() => {
      const devs = this.telemetry.devices();
      if (devs.length > 0 && this.selectedIeees().length === 0) {
        this.selectedIeees.set(devs.map((d) => d.ieee_address));
      }
    });

    // Reaguj na zmiany wyboru czujników lub zakresu czasowego
    effect(() => {
      const ieees = this.selectedIeees();
      const range = this.activeRange();
      this.loadMultiHistory(ieees, range);
    });
  }

  getDeviceCategory(d: Device): string {
    if (d.category) return d.category;
    const m = (d.model || '').toLowerCase();
    const f = (d.friendly_name || '').toLowerCase();
    if (m.includes('contact') || m.includes('door') || f.includes('drzwi') || f.includes('okno') || f.includes('otwarcie') || f.includes('kontaktron') || d.contact !== undefined) return 'contact';
    if (m.includes('motion') || m.includes('pir') || m.includes('presence') || m.includes('occupancy') || f.includes('ruch') || f.includes('ruchu') || f.includes('obecno') || f.includes('korytarz') || f.includes('góra') || f.includes('gora') || d.occupancy !== undefined) return 'occupancy';
    if (m.includes('water') || m.includes('leak') || f.includes('zalani') || f.includes('woda') || d.water_leak !== undefined) return 'water_leak';
    if (f.includes('czujnik c') || f.includes('czujnik temp') || f.includes('temperatura') || f.includes('wilgotn')) return 'sensor';
    if (m.includes('trv') || m.includes('thermostat') || m.includes('termostat') || m.includes('sonoff trvzb') || f.includes('termostat') || f.includes('glowica') || f.includes('głowica') || d.occupied_heating_setpoint !== undefined) return 'climate';
    return 'sensor';
  }

  isBinaryCategory(cat: string): boolean {
    return cat === 'contact' || cat === 'occupancy' || cat === 'water_leak';
  }

  getDeviceIcon(d: Device, cat: string): string {
    if (cat === 'occupancy') return 'directions_walk';
    if (cat === 'contact') return 'meeting_room';
    if (cat === 'water_leak') return 'water_damage';
    if (cat === 'climate') return 'thermostat_auto';
    return 'thermostat';
  }

  readonly selectedDevices = computed<Device[]>(() => {
    const all = this.telemetry.devices();
    const set = new Set(this.selectedIeees());
    return all.filter((d) => set.has(d.ieee_address));
  });

  readonly binarySelectedCount = computed(() => {
    return this.selectedDevices().filter((d) => this.isBinaryCategory(this.getDeviceCategory(d))).length;
  });

  readonly envSelectedCount = computed(() => {
    return this.selectedDevices().filter((d) => !this.isBinaryCategory(this.getDeviceCategory(d))).length;
  });

  readonly hasBinarySensors = computed(() => {
    return this.binarySelectedCount() > 0;
  });

  readonly hasEnvSensors = computed(() => {
    return this.envSelectedCount() > 0;
  });

  // Sklejone, chronologicznie posortowane zdarzenia ze WSZYSTKICH wybranych czujników binarnych
  readonly mergedBinaryEvents = computed<MergedBinaryEvent[]>(() => {
    const dataMap = this.devicesHistoryData();
    const selIeees = new Set(this.selectedIeees());
    const events: MergedBinaryEvent[] = [];

    dataMap.forEach((entry, ieee) => {
      if (!selIeees.has(ieee)) return;
      const dev = entry.device;
      const cat = this.getDeviceCategory(dev);
      if (!this.isBinaryCategory(cat)) return;

      const hist = entry.history;
      for (const p of hist) {
        if (cat === 'occupancy') {
          if (p.occupancy !== undefined && p.occupancy !== null) {
            events.push({
              id: `${p.id || p.timestamp}_${ieee}_occ`,
              timestamp: p.timestamp,
              device_ieee: ieee,
              device_name: dev.friendly_name || ieee,
              category: cat,
              event_type: p.occupancy ? 'motion_detected' : 'motion_clear',
              event_label: p.occupancy ? 'Wykryto ruch' : 'Brak obecności',
              battery: p.battery,
              linkquality: p.linkquality,
            });
          }
        } else if (cat === 'contact') {
          if (p.contact !== undefined && p.contact !== null) {
            events.push({
              id: `${p.id || p.timestamp}_${ieee}_cnt`,
              timestamp: p.timestamp,
              device_ieee: ieee,
              device_name: dev.friendly_name || ieee,
              category: cat,
              event_type: p.contact === false ? 'contact_opened' : 'contact_closed',
              event_label: p.contact === false ? 'Otwarto drzwi / okno' : 'Zamknięto',
              battery: p.battery,
              linkquality: p.linkquality,
            });
          }
        } else if (cat === 'water_leak') {
          if (p.water_leak !== undefined && p.water_leak !== null) {
            events.push({
              id: `${p.id || p.timestamp}_${ieee}_wat`,
              timestamp: p.timestamp,
              device_ieee: ieee,
              device_name: dev.friendly_name || ieee,
              category: cat,
              event_type: p.water_leak ? 'water_leak_detected' : 'water_leak_dry',
              event_label: p.water_leak ? 'WYKRYTO ZALANIE!' : 'Sucho / norma',
              battery: p.battery,
              linkquality: p.linkquality,
            });
          }
        }
      }
    });

    // Sortowanie chronologiczne: OD NAJNOWSZYCH DO NAJSTARSZYCH (malejąco według timestamp)
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return events;
  });

  readonly totalMotionEvents = computed(() => {
    return this.mergedBinaryEvents().filter((e) => e.event_type === 'motion_detected').length;
  });

  readonly totalOpenEvents = computed(() => {
    return this.mergedBinaryEvents().filter((e) => e.event_type === 'contact_opened').length;
  });

  readonly totalLeakEvents = computed(() => {
    return this.mergedBinaryEvents().filter((e) => e.event_type === 'water_leak_detected').length;
  });

  readonly latestBinaryEventTimeFormatted = computed(() => {
    const evs = this.mergedBinaryEvents();
    if (evs.length > 0) {
      return this.formatPointTime(evs[0].timestamp);
    }
    return 'brak zdarzeń';
  });

  readonly latestBinaryEventDescription = computed(() => {
    const evs = this.mergedBinaryEvents();
    if (evs.length > 0) {
      const top = evs[0];
      return `${top.device_name}: ${top.event_label}`;
    }
    return 'Rejestr jest pusty';
  });

  readonly totalRecordsCount = computed(() => {
    let sum = 0;
    const dataMap = this.devicesHistoryData();
    const selIeees = new Set(this.selectedIeees());
    dataMap.forEach((entry, ieee) => {
      if (selIeees.has(ieee)) {
        sum += entry.history.length;
      }
    });
    return sum;
  });

  readonly hasEnvDataPoints = computed(() => {
    const dataMap = this.devicesHistoryData();
    const selIeees = new Set(this.selectedIeees());
    for (const [ieee, entry] of dataMap.entries()) {
      if (selIeees.has(ieee) && !this.isBinaryCategory(this.getDeviceCategory(entry.device))) {
        if (entry.history.length > 0) return true;
      }
    }
    return false;
  });

  activeRangeLabel(): string {
    const r = this.ranges.find((x) => x.key === this.activeRange());
    return r ? r.label : this.activeRange();
  }

  formatPointTime(timestamp: string): string {
    return formatEuropeanDateTime(timestamp, true);
  }

  toggleSensor(ieee: string): void {
    const cur = this.selectedIeees();
    if (cur.includes(ieee)) {
      this.selectedIeees.set(cur.filter((x) => x !== ieee));
    } else {
      this.selectedIeees.set([...cur, ieee]);
    }
  }

  selectAllSensors(): void {
    this.selectedIeees.set(this.telemetry.devices().map((d) => d.ieee_address));
  }

  selectOnlyBinarySensors(): void {
    const bins = this.telemetry.devices()
      .filter((d) => this.isBinaryCategory(this.getDeviceCategory(d)))
      .map((d) => d.ieee_address);
    this.selectedIeees.set(bins);
  }

  selectOnlyEnvSensors(): void {
    const envs = this.telemetry.devices()
      .filter((d) => !this.isBinaryCategory(this.getDeviceCategory(d)))
      .map((d) => d.ieee_address);
    this.selectedIeees.set(envs);
  }

  clearAllSensors(): void {
    this.selectedIeees.set([]);
  }

  setRange(range: string): void {
    this.activeRange.set(range);
  }

  private loadMultiHistory(ieees: string[], range: string): void {
    if (ieees.length === 0) {
      this.devicesHistoryData.set(new Map());
      if (this.chartInstance) {
        this.chartInstance.destroy();
        this.chartInstance = null;
      }
      return;
    }

    this.isLoading.set(true);
    const devicesList = this.telemetry.devices();

    const requests = ieees.map((ieee) => {
      return this.telemetry.fetchDeviceHistory(ieee, range).pipe(
        catchError(() => of({ device_ieee: ieee, range, count: 0, history: [], stats: undefined } as HistoryResponse)),
      );
    });

    forkJoin(requests).subscribe({
      next: (responses: HistoryResponse[]) => {
        this.isLoading.set(false);
        const map = new Map<string, DeviceHistoryData>();

        responses.forEach((res) => {
          const dev = devicesList.find((d) => d.ieee_address === res.device_ieee) || {
            ieee_address: res.device_ieee,
            friendly_name: res.device_ieee,
            model: 'Device',
          } as Device;

          map.set(res.device_ieee, {
            device: dev,
            history: res.history || [],
            stats: res.stats || null,
          });
        });

        this.devicesHistoryData.set(map);

        if (this.hasEnvSensors()) {
          setTimeout(() => this.renderEnvChart(map, range), 50);
        } else if (this.chartInstance) {
          this.chartInstance.destroy();
          this.chartInstance = null;
        }
      },
      error: (err: unknown) => {
        this.isLoading.set(false);
        console.error('Błąd pobierania historii sensorów:', err);
      },
    });
  }

  private renderEnvChart(dataMap: Map<string, DeviceHistoryData>, range: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const canvasRef = this.analyticsCanvas();
    if (!canvasRef) return;

    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }

    // Zbierz wszystkie unikalne etykiety czasowe
    const timeLabelsSet = new Set<string>();
    const envDevices: { device: Device; history: TelemetryPoint[]; color: string }[] = [];

    let colorIndex = 0;
    dataMap.forEach((entry, ieee) => {
      if (this.selectedIeees().includes(ieee) && !this.isBinaryCategory(this.getDeviceCategory(entry.device))) {
        envDevices.push({
          device: entry.device,
          history: entry.history,
          color: this.palette[colorIndex % this.palette.length],
        });
        colorIndex++;
        entry.history.forEach((p) => timeLabelsSet.add(p.timestamp));
      }
    });

    if (envDevices.length === 0) return;

    // Posortuj etykiety chronologicznie
    const sortedTimestamps = Array.from(timeLabelsSet).sort(
      (a, b) => new Date(a).getTime() - new Date(b).getTime(),
    );

    const labels = sortedTimestamps.map((ts) => formatChartTimeLabel(ts, range));

    const datasets: ChartDataset<'line'>[] = [];

    envDevices.forEach(({ device, history, color }) => {
      // Mapowanie historii na oś czasu
      const pointMap = new Map<string, TelemetryPoint>();
      history.forEach((p) => pointMap.set(p.timestamp, p));

      const tempData = sortedTimestamps.map((ts) => {
        const pt = pointMap.get(ts);
        return pt?.temperature !== undefined && pt?.temperature !== null ? pt.temperature : null;
      });

      const humData = sortedTimestamps.map((ts) => {
        const pt = pointMap.get(ts);
        return pt?.humidity !== undefined && pt?.humidity !== null ? pt.humidity : null;
      });

      // Dataset temperatury
      datasets.push({
        label: `${device.friendly_name} (°C)`,
        data: tempData,
        borderColor: color,
        backgroundColor: color + '22',
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 5,
        tension: 0.3,
        spanGaps: true,
        yAxisID: 'yTemp',
      });

      // Dataset wilgotności (przerywana linia)
      datasets.push({
        label: `${device.friendly_name} (%)`,
        data: humData,
        borderColor: color,
        borderDash: [5, 5],
        borderWidth: 1.5,
        pointRadius: 1.5,
        pointHoverRadius: 4,
        tension: 0.3,
        spanGaps: true,
        yAxisID: 'yHum',
      });
    });

    const ctx = canvasRef.nativeElement.getContext('2d');
    if (!ctx) return;

    this.chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: '#94a3b8',
              font: { family: "'JetBrains Mono', monospace", size: 11 },
              boxWidth: 12,
              padding: 12,
            },
          },
          tooltip: {
            backgroundColor: '#020617',
            titleColor: '#e2e8f0',
            bodyColor: '#f8fafc',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 10,
            bodyFont: { family: "'JetBrains Mono', monospace" },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(51, 65, 85, 0.2)' },
            ticks: {
              color: '#64748b',
              font: { family: "'JetBrains Mono', monospace", size: 10 },
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 10,
            },
          },
          yTemp: {
            type: 'linear',
            position: 'left',
            grid: { color: 'rgba(51, 65, 85, 0.2)' },
            ticks: {
              color: '#06b6d4',
              font: { family: "'JetBrains Mono', monospace", size: 11 },
              callback: (v) => `${v}°C`,
            },
          },
          yHum: {
            type: 'linear',
            position: 'right',
            grid: { drawOnChartArea: false },
            ticks: {
              color: '#3b82f6',
              font: { family: "'JetBrains Mono', monospace", size: 11 },
              callback: (v) => `${v}%`,
            },
            min: 0,
            max: 100,
          },
        },
      },
    });
  }

  exportToCsv(): void {
    if (this.totalRecordsCount() === 0) return;

    const hasBin = this.hasBinarySensors();
    let rows: (string | number | boolean | null | undefined)[][];

    if (hasBin) {
      const evs = this.mergedBinaryEvents();
      rows = [
        ['Timestamp', 'Device_IEEE', 'Device_Name', 'Category', 'Event_Type', 'Event_Label', 'Battery_Pct', 'LQI'],
        ...evs.map((e) => [
          e.timestamp,
          e.device_ieee,
          e.device_name,
          e.category,
          e.event_type,
          e.event_label,
          e.battery,
          e.linkquality,
        ]),
      ];
    } else {
      const dataMap = this.devicesHistoryData();
      const allEnvPoints: { p: TelemetryPoint; name: string }[] = [];
      dataMap.forEach((entry, ieee) => {
        if (this.selectedIeees().includes(ieee)) {
          entry.history.forEach((pt) => {
            allEnvPoints.push({ p: pt, name: entry.device.friendly_name || ieee });
          });
        }
      });
      allEnvPoints.sort((a, b) => new Date(b.p.timestamp).getTime() - new Date(a.p.timestamp).getTime());

      rows = [
        ['Timestamp', 'Device_IEEE', 'Device_Name', 'Temperature_C', 'Humidity_Pct', 'Battery_Pct', 'LQI'],
        ...allEnvPoints.map(({ p, name }) => [
          p.timestamp,
          p.device_ieee,
          name,
          p.temperature,
          p.humidity,
          p.battery,
          p.linkquality,
        ]),
      ];
    }

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    const prefix = hasBin ? 'dziennik_zdarzen_multisensor' : 'analityka_pomiary_multisensor';
    link.setAttribute('download', `${prefix}_${this.activeRange()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
