import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { Chart, registerables } from 'chart.js';
import type { Device, TelemetryPoint, Z2mExpose } from '../../models/telemetry.models';
import { Telemetry } from '../../services/telemetry';
import { flattenExposes } from '../../../backend/state-mapper';

type Range = '24h' | '7d' | '30d' | '360d';

/** Ustawienie przekaźnika (nazwy atrybutów jak w Zigbee2MQTT). */
interface SettingDef {
  key: string;
  label: string;
  kind: 'toggle' | 'number' | 'select';
  unit?: string;
  /** Zakres używany, gdy Zigbee2MQTT nie poda własnego. */
  min?: number;
  max?: number;
  step?: number;
  /** Przełącznik, od którego zależy to pole (np. próg prądu działa tylko przy włączonej ochronie). */
  enabledBy?: string;
}

const SETTINGS: SettingDef[] = [
  { key: 'power_on_behavior', label: 'Stan po powrocie zasilania', kind: 'select' },
  { key: 'network_indicator', label: 'Niebieska dioda sieci', kind: 'toggle' },
  { key: 'outlet_control_protect', label: 'Ochrona przeciążeniowa wyjścia', kind: 'toggle' },
  { key: 'ac_current_max_overload_enable', label: 'Ochrona nadprądowa', kind: 'toggle' },
  { key: 'ac_current_max_overload', label: 'Próg prądu', kind: 'number', unit: 'A', min: 0.1, max: 32, step: 0.1, enabledBy: 'ac_current_max_overload_enable' },
  { key: 'ac_voltage_max_overload_enable', label: 'Ochrona nadnapięciowa', kind: 'toggle' },
  { key: 'ac_voltage_max_overload', label: 'Próg napięcia', kind: 'number', unit: 'V', min: 85, max: 277, step: 1, enabledBy: 'ac_voltage_max_overload_enable' },
  { key: 'ac_power_max_overload_enable', label: 'Ochrona mocy', kind: 'toggle' },
  { key: 'ac_power_max_overload', label: 'Próg mocy', kind: 'number', unit: 'W', min: 10, max: 7680, step: 1, enabledBy: 'ac_power_max_overload_enable' },
];

const POWER_ON_LABELS: Record<string, string> = {
  off: 'wyłączony',
  on: 'włączony',
  toggle: 'odwrotnie niż przed zanikiem',
  previous: 'jak przed zanikiem',
};

interface Inching {
  inching_control: 'ENABLE' | 'DISABLE';
  inching_time: number;
  inching_mode: 'ON' | 'OFF';
}

const INCHING_KEY = 'inching_control_set';
/** Znamionowe wartości BASIC-ZB1GSP: 32 A / 7680 W. */
const RATED_CURRENT = 32;

const fmt = (v: unknown, digits = 0): string =>
  typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('pl-PL', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : '—';

/**
 * Sekcja jednego przekaźnika SONOFF BASIC-ZB1GSP w Monitorze Energii:
 * pomiary na żywo, wykresy, załączanie i ustawienia ochrony (przez Zigbee2MQTT).
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-power-switch-panel',
  imports: [MatIconModule],
  template: `
    <section class="rounded-2xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden">
      <!-- Nagłówek: widoczny także po zwinięciu, z szybkim załączaniem -->
      <div class="flex flex-wrap items-center gap-3 p-4">
        <button
          (click)="toggled.emit()"
          class="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
          [attr.aria-expanded]="open()"
        >
          <mat-icon class="text-slate-400 shrink-0">{{ open() ? 'expand_less' : 'expand_more' }}</mat-icon>
          <mat-icon class="shrink-0" [class.text-emerald-400]="isOn()" [class.text-slate-500]="!isOn()">electrical_services</mat-icon>
          <div class="min-w-0">
            <div class="font-bold text-white truncate">{{ device().friendly_name }}</div>
            <div class="text-[11px] font-mono text-slate-400 truncate">SONOFF BASIC-ZB1GSP · {{ device().ieee_address }}</div>
          </div>
        </button>

        <div class="flex items-center gap-2 text-xs font-mono">
          @if (offline()) {
            <span class="px-2 py-0.5 rounded-lg bg-rose-950 border border-rose-800 text-rose-300">offline</span>
          }
          <span class="px-2 py-0.5 rounded-lg bg-slate-950 border border-slate-800 text-amber-300">{{ watts(device().power) }}</span>
          <span
            class="px-2 py-0.5 rounded-lg border"
            [class.bg-emerald-950]="isOn()"
            [class.border-emerald-700]="isOn()"
            [class.text-emerald-300]="isOn()"
            [class.bg-slate-950]="!isOn()"
            [class.border-slate-800]="!isOn()"
            [class.text-slate-400]="!isOn()"
          >
            {{ stateLabel() }}
          </span>
          <button
            (click)="toggleState()"
            [disabled]="busy() || offline()"
            class="px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            [class.bg-rose-700]="isOn()"
            [class.hover:bg-rose-600]="isOn()"
            [class.bg-emerald-700]="!isOn()"
            [class.hover:bg-emerald-600]="!isOn()"
            [class.text-white]="true"
          >
            <mat-icon class="text-sm !w-4 !h-4">power_settings_new</mat-icon>
            <span>{{ isOn() ? 'Wyłącz' : 'Włącz' }}</span>
          </button>
        </div>
      </div>

      @if (message(); as m) {
        <div class="mx-4 mb-3 px-3 py-2 rounded-lg text-xs" [class.bg-emerald-950]="m.ok" [class.text-emerald-300]="m.ok" [class.bg-rose-950]="!m.ok" [class.text-rose-300]="!m.ok">
          {{ m.text }}
        </div>
      }

      @if (open()) {
        <div class="px-4 pb-5 space-y-5 border-t border-slate-800 pt-4">
          <!-- Pomiary -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
            @for (t of tiles(); track t.label) {
              <div class="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
                <div class="text-[11px] text-slate-400">{{ t.label }}</div>
                <div class="text-lg font-bold font-mono mt-0.5" [class]="t.color">{{ t.value }}</div>
              </div>
            }
          </div>

          <!-- Obciążenie względem progu -->
          <div>
            <div class="flex justify-between text-[11px] font-mono text-slate-400 mb-1">
              <span>Obciążenie: {{ fmt(device().current, 2) }} A z {{ fmt(currentLimit(), 1) }} A ({{ currentLimitSource() }})</span>
              <span>{{ loadPercent() }}%</span>
            </div>
            <div class="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                class="h-full rounded-full transition-all"
                [style.width.%]="loadPercent()"
                [class.bg-emerald-500]="loadPercent() < 70"
                [class.bg-amber-500]="loadPercent() >= 70 && loadPercent() < 90"
                [class.bg-rose-500]="loadPercent() >= 90"
              ></div>
            </div>
          </div>

          <!-- Wykres mocy -->
          <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h4 class="text-sm font-bold text-white">Moc i napięcie</h4>
              <div class="flex gap-1">
                @for (r of ranges; track r.id) {
                  <button
                    (click)="setRange(r.id)"
                    class="px-2.5 py-1 rounded-lg text-xs font-mono cursor-pointer border"
                    [class.bg-amber-500/20]="range() === r.id"
                    [class.text-amber-300]="range() === r.id"
                    [class.border-amber-500/40]="range() === r.id"
                    [class.bg-slate-900]="range() !== r.id"
                    [class.text-slate-400]="range() !== r.id"
                    [class.border-slate-800]="range() !== r.id"
                  >
                    {{ r.label }}
                  </button>
                }
              </div>
            </div>
            <div class="relative h-64">
              @if (history().length === 0) {
                <div class="absolute inset-0 flex items-center justify-center text-xs text-slate-500">Brak pomiarów w tym zakresie.</div>
              }
              <canvas #powerCanvas></canvas>
            </div>
          </div>

          <!-- Zużycie dzienne -->
          <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h4 class="text-sm font-bold text-white">Zużycie dzienne</h4>
              <div class="flex gap-1">
                @for (d of [30, 365]; track d) {
                  <button
                    (click)="setDays(d)"
                    class="px-2.5 py-1 rounded-lg text-xs font-mono cursor-pointer border"
                    [class.bg-emerald-500/20]="days() === d"
                    [class.text-emerald-300]="days() === d"
                    [class.border-emerald-500/40]="days() === d"
                    [class.bg-slate-900]="days() !== d"
                    [class.text-slate-400]="days() !== d"
                    [class.border-slate-800]="days() !== d"
                  >
                    {{ d === 30 ? '30 dni' : 'rok' }}
                  </button>
                }
              </div>
            </div>
            <div class="relative h-56">
              @if (daily().length === 0) {
                <div class="absolute inset-0 flex items-center justify-center text-xs text-slate-500">Brak danych o zużyciu — pojawią się po pierwszych odczytach licznika.</div>
              }
              <canvas #dailyCanvas></canvas>
            </div>
            @if (daily().length > 0) {
              <div class="text-[11px] font-mono text-slate-400 mt-2">Suma w okresie: {{ fmt(dailySum(), 2) }} kWh</div>
            }
          </div>

          <!-- Ustawienia przekaźnika -->
          <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h4 class="text-sm font-bold text-white flex items-center gap-1.5">
                <mat-icon class="text-sm !w-4 !h-4 text-amber-400">tune</mat-icon>
                Ustawienia przekaźnika
              </h4>
              <button
                (click)="readSettings()"
                [disabled]="busy() || offline()"
                class="px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 cursor-pointer disabled:opacity-40"
              >
                <mat-icon class="text-sm !w-4 !h-4">sync</mat-icon>
                Odczytaj z urządzenia
              </button>
            </div>

            @if (settings().length === 0 && !hasInching()) {
              <div class="text-xs text-slate-500">Zigbee2MQTT nie zgłosił ustawień tego urządzenia.</div>
            }

            <div class="grid sm:grid-cols-2 gap-3">
              @for (s of settings(); track s.key) {
                <label class="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-slate-900 border text-xs"
                  [class.border-amber-500/50]="isDirty(s.key)" [class.border-slate-800]="!isDirty(s.key)"
                  [class.opacity-50]="isDisabledByParent(s)">
                  <span class="text-slate-300">
                    {{ s.label }}
                    @if (isUnknown(s.key)) { <span class="text-slate-500">(nieodczytane)</span> }
                  </span>
                  @switch (s.kind) {
                    @case ('toggle') {
                      <input type="checkbox" class="w-4 h-4 accent-amber-500 cursor-pointer"
                        [checked]="isToggleOn(s.key)"
                        (change)="setToggle(s.key, $any($event.target).checked)" />
                    }
                    @case ('number') {
                      <span class="flex items-center gap-1">
                        <input type="number" class="w-24 px-2 py-1 rounded bg-slate-950 border border-slate-700 text-white font-mono text-right"
                          [min]="s.min" [max]="s.max" [step]="s.step"
                          [value]="valueOf(s.key) ?? ''"
                          (change)="setNumber(s.key, $any($event.target).value)" />
                        <span class="text-slate-500 w-4">{{ s.unit }}</span>
                      </span>
                    }
                    @case ('select') {
                      <select class="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-white"
                        (change)="setValue(s.key, $any($event.target).value)">
                        @if (isUnknown(s.key)) { <option value="" selected disabled>—</option> }
                        @for (o of optionsOf(s.key); track o) {
                          <option [value]="o" [selected]="valueOf(s.key) === o">{{ powerOnLabel(o) }}</option>
                        }
                      </select>
                    }
                  }
                </label>
              }
            </div>

            @if (hasInching()) {
              <div class="p-3 rounded-lg bg-slate-900 border text-xs space-y-2"
                [class.border-amber-500/50]="isDirty(inchingKey)" [class.border-slate-800]="!isDirty(inchingKey)">
                <div class="flex items-center justify-between gap-3">
                  <span class="text-slate-300">
                    Tryb impulsowy (samo przełączenie po czasie)
                    @if (!device().raw_state?.[inchingKey] && !isDirty(inchingKey)) { <span class="text-slate-500">(urządzenie go nie raportuje)</span> }
                  </span>
                  <input type="checkbox" class="w-4 h-4 accent-amber-500 cursor-pointer"
                    [checked]="inching().inching_control === 'ENABLE'"
                    (change)="setInching({ inching_control: $any($event.target).checked ? 'ENABLE' : 'DISABLE' })" />
                </div>
                <div class="flex flex-wrap items-center gap-3" [class.opacity-50]="inching().inching_control !== 'ENABLE'">
                  <select class="px-2 py-1 rounded bg-slate-950 border border-slate-700 text-white"
                    (change)="setInching({ inching_mode: $any($event.target).value })">
                    <option value="ON" [selected]="inching().inching_mode === 'ON'">wyłącz po czasie od załączenia</option>
                    <option value="OFF" [selected]="inching().inching_mode === 'OFF'">załącz po czasie od wyłączenia</option>
                  </select>
                  <span class="flex items-center gap-1">
                    <input type="number" class="w-24 px-2 py-1 rounded bg-slate-950 border border-slate-700 text-white font-mono text-right"
                      [min]="inchingRange().min" [max]="inchingRange().max" step="0.5"
                      [value]="inching().inching_time"
                      (change)="setInching({ inching_time: +$any($event.target).value })" />
                    <span class="text-slate-500">s</span>
                  </span>
                </div>
              </div>
            }

            <div class="flex flex-wrap items-center justify-end gap-2">
              @if (dirtyKeys().length > 0) {
                <button (click)="discard()" class="px-3 py-1.5 rounded-lg text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer">Odrzuć zmiany</button>
              }
              <button
                (click)="save()"
                [disabled]="dirtyKeys().length === 0 || busy() || offline()"
                class="px-4 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Zapisz w przekaźniku ({{ dirtyKeys().length }})
              </button>
            </div>
          </div>
        </div>
      }
    </section>
  `,
})
export class PowerSwitchPanel implements OnDestroy {
  private readonly telemetry = inject(Telemetry);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly device = input.required<Device>();
  readonly open = input<boolean>(false);
  readonly toggled = output<void>();

  readonly ranges: { id: Range; label: string }[] = [
    { id: '24h', label: '24 h' },
    { id: '7d', label: '7 dni' },
    { id: '30d', label: '30 dni' },
    { id: '360d', label: 'rok' },
  ];
  readonly inchingKey = INCHING_KEY;
  readonly fmt = fmt;

  readonly range = signal<Range>('24h');
  readonly days = signal<number>(30);
  readonly history = signal<TelemetryPoint[]>([]);
  readonly daily = signal<{ day: string; energy: number }[]>([]);
  readonly busy = signal(false);
  readonly message = signal<{ text: string; ok: boolean } | null>(null);
  /** Zmiany czekające na zapis (klucz atrybutu Zigbee2MQTT -> nowa wartość). */
  readonly draft = signal<Record<string, unknown>>({});

  private readonly powerCanvas = viewChild<ElementRef<HTMLCanvasElement>>('powerCanvas');
  private readonly dailyCanvas = viewChild<ElementRef<HTMLCanvasElement>>('dailyCanvas');
  private powerChart: Chart | null = null;
  private dailyChart: Chart | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private messageTimer: ReturnType<typeof setTimeout> | null = null;

  /** Cechy Zigbee2MQTT tego urządzenia, po nazwie atrybutu. */
  private readonly exposes = computed(() => {
    const map = new Map<string, Z2mExpose>();
    for (const f of flattenExposes(this.device().exposes)) if (f.property) map.set(f.property, f);
    return map;
  });

  private readonly raw = computed<Record<string, unknown>>(() => this.device().raw_state ?? {});

  readonly settings = computed(() => {
    const ex = this.exposes();
    return SETTINGS.filter((s) => ex.has(s.key)).map((s) => {
      const e = ex.get(s.key)!;
      return { ...s, min: e.value_min ?? s.min, max: e.value_max ?? s.max, step: e.value_step ?? s.step };
    });
  });

  readonly hasInching = computed(() => this.exposes().has(INCHING_KEY));

  readonly inchingRange = computed(() => {
    const f = this.exposes().get(INCHING_KEY)?.features?.find((x) => x.property === 'inching_time' || x.name === 'inching_time');
    return { min: f?.value_min ?? 0.5, max: f?.value_max ?? 3599.5 };
  });

  readonly inching = computed<Inching>(() => {
    const cur = (this.raw()[INCHING_KEY] ?? {}) as Partial<Inching>;
    const d = (this.draft()[INCHING_KEY] ?? {}) as Partial<Inching>;
    return {
      inching_control: d.inching_control ?? cur.inching_control ?? 'DISABLE',
      inching_time: d.inching_time ?? cur.inching_time ?? 1,
      inching_mode: d.inching_mode ?? cur.inching_mode ?? 'ON',
    };
  });

  readonly dirtyKeys = computed(() => Object.keys(this.draft()));

  readonly offline = computed(() => {
    const d = this.device();
    if (d.connection_status === 'offline' || d.available === false) return true;
    return !d.last_seen && d.available !== true;
  });

  readonly isOn = computed(() => String(this.device().state ?? '').toUpperCase() === 'ON');

  readonly stateLabel = computed(() => {
    const s = String(this.device().state ?? '').toUpperCase();
    return s === 'ON' ? 'załączony' : s === 'OFF' ? 'wyłączony' : 'stan nieznany';
  });

  readonly tiles = computed(() => {
    const d = this.device();
    const r = this.raw();
    const tiles = [
      { label: 'Moc', value: this.watts(d.power), color: 'text-amber-300' },
      { label: 'Napięcie', value: d.voltage == null ? '—' : `${fmt(d.voltage, 1)} V`, color: 'text-cyan-300' },
      { label: 'Prąd', value: d.current == null ? '—' : `${fmt(d.current, 2)} A`, color: 'text-sky-300' },
      { label: 'Energia dziś', value: this.kwh(r['energy_today']), color: 'text-emerald-300' },
      { label: 'Wczoraj', value: this.kwh(r['energy_yesterday']), color: 'text-emerald-300' },
      { label: 'Ten miesiąc', value: this.kwh(r['energy_month']), color: 'text-emerald-300' },
      { label: 'Łącznie', value: this.kwh(r['total_energy'] ?? r['energy']), color: 'text-emerald-300' },
    ];
    // Oddawanie energii (firmware 1.3.0+, np. mikroinstalacja za przekaźnikiem)
    if (this.exposes().has('output_energy_today') || r['total_output_energy'] !== undefined) {
      tiles.push({ label: 'Oddane łącznie', value: this.kwh(r['total_output_energy']), color: 'text-orange-300' });
    }
    return tiles;
  });

  /** Próg prądu: ustawiony w przekaźniku (gdy ochrona włączona) albo prąd znamionowy 32 A. */
  readonly currentLimit = computed(() => {
    const r = this.raw();
    const limit = r['ac_current_max_overload'];
    return r['ac_current_max_overload_enable'] === 'ON' && typeof limit === 'number' && limit > 0 ? limit : RATED_CURRENT;
  });

  readonly currentLimitSource = computed(() =>
    this.currentLimit() === RATED_CURRENT && this.raw()['ac_current_max_overload_enable'] !== 'ON' ? 'znamionowy' : 'próg ochrony',
  );

  readonly loadPercent = computed(() => {
    const c = this.device().current;
    if (typeof c !== 'number' || c <= 0) return 0;
    return Math.min(100, Math.round((c / this.currentLimit()) * 100));
  });

  readonly dailySum = computed(() => this.daily().reduce((s, d) => s + d.energy, 0));

  constructor() {
    if (!this.browser) return;
    Chart.register(...registerables);

    // Dane wykresów pobieramy tylko dla rozwiniętej sekcji
    effect(() => {
      if (!this.open()) {
        this.stopRefresh();
        return;
      }
      this.range();
      this.days();
      // Bez śledzenia urządzenia: każda nowa próbka mocy nie powinna przeładowywać historii
      untracked(() => void this.loadCharts());
      this.startRefresh();
    });

    effect(() => this.drawPower(this.history(), this.powerCanvas()?.nativeElement));
    effect(() => this.drawDaily(this.daily(), this.dailyCanvas()?.nativeElement));
  }

  ngOnDestroy(): void {
    this.stopRefresh();
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.powerChart?.destroy();
    this.dailyChart?.destroy();
  }

  // --- formatowanie ---

  watts(v: unknown): string {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
    return Math.abs(v) >= 1000 ? `${fmt(v / 1000, 2)} kW` : `${fmt(v, 0)} W`;
  }

  kwh(v: unknown): string {
    return typeof v === 'number' && Number.isFinite(v) ? `${fmt(v, 2)} kWh` : '—';
  }

  powerOnLabel(v: string): string {
    return POWER_ON_LABELS[v] ?? v;
  }

  // --- ustawienia ---

  valueOf(key: string): unknown {
    const d = this.draft();
    return key in d ? d[key] : this.raw()[key];
  }

  isUnknown(key: string): boolean {
    const v = this.valueOf(key);
    return v === undefined || v === null;
  }

  isDirty(key: string): boolean {
    return key in this.draft();
  }

  optionsOf(key: string): string[] {
    const values = this.exposes().get(key)?.values;
    return Array.isArray(values) && values.length > 0 ? values.map(String) : Object.keys(POWER_ON_LABELS);
  }

  private onOff(key: string): { on: unknown; off: unknown } {
    const e = this.exposes().get(key);
    return { on: e?.value_on ?? true, off: e?.value_off ?? false };
  }

  isToggleOn(key: string): boolean {
    const v = this.valueOf(key);
    const { on } = this.onOff(key);
    return v === on || v === true || v === 'ON';
  }

  isDisabledByParent(s: SettingDef): boolean {
    return !!s.enabledBy && !this.isToggleOn(s.enabledBy);
  }

  setToggle(key: string, checked: boolean): void {
    const { on, off } = this.onOff(key);
    this.setValue(key, checked ? on : off);
  }

  setNumber(key: string, raw: string): void {
    if (raw.trim() === '') return;
    this.setValue(key, Number(raw));
  }

  setValue(key: string, value: unknown): void {
    this.draft.update((d) => {
      const next = { ...d };
      // Wartość równa obecnej w urządzeniu nie jest zmianą
      if (value === this.raw()[key]) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  setInching(patch: Partial<Inching>): void {
    this.draft.update((d) => ({ ...d, [INCHING_KEY]: { ...this.inching(), ...patch } }));
  }

  discard(): void {
    this.draft.set({});
  }

  /** Sprawdza zakresy przed wysłaniem; zwraca opis błędu albo null. */
  private validate(patch: Record<string, unknown>): string | null {
    for (const s of this.settings()) {
      if (s.kind !== 'number' || !(s.key in patch)) continue;
      const v = patch[s.key];
      if (typeof v !== 'number' || !Number.isFinite(v)) return `${s.label}: podaj liczbę.`;
      if ((s.min !== undefined && v < s.min) || (s.max !== undefined && v > s.max)) {
        return `${s.label}: dozwolony zakres ${s.min}–${s.max} ${s.unit ?? ''}.`;
      }
    }
    const inch = patch[INCHING_KEY] as Inching | undefined;
    if (inch) {
      const { min, max } = this.inchingRange();
      const t = inch.inching_time;
      if (!Number.isFinite(t) || t < min || t > max || Math.round(t * 2) !== t * 2) {
        return `Tryb impulsowy: czas od ${min} do ${max} s, co 0,5 s.`;
      }
    }
    return null;
  }

  private describe(key: string, value: unknown): string {
    if (key === INCHING_KEY) {
      const i = value as Inching;
      return i.inching_control === 'ENABLE'
        ? `tryb impulsowy: ${i.inching_mode === 'ON' ? 'wyłącz' : 'załącz'} po ${i.inching_time} s`
        : 'tryb impulsowy: wyłączony';
    }
    const s = SETTINGS.find((x) => x.key === key);
    const label = s?.label ?? key;
    if (s?.kind === 'toggle') return `${label}: ${this.isToggleOn(key) ? 'włączone' : 'wyłączone'}`;
    if (s?.kind === 'select') return `${label}: ${this.powerOnLabel(String(value))}`;
    return `${label}: ${value} ${s?.unit ?? ''}`.trim();
  }

  async save(): Promise<void> {
    const patch = { ...this.draft() };
    const error = this.validate(patch);
    if (error) return this.flash(error, false);
    const lines = Object.entries(patch).map(([k, v]) => `• ${this.describe(k, v)}`);
    if (!confirm(`Zapisać w przekaźniku „${this.device().friendly_name}”?\n\n${lines.join('\n')}`)) return;
    this.busy.set(true);
    const ok = await this.telemetry.sendDeviceCommand(this.device().ieee_address, patch);
    this.busy.set(false);
    if (!ok) return this.flash(this.device().last_error || 'Zigbee2MQTT nie przyjął zmian.', false);
    this.draft.set({});
    this.flash('Wysłano. Wartości odświeżą się, gdy przekaźnik potwierdzi zmianę.', true);
    // Przekaźnik nie zawsze sam raportuje zapisane progi — dopytujemy o nie
    setTimeout(() => void this.readSettings(true), 2000);
  }

  async readSettings(silent = false): Promise<void> {
    const ex = this.exposes();
    const keys = SETTINGS.map((s) => s.key).filter((k) => ex.has(k));
    if (keys.length === 0) return;
    const res = await this.telemetry.readDeviceAttributes(this.device().ieee_address, keys);
    if (!silent) this.flash(res.success ? 'Zapytano przekaźnik o ustawienia — wyniki pojawią się za chwilę.' : res.message, res.success);
  }

  async toggleState(): Promise<void> {
    const d = this.device();
    const next = this.isOn() ? 'OFF' : 'ON';
    const question =
      next === 'OFF'
        ? `Wyłączyć „${d.friendly_name}”? Przekaźnik odetnie zasilanie podłączonego obwodu.`
        : `Załączyć „${d.friendly_name}”?`;
    if (!confirm(question)) return;
    this.busy.set(true);
    const ok = await this.telemetry.sendDeviceCommand(d.ieee_address, { state: next });
    this.busy.set(false);
    if (!ok) this.flash(this.device().last_error || 'Polecenie nie zostało wykonane.', false);
  }

  private flash(text: string, ok: boolean): void {
    this.message.set({ text, ok });
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => this.message.set(null), 8000);
  }

  // --- wykresy ---

  setRange(r: Range): void {
    this.range.set(r);
  }

  setDays(d: number): void {
    this.days.set(d);
  }

  private startRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => void this.loadCharts(), 5 * 60_000);
  }

  private stopRefresh(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  private async loadCharts(): Promise<void> {
    const ieee = this.device().ieee_address;
    try {
      const [h, d] = await Promise.all([
        firstValueFrom(this.telemetry.fetchDeviceHistory(ieee, this.range())),
        firstValueFrom(this.telemetry.fetchDailyEnergy(ieee, this.days())),
      ]);
      this.history.set(h.history.filter((p) => p.values?.['power'] !== undefined || p.values?.['voltage'] !== undefined));
      this.daily.set(d.days);
    } catch {
      this.flash('Nie udało się pobrać historii przekaźnika.', false);
    }
  }

  private drawPower(points: TelemetryPoint[], canvas: HTMLCanvasElement | undefined): void {
    this.powerChart?.destroy();
    this.powerChart = null;
    if (!canvas || points.length === 0) return;
    const long = this.range() === '30d' || this.range() === '360d';
    const labels = points.map((p) =>
      new Date(p.timestamp).toLocaleString('pl-PL', long ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    );
    const series = (key: string) => points.map((p) => p.values?.[key] ?? null);
    this.powerChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Moc (W)', data: series('power'), borderColor: '#fbbf24', backgroundColor: '#fbbf2433', fill: true, borderWidth: 1.5, pointRadius: 0, tension: 0.2, yAxisID: 'y', spanGaps: true },
          { label: 'Napięcie (V)', data: series('voltage'), borderColor: '#22d3ee', borderWidth: 1, borderDash: [4, 3], pointRadius: 0, tension: 0.2, yAxisID: 'v', spanGaps: true },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#cbd5e1', boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: '#64748b', maxTicksLimit: 10 }, grid: { color: '#1e293b' } },
          y: { beginAtZero: true, ticks: { color: '#64748b' }, grid: { color: '#1e293b' }, title: { display: true, text: 'W', color: '#64748b' } },
          v: { position: 'right', ticks: { color: '#22d3ee' }, grid: { display: false }, title: { display: true, text: 'V', color: '#22d3ee' } },
        },
      },
    });
  }

  private drawDaily(days: { day: string; energy: number }[], canvas: HTMLCanvasElement | undefined): void {
    this.dailyChart?.destroy();
    this.dailyChart = null;
    if (!canvas || days.length === 0) return;
    this.dailyChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: days.map((d) => d.day.slice(5).split('-').reverse().join('.')),
        datasets: [{ label: 'Zużycie (kWh)', data: days.map((d) => d.energy), backgroundColor: '#34d399' }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: { legend: { labels: { color: '#cbd5e1', boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: '#64748b', maxTicksLimit: 15 }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: '#64748b' }, grid: { color: '#1e293b' }, title: { display: true, text: 'kWh', color: '#64748b' } },
        },
      },
    });
  }
}
