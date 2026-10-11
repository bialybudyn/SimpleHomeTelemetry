import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { Device, DiscoveredNetworkHost, TuyaDeviceExtracted } from '../../models/telemetry.models';
import { Telemetry } from '../../services/telemetry';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-device-config-modal',
  imports: [MatIconModule, ReactiveFormsModule],
  template: `
    <div
      class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in"
      role="dialog"
      aria-modal="true"
    >
      <div
        class="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh]"
      >
        <!-- NAGŁÓWEK MODALA -->
        <div class="px-6 py-4 bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div class="flex items-center gap-3">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
              [class.bg-cyan-500/15]="activeBrand() === 'sonoff'"
              [class.border-cyan-500/30]="activeBrand() === 'sonoff'"
              [class.text-cyan-400]="activeBrand() === 'sonoff'"
              [class.bg-amber-500/15]="activeBrand() === 'tuya'"
              [class.border-amber-500/30]="activeBrand() === 'tuya'"
              [class.text-amber-400]="activeBrand() === 'tuya'"
            >
              <mat-icon>{{ activeBrand() === 'sonoff' ? 'power' : 'offline_bolt' }}</mat-icon>
            </div>
            <div>
              <h2 class="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
                <span>Panel Konfiguracja urządzenia</span>
                <span
                  class="text-[10px] font-mono px-2 py-0.5 rounded-full border uppercase"
                  [class.bg-cyan-950]="activeBrand() === 'sonoff'"
                  [class.text-cyan-300]="activeBrand() === 'sonoff'"
                  [class.border-cyan-800]="activeBrand() === 'sonoff'"
                  [class.bg-amber-950]="activeBrand() === 'tuya'"
                  [class.text-amber-300]="activeBrand() === 'tuya'"
                  [class.border-amber-800]="activeBrand() === 'tuya'"
                >
                  {{ activeBrand() === 'sonoff' ? 'Sonoff / eWeLink LAN' : 'Tuya / Smart Life' }}
                </span>
              </h2>
              <p class="text-xs text-slate-400">
                Ręczna konfiguracja adresów IP, skaner podsieci z bazą OUI oraz pobieranie kluczy
              </p>
            </div>
          </div>

          <button
            (click)="closeModal.emit()"
            class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            title="Zamknij"
          >
            <mat-icon class="text-sm !w-4 !h-4">close</mat-icon>
          </button>
        </div>

        <!-- PRZEŁĄCZNIK EKOSYSTEMU: SONOFF vs TUYA -->
        <div class="p-3 bg-slate-950/80 border-b border-slate-800 flex items-center justify-center gap-3 shrink-0">
          <button
            (click)="selectBrand('sonoff')"
            class="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer border"
            [class.bg-gradient-to-r]="activeBrand() === 'sonoff'"
            [class.from-cyan-600]="activeBrand() === 'sonoff'"
            [class.to-blue-600]="activeBrand() === 'sonoff'"
            [class.border-cyan-400]="activeBrand() === 'sonoff'"
            [class.text-white]="activeBrand() === 'sonoff'"
            [class.shadow-lg]="activeBrand() === 'sonoff'"
            [class.shadow-cyan-950/60]="activeBrand() === 'sonoff'"
            [class.bg-slate-900]="activeBrand() !== 'sonoff'"
            [class.border-slate-800]="activeBrand() !== 'sonoff'"
            [class.text-slate-400]="activeBrand() !== 'sonoff'"
            [class.hover:text-white]="activeBrand() !== 'sonoff'"
          >
            <mat-icon class="text-base !w-4 !h-4">power</mat-icon>
            <div class="text-left leading-tight">
              <div>SONOFF / eWeLink</div>
              <div class="text-[10px] font-normal opacity-80">Gniazdka S60 / Port 8081 LAN / Baza OUI</div>
            </div>
          </button>

          <button
            (click)="selectBrand('tuya')"
            class="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer border"
            [class.bg-gradient-to-r]="activeBrand() === 'tuya'"
            [class.from-amber-600]="activeBrand() === 'tuya'"
            [class.to-orange-600]="activeBrand() === 'tuya'"
            [class.border-amber-400]="activeBrand() === 'tuya'"
            [class.text-white]="activeBrand() === 'tuya'"
            [class.shadow-lg]="activeBrand() === 'tuya'"
            [class.shadow-amber-950/60]="activeBrand() === 'tuya'"
            [class.bg-slate-900]="activeBrand() !== 'tuya'"
            [class.border-slate-800]="activeBrand() !== 'tuya'"
            [class.text-slate-400]="activeBrand() !== 'tuya'"
            [class.hover:text-white]="activeBrand() !== 'tuya'"
          >
            <mat-icon class="text-base !w-4 !h-4">offline_bolt</mat-icon>
            <div class="text-left leading-tight">
              <div>TUYA / Smart Life</div>
              <div class="text-[10px] font-normal opacity-80">Pobierz Local Key (QR) / TinyTuya</div>
            </div>
          </button>
        </div>

        <!-- WYBÓR URZĄDZENIA DOCELOWEGO DO EDYCJI -->
        <div class="px-6 py-2.5 bg-slate-950/40 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
          <div class="flex items-center gap-2 text-xs text-slate-300">
            <mat-icon class="text-cyan-400 text-sm !w-4 !h-4">tune</mat-icon>
            <span class="font-semibold">Konfigurowane urządzenie:</span>
          </div>

          <div class="flex-1 max-w-md">
            <select
              [value]="selectedDeviceIeee()"
              (change)="onSelectDeviceChange($event)"
              class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
            >
              <option value="">-- Nowe urządzenie lub konfiguracja ogólna --</option>
              @for (dev of filteredBrandDevices(); track dev.ieee_address) {
                <option [value]="dev.ieee_address">
                  {{ dev.friendly_name }} ({{ dev.ip_address || 'Brak IP' }}) [{{ dev.ieee_address }}]
                </option>
              }
            </select>
          </div>
        </div>

        <!-- GŁÓWNA ZAWARTOŚĆ Z PRZEWIJANIEM -->
        <div class="p-4 sm:p-6 space-y-6 overflow-y-auto custom-scrollbar flex-1">
          
          <!-- ========================================================================= -->
          <!-- SEKCJA 1: SONOFF / eWeLink                                                -->
          <!-- ========================================================================= -->
          @if (activeBrand() === 'sonoff') {
            <div class="space-y-6">

              <!-- KARTA A: RĘCZNE WPISANIE ADRESU IP I PARAMETRÓW -->
              <div class="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4 shadow-md">
                <div class="flex items-center justify-between border-b border-slate-800/80 pb-3">
                  <div class="flex items-center gap-2">
                    <mat-icon class="text-cyan-400">edit_note</mat-icon>
                    <div>
                      <h3 class="text-sm font-bold text-white tracking-wide">
                        Ręczna edycja adresu IP i kluczy Sonoff LAN
                      </h3>
                      <p class="text-[11px] text-slate-400">
                        Wpisz adres IP gniazdka bezpośrednio, aby sterować nim w sieci lokalnej bez chmury (port 8081).
                      </p>
                    </div>
                  </div>
                  @if (selectedDevice(); as dev) {
                    <span
                      class="text-[10px] font-mono px-2 py-0.5 rounded-full border"
                      [class.bg-emerald-950]="dev.ip_address"
                      [class.text-emerald-300]="dev.ip_address"
                      [class.border-emerald-800]="dev.ip_address"
                      [class.bg-amber-950]="!dev.ip_address"
                      [class.text-amber-300]="!dev.ip_address"
                      [class.border-amber-800]="!dev.ip_address"
                    >
                      {{ dev.ip_address ? 'IP: ' + dev.ip_address : '⚠️ Brak IP' }}
                    </span>
                  }
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Adres IP w sieci domowej (LAN) <span class="text-cyan-400">*</span>
                    </label>
                    <input
                      type="text"
                      [value]="sonoffIp()"
                      (input)="sonoffIp.set($any($event.target).value)"
                      placeholder="np. 192.168.1.150"
                      class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                    />
                    <span class="text-[10px] text-slate-500 mt-0.5 block">
                      Wpisz statyczny lub przydzielony przez DHCP adres IP gniazdka
                    </span>
                  </div>

                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Nazwa gniazdka w panelu
                    </label>
                    <input
                      type="text"
                      [value]="sonoffName()"
                      (input)="sonoffName.set($any($event.target).value)"
                      placeholder="np. Gniazdko Kanciapa1"
                      class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Sonoff Device ID
                    </label>
                    <input
                      type="text"
                      [value]="sonoffDeviceId()"
                      (input)="sonoffDeviceId.set($any($event.target).value)"
                      placeholder="np. 1002729f67"
                      class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>

                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      DeviceKey / API Key (AES-128-CBC)
                    </label>
                    <input
                      type="text"
                      [value]="sonoffApiKey()"
                      (input)="sonoffApiKey.set($any($event.target).value)"
                      placeholder="np. b67f0a35-ebfc-4052-a11a-74c83241f6a2"
                      class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>
                </div>

                <div class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                  <div class="flex flex-wrap items-center gap-2">
                    <button
                      (click)="testSonoffConnection()"
                      [disabled]="isTestingSonoff()"
                      class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-700 transition-colors cursor-pointer disabled:opacity-40"
                      title="Weryfikuj połączenie LAN (8081) oraz Chmurę eWeLink Bridge"
                    >
                      <mat-icon class="text-sm !w-4 !h-4 text-cyan-400" [class.animate-spin]="isTestingSonoff()">network_check</mat-icon>
                      <span>{{ isTestingSonoff() ? 'Testowanie...' : '⚡ Testuj LAN (8081) / Chmurę' }}</span>
                    </button>

                    <button
                      (click)="autoFetchKeyFromEwelink()"
                      [disabled]="isSavingSonoff()"
                      class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-950/80 hover:bg-indigo-900/80 text-xs font-semibold text-indigo-200 border border-indigo-700/80 transition-colors cursor-pointer disabled:opacity-40"
                      title="Dociągnij Device ID i klucz szyfrowania AES z Twojego konta eWeLink"
                    >
                      <mat-icon class="text-sm !w-4 !h-4 text-indigo-400">cloud_download</mat-icon>
                      <span>Pobierz klucz z eWeLink</span>
                    </button>
                  </div>

                  <button
                    (click)="saveSonoffConfig()"
                    [disabled]="!sonoffIp() || isSavingSonoff()"
                    class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-xs font-bold text-white shadow-lg shadow-cyan-950/50 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <mat-icon class="text-sm !w-4 !h-4" [class.animate-spin]="isSavingSonoff()">save</mat-icon>
                    <span>{{ isSavingSonoff() ? 'Zapisywanie...' : '💾 Zapisz konfigurację' }}</span>
                  </button>
                </div>

                @if (sonoffFeedbackMsg()) {
                  <div
                    class="p-3 rounded-xl border text-xs flex items-center gap-2"
                    [class.bg-emerald-950]="sonoffFeedbackSuccess()"
                    [class.border-emerald-800]="sonoffFeedbackSuccess()"
                    [class.text-emerald-200]="sonoffFeedbackSuccess()"
                    [class.bg-amber-950]="!sonoffFeedbackSuccess()"
                    [class.border-amber-800]="!sonoffFeedbackSuccess()"
                    [class.text-amber-200]="!sonoffFeedbackSuccess()"
                  >
                    <mat-icon class="text-sm !w-4 !h-4">{{ sonoffFeedbackSuccess() ? 'check_circle' : 'info' }}</mat-icon>
                    <span>{{ sonoffFeedbackMsg() }}</span>
                  </div>
                }
              </div>

              <!-- KARTA B: SKANER SIECI LAN Z BAZĄ OUI -->
              <div class="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4 shadow-md">
                <div class="flex items-center justify-between border-b border-slate-800/80 pb-3">
                  <div class="flex items-center gap-2">
                    <mat-icon class="text-cyan-400">radar</mat-icon>
                    <div>
                      <h3 class="text-sm font-bold text-white tracking-wide">
                        Skaner podsieci z bazą OUI (Wykrywanie gniazdek i producentów MAC)
                      </h3>
                      <p class="text-[11px] text-slate-400">
                        Wpisz własne podsieci, przeskanuj sieć lokalną i przypisz wykryty adres IP do gniazdka jednym kliknięciem.
                      </p>
                    </div>
                  </div>
                  <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">
                    Baza IEEE OUI
                  </span>
                </div>

                <!-- Pole wpisywania podsieci -->
                <div class="space-y-1.5">
                  <label class="block text-[11px] font-semibold text-slate-300">
                    Podsieci do przeskanowania (oddziel przecinkami lub spacją):
                  </label>
                  <div class="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      [value]="scanSubnetsInput()"
                      (input)="scanSubnetsInput.set($any($event.target).value)"
                      placeholder="np. 192.168.1.0/24, 192.168.0.0/24, 192.168.4.0/24, 10.0.0.0/24"
                      class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                    <button
                      (click)="saveScanSubnets()"
                      class="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer shrink-0"
                      title="Zapisz podsieci na stałe w konfiguracji"
                    >
                      💾 Zapisz podsieci
                    </button>
                    <button
                      (click)="runOuiScan()"
                      [disabled]="telemetry.isScanningOuiNetwork()"
                      class="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-md shadow-cyan-950/40 transition-all cursor-pointer shrink-0 disabled:opacity-50"
                    >
                      <mat-icon class="text-sm !w-4 !h-4" [class.animate-spin]="telemetry.isScanningOuiNetwork()">search</mat-icon>
                      <span>{{ telemetry.isScanningOuiNetwork() ? 'Skanowanie...' : '🔍 Przeskanuj sieć (Baza OUI)' }}</span>
                    </button>
                  </div>
                  <span class="text-[10px] text-slate-500">
                    Skaner wysyła pakiety ARP / probe do podsieci, weryfikuje adresy MAC w bazie IEEE OUI i sonduje port Sonoff 8081.
                  </span>
                </div>

                @if (telemetry.ouiScanMessage()) {
                  <div class="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 flex items-center gap-2">
                    <mat-icon class="text-sm !w-4 !h-4 text-cyan-400">info</mat-icon>
                    <span>{{ telemetry.ouiScanMessage() }}</span>
                  </div>
                }

                <!-- TABELA / LISTA WYNIKÓW SKANOWANIA OUI -->
                @if (telemetry.ouiScanResults().length > 0) {
                  <div class="space-y-2 pt-2 border-t border-slate-800/80">
                    <div class="flex items-center justify-between text-xs font-bold text-slate-300">
                      <span>Wykryte aktywne hosty ({{ telemetry.ouiScanResults().length }}):</span>
                      <span class="text-[11px] text-cyan-400 font-normal">
                        Kandydaci Sonoff/ESP są wyróżnieni na górze listy
                      </span>
                    </div>

                    <div class="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                      @for (host of telemetry.ouiScanResults(); track host.ip) {
                        <div
                          class="p-2.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-all"
                          [class.bg-cyan-950/30]="host.isSonoffCandidate"
                          [class.border-cyan-500/40]="host.isSonoffCandidate"
                          [class.bg-slate-900/60]="!host.isSonoffCandidate"
                          [class.border-slate-800]="!host.isSonoffCandidate"
                        >
                          <div class="flex items-start gap-2.5">
                            <div
                              class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs"
                              [class.bg-cyan-500/20]="host.isSonoffCandidate"
                              [class.text-cyan-400]="host.isSonoffCandidate"
                              [class.bg-slate-800]="!host.isSonoffCandidate"
                              [class.text-slate-400]="!host.isSonoffCandidate"
                            >
                              <mat-icon class="text-sm !w-4 !h-4">
                                {{ host.isSonoffCandidate ? 'power' : 'devices' }}
                              </mat-icon>
                            </div>

                            <div>
                              <div class="flex items-center gap-2">
                                <span class="text-xs font-bold font-mono text-white">{{ host.ip }}</span>
                                @if (host.mac) {
                                  <span class="text-[10px] font-mono text-slate-400">[{{ host.mac }}]</span>
                                }
                                @if (host.port8081Open) {
                                  <span class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                                    Port 8081 Sonoff LAN
                                  </span>
                                }
                                @if (host.sonoffDeviceId) {
                                  <span class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                                    ID: {{ host.sonoffDeviceId }}
                                  </span>
                                }
                              </div>
                              <div class="text-[11px] text-slate-400 flex items-center gap-1.5">
                                <span class="font-medium text-slate-300">{{ host.vendor || 'Nieznany producent' }}</span>
                                @if (host.matchedDeviceName) {
                                  <span class="text-emerald-400">· Połączono z: {{ host.matchedDeviceName }}</span>
                                }
                              </div>
                            </div>
                          </div>

                          <div class="flex items-center gap-2 shrink-0 self-end sm:self-center">
                            <button
                              (click)="assignHostIpToCurrent(host.ip)"
                              class="px-2.5 py-1 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1"
                              [title]="'Wstaw adres ' + host.ip + ' do formularza powyżej'"
                            >
                              <mat-icon class="text-xs !w-3 !h-3">input</mat-icon>
                              <span>Wstaw IP</span>
                            </button>

                            @if (selectedDeviceIeee()) {
                              <button
                                (click)="oneClickAssignIp(host.ip)"
                                class="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold shadow-sm transition-all cursor-pointer flex items-center gap-1"
                                title="Przypisz i natychmiast zapisz ten adres IP do wybranego urządzenia"
                              >
                                <mat-icon class="text-xs !w-3 !h-3">link</mat-icon>
                                <span>Przypisz do gniazdka</span>
                              </button>
                            }
                          </div>
                        </div>
                      }
                    </div>
                  </div>
                }
              </div>

              <!-- KARTA C: SYNCHRONIZACJA Z KONTEM EWELINK (POBIERANIE GNIAZDEK Z CHMURY) -->
              <div class="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4 shadow-md">
                <div class="flex items-center justify-between border-b border-slate-800/80 pb-3">
                  <div class="flex items-center gap-2">
                    <mat-icon class="text-cyan-400">cloud_sync</mat-icon>
                    <div>
                      <h3 class="text-sm font-bold text-white tracking-wide">
                        Synchronizacja z kontem eWeLink (Pobieranie DeviceKey i gniazdek)
                      </h3>
                      <p class="text-[11px] text-slate-400">
                        Pobiera listę Twoich inteligentnych gniazdek z chmury CoolKit eWeLink wraz z kluczami szyfrującymi.
                      </p>
                    </div>
                  </div>
                  <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800">
                    eWeLink Cloud
                  </span>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Email lub numer telefonu eWeLink
                    </label>
                    <input
                      type="text"
                      [value]="ewelinkEmail()"
                      (input)="ewelinkEmail.set($any($event.target).value)"
                      placeholder="twoj_email@domena.pl"
                      class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Hasło do konta eWeLink
                    </label>
                    <input
                      type="password"
                      [value]="ewelinkPassword()"
                      (input)="ewelinkPassword.set($any($event.target).value)"
                      placeholder="••••••••••••"
                      class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div class="flex flex-wrap items-center justify-between gap-3 pt-2">
                  <div class="text-[11px] text-slate-500">
                    Region: <span class="font-mono text-slate-300 font-bold">EU (Europa)</span>
                  </div>

                  <button
                    (click)="syncEwelinkCloud()"
                    [disabled]="!ewelinkEmail() || !ewelinkPassword() || isSyncingEwelink()"
                    class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-xs font-bold text-white shadow-lg transition-all cursor-pointer disabled:opacity-50"
                  >
                    <mat-icon class="text-sm !w-4 !h-4" [class.animate-spin]="isSyncingEwelink()">sync</mat-icon>
                    <span>{{ isSyncingEwelink() ? 'Pobieranie...' : 'Pobierz gniazdka z chmury eWeLink' }}</span>
                  </button>
                </div>

                @if (ewelinkFeedbackMsg()) {
                  <div
                    class="p-3 rounded-xl border text-xs flex items-center gap-2"
                    [class.bg-emerald-950]="ewelinkFeedbackSuccess()"
                    [class.border-emerald-800]="ewelinkFeedbackSuccess()"
                    [class.text-emerald-200]="ewelinkFeedbackSuccess()"
                    [class.bg-amber-950]="!ewelinkFeedbackSuccess()"
                    [class.border-amber-800]="!ewelinkFeedbackSuccess()"
                    [class.text-amber-200]="!ewelinkFeedbackSuccess()"
                  >
                    <mat-icon class="text-sm !w-4 !h-4">{{ ewelinkFeedbackSuccess() ? 'check_circle' : 'info' }}</mat-icon>
                    <span>{{ ewelinkFeedbackMsg() }}</span>
                  </div>
                }
              </div>

            </div>
          }

          <!-- ========================================================================= -->
          <!-- SEKCJA 2: TUYA / Smart Life                                               -->
          <!-- ========================================================================= -->
          @if (activeBrand() === 'tuya') {
            <div class="space-y-6">

              <!-- KARTA TUYA A: RĘCZNE WPISANIE ADRESU IP I LOCAL KEY -->
              <div class="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4 shadow-md">
                <div class="flex items-center justify-between border-b border-slate-800/80 pb-3">
                  <div class="flex items-center gap-2">
                    <mat-icon class="text-amber-400">vpn_key</mat-icon>
                    <div>
                      <h3 class="text-sm font-bold text-white tracking-wide">
                        Konfiguracja Tuya Local Key & Adresu IP
                      </h3>
                      <p class="text-[11px] text-slate-400">
                        Sterowanie urządzeniem w sieci domowej przez bibliotekę TinyTuya (protokół 3.3 / 3.4 / 3.5).
                      </p>
                    </div>
                  </div>
                  @if (selectedDevice(); as dev) {
                    <span
                      class="text-[10px] font-mono px-2 py-0.5 rounded-full border"
                      [class.bg-emerald-950]="dev.local_key"
                      [class.text-emerald-300]="dev.local_key"
                      [class.border-emerald-800]="dev.local_key"
                      [class.bg-amber-950]="!dev.local_key"
                      [class.text-amber-300]="!dev.local_key"
                      [class.border-amber-800]="!dev.local_key"
                    >
                      {{ dev.local_key ? 'Local Key aktywny' : 'Brak Local Key' }}
                    </span>
                  }
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Adres IP urządzenia Tuya w sieci domowej
                    </label>
                    <input
                      type="text"
                      [value]="tuyaIp()"
                      (input)="tuyaIp.set($any($event.target).value)"
                      placeholder="np. 192.168.1.180"
                      class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Nazwa urządzenia
                    </label>
                    <input
                      type="text"
                      [value]="tuyaName()"
                      (input)="tuyaName.set($any($event.target).value)"
                      placeholder="np. Wentylator Tuya Wi-Fi"
                      class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Tuya Device ID
                    </label>
                    <input
                      type="text"
                      [value]="tuyaDevId()"
                      (input)="tuyaDevId.set($any($event.target).value)"
                      placeholder="np. bf874312..."
                      class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                    />
                  </div>

                  <div>
                    <label class="block text-[11px] font-semibold text-slate-300 mb-1">
                      Local Key (16 znaków) <span class="text-amber-400">*</span>
                    </label>
                    <input
                      type="text"
                      [value]="tuyaLocalKey()"
                      (input)="tuyaLocalKey.set($any($event.target).value)"
                      placeholder="np. a1b2c3d4e5f67890"
                      maxlength="16"
                      class="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                  <button
                    (click)="testTuyaConnection()"
                    [disabled]="!tuyaIp() || !tuyaLocalKey() || isTestingTuya()"
                    class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-700 transition-colors cursor-pointer disabled:opacity-40"
                  >
                    <mat-icon class="text-sm !w-4 !h-4 text-amber-400" [class.animate-spin]="isTestingTuya()">network_check</mat-icon>
                    <span>{{ isTestingTuya() ? 'Testowanie...' : '⚡ Testuj połączenie TinyTuya' }}</span>
                  </button>

                  <button
                    (click)="saveTuyaConfig()"
                    [disabled]="!tuyaLocalKey() || isSavingTuya()"
                    class="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-xs font-bold text-white shadow-lg transition-all cursor-pointer disabled:opacity-50"
                  >
                    <mat-icon class="text-sm !w-4 !h-4" [class.animate-spin]="isSavingTuya()">save</mat-icon>
                    <span>{{ isSavingTuya() ? 'Zapisywanie...' : '💾 Zapisz konfigurację Tuya' }}</span>
                  </button>
                </div>

                @if (tuyaFeedbackMsg()) {
                  <div
                    class="p-3 rounded-xl border text-xs flex items-center gap-2"
                    [class.bg-emerald-950]="tuyaFeedbackSuccess()"
                    [class.border-emerald-800]="tuyaFeedbackSuccess()"
                    [class.text-emerald-200]="tuyaFeedbackSuccess()"
                    [class.bg-amber-950]="!tuyaFeedbackSuccess()"
                    [class.border-amber-800]="!tuyaFeedbackSuccess()"
                    [class.text-amber-200]="!tuyaFeedbackSuccess()"
                  >
                    <mat-icon class="text-sm !w-4 !h-4">{{ tuyaFeedbackSuccess() ? 'check_circle' : 'info' }}</mat-icon>
                    <span>{{ tuyaFeedbackMsg() }}</span>
                  </div>
                }
              </div>

              <!-- KARTA TUYA B: POBIERANIE LOCAL KEY PRZEZ KOD QR -->
              <div class="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-slate-800 space-y-4 shadow-md">
                <div class="flex items-center justify-between border-b border-slate-800/80 pb-3">
                  <div class="flex items-center gap-2">
                    <mat-icon class="text-amber-400">qr_code_scanner</mat-icon>
                    <div>
                      <h3 class="text-sm font-bold text-white tracking-wide">
                        Pobierz Tuya Local Key przez kod QR (Device Sharing)
                      </h3>
                      <p class="text-[11px] text-slate-400">
                        Nie potrzebujesz konta na platformie Tuya IoT. Zeskanuj wygenerowany kod w aplikacji Tuya Smart / Smart Life.
                      </p>
                    </div>
                  </div>
                </div>

                @if (!tuyaQrDataUrl()) {
                  <div class="space-y-3">
                    <p class="text-xs text-slate-400 leading-relaxed">
                      Wpisz swój <strong class="text-white">Kod Użytkownika (User Code)</strong> z aplikacji mobilnej Tuya Smart lub Smart Life (Profil ➔ Ustawienia konta ➔ Kod użytkownika):
                    </p>

                    <div class="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        [value]="tuyaUserCode()"
                        (input)="tuyaUserCode.set($any($event.target).value)"
                        placeholder="np. eu_a1b2c3d4e5f6..."
                        class="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                      />
                      <button
                        (click)="generateTuyaQr()"
                        [disabled]="!tuyaUserCode() || isGeneratingQr()"
                        class="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-all cursor-pointer shrink-0 disabled:opacity-50"
                      >
                        {{ isGeneratingQr() ? 'Generowanie...' : 'Generuj kod QR' }}
                      </button>
                    </div>
                  </div>
                } @else {
                  <div class="flex flex-col sm:flex-row items-center gap-6 p-4 rounded-xl bg-slate-900 border border-slate-800">
                    <div class="p-3 bg-white rounded-2xl shadow-xl shrink-0">
                      <img [src]="tuyaQrDataUrl()" alt="Tuya QR Code" class="w-48 h-48 block" />
                    </div>

                    <div class="space-y-3 flex-1 text-xs text-slate-300">
                      <div class="font-bold text-white text-sm">Zeskanuj ten kod w aplikacji:</div>
                      <ol class="list-decimal list-inside space-y-1 text-slate-400 leading-relaxed">
                        <li>Otwórz aplikację Tuya Smart lub Smart Life na telefonie.</li>
                        <li>Kliknij ikonę <strong class="text-white">[+]</strong> w prawym górnym rogu.</li>
                        <li>Wybierz opcję skanera kodów QR i nakieruj aparat na ten kod.</li>
                        <li>Kliknij <strong class="text-white">Zatwierdź / Udostępnij</strong> w telefonie.</li>
                      </ol>

                      <div class="pt-2 flex items-center gap-3">
                        <span class="text-amber-400 animate-pulse font-semibold">Oczekiwanie na autoryzację...</span>
                        <button
                          (click)="tuyaQrDataUrl.set('')"
                          class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 text-[11px] hover:text-white"
                        >
                          Wygeneruj ponownie
                        </button>
                      </div>
                    </div>
                  </div>
                }
              </div>

            </div>
          }

        </div>

      </div>
    </div>
  `,
})
export class DeviceConfigModal implements OnInit {
  readonly telemetry = inject(Telemetry);

  // Wejścia i wyjścia
  readonly targetDevice = input<Device | null>(null);
  readonly initialBrand = input<'sonoff' | 'tuya'>('sonoff');
  readonly closeModal = output<void>();

  // Stan aktywnej marki ('sonoff' | 'tuya')
  readonly activeBrand = signal<'sonoff' | 'tuya'>('sonoff');
  readonly selectedDeviceIeee = signal<string>('');

  // Stan formularza Sonoff
  readonly sonoffIp = signal<string>('');
  readonly sonoffName = signal<string>('');
  readonly sonoffDeviceId = signal<string>('');
  readonly sonoffApiKey = signal<string>('');
  readonly isSavingSonoff = signal<boolean>(false);
  readonly isTestingSonoff = signal<boolean>(false);
  readonly sonoffFeedbackMsg = signal<string>('');
  readonly sonoffFeedbackSuccess = signal<boolean>(false);

  // Skaner podsieci z bazą OUI
  readonly scanSubnetsInput = signal<string>('192.168.1.0/24, 192.168.0.0/24, 192.168.4.0/24');

  // eWeLink Cloud sync
  readonly ewelinkEmail = signal<string>('b.zbudniewek@gmail.com');
  readonly ewelinkPassword = signal<string>('');
  readonly isSyncingEwelink = signal<boolean>(false);
  readonly ewelinkFeedbackMsg = signal<string>('');
  readonly ewelinkFeedbackSuccess = signal<boolean>(false);

  // Stan formularza Tuya
  readonly tuyaIp = signal<string>('');
  readonly tuyaName = signal<string>('');
  readonly tuyaDevId = signal<string>('');
  readonly tuyaLocalKey = signal<string>('');
  readonly isSavingTuya = signal<boolean>(false);
  readonly isTestingTuya = signal<boolean>(false);
  readonly tuyaFeedbackMsg = signal<string>('');
  readonly tuyaFeedbackSuccess = signal<boolean>(false);

  // Tuya QR Code
  readonly tuyaUserCode = signal<string>('');
  readonly tuyaQrDataUrl = signal<string>('');
  readonly isGeneratingQr = signal<boolean>(false);
  private tuyaPollTimer: ReturnType<typeof setInterval> | null = null;

  // Aktywne wybrane urządzenie
  readonly selectedDevice = computed<Device | null>(() => {
    const ieee = this.selectedDeviceIeee();
    if (!ieee) return this.targetDevice() || null;
    return this.telemetry.devices().find((d) => d.ieee_address === ieee) || null;
  });

  // Lista urządzeń przefiltrowana wg marki
  readonly filteredBrandDevices = computed<Device[]>(() => {
    const brand = this.activeBrand();
    const all = this.telemetry.devices();

    return all.filter((d) => {
      const v = (d.vendor || '').toLowerCase();
      const m = (d.model || '').toLowerCase();
      const fn = (d.friendly_name || '').toLowerCase();

      if (brand === 'sonoff') {
        return (
          Boolean(d.sonoff_device_id) ||
          Boolean(d.sonoff_api_key) ||
          v.includes('sonoff') ||
          v.includes('ewelink') ||
          m.includes('sonoff') ||
          m.includes('s60') ||
          m.includes('s26') ||
          fn.includes('sonoff') ||
          d.category === 'plug' ||
          d.protocol === 'wifi'
        );
      } else {
        return (
          Boolean(d.local_key) ||
          Boolean(d.tuya_dev_id) ||
          v.includes('tuya') ||
          m.includes('tuya') ||
          d.category === 'fan' ||
          d.category === 'smoke' ||
          d.protocol === 'wifi'
        );
      }
    });
  });

  async ngOnInit(): Promise<void> {
    // 1. Ustal markę na podstawie wejścia lub urządzenia docelowego
    const target = this.targetDevice();
    if (target) {
      this.selectedDeviceIeee.set(target.ieee_address);
      const v = (target.vendor || '').toLowerCase();
      const m = (target.model || '').toLowerCase();
      const isSonoff =
        Boolean(target.sonoff_device_id) ||
        Boolean(target.sonoff_api_key) ||
        v.includes('sonoff') ||
        v.includes('ewelink') ||
        m.includes('sonoff') ||
        m.includes('s60');

      this.activeBrand.set(isSonoff ? 'sonoff' : this.initialBrand());
      this.populateFieldsFromDevice(target);
    } else {
      this.activeBrand.set(this.initialBrand());
      // Jeśli brak urządzenia, wybierz pierwsze pasujące do marki
      const list = this.filteredBrandDevices();
      if (list.length > 0) {
        this.selectedDeviceIeee.set(list[0].ieee_address);
        this.populateFieldsFromDevice(list[0]);
      }
    }

    // 2. Pobierz zapisane podsieci skanowania
    const netCfg = await this.telemetry.getNetworkScanConfig();
    if (netCfg?.scan_subnets) {
      this.scanSubnetsInput.set(netCfg.scan_subnets);
    }

    // 3. Pobierz email z ewelinkConfig jeśli jest
    const ewCfg = this.telemetry.ewelinkConfig();
    if (ewCfg?.email) {
      this.ewelinkEmail.set(ewCfg.email);
    }
  }

  selectBrand(brand: 'sonoff' | 'tuya'): void {
    this.activeBrand.set(brand);
    // Wybierz odpowiednie urządzenie dla tej marki
    const list = this.filteredBrandDevices();
    if (list.length > 0) {
      const match = list.find((d) => d.ieee_address === this.selectedDeviceIeee()) || list[0];
      this.selectedDeviceIeee.set(match.ieee_address);
      this.populateFieldsFromDevice(match);
    } else {
      this.selectedDeviceIeee.set('');
    }
  }

  onSelectDeviceChange(event: Event): void {
    const val = (event.target as HTMLSelectElement).value;
    this.selectedDeviceIeee.set(val);
    const dev = this.telemetry.devices().find((d) => d.ieee_address === val);
    if (dev) {
      this.populateFieldsFromDevice(dev);
    }
  }

  private populateFieldsFromDevice(dev: Device): void {
    if (this.activeBrand() === 'sonoff') {
      this.sonoffIp.set(dev.ip_address || '');
      this.sonoffName.set(dev.friendly_name || '');
      this.sonoffDeviceId.set(dev.sonoff_device_id || '');
      this.sonoffApiKey.set(dev.sonoff_api_key || '');
    } else {
      this.tuyaIp.set(dev.ip_address || '');
      this.tuyaName.set(dev.friendly_name || '');
      this.tuyaDevId.set(dev.tuya_dev_id || '');
      this.tuyaLocalKey.set(dev.local_key || '');
    }
  }

  // Zapis konfiguracji Sonoff z ręcznie wpisanym IP
  async saveSonoffConfig(): Promise<void> {
    const ip = this.sonoffIp().trim();
    if (!ip) {
      this.sonoffFeedbackSuccess.set(false);
      this.sonoffFeedbackMsg.set('Wprowadź prawidłowy adres IP gniazdka Sonoff.');
      return;
    }

    this.isSavingSonoff.set(true);
    this.sonoffFeedbackMsg.set('');

    const target = this.selectedDevice();
    const ieee = target ? target.ieee_address : `wifi_${ip.replace(/\./g, '_')}`;

    const res = await this.telemetry.configureDevice(ieee, {
      ip_address: ip,
      friendly_name: this.sonoffName().trim() || undefined,
      sonoff_device_id: this.sonoffDeviceId().trim() || undefined,
      sonoff_api_key: this.sonoffApiKey().trim() || undefined,
      vendor: 'SONOFF / eWeLink',
      device_id: this.sonoffDeviceId().trim() || undefined,
    });

    this.isSavingSonoff.set(false);
    this.sonoffFeedbackSuccess.set(res.success);
    this.sonoffFeedbackMsg.set(res.message);
  }

  // Automatyczne pobieranie Device ID i klucza AES z eWeLink
  async autoFetchKeyFromEwelink(): Promise<void> {
    const ewCfg = this.telemetry.ewelinkConfig();
    const loginEmail = ewCfg.email || this.ewelinkEmail().trim();
    const loginPass = ewCfg.password || this.ewelinkPassword().trim();

    if (loginEmail && loginPass) {
      this.isSavingSonoff.set(true);
      this.sonoffFeedbackMsg.set('Łączenie z eWeLink i pobieranie kluczy lokalnych...');
      try {
        const res = await this.telemetry.loginEwelink(loginEmail, loginPass, ewCfg.region || 'eu');
        this.isSavingSonoff.set(false);
        this.sonoffFeedbackSuccess.set(res.success);
        if (res.success && Array.isArray(res.devices)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const matched = res.devices.find((d: any) => 
            (this.sonoffIp() && d.ip === this.sonoffIp()) ||
            (this.sonoffDeviceId() && d.deviceId === this.sonoffDeviceId()) ||
            (d.name && d.name.toLowerCase() === this.sonoffName().toLowerCase())
          );
          if (matched) {
            if (matched.deviceId) this.sonoffDeviceId.set(matched.deviceId);
            if (matched.deviceKey || matched.apiKey) this.sonoffApiKey.set(matched.deviceKey || matched.apiKey);
            if (matched.ip && !this.sonoffIp()) this.sonoffIp.set(matched.ip);
            this.sonoffFeedbackMsg.set(`Pobrano dane dla ${matched.name} (ID: ${matched.deviceId}, Key: obecny)!`);
          } else {
            this.sonoffFeedbackMsg.set(`Zsynchronizowano ${res.devices.length} urządzeń eWeLink z pamięcią panelu!`);
          }
          this.telemetry.fetchDevices();
        } else {
          this.sonoffFeedbackMsg.set(res.message);
        }
      } catch {
        this.isSavingSonoff.set(false);
        this.sonoffFeedbackSuccess.set(false);
        this.sonoffFeedbackMsg.set('Błąd komunikacji z chmurą eWeLink.');
      }
    } else {
      this.sonoffFeedbackSuccess.set(false);
      this.sonoffFeedbackMsg.set('Wprowadź dane logowania eWeLink w sekcji poniżej lub w ustawieniach konta.');
    }
  }

  // Test połączenia Sonoff LAN na porcie 8081 + Chmura eWeLink Bridge
  testSonoffConnection(): void {
    const ip = this.sonoffIp().trim();

    this.isTestingSonoff.set(true);
    this.sonoffFeedbackMsg.set('Testowanie połączenia (LAN 8081 + eWeLink Cloud Bridge)...');

    this.telemetry.testSonoffDevice({
      ip,
      device_id: this.sonoffDeviceId().trim() || undefined,
      api_key: this.sonoffApiKey().trim() || undefined,
    }).subscribe({
      next: (res) => {
        this.isTestingSonoff.set(false);
        this.sonoffFeedbackSuccess.set(res.success);
        this.sonoffFeedbackMsg.set(res.message || 'Połączenie z gniazdkiem zweryfikowane pomyślnie!');
      },
      error: (err) => {
        this.isTestingSonoff.set(false);
        this.sonoffFeedbackSuccess.set(false);
        this.sonoffFeedbackMsg.set(err?.error?.message || 'Brak odpowiedzi gniazdka Sonoff na porcie 8081 oraz w Chmurze.');
      },
    });
  }

  // Zapis podsieci skanowania
  async saveScanSubnets(): Promise<void> {
    const subs = this.scanSubnetsInput().trim();
    if (!subs) return;
    const ok = await this.telemetry.saveNetworkScanConfig(subs);
    if (ok) {
      this.sonoffFeedbackSuccess.set(true);
      this.sonoffFeedbackMsg.set('Zapisano podsieci do konfiguracji skanera!');
    }
  }

  // Uruchomienie skanowania podsieci z bazą OUI
  runOuiScan(): void {
    const subs = this.scanSubnetsInput().trim();
    this.telemetry.scanNetworkWithOui(subs || undefined);
  }

  assignHostIpToCurrent(ip: string): void {
    this.sonoffIp.set(ip);
    this.sonoffFeedbackSuccess.set(true);
    this.sonoffFeedbackMsg.set(`Wstawiono adres IP ${ip} do formularza. Kliknij "Zapisz konfigurację" aby zatwierdzić.`);
  }

  async oneClickAssignIp(ip: string): Promise<void> {
    const target = this.selectedDevice();
    if (!target) return;
    this.sonoffIp.set(ip);
    const ok = await this.telemetry.assignDeviceIp(target.ieee_address, ip);
    this.sonoffFeedbackSuccess.set(ok);
    this.sonoffFeedbackMsg.set(ok ? `Pomyślnie przypisano adres IP ${ip} do ${target.friendly_name}!` : 'Błąd przypisywania IP');
  }

  // Synchronizacja z eWeLink Cloud
  async syncEwelinkCloud(): Promise<void> {
    const login = this.ewelinkEmail().trim();
    const pass = this.ewelinkPassword().trim();
    if (!login || !pass) return;

    this.isSyncingEwelink.set(true);
    this.ewelinkFeedbackMsg.set('');

    try {
      const res = await this.telemetry.loginEwelink(login, pass, 'eu');
      this.isSyncingEwelink.set(false);
      this.ewelinkFeedbackSuccess.set(res.success);
      this.ewelinkFeedbackMsg.set(res.message);
      if (res.success) {
        // Po udanej synchronizacji odśwież urządzenia i uruchom szybki skan OUI aby odnaleźć ich IP!
        this.telemetry.fetchDevices();
        this.runOuiScan();
      }
    } catch {
      this.isSyncingEwelink.set(false);
      this.ewelinkFeedbackSuccess.set(false);
      this.ewelinkFeedbackMsg.set('Błąd połączenia z serwerem logowania eWeLink.');
    }
  }

  // Zapis konfiguracji Tuya
  async saveTuyaConfig(): Promise<void> {
    const key = this.tuyaLocalKey().trim();
    const ip = this.tuyaIp().trim();
    if (!key) return;

    this.isSavingTuya.set(true);
    const target = this.selectedDevice();
    const ieee = target ? target.ieee_address : (ip ? `wifi_${ip.replace(/\./g, '_')}` : `tuya_${Date.now()}`);

    const res = await this.telemetry.configureDevice(ieee, {
      ip_address: ip || undefined,
      friendly_name: this.tuyaName().trim() || undefined,
      local_key: key,
      tuya_dev_id: this.tuyaDevId().trim() || undefined,
      vendor: 'Tuya Smart / Smart Life',
      model: 'Tuya Wi-Fi Smart Device',
    });

    this.isSavingTuya.set(false);
    this.tuyaFeedbackSuccess.set(res.success);
    this.tuyaFeedbackMsg.set(res.message);
  }

  // Test połączenia Tuya
  testTuyaConnection(): void {
    const ip = this.tuyaIp().trim();
    const key = this.tuyaLocalKey().trim();
    const id = this.tuyaDevId().trim() || 'test_id';
    if (!ip || !key) return;

    this.isTestingTuya.set(true);
    this.tuyaFeedbackMsg.set('Testowanie połączenia TinyTuya...');

    this.telemetry.testTinyTuya({ ip, local_key: key, dev_id: id }).subscribe({
      next: (res) => {
        this.isTestingTuya.set(false);
        this.tuyaFeedbackSuccess.set(res.success);
        this.tuyaFeedbackMsg.set(res.message || 'Połączenie Tuya Local nawiązane pomyślnie!');
      },
      error: (err) => {
        this.isTestingTuya.set(false);
        this.tuyaFeedbackSuccess.set(false);
        this.tuyaFeedbackMsg.set(err?.error?.message || 'Błąd testowania połączenia Tuya.');
      },
    });
  }

  // Generowanie kodu QR Tuya
  generateTuyaQr(): void {
    const code = this.tuyaUserCode().trim();
    if (!code) return;

    this.isGeneratingQr.set(true);
    this.tuyaFeedbackMsg.set('');

    this.telemetry.generateTuyaQr(code).subscribe({
      next: (res) => {
        this.isGeneratingQr.set(false);
        if (res.success && res.qr_data_url && res.token) {
          this.tuyaQrDataUrl.set(res.qr_data_url);
          this.startTuyaQrPoll(res.token, code);
        } else {
          this.tuyaFeedbackSuccess.set(false);
          this.tuyaFeedbackMsg.set(res.error || 'Błąd generowania kodu QR Tuya.');
        }
      },
      error: (err) => {
        this.isGeneratingQr.set(false);
        this.tuyaFeedbackSuccess.set(false);
        this.tuyaFeedbackMsg.set(err?.error?.error || 'Błąd komunikacji z serwerem QR.');
      },
    });
  }

  private startTuyaQrPoll(token: string, userCode: string): void {
    if (this.tuyaPollTimer) clearInterval(this.tuyaPollTimer);
    this.tuyaPollTimer = setInterval(() => {
      this.telemetry.checkTuyaQrStatus(token, userCode).subscribe({
        next: (status) => {
          if (status.status === 'authorized') {
            if (this.tuyaPollTimer) clearInterval(this.tuyaPollTimer);
            this.tuyaFeedbackSuccess.set(true);
            this.tuyaFeedbackMsg.set(`Pomyślnie autoryzowano! Pobrano urządzenia Tuya.`);
            this.tuyaQrDataUrl.set('');
            this.telemetry.fetchDevices();
          }
        },
      });
    }, 2500);
  }
}
