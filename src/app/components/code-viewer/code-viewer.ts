import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';

interface CodeFile {
  name: string;
  path: string;
  description: string;
  language: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-code-viewer',
  imports: [MatIconModule],
  template: `
    <div class="space-y-6">
      <!-- Wstęp architektoniczny -->
      <div class="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 class="text-lg font-bold text-white flex items-center gap-2">
            <mat-icon class="text-cyan-400">code</mat-icon>
            Pliki źródłowe backendu IoT & Instrukcja wdrożenia
          </h2>
          <p class="text-xs text-slate-400 mt-1 max-w-2xl">
            Kompletne, przetestowane pliki gotowe do skopiowania lub pobrania na stację roboczą z koordynatorem Sonoff Dongle-M (układ Silicon Labs EFR32MG24).
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            (click)="copyCurrentCode()"
            class="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition-colors"
          >
            <mat-icon class="text-sm !w-4 !h-4">{{ copySuccess() ? 'check' : 'content_copy' }}</mat-icon>
            <span>{{ copySuccess() ? 'Skopiowano!' : 'Kopiuj kod' }}</span>
          </button>
          <button
            (click)="downloadCurrentFile()"
            class="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-900/20 transition-colors"
          >
            <mat-icon class="text-sm !w-4 !h-4">download</mat-icon>
            <span>Pobierz plik</span>
          </button>
        </div>
      </div>

      <!-- Przełącznik plików (Karty plików) -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        @for (file of files; track file.path) {
          <button
            (click)="selectFile(file)"
            class="p-3 rounded-xl text-left border transition-all"
            [class.bg-slate-900]="selectedFile().path === file.path"
            [class.border-cyan-500]="selectedFile().path === file.path"
            [class.shadow-md]="selectedFile().path === file.path"
            [class.shadow-cyan-950/30]="selectedFile().path === file.path"
            [class.bg-slate-900/40]="selectedFile().path !== file.path"
            [class.border-slate-800]="selectedFile().path !== file.path"
            [class.hover:border-slate-700]="selectedFile().path !== file.path"
          >
            <div class="flex items-center gap-2 mb-1">
              <mat-icon class="text-sm !w-4 !h-4" [class.text-cyan-400]="selectedFile().path === file.path" [class.text-slate-500]="selectedFile().path !== file.path">
                description
              </mat-icon>
              <span class="text-xs font-mono font-semibold truncate" [class.text-white]="selectedFile().path === file.path" [class.text-slate-300]="selectedFile().path !== file.path">
                {{ file.name }}
              </span>
            </div>
            <p class="text-[10px] text-slate-500 line-clamp-1">
              {{ file.description }}
            </p>
          </button>
        }
      </div>

      <!-- Okno podglądu kodu -->
      <div class="rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden shadow-xl">
        <!-- Pasek tytułowy pliku -->
        <div class="p-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs font-mono">
          <div class="flex items-center gap-2 text-slate-300">
            <span class="w-2.5 h-2.5 rounded-full bg-rose-500/80"></span>
            <span class="w-2.5 h-2.5 rounded-full bg-amber-500/80"></span>
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-500/80"></span>
            <span class="ml-2 font-bold text-white">{{ selectedFile().name }}</span>
            <span class="text-slate-500">({{ selectedFile().language }})</span>
          </div>
          <span class="text-slate-500 text-[11px]">{{ fileContent().length }} znaków</span>
        </div>

        <!-- Treść kodu z zachowaniem formatowania -->
        <div class="p-4 max-h-[550px] overflow-auto">
          @if (isLoading()) {
            <div class="flex items-center justify-center py-20 text-slate-500 gap-2 text-xs font-mono">
              <mat-icon class="animate-spin text-base">refresh</mat-icon>
              Ładowanie pliku...
            </div>
          } @else {
            <pre class="font-mono text-xs text-slate-300 leading-relaxed whitespace-pre selection:bg-cyan-500 selection:text-white"><code>{{ fileContent() }}</code></pre>
          }
        </div>
      </div>
    </div>
  `,
})
export class CodeViewer {
  private http = inject(HttpClient);

  readonly files: CodeFile[] = [
    {
      name: 'install.sh',
      path: 'install.sh',
      description: 'Automatyczny instalator Linux (systemd Mosquitto + Zigbee2MQTT + Panel)',
      language: 'bash',
    },
    {
      name: 'docker-compose.yml',
      path: 'docker-compose.yml',
      description: 'Stos kontenerów Docker Mosquitto + Zigbee2MQTT + IoT Panel',
      language: 'yaml',
    },
    {
      name: 'install.ps1',
      path: 'install.ps1',
      description: 'Instalator Windows PowerShell dla Mosquitto i Zigbee2MQTT',
      language: 'powershell',
    },
    {
      name: 'configuration.yaml',
      path: 'configuration.yaml',
      description: 'Konfiguracja Zigbee2MQTT dla Dongle Max (port: tcp://Dongle-M.local:6638, adapter: ember)',
      language: 'yaml',
    },
    {
      name: 'database.py',
      path: 'database.py',
      description: 'SQLite (telemetry.db) CRUD & agregacja czasowa 6h-720d',
      language: 'python',
    },
    {
      name: 'backend_mqtt.py',
      path: 'backend_mqtt.py',
      description: 'Implementacja Zigbee2MQTT + Mosquitto + FastAPI bufor',
      language: 'python',
    },
    {
      name: 'backend_native.py',
      path: 'backend_native.py',
      description: 'Natywna implementacja zigpy/bellows EZSP (gniazdo sieciowe socket:// oraz USB)',
      language: 'python',
    },
    {
      name: 'DEPLOYMENT.md',
      path: 'DEPLOYMENT.md',
      description: 'Przewodnik Sonoff Dongle Max (sieć TCP, PoE, tryb routera mesh, Windows/Linux)',
      language: 'markdown',
    },
    {
      name: 'mosquitto.conf',
      path: 'mosquitto.conf',
      description: 'Konfiguracja brokera MQTT Eclipse Mosquitto',
      language: 'text',
    },
    {
      name: 'requirements.txt',
      path: 'requirements.txt',
      description: 'Zależności Python (FastAPI, paho-mqtt, bellows, zigpy)',
      language: 'text',
    },
  ];

  readonly selectedFile = signal<CodeFile>(this.files[0]);
  readonly fileContent = signal<string>('');
  readonly isLoading = signal<boolean>(false);
  readonly copySuccess = signal<boolean>(false);

  constructor() {
    this.loadFile(this.files[0]);
  }

  selectFile(file: CodeFile): void {
    this.selectedFile.set(file);
    this.loadFile(file);
  }

  private loadFile(file: CodeFile): void {
    this.isLoading.set(true);
    this.http.get(`/api/files/${file.path}`, { responseType: 'text' }).subscribe({
      next: (content) => {
        this.isLoading.set(false);
        this.fileContent.set(content);
      },
      error: () => {
        this.isLoading.set(false);
        this.fileContent.set('# Plik dostępny w katalogu projektu lub po starcie serwera');
      },
    });
  }

  copyCurrentCode(): void {
    const text = this.fileContent();
    navigator.clipboard.writeText(text).then(() => {
      this.copySuccess.set(true);
      setTimeout(() => this.copySuccess.set(false), 2000);
    });
  }

  downloadCurrentFile(): void {
    const file = this.selectedFile();
    const blob = new Blob([this.fileContent()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }
}
