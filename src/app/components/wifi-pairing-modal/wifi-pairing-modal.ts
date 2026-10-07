import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Telemetry } from '../../services/telemetry';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-wifi-pairing-modal',
  imports: [MatIconModule, ReactiveFormsModule],
  template: `
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div class="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <!-- Nagłówek okna -->
        <div class="px-6 py-4 bg-gradient-to-r from-indigo-950 via-slate-900 to-slate-900 border-b border-slate-800 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <mat-icon>wifi_find</mat-icon>
            </div>
            <div>
              <h3 class="text-lg font-bold text-white tracking-tight">
                Parowanie Urządzeń Wi-Fi (Czyste Wi-Fi bez Zigbee)
              </h3>
              <p class="text-xs text-slate-400">
                Lokalny protokół SmartConfig / EZ Mode dla wentylatorów Tuya i Götze & Jensen
              </p>
            </div>
          </div>
          <button
            (click)="closeModal.emit()"
            class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <mat-icon class="text-sm !w-4 !h-4">close</mat-icon>
          </button>
        </div>

        <div class="p-6 space-y-6 overflow-y-auto custom-scrollbar">
          <!-- Instrukcja parowania dla wentylatora Götze & Jensen GOW 007 -->
          <div class="p-4 rounded-xl bg-indigo-950/30 border border-indigo-800/40 space-y-2">
            <div class="flex items-center gap-2 text-indigo-300 font-semibold text-xs">
              <mat-icon class="text-sm !w-4 !h-4">info</mat-icon>
              <span>Instrukcja parowania wentylatora Götze & Jensen GOW 007 7w1:</span>
            </div>
            <ol class="text-xs text-slate-300 space-y-1.5 list-decimal list-inside font-sans leading-relaxed">
              <li>Podłącz wentylator do zasilania 230V.</li>
              <li>Przytrzymaj przycisk <strong class="text-white">Wi-Fi / Power</strong> na panelu przez 5–7 sekund, aż wskaźnik Wi-Fi zacznie szybko pulsować na wyświetlaczu.</li>
              <li>Wpisz poniżej nazwę swojej domowej sieci Wi-Fi (2.4GHz) oraz hasło.</li>
              <li>Kliknij <strong class="text-indigo-300">"Rozpocznij Parowanie Wi-Fi (160s)"</strong>. Serwer rozgłosi pakiety konfiguracji, a wentylator połączy się z Twoim routerem!</li>
            </ol>
          </div>

          <!-- Formularz parowania Wi-Fi SmartConfig -->
          <form [formGroup]="wifiForm" (ngSubmit)="startPairing()" class="space-y-4">
            <div class="space-y-1.5">
              <label for="wifiSsidInput" class="text-xs font-semibold text-slate-300 block">
                Nazwa Domowej Sieci Wi-Fi (SSID 2.4GHz)
              </label>
              <div class="relative">
                <input
                  id="wifiSsidInput"
                  type="text"
                  formControlName="ssid"
                  placeholder="np. Moja_Siec_WiFi_2.4G"
                  class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-indigo-500 focus:outline-none pl-9"
                />
                <mat-icon class="text-sm !w-4 !h-4 text-slate-500 absolute left-3 top-3">wifi</mat-icon>
              </div>
            </div>

            <div class="space-y-1.5">
              <label for="wifiPassInput" class="text-xs font-semibold text-slate-300 block">
                Hasło do Wi-Fi
              </label>
              <div class="relative">
                <input
                  id="wifiPassInput"
                  type="password"
                  formControlName="password"
                  placeholder="Wpisz hasło do Wi-Fi..."
                  class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-indigo-500 focus:outline-none pl-9"
                />
                <mat-icon class="text-sm !w-4 !h-4 text-slate-500 absolute left-3 top-3">lock</mat-icon>
              </div>
            </div>

            <div class="pt-2 flex items-center justify-between gap-3">
              <button
                type="submit"
                [disabled]="wifiForm.invalid || telemetry.isWifiPairing()"
                class="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold shadow-lg shadow-indigo-950/50 transition-all cursor-pointer"
              >
                <mat-icon class="text-sm !w-4 !h-4" [class.animate-spin]="telemetry.isWifiPairing()">
                  {{ telemetry.isWifiPairing() ? 'refresh' : 'wifi_find' }}
                </mat-icon>
                <span>
                  {{ telemetry.isWifiPairing() ? 'Parowanie Wi-Fi w toku (' + telemetry.wifiPairingRemainingSeconds() + 's)...' : 'Rozpocznij Parowanie Wi-Fi (160s)' }}
                </span>
              </button>
            </div>
          </form>

          <div class="border-t border-slate-800/80 pt-5 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-white uppercase tracking-wider">Alternatywa: Bezpośrednie Dodanie IP</span>
              <span class="text-[10px] text-slate-400 font-mono">Lokalne IP Wentylatora</span>
            </div>

            <div class="flex items-center gap-2">
              <input
                type="text"
                [value]="manualIp()"
                (input)="updateManualIp($event)"
                placeholder="np. 192.168.1.150"
                class="flex-1 px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-xs font-mono focus:border-cyan-500 focus:outline-none"
              />
              <button
                (click)="addManualDevice()"
                [disabled]="!manualIp().trim() || isAdding()"
                class="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer shrink-0"
              >
                {{ isAdding() ? 'Dodawanie...' : 'Dodaj Wentylator GOW 007' }}
              </button>
            </div>
            <p class="text-[11px] text-slate-400 leading-relaxed">
              Jeśli Twój wentylator połączył się już z routerem domowym, wpisz jego adres IP, aby od razu przypisać go do panelu i uzyskać natychmiastowe sterowanie 7w1!
            </p>
          </div>
        </div>

        <!-- Stopka -->
        <div class="px-6 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>Adres IP serwera w sieci LAN: <code class="text-indigo-400 font-mono">{{ telemetry.wifiLocalIp() || '10.0.0.21' }}</code></span>
          <button
            (click)="closeModal.emit()"
            class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold cursor-pointer"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  `,
})
export class WifiPairingModal {
  readonly telemetry = inject(Telemetry);
  readonly closeModal = output<void>();

  readonly manualIp = signal<string>('192.168.1.150');
  readonly isAdding = signal<boolean>(false);

  readonly wifiForm = new FormGroup({
    ssid: new FormControl('Domowa_Siec_WiFi', [Validators.required]),
    password: new FormControl(''),
  });

  startPairing(): void {
    if (this.wifiForm.invalid) return;
    const ssid = this.wifiForm.value.ssid || 'Domowa_Siec_WiFi';
    const password = this.wifiForm.value.password || '';

    this.telemetry.triggerWifiPairing(ssid, password, 160);
  }

  updateManualIp(evt: Event): void {
    const val = (evt.target as HTMLInputElement).value;
    this.manualIp.set(val);
  }

  async addManualDevice(): Promise<void> {
    const ip = this.manualIp().trim();
    if (!ip) return;

    this.isAdding.set(true);
    const ok = await this.telemetry.addWifiDevice(
      ip,
      'Wentylator Götze & Jensen GOW 007 (Wi-Fi)',
      'GOW 007 7w1 (Wi-Fi)',
      'fan',
    );
    this.isAdding.set(false);

    if (ok) {
      this.closeModal.emit();
    }
  }
}
