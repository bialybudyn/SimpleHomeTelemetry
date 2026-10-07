import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-android-viewer',
  imports: [MatIconModule],
  template: `
    <div class="space-y-6">
      <!-- Baner pobierania pliku APK i instrukcja rozwiązywania problemów -->
      <div class="p-6 rounded-2xl bg-gradient-to-r from-emerald-950 via-slate-900 to-teal-950 border border-emerald-800/80 space-y-6 shadow-2xl">
        <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-6 border-b border-slate-800/80 pb-6">
          <div class="space-y-2">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-mono font-bold">
              <mat-icon class="text-sm !w-4 !h-4">get_app</mat-icon>
              <span>Aplikacja Android (.APK) & Wersja PWA</span>
            </div>
            <h2 class="text-2xl font-extrabold text-white tracking-tight">
              Pobierz Aplikację Mobilną SimpleHomeTelemetry (.APK)
            </h2>
            <p class="text-xs text-slate-300 max-w-2xl leading-relaxed">
              Pobierz bezpośrenio pakiet <strong class="text-emerald-400">SimpleHomeTelemetry.apk</strong> lub dodaj panel do ekranu głównego telefonu jako natywną aplikację PWA.
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-3 shrink-0">
            <a
              href="/api/files/SimpleHomeTelemetry.apk"
              download="SimpleHomeTelemetry.apk"
              class="flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold shadow-xl shadow-emerald-950/60 transition-all cursor-pointer border border-emerald-400/40"
            >
              <mat-icon class="text-base">download</mat-icon>
              <span>Pobierz SimpleHomeTelemetry.apk</span>
            </a>

            <a
              href="/api/files/SimpleHomeTelemetry-AndroidProject.zip"
              download="SimpleHomeTelemetry-AndroidProject.zip"
              class="flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-all cursor-pointer"
            >
              <mat-icon class="text-base">folder_zip</mat-icon>
              <span>Projekt Android Studio (.ZIP)</span>
            </a>
          </div>
        </div>

        <!-- INSTRUKCJA KROK PO KROKU: JAK OMINĄĆ BLOKADĘ INSTALACJI NA TELEFONIE -->
        <div class="p-5 rounded-xl bg-slate-950/90 border border-amber-500/40 space-y-4">
          <div class="flex items-center gap-2.5 text-amber-300 font-bold text-sm">
            <mat-icon class="text-amber-400">warning</mat-icon>
            <span>Telefon zgłasza błąd / blokuje instalację pliku .APK? Oto jak to rozwiązać:</span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
            <!-- Rozwiązanie 1: Play Protect -->
            <div class="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <div class="flex items-center gap-2 text-rose-400 font-bold">
                <span class="w-5 h-5 rounded-full bg-rose-500/20 flex items-center justify-center text-[10px] border border-rose-500/30">1</span>
                <span>Google Play Protect</span>
              </div>
              <p class="text-slate-300 leading-relaxed text-[11px]">
                Jeśli telefon wyświetli komunikat <strong class="text-white">„Aplikacja zablokowana przez Play Protect”</strong>, rozwiń napis <strong class="text-amber-300">„Więcej szczegółów”</strong> na dole ekranu i kliknij <strong class="text-emerald-400">„Zainstaluj mimo to”</strong> (Install anyway).
              </p>
            </div>

            <!-- Rozwiązanie 2: Zgoda na nieznane źródła -->
            <div class="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <div class="flex items-center gap-2 text-amber-400 font-bold">
                <span class="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-[10px] border border-amber-500/30">2</span>
                <span>Zezwolenie przeglądarki</span>
              </div>
              <p class="text-slate-300 leading-relaxed text-[11px]">
                Wejdź w <strong class="text-white">Ustawienia telefonu -> Aplikacje -> Chrome/Edge -> Zainstaluj nieznane aplikacje</strong> i włącz przełącznik <strong class="text-cyan-300">„Zezwalaj z tego źródła”</strong>.
              </p>
            </div>

            <!-- Rozwiązanie 3: Alternatywa PWA Bez Ostrzeżeń -->
            <div class="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
              <div class="flex items-center gap-2 text-emerald-400 font-bold">
                <span class="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center text-[10px] border border-emerald-500/30">3</span>
                <span>Instalacja PWA (Najłatwiejsza)</span>
              </div>
              <p class="text-slate-300 leading-relaxed text-[11px]">
                Otwórz ten panel na telefonie w przeglądarce Chrome, kliknij menu <strong class="text-white">⋮ (trzy kropki)</strong> w prawym górnym rogu i wybierz <strong class="text-emerald-300">„Dodaj do ekranu głównego”</strong> lub <strong class="text-emerald-300">„Zainstaluj aplikację”</strong>.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Wstęp aplikacji mobilnej -->
      <div class="p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div class="max-w-2xl">
          <div class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/80 text-emerald-400 text-xs font-mono mb-2">
            <mat-icon class="text-sm !w-4 !h-4">android</mat-icon>
            <span>Kotlin · Jetpack Compose · Material 3</span>
          </div>
          <h2 class="text-xl font-bold text-white tracking-tight">
            Natywna aplikacja Android z powiadomieniami Heads-Up
          </h2>
          <p class="text-xs text-slate-400 mt-2 leading-relaxed">
            Dedykowana aplikacja na Androida czyta dane z naszego serwera przez REST API (<code class="font-mono text-cyan-400">/api/devices</code>) oraz utrzymuje ciągłe połączenie w tle przez Foreground Service i WebSocket (<code class="font-mono text-cyan-400">/ws</code>). Gdy temperatura przekroczy próg (np. &gt; 28°C) lub bateria spadnie poniżej 20%, telefon natychmiast wyświetla wibrację i powiadomienie alarmowe.
          </p>
        </div>

        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shrink-0">
          <button
            (click)="copyActiveCode()"
            class="flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 transition-colors"
          >
            <mat-icon class="text-sm !w-4 !h-4">{{ copied() ? 'check' : 'content_copy' }}</mat-icon>
            <span>{{ copied() ? 'Skopiowano kod!' : 'Kopiuj plik Kotlin' }}</span>
          </button>
          <button
            (click)="downloadActiveCode()"
            class="flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950/30 transition-colors"
          >
            <mat-icon class="text-sm !w-4 !h-4">download</mat-icon>
            <span>Pobierz źródło .kt</span>
          </button>
        </div>
      </div>

      <!-- Karty architektury Androida -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
          <div class="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-800/80 flex items-center justify-center text-cyan-400 mb-3">
            <mat-icon class="text-base">sync</mat-icon>
          </div>
          <h4 class="text-sm font-bold text-white mb-1">Foreground Service (OkHttp)</h4>
          <p class="text-xs text-slate-400 leading-relaxed">
            Niezawodna usługa systemowa Android działająca w tle, ignorująca usypianie Doze Mode dzięki kanałowi <code class="font-mono text-slate-300">FOREGROUND_SERVICE_DATA_SYNC</code>.
          </p>
        </div>

        <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
          <div class="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-800/80 flex items-center justify-center text-emerald-400 mb-3">
            <mat-icon class="text-base">notifications_active</mat-icon>
          </div>
          <h4 class="text-sm font-bold text-white mb-1">Heads-Up Notifications</h4>
          <p class="text-xs text-slate-400 leading-relaxed">
            Wysoki priorytet <code class="font-mono text-slate-300">IMPORTANCE_HIGH</code> z wibracją przy przekroczeniu krytycznych progów środowiskowych lub wyczerpaniu baterii CR2032.
          </p>
        </div>

        <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
          <div class="w-8 h-8 rounded-lg bg-blue-950/80 border border-blue-800/80 flex items-center justify-center text-blue-400 mb-3">
            <mat-icon class="text-base">touch_app</mat-icon>
          </div>
          <h4 class="text-sm font-bold text-white mb-1">Zdalne parowanie z telefonu</h4>
          <p class="text-xs text-slate-400 leading-relaxed">
            Możliwość wywołania trybu parowania koordynatora Sonoff (<code class="font-mono text-slate-300">permit_join 60s</code>) bezpośrednio z ekranu telefonu podczas montażu czujnika.
          </p>
        </div>
      </div>

      <!-- Wybór pliku Kotlin do podglądu -->
      <div class="flex items-center gap-2">
        <button
          (click)="setFile('main')"
          class="px-3.5 py-1.5 rounded-lg text-xs font-mono transition-colors"
          [class.bg-emerald-600]="activeTab() === 'main'"
          [class.text-white]="activeTab() === 'main'"
          [class.font-semibold]="activeTab() === 'main'"
          [class.bg-slate-900]="activeTab() !== 'main'"
          [class.text-slate-400]="activeTab() !== 'main'"
        >
          MainActivity.kt (UI & Compose)
        </button>
        <button
          (click)="setFile('service')"
          class="px-3.5 py-1.5 rounded-lg text-xs font-mono transition-colors"
          [class.bg-emerald-600]="activeTab() === 'service'"
          [class.text-white]="activeTab() === 'service'"
          [class.font-semibold]="activeTab() === 'service'"
          [class.bg-slate-900]="activeTab() !== 'service'"
          [class.text-slate-400]="activeTab() !== 'service'"
        >
          TelemetryForegroundService.kt (Tło & Alarmy)
        </button>
      </div>

      <!-- Terminal podglądu kodu -->
      <div class="rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden shadow-xl">
        <div class="p-3.5 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs font-mono">
          <span class="text-slate-300 font-bold">
            android_app/app/src/main/java/com/iot/zigbeemonitor/{{ activeTab() === 'main' ? 'MainActivity.kt' : 'service/TelemetryForegroundService.kt' }}
          </span>
          <span class="text-emerald-400">Kotlin 1.9+</span>
        </div>
        <div class="p-4 max-h-[500px] overflow-auto">
          @if (isLoading()) {
            <div class="flex items-center justify-center py-20 text-slate-500 gap-2 text-xs font-mono">
              <mat-icon class="animate-spin text-base">refresh</mat-icon>
              Ładowanie pliku Kotlin...
            </div>
          } @else {
            <pre class="font-mono text-xs text-slate-300 leading-relaxed whitespace-pre selection:bg-emerald-500 selection:text-white"><code>{{ activeContent() }}</code></pre>
          }
        </div>
      </div>
    </div>
  `,
})
export class AndroidViewer {
  private http = inject(HttpClient);

  readonly activeTab = signal<'main' | 'service'>('main');
  readonly activeContent = signal<string>('');
  readonly isLoading = signal<boolean>(false);
  readonly copied = signal<boolean>(false);

  constructor() {
    this.loadFile('main');
  }

  setFile(tab: 'main' | 'service'): void {
    this.activeTab.set(tab);
    this.loadFile(tab);
  }

  private loadFile(tab: 'main' | 'service'): void {
    this.isLoading.set(true);
    const filename = tab === 'main' ? 'android_MainActivity.kt' : 'android_TelemetryForegroundService.kt';
    this.http.get(`/api/files/${filename}`, { responseType: 'text' }).subscribe({
      next: (content) => {
        this.isLoading.set(false);
        this.activeContent.set(content);
      },
      error: () => {
        this.isLoading.set(false);
        this.activeContent.set('// Plik dostępny w katalogu android_app/');
      },
    });
  }

  copyActiveCode(): void {
    navigator.clipboard.writeText(this.activeContent()).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  downloadActiveCode(): void {
    const filename = this.activeTab() === 'main' ? 'MainActivity.kt' : 'TelemetryForegroundService.kt';
    const blob = new Blob([this.activeContent()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
