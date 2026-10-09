import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Telemetry } from '../../services/telemetry';
import {
  AutomationScene,
  LogicQuantifier,
  MetricOperator,
  SceneAction,
  TriggerMetric,
} from '../../models/telemetry.models';
import { formatEuropeanDateTime } from '../../utils/date-format';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-scenes-builder',
  imports: [MatIconModule, ReactiveFormsModule],
  template: `
    <div class="space-y-6">
      <!-- Nagłówek Sekcji Sekwencera Scen i Algorytmów -->
      <div class="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/80 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-2xl">
        <div class="space-y-1.5">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <mat-icon class="text-sm !w-4 !h-4">account_tree</mat-icon>
            <span>Wizualny Sekwencer Algorytmów & Wstrzykiwania Komend</span>
          </div>
          <h2 class="text-2xl font-bold text-white tracking-tight">
            Sekwencer Scen i Automatyzacji (Pipeline)
          </h2>
          <p class="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Buduj precyzyjne łańcuchy wykonawcze. Wybieraj konkretne czujniki wejściowe, kwantyfikatory logiczne (<strong class="text-cyan-300">IF / IF_NOT / AND / OR</strong>) oraz ustawiaj sekwencyjne opóźnienia czasowe pomiędzy wykonaniem kolejnych komend.
          </p>
        </div>

        <div class="flex items-center gap-3 shrink-0">
          <button
            (click)="openCreateModal()"
            class="flex items-center gap-2 px-5 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-lg shadow-cyan-950/50 transition-all cursor-pointer"
          >
            <mat-icon class="text-sm !w-4 !h-4">add_box</mat-icon>
            <span>Utwórz Nowy Sekwencer</span>
          </button>
        </div>
      </div>

      <!-- LISTA SCEN W FORMIE POZIOMEGO SEKWENERA (CAN / IOT TIMELINE SEQUENCE) -->
      <div class="space-y-8">
        @for (scene of scenes(); track scene.id) {
          <div
            class="p-6 rounded-2xl bg-slate-900/90 border transition-all shadow-2xl space-y-4 relative overflow-hidden"
            [class.border-cyan-500/50]="scene.enabled"
            [class.border-slate-800]="!scene.enabled"
          >
            <!-- Nagłówek Karty Sceny -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
              <div class="flex items-center gap-3">
                <div
                  class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
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
                  <p class="text-xs text-slate-400">{{ scene.description }}</p>
                </div>
              </div>

              <!-- Przycisk Głównej Edycji Sceny oraz Uruchomienia Testowego -->
              <div class="flex items-center gap-2 shrink-0">
                <button
                  (click)="executeSceneTest(scene)"
                  [disabled]="isExecuting() === scene.id"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-950/40 transition-colors cursor-pointer"
                  title="Uruchom całą sekwencję w czasie rzeczywistym"
                >
                  <mat-icon class="text-xs !w-3.5 !h-3.5" [class.animate-spin]="isExecuting() === scene.id">
                    {{ isExecuting() === scene.id ? 'refresh' : 'play_arrow' }}
                  </mat-icon>
                  <span>{{ isExecuting() === scene.id ? 'Wykonywanie...' : 'Uruchom test' }}</span>
                </button>

                <button
                  (click)="openEditModal(scene)"
                  class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 text-xs font-semibold transition-colors cursor-pointer"
                  title="Edytuj tę scenę i jej kroki"
                >
                  <mat-icon class="text-xs !w-3.5 !h-3.5">edit</mat-icon>
                  <span>Edytuj Scenę</span>
                </button>

                <button
                  (click)="toggleScene(scene.id)"
                  class="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
                  [title]="scene.enabled ? 'Wyłącz scenę' : 'Włącz scenę'"
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

            <!-- WIZUALNY SEKWENCER POZIOMY (WZOROWANY NA WSTRZYKIWANIU RAMEK CAN) -->
            <div class="relative w-full py-4">
              <!-- Pozioma Szyna Czasowa (Timeline Line) -->
              <div class="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-0.5 bg-gradient-to-r from-cyan-500/40 via-indigo-500/40 to-slate-800 z-0"></div>

              <!-- Przepływ Bloków i Tabletek Opóźnienia -->
              <div class="relative z-10 flex items-center gap-3 overflow-x-auto pb-4 pt-2 px-2 custom-scrollbar">
                <!-- Blok #1: Warunek Logiczny (Trigger Node) -->
                @for (cond of scene.conditions; track cond.description) {
                  <div class="w-80 shrink-0 p-4 rounded-2xl bg-slate-950/95 border-2 border-cyan-500/80 shadow-xl shadow-cyan-950/30 space-y-3 relative group">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-1.5">
                        <span class="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[10px] font-bold border border-cyan-500/30">
                          #1
                        </span>
                        <span class="px-2 py-0.5 rounded bg-slate-900 text-slate-300 font-mono text-[10px] font-bold border border-slate-800">
                          {{ cond.quantifier }}
                        </span>
                      </div>

                      <div class="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button
                          (click)="openEditModal(scene)"
                          class="p-1 text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer"
                          title="Edytuj warunek"
                        >
                          <mat-icon class="text-xs !w-3.5 !h-3.5">edit</mat-icon>
                        </button>
                      </div>
                    </div>

                    <!-- Tytuł Warunku i Konkretne Urządzenie Źródłowe -->
                    <div>
                      <div class="text-[10px] font-mono uppercase font-bold text-slate-500 mb-0.5">Urządzenie Źródłowe</div>
                      <div class="text-xs font-bold text-white truncate">
                        {{ getDeviceFriendlyName(cond.device_ieee) }}
                      </div>
                      <div class="text-[10px] font-mono text-cyan-400 truncate">
                        {{ cond.device_ieee || 'Dowolny czujnik' }}
                      </div>
                    </div>

                    <!-- Podgląd Binarnego / Logicznego Ładunku Warunku (Payload Box) -->
                    <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80 font-mono text-[11px] text-cyan-300 flex items-center justify-between">
                      <span>{{ cond.metric }} {{ cond.operator }} {{ cond.value }}</span>
                      <mat-icon class="text-xs text-cyan-400 !w-3.5 !h-3.5">tune</mat-icon>
                    </div>

                    <!-- Czas T+0s i Przycisk Edycji -->
                    <div class="pt-1 flex items-center justify-between text-[10px] font-mono text-slate-500">
                      <span class="flex items-center gap-1">
                        <mat-icon class="text-[10px] !w-3 !h-3">schedule</mat-icon>
                        <span>T+0.00s</span>
                      </span>

                      <button
                        (click)="openEditModal(scene)"
                        class="text-cyan-400 hover:text-cyan-300 font-bold cursor-pointer flex items-center gap-0.5"
                      >
                        <mat-icon class="text-[10px] !w-3 !h-3">edit</mat-icon>
                        <span>Edytuj</span>
                      </button>
                    </div>
                  </div>
                }

                <!-- SEKWENCYJNE KROKI AKCJI Z TABLETKAMI OPÓŹNIENIA (+Delay Pills) -->
                @for (act of scene.actions; track act.step_number; let idx = $index) {
                  <!-- Tabletka Opóźnienia Czasowego (Connector Delay Pill) -->
                  <div class="shrink-0 flex items-center justify-center my-auto">
                    <div
                      tabindex="0"
                      role="button"
                      class="px-3 py-1 rounded-full bg-slate-900 border border-amber-500/50 text-amber-300 font-mono text-[10px] font-bold shadow-lg shadow-amber-950/40 flex items-center gap-1 cursor-pointer hover:scale-105 transition-transform"
                      (click)="quickEditDelay(scene, act)"
                      (keydown.enter)="quickEditDelay(scene, act)"
                      (keydown.space)="quickEditDelay(scene, act)"
                      title="Kliknij aby zmienić czas opóźnienia sekwencji"
                    >
                      <mat-icon class="text-xs !w-3 !h-3 text-amber-400">schedule</mat-icon>
                      <span>+{{ act.delay_seconds || 0.00 }}s</span>
                    </div>
                  </div>

                  <!-- Kwadrat Akcji (Sekwencyjny Blok Komendy) -->
                  <div class="w-80 shrink-0 p-4 rounded-2xl bg-slate-950/95 border border-slate-800 hover:border-indigo-500/60 shadow-xl space-y-3 relative group transition-all">
                    <!-- Górny pasek bloku -->
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-1.5">
                        <span class="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono text-[10px] font-bold border border-indigo-500/30">
                          #{{ act.step_number + 1 }}
                        </span>
                        <span class="px-2 py-0.5 rounded bg-slate-900 text-slate-300 font-mono text-[10px] font-bold border border-slate-800">
                          {{ act.type === 'device_command' ? 'KOMENDA' : 'NOTIF' }}
                        </span>
                      </div>

                      <div class="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                        <button
                          (click)="moveActionStep(scene, idx, -1)"
                          [disabled]="idx === 0"
                          class="p-0.5 text-slate-500 hover:text-white disabled:opacity-30 cursor-pointer"
                          title="Przesuń w lewo"
                        >
                          <mat-icon class="text-xs !w-3.5 !h-3.5">arrow_back</mat-icon>
                        </button>
                        <button
                          (click)="moveActionStep(scene, idx, 1)"
                          [disabled]="idx === scene.actions.length - 1"
                          class="p-0.5 text-slate-500 hover:text-white disabled:opacity-30 cursor-pointer"
                          title="Przesuń w prawo"
                        >
                          <mat-icon class="text-xs !w-3.5 !h-3.5">arrow_forward</mat-icon>
                        </button>
                        <button
                          (click)="deleteActionStep(scene, idx)"
                          class="p-0.5 text-slate-500 hover:text-rose-400 cursor-pointer ml-1"
                          title="Usuń ten krok sekwencji"
                        >
                          <mat-icon class="text-xs !w-3.5 !h-3.5">delete</mat-icon>
                        </button>
                      </div>
                    </div>

                    <!-- Tytuł Akcji i Konkretne Urządzenie Docelowe -->
                    <div>
                      <div class="text-[10px] font-mono uppercase font-bold text-slate-500 mb-0.5">Urządzenie Docelowe</div>
                      <div class="text-xs font-bold text-white truncate">
                        {{ act.target_name || getDeviceFriendlyName(act.target_ieee) }}
                      </div>
                      <div class="text-[10px] font-mono text-indigo-400 truncate">
                        {{ act.target_ieee || 'Wszystkie urządzenia' }}
                      </div>
                    </div>

                    <!-- Ładunek Komendy w Formacie Kodu Rozkazu (Payload Box) -->
                    <div class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[11px] text-emerald-400 overflow-x-auto truncate">
                      {{ formatCommandPayload(act) }}
                    </div>

                    <!-- Pasek Dolny: Skumulowany Czas Timeline + Przycisk Edytuj -->
                    <div class="pt-1 flex items-center justify-between text-[10px] font-mono text-slate-500">
                      <span class="flex items-center gap-1">
                        <mat-icon class="text-[10px] !w-3 !h-3">schedule</mat-icon>
                        <span>T+{{ getCumulativeTime(scene, idx) }}s</span>
                      </span>

                      <button
                        (click)="openEditModal(scene)"
                        class="text-cyan-400 hover:text-cyan-300 font-bold cursor-pointer flex items-center gap-0.5"
                      >
                        <mat-icon class="text-[10px] !w-3 !h-3">edit</mat-icon>
                        <span>Edytuj</span>
                      </button>
                    </div>

                    <!-- Wskaźnik stanu realizacji -->
                    <div class="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                      <mat-icon class="text-xs !w-3 !h-3 text-emerald-400">check_circle</mat-icon>
                      <span>Gotowy do wstrzyknięcia rozkazu</span>
                    </div>
                  </div>
                }
              </div>
            </div>

            <!-- Stopka Sceny -->
            <div class="pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
              <span>Wykonano łącznie: <strong class="text-slate-300">{{ scene.trigger_count }} razy</strong></span>
              <span>Ostatnie uruchomienie: <strong class="text-slate-400">{{ scene.last_triggered_at || 'Brak zdarzeń' }}</strong></span>
            </div>
          </div>
        }
      </div>

      <!-- MODAL TWORZENIA LUB PEŁNEJ EDYCJI SCENY WORKFLOW -->
      @if (showModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
          <div class="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div class="px-6 py-4 bg-gradient-to-r from-cyan-950 via-slate-900 to-slate-900 border-b border-slate-800 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <mat-icon>{{ editingSceneId() ? 'edit' : 'add_box' }}</mat-icon>
                </div>
                <div>
                  <h3 class="text-lg font-bold text-white tracking-tight">
                    {{ editingSceneId() ? 'Edycja Sekwencera Sceny' : 'Kreator Nowego Sekwencera Sceny' }}
                  </h3>
                  <p class="text-xs text-slate-400">Konfiguracja urządzeń wejściowych, wyjściowych i opóźnień czasowych</p>
                </div>
              </div>
              <button
                (click)="closeModal()"
                class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                <mat-icon class="text-sm !w-4 !h-4">close</mat-icon>
              </button>
            </div>

            <div class="p-6 space-y-6 overflow-y-auto custom-scrollbar">
              <!-- Dane Podstawowe Sceny -->
              <div class="space-y-3 border-b border-slate-800/80 pb-4">
                <div class="space-y-1.5">
                  <label for="sceneNameField" class="text-xs font-semibold text-slate-300 block">Nazwa Sceny / Algorytmu</label>
                  <input
                    id="sceneNameField"
                    type="text"
                    [value]="formName()"
                    (input)="formName.set($any($event.target).value)"
                    placeholder="np. Automatyczne chłodzenie GOW 007"
                    class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div class="space-y-1.5">
                  <label for="sceneDescField" class="text-xs font-semibold text-slate-300 block">Opis działania</label>
                  <input
                    id="sceneDescField"
                    type="text"
                    [value]="formDesc()"
                    (input)="formDesc.set($any($event.target).value)"
                    placeholder="np. Włącza wentylator GOW 007 z jonizacją gdy temperatura > 24.5°C"
                    class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              <!-- SEKCJA 1: KONKRETNE URZĄDZENIE ŹRÓDŁOWE I WARUNEK LOGICZNY -->
              <div class="space-y-3 border-b border-slate-800/80 pb-4">
                <div class="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                  <mat-icon class="text-xs !w-3.5 !h-3.5">adjust</mat-icon>
                  <span>Krok 1: Wybór Urządzenia Źródłowego (Czujnika) & Warunku</span>
                </div>

                <div class="space-y-1.5">
                  <label for="sourceDeviceSelect" class="text-xs font-semibold text-slate-300 block">Wybierz Czujnik / Urządzenie Źródłowe</label>
                  <select
                    id="sourceDeviceSelect"
                    [value]="formSourceIeee()"
                    (change)="formSourceIeee.set($any($event.target).value)"
                    class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="">Wszystkie / Dowolny czujnik w sieci</option>
                    @for (dev of telemetry.devices(); track dev.ieee_address) {
                      <option [value]="dev.ieee_address">
                        {{ dev.friendly_name || dev.ieee_address }} ({{ dev.model }})
                      </option>
                    }
                  </select>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div class="space-y-1.5">
                    <label for="quantifierSelect" class="text-xs font-semibold text-slate-300 block">Kwantyfikator Logiczny</label>
                    <select
                      id="quantifierSelect"
                      [value]="formQuantifier()"
                      (change)="formQuantifier.set($any($event.target).value)"
                      class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                    >
                      <option value="IF">IF (Jeśli warunek spełniony)</option>
                      <option value="IF_NOT">IF_NOT (Jeśli warunek NIE spełniony)</option>
                      <option value="AND">AND (I jednocześnie)</option>
                      <option value="OR">OR (Lub dowolny)</option>
                    </select>
                  </div>

                  <div class="space-y-1.5">
                    <label for="metricSelect" class="text-xs font-semibold text-slate-300 block">Miernik Wejściowy</label>
                    <select
                      id="metricSelect"
                      [value]="formMetric()"
                      (change)="formMetric.set($any($event.target).value)"
                      class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                    >
                      <option value="temperature">Temperatura (°C)</option>
                      <option value="humidity">Wilgotność (%RH)</option>
                      <option value="battery">Stan Baterii (%)</option>
                      <option value="contact">Kontaktron Okna (Otwarte/Zamknięte)</option>
                      <option value="occupancy">Czujnik Ruchu / Obecność mmWave</option>
                    </select>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div class="space-y-1.5">
                    <label for="operatorSelect" class="text-xs font-semibold text-slate-300 block">Operator</label>
                    <select
                      id="operatorSelect"
                      [value]="formOperator()"
                      (change)="formOperator.set($any($event.target).value)"
                      class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                    >
                      <option value=">">Większe niż (&gt;)</option>
                      <option value="<">Mniejsze niż (&lt;)</option>
                      <option value="==">Równe (==)</option>
                      <option value="<=">Mniejsze równe (&lt;=)</option>
                    </select>
                  </div>

                  <div class="space-y-1.5">
                    <label for="thresholdInput" class="text-xs font-semibold text-slate-300 block">Wartość Progu</label>
                    <input
                      id="thresholdInput"
                      type="number"
                      step="0.5"
                      [value]="formThreshold()"
                      (input)="formThreshold.set(+$any($event.target).value)"
                      class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              <!-- SEKCJA 2: SEKWENCYJNY ŁAŃCUCH AKCJI I WYBÓR URZĄDZEŃ DOCELOWYCH -->
              <div class="space-y-4">
                <div class="flex items-center justify-between">
                  <div class="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                    <mat-icon class="text-xs !w-3.5 !h-3.5">bolt</mat-icon>
                    <span>Krok 2: Sekwencja Komend Execucyjnych (Łańcuch)</span>
                  </div>

                  <button
                    type="button"
                    (click)="addStepToForm()"
                    class="px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-semibold border border-indigo-500/30 cursor-pointer flex items-center gap-1"
                  >
                    <mat-icon class="text-xs !w-3.5 !h-3.5">add</mat-icon>
                    <span>Dodaj Krok Sekwencji</span>
                  </button>
                </div>

                @for (act of formActions(); track act.step_number; let stepIdx = $index) {
                  <div class="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3 relative">
                    <div class="flex items-center justify-between border-b border-slate-800/80 pb-2">
                      <span class="text-xs font-mono font-bold text-indigo-300">
                        Krok Sekwencji #{{ stepIdx + 1 }}
                      </span>
                      <button
                        type="button"
                        (click)="removeStepFromForm(stepIdx)"
                        class="text-xs text-rose-400 hover:text-rose-300 font-mono cursor-pointer"
                      >
                        Usuń krok
                      </button>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                      <div class="space-y-1">
                        <label [for]="'targetDeviceSelect_' + stepIdx" class="text-[11px] font-semibold text-slate-400 block">Urządzenie Docelowe</label>
                        <select
                          [id]="'targetDeviceSelect_' + stepIdx"
                          [value]="act.target_ieee || ''"
                          (change)="updateStepDevice(stepIdx, $any($event.target).value)"
                          class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white text-xs font-mono focus:border-indigo-500 focus:outline-none"
                        >
                          <option value="">Wybierz urządzenie docelowe...</option>
                          @for (dev of telemetry.devices(); track dev.ieee_address) {
                            <option [value]="dev.ieee_address">
                              {{ dev.friendly_name || dev.ieee_address }} ({{ dev.model }})
                            </option>
                          }
                          <option value="wifi_gow007_fan">Wentylator Götze & Jensen GOW 007 7w1 (Wi-Fi)</option>
                          <option value="sonoff_trvzb_head">Głowica Termostatyczna Sonoff TRVZB</option>
                          <option value="sonoff_basic_zb1gsp">Przekaźnik DIN Sonoff BASIC-ZB1GSP 32A</option>
                          <option value="sonoff_s26r2_plug">Gniazdko Sonoff S26R2ZB 16A</option>
                        </select>
                      </div>

                      <div class="space-y-1">
                        <label [for]="'delayInput_' + stepIdx" class="text-[11px] font-semibold text-slate-400 block">Opóźnienie Czasowe (+s)</label>
                        <input
                          [id]="'delayInput_' + stepIdx"
                          type="number"
                          step="0.5"
                          [value]="act.delay_seconds || 0"
                          (input)="updateStepDelay(stepIdx, +$any($event.target).value)"
                          placeholder="0.0s (Natychmiast)"
                          class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white text-xs font-mono focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div class="space-y-1">
                      <label [for]="'actionDescInput_' + stepIdx" class="text-[11px] font-semibold text-slate-400 block">Opis Komendy</label>
                      <input
                        [id]="'actionDescInput_' + stepIdx"
                        type="text"
                        [value]="act.description"
                        (input)="updateStepDescription(stepIdx, $any($event.target).value)"
                        placeholder="np. Włącz Bieg 8 + Jonizator + UV"
                        class="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-white text-xs font-mono focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>
                }
              </div>
            </div>

            <div class="px-6 py-4 bg-slate-950 border-t border-slate-800 flex items-center justify-end gap-3">
              <button
                type="button"
                (click)="closeModal()"
                class="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Anuluj
              </button>
              <button
                type="button"
                (click)="saveScene()"
                class="px-6 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-lg shadow-cyan-950/40 cursor-pointer"
              >
                Zapisz Zmiany w Scenie
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class ScenesBuilder {
  readonly telemetry = inject(Telemetry);

  readonly showModal = signal<boolean>(false);
  readonly editingSceneId = signal<string | null>(null);
  readonly isExecuting = signal<string | null>(null);

  // Formularz sygnałowy edytora sceny
  readonly formName = signal<string>('');
  readonly formDesc = signal<string>('');
  readonly formSourceIeee = signal<string>('');
  readonly formQuantifier = signal<LogicQuantifier>('IF');
  readonly formMetric = signal<TriggerMetric>('temperature');
  readonly formOperator = signal<MetricOperator>('>');
  readonly formThreshold = signal<number>(24.5);
  readonly formActions = signal<SceneAction[]>([]);

  readonly scenes = signal<AutomationScene[]>([
    {
      id: 'gow007-auto-cool',
      name: 'Automatyczne Chłodzenie & Sterylizacja UV (GÖTZE & JENSEN GOW 007)',
      description: 'Włącza wentylator GOW 007 na bieg 8 z jonizacją i lampą UV gdy temperatura przekroczy 24.5°C',
      icon: 'air',
      enabled: true,
      trigger_count: 14,
      last_triggered_at: '07.10.2026 13:20:00',
      conditions: [
        {
          quantifier: 'IF',
          metric: 'temperature',
          operator: '>',
          value: 24.5,
          device_ieee: 'sonoff_snzb02_salon',
          description: 'Temperatura w Salon > 24.5°C',
        },
      ],
      actions: [
        {
          step_number: 1,
          type: 'device_command',
          target_ieee: 'wifi_gow007_fan',
          target_name: 'Wentylator Götze & Jensen GOW 007 7w1',
          command: { state: 'ON', fan_speed: 8, fan_oscillation: true, fan_ionizer: true, fan_uv: true },
          delay_seconds: 1.2,
          description: 'Wstrzyknięcie Rozkazu: Bieg 8 | Jonizacja ON | Lampa UV ON',
        },
        {
          step_number: 2,
          type: 'notification',
          target_name: 'Powiadomienie Toast',
          notification_message: 'Uruchomiono chłodzenie GOW 007 ze sterylizacją UV.',
          delay_seconds: 0.85,
          description: 'Wyślij natychmiastowy alert na serwer i aplikację Android',
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
      last_triggered_at: '07.10.2026 08:15:00',
      conditions: [
        {
          quantifier: 'IF',
          metric: 'temperature',
          operator: '<',
          value: 18.0,
          device_ieee: 'sonoff_snzb02d_sypialnia',
          description: 'Temperatura w Sypialnia < 18.0°C',
        },
      ],
      actions: [
        {
          step_number: 1,
          type: 'device_command',
          target_ieee: 'sonoff_trvzb_head',
          target_name: 'Głowica Sonoff TRVZB / TRVZB Gen 2',
          command: { current_heating_setpoint: 22.0, system_mode: 'heat' },
          delay_seconds: 0.0,
          description: 'Nastawa TRVZB -> 22.0°C | Tryb HEAT',
        },
        {
          step_number: 2,
          type: 'device_command',
          target_ieee: 'sonoff_s26r2_plug',
          target_name: 'Inteligentne Gniazdko Sonoff S26R2ZB 16A',
          command: { state: 'ON' },
          delay_seconds: 2.0,
          description: 'Włącz zasilanie ogrzewacza S26R2 (ON)',
        },
      ],
    },
  ]);

  getDeviceFriendlyName(ieee?: string): string {
    if (!ieee) return 'Wszystkie urządzenia';
    const found = this.telemetry.devices().find((d) => d.ieee_address === ieee);
    if (found) return found.friendly_name || found.ieee_address;

    if (ieee.includes('gow007')) return 'Wentylator Götze & Jensen GOW 007';
    if (ieee.includes('trvzb')) return 'Głowica Termostatyczna Sonoff TRVZB';
    if (ieee.includes('basic') || ieee.includes('zb1gsp')) return 'Przekaźnik DIN Sonoff BASIC-ZB1GSP 32A';
    if (ieee.includes('s26r2')) return 'Gniazdko Sonoff S26R2ZB 16A';
    if (ieee.includes('snzb02d')) return 'Czujnik Temp. SNZB-02D z LCD';
    if (ieee.includes('snzb02')) return 'Czujnik Temp. SNZB-02 v1';

    return ieee;
  }

  formatCommandPayload(act: SceneAction): string {
    if (act.type === 'notification') {
      return `NOTIF: "${act.notification_message || 'Alert'}"`;
    }
    if (act.command) {
      const keys = Object.keys(act.command);
      return keys.map((k) => `${k}: ${act.command?.[k]}`).join(' | ');
    }
    return '01 40 00 00 00 00 00 00';
  }

  getCumulativeTime(scene: AutomationScene, currentIdx: number): string {
    let sum = 0;
    for (let i = 0; i <= currentIdx; i++) {
      sum += scene.actions[i]?.delay_seconds || 0;
    }
    return sum.toFixed(2);
  }

  quickEditDelay(scene: AutomationScene, act: SceneAction): void {
    const val = prompt(`Podaj opóźnienie w sekundach dla kroku #${act.step_number + 1}:`, String(act.delay_seconds || 0));
    if (val !== null) {
      const num = parseFloat(val);
      if (!isNaN(num) && num >= 0) {
        this.scenes.update((list) =>
          list.map((s) => {
            if (s.id !== scene.id) return s;
            return {
              ...s,
              actions: s.actions.map((a) => (a.step_number === act.step_number ? { ...a, delay_seconds: num } : a)),
            };
          }),
        );
      }
    }
  }

  moveActionStep(scene: AutomationScene, index: number, direction: number): void {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= scene.actions.length) return;

    this.scenes.update((list) =>
      list.map((s) => {
        if (s.id !== scene.id) return s;
        const copy = [...s.actions];
        const temp = copy[index];
        copy[index] = copy[targetIdx];
        copy[targetIdx] = temp;

        // Przenumeruj kroki
        const renumbered = copy.map((a, i) => ({ ...a, step_number: i + 1 }));
        return { ...s, actions: renumbered };
      }),
    );
  }

  deleteActionStep(scene: AutomationScene, index: number): void {
    this.scenes.update((list) =>
      list.map((s) => {
        if (s.id !== scene.id) return s;
        const filtered = s.actions.filter((_, i) => i !== index);
        const renumbered = filtered.map((a, i) => ({ ...a, step_number: i + 1 }));
        return { ...s, actions: renumbered };
      }),
    );
  }

  openCreateModal(): void {
    this.editingSceneId.set(null);
    this.formName.set('');
    this.formDesc.set('');
    this.formSourceIeee.set('');
    this.formQuantifier.set('IF');
    this.formMetric.set('temperature');
    this.formOperator.set('>');
    this.formThreshold.set(24.5);
    this.formActions.set([
      {
        step_number: 1,
        type: 'device_command',
        target_ieee: 'wifi_gow007_fan',
        target_name: 'Wentylator Götze & Jensen GOW 007 7w1',
        command: { state: 'ON', fan_speed: 8, fan_ionizer: true },
        delay_seconds: 1.2,
        description: 'Włącz Wentylator Bieg 8 | Jonizacja ON',
      },
    ]);
    this.showModal.set(true);
  }

  openEditModal(scene: AutomationScene): void {
    this.editingSceneId.set(scene.id);
    this.formName.set(scene.name);
    this.formDesc.set(scene.description);

    const firstCond = scene.conditions[0];
    if (firstCond) {
      this.formSourceIeee.set(firstCond.device_ieee || '');
      this.formQuantifier.set(firstCond.quantifier || 'IF');
      this.formMetric.set(firstCond.metric || 'temperature');
      this.formOperator.set(firstCond.operator || '>');
      this.formThreshold.set(typeof firstCond.value === 'number' ? firstCond.value : 24.5);
    }

    this.formActions.set([...scene.actions]);
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  addStepToForm(): void {
    const current = this.formActions();
    const nextStepNum = current.length + 1;
    const newStep: SceneAction = {
      step_number: nextStepNum,
      type: 'device_command',
      target_ieee: 'sonoff_s26r2_plug',
      target_name: 'Inteligentne Gniazdko S26R2ZB',
      command: { state: 'ON' },
      delay_seconds: 1.5,
      description: `Sekwencyjna Akcja #${nextStepNum}`,
    };
    this.formActions.set([...current, newStep]);
  }

  removeStepFromForm(index: number): void {
    const current = this.formActions().filter((_, i) => i !== index);
    const renumbered = current.map((a, i) => ({ ...a, step_number: i + 1 }));
    this.formActions.set(renumbered);
  }

  updateStepDevice(index: number, ieee: string): void {
    const current = [...this.formActions()];
    if (current[index]) {
      current[index] = {
        ...current[index],
        target_ieee: ieee,
        target_name: this.getDeviceFriendlyName(ieee),
      };
      this.formActions.set(current);
    }
  }

  updateStepDelay(index: number, delaySec: number): void {
    const current = [...this.formActions()];
    if (current[index]) {
      current[index] = {
        ...current[index],
        delay_seconds: isNaN(delaySec) ? 0 : delaySec,
      };
      this.formActions.set(current);
    }
  }

  updateStepDescription(index: number, desc: string): void {
    const current = [...this.formActions()];
    if (current[index]) {
      current[index] = {
        ...current[index],
        description: desc,
      };
      this.formActions.set(current);
    }
  }

  saveScene(): void {
    const id = this.editingSceneId() || `scene_${Date.now()}`;
    const name = this.formName().trim() || 'Scena Automatyczna';
    const desc = this.formDesc().trim() || 'Wizualny sekwencer algorytmu';

    const sourceIeee = this.formSourceIeee();
    const sourceName = this.getDeviceFriendlyName(sourceIeee);

    const updatedScene: AutomationScene = {
      id,
      name,
      description: desc,
      icon: 'auto_mode',
      enabled: true,
      trigger_count: 0,
      last_triggered_at: null,
      conditions: [
        {
          quantifier: this.formQuantifier(),
          metric: this.formMetric(),
          operator: this.formOperator(),
          value: this.formThreshold(),
          device_ieee: sourceIeee,
          description: `${sourceName}: ${this.formMetric()} ${this.formOperator()} ${this.formThreshold()}`,
        },
      ],
      actions: this.formActions(),
    };

    if (this.editingSceneId()) {
      this.scenes.update((list) => list.map((s) => (s.id === id ? updatedScene : s)));
    } else {
      this.scenes.update((list) => [updatedScene, ...list]);
    }

    this.showModal.set(false);
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

    // Wykonaj sekwencyjnie akcje sceny z zachowaniem zdefiniowanych opóźnień
    scene.actions.forEach((act) => {
      setTimeout(() => {
        if (act.type === 'device_command' && act.command) {
          const targetIeee = act.target_ieee || 'wifi_gow007_fan';
          this.telemetry.sendDeviceCommand(targetIeee, act.command);
        }
      }, (act.delay_seconds || 0) * 1000);
    });

    setTimeout(() => {
      this.isExecuting.set(null);
      this.scenes.update((list) =>
        list.map((s) =>
          s.id === scene.id
            ? { ...s, trigger_count: s.trigger_count + 1, last_triggered_at: formatEuropeanDateTime(new Date()) }
            : s,
        ),
      );
    }, 1500);
  }
}
