import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { Chart, registerables } from 'chart.js';
import type {
  InverterConfig,
  InverterDaily,
  InverterHistoryPoint,
  InverterInfo,
  InverterLive,
  InverterSettings,
  InverterStatus,
  TouSlot,
} from '../../models/inverter.models';

interface InverterState {
  status: InverterStatus;
  config: InverterConfig;
  live: InverterLive | null;
  settings: InverterSettings | null;
  info: InverterInfo | null;
  work_modes: Record<string, string>;
}

type Range = '24h' | '7d' | '30d' | '365d';

const SETTING_LABELS: Record<keyof InverterSettings, string> = {
  work_mode: 'tryb pracy',
  max_sell_power: 'maks. moc oddawania',
  solar_sell: 'sprzedaż z PV',
  battery_max_charge_current: 'prąd ładowania baterii',
  battery_max_discharge_current: 'prąd rozładowania baterii',
  grid_charge_current: 'prąd ładowania z sieci',
  grid_charge_enabled: 'ładowanie z sieci',
  tou_enabled: 'harmonogram włączony',
  tou: 'przedziały harmonogramu',
};

const COLORS = {
  pv: '#facc15',
  load: '#22d3ee',
  grid: '#f87171',
  battery: '#4ade80',
  soc: '#a78bfa',
  export: '#fb923c',
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-inverter-view',
  imports: [MatIconModule],
  template: `
    <div class="space-y-6">
      <!-- Nagłówek -->
      <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
        <div>
          <div class="inline-flex items-center gap-2 text-xs font-mono text-amber-400 mb-1.5">
            <mat-icon class="text-sm !w-4 !h-4">solar_power</mat-icon>
            <span>Deye · logger Solarman (Modbus przez Wi-Fi)</span>
          </div>
          <h2 class="text-xl md:text-2xl font-bold text-white tracking-tight">Falownik i magazyn energii</h2>
          <div class="flex flex-wrap items-center gap-2 mt-2 text-xs font-mono">
            @if (state(); as s) {
              @if (!s.status.configured) {
                <span class="px-2 py-0.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300">Nie skonfigurowano</span>
              } @else if (s.status.discovering) {
                <span class="px-2 py-0.5 rounded-lg bg-cyan-950 border border-cyan-700 text-cyan-300 animate-pulse">Szukam loggera w sieci…</span>
              } @else if (s.status.connected) {
                <span class="px-2 py-0.5 rounded-lg bg-emerald-950 border border-emerald-700 text-emerald-300">Online · {{ s.status.host }}</span>
              } @else {
                <span class="px-2 py-0.5 rounded-lg bg-rose-950 border border-rose-700 text-rose-300">Brak odczytu · {{ s.status.host || 'adres nieznany' }}</span>
              }
              @if (s.live) {
                <span class="text-slate-400">Odczyt: {{ fmtTime(s.live.timestamp) }} · stan: {{ s.live.status_label }}</span>
              }
              @if (s.info?.serial) {
                <span class="text-slate-500">SN {{ s.info?.serial }} · {{ s.info?.rated_power }} W</span>
              }
            }
          </div>
          @if (state()?.status?.last_error && !state()?.status?.connected) {
            <p class="text-xs text-rose-300 mt-1.5 font-mono">{{ state()?.status?.last_error }}</p>
          }
          @if (state()?.status?.last_discovery_result) {
            <p class="text-[11px] text-slate-500 mt-1 font-mono">Wyszukiwanie {{ fmtTime(state()?.status?.last_discovery ?? null) }}: {{ state()?.status?.last_discovery_result }}</p>
          }
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button type="button" (click)="refresh()" [disabled]="busy()"
            class="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white border border-slate-700 cursor-pointer">
            <mat-icon class="text-sm !w-4 !h-4">refresh</mat-icon> Odczytaj teraz
          </button>
          <button type="button" (click)="discover()" [disabled]="busy() || !state()?.status?.configured"
            class="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white border border-slate-700 cursor-pointer"
            title="Przeszukaj sieć w poszukiwaniu loggera (port 8899)">
            <mat-icon class="text-sm !w-4 !h-4">travel_explore</mat-icon> Szukaj loggera
          </button>
        </div>
      </div>

      @if (message(); as m) {
        <div class="p-3 rounded-xl text-xs font-mono border"
          [class.bg-emerald-950/60]="m.ok" [class.border-emerald-700]="m.ok" [class.text-emerald-300]="m.ok"
          [class.bg-rose-950/60]="!m.ok" [class.border-rose-700]="!m.ok" [class.text-rose-300]="!m.ok">
          {{ m.text }}
        </div>
      }

      <!-- Odczyt bieżący -->
      @if (live(); as l) {
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800">
            <div class="flex items-center justify-between text-xs text-slate-400"><span>Fotowoltaika</span><mat-icon class="text-amber-400 text-base">wb_sunny</mat-icon></div>
            <div class="text-2xl font-bold font-mono text-amber-300 mt-1">{{ watts(l.pv_power) }}</div>
            <div class="text-[11px] font-mono text-slate-500 mt-1">PV1 {{ l.pv1_power }} W · {{ l.pv1_voltage }} V</div>
            <div class="text-[11px] font-mono text-slate-500">PV2 {{ l.pv2_power }} W · {{ l.pv2_voltage }} V</div>
          </div>
          <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800">
            <div class="flex items-center justify-between text-xs text-slate-400"><span>Bateria</span><mat-icon class="text-emerald-400 text-base">battery_charging_full</mat-icon></div>
            <div class="text-2xl font-bold font-mono text-emerald-300 mt-1">{{ l.battery_soc }}%</div>
            <div class="w-full bg-slate-800 rounded-full h-1.5 mt-1.5 overflow-hidden"><div class="h-full bg-emerald-500" [style.width.%]="l.battery_soc"></div></div>
            <div class="text-[11px] font-mono text-slate-400 mt-1.5">{{ batteryFlow(l.battery_power) }}</div>
            <div class="text-[11px] font-mono text-slate-500">{{ l.battery_voltage }} V · {{ l.battery_current }} A · {{ l.battery_temp }}°C</div>
          </div>
          <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800">
            <div class="flex items-center justify-between text-xs text-slate-400"><span>Sieć</span><mat-icon class="text-rose-400 text-base">electrical_services</mat-icon></div>
            <div class="text-2xl font-bold font-mono mt-1" [class.text-rose-300]="l.grid_power > 0" [class.text-orange-300]="l.grid_power < 0" [class.text-slate-300]="l.grid_power === 0">
              {{ watts(abs(l.grid_power)) }}
            </div>
            <div class="text-[11px] font-mono text-slate-400 mt-1">{{ l.grid_power > 0 ? 'pobór z sieci' : l.grid_power < 0 ? 'oddawanie do sieci' : 'bez wymiany' }}</div>
            <div class="text-[11px] font-mono text-slate-500">L1 {{ l.grid_l1_power }} · L2 {{ l.grid_l2_power }} · L3 {{ l.grid_l3_power }} W</div>
            <div class="text-[11px] font-mono text-slate-500">{{ l.grid_l1_voltage }} / {{ l.grid_l2_voltage }} / {{ l.grid_l3_voltage }} V · {{ l.grid_frequency }} Hz</div>
          </div>
          <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800">
            <div class="flex items-center justify-between text-xs text-slate-400"><span>Dom (zużycie)</span><mat-icon class="text-cyan-400 text-base">home</mat-icon></div>
            <div class="text-2xl font-bold font-mono text-cyan-300 mt-1">{{ watts(l.load_power) }}</div>
            <div class="text-[11px] font-mono text-slate-500 mt-1">L1 {{ l.load_l1_power }} · L2 {{ l.load_l2_power }} · L3 {{ l.load_l3_power }} W</div>
            <div class="text-[11px] font-mono text-slate-500">Falownik {{ l.inverter_power }} W · radiator {{ l.radiator_temp }}°C</div>
          </div>
        </div>

        <!-- Energia dziś -->
        <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div class="text-xs text-slate-400 mb-3 flex items-center gap-2">
            <mat-icon class="text-sm !w-4 !h-4">today</mat-icon>
            <span>Energia dziś (wg zegara falownika: {{ l.inverter_time ?? 'brak' }})</span>
          </div>
          <div class="grid grid-cols-3 md:grid-cols-6 gap-3 text-xs font-mono">
            @for (e of todayTiles(); track e.label) {
              <div class="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <div class="text-slate-400 text-[11px]">{{ e.label }}</div>
                <div class="text-base font-bold" [style.color]="e.color">{{ e.today }} kWh</div>
                <div class="text-[10px] text-slate-500">łącznie {{ e.total }} kWh</div>
              </div>
            }
          </div>
        </div>
      } @else if (state()?.status?.configured) {
        <div class="p-6 rounded-2xl bg-slate-900 border border-dashed border-slate-700 text-center text-sm text-slate-400">
          Brak odczytu z falownika. Panel ponawia próbę co {{ state()?.config?.poll_seconds }} s, a po dwóch nieudanych próbach szuka loggera w sieci.
        </div>
      }

      <!-- Wykres mocy -->
      @if (state()?.status?.configured) {
        <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div class="text-sm font-semibold text-white flex items-center gap-2"><mat-icon class="text-sm !w-4 !h-4 text-amber-400">show_chart</mat-icon> Moc i stan baterii</div>
            <div class="flex gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
              @for (r of ranges; track r.key) {
                <button type="button" (click)="range.set(r.key)" class="px-2.5 py-1 rounded cursor-pointer"
                  [class.bg-slate-700]="range() === r.key" [class.text-white]="range() === r.key" [class.text-slate-400]="range() !== r.key">{{ r.label }}</button>
              }
            </div>
          </div>
          <div class="relative h-[320px]">
            <canvas #powerCanvas></canvas>
            @if (history().length === 0) {
              <div class="absolute inset-0 flex items-center justify-center text-xs text-slate-500">Brak zapisanych odczytów w tym zakresie.</div>
            }
          </div>
          <p class="text-[11px] text-slate-500 mt-2">
            Średnie z {{ bucketLabel() }}. Sieć: dodatnia = pobór, ujemna = oddawanie. Bateria: dodatnia = rozładowanie, ujemna = ładowanie. Historia jest przechowywana przez rok.
          </p>
        </div>

        <!-- Energia dzienna -->
        <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800">
          <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div class="text-sm font-semibold text-white flex items-center gap-2"><mat-icon class="text-sm !w-4 !h-4 text-emerald-400">bar_chart</mat-icon> Energia dzienna</div>
            <div class="flex gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
              @for (d of dayRanges; track d) {
                <button type="button" (click)="days.set(d)" class="px-2.5 py-1 rounded cursor-pointer"
                  [class.bg-slate-700]="days() === d" [class.text-white]="days() === d" [class.text-slate-400]="days() !== d">{{ d }} dni</button>
              }
            </div>
          </div>
          <div class="relative h-[280px]">
            <canvas #dailyCanvas></canvas>
            @if (daily().length === 0) {
              <div class="absolute inset-0 flex items-center justify-center text-xs text-slate-500">Brak zapisanych dni.</div>
            }
          </div>
          @if (dailySum(); as s) {
            <p class="text-[11px] font-mono text-slate-400 mt-2">
              Suma z {{ daily().length }} dni: PV {{ s.pv }} kWh · dom {{ s.load }} kWh · pobór {{ s.grid_import }} kWh · oddanie {{ s.grid_export }} kWh
            </p>
          }
        </div>
      }

      <!-- Sterowanie -->
      @if (state(); as s) {
        @if (s.status.configured && draft(); as d) {
          <div class="p-5 rounded-2xl bg-slate-900 border space-y-4" [class.border-amber-700]="s.config.control_enabled" [class.border-slate-800]="!s.config.control_enabled">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="text-sm font-semibold text-white flex items-center gap-2"><mat-icon class="text-sm !w-4 !h-4 text-amber-400">tune</mat-icon> Sterowanie falownikiem</div>
                <p class="text-[11px] text-slate-400 mt-1 max-w-2xl">
                  Zmiany trafiają bezpośrednio do rejestrów falownika (Modbus, bez hasła). Panel zapisuje tylko zmienione pola, w dozwolonych zakresach,
                  a potem odczytuje je z powrotem i zapisuje w dzienniku zdarzeń. Ustawienia baterii (napięcia, typ, progi wyłączenia) są tylko do odczytu.
                </p>
              </div>
              <button type="button" (click)="toggleControl()"
                class="px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer"
                [class.bg-amber-500/20]="s.config.control_enabled" [class.text-amber-300]="s.config.control_enabled" [class.border-amber-600]="s.config.control_enabled"
                [class.bg-slate-950]="!s.config.control_enabled" [class.text-slate-300]="!s.config.control_enabled" [class.border-slate-700]="!s.config.control_enabled">
                {{ s.config.control_enabled ? 'Sterowanie WŁĄCZONE — wyłącz' : 'Sterowanie wyłączone — włącz' }}
              </button>
            </div>

            <fieldset [disabled]="!s.config.control_enabled || busy()" class="space-y-4 disabled:opacity-60">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <label class="space-y-1">
                  <span class="text-slate-400 block">Tryb pracy</span>
                  <select [value]="d.work_mode" (change)="patch('work_mode', +$any($event.target).value)"
                    class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white">
                    @for (m of workModes(); track m.value) {
                      <option [value]="m.value" [selected]="m.value === d.work_mode">{{ m.label }}</option>
                    }
                  </select>
                </label>
                <label class="space-y-1">
                  <span class="text-slate-400 block">Maks. moc oddawania do sieci (W)</span>
                  <input type="number" min="0" [max]="ratedPower()" step="100" [value]="d.max_sell_power" (change)="patch('max_sell_power', +$any($event.target).value)"
                    class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white" />
                </label>
                <label class="flex items-center gap-2 pt-5">
                  <input type="checkbox" [checked]="d.solar_sell" (change)="patch('solar_sell', $any($event.target).checked)" />
                  <span class="text-slate-300">Sprzedaż nadwyżki z PV (solar sell)</span>
                </label>
                <label class="space-y-1">
                  <span class="text-slate-400 block">Maks. prąd ładowania baterii (A)</span>
                  <input type="number" min="0" max="150" [value]="d.battery_max_charge_current" (change)="patch('battery_max_charge_current', +$any($event.target).value)"
                    class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white" />
                </label>
                <label class="space-y-1">
                  <span class="text-slate-400 block">Maks. prąd rozładowania baterii (A)</span>
                  <input type="number" min="0" max="150" [value]="d.battery_max_discharge_current" (change)="patch('battery_max_discharge_current', +$any($event.target).value)"
                    class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white" />
                </label>
                <div class="space-y-1">
                  <span class="text-slate-400 block">Ładowanie baterii z sieci</span>
                  <div class="flex items-center gap-2">
                    <input type="checkbox" [checked]="d.grid_charge_enabled" (change)="patch('grid_charge_enabled', $any($event.target).checked)" />
                    <input type="number" min="0" max="150" [value]="d.grid_charge_current" (change)="patch('grid_charge_current', +$any($event.target).value)"
                      class="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white" />
                    <span class="text-slate-500">A</span>
                  </div>
                </div>
              </div>

              <div class="space-y-2">
                <label class="flex items-center gap-2 text-xs">
                  <input type="checkbox" [checked]="d.tou_enabled" (change)="patch('tou_enabled', $any($event.target).checked)" />
                  <span class="text-slate-300 font-semibold">Harmonogram (time of use)</span>
                  <span class="text-slate-500">— w każdym przedziale bateria nie schodzi poniżej SOC, a z zaznaczonym ładowaniem z sieci jest do niego doładowywana</span>
                </label>
                <div class="overflow-x-auto">
                  <table class="w-full text-xs font-mono">
                    <thead class="text-slate-500 text-left">
                      <tr><th class="py-1 pr-2">#</th><th class="py-1 pr-2">Od</th><th class="py-1 pr-2">Do</th><th class="py-1 pr-2">Moc baterii (W)</th><th class="py-1 pr-2">Min. SOC (%)</th><th class="py-1">Ładuj z sieci</th></tr>
                    </thead>
                    <tbody>
                      @for (slot of d.tou; track $index; let i = $index) {
                        <tr class="border-t border-slate-800">
                          <td class="py-1.5 pr-2 text-slate-500">{{ i + 1 }}</td>
                          <td class="py-1.5 pr-2">
                            <input type="time" step="300" [value]="slot.start" [disabled]="i === 0" (change)="patchSlot(i, 'start', $any($event.target).value)"
                              class="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-white disabled:opacity-60" />
                          </td>
                          <td class="py-1.5 pr-2 text-slate-400">{{ d.tou[i + 1]?.start ?? '24:00' }}</td>
                          <td class="py-1.5 pr-2">
                            <input type="number" min="0" [max]="ratedPower()" step="100" [value]="slot.power" (change)="patchSlot(i, 'power', +$any($event.target).value)"
                              class="w-24 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-white" />
                          </td>
                          <td class="py-1.5 pr-2">
                            <input type="number" min="5" max="100" [value]="slot.soc" (change)="patchSlot(i, 'soc', +$any($event.target).value)"
                              class="w-20 bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-white" />
                          </td>
                          <td class="py-1.5">
                            <input type="checkbox" [checked]="slot.grid_charge" (change)="patchSlot(i, 'grid_charge', $any($event.target).checked)" />
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-2">
                <button type="button" (click)="saveSettings()" [disabled]="changes().length === 0"
                  class="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-xs font-bold cursor-pointer">
                  Zapisz w falowniku ({{ changes().length }})
                </button>
                <button type="button" (click)="resetDraft()" [disabled]="changes().length === 0"
                  class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-xs cursor-pointer">Cofnij zmiany</button>
                @if (s.info; as info) {
                  <span class="text-[11px] text-slate-500 font-mono">
                    Bateria {{ info.battery_capacity_ah }} Ah · wyłączenie przy {{ info.battery_shutdown_soc }}% · niski stan {{ info.battery_low_soc }}% · ponowny start {{ info.battery_restart_soc }}% (tylko odczyt)
                  </span>
                }
              </div>
            </fieldset>
          </div>
        }

        <!-- Połączenie -->
        <div class="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div class="text-sm font-semibold text-white flex items-center gap-2"><mat-icon class="text-sm !w-4 !h-4 text-slate-400">settings_ethernet</mat-icon> Połączenie z loggerem</div>
          <p class="text-[11px] text-slate-400">
            Logger dostaje adres z DHCP. Gdy przestanie odpowiadać, panel sam przeszukuje podsieć (port {{ s.config.port }}) i rozpoznaje go po numerze seryjnym —
            adres poniżej zaktualizuje się automatycznie. Rezerwacja DHCP na routerze i tak jest wygodniejsza.
          </p>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            <label class="space-y-1"><span class="text-slate-400 block">Adres IP (ostatni znany)</span>
              <input #cfgHost [value]="s.config.host" placeholder="szukaj automatycznie" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white" /></label>
            <label class="space-y-1"><span class="text-slate-400 block">Numer seryjny loggera</span>
              <input #cfgSerial [value]="s.config.logger_serial" inputmode="numeric" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white" /></label>
            <label class="space-y-1"><span class="text-slate-400 block">Port</span>
              <input #cfgPort type="number" [value]="s.config.port" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white" /></label>
            <label class="space-y-1"><span class="text-slate-400 block">Adres Modbus (slave)</span>
              <input #cfgSlave type="number" [value]="s.config.slave" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white" /></label>
            <label class="space-y-1"><span class="text-slate-400 block">Odczyt co (s)</span>
              <input #cfgPoll type="number" min="10" [value]="s.config.poll_seconds" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-white" /></label>
          </div>
          <div class="flex items-center gap-3 text-xs">
            <label class="flex items-center gap-2"><input #cfgEnabled type="checkbox" [checked]="s.config.enabled" /> <span class="text-slate-300">Odczyt włączony</span></label>
            <button type="button" (click)="saveConfig(cfgHost.value, cfgSerial.value, cfgPort.value, cfgSlave.value, cfgPoll.value, cfgEnabled.checked)" [disabled]="busy()"
              class="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white font-semibold cursor-pointer">Zapisz połączenie</button>
          </div>
        </div>
      }
    </div>
  `,
})
export class InverterView implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly browser = isPlatformBrowser(this.platformId);

  readonly state = signal<InverterState | null>(null);
  readonly history = signal<InverterHistoryPoint[]>([]);
  readonly bucketSeconds = signal(300);
  readonly daily = signal<InverterDaily[]>([]);
  readonly range = signal<Range>('24h');
  readonly days = signal<30 | 365>(30);
  readonly busy = signal(false);
  readonly message = signal<{ ok: boolean; text: string } | null>(null);
  /** Edytowana kopia ustawień (null = brak odczytu). */
  readonly draft = signal<InverterSettings | null>(null);

  readonly ranges: { key: Range; label: string }[] = [
    { key: '24h', label: '24 h' },
    { key: '7d', label: '7 dni' },
    { key: '30d', label: '30 dni' },
    { key: '365d', label: 'Rok' },
  ];
  readonly dayRanges = [30, 365] as const;

  private readonly powerCanvas = viewChild<ElementRef<HTMLCanvasElement>>('powerCanvas');
  private readonly dailyCanvas = viewChild<ElementRef<HTMLCanvasElement>>('dailyCanvas');
  private powerChart: Chart | null = null;
  private dailyChart: Chart | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private historyTimer: ReturnType<typeof setInterval> | null = null;

  readonly live = computed(() => this.state()?.live ?? null);
  readonly ratedPower = computed(() => this.state()?.info?.rated_power || 6000);
  readonly workModes = computed(() =>
    Object.entries(this.state()?.work_modes ?? {}).map(([value, label]) => ({ value: Number(value), label })),
  );

  readonly todayTiles = computed(() => {
    const l = this.live();
    if (!l) return [];
    return [
      { label: 'Produkcja PV', today: l.today.pv, total: l.total.pv, color: COLORS.pv },
      { label: 'Zużycie domu', today: l.today.load, total: l.total.load, color: COLORS.load },
      { label: 'Pobór z sieci', today: l.today.grid_import, total: l.total.grid_import, color: COLORS.grid },
      { label: 'Oddanie do sieci', today: l.today.grid_export, total: l.total.grid_export, color: COLORS.export },
      { label: 'Ładowanie baterii', today: l.today.battery_charge, total: l.total.battery_charge, color: COLORS.battery },
      { label: 'Rozładowanie baterii', today: l.today.battery_discharge, total: l.total.battery_discharge, color: COLORS.soc },
    ];
  });

  readonly bucketLabel = computed(() => {
    const s = this.bucketSeconds();
    if (s >= 86400) return 'całych dni';
    if (s >= 3600) return `${s / 3600} h`;
    return `${s / 60} min`;
  });

  readonly dailySum = computed(() => {
    const d = this.daily();
    if (d.length === 0) return null;
    const sum = (k: 'pv' | 'load' | 'grid_import' | 'grid_export') => Math.round(d.reduce((a, x) => a + (x[k] ?? 0), 0) * 10) / 10;
    return { pv: sum('pv'), load: sum('load'), grid_import: sum('grid_import'), grid_export: sum('grid_export') };
  });

  /** Lista pól, które różnią się od odczytu z falownika. */
  readonly changes = computed(() => {
    const cur = this.state()?.settings;
    const d = this.draft();
    if (!cur || !d) return [];
    const out: (keyof InverterSettings)[] = [];
    for (const k of Object.keys(cur) as (keyof InverterSettings)[]) {
      if (JSON.stringify(cur[k]) !== JSON.stringify(d[k])) out.push(k);
    }
    return out;
  });

  constructor() {
    if (!this.browser) return;
    Chart.register(...registerables);
    void this.load();
    this.historyTimer = setInterval(() => void this.loadHistory(), 5 * 60_000);

    effect(() => {
      void this.range();
      void this.loadHistory();
    });
    effect(() => {
      void this.days();
      void this.loadDaily();
    });
    effect(() => this.drawPower(this.history(), this.powerCanvas()?.nativeElement));
    effect(() => this.drawDaily(this.daily(), this.dailyCanvas()?.nativeElement));
  }

  ngOnDestroy(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.historyTimer) clearInterval(this.historyTimer);
    this.powerChart?.destroy();
    this.dailyChart?.destroy();
  }

  private async load(): Promise<void> {
    try {
      const s = await firstValueFrom(this.http.get<InverterState>('/api/inverter'));
      this.setState(s);
    } catch {
      // błąd sieci — spróbujemy w następnym cyklu
    }
    const every = Math.max(10, this.state()?.config.poll_seconds ?? 30);
    this.pollTimer = setTimeout(() => void this.load(), every * 1000);
  }

  private setState(s: InverterState): void {
    // Edytowane, niezapisane pola zostają; bez zmian w formularzu pokazujemy świeży odczyt
    const dirty = this.changes().length > 0;
    this.state.set(s);
    if (!dirty || !this.draft()) this.draft.set(s.settings ? structuredClone(s.settings) : null);
  }

  private async loadHistory(): Promise<void> {
    try {
      const h = await firstValueFrom(
        this.http.get<{ points: InverterHistoryPoint[]; bucket_seconds: number }>(`/api/inverter/history?range=${this.range()}`),
      );
      this.bucketSeconds.set(h.bucket_seconds);
      this.history.set(h.points);
    } catch {
      this.history.set([]);
    }
  }

  private async loadDaily(): Promise<void> {
    try {
      const d = await firstValueFrom(this.http.get<{ days: InverterDaily[] }>(`/api/inverter/daily?days=${this.days()}`));
      this.daily.set(d.days);
    } catch {
      this.daily.set([]);
    }
  }

  async refresh(): Promise<void> {
    await this.run(async () => {
      const r = await firstValueFrom(this.http.post<{ success: boolean; status: InverterStatus }>('/api/inverter/refresh', {}));
      await this.reloadState();
      return { ok: r.success, text: r.success ? 'Odczytano dane z falownika.' : `Brak odczytu: ${r.status.last_error ?? 'nieznany błąd'}` };
    });
  }

  async discover(): Promise<void> {
    await this.run(async () => {
      const r = await firstValueFrom(this.http.post<{ success: boolean; message: string }>('/api/inverter/discover', {}));
      await this.reloadState();
      return { ok: r.success, text: r.message };
    });
  }

  async saveConfig(host: string, serial: string, port: string, slave: string, poll: string, enabled: boolean): Promise<void> {
    await this.run(async () => {
      await firstValueFrom(this.http.post('/api/inverter/config', {
        host, logger_serial: serial, port: Number(port), slave: Number(slave), poll_seconds: Number(poll), enabled,
      }));
      await this.reloadState();
      return { ok: true, text: 'Zapisano ustawienia połączenia.' };
    });
  }

  async toggleControl(): Promise<void> {
    const on = !this.state()?.config.control_enabled;
    if (on && !confirm('Włączyć sterowanie falownikiem z panelu?\n\nKażdy zalogowany do panelu będzie mógł zmieniać tryb pracy, prądy baterii i harmonogram falownika.')) return;
    await this.run(async () => {
      await firstValueFrom(this.http.post('/api/inverter/config', { control_enabled: on }));
      await this.reloadState();
      return { ok: true, text: on ? 'Sterowanie włączone.' : 'Sterowanie wyłączone.' };
    });
  }

  patch<K extends keyof InverterSettings>(key: K, value: InverterSettings[K]): void {
    const d = this.draft();
    if (d) this.draft.set({ ...d, [key]: value });
  }

  patchSlot<K extends keyof TouSlot>(i: number, key: K, value: TouSlot[K]): void {
    const d = this.draft();
    if (!d) return;
    const tou = d.tou.map((s, idx) => (idx === i ? { ...s, [key]: value } : s));
    this.draft.set({ ...d, tou });
  }

  resetDraft(): void {
    const s = this.state()?.settings;
    this.draft.set(s ? structuredClone(s) : null);
  }

  async saveSettings(): Promise<void> {
    const d = this.draft();
    const keys = this.changes();
    if (!d || keys.length === 0) return;
    const body: Partial<InverterSettings> = {};
    for (const k of keys) (body as Record<string, unknown>)[k] = d[k];
    if (!confirm(`Zapisać w falowniku zmiany: ${keys.map((k) => SETTING_LABELS[k]).join(', ')}?`)) return;
    await this.run(async () => {
      const r = await firstValueFrom(this.http.post<{ success: boolean; message: string; settings: InverterSettings }>('/api/inverter/settings', body));
      await this.reloadState(true);
      return { ok: r.success, text: r.message };
    });
  }

  private async reloadState(resetDraft = false): Promise<void> {
    const s = await firstValueFrom(this.http.get<InverterState>('/api/inverter'));
    if (resetDraft) this.draft.set(null);
    this.setState(s);
  }

  private async run(job: () => Promise<{ ok: boolean; text: string }>): Promise<void> {
    this.busy.set(true);
    try {
      this.message.set(await job());
    } catch (err: unknown) {
      const e = err as { error?: { message?: string }; message?: string };
      this.message.set({ ok: false, text: e.error?.message ?? e.message ?? 'Błąd połączenia z panelem.' });
      if (this.draft()) await this.reloadState(true).catch(() => undefined);
    } finally {
      this.busy.set(false);
    }
  }

  // --- formatowanie ---

  abs(v: number): number {
    return Math.abs(v);
  }

  watts(v: number): string {
    return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} kW` : `${v} W`;
  }

  batteryFlow(p: number): string {
    if (p > 0) return `rozładowanie ${this.watts(p)}`;
    if (p < 0) return `ładowanie ${this.watts(-p)}`;
    return 'bez przepływu';
  }

  fmtTime(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'medium' });
  }

  // --- wykresy ---

  private drawPower(points: InverterHistoryPoint[], canvas: HTMLCanvasElement | undefined): void {
    if (!canvas) return;
    this.powerChart?.destroy();
    const longRange = this.bucketSeconds() >= 86400;
    const labels = points.map((p) =>
      new Date(p.timestamp).toLocaleString('pl-PL', longRange ? { day: '2-digit', month: '2-digit' } : { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    );
    const line = (label: string, key: keyof InverterHistoryPoint, color: string, axis = 'y') => ({
      label,
      data: points.map((p) => p[key] as number | null),
      borderColor: color,
      backgroundColor: color + '33',
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.25,
      yAxisID: axis,
      spanGaps: false,
    });
    this.powerChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          line('PV (W)', 'pv_power', COLORS.pv),
          line('Dom (W)', 'load_power', COLORS.load),
          line('Sieć (W)', 'grid_power', COLORS.grid),
          line('Bateria (W)', 'battery_power', COLORS.battery),
          { ...line('SOC (%)', 'battery_soc', COLORS.soc, 'soc'), borderDash: [4, 3] },
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
          y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' }, title: { display: true, text: 'W', color: '#64748b' } },
          soc: { position: 'right', min: 0, max: 100, ticks: { color: COLORS.soc }, grid: { display: false }, title: { display: true, text: 'SOC %', color: COLORS.soc } },
        },
      },
    });
  }

  private drawDaily(days: InverterDaily[], canvas: HTMLCanvasElement | undefined): void {
    if (!canvas) return;
    this.dailyChart?.destroy();
    const bar = (label: string, key: keyof InverterDaily, color: string) => ({
      label,
      data: days.map((d) => d[key] as number),
      backgroundColor: color,
    });
    this.dailyChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: days.map((d) => d.day.slice(5).split('-').reverse().join('.')),
        datasets: [
          bar('PV (kWh)', 'pv', COLORS.pv),
          bar('Dom (kWh)', 'load', COLORS.load),
          bar('Pobór z sieci (kWh)', 'grid_import', COLORS.grid),
          bar('Oddanie do sieci (kWh)', 'grid_export', COLORS.export),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#cbd5e1', boxWidth: 12 } } },
        scales: {
          x: { ticks: { color: '#64748b', maxTicksLimit: 15 }, grid: { display: false } },
          y: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' }, title: { display: true, text: 'kWh', color: '#64748b' } },
        },
      },
    });
  }
}
