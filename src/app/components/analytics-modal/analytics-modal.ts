import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  effect,
  inject,
  input,
  output,
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
  selector: 'app-analytics-modal',
  imports: [MatIconModule],
  template: `
    @if (device()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
        <!-- Tło modala jako dostępny przycisk zamykający -->
        <button
          type="button"
          class="fixed inset-0 w-full h-full bg-slate-950/80 backdrop-blur-sm border-none cursor-default"
          aria-label="Zamknij modal"
          (click)="closed.emit()"
        ></button>
        <div class="relative z-10 bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
          <!-- Nagłówek modala -->
          <div class="p-5 border-b border-slate-800 flex items-center justify-between gap-4">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-10 h-10 rounded-xl bg-cyan-950/80 border border-cyan-800/80 flex items-center justify-center text-cyan-400 shrink-0">
                <mat-icon class="text-xl">insights</mat-icon>
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  @if (!isEditingName()) {
                    <h3 class="text-base font-bold text-white truncate">{{ device()?.friendly_name }}</h3>
                    <button
                      (click)="startEditingName()"
                      class="text-slate-400 hover:text-cyan-400 p-1 rounded transition-colors"
                      title="Zmień nazwę czujnika"
                    >
                      <mat-icon class="text-xs !w-4 !h-4 leading-none">edit</mat-icon>
                    </button>
                  } @else {
                    <div class="flex items-center gap-1.5">
                      <input
                        #nameInput
                        type="text"
                        [value]="device()?.friendly_name"
                        class="px-2 py-0.5 text-xs bg-slate-950 border border-cyan-500 rounded text-white font-medium focus:outline-none"
                        (keydown.enter)="saveNewName(nameInput.value)"
                        (keydown.escape)="cancelEditingName()"
                      />
                      <button
                        (click)="saveNewName(nameInput.value)"
                        class="p-1 text-emerald-400 hover:text-emerald-300"
                        title="Zapisz"
                      >
                        <mat-icon class="text-xs !w-4 !h-4">check</mat-icon>
                      </button>
                      <button
                        (click)="cancelEditingName()"
                        class="p-1 text-slate-400 hover:text-white"
                        title="Anuluj"
                      >
                        <mat-icon class="text-xs !w-4 !h-4">close</mat-icon>
                      </button>
                    </div>
                  }
                </div>
                <div class="flex items-center gap-2 text-xs font-mono text-slate-400 mt-0.5">
                  <span>{{ device()?.ieee_address }}</span>
                  <span class="text-slate-600">·</span>
                  <span class="text-slate-500">{{ device()?.model }}</span>
                </div>
              </div>
            </div>

            <button
              (click)="closed.emit()"
              class="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
              title="Zamknij"
            >
              <mat-icon class="text-xl">close</mat-icon>
            </button>
          </div>

          <!-- Treść modala -->
          <div class="p-5 space-y-6 overflow-y-auto">
            <!-- Wybór zakresu czasowego -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span class="text-xs font-medium text-slate-400">Zakres analizy telemetrycznej:</span>
              <div class="inline-flex rounded-lg bg-slate-950 border border-slate-800 p-1 gap-1 text-xs font-mono">
                @for (range of ranges; track range.key) {
                  <button
                    (click)="setRange(range.key)"
                    class="px-2.5 py-1 rounded-md transition-colors whitespace-nowrap"
                    [class.bg-cyan-600]="activeRange() === range.key"
                    [class.text-white]="activeRange() === range.key"
                    [class.font-semibold]="activeRange() === range.key"
                    [class.shadow-sm]="activeRange() === range.key"
                    [class.text-slate-400]="activeRange() !== range.key"
                    [class.hover:text-white]="activeRange() !== range.key"
                  >
                    {{ range.label }}
                  </button>
                }
              </div>
            </div>

            <!-- Specjalny panel sterowania dla głowic TRVZB oraz Smart Plugów w modalu -->
            @if (device()?.current_heating_setpoint !== undefined || device()?.category === 'climate') {
              <div class="p-4 rounded-xl bg-gradient-to-r from-rose-950/40 via-slate-950 to-slate-950 border border-rose-800/60 flex flex-wrap items-center justify-between gap-4">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-rose-950 border border-rose-800 flex items-center justify-center text-rose-400">
                    <mat-icon>thermostat</mat-icon>
                  </div>
                  <div>
                    <div class="text-xs text-rose-300 font-bold">Sonoff TRVZB / TRVZB Gen 2 — Nastawa Termostatu</div>
                    <div class="text-xs text-slate-400 font-mono">
                      Aktualna nastawa: <strong class="text-white">{{ device()?.current_heating_setpoint || 21.0 }}°C</strong> • Stan zaworu: <span class="text-orange-400 font-semibold">{{ device()?.running_state === 'heat' ? 'Grzeje' : 'Czuwanie' }}</span> • Tryb: <span class="uppercase text-cyan-300">{{ device()?.system_mode || 'heat' }}</span>
                    </div>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <span class="text-xs font-mono text-slate-400">Blokada: {{ device()?.child_lock === 'LOCK' ? 'Włączona (Lock)' : 'Wyłączona' }}</span>
                </div>
              </div>
            } @else if (device()?.power !== undefined || device()?.category === 'plug') {
              <div class="p-4 rounded-xl bg-gradient-to-r from-emerald-950/40 via-slate-950 to-slate-950 border border-emerald-800/60 flex flex-wrap items-center justify-between gap-4">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-400">
                    <mat-icon>power</mat-icon>
                  </div>
                  <div>
                    <div class="text-xs text-emerald-300 font-bold">Monitor Energii Elektrycznej 230V</div>
                    <div class="text-xs text-slate-400 font-mono">
                      Moc chwilowa: <strong class="text-white">{{ device()?.power || 0 }} W</strong> • Napięcie: <strong class="text-cyan-300">{{ device()?.voltage || 230 }} V</strong> • Łączne zużycie: <strong class="text-emerald-300">{{ device()?.energy || 0 }} kWh</strong>
                    </div>
                  </div>
                </div>
                <div class="text-xs font-mono font-bold" [class.text-emerald-400]="device()?.state === 'ON'" [class.text-slate-400]="device()?.state !== 'ON'">
                  Stan: {{ device()?.state || 'OFF' }}
                </div>
              </div>
            }

            <!-- Karty statystyk dla wybranego zakresu -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div class="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
                <div class="text-slate-400 mb-1 flex items-center justify-between">
                  <span>Średnia temp.</span>
                  <mat-icon class="text-cyan-400 !w-3.5 !h-3.5 text-xs">thermostat</mat-icon>
                </div>
                <div class="text-xl font-bold font-mono text-cyan-400 tabular-nums">
                  {{ stats()?.avg_temp !== undefined ? stats()?.avg_temp + ' °C' : 'brak danych' }}
                </div>
                <div class="text-[11px] text-slate-500 font-mono mt-1">
                  Min: <span class="text-slate-300">{{ stats()?.min_temp !== undefined ? stats()?.min_temp + '°' : 'brak danych' }}</span> / Max: <span class="text-slate-300">{{ stats()?.max_temp !== undefined ? stats()?.max_temp + '°' : 'brak danych' }}</span>
                </div>
              </div>

              <div class="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
                <div class="text-slate-400 mb-1 flex items-center justify-between">
                  <span>Średnia wilgotność</span>
                  <mat-icon class="text-blue-400 !w-3.5 !h-3.5 text-xs">water_drop</mat-icon>
                </div>
                <div class="text-xl font-bold font-mono text-blue-400 tabular-nums">
                  {{ stats()?.avg_hum !== undefined ? stats()?.avg_hum + ' %' : 'brak danych' }}
                </div>
                <div class="text-[11px] text-slate-500 font-mono mt-1">
                  Min: <span class="text-slate-300">{{ stats()?.min_hum !== undefined ? stats()?.min_hum + '%' : 'brak danych' }}</span> / Max: <span class="text-slate-300">{{ stats()?.max_hum !== undefined ? stats()?.max_hum + '%' : 'brak danych' }}</span>
                </div>
              </div>

              <div class="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
                <div class="text-slate-400 mb-1 flex items-center justify-between">
                  <span>Bateria czujnika</span>
                  <mat-icon class="text-emerald-400 !w-3.5 !h-3.5 text-xs">battery_charging_full</mat-icon>
                </div>
                <div class="text-xl font-bold font-mono text-emerald-400 tabular-nums">
                  {{ device()?.battery !== undefined && device()?.battery !== null ? device()?.battery + ' %' : 'brak danych' }}
                </div>
                <div class="text-[11px] text-slate-500 mt-1">Ogniwo CR2032/CR2450</div>
              </div>

              <div class="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
                <div class="text-slate-400 mb-1 flex items-center justify-between">
                  <span>Próbki w SQLite</span>
                  <mat-icon class="text-slate-400 !w-3.5 !h-3.5 text-xs">storage</mat-icon>
                </div>
                <div class="text-xl font-bold font-mono text-slate-200 tabular-nums">
                  {{ (stats()?.count ?? historyPoints().length) > 0 ? (stats()?.count ?? historyPoints().length) : 'brak danych' }}
                </div>
                <div class="text-[11px] text-slate-500 mt-1">Zarejestrowane rekordy</div>
              </div>
            </div>

            <!-- Obszar wykresu Chart.js -->
            <div class="bg-slate-950 border border-slate-800 rounded-xl p-4 relative min-h-[350px]">
              @if (isLoading()) {
                <div class="absolute inset-0 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center text-cyan-400 z-10">
                  <div class="flex items-center gap-2 text-xs font-mono">
                    <mat-icon class="animate-spin text-base">refresh</mat-icon>
                    Pobieranie historii z bazy SQLite...
                  </div>
                </div>
              }
              @if (historyPoints().length > 0) {
                <div class="w-full h-[320px]">
                  <canvas #chartCanvas></canvas>
                </div>
              } @else if (!isLoading()) {
                <div class="flex flex-col items-center justify-center h-[320px] text-center p-6 border border-dashed border-slate-800/80 rounded-xl">
                  <mat-icon class="text-4xl text-slate-600 mb-2">signal_wifi_bad</mat-icon>
                  <p class="text-sm font-semibold text-slate-300">brak danych</p>
                  <p class="text-xs text-slate-500 max-w-sm mt-1">
                    Brak odnotowanych próbek w bazie SQLite dla wybranego zakresu czasu ({{ activeRange() }}). Dane nie są sztucznie syntetyzowane.
                  </p>
                </div>
              }
            </div>
          </div>

          <!-- Stopka modala -->
          <div class="p-4 border-t border-slate-800 bg-slate-900/50 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <div class="flex items-center gap-2">
              <span class="inline-block w-2 h-2 rounded-full bg-cyan-400"></span>
              <span>Lewa oś: Temperatura (°C)</span>
              <span class="text-slate-600">·</span>
              <span class="inline-block w-2 h-2 rounded-full bg-blue-500"></span>
              <span>Prawa oś: Wilgotność (%)</span>
            </div>
            <button
              (click)="closed.emit()"
              class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors"
            >
              Zamknij
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class AnalyticsModal {
  readonly device = input<Device | null>(null);
  readonly closed = output<void>();

  private telemetry = inject(Telemetry);
  private platformId = inject(PLATFORM_ID);
  private chartCanvas = viewChild<ElementRef<HTMLCanvasElement>>('chartCanvas');

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
  readonly isLoading = signal<boolean>(false);
  readonly stats = signal<HistoryStats | null>(null);
  readonly historyPoints = signal<TelemetryPoint[]>([]);
  readonly isEditingName = signal<boolean>(false);

  private chartInstance: Chart | null = null;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      Chart.register(...registerables);
    }

    effect(() => {
      const dev = this.device();
      const range = this.activeRange();
      if (dev) {
        this.loadHistory(dev.ieee_address, range);
      }
    });
  }

  setRange(range: string): void {
    this.activeRange.set(range);
  }

  startEditingName(): void {
    this.isEditingName.set(true);
  }

  cancelEditingName(): void {
    this.isEditingName.set(false);
  }

  saveNewName(newName: string): void {
    const dev = this.device();
    if (dev && newName.trim() && newName.trim() !== dev.friendly_name) {
      this.telemetry.renameDevice(dev.ieee_address, newName.trim());
    }
    this.isEditingName.set(false);
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
        console.error('Błąd pobierania historii:', err);
      },
    });
  }

  private renderChart(history: TelemetryPoint[], range: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const canvasRef = this.chartCanvas();
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

    const tempGradient = ctx.createLinearGradient(0, 0, 0, 300);
    tempGradient.addColorStop(0, 'rgba(6, 182, 212, 0.28)');
    tempGradient.addColorStop(1, 'rgba(6, 182, 212, 0.0)');

    const humGradient = ctx.createLinearGradient(0, 0, 0, 300);
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
            position: 'top',
            align: 'end',
            labels: {
              color: '#94a3b8',
              font: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
              usePointStyle: true,
              boxWidth: 8,
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
              maxTicksLimit: 8,
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
}
