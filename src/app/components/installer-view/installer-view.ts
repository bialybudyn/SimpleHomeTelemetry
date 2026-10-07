import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { Telemetry } from '../../services/telemetry';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-installer-view',
  imports: [MatIconModule, DatePipe],
  template: `
    <div class="space-y-6">
      <!-- Nagłówek główny instalatora -->
      <div class="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/40 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div class="space-y-1.5">
          <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <mat-icon class="text-sm !w-4 !h-4">terminal</mat-icon>
            <span>Automatyczny Instalator Systemowy & Demon w tle</span>
          </div>
          <h2 class="text-2xl font-bold text-white tracking-tight">
            Instalacja Zigbee2MQTT + Mosquitto Broker + Panel
          </h2>
          <p class="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Kompletny instalator hosta konfigurujący brokera Eclipse Mosquitto oraz demona Zigbee2MQTT jako usługi <code class="text-cyan-300 font-mono">systemd</code> działające w tle z automatycznym restartem po restarcie systemu.
          </p>
        </div>

        <!-- Szybkie akcje -->
        <div class="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            (click)="triggerGitUpdate()"
            [disabled]="telemetry.isUpdatingGit()"
            class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-950/40 transition-all cursor-pointer"
            title="Aktualizuj kod z repozytorium GitHub (git pull)"
          >
            <mat-icon class="text-sm !w-4 !h-4" [class.animate-spin]="telemetry.isUpdatingGit()">update</mat-icon>
            <span>{{ telemetry.isUpdatingGit() ? 'Pobieranie aktualizacji...' : 'Aktualizuj z GitHub (Git Pull)' }}</span>
          </button>
          <button
            (click)="inspectSystemServices()"
            [disabled]="telemetry.isInspectingServices()"
            class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
            title="Weryfikuj stan i konfigurację zainstalowanych usług"
          >
            <mat-icon class="text-sm !w-4 !h-4" [class.animate-spin]="telemetry.isInspectingServices()">policy</mat-icon>
            <span>{{ telemetry.isInspectingServices() ? 'Audyt...' : 'Weryfikuj konfigurację usług' }}</span>
          </button>
          <button
            (click)="copyOneLiner()"
            class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-lg shadow-cyan-950/40 transition-all cursor-pointer"
          >
            <mat-icon class="text-sm !w-4 !h-4">{{ copiedOneLiner() ? 'check' : 'content_copy' }}</mat-icon>
            <span>{{ copiedOneLiner() ? 'Skopiowano komendę!' : 'Kopiuj 1-Click' }}</span>
          </button>
          <button
            (click)="downloadFile('install.sh')"
            class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
          >
            <mat-icon class="text-sm !w-4 !h-4">download</mat-icon>
            <span>Pobierz install.sh</span>
          </button>
        </div>
      </div>

      <!-- Wynik aktualizacji Git (jeśli wykonano) -->
      @if (telemetry.gitUpdateResult(); as gitRes) {
        <div
          class="p-4 rounded-xl border flex items-start gap-3 transition-all"
          [class.bg-emerald-950/40]="gitRes.success"
          [class.border-emerald-800]="gitRes.success"
          [class.bg-rose-950/40]="!gitRes.success"
          [class.border-rose-800]="!gitRes.success"
        >
          <mat-icon [class.text-emerald-400]="gitRes.success" [class.text-rose-400]="!gitRes.success">
            {{ gitRes.success ? 'cloud_done' : 'error' }}
          </mat-icon>
          <div class="space-y-1 text-xs flex-1">
            <div class="font-bold" [class.text-emerald-300]="gitRes.success" [class.text-rose-300]="!gitRes.success">
              {{ gitRes.message }}
            </div>
            <pre class="text-[11px] font-mono text-slate-400 bg-slate-950/80 p-2.5 rounded-lg overflow-x-auto border border-slate-800/80">{{ gitRes.output }}</pre>
          </div>
        </div>
      }

      <!-- Wynik audytu i inspekcji zainstalowanych usług -->
      @if (telemetry.servicesReport(); as report) {
        <div class="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <mat-icon class="text-cyan-400">verified</mat-icon>
              <h3 class="text-sm font-bold text-white">Raport Weryfikacji Usług Systemowych i Plików Konfiguracyjnych</h3>
            </div>
            <span class="text-xs font-mono text-slate-400">
              Sprawdzono: {{ report.timestamp | date:'HH:mm:ss' }}
            </span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            @for (srv of report.services; track srv.service) {
              <div class="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="font-bold text-xs text-white">{{ srv.name }}</span>
                  <span
                    class="text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold border"
                    [class.bg-emerald-500/10]="srv.installed && srv.config_valid"
                    [class.text-emerald-400]="srv.installed && srv.config_valid"
                    [class.border-emerald-500/20]="srv.installed && srv.config_valid"
                    [class.bg-amber-500/10]="!srv.installed || !srv.config_valid"
                    [class.text-amber-400]="!srv.installed || !srv.config_valid"
                    [class.border-amber-500/20]="!srv.installed || !srv.config_valid"
                  >
                    {{ srv.installed ? (srv.config_valid ? 'POPRAWNA' : 'WYMAGA ZMIAN') : 'NIE WYKRYTO' }}
                  </span>
                </div>
                <div class="text-[11px] font-mono text-slate-400">
                  <div>Status procesu: <strong class="text-white">{{ srv.active ? 'Aktywny (Running)' : 'Nieaktywny' }}</strong></div>
                  <div>Plik conf: <strong class="text-slate-300">{{ srv.config_path || 'domyślny' }}</strong></div>
                  <div class="text-slate-500 text-[10px] mt-1">{{ srv.config_summary }}</div>
                </div>
                <div class="pt-1.5 border-t border-slate-800/60 text-[10px] text-cyan-300">
                  {{ srv.recommendation }}
                </div>
              </div>
            }
          </div>
        </div>
      }

      <!-- Kafelki statusu usług w tle (Real-time Service Health) -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <!-- 1. Broker Mosquitto MQTT -->
        <div class="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-3">
              <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Broker MQTT (Port 1883)</span>
              @if (telemetry.mqttStatus()?.connected) {
                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Działa w tle
                </span>
              } @else {
                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                  Oczekiwanie na brokera
                </span>
              }
            </div>
            <div class="space-y-2 font-mono text-xs">
              <div class="flex justify-between text-slate-300">
                <span class="text-slate-500">Usługa:</span>
                <span>mosquitto.service</span>
              </div>
              <div class="flex justify-between text-slate-300">
                <span class="text-slate-500">Adres brokera:</span>
                <span class="text-cyan-400">{{ telemetry.mqttStatus()?.url || 'mqtt://127.0.0.1:1883' }}</span>
              </div>
              <div class="flex justify-between text-slate-300">
                <span class="text-slate-500">Odebrane pakiety:</span>
                <span>{{ telemetry.mqttStatus()?.messages_received || 0 }}</span>
              </div>
              <div class="flex justify-between text-slate-300">
                <span class="text-slate-500">Ostatni pakiet:</span>
                <span>{{ telemetry.mqttStatus()?.last_message_at ? (telemetry.mqttStatus()?.last_message_at | date:'HH:mm:ss') : 'brak danych' }}</span>
              </div>
            </div>
          </div>
          <div class="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
            <button
              (click)="telemetry.reconnectMqtt()"
              [disabled]="telemetry.isReconnectingMqtt()"
              class="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
            >
              <mat-icon class="text-sm !w-4 !h-4" [class.animate-spin]="telemetry.isReconnectingMqtt()">sync</mat-icon>
              <span>{{ telemetry.isReconnectingMqtt() ? 'Łączenie...' : 'Sprawdź połączenie' }}</span>
            </button>
            <span class="text-[10px] text-slate-500 font-mono">systemctl status mosquitto</span>
          </div>
        </div>

        <!-- 2. Zigbee2MQTT Daemon -->
        <div class="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-3">
              <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Zigbee2MQTT Daemon (Port 8080)</span>
              @if (telemetry.bridgeState() === 'online') {
                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Online
                </span>
              } @else {
                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                  <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                  {{ telemetry.bridgeState() || 'offline' }}
                </span>
              }
            </div>
            <div class="space-y-2 font-mono text-xs">
              <div class="flex justify-between text-slate-300">
                <span class="text-slate-500">Usługa:</span>
                <span>zigbee2mqtt.service</span>
              </div>
              <div class="flex justify-between text-slate-300">
                <span class="text-slate-500">Katalog instalacji:</span>
                <span>/opt/zigbee2mqtt</span>
              </div>
              <div class="flex justify-between text-slate-300">
                <span class="text-slate-500">Wykryte czujniki:</span>
                <span class="text-cyan-400 font-bold">{{ telemetry.devices().length }}</span>
              </div>
              <div class="flex justify-between text-slate-300">
                <span class="text-slate-500">Sterownik:</span>
                <span class="text-amber-400">adapter: ember (EZSP)</span>
              </div>
            </div>
          </div>
          <div class="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
            <span class="text-xs text-slate-400">Pulpit Z2M: <a href="http://localhost:8080" target="_blank" class="text-cyan-400 hover:underline">localhost:8080</a></span>
            <span class="text-[10px] text-slate-500 font-mono">systemctl status zigbee2mqtt</span>
          </div>
        </div>

        <!-- 3. Sonoff Dongle Max (Router & Koordynator) -->
        <div class="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 relative overflow-hidden flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-3">
              <span class="text-xs font-bold uppercase tracking-wider text-slate-400">Koordynator Sonoff Dongle Max</span>
              <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                EFR32MG24 +20dBm
              </span>
            </div>
            <div class="space-y-2 font-mono text-xs">
              <div class="flex justify-between text-slate-300">
                <span class="text-slate-500">Tryb połączenia:</span>
                <span class="text-emerald-400">{{ telemetry.dongleMaxConfig()?.connection_mode === 'network_tcp' ? 'Sieć TCP (PoE/Wi-Fi)' : 'Port USB' }}</span>
              </div>
              <div class="flex justify-between text-slate-300">
                <span class="text-slate-500">Adres gniazda:</span>
                <span class="text-white">{{ telemetry.dongleMaxConfig()?.connection_mode === 'network_tcp' ? 'tcp://' + telemetry.dongleMaxConfig()?.host + ':' + telemetry.dongleMaxConfig()?.port : telemetry.dongleMaxConfig()?.serial_port }}</span>
              </div>
              <div class="flex justify-between text-slate-300">
                <span class="text-slate-500">Rola urządzenia:</span>
                <span class="capitalize text-cyan-300">{{ telemetry.dongleMaxConfig()?.operating_mode || 'Koordynator' }}</span>
              </div>
              <div class="flex justify-between text-slate-300">
                <span class="text-slate-500">Prędkość UART:</span>
                <span>115200 baud</span>
              </div>
            </div>
          </div>
          <div class="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
            <button
              (click)="testCoordinatorConnection()"
              [disabled]="telemetry.isTestingDongleMax()"
              class="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
            >
              <mat-icon class="text-sm !w-4 !h-4" [class.animate-spin]="telemetry.isTestingDongleMax()">network_check</mat-icon>
              <span>{{ telemetry.isTestingDongleMax() ? 'Testowanie portu 6638...' : 'Testuj gniazdo TCP' }}</span>
            </button>
            <a href="https://dongle.sonoff.tech/guide/dongle-m/" target="_blank" rel="noopener" class="text-[10px] text-cyan-400 hover:underline">
              Dokumentacja Dongle-M ↗
            </a>
          </div>
        </div>
      </div>

      <!-- Wynik testu połączenia z Dongle Max jeśli uruchomiono -->
      @if (telemetry.dongleMaxTestResult(); as result) {
        <div
          class="p-4 rounded-xl border flex items-start gap-3 transition-all"
          [class.bg-emerald-950/40]="result.success"
          [class.border-emerald-800]="result.success"
          [class.bg-amber-950/40]="!result.success"
          [class.border-amber-800]="!result.success"
        >
          <mat-icon [class.text-emerald-400]="result.success" [class.text-amber-400]="!result.success">
            {{ result.success ? 'check_circle' : 'info' }}
          </mat-icon>
          <div class="space-y-1 text-xs">
            <div class="font-bold font-mono" [class.text-emerald-300]="result.success" [class.text-amber-300]="!result.success">
              {{ result.message }}
            </div>
            <div class="text-slate-400 font-mono">
              Host docelowy: {{ result.host }}:{{ result.port }} • Czas odpowiedzi: {{ result.latency_ms !== undefined ? result.latency_ms + 'ms' : 'brak danych' }} • Data testu: {{ result.tested_at }}
            </div>
          </div>
        </div>
      }

      <!-- Wybór wariantu instalatora (Zakładki instalacji) -->
      <div class="space-y-4">
        <div class="flex items-center justify-between border-b border-slate-800 pb-2">
          <div class="flex items-center gap-2">
            <button
              (click)="selectedInstallerTab.set('linux')"
              class="px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer"
              [class.bg-cyan-500/10]="selectedInstallerTab() === 'linux'"
              [class.text-cyan-400]="selectedInstallerTab() === 'linux'"
              [class.border]="selectedInstallerTab() === 'linux'"
              [class.border-cyan-500/30]="selectedInstallerTab() === 'linux'"
              [class.text-slate-400]="selectedInstallerTab() !== 'linux'"
              [class.hover:text-slate-200]="selectedInstallerTab() !== 'linux'"
            >
              Linux / Raspberry Pi (systemd)
            </button>
            <button
              (click)="selectedInstallerTab.set('docker')"
              class="px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer"
              [class.bg-cyan-500/10]="selectedInstallerTab() === 'docker'"
              [class.text-cyan-400]="selectedInstallerTab() === 'docker'"
              [class.border]="selectedInstallerTab() === 'docker'"
              [class.border-cyan-500/30]="selectedInstallerTab() === 'docker'"
              [class.text-slate-400]="selectedInstallerTab() !== 'docker'"
              [class.hover:text-slate-200]="selectedInstallerTab() !== 'docker'"
            >
              Docker & Docker Compose
            </button>
            <button
              (click)="selectedInstallerTab.set('windows')"
              class="px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer"
              [class.bg-cyan-500/10]="selectedInstallerTab() === 'windows'"
              [class.text-cyan-400]="selectedInstallerTab() === 'windows'"
              [class.border]="selectedInstallerTab() === 'windows'"
              [class.border-cyan-500/30]="selectedInstallerTab() === 'windows'"
              [class.text-slate-400]="selectedInstallerTab() !== 'windows'"
              [class.hover:text-slate-200]="selectedInstallerTab() !== 'windows'"
            >
              Windows (PowerShell)
            </button>
          </div>

          <button
            (click)="copyActiveScript()"
            class="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 font-mono transition-colors cursor-pointer"
          >
            <mat-icon class="text-sm !w-4 !h-4">{{ copiedScript() ? 'check' : 'content_copy' }}</mat-icon>
            <span>{{ copiedScript() ? 'Skopiowano kod!' : 'Kopiuj zawartość skryptu' }}</span>
          </button>
        </div>

        <!-- Szczegóły dla wybranego wariantu -->
        @if (selectedInstallerTab() === 'linux') {
          <div class="space-y-4">
            <!-- Komenda szybkiego startu -->
            <div class="p-4 rounded-xl bg-slate-950 border border-cyan-900/40 space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-400 font-medium">Uruchomienie automatycznej instalacji w 1 poleceniu na hoście (wymaga uprawnień root / sudo):</span>
                <span class="text-cyan-400 font-mono text-[11px]">Debian / Ubuntu / Raspberry Pi OS / Armbian</span>
              </div>
              <div class="p-3 rounded-lg bg-slate-900 font-mono text-xs text-cyan-300 flex items-center justify-between overflow-x-auto">
                <code>sudo bash -c "$(curl -fsSL http://localhost:3000/api/files/install.sh 2>/dev/null || cat install.sh)"</code>
                <button
                  (click)="copyCode('sudo bash install.sh')"
                  class="ml-3 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] shrink-0 transition-colors"
                >
                  Kopiuj
                </button>
              </div>
            </div>

            <!-- Co dokładnie robi instalator -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2">
                <h4 class="font-bold text-white flex items-center gap-2">
                  <span class="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px] font-bold">1</span>
                  Broker Mosquitto w tle (systemd)
                </h4>
                <p class="text-slate-400 leading-relaxed">
                  Instaluje pakiet <code class="text-slate-200">mosquitto</code>, konfiguruje nasłuchiwanie na porcie 1883, włącza auto-start przez <code class="text-cyan-300">systemctl enable mosquitto</code>.
                </p>
              </div>

              <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2">
                <h4 class="font-bold text-white flex items-center gap-2">
                  <span class="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px] font-bold">2</span>
                  Zigbee2MQTT w tle (systemd)
                </h4>
                <p class="text-slate-400 leading-relaxed">
                  Pobiera Zigbee2MQTT do <code class="text-slate-200">/opt/zigbee2mqtt</code>, kompiluje zależności, konfiguruje sterownik <code class="text-cyan-300">adapter: ember</code> dla układu EFR32MG24 i tworzy usługę <code class="text-cyan-300">zigbee2mqtt.service</code>.
                </p>
              </div>

              <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2">
                <h4 class="font-bold text-white flex items-center gap-2">
                  <span class="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px] font-bold">3</span>
                  Obsługa sieciowa Sonoff Dongle Max
                </h4>
                <p class="text-slate-400 leading-relaxed">
                  Wspiera bezpośrednie połączenie z Dongle Max przez sieć LAN (<code class="text-cyan-300">tcp://Dongle-M.local:6638</code>) zasilany PoE/Wi-Fi lub tradycyjny port USB (<code class="text-slate-200">/dev/ttyACM0</code>).
                </p>
              </div>

              <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800/80 space-y-2">
                <h4 class="font-bold text-white flex items-center gap-2">
                  <span class="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center text-[10px] font-bold">4</span>
                  Panel Telemetrii & SQLite
                </h4>
                <p class="text-slate-400 leading-relaxed">
                  Rejestruje usługę <code class="text-cyan-300">iot-telemetry.service</code> zasilającą ten pulpit, API telemetryczne oraz magazyn bazodanowy SQLite.
                </p>
              </div>
            </div>

            <!-- Podgląd kodu install.sh -->
            <div class="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
              <div class="p-3 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between text-xs font-mono">
                <div class="flex items-center gap-2 text-slate-300">
                  <mat-icon class="text-sm !w-4 !h-4 text-cyan-400">code</mat-icon>
                  <span>install.sh (Bash Auto-Installer)</span>
                </div>
                <button
                  (click)="downloadFile('install.sh')"
                  class="text-cyan-400 hover:underline flex items-center gap-1"
                >
                  <mat-icon class="text-sm !w-4 !h-4">download</mat-icon>
                  Pobierz plik
                </button>
              </div>
              <pre class="p-4 text-xs font-mono text-slate-300 max-h-72 overflow-y-auto leading-relaxed"><code>{{ linuxInstallScriptContent() }}</code></pre>
            </div>
          </div>
        }

        @if (selectedInstallerTab() === 'docker') {
          <div class="space-y-4">
            <div class="p-4 rounded-xl bg-slate-950 border border-cyan-900/40 space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-400 font-medium">Uruchomienie całego stosu za pomocą Docker Compose:</span>
                <span class="text-cyan-400 font-mono text-[11px]">Docker v24+ & Compose</span>
              </div>
              <div class="p-3 rounded-lg bg-slate-900 font-mono text-xs text-cyan-300 flex items-center justify-between overflow-x-auto">
                <code>docker compose up -d</code>
                <button
                  (click)="copyCode('docker compose up -d')"
                  class="ml-3 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] shrink-0 transition-colors"
                >
                  Kopiuj
                </button>
              </div>
            </div>

            <div class="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
              <div class="p-3 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between text-xs font-mono">
                <div class="flex items-center gap-2 text-slate-300">
                  <mat-icon class="text-sm !w-4 !h-4 text-cyan-400">layers</mat-icon>
                  <span>docker-compose.yml</span>
                </div>
                <button
                  (click)="downloadFile('docker-compose.yml')"
                  class="text-cyan-400 hover:underline flex items-center gap-1"
                >
                  <mat-icon class="text-sm !w-4 !h-4">download</mat-icon>
                  Pobierz plik
                </button>
              </div>
              <pre class="p-4 text-xs font-mono text-slate-300 max-h-72 overflow-y-auto leading-relaxed"><code>{{ dockerComposeContent() }}</code></pre>
            </div>
          </div>
        }

        @if (selectedInstallerTab() === 'windows') {
          <div class="space-y-4">
            <div class="p-4 rounded-xl bg-slate-950 border border-cyan-900/40 space-y-2">
              <div class="flex items-center justify-between text-xs">
                <span class="text-slate-400 font-medium">Uruchomienie instalacji w konsoli PowerShell jako Administrator:</span>
                <span class="text-cyan-400 font-mono text-[11px]">Windows 10 / 11 / Server</span>
              </div>
              <div class="p-3 rounded-lg bg-slate-900 font-mono text-xs text-cyan-300 flex items-center justify-between overflow-x-auto">
                <code>powershell -ExecutionPolicy Bypass -File install.ps1</code>
                <button
                  (click)="copyCode('powershell -ExecutionPolicy Bypass -File install.ps1')"
                  class="ml-3 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] shrink-0 transition-colors"
                >
                  Kopiuj
                </button>
              </div>
            </div>

            <div class="rounded-xl bg-slate-950 border border-slate-800 overflow-hidden">
              <div class="p-3 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between text-xs font-mono">
                <div class="flex items-center gap-2 text-slate-300">
                  <mat-icon class="text-sm !w-4 !h-4 text-cyan-400">code</mat-icon>
                  <span>install.ps1</span>
                </div>
                <button
                  (click)="downloadFile('install.ps1')"
                  class="text-cyan-400 hover:underline flex items-center gap-1"
                >
                  <mat-icon class="text-sm !w-4 !h-4">download</mat-icon>
                  Pobierz plik
                </button>
              </div>
              <pre class="p-4 text-xs font-mono text-slate-300 max-h-72 overflow-y-auto leading-relaxed"><code>{{ windowsScriptContent() }}</code></pre>
            </div>
          </div>
        }
      </div>

      <!-- Przydatne polecenia diagnostyczne -->
      <div class="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
        <h3 class="text-sm font-bold text-white flex items-center gap-2">
          <mat-icon class="text-cyan-400 text-base">manage_search</mat-icon>
          Polecenia diagnostyczne i zarządzanie usługami w tle
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
          <div class="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1">
            <span class="text-slate-400">Podgląd logów Zigbee2MQTT na żywo:</span>
            <div class="text-cyan-300">journalctl -u zigbee2mqtt -f</div>
          </div>
          <div class="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1">
            <span class="text-slate-400">Podgląd logów brokera Mosquitto:</span>
            <div class="text-cyan-300">journalctl -u mosquitto -f</div>
          </div>
          <div class="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1">
            <span class="text-slate-400">Restart wszystkich usług IoT:</span>
            <div class="text-cyan-300">sudo systemctl restart mosquitto zigbee2mqtt iot-telemetry</div>
          </div>
          <div class="p-3 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1">
            <span class="text-slate-400">Weryfikacja portu TCP koordynatora Sonoff:</span>
            <div class="text-cyan-300">nc -zv Dongle-M.local 6638</div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class InstallerView {
  readonly telemetry = inject(Telemetry);
  private http = inject(HttpClient);

  readonly selectedInstallerTab = signal<'linux' | 'docker' | 'windows'>('linux');
  readonly copiedOneLiner = signal<boolean>(false);
  readonly copiedScript = signal<boolean>(false);

  readonly linuxInstallScriptContent = signal<string>('# Pobieranie zawartości skryptu...');
  readonly dockerComposeContent = signal<string>('# Pobieranie zawartości pliku docker-compose.yml...');
  readonly windowsScriptContent = signal<string>('# Pobieranie zawartości skryptu install.ps1...');

  constructor() {
    this.loadInstallerScripts();
  }

  private loadInstallerScripts(): void {
    this.http.get('/api/files/install.sh', { responseType: 'text' }).subscribe({
      next: (code) => this.linuxInstallScriptContent.set(code),
      error: () => this.linuxInstallScriptContent.set('# Skrypt dostępny w katalogu projektu install.sh'),
    });

    this.http.get('/api/files/docker-compose.yml', { responseType: 'text' }).subscribe({
      next: (code) => this.dockerComposeContent.set(code),
      error: () => this.dockerComposeContent.set('# Plik docker-compose.yml dostępny w katalogu głównym'),
    });

    this.http.get('/api/files/install.ps1', { responseType: 'text' }).subscribe({
      next: (code) => this.windowsScriptContent.set(code),
      error: () => this.windowsScriptContent.set('# Skrypt install.ps1 dostępny w katalogu głównym'),
    });
  }

  testCoordinatorConnection(): void {
    this.telemetry.testDongleMaxConnection();
  }

  triggerGitUpdate(): void {
    this.telemetry.runGitUpdate();
  }

  inspectSystemServices(): void {
    this.telemetry.inspectServices();
  }

  copyOneLiner(): void {
    const cmd = 'sudo bash -c "$(curl -fsSL http://localhost:3000/api/files/install.sh 2>/dev/null || cat install.sh)"';
    navigator.clipboard.writeText(cmd).then(() => {
      this.copiedOneLiner.set(true);
      setTimeout(() => this.copiedOneLiner.set(false), 2500);
    });
  }

  copyCode(text: string): void {
    navigator.clipboard.writeText(text);
  }

  copyActiveScript(): void {
    let content = '';
    if (this.selectedInstallerTab() === 'linux') {
      content = this.linuxInstallScriptContent();
    } else if (this.selectedInstallerTab() === 'docker') {
      content = this.dockerComposeContent();
    } else {
      content = this.windowsScriptContent();
    }

    navigator.clipboard.writeText(content).then(() => {
      this.copiedScript.set(true);
      setTimeout(() => this.copiedScript.set(false), 2000);
    });
  }

  downloadFile(filename: string): void {
    let content = '';
    if (filename === 'install.sh') content = this.linuxInstallScriptContent();
    else if (filename === 'docker-compose.yml') content = this.dockerComposeContent();
    else if (filename === 'install.ps1') content = this.windowsScriptContent();

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
