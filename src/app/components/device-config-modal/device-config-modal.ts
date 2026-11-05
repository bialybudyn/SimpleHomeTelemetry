import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Device } from '../../models/telemetry.models';
import { Telemetry } from '../../services/telemetry';

type Brand = 'sonoff' | 'tuya';

/**
 * Konfiguracja urządzeń Wi-Fi.
 * - Sonoff (eWeLink LAN): urządzenia ogłaszają się same przez mDNS; do sterowania potrzebny jest devicekey
 *   (import z konta eWeLink lub ręcznie).
 * - Tuya: import kodem QR z aplikacji Smart Life (Device ID, Local Key i mapa DP) lub ręcznie.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-device-config-modal',
  imports: [MatIconModule, JsonPipe],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md" role="dialog" aria-modal="true">
      <div class="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh]">
        <!-- Nagłówek -->
        <div class="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-800">
          <div class="flex items-center gap-2">
            <mat-icon class="text-cyan-400">wifi</mat-icon>
            <h2 class="text-base font-bold text-white">Urządzenia Wi-Fi</h2>
          </div>
          <button (click)="closeModal.emit()" class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer" aria-label="Zamknij">
            <mat-icon>close</mat-icon>
          </button>
        </div>

        <!-- Przełącznik marki -->
        <div class="flex gap-2 px-5 pt-4">
          @for (b of brands; track b.id) {
            <button
              (click)="brand.set(b.id)"
              class="px-4 py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer"
              [class]="brand() === b.id ? 'bg-cyan-600 text-white border-cyan-500' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'"
            >
              {{ b.label }}
            </button>
          }
        </div>

        <div class="overflow-y-auto px-5 py-4 space-y-5 text-xs text-slate-300">
          @if (feedback(); as f) {
            <div class="p-3 rounded-xl border" [class]="f.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-rose-950/40 border-rose-800 text-rose-300'">
              {{ f.message }}
            </div>
          }

          <!-- Lista urządzeń danej marki -->
          <section class="space-y-2">
            <h3 class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Urządzenia</h3>
            @if (brandDevices().length === 0) {
              <p class="text-slate-500">
                @if (brand() === 'sonoff') {
                  Brak urządzeń Sonoff. Gniazdka w tej samej sieci pojawią się same po ogłoszeniu mDNS (zwykle w ciągu 2 minut).
                } @else {
                  Brak urządzeń Tuya. Zaimportuj je kodem QR albo dodaj ręcznie poniżej.
                }
              </p>
            }
            @for (d of brandDevices(); track d.ieee_address) {
              <button
                (click)="select(d)"
                class="w-full flex items-center justify-between gap-3 p-3 rounded-xl border text-left cursor-pointer transition-all"
                [class]="selected()?.ieee_address === d.ieee_address ? 'border-cyan-600 bg-cyan-950/30' : 'border-slate-800 bg-slate-950/60 hover:border-slate-700'"
              >
                <div class="min-w-0">
                  <div class="font-semibold text-white truncate">{{ d.friendly_name }}</div>
                  <div class="text-[11px] text-slate-500 font-mono truncate">
                    {{ d.sonoff_device_id || d.tuya_dev_id }} · {{ d.ip_address || 'IP nieznany' }}
                  </div>
                  @if (d.last_error) {
                    <div class="text-[11px] text-amber-400 truncate">{{ d.last_error }}</div>
                  }
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border"
                    [class]="hasKey(d) ? 'bg-emerald-950/50 text-emerald-300 border-emerald-800' : 'bg-amber-950/50 text-amber-300 border-amber-800'">
                    {{ hasKey(d) ? 'klucz OK' : 'brak klucza' }}
                  </span>
                  <span class="w-2 h-2 rounded-full" [class]="d.connection_status === 'online' ? 'bg-emerald-400' : 'bg-slate-600'"></span>
                </div>
              </button>
            }
          </section>

          <!-- Edycja wybranego urządzenia -->
          @if (selected(); as d) {
            <section class="space-y-3 p-4 rounded-2xl bg-slate-950/60 border border-slate-800">
              <h3 class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Ustawienia: {{ d.friendly_name }}</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label class="space-y-1">
                  <span class="text-slate-400">Nazwa</span>
                  <input class="field" [value]="editName()" (input)="editName.set(val($event))" />
                </label>
                <label class="space-y-1">
                  <span class="text-slate-400">Adres IP (puste = automatycznie)</span>
                  <input class="field font-mono" [value]="editIp()" (input)="editIp.set(val($event))" placeholder="192.168.1.50" />
                </label>
                @if (brand() === 'sonoff') {
                  <label class="space-y-1 sm:col-span-2">
                    <span class="text-slate-400">devicekey {{ d.has_sonoff_key ? '(zapisany — wpisz, aby zmienić)' : '' }}</span>
                    <input class="field font-mono" type="password" [value]="editKey()" (input)="editKey.set(val($event))" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                  </label>
                } @else {
                  <label class="space-y-1">
                    <span class="text-slate-400">Local Key {{ d.has_local_key ? '(zapisany — wpisz, aby zmienić)' : '' }}</span>
                    <input class="field font-mono" type="password" [value]="editKey()" (input)="editKey.set(val($event))" />
                  </label>
                  <label class="space-y-1">
                    <span class="text-slate-400">Wersja protokołu</span>
                    <select class="field" [value]="editVersion()" (change)="editVersion.set(val($event))">
                      @for (v of tuyaVersions; track v) {
                        <option [value]="v">{{ v }}</option>
                      }
                    </select>
                  </label>
                  <label class="space-y-1 sm:col-span-2">
                    <span class="text-slate-400">Mapa DP (JSON: numer DP → kod funkcji Tuya)</span>
                    <textarea class="field font-mono h-28" [value]="editDpMap()" (input)="editDpMap.set(val($event))"
                      placeholder='{"1": {"code": "switch"}, "3": {"code": "fan_speed", "type": "Integer"}}'></textarea>
                  </label>
                  @if (d.raw_state && hasKeys(d.raw_state)) {
                    <div class="sm:col-span-2 space-y-1">
                      <span class="text-slate-400">Ostatni stan z urządzenia</span>
                      <pre class="p-2 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-300 overflow-x-auto">{{ d.raw_state | json }}</pre>
                    </div>
                  }
                }
              </div>
              <div class="flex flex-wrap gap-2">
                <button (click)="saveSelected()" [disabled]="busy()" class="btn-primary">Zapisz</button>
                <button (click)="refreshSelected()" [disabled]="busy()" class="btn-secondary">Odczytaj stan</button>
              </div>
            </section>
          }

          @if (brand() === 'sonoff') {
            <!-- Import kluczy z eWeLink -->
            <section class="space-y-3 p-4 rounded-2xl bg-slate-950/60 border border-slate-800">
              <h3 class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Import kluczy z konta eWeLink</h3>
              <p class="text-slate-400">
                Jednorazowo pobiera deviceid i devicekey Twoich urządzeń. Potem sterowanie odbywa się wyłącznie w sieci lokalnej.
                Potrzebny jest własny, darmowy AppID i AppSecret z <span class="font-mono text-slate-300">dev.ewelink.cc</span>.
                Hasło nie jest zapisywane.
              </p>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input class="field font-mono" placeholder="AppID" [value]="ewAppId()" (input)="ewAppId.set(val($event))" />
                <input class="field font-mono" type="password" placeholder="AppSecret" [value]="ewAppSecret()" (input)="ewAppSecret.set(val($event))" />
                <input class="field" placeholder="E-mail lub telefon" [value]="ewLogin()" (input)="ewLogin.set(val($event))" />
                <input class="field" type="password" placeholder="Hasło eWeLink" [value]="ewPassword()" (input)="ewPassword.set(val($event))" />
                <select class="field" [value]="ewRegion()" (change)="ewRegion.set(val($event))">
                  <option value="eu">Europa (eu)</option>
                  <option value="us">Ameryka (us)</option>
                  <option value="as">Azja (as)</option>
                  <option value="cn">Chiny (cn)</option>
                </select>
              </div>
              <button (click)="importEwelink()" [disabled]="busy()" class="btn-primary">Importuj klucze</button>
            </section>

            <!-- Ręczne dodanie -->
            <section class="space-y-3 p-4 rounded-2xl bg-slate-950/60 border border-slate-800">
              <h3 class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Dodaj ręcznie</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input class="field" placeholder="Nazwa" [value]="newName()" (input)="newName.set(val($event))" />
                <input class="field font-mono" placeholder="deviceid (np. 1000abcdef)" [value]="newId()" (input)="newId.set(val($event))" />
                <input class="field font-mono" type="password" placeholder="devicekey (puste dla trybu DIY)" [value]="newKey()" (input)="newKey.set(val($event))" />
                <input class="field font-mono" placeholder="IP (opcjonalnie)" [value]="newIp()" (input)="newIp.set(val($event))" />
              </div>
              <button (click)="addManual()" [disabled]="busy()" class="btn-secondary">Dodaj urządzenie Sonoff</button>
            </section>
          } @else {
            <!-- Tuya QR -->
            <section class="space-y-3 p-4 rounded-2xl bg-slate-950/60 border border-slate-800">
              <h3 class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Import z aplikacji Smart Life / Tuya Smart (kod QR)</h3>
              <p class="text-slate-400">
                W aplikacji: Ja → Ustawienia → Konto i bezpieczeństwo → Kod użytkownika. Wpisz go poniżej, a potem zeskanuj kod QR aplikacją.
                Pobrane zostaną Device ID, Local Key i mapa funkcji (DP) każdego urządzenia.
              </p>
              @if (!qrDataUrl()) {
                <div class="flex flex-wrap gap-2">
                  <input class="field font-mono max-w-xs" placeholder="Kod użytkownika" [value]="userCode()" (input)="userCode.set(val($event))" />
                  <button (click)="generateQr()" [disabled]="busy() || !userCode()" class="btn-primary">Generuj kod QR</button>
                </div>
              } @else {
                <div class="flex flex-col items-center gap-2">
                  <img [src]="qrDataUrl()" alt="Kod QR Tuya" class="w-56 h-56 rounded-xl bg-white p-2" />
                  <span class="text-slate-400">Oczekiwanie na zatwierdzenie w aplikacji…</span>
                  <button (click)="cancelQr()" class="btn-secondary">Anuluj</button>
                </div>
              }
            </section>

            <!-- Ręczne dodanie Tuya -->
            <section class="space-y-3 p-4 rounded-2xl bg-slate-950/60 border border-slate-800">
              <h3 class="text-[11px] font-bold uppercase tracking-wider text-slate-400">Dodaj ręcznie</h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input class="field" placeholder="Nazwa" [value]="newName()" (input)="newName.set(val($event))" />
                <input class="field font-mono" placeholder="Device ID" [value]="newId()" (input)="newId.set(val($event))" />
                <input class="field font-mono" type="password" placeholder="Local Key" [value]="newKey()" (input)="newKey.set(val($event))" />
                <input class="field font-mono" placeholder="IP (opcjonalnie)" [value]="newIp()" (input)="newIp.set(val($event))" />
                <select class="field" [value]="newCategory()" (change)="newCategory.set(val($event))">
                  <option value="plug">Gniazdko</option>
                  <option value="switch">Przełącznik</option>
                  <option value="fan">Wentylator</option>
                  <option value="smoke">Czujka dymu</option>
                  <option value="sensor">Czujnik</option>
                </select>
                <select class="field" [value]="newVersion()" (change)="newVersion.set(val($event))">
                  @for (v of tuyaVersions; track v) {
                    <option [value]="v">Protokół {{ v }}</option>
                  }
                </select>
              </div>
              <button (click)="addManual()" [disabled]="busy()" class="btn-secondary">Dodaj urządzenie Tuya</button>
            </section>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .field { width: 100%; padding: 0.5rem 0.75rem; border-radius: 0.75rem; background: rgb(2 6 23); border: 1px solid rgb(30 41 59); color: white; outline: none; }
    .field:focus { border-color: rgb(8 145 178); }
    .btn-primary { padding: 0.5rem 1rem; border-radius: 0.75rem; background: rgb(8 145 178); color: white; font-weight: 700; cursor: pointer; }
    .btn-secondary { padding: 0.5rem 1rem; border-radius: 0.75rem; background: rgb(30 41 59); color: rgb(226 232 240); font-weight: 600; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: default; }
  `,
})
export class DeviceConfigModal implements OnInit {
  readonly telemetry = inject(Telemetry);
  private destroyRef = inject(DestroyRef);

  readonly targetDevice = input<Device | null>(null);
  readonly initialBrand = input<Brand>('sonoff');
  readonly closeModal = output<void>();

  readonly brands: { id: Brand; label: string }[] = [
    { id: 'sonoff', label: 'Sonoff (eWeLink LAN)' },
    { id: 'tuya', label: 'Tuya / Smart Life' },
  ];
  readonly tuyaVersions = ['3.1', '3.3', '3.4', '3.5'];

  readonly brand = signal<Brand>('sonoff');
  readonly busy = signal(false);
  readonly feedback = signal<{ ok: boolean; message: string } | null>(null);
  private selectedId = signal<string | null>(null);

  // edycja wybranego urządzenia
  readonly editName = signal('');
  readonly editIp = signal('');
  readonly editKey = signal('');
  readonly editVersion = signal('3.3');
  readonly editDpMap = signal('');

  // eWeLink
  readonly ewAppId = signal('');
  readonly ewAppSecret = signal('');
  readonly ewLogin = signal('');
  readonly ewPassword = signal('');
  readonly ewRegion = signal('eu');

  // dodawanie ręczne
  readonly newName = signal('');
  readonly newId = signal('');
  readonly newKey = signal('');
  readonly newIp = signal('');
  readonly newCategory = signal('plug');
  readonly newVersion = signal('3.3');

  // Tuya QR
  readonly userCode = signal('');
  readonly qrDataUrl = signal('');
  private qrTimer: ReturnType<typeof setInterval> | null = null;

  readonly brandDevices = computed(() => {
    const driver = this.brand();
    return this.telemetry.allDevices().filter((d) => d.driver === driver && !d.is_deleted);
  });

  readonly selected = computed(() => {
    const id = this.selectedId();
    return id ? (this.telemetry.allDevices().find((d) => d.ieee_address === id) ?? null) : null;
  });

  ngOnInit(): void {
    const target = this.targetDevice();
    this.brand.set(target?.driver === 'tuya' ? 'tuya' : target?.driver === 'sonoff' ? 'sonoff' : this.initialBrand());
    if (target && (target.driver === 'sonoff' || target.driver === 'tuya')) this.select(target);
    this.telemetry.getEwelinkSettings().then((s) => {
      this.ewAppId.set(s.app_id ?? '');
      this.ewAppSecret.set(s.app_secret ?? '');
      this.ewLogin.set(s.login ?? '');
      this.ewRegion.set(s.region || 'eu');
    });
    this.destroyRef.onDestroy(() => this.cancelQr());
  }

  val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  hasKey(d: Device): boolean {
    return d.driver === 'tuya' ? Boolean(d.has_local_key) : Boolean(d.has_sonoff_key);
  }

  hasKeys(o: Record<string, unknown>): boolean {
    return Object.keys(o).length > 0;
  }

  select(d: Device): void {
    this.selectedId.set(d.ieee_address);
    this.editName.set(d.friendly_name);
    this.editIp.set(d.ip_address ?? '');
    this.editKey.set('');
    this.editVersion.set(d.tuya_protocol_version || '3.3');
    this.editDpMap.set(d.tuya_dp_map ? JSON.stringify(d.tuya_dp_map, null, 2) : '');
  }

  private done(ok: boolean, message: string): void {
    this.feedback.set({ ok, message });
    this.busy.set(false);
  }

  async saveSelected(): Promise<void> {
    const d = this.selected();
    if (!d) return;
    this.busy.set(true);
    const isTuya = d.driver === 'tuya';
    const res = await this.telemetry.configureDevice(d.ieee_address, {
      friendly_name: this.editName().trim(),
      ip_address: this.editIp().trim(),
      ...(isTuya
        ? { local_key: this.editKey().trim(), tuya_protocol_version: this.editVersion(), tuya_dp_map: this.editDpMap().trim() || null }
        : { sonoff_device_key: this.editKey().trim() }),
    });
    this.editKey.set('');
    this.done(res.success, res.message);
  }

  async refreshSelected(): Promise<void> {
    const d = this.selected();
    if (!d) return;
    this.busy.set(true);
    const res = await this.telemetry.testDeviceConnection(d.ieee_address);
    this.done(res.success, res.message);
  }

  async importEwelink(): Promise<void> {
    this.busy.set(true);
    const res = await this.telemetry.importEwelink({
      app_id: this.ewAppId().trim(),
      app_secret: this.ewAppSecret().trim(),
      login: this.ewLogin().trim(),
      password: this.ewPassword(),
      region: this.ewRegion(),
    });
    this.ewPassword.set('');
    this.done(res.success, res.message);
  }

  async addManual(): Promise<void> {
    this.busy.set(true);
    const isTuya = this.brand() === 'tuya';
    const res = await this.telemetry.addWifiDevice({
      driver: this.brand(),
      name: this.newName().trim(),
      device_id: this.newId().trim(),
      ip_address: this.newIp().trim(),
      ...(isTuya
        ? { local_key: this.newKey().trim(), category: this.newCategory(), version: this.newVersion() }
        : { device_key: this.newKey().trim() }),
    });
    if (res.success) {
      this.newName.set('');
      this.newId.set('');
      this.newKey.set('');
      this.newIp.set('');
    }
    this.done(res.success, res.message);
  }

  generateQr(): void {
    this.busy.set(true);
    const code = this.userCode().trim();
    this.telemetry.generateTuyaQr(code).subscribe({
      next: (res) => {
        this.busy.set(false);
        if (!res.success || !res.token || !res.qr_data_url) {
          this.done(false, res.error || 'Nie udało się wygenerować kodu QR.');
          return;
        }
        this.qrDataUrl.set(res.qr_data_url);
        this.pollQr(res.token, code);
      },
      error: () => this.done(false, 'Błąd połączenia z serwerem.'),
    });
  }

  private pollQr(token: string, code: string): void {
    this.cancelQr();
    this.qrTimer = setInterval(() => {
      this.telemetry.checkTuyaQrStatus(token, code).subscribe((status) => {
        if (status.status === 'waiting') return;
        this.cancelQr();
        this.done(status.status === 'authorized', status.message);
        this.telemetry.fetchDevices();
      });
    }, 3000);
  }

  cancelQr(): void {
    if (this.qrTimer) clearInterval(this.qrTimer);
    this.qrTimer = null;
    this.qrDataUrl.set('');
  }
}
