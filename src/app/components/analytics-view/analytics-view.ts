import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Device, HistoryResponse, HistoryStats, TelemetryPoint } from '../../models/telemetry.models';
import { Telemetry } from '../../services/telemetry';
import { Chart, registerables } from 'chart.js';

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
            <mat-icon class="text-sm !w-4 !h-4">insights</mat-icon>
            <span>Chart.js · SQLite Dynamic Downsampling</span>
          </div>
          <h2 class="text-xl font-bold text-white tracking-tight">
            Wielozakresowa analityka trendów środowiskowych
          </h2>
          <p class="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Przebiegi temperatury i wilgotności z bazy SQLite z automatyczną agregacją dla długich okresów (6h, 24h, 7 dni, 30 dni, 90 dni, 360 dni, 720 dni).
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            (click)="exportToCsv()"
            [disabled]="historyPoints().length === 0"
            class="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white border border-slate-700 transition-colors cursor-pointer"
          >
            <mat-icon class="text-sm !w-4 !h-4">download</mat-icon>
            <span>Eksportuj CSV</span>
          </button>
        </div>
      </div>

      <!-- Wybór czujnika i zakresu czasowego -->
      <div class="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <!-- Selektor czujnika -->
        <div class="flex items-center gap-3">
          <label for="sensorSelectDropdown" class="text-xs font-medium text-slate-400 shrink-0">Wybierz czujnik:</label>
          <select
            id="sensorSelectDropdown"
            [value]="selectedIeee()"
            (change)="onSensorChanged($event)"
            class="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:outline-none focus:border-cyan-500 cursor-pointer min-w-[260px]"
          >
            @for (dev of telemetry.devices(); track dev.ieee_address) {
              <option [value]="dev.ieee_address">
                {{ dev.friendly_name }} ({{ dev.last_temperature !== undefined && dev.last_temperature !== null ? dev.last_temperature + '°C' : 'brak danych' }})
              </option>
            }
          </select>
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

      <!-- Kafelki statystyk analitycznych dla wybranego zakresu -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <!-- Karta Temperatura -->
        <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div class="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span>Temperatura (Średnia)</span>
            <mat-icon class="text-cyan-400 text-sm !w-4 !h-4">thermostat</mat-icon>
          </div>
          <div class="text-2xl font-bold font-mono text-cyan-400 tabular-nums">
            {{ stats()?.avg_temp !== undefined ? stats()?.avg_temp + ' °C' : 'brak danych' }}
          </div>
          <div class="flex items-center justify-between text-[11px] text-slate-500 font-mono mt-2 pt-2 border-t border-slate-800/80">
            <span>Min: <strong class="text-slate-300 font-normal">{{ stats()?.min_temp !== undefined ? stats()?.min_temp + '°C' : 'brak danych' }}</strong></span>
            <span>Max: <strong class="text-slate-300 font-normal">{{ stats()?.max_temp !== undefined ? stats()?.max_temp + '°C' : 'brak danych' }}</strong></span>
          </div>
        </div>

        <!-- Karta Wilgotność -->
        <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div class="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span>Wilgotność (Średnia)</span>
            <mat-icon class="text-blue-400 text-sm !w-4 !h-4">water_drop</mat-icon>
          </div>
          <div class="text-2xl font-bold font-mono text-blue-400 tabular-nums">
            {{ stats()?.avg_hum !== undefined ? stats()?.avg_hum + ' %' : 'brak danych' }}
          </div>
          <div class="flex items-center justify-between text-[11px] text-slate-500 font-mono mt-2 pt-2 border-t border-slate-800/80">
            <span>Min: <strong class="text-slate-300 font-normal">{{ stats()?.min_hum !== undefined ? stats()?.min_hum + '%' : 'brak danych' }}</strong></span>
            <span>Max: <strong class="text-slate-300 font-normal">{{ stats()?.max_hum !== undefined ? stats()?.max_hum + '%' : 'brak danych' }}</strong></span>
          </div>
        </div>

        <!-- Karta Bateria -->
        <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div class="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span>Bateria czujnika</span>
            <mat-icon class="text-emerald-400 text-sm !w-4 !h-4">battery_charging_full</mat-icon>
          </div>
          <div class="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
            {{ currentDevice()?.battery !== undefined && currentDevice()?.battery !== null ? currentDevice()?.battery + ' %' : 'brak danych' }}
          </div>
          <div class="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-800/80 truncate">
            {{ currentDevice()?.model || 'Zigbee 3.0 Sensor' }}
          </div>
        </div>

        <!-- Karta Liczba Próbek -->
        <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div class="flex items-center justify-between text-xs text-slate-400 mb-1.5">
            <span>Próbki w bazie SQLite</span>
            <mat-icon class="text-slate-400 text-sm !w-4 !h-4">storage</mat-icon>
          </div>
          <div class="text-2xl font-bold font-mono text-slate-200 tabular-nums">
            {{ (stats()?.count ?? historyPoints().length) > 0 ? (stats()?.count ?? historyPoints().length) : 'brak danych' }}
          </div>
          <div class="text-[11px] text-slate-500 mt-2 pt-2 border-t border-slate-800/80">
            Zakres: {{ activeRangeLabel() }}
          </div>
        </div>
      </div>

      <!-- Główny kontener wykresu Chart.js -->
      <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 relative shadow-xl">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <h3 class="text-sm font-bold text-white">
              Wykres liniowy: {{ currentDevice()?.friendly_name }}
            </h3>
            <span class="text-xs font-mono text-slate-500">({{ currentDevice()?.ieee_address }})</span>
          </div>
          <div class="flex items-center gap-3 text-xs">
            <div class="flex items-center gap-1.5">
              <span class="w-3 h-1.5 rounded-full bg-cyan-400"></span>
              <span class="text-slate-300">Temperatura (°C)</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="w-3 h-1.5 rounded-full bg-blue-500"></span>
              <span class="text-slate-300">Wilgotność (%)</span>
            </div>
          </div>
        </div>

        <div class="relative min-h-[380px] bg-slate-950 rounded-xl p-4 border border-slate-800/80">
          @if (isLoading()) {
            <div class="absolute inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center text-cyan-400 z-10 rounded-xl">
              <div class="flex items-center gap-2 text-xs font-mono">
                <mat-icon class="animate-spin text-base">refresh</mat-icon>
                Pobieranie historii z bazy SQLite (/api/devices/history)...
              </div>
            </div>
          }
          @if (historyPoints().length > 0) {
            <div class="w-full h-[360px]">
              <canvas #analyticsCanvas></canvas>
            </div>
          } @else if (!isLoading()) {
            <div class="flex flex-col items-center justify-center h-[360px] text-center p-6 border border-dashed border-slate-800/80 rounded-xl">
              <mat-icon class="text-4xl text-slate-600 mb-2">signal_wifi_bad</mat-icon>
              <p class="text-sm font-semibold text-slate-300">brak danych</p>
              <p class="text-xs text-slate-500 max-w-sm mt-1">
                Brak odnotowanych próbek w bazie SQLite dla wybranego zakresu czasu ({{ activeRangeLabel() }}). Aplikacja nie syntetyzuje sztucznych danych.
              </p>
            </div>
          }
        </div>
      </div>
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
  readonly selectedIeee = signal<string>('');
  readonly currentDevice = signal<Device | null>(null);
  readonly isLoading = signal<boolean>(false);
  readonly stats = signal<HistoryStats | null>(null);
  readonly historyPoints = signal<TelemetryPoint[]>([]);

  private chartInstance: Chart | null = null;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      Chart.register(...registerables);
    }

    // Automatycznie ustaw pierwszy czujnik po załadowaniu listy
    effect(() => {
      const devs = this.telemetry.devices();
      if (devs.length > 0 && !this.selectedIeee()) {
        this.selectedIeee.set(devs[0].ieee_address);
        this.currentDevice.set(devs[0]);
      }
    });

    // Reaguj na zmianę wybranego czujnika lub zakresu
    effect(() => {
      const ieee = this.selectedIeee();
      const range = this.activeRange();
      if (ieee) {
        const found = this.telemetry.devices().find((d) => d.ieee_address === ieee);
        if (found) this.currentDevice.set(found);
        this.loadHistory(ieee, range);
      }
    });
  }

  activeRangeLabel(): string {
    const r = this.ranges.find((x) => x.key === this.activeRange());
    return r ? r.label : this.activeRange();
  }

  onSensorChanged(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.selectedIeee.set(val);
  }

  setRange(range: string): void {
    this.activeRange.set(range);
  }

  private loadHistory(ieee: string, range: string): void {
    this.isLoading.set(true);
    this.telemetry.fetchDeviceHistory(ieee, range).subscribe({
      next: (res: HistoryResponse) => {
        this.isLoading.set(false);
        this.stats.set(res.stats || null);
        this.historyPoints.set(res.history || []);
        this.renderChart(res.history || [], range);
      },
      error: (err: unknown) => {
        this.isLoading.set(false);
        console.error('Błąd pobierania historii analitycznej:', err);
      },
    });
  }

  private renderChart(history: TelemetryPoint[], range: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const canvasRef = this.analyticsCanvas();
    if (!canvasRef) return;

    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }

    const labels = history.map((item) => {
      const d = new Date(item.timestamp);
      if (isNaN(d.getTime())) return item.timestamp;
      if (range === '6h' || range === '24h') {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      return `${d.toLocaleDateString([], { month: 'numeric', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    });

    const tempData = history.map((p) => p.temperature);
    const humData = history.map((p) => p.humidity);

    const ctx = canvasRef.nativeElement.getContext('2d');
    if (!ctx) return;

    const tempGradient = ctx.createLinearGradient(0, 0, 0, 320);
    tempGradient.addColorStop(0, 'rgba(6, 182, 212, 0.28)');
    tempGradient.addColorStop(1, 'rgba(6, 182, 212, 0.0)');

    const humGradient = ctx.createLinearGradient(0, 0, 0, 320);
    humGradient.addColorStop(0, 'rgba(59, 130, 246, 0.2)');
    humGradient.addColorStop(1, 'rgba(59, 130, 246, 0.0)');

    this.chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Temperatura (°C)',
            data: tempData,
            borderColor: '#06b6d4',
            backgroundColor: tempGradient,
            borderWidth: 2.2,
            pointRadius: history.length > 70 ? 0 : 2.5,
            pointHoverRadius: 5,
            pointBackgroundColor: '#06b6d4',
            fill: true,
            tension: 0.35,
            yAxisID: 'yTemp',
          },
          {
            label: 'Wilgotność (%)',
            data: humData,
            borderColor: '#3b82f6',
            backgroundColor: humGradient,
            borderWidth: 2,
            pointRadius: history.length > 70 ? 0 : 2.5,
            pointHoverRadius: 5,
            pointBackgroundColor: '#3b82f6',
            fill: true,
            tension: 0.35,
            yAxisID: 'yHum',
          },
        ],
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
            display: false,
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
    const list = this.historyPoints();
    if (list.length === 0) return;

    const dev = this.currentDevice();
    const rows = [
      ['Timestamp', 'Device_IEEE', 'Device_Name', 'Temperature_C', 'Humidity_Pct', 'Battery_Pct', 'LQI'],
      ...list.map((p) => [
        p.timestamp,
        p.device_ieee,
        dev?.friendly_name || p.device_ieee,
        p.temperature,
        p.humidity,
        p.battery,
        p.linkquality,
      ]),
    ];

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `telemetry_${this.selectedIeee()}_${this.activeRange()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
