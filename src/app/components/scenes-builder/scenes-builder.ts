import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Telemetry } from '../../services/telemetry';
import {
  AutomationScene,
  LogicQuantifier,
  MetricOperator,
  TriggerMetric,
} from '../../models/telemetry.models';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-scenes-builder',
  imports: [MatIconModule, ReactiveFormsModule],
  template: `
    <div class="space-y-6">
      <!-- Nagłówek Sekcji Scen i Automatyzacji -->
      <div class="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/60 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-2xl">
        <div class="space-y-1.5">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <mat-icon class="text-sm !w-4 !h-4">account_tree</mat-icon>
            <span>Kreator Algorytmów & Sekwencji Scen (Workflow)</span>
          </div>
          <h2 class="text-2xl font-bold text-white tracking-tight">
            Automatyzacja & Sceny Szybkich Reakcji
          </h2>
          <p class="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Konfiguruj sekwencje algorytmów i reakcji automatycznych. Wybierz kwantyfikator logiczny (<strong class="text-cyan-300">IF / IF_NOT / AND / OR</strong>), ustaw progi pomiarowe i zdefiniuj wielokrokowe sekwencje działań.
          </p>
        </div>

        <button
          (click)="openCreateModal()"
          class="flex items-center gap-2 px-5 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-lg shadow-cyan-950/50 transition-all cursor-pointer shrink-0"
        >
          <mat-icon class="text-sm !w-4 !h-4">add_task</mat-icon>
          <span>Utwórz Nową Scenę Workflow</span>
        </button>
      </div>

      <!-- Lista Skonfigurowanych Scen w Formie Bloku Algorytmu (Workflow Cards) -->
      <div class="space-y-6">
        @for (scene of scenes(); track scene.id) {
          <div
            class="p-6 rounded-2xl bg-slate-900/90 border transition-all shadow-xl relative overflow-hidden"
            [class.border-cyan-500/40]="scene.enabled"
            [class.border-slate-800]="!scene.enabled"
          >
            <!-- Pasek Górny Sceny -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4 mb-5">
              <div class="flex items-center gap-3">
                <div
                  class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border"
                  [class.bg-cyan-500/10]="scene.enabled"
                  [class.text-cyan-400]="scene.enabled"
                  [class.border-cyan-500/30]="scene.enabled"
                  [class.bg-slate-950]="!scene.enabled"
                  [class.text-slate-500]="!scene.enabled"
                  [class.border-slate-800]="!scene.enabled"
                >
                  <mat-icon class="text-xl">{{ scene.icon }}</mat-icon>
                </div>
                <div>
                  <div class="flex items-center gap-2 mb-0.5">
                    <h3 class="text-base font-bold text-white tracking-tight">{{ scene.name }}</h3>
                    <span
                      class="text-[10px] font-mono uppercase px-2 py-0.5 rounded font-bold border"
                      [class.bg-emerald-500/10]="scene.enabled"
                      [class.text-emerald-400]="scene.enabled"
                      [class.border-emerald-500/20]="scene.enabled"
                      [class.bg-slate-800]="!scene.enabled"
                      [class.text-slate-400]="!scene.enabled"
                      [class.border-slate-700]="!scene.enabled"
                    >
                      {{ scene.enabled ? 'Aktywna' : 'Wyłączona' }}
                    </span>
                  </div>
                  <p class="text-xs text-slate-400 leading-relaxed">{{ scene.description }}</p>
                </div>
              </div>

              <!-- Szybkie Akcje dla Sceny -->
              <div class="flex items-center gap-2 shrink-0 self-end sm:self-center">
                <button
                  (click)="executeSceneTest(scene)"
                  [disabled]="isExecuting() === scene.id"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-950/40 transition-colors cursor-pointer"
                  title="Uruchom sekwencję testowo w czasie rzeczywistym"
                >
                  <mat-icon class="text-xs !w-3.5 !h-3.5" [class.animate-spin]="isExecuting() === scene.id">
                    {{ isExecuting() === scene.id ? 'refresh' : 'play_arrow' }}
                  </mat-icon>
                  <span>{{ isExecuting() === scene.id ? 'Wykonywanie...' : 'Uruchom testowo' }}</span>
                </button>

                <button
                  (click)="toggleScene(scene.id)"
                  class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
                  [title]="scene.enabled ? 'Wyłącz automatyzację' : 'Włącz automatyzację'"
                >
                  <mat-icon class="text-sm !w-4 !h-4" [class.text-emerald-400]="scene.enabled">
                    {{ scene.enabled ? 'toggle_on' : 'toggle_off' }}
                  </mat-icon>
                </button>

                <button
                  (click)="deleteScene(scene.id)"
                  class="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-300 border border-slate-700 transition-colors cursor-pointer"
                  title="Usuń scenę"
                >
                  <mat-icon class="text-sm !w-4 !h-4">delete</mat-icon>
                </button>
              </div>
            </div>

            <!-- WIZUALNY PRZEPŁYW WORKFLOW (Bloki Warunków & Kwadraty Akcji) -->
            <div class="space-y-4">
              <!-- Krok 1: WIZUALNE KWADRATY WARUNKÓW (Triggery & Logic Quantifiers) -->
              <div>
                <div class="text-[10px] font-mono uppercase font-bold text-cyan-400 mb-2.5 flex items-center gap-1.5">
                  <mat-icon class="text-xs !w-3.5 !h-3.5">adjust</mat-icon>
                  <span>Krok 1: Kwantyfikator Logiczny & Warunek Wejściowy (Trigger)</span>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  @for (cond of scene.conditions; track cond.description) {
                    <div class="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 relative overflow-hidden">
                      <div class="flex items-center justify-between">
                        <span
                          class="px-2 py-0.5 rounded text-[10px] font-mono font-bold border"
                          [class.bg-cyan-500/20]="cond.quantifier === 'IF'"
                          [class.text-cyan-300]="cond.quantifier === 'IF'"
                          [class.border-cyan-500/30]="cond.quantifier === 'IF'"
                          [class.bg-rose-500/20]="cond.quantifier === 'IF_NOT'"
                          [class.text-rose-300]="cond.quantifier === 'IF_NOT'"
                          [class.border-rose-500/30]="cond.quantifier === 'IF_NOT'"
                          [class.bg-amber-500/20]="cond.quantifier === 'AND'"
                          [class.text-amber-300]="cond.quantifier === 'AND'"
                          [class.border-amber-500/30]="cond.quantifier === 'AND'"
                          [class.bg-indigo-500/20]="cond.quantifier === 'OR'"
                          [class.text-indigo-300]="cond.quantifier === 'OR'"
                          [class.border-indigo-500/30]="cond.quantifier === 'OR'"
                        >
                          {{ cond.quantifier }} (KWANTYFIKATOR)
                        </span>

                        <span class="text-[10px] font-mono text-slate-500">
                          Operacja: {{ cond.operator }}
                        </span>
                      </div>

                      <div class="text-xs font-bold text-white">
                        {{ cond.description }}
                      </div>

                      <div class="text-[11px] font-mono text-slate-400">
                        Wartość progu: <strong class="text-cyan-300">{{ cond.value }}</strong>
                      </div>
                    </div>
                  }
                </div>
              </div>

              <!-- Łącznik sekwencyjny (Łańcuch Wykonania) -->
              <div class="flex items-center gap-2 text-slate-500 font-mono text-xs my-2">
                <mat-icon class="text-sm !w-4 !h-4 text-cyan-400">arrow_downward</mat-icon>
                <span>Gdy warunek spełniony, wykonaj w sekwencji krok po kroku:</span>
              </div>

              <!-- Krok 2: SEKWENCYJNE KWADRATY AKCJI (Sequential Actions Workflow) -->
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                @for (act of scene.actions; track act.step_number) {
                  <div class="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-2 relative">
                    <div class="flex items-center justify-between">
                      <span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                        KROK {{ act.step_number }}
                      </span>
                      <mat-icon class="text-xs text-indigo-400 !w-3.5 !h-3.5">
                        {{ act.type === 'device_command' ? 'bolt' : (act.type === 'notification' ? 'notifications' : 'hourglass_bottom') }}
                      </mat-icon>
                    </div>

                    <div class="text-xs font-bold text-white">
                      {{ act.description }}
                    </div>

                    @if (act.target_name) {
                      <div class="text-[11px] font-mono text-slate-400">
                        Cel: <strong class="text-slate-200">{{ act.target_name }}</strong>
                      </div>
                    }
                  </div>
                }
              </div>
            </div>

            <!-- Stopka Sceny: Statystyki Uruchomień -->
            <div class="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
              <span>Wykonano łącznie: <strong class="text-slate-300">{{ scene.trigger_count }} razy</strong></span>
              <span>Ostatnie wyzwolenie: <strong class="text-slate-400">{{ scene.last_triggered_at || 'Brak zdarzeń' }}</strong></span>
            </div>
          </div>
        }
      </div>

      <!-- Modal Tworzenia Nowej Sceny -->
      @if (showCreateModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <div class="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div class="px-6 py-4 bg-gradient-to-r from-cyan-950 via-slate-900 to-slate-900 border-b border-slate-800 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <mat-icon>add_task</mat-icon>
                </div>
                <div>
                  <h3 class="text-lg font-bold text-white tracking-tight">Kreator Nowej Sceny Workflow</h3>
                  <p class="text-xs text-slate-400">Zdefiniuj warunki logiczne oraz sekwencję wykonawczą</p>
                </div>
              </div>
              <button
                (click)="showCreateModal.set(false)"
                class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                <mat-icon class="text-sm !w-4 !h-4">close</mat-icon>
              </button>
            </div>

            <form [formGroup]="sceneForm" (ngSubmit)="saveNewScene()" class="p-6 space-y-4 overflow-y-auto custom-scrollbar">
              <div class="space-y-1.5">
                <label for="sceneNameInput" class="text-xs font-semibold text-slate-300 block">Nazwa Sceny / Algorytmu</label>
                <input
                  id="sceneNameInput"
                  type="text"
                  formControlName="name"
                  placeholder="np. Automatyczny nawiew i chłodzenie"
                  class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div class="space-y-1.5">
                <label for="sceneDescInput" class="text-xs font-semibold text-slate-300 block">Opis działania</label>
                <input
                  id="sceneDescInput"
                  type="text"
                  formControlName="description"
                  placeholder="np. Włącza GOW 007 po przekroczeniu 24.5°C"
                  class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="space-y-1.5">
                  <label for="sceneQuantifierSelect" class="text-xs font-semibold text-slate-300 block">Kwantyfikator Logiczny</label>
                  <select
                    id="sceneQuantifierSelect"
                    formControlName="quantifier"
                    class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="IF">IF (Jeśli warunek spełniony)</option>
                    <option value="IF_NOT">IF_NOT (Jeśli warunek NIE spełniony)</option>
                    <option value="AND">AND (I jednocześnie)</option>
                    <option value="OR">OR (Lub dowolny)</option>
                  </select>
                </div>

                <div class="space-y-1.5">
                  <label for="sceneMetricSelect" class="text-xs font-semibold text-slate-300 block">Miernik / Warunek Wejściowy</label>
                  <select
                    id="sceneMetricSelect"
                    formControlName="metric"
                    class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="temperature">Temperatura (°C)</option>
                    <option value="humidity">Wilgotność (%RH)</option>
                    <option value="battery">Stan Baterii (%)</option>
                    <option value="contact">Kontaktron Okna / Drzwi</option>
                    <option value="occupancy">Wykrycie Ruchu / Presence</option>
                  </select>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div class="space-y-1.5">
                  <label for="sceneOperatorSelect" class="text-xs font-semibold text-slate-300 block">Operator Porównania</label>
                  <select
                    id="sceneOperatorSelect"
                    formControlName="operator"
                    class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                  >
                    <option value=">">Większe niż (&gt;)</option>
                    <option value="<">Mniejsze niż (&lt;)</option>
                    <option value="==">Równe (==)</option>
                    <option value="<=">Mniejsze równe (&lt;=)</option>
                  </select>
                </div>

                <div class="space-y-1.5">
                  <label for="sceneThresholdInput" class="text-xs font-semibold text-slate-300 block">Wartość Progu</label>
                  <input
                    id="sceneThresholdInput"
                    type="number"
                    formControlName="threshold"
                    step="0.5"
                    class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              <div class="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  (click)="showCreateModal.set(false)"
                  class="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  [disabled]="sceneForm.invalid"
                  class="px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-lg shadow-cyan-950/40 cursor-pointer"
                >
                  Zapisz Nową Scenę
                </button>
              </div>
            </form>
          </div>
        </div>
      }
    </div>
  `,
})
export class ScenesBuilder {
  readonly telemetry = inject(Telemetry);

  readonly showCreateModal = signal<boolean>(false);
  readonly isExecuting = signal<string | null>(null);

  readonly scenes = signal<AutomationScene[]>([
    {
      id: 'gow007-auto-cool',
      name: 'Automatyczne Chłodzenie & Sterylizacja UV (GÖTZE & JENSEN GOW 007)',
      description: 'Włącza wentylator GOW 007 na bieg 8 z jonizacją i lampą UV gdy temperatura przekroczy 24.5°C',
      icon: 'air',
      enabled: true,
      trigger_count: 14,
      last_triggered_at: '2026-10-07 13:20:00',
      conditions: [
        {
          quantifier: 'IF',
          metric: 'temperature',
          operator: '>',
          value: 24.5,
          description: 'Temperatura pomieszczenia > 24.5°C',
        },
      ],
      actions: [
        {
          step_number: 1,
          type: 'device_command',
          target_name: 'Wentylator Götze & Jensen GOW 007 7w1',
          command: { state: 'ON', fan_speed: 8, fan_oscillation: true },
          description: 'Włącz zasilanie ON, Ustaw bieg 8/12 oraz Oscylację 70°',
        },
        {
          step_number: 2,
          type: 'device_command',
          target_name: 'Wentylator Götze & Jensen GOW 007 7w1',
          command: { fan_ionizer: true, fan_uv: true, fan_humidifier: true },
          description: 'Aktywuj Jonizator powietrza, Nawilżacz oraz Lampę UV Sterylizującą',
        },
        {
          step_number: 3,
          type: 'notification',
          notification_message: 'Uruchomiono klimatyzację chłodzącą GOW 007 ze sterylizacją UV.',
          description: 'Wyślij natychmiastowe powiadomienie Toast na serwer i telefon',
        },
      ],
    },
    {
      id: 'trvzb-freeze-protection',
      name: 'Ochrona przed mrozem & Automatyka Termostatu Sonoff TRVZB',
      description: 'Ustawia nastawę TRVZB na 22.0°C i włącza dogrzewacz elektryczny S26R2 gdy Temp < 18.0°C',
      icon: 'thermostat',
      enabled: true,
      trigger_count: 8,
      last_triggered_at: '2026-10-07 08:15:00',
      conditions: [
        {
          quantifier: 'IF',
          metric: 'temperature',
          operator: '<',
          value: 18.0,
          description: 'Temperatura w Sypialni / Salon < 18.0°C',
        },
      ],
      actions: [
        {
          step_number: 1,
          type: 'device_command',
          target_name: 'Głowica Sonoff TRVZB / TRVZB Gen 2',
          command: { current_heating_setpoint: 22.0, system_mode: 'heat' },
          description: 'Ustaw nastawę zadaną na 22.0°C oraz tryb HEAT',
        },
        {
          step_number: 2,
          type: 'device_command',
          target_name: 'Inteligentne Gniazdko Sonoff S26R2ZB 16A',
          command: { state: 'ON' },
          description: 'Włącz zasilanie dodatkowego ogrzewacza (ON)',
        },
      ],
    },
    {
      id: 'open-window-protection',
      name: 'Ochrona Energii przy Otwartym Oknie (Kontaktron SNZB-04)',
      description: 'Gdy czujnik SNZB-04 wykryje otwarcie okna, automatycznie wyłącza zawór grzejnika TRVZB',
      icon: 'sensor_door',
      enabled: true,
      trigger_count: 5,
      last_triggered_at: '2026-10-07 10:40:00',
      conditions: [
        {
          quantifier: 'IF',
          metric: 'contact',
          operator: '==',
          value: false,
          description: 'Kontaktron Drzwi / Okno SNZB-04 == Otwarte',
        },
      ],
      actions: [
        {
          step_number: 1,
          type: 'device_command',
          target_name: 'Głowica Sonoff TRVZB',
          command: { system_mode: 'off' },
          description: 'Przełącz zawór w tryb OFF (Zapobieganie stratom ciepła)',
        },
        {
          step_number: 2,
          type: 'notification',
          notification_message: 'Wykryto otwarte okno. Wstrzymano ogrzewanie.',
          description: 'Wyślij alert informacyjny na telefon',
        },
      ],
    },
  ]);

  readonly sceneForm = new FormGroup({
    name: new FormControl('', [Validators.required]),
    description: new FormControl(''),
    quantifier: new FormControl<LogicQuantifier>('IF', [Validators.required]),
    metric: new FormControl<TriggerMetric>('temperature', [Validators.required]),
    operator: new FormControl<MetricOperator>('>', [Validators.required]),
    threshold: new FormControl<number>(24.0, [Validators.required]),
  });

  openCreateModal(): void {
    this.showCreateModal.set(true);
  }

  toggleScene(id: string): void {
    this.scenes.update((list) =>
      list.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    );
  }

  deleteScene(id: string): void {
    this.scenes.update((list) => list.filter((s) => s.id !== id));
  }

  executeSceneTest(scene: AutomationScene): void {
    this.isExecuting.set(scene.id);

    // Wykonaj sekwencyjne akcje sceny w czasie rzeczywistym
    scene.actions.forEach((act) => {
      if (act.type === 'device_command' && act.command) {
        // Znajdź odpowiednie urządzenie w sieci lub wyślij polecenie do urządzeń
        const devs = this.telemetry.devices();
        const target = devs.find((d) => d.friendly_name.includes('GÖTZE') || d.friendly_name.includes('Wentylator') || d.friendly_name.includes('TRVZB') || d.friendly_name.includes('S26'));
        if (target) {
          this.telemetry.sendDeviceCommand(target.ieee_address, act.command);
        }
      }
    });

    setTimeout(() => {
      this.isExecuting.set(null);
      this.scenes.update((list) =>
        list.map((s) =>
          s.id === scene.id
            ? { ...s, trigger_count: s.trigger_count + 1, last_triggered_at: new Date().toLocaleString() }
            : s,
        ),
      );
    }, 1200);
  }

  saveNewScene(): void {
    if (this.sceneForm.invalid) return;

    const val = this.sceneForm.value;
    const newSc: AutomationScene = {
      id: `scene_${Date.now()}`,
      name: val.name || 'Nowa Scena',
      description: val.description || 'Automatyczny algorytm',
      icon: 'auto_mode',
      enabled: true,
      trigger_count: 0,
      last_triggered_at: null,
      conditions: [
        {
          quantifier: val.quantifier || 'IF',
          metric: val.metric || 'temperature',
          operator: val.operator || '>',
          value: val.threshold || 24,
          description: `Warunek ${val.metric} ${val.operator} ${val.threshold}`,
        },
      ],
      actions: [
        {
          step_number: 1,
          type: 'device_command',
          target_name: 'Urządzenie Wykonawcze',
          command: { state: 'ON' },
          description: 'Wykonaj automatyczne przełączenie ON',
        },
        {
          step_number: 2,
          type: 'notification',
          notification_message: `Wyzwolono algorytm ${val.name}`,
          description: 'Powiadomienie w systemie',
        },
      ],
    };

    this.scenes.update((list) => [newSc, ...list]);
    this.showCreateModal.set(false);
    this.sceneForm.reset({
      quantifier: 'IF',
      metric: 'temperature',
      operator: '>',
      threshold: 24,
    });
  }
}
