import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Device, TuyaDeviceExtracted } from '../../models/telemetry.models';
import { Telemetry } from '../../services/telemetry';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-tuya-qr-modal',
  imports: [MatIconModule, ReactiveFormsModule],
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div
        class="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl shadow-cyan-950/40 overflow-hidden"
      >
        <!-- Nagłówek modala -->
        <div class="p-6 border-b border-slate-800/80 flex items-center justify-between shrink-0 bg-slate-950/50">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600/20 to-blue-600/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-inner">
              <mat-icon class="text-xl">qr_code_scanner</mat-icon>
            </div>
            <div>
              <h2 class="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <span>Tuya Local Key – Kod QR</span>
                <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  Bez konta dewelopera
                </span>
              </h2>
              <p class="text-xs text-slate-400">
                Wyciągnij klucz szyfrujący Local Key do bezpośredniego sterowania w domowej sieci Wi-Fi
              </p>
            </div>
          </div>

          <button
            (click)="closeModal.emit()"
            class="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Zamknij okno"
          >
            <mat-icon class="text-xl">close</mat-icon>
          </button>
        </div>

        <!-- Zakładki: Skanowanie QR vs Ręczne Wprowadzenie -->
        <div class="flex border-b border-slate-800/80 px-6 pt-2 bg-slate-950/30 shrink-0 gap-4">
          <button
            (click)="activeTab.set('qr')"
            class="pb-3 text-xs font-bold transition-all border-b-2 cursor-pointer flex items-center gap-1.5"
            [class.border-cyan-400]="activeTab() === 'qr'"
            [class.text-cyan-300]="activeTab() === 'qr'"
            [class.border-transparent]="activeTab() !== 'qr'"
            [class.text-slate-400]="activeTab() !== 'qr'"
          >
            <mat-icon class="text-xs !w-4 !h-4">qr_code</mat-icon>
            <span>Skanowanie kodu QR (Zalecane)</span>
          </button>

          <button
            (click)="activeTab.set('manual')"
            class="pb-3 text-xs font-bold transition-all border-b-2 cursor-pointer flex items-center gap-1.5"
            [class.border-cyan-400]="activeTab() === 'manual'"
            [class.text-cyan-300]="activeTab() === 'manual'"
            [class.border-transparent]="activeTab() !== 'manual'"
            [class.text-slate-400]="activeTab() !== 'manual'"
          >
            <mat-icon class="text-xs !w-4 !h-4">edit_note</mat-icon>
            <span>Wpisz Local Key ręcznie</span>
          </button>
        </div>

        <!-- Główna zawartość z przewijaniem -->
        <div class="p-6 overflow-y-auto space-y-6 flex-1">
          <!-- ZAKŁADKA 1: SKANOWANIE KODU QR -->
          @if (activeTab() === 'qr') {
            <!-- Krok 1: Wprowadzenie User Code -->
            @if (!qrDataUrl()) {
              <div class="space-y-4">
                <div class="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2 text-xs text-slate-300">
                  <div class="flex items-center gap-2 text-cyan-400 font-bold">
                    <mat-icon class="text-sm !w-4 !h-4">info</mat-icon>
                    <span>Jak to działa?</span>
                  </div>
                  <p class="leading-relaxed text-slate-400">
                    Aplikacja korzysta z oficjalnego mechanizmu Device Sharing od Tuya. Po wpisaniu Twojego
                    <strong class="text-white">Kodu Użytkownika (User Code)</strong> wygenerujemy kod QR. Zeskanuj go w aplikacji Tuya Smart lub Smart Life na telefonie i kliknij "Zatwierdź". Program natychmiast odczyta listę Twoich urządzeń z kluczami Local Key!
                  </p>
                </div>

                <!-- Instrukcja odnalezienia User Code w aplikacji -->
                <div class="p-4 rounded-2xl bg-cyan-950/20 border border-cyan-800/30 space-y-2">
                  <div class="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                    <mat-icon class="text-xs !w-4 !h-4">phone_iphone</mat-icon>
                    <span>Gdzie znaleźć Kod Użytkownika w telefonie?</span>
                  </div>
                  <ol class="list-decimal list-inside text-xs text-slate-300 space-y-1 pl-1">
                    <li>Otwórz aplikację <strong class="text-white">Smart Life</strong> lub <strong class="text-white">Tuya Smart</strong>.</li>
                    <li>Przejdź do zakładki <strong class="text-white">"Ja" (Profil)</strong> w prawym dolnym rogu.</li>
                    <li>Stuknij ikonę <strong class="text-white">koła zębatego (Ustawienia)</strong> w prawym górnym rogu.</li>
                    <li>Wybierz <strong class="text-white">"Konto i bezpieczeństwo"</strong>.</li>
                    <li>Na dole ekranu znajdziesz <strong class="text-cyan-400 font-mono">"Kod użytkownika" (User Code)</strong>.</li>
                  </ol>
                </div>

                <form [formGroup]="userCodeForm" (ngSubmit)="generateQr()" class="space-y-4">
                  <div>
                    <label for="userCodeInput" class="block text-xs font-bold text-slate-300 mb-1.5">
                      Wpisz swój Kod Użytkownika (User Code):
                    </label>
                    <input
                      id="userCodeInput"
                      type="text"
                      formControlName="userCode"
                      placeholder="np. ay1234567890abcdef"
                      class="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                    />
                    @if (userCodeForm.get('userCode')?.invalid && userCodeForm.get('userCode')?.touched) {
                      <span class="text-[11px] text-rose-400 mt-1 block">Kod użytkownika jest wymagany.</span>
                    }
                  </div>

                  @if (errorMessage()) {
                    <div class="p-3 rounded-xl bg-rose-950/50 border border-rose-800/80 text-rose-300 text-xs flex items-center gap-2">
                      <mat-icon class="text-sm !w-4 !h-4 text-rose-400">error</mat-icon>
                      <span>{{ errorMessage() }}</span>
                    </div>
                  }

                  <button
                    type="submit"
                    [disabled]="isLoading() || userCodeForm.invalid"
                    class="w-full py-3 rounded-xl font-bold text-sm bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white flex items-center justify-center gap-2 shadow-lg shadow-cyan-950 transition-all cursor-pointer"
                  >
                    @if (isLoading()) {
                      <mat-icon class="text-sm !w-4 !h-4 animate-spin">refresh</mat-icon>
                      <span>Generowanie kodu QR...</span>
                    } @else {
                      <mat-icon class="text-sm !w-4 !h-4">qr_code_2</mat-icon>
                      <span>Generuj Kod QR do Skanowania</span>
                    }
                  </button>
                </form>
              </div>
            }

            <!-- Krok 2: Wyświetlanie Kodu QR i Oczekiwanie na Skan -->
            @if (qrDataUrl() && !isAuthorized()) {
              <div class="space-y-5 text-center">
                <div class="p-4 rounded-2xl bg-cyan-950/20 border border-cyan-800/40 text-xs text-cyan-200">
                  <div class="font-bold mb-1 flex items-center justify-center gap-1.5">
                    <mat-icon class="text-sm !w-4 !h-4 text-cyan-400 animate-pulse">sensors</mat-icon>
                    <span>Zeskanuj kod QR aparatem w aplikacji Tuya / Smart Life</span>
                  </div>
                  <p class="text-slate-400">
                    W aplikacji na telefonie kliknij <strong class="text-white">[+] w prawym górnym rogu</strong>, wybierz <strong class="text-white">"Skanuj"</strong> i skieruj obiektyw na monitor. Następnie kliknij <strong class="text-white">"Zatwierdź logowanie"</strong>.
                  </p>
                </div>

                <!-- Kontener z kodem QR -->
                <div class="inline-block p-4 rounded-3xl bg-white shadow-2xl shadow-cyan-500/10 border-4 border-cyan-500/30">
                  <img
                    [src]="qrDataUrl()"
                    alt="Kod QR Tuya do logowania"
                    class="w-64 h-64 mx-auto rounded-xl object-contain block"
                  />
                </div>

                <!-- Pasek statusu oczekiwania -->
                <div class="flex items-center justify-center gap-3 text-xs font-mono">
                  <span class="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping"></span>
                  <span class="text-slate-300 font-semibold">Oczekiwanie na potwierdzenie w telefonie...</span>
                  <span class="text-slate-500">({{ timeRemaining() }}s)</span>
                </div>

                <div class="flex items-center justify-center gap-3 pt-2">
                  <button
                    (click)="cancelQr()"
                    class="px-4 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    Anuluj i wprowadź inny kod
                  </button>
                </div>
              </div>
            }

            <!-- Krok 3: Sukces! Pobrano Urządzenia i Local Key -->
            @if (isAuthorized()) {
              <div class="space-y-4">
                <div class="p-4 rounded-2xl bg-emerald-950/30 border border-emerald-500/40 text-emerald-300 flex items-center gap-3">
                  <div class="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
                    <mat-icon class="text-xl">check_circle</mat-icon>
                  </div>
                  <div>
                    <h4 class="font-bold text-sm text-white">Sukces! Zalogowano konto Tuya</h4>
                    <p class="text-xs text-emerald-300/80">
                      Pomyślnie wyciągnięto klucze Local Key dla {{ extractedDevices().length }} urządzeń.
                    </p>
                  </div>
                </div>

                <h3 class="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Wykryte Urządzenia w Twoim Koncie Tuya:
                </h3>

                @if (extractedDevices().length === 0) {
                  <div class="p-6 text-center rounded-2xl bg-slate-950/60 border border-slate-800 text-slate-400 text-xs">
                    Nie znaleziono zarejestrowanych urządzeń w tym profilu Tuya.
                  </div>
                } @else {
                  <div class="space-y-3">
                    @for (dev of extractedDevices(); track dev.id) {
                      <div class="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-3">
                        <div class="flex items-start justify-between gap-3">
                          <div>
                            <div class="flex items-center gap-2">
                              <h4 class="font-bold text-white text-sm">{{ dev.name }}</h4>
                              <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                                {{ dev.category || 'Tuya' }}
                              </span>
                            </div>
                            <div class="text-[11px] font-mono text-slate-500 mt-0.5">
                              Model: {{ dev.product_name || 'Tuya Device' }} | ID: {{ dev.id }}
                            </div>
                          </div>

                          @if (dev.ip) {
                            <span class="text-[11px] font-mono text-indigo-400 shrink-0 font-bold">
                              IP: {{ dev.ip }}
                            </span>
                          }
                        </div>

                        <!-- Klucz Local Key -->
                        <div class="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-2 text-xs font-mono">
                          <div class="flex items-center gap-2 min-w-0">
                            <mat-icon class="text-xs text-amber-400 !w-4 !h-4">vpn_key</mat-icon>
                            <span class="text-slate-400">Local Key:</span>
                            <span class="text-emerald-300 font-bold select-all truncate">
                              {{ dev.local_key || '(brak klucza)' }}
                            </span>
                          </div>

                          <button
                            (click)="copyToClipboard(dev.local_key)"
                            class="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] transition-colors cursor-pointer"
                            title="Kopiuj Local Key"
                          >
                            Kopiuj
                          </button>
                        </div>

                        <!-- Przyciski akcji: Przypisz do urządzenia w panelu -->
                        <div class="flex items-center gap-2 pt-1 flex-wrap">
                          @if (targetDevice()) {
                            <button
                              (click)="bindToTargetDevice(dev)"
                              class="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm shadow-emerald-950"
                            >
                              <mat-icon class="text-xs !w-3.5 !h-3.5">link</mat-icon>
                              <span>Przypisz do: {{ targetDevice()?.friendly_name }}</span>
                            </button>
                          } @else {
                            <button
                              (click)="bindToFan(dev)"
                              class="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm shadow-cyan-950"
                            >
                              <mat-icon class="text-xs !w-3.5 !h-3.5">mode_fan</mat-icon>
                              <span>Przypisz do Wentylatora (GOW 007)</span>
                            </button>
                            <button
                              (click)="addNewWifiDevice(dev)"
                              class="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                              <mat-icon class="text-xs !w-3.5 !h-3.5">add</mat-icon>
                              <span>Dodaj jako nowe urządzenie Wi-Fi</span>
                            </button>
                          }
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          }

          <!-- ZAKŁADKA 2: RĘCZNE WPROWADZENIE LOCAL KEY -->
          @if (activeTab() === 'manual') {
            <form [formGroup]="manualForm" (ngSubmit)="saveManualKey()" class="space-y-4">
              <div class="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-1 text-xs text-slate-400">
                <span class="text-white font-bold block mb-1">Ręczna konfiguracja TinyTuya & Local Key</span>
                Wpisz 16-znakowy Local Key oraz Device ID, aby włączyć natywne, lokalne sterowanie LAN przez silnik TinyTuya (dla wentylatorów GOW 007, gniazdek 16A, czujek dymu i włączników).
              </div>

              <div>
                <label for="targetIeeeSelect" class="block text-xs font-bold text-slate-300 mb-1">Wybierz urządzenie do konfiguracji:</label>
                <select
                  id="targetIeeeSelect"
                  formControlName="targetIeee"
                  class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs"
                >
                  @for (dev of wifiDevices(); track dev.ieee_address) {
                    <option [value]="dev.ieee_address">
                      {{ dev.friendly_name }} ({{ dev.category }}, IP: {{ dev.ip_address || 'brak' }})
                    </option>
                  }
                </select>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label for="ipAddressInput" class="block text-xs font-bold text-slate-300 mb-1">Adres IP w sieci domowej:</label>
                  <input
                    id="ipAddressInput"
                    type="text"
                    formControlName="ipAddress"
                    placeholder="np. 192.168.1.150"
                    class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label for="devIdInput" class="block text-xs font-bold text-slate-300 mb-1">Device ID (ID Urządzenia Tuya):</label>
                  <input
                    id="devIdInput"
                    type="text"
                    formControlName="devId"
                    placeholder="np. bf9a87d654321..."
                    class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div>
                <label for="localKeyInput" class="block text-xs font-bold text-slate-300 mb-1">Local Key (16 znaków):</label>
                <input
                  id="localKeyInput"
                  type="text"
                  formControlName="localKey"
                  placeholder="np. a1b2c3d4e5f6g7h8"
                  class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-emerald-300 font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div class="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  [disabled]="manualForm.invalid"
                  class="flex-1 py-2.5 rounded-xl font-bold text-xs bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white flex items-center justify-center gap-2 shadow-md transition-colors cursor-pointer"
                >
                  <mat-icon class="text-xs !w-4 !h-4">save</mat-icon>
                  <span>Zapisz Local Key dla urządzenia</span>
                </button>

                <button
                  type="button"
                  (click)="testManualConnection()"
                  [disabled]="!manualForm.get('ipAddress')?.value || !manualForm.get('localKey')?.value || isTesting()"
                  class="px-4 py-2.5 rounded-xl font-bold text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  @if (isTesting()) {
                    <mat-icon class="text-xs !w-3.5 !h-3.5 animate-spin">refresh</mat-icon>
                    <span>Testowanie...</span>
                  } @else {
                    <mat-icon class="text-xs !w-3.5 !h-3.5 text-cyan-400">network_ping</mat-icon>
                    <span>Testuj połączenie</span>
                  }
                </button>
              </div>

              @if (testMessage()) {
                <div
                  class="p-3 rounded-xl text-xs font-mono border"
                  [class.bg-emerald-950/40]="testSuccess()"
                  [class.border-emerald-500/40]="testSuccess()"
                  [class.text-emerald-300]="testSuccess()"
                  [class.bg-rose-950/40]="!testSuccess()"
                  [class.border-rose-800/80]="!testSuccess()"
                  [class.text-rose-300]="!testSuccess()"
                >
                  {{ testMessage() }}
                </div>
              }
            </form>
          }
        </div>

        <!-- Stopka -->
        <div class="p-4 border-t border-slate-800/80 bg-slate-950/50 flex items-center justify-between shrink-0">
          <div class="text-[11px] font-mono text-slate-500">
            Protokół Tuya Local 3.3/3.4 (AES-128-ECB na porcie 6668)
          </div>
          <button
            (click)="closeModal.emit()"
            class="px-4 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors cursor-pointer"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  `,
})
export class TuyaQrModal {
  readonly telemetry = inject(Telemetry);
  private destroyRef = inject(DestroyRef);

  readonly targetDevice = input<Device | null>(null);
  readonly closeModal = output<void>();
  readonly deviceUpdated = output<Device>();

  readonly activeTab = signal<'qr' | 'manual'>('qr');
  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string>('');

  readonly qrDataUrl = signal<string>('');
  readonly activeToken = signal<string>('');
  readonly timeRemaining = signal<number>(180);
  readonly isAuthorized = signal<boolean>(false);
  readonly extractedDevices = signal<TuyaDeviceExtracted[]>([]);

  readonly isTesting = signal<boolean>(false);
  readonly testMessage = signal<string>('');
  readonly testSuccess = signal<boolean>(false);

  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private timerInterval: ReturnType<typeof setInterval> | null = null;

  readonly userCodeForm = new FormGroup({
    userCode: new FormControl('', [Validators.required, Validators.minLength(4)]),
  });

  readonly manualForm = new FormGroup({
    targetIeee: new FormControl('', [Validators.required]),
    ipAddress: new FormControl('', [Validators.required]),
    devId: new FormControl(''),
    localKey: new FormControl('', [Validators.required, Validators.minLength(8)]),
  });

  readonly wifiDevices = signal<Device[]>([]);

  constructor() {
    // Odczytaj listę urządzeń
    const all = this.telemetry.devices();
    const wifiOnly = all.filter((d) => d.protocol === 'wifi' || d.category === 'fan');
    this.wifiDevices.set(wifiOnly.length > 0 ? wifiOnly : all);

    if (this.targetDevice()) {
      const td = this.targetDevice()!;
      this.manualForm.patchValue({
        targetIeee: td.ieee_address,
        ipAddress: td.ip_address || '',
        devId: td.tuya_dev_id || td.ieee_address.replace('wifi_', ''),
        localKey: td.local_key || '',
      });
    } else if (wifiOnly.length > 0) {
      this.manualForm.patchValue({
        targetIeee: wifiOnly[0].ieee_address,
        ipAddress: wifiOnly[0].ip_address || '',
        devId: wifiOnly[0].tuya_dev_id || '',
        localKey: wifiOnly[0].local_key || '',
      });
    }

    this.destroyRef.onDestroy(() => {
      this.clearTimers();
    });
  }

  private clearTimers(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  generateQr(): void {
    if (this.userCodeForm.invalid) return;
    const userCode = this.userCodeForm.get('userCode')?.value?.trim() || '';

    this.isLoading.set(true);
    this.errorMessage.set('');
    this.clearTimers();

    this.telemetry.generateTuyaQr(userCode).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.success && res.qr_data_url && res.token) {
          this.qrDataUrl.set(res.qr_data_url);
          this.activeToken.set(res.token);
          this.timeRemaining.set(res.expires_in || 180);
          this.startPolling(res.token, userCode);
        } else {
          this.errorMessage.set(res.error || 'Nie udało się wygenerować kodu QR.');
        }
      },
      error: (err) => {
        this.isLoading.set(false);
        this.errorMessage.set(err?.error?.error || 'Błąd połączenia z usługą Tuya.');
      },
    });
  }

  private startPolling(token: string, userCode: string): void {
    this.clearTimers();

    // Odliczanie czasu ważności kodu
    this.timerInterval = setInterval(() => {
      const cur = this.timeRemaining();
      if (cur <= 1) {
        this.clearTimers();
        this.cancelQr();
        this.errorMessage.set('Kod QR wygasł. Proszę wygenerować nowy kod.');
      } else {
        this.timeRemaining.set(cur - 1);
      }
    }, 1000);

    // Sprawdzanie autoryzacji co 2 sekundy
    this.pollInterval = setInterval(() => {
      this.telemetry.checkTuyaQrStatus(token, userCode).subscribe({
        next: (statusRes) => {
          if (statusRes.status === 'authorized') {
            this.clearTimers();
            this.isAuthorized.set(true);
            this.extractedDevices.set(statusRes.devices || []);
          } else if (statusRes.status === 'expired') {
            this.clearTimers();
            this.cancelQr();
            this.errorMessage.set('Kod QR wygasł.');
          }
        },
        error: (err: unknown) => {
          console.debug('Tuya QR polling error:', err);
        },
      });
    }, 2000);
  }

  cancelQr(): void {
    this.clearTimers();
    this.qrDataUrl.set('');
    this.activeToken.set('');
  }

  copyToClipboard(text: string): void {
    if (!text) return;
    navigator.clipboard?.writeText(text);
  }

  bindToTargetDevice(dev: TuyaDeviceExtracted): void {
    const target = this.targetDevice();
    if (!target) return;
    this.telemetry
      .bindTuyaDevice({
        ieee_address: target.ieee_address,
        local_key: dev.local_key,
        tuya_dev_id: dev.id,
        ip_address: dev.ip || target.ip_address,
        product_name: dev.product_name,
      })
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.deviceUpdated.emit(res.device);
            this.closeModal.emit();
          }
        },
      });
  }

  bindToFan(dev: TuyaDeviceExtracted): void {
    const all = this.telemetry.devices();
    const fanDev = all.find((d) => d.category === 'fan' || d.model.toLowerCase().includes('gow'));

    const targetIeee = fanDev ? fanDev.ieee_address : `wifi_${(dev.ip || 'tuya_fan').replace(/\./g, '_')}`;

    this.telemetry
      .bindTuyaDevice({
        ieee_address: targetIeee,
        local_key: dev.local_key,
        tuya_dev_id: dev.id,
        ip_address: dev.ip,
        product_name: dev.product_name || 'GÖTZE & JENSEN GOW 007 7w1',
      })
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.deviceUpdated.emit(res.device);
            this.closeModal.emit();
          }
        },
      });
  }

  addNewWifiDevice(dev: TuyaDeviceExtracted): void {
    const ip = dev.ip || '192.168.1.150';
    const targetIeee = `wifi_${ip.replace(/\./g, '_')}`;

    this.telemetry
      .bindTuyaDevice({
        ieee_address: targetIeee,
        local_key: dev.local_key,
        tuya_dev_id: dev.id,
        ip_address: ip,
        product_name: dev.product_name,
      })
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.deviceUpdated.emit(res.device);
            this.closeModal.emit();
          }
        },
      });
  }

  saveManualKey(): void {
    if (this.manualForm.invalid) return;
    const v = this.manualForm.value;

    this.telemetry
      .bindTuyaDevice({
        ieee_address: v.targetIeee!,
        local_key: v.localKey!,
        tuya_dev_id: v.devId || undefined,
        ip_address: v.ipAddress || undefined,
      })
      .subscribe({
        next: (res) => {
          if (res.success) {
            this.deviceUpdated.emit(res.device);
            this.closeModal.emit();
          }
        },
      });
  }

  testManualConnection(): void {
    const ip = this.manualForm.get('ipAddress')?.value?.trim() || '';
    const key = this.manualForm.get('localKey')?.value?.trim() || '';
    const devId = this.manualForm.get('devId')?.value?.trim() || '';

    this.isTesting.set(true);
    this.testMessage.set('');

    this.telemetry.testTinyTuya({ ip, local_key: key, dev_id: devId }).subscribe({
      next: (res) => {
        this.isTesting.set(false);
        this.testSuccess.set(res.success);
        this.testMessage.set(res.message);
      },
      error: (err) => {
        this.isTesting.set(false);
        this.testSuccess.set(false);
        this.testMessage.set(err?.error?.message || 'Błąd testu połączenia TinyTuya.');
      },
    });
  }
}
