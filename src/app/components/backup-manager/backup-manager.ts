import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  computed,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Telemetry } from '../../services/telemetry';
import { SystemBackupPackage, BackupImportResponse } from '../../models/telemetry.models';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-backup-manager',
  imports: [MatIconModule, DatePipe],
  template: `
    <div class="space-y-6">
      <!-- NAGŁÓWEK GŁÓWNY MODUŁU BACKUPU -->
      <div class="p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-indigo-800/50 shadow-xl space-y-4">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div class="space-y-1.5">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 w-fit">
              <mat-icon class="text-sm !w-4 !h-4">cloud_sync</mat-icon>
              <span>Centrum Kopii Zapasowych & Disaster Recovery</span>
            </div>
            <h2 class="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
              <span>Kopia Zapasowa (Backup & Restore)</span>
              <span class="text-xs font-mono font-normal px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                Wersja 2.5
              </span>
            </h2>
            <p class="text-xs text-slate-400 max-w-3xl leading-relaxed">
              Zrzucaj i odtwarzaj kompletny stan systemu: flotę urządzeń Zigbee i Wi-Fi, parametry koordynatora Sonoff Dongle Max (Dongle-M), poświadczenia eWeLink Cloud oraz wszelkie klucze szyfrujące (Local Key, Device Key, API Key i adresy IP).
            </p>
          </div>

          <!-- Szybkie przyciski akcji w nagłówku -->
          <div class="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              (click)="downloadBackup()"
              [disabled]="telemetry.isExportingBackup()"
              class="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-cyan-950/50 transition-all cursor-pointer disabled:opacity-50"
              title="Wygeneruj i pobierz pełny plik kopii zapasowej JSON na dysk"
            >
              <mat-icon class="text-base !w-4 !h-4" [class.animate-spin]="telemetry.isExportingBackup()">
                {{ telemetry.isExportingBackup() ? 'sync' : 'download' }}
              </mat-icon>
              <span>{{ telemetry.isExportingBackup() ? 'Generowanie...' : 'Pobierz Kopię (.json)' }}</span>
            </button>

            <button
              (click)="openRawJsonPreview()"
              class="flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
              title="Wyświetl i skopiuj surową strukturę JSON kopii zapasowej"
            >
              <mat-icon class="text-sm !w-4 !h-4 text-cyan-400">code</mat-icon>
              <span>Podgląd JSON</span>
            </button>
          </div>
        </div>

        <!-- Pasek statystyk na żywo: Co zostanie zabezpieczone -->
        <div class="pt-4 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 text-xs font-mono">
          <div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
            <span class="text-slate-500 text-[10px] block">Wszystkie urządzenia</span>
            <span class="text-white font-bold text-sm">{{ totalDevicesCount() }}</span>
          </div>

          <div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
            <span class="text-slate-500 text-[10px] block">Sensory Zigbee 3.0</span>
            <span class="text-cyan-400 font-bold text-sm">{{ zigbeeDevicesCount() }}</span>
          </div>

          <div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
            <span class="text-slate-500 text-[10px] block">Gniazdka & Wi-Fi</span>
            <span class="text-indigo-400 font-bold text-sm">{{ wifiDevicesCount() }}</span>
          </div>

          <div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
            <span class="text-slate-500 text-[10px] block">Klucze (Local/Device)</span>
            <span class="text-emerald-400 font-bold text-sm">{{ credentialsCount() }}</span>
          </div>

          <div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
            <span class="text-slate-500 text-[10px] block">Dongle Max (Tryb)</span>
            <span class="text-amber-400 font-bold text-sm truncate" [title]="telemetry.dongleMaxConfig()?.host || 'Dongle-M.local'">
              {{ telemetry.dongleMaxConfig()?.connection_mode === 'network_tcp' ? 'TCP 6638' : 'USB' }}
            </span>
          </div>

          <div class="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80">
            <span class="text-slate-500 text-[10px] block">Konto eWeLink</span>
            <span class="text-slate-300 font-bold text-sm">
              {{ telemetry.ewelinkConfig().connected ? 'Połączone' : 'Lokalne' }}
            </span>
          </div>
        </div>
      </div>

      <!-- GŁÓWNA SIATKA: DWA PANELE (EKSPORT vs IMPORT) -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

        <!-- ================================================================= -->
        <!-- KOLUMNA 1: EKSPORT I GENEROWANIE KOPII ZAPASOWEJ                  -->
        <!-- ================================================================= -->
        <div class="p-5 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5 flex flex-col justify-between">
          <div class="space-y-4">
            <div class="flex items-center justify-between border-b border-slate-800 pb-3">
              <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <mat-icon class="text-base">file_download</mat-icon>
                </div>
                <div>
                  <h3 class="text-sm font-bold text-white tracking-wide">1. Pobierz Kopię Zapasową (Eksport)</h3>
                  <p class="text-[11px] text-slate-400">Zapisz cały stan obecnej instancji do pojedynczego pliku .json</p>
                </div>
              </div>
              <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-800">
                JSON Snapshot
              </span>
            </div>

            <!-- Lista elementów uwzględnionych w backupie -->
            <div class="space-y-2.5 text-xs">
              <div class="text-slate-300 font-semibold flex items-center gap-1.5">
                <mat-icon class="text-xs !w-3.5 !h-3.5 text-emerald-400">check_circle</mat-icon>
                <span>Zawartość generowanego pliku kopii zapasowej:</span>
              </div>

              <ul class="space-y-2 pl-2">
                <li class="flex items-start gap-2 text-slate-300">
                  <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0"></span>
                  <div>
                    <strong class="text-white">Flota urządzeń (ZigBee & Wi-Fi):</strong>
                    <span class="text-slate-400 ml-1">Identyfikatory IEEE, przyjazne nazwy, kategorie, modele i przypisane adresy IP.</span>
                  </div>
                </li>

                <li class="flex items-start gap-2 text-slate-300">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0"></span>
                  <div>
                    <strong class="text-white">Wszystkie poświadczenia i klucze szyfrujące:</strong>
                    <span class="text-slate-400 ml-1">Klucze Tuya Local Key, klucze Sonoff API Key / DeviceKey, Device ID oraz tokeny eWeLink.</span>
                  </div>
                </li>

                <li class="flex items-start gap-2 text-slate-300">
                  <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0"></span>
                  <div>
                    <strong class="text-white">Koordynator Sonoff Dongle Max (Dongle-M):</strong>
                    <span class="text-slate-400 ml-1">Konfiguracja połączenia sieciowego TCP (host, port 6638), tryb punktu dostępowego SoftAP oraz podsieci skanera OUI.</span>
                  </div>
                </li>

                <li class="flex items-start gap-2 text-slate-300">
                  <span class="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0"></span>
                  <div>
                    <strong class="text-white">Broker MQTT & Powiadomienia:</strong>
                    <span class="text-slate-400 ml-1">Adres URL brokera Mosquitto, konfiguracja alertów e-mail/Telegram oraz progi przeciążeniowe 16A/32A.</span>
                  </div>
                </li>
              </ul>
            </div>

            <!-- Karta bezpieczeństwa i sumy kontrolnej -->
            <div class="p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 text-[11px] font-mono space-y-1.5">
              <div class="flex items-center justify-between text-slate-400">
                <span class="flex items-center gap-1 text-slate-300">
                  <mat-icon class="text-xs !w-3.5 !h-3.5 text-cyan-400">security</mat-icon>
                  Integralność:
                </span>
                <span class="text-cyan-400 font-bold">Suma SHA-256</span>
              </div>
              <p class="text-slate-500 text-[10px] leading-relaxed">
                Każdy wyeksportowany plik jest oznaczony stemplem czasowym oraz sumą kontrolną SHA-256, co uniemożliwia wgranie uszkodzonego pliku.
              </p>
            </div>
          </div>

          <div class="pt-4 border-t border-slate-800 space-y-2">
            <button
              (click)="downloadBackup()"
              [disabled]="telemetry.isExportingBackup()"
              class="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-600 via-indigo-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs sm:text-sm shadow-lg shadow-indigo-950/60 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <mat-icon class="text-base" [class.animate-spin]="telemetry.isExportingBackup()">
                {{ telemetry.isExportingBackup() ? 'sync' : 'download_for_offline' }}
              </mat-icon>
              <span>{{ telemetry.isExportingBackup() ? 'Przygotowywanie paczki...' : 'Pobierz pełną kopię zapasową (.json)' }}</span>
            </button>
            <span class="text-[10px] text-slate-500 text-center block font-mono">
              Plik zostanie zapisany lokalnie w folderze Pobrane przeglądarki
            </span>
          </div>
        </div>

        <!-- ================================================================= -->
        <!-- KOLUMNA 2: WGRYWANIE I PRZYWRACANIE KOPII ZAPASOWEJ               -->
        <!-- ================================================================= -->
        <div class="p-5 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-5 flex flex-col justify-between">
          <div class="space-y-4">
            <div class="flex items-center justify-between border-b border-slate-800 pb-3">
              <div class="flex items-center gap-2.5">
                <div class="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <mat-icon class="text-base">settings_backup_restore</mat-icon>
                </div>
                <div>
                  <h3 class="text-sm font-bold text-white tracking-wide">2. Przywróć Kopię Zapasową (Import)</h3>
                  <p class="text-[11px] text-slate-400">Odtwórz urządzenia i DongleMAX na nowej instancji serwera</p>
                </div>
              </div>
              <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800">
                Odtwarzanie Floty
              </span>
            </div>

            <!-- Obszar upuszczania / wyboru pliku .json -->
            <div
              (dragover)="onDragOver($event)"
              (drop)="onFileDrop($event)"
              class="p-5 rounded-2xl border-2 border-dashed transition-all text-center flex flex-col items-center justify-center gap-2.5 cursor-pointer"
              [class.border-cyan-500]="isDragging()"
              [class.bg-cyan-950/20]="isDragging()"
              [class.border-slate-700]="!isDragging()"
              [class.bg-slate-950/60]="!isDragging()"
              [class.hover:border-slate-600]="!isDragging()"
              (click)="triggerFileInput()"
            >
              <input
                #fileInput
                type="file"
                accept=".json,application/json"
                class="hidden"
                (change)="onFileSelected($event)"
              />

              <div class="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-cyan-400 shadow-inner">
                <mat-icon>{{ parsedBackup() ? 'task_alt' : 'upload_file' }}</mat-icon>
              </div>

              <div>
                @if (selectedFileName()) {
                  <div class="text-xs font-bold text-emerald-300 font-mono">{{ selectedFileName() }}</div>
                  <div class="text-[11px] text-slate-400">Kliknij aby wybrać inny plik</div>
                } @else {
                  <div class="text-xs font-bold text-white">Przeciągnij plik kopii zapasowej .json tutaj</div>
                  <div class="text-[11px] text-slate-400">lub kliknij, aby wybrać z dysku komputera</div>
                }
              </div>
            </div>

            <!-- Komunikat błędu parsowania jeśli wystąpił -->
            @if (parseError()) {
              <div class="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                <mat-icon class="text-sm !w-4 !h-4 text-rose-400 shrink-0">error</mat-icon>
                <span>{{ parseError() }}</span>
              </div>
            }

            <!-- Podgląd wczytanego pliku przed kliknięciem przywróć -->
            @if (parsedBackup(); as pkg) {
              <div class="p-4 rounded-xl bg-slate-950 border border-cyan-800/60 space-y-3 animate-fade-in">
                <div class="flex items-center justify-between text-xs font-bold text-cyan-300 border-b border-slate-800/80 pb-2">
                  <span class="flex items-center gap-1.5">
                    <mat-icon class="text-xs !w-3.5 !h-3.5 text-emerald-400">verified</mat-icon>
                    Poprawny plik kopii zapasowej
                  </span>
                  <span class="text-[10px] font-mono text-slate-400">
                    {{ pkg.metadata.exported_at | date:'dd.MM.yyyy HH:mm' }}
                  </span>
                </div>

                <div class="grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div class="text-slate-400">
                    Host źródłowy: <span class="text-white">{{ pkg.metadata.export_hostname || 'nieznany' }}</span>
                  </div>
                  <div class="text-slate-400">
                    Liczba urządzeń: <span class="text-cyan-400 font-bold">{{ pkg.devices.length }}</span>
                  </div>
                  <div class="text-slate-400">
                    Dongle Max: <span class="text-emerald-400">{{ pkg.dongle_max.host }}:{{ pkg.dongle_max.port }}</span>
                  </div>
                  <div class="text-slate-400">
                    Konta z kluczami: <span class="text-amber-400">{{ pkg.metadata.counts.credentials_count }}</span>
                  </div>
                </div>

                <!-- Wybór trybu odtworzenia -->
                <div class="pt-2 border-t border-slate-800/60 space-y-1.5">
                  <label class="block text-[11px] font-semibold text-slate-300">Tryb przywracania danych:</label>
                  <div class="grid grid-cols-2 gap-2 text-xs">
                    <button
                      type="button"
                      (click)="restoreMode.set('replace')"
                      class="p-2 rounded-lg border text-left transition-all cursor-pointer"
                      [class.bg-cyan-500/15]="restoreMode() === 'replace'"
                      [class.border-cyan-500/50]="restoreMode() === 'replace'"
                      [class.text-cyan-200]="restoreMode() === 'replace'"
                      [class.bg-slate-900]="restoreMode() !== 'replace'"
                      [class.border-slate-800]="restoreMode() !== 'replace'"
                      [class.text-slate-400]="restoreMode() !== 'replace'"
                    >
                      <div class="font-bold flex items-center gap-1">
                        <mat-icon class="text-xs !w-3 !h-3">restore_page</mat-icon>
                        <span>Nadpisz (Zastąp)</span>
                      </div>
                      <div class="text-[10px] opacity-80 mt-0.5 leading-tight">Zalecane na nowej instancji</div>
                    </button>

                    <button
                      type="button"
                      (click)="restoreMode.set('merge')"
                      class="p-2 rounded-lg border text-left transition-all cursor-pointer"
                      [class.bg-cyan-500/15]="restoreMode() === 'merge'"
                      [class.border-cyan-500/50]="restoreMode() === 'merge'"
                      [class.text-cyan-200]="restoreMode() === 'merge'"
                      [class.bg-slate-900]="restoreMode() !== 'merge'"
                      [class.border-slate-800]="restoreMode() !== 'merge'"
                      [class.text-slate-400]="restoreMode() !== 'merge'"
                    >
                      <div class="font-bold flex items-center gap-1">
                        <mat-icon class="text-xs !w-3 !h-3">merge_type</mat-icon>
                        <span>Scal (Merge)</span>
                      </div>
                      <div class="text-[10px] opacity-80 mt-0.5 leading-tight">Połącz z istniejącymi</div>
                    </button>
                  </div>
                </div>
              </div>
            }
          </div>

          <!-- Przycisk zatwierdzenia przywrócenia -->
          <div class="pt-4 border-t border-slate-800 space-y-2">
            <button
              (click)="triggerRestore()"
              [disabled]="!parsedBackup() || telemetry.isImportingBackup()"
              class="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-bold text-xs sm:text-sm shadow-lg shadow-emerald-950/60 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <mat-icon class="text-base" [class.animate-spin]="telemetry.isImportingBackup()">
                {{ telemetry.isImportingBackup() ? 'sync' : 'cloud_upload' }}
              </mat-icon>
              <span>{{ telemetry.isImportingBackup() ? 'Przywracanie danych na serwerze...' : '⚡ Przywróć kopię zapasową na serwerze' }}</span>
            </button>
            <span class="text-[10px] text-slate-500 text-center block font-mono">
              Wszystkie urządzenia natychmiast pojawią się na pulpicie
            </span>
          </div>
        </div>

      </div>

      <!-- RAPORT WYNIKU PRZYWRACANIA JEŚLI WYKONANO -->
      @if (restoreSuccessReport(); as report) {
        <div
          class="p-5 rounded-2xl border transition-all animate-fade-in space-y-3"
          [class.bg-emerald-950/40]="report.success"
          [class.border-emerald-700]="report.success"
          [class.bg-rose-950/40]="!report.success"
          [class.border-rose-700]="!report.success"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <mat-icon class="text-xl" [class.text-emerald-400]="report.success" [class.text-rose-400]="!report.success">
                {{ report.success ? 'check_circle' : 'error' }}
              </mat-icon>
              <div>
                <h4 class="text-sm font-bold text-white tracking-wide">
                  {{ report.success ? 'Kopia zapasowa została pomyślnie wgrana!' : 'Błąd podczas przywracania kopii' }}
                </h4>
                <p class="text-xs" [class.text-emerald-300]="report.success" [class.text-rose-300]="!report.success">
                  {{ report.message }}
                </p>
              </div>
            </div>

            <button
              (click)="restoreSuccessReport.set(null)"
              class="text-xs text-slate-400 hover:text-white cursor-pointer"
            >
              Zamknij raport ✕
            </button>
          </div>

          @if (report.success) {
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-emerald-800/60 text-xs font-mono">
              <div class="p-2 rounded-lg bg-slate-950/60">
                <span class="text-slate-400 text-[10px] block">Odtworzone urządzenia:</span>
                <span class="text-white font-bold">{{ report.restored_counts.devices }}</span>
              </div>
              <div class="p-2 rounded-lg bg-slate-950/60">
                <span class="text-slate-400 text-[10px] block">Sensory Zigbee:</span>
                <span class="text-cyan-300 font-bold">{{ report.restored_counts.zigbee }}</span>
              </div>
              <div class="p-2 rounded-lg bg-slate-950/60">
                <span class="text-slate-400 text-[10px] block">Gniazdka Wi-Fi:</span>
                <span class="text-indigo-300 font-bold">{{ report.restored_counts.wifi }}</span>
              </div>
              <div class="p-2 rounded-lg bg-slate-950/60">
                <span class="text-slate-400 text-[10px] block">Dongle Max & Klucze:</span>
                <span class="text-emerald-300 font-bold">{{ report.dongle_max_restored ? 'Odtworzono ✓' : 'Brak' }}</span>
              </div>
            </div>
          }
        </div>
      }

      <!-- MODAL PODGLĄDU SUROWEGO KODU JSON -->
      @if (previewJsonOpen()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in">
          <div class="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
            <div class="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
              <div class="flex items-center gap-2.5">
                <mat-icon class="text-cyan-400">code</mat-icon>
                <h3 class="text-sm font-bold text-white">Podgląd zawartości kopii zapasowej JSON</h3>
              </div>
              <button
                (click)="previewJsonOpen.set(false)"
                class="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div class="p-4 flex-1 overflow-y-auto">
              <pre class="p-4 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-cyan-300 leading-relaxed overflow-x-auto whitespace-pre-wrap select-all">{{ rawJsonPreview() }}</pre>
            </div>

            <div class="px-6 py-3 bg-slate-950 border-t border-slate-800 flex items-center justify-between shrink-0">
              <span class="text-xs text-slate-400 font-mono">
                Zawiera wszystkie urządzenia, adresy IP i klucze AES
              </span>
              <div class="flex items-center gap-2">
                <button
                  (click)="copyRawJson()"
                  class="px-3.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all cursor-pointer"
                >
                  {{ copiedJson() ? 'Skopiowano!' : 'Kopiuj do schowka' }}
                </button>
                <button
                  (click)="previewJsonOpen.set(false)"
                  class="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Zamknij
                </button>
              </div>
            </div>
          </div>
        </div>
      }

    </div>
  `,
})
export class BackupManager {
  readonly telemetry = inject(Telemetry);

  readonly selectedFileName = signal<string | null>(null);
  readonly isDragging = signal<boolean>(false);
  readonly parsedBackup = signal<SystemBackupPackage | null>(null);
  readonly parseError = signal<string | null>(null);
  readonly restoreMode = signal<'replace' | 'merge'>('replace');

  readonly previewJsonOpen = signal<boolean>(false);
  readonly rawJsonPreview = signal<string>('');
  readonly copiedJson = signal<boolean>(false);
  readonly restoreSuccessReport = signal<BackupImportResponse | null>(null);

  // Wyliczenia statystyk z obecnego stanu
  readonly totalDevicesCount = computed(() => this.telemetry.allDevices().length);
  readonly zigbeeDevicesCount = computed(() => this.telemetry.allDevices().filter((d) => d.protocol !== 'wifi').length);
  readonly wifiDevicesCount = computed(() => this.telemetry.allDevices().filter((d) => d.protocol === 'wifi').length);

  readonly credentialsCount = computed(() => {
    return this.telemetry.allDevices().filter((d) => Boolean(d.local_key) || Boolean(d.sonoff_api_key)).length;
  });

  async downloadBackup(): Promise<void> {
    await this.telemetry.triggerBackupDownload();
  }

  async openRawJsonPreview(): Promise<void> {
    const res = await this.telemetry.getBackupPackage();
    if (res.success && res.data) {
      this.rawJsonPreview.set(JSON.stringify(res.data, null, 2));
      this.previewJsonOpen.set(true);
    } else {
      alert(`Błąd pobierania danych: ${res.message}`);
    }
  }

  copyRawJson(): void {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(this.rawJsonPreview()).then(() => {
        this.copiedJson.set(true);
        setTimeout(() => this.copiedJson.set(false), 2500);
      });
    }
  }

  triggerFileInput(): void {
    const el = document.querySelector('input[type="file"]') as HTMLInputElement | null;
    el?.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.processFile(input.files[0]);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(true);
  }

  onFileDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
    if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
      this.processFile(event.dataTransfer.files[0]);
    }
  }

  private processFile(file: File): void {
    this.selectedFileName.set(file.name);
    this.parseError.set(null);
    this.parsedBackup.set(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const parsed = JSON.parse(text);

        // Walidacja struktury backupu
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('Plik nie zawiera poprawnego obiektu JSON.');
        }

        const devList = Array.isArray(parsed.devices) ? parsed.devices : [];
        if (devList.length === 0 && !parsed.dongle_max) {
          throw new Error('Plik nie zawiera sekcji "devices" ani "dongle_max". Czy to na pewno plik kopii zapasowej tego systemu?');
        }

        this.parsedBackup.set(parsed as SystemBackupPackage);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.parseError.set(`Błąd odczytu pliku: ${msg}`);
      }
    };
    reader.onerror = () => {
      this.parseError.set('Nie udało się odczytać wybranego pliku z dysku.');
    };
    reader.readAsText(file);
  }

  async triggerRestore(): Promise<void> {
    const backup = this.parsedBackup();
    if (!backup) return;

    const mode = this.restoreMode();
    const count = backup.devices?.length || 0;

    const confirmMsg = mode === 'replace'
      ? `Czy na pewno chcesz zastąpić WSZYSTKIE obecne urządzenia i konfigurację DongleMAX danymi z kopii zapasowej (${count} urządzeń)?\n\nOperacja jest przeznaczona dla nowej instancji serwera.`
      : `Czy chcesz scalić ${count} urządzeń z pliku kopii zapasowej z obecną bazą?`;

    if (!confirm(confirmMsg)) return;

    const res = await this.telemetry.restoreBackupPackage(backup, mode);
    this.restoreSuccessReport.set(res);

    if (res.success) {
      this.parsedBackup.set(null);
      this.selectedFileName.set(null);
    }
  }
}
