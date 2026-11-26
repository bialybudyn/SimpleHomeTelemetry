import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Telemetry } from '../../services/telemetry';
import { InverterView } from '../inverter-view/inverter-view';
import { PowerSwitchPanel } from '../power-switch-panel/power-switch-panel';

const STORAGE_KEY = 'energyMonitor.sections';
const INVERTER = 'inverter';

/** Model przekaźnika DIN z pomiarem energii obsługiwanego w tym widoku. */
export const POWER_SWITCH_MODEL = 'BASIC-ZB1GSP';

/**
 * Monitor Energii: falownik Deye i przekaźniki SONOFF BASIC-ZB1GSP jako zwijane sekcje.
 * Rozwinięcie sekcji jest zapamiętywane w przeglądarce.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-energy-monitor-view',
  imports: [MatIconModule, InverterView, PowerSwitchPanel],
  template: `
    <div class="space-y-4">
      <!-- Falownik -->
      <section class="rounded-2xl border border-slate-800 bg-slate-900/40">
        <button
          (click)="toggle(inverterId)"
          class="w-full flex items-center gap-3 p-4 text-left cursor-pointer"
          [attr.aria-expanded]="isOpen(inverterId)"
        >
          <mat-icon class="text-slate-400">{{ isOpen(inverterId) ? 'expand_less' : 'expand_more' }}</mat-icon>
          <mat-icon class="text-amber-400">solar_power</mat-icon>
          <div>
            <div class="font-bold text-white">Falownik i magazyn energii</div>
            <div class="text-[11px] font-mono text-slate-400">Deye · PV, bateria, sieć, harmonogram</div>
          </div>
        </button>
        @if (isOpen(inverterId)) {
          <div class="px-2 pb-2 sm:px-4 sm:pb-4">
            <app-inverter-view />
          </div>
        }
      </section>

      <!-- Przekaźniki -->
      <div class="flex flex-wrap items-center justify-between gap-2 pt-2">
        <h3 class="text-sm font-bold text-slate-300 flex items-center gap-2">
          <mat-icon class="text-sm !w-4 !h-4 text-emerald-400">electrical_services</mat-icon>
          Przełączniki SONOFF BASIC-ZB1GSP ({{ switches().length }})
        </h3>
        @if (switches().length > 0) {
          <span class="text-xs font-mono text-slate-400">Łącznie teraz: <strong class="text-amber-300">{{ totalPower() }}</strong></span>
        }
      </div>

      @for (d of switches(); track d.ieee_address) {
        <app-power-switch-panel [device]="d" [open]="isOpen(d.ieee_address)" (toggled)="toggle(d.ieee_address)" />
      } @empty {
        <div class="p-5 rounded-2xl bg-slate-900 border border-dashed border-slate-700 text-sm text-slate-400">
          Nie ma jeszcze sparowanego przekaźnika SONOFF BASIC-ZB1GSP. Włącz parowanie w zakładce z urządzeniami i przytrzymaj
          przycisk na przekaźniku przez 5 sekund, aż dioda zacznie migać. Każdy sparowany przekaźnik pojawi się tu jako osobna sekcja.
        </div>
      }
    </div>
  `,
})
export class EnergyMonitorView {
  private readonly telemetry = inject(Telemetry);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly inverterId = INVERTER;
  /** Stan sekcji: id -> rozwinięta. Falownik domyślnie rozwinięty, przekaźniki zwinięte. */
  private readonly sections = signal<Record<string, boolean>>(this.restore());

  readonly switches = computed(() =>
    this.telemetry
      .devices()
      .filter((d) => (d.model || '').toUpperCase() === POWER_SWITCH_MODEL)
      .sort((a, b) => a.friendly_name.localeCompare(b.friendly_name, 'pl')),
  );

  readonly totalPower = computed(() => {
    const sum = this.switches().reduce((s, d) => s + (typeof d.power === 'number' ? d.power : 0), 0);
    return sum >= 1000 ? `${(sum / 1000).toFixed(2)} kW` : `${Math.round(sum)} W`;
  });

  isOpen(id: string): boolean {
    const v = this.sections()[id];
    return v ?? id === INVERTER;
  }

  toggle(id: string): void {
    this.sections.update((s) => ({ ...s, [id]: !this.isOpen(id) }));
    if (!this.browser) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sections()));
    } catch {
      // Brak dostępu do pamięci przeglądarki — sekcje po prostu nie zostaną zapamiętane
    }
  }

  private restore(): Record<string, boolean> {
    if (!this.browser) return {};
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
}
