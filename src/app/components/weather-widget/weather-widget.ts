import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Weather, WeatherLocation } from '../../services/weather';

export interface WeatherWidgetCloudInfo {
  icon: string;
  label: string;
  description: string;
  colorClass: string;
}

export interface WeatherRainForecast {
  hasRain: boolean;
  rainAmount: number; // mm
  chancePercent: number; // 0 - 100
  intensityLabel: string;
  intensityColor: string;
  summary: string;
  nextHoursText: string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-weather-widget',
  imports: [MatIconModule],
  template: `
    <div
      class="p-4 rounded-2xl bg-gradient-to-br from-slate-900/95 via-slate-900/90 to-slate-950/95 border border-slate-800 hover:border-cyan-500/40 shadow-xl transition-all relative overflow-hidden group"
    >
      <!-- Subtelny efekt tła gradientowego -->
      <div
        class="absolute -right-8 -top-8 w-36 h-36 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none group-hover:bg-cyan-500/15 transition-all"
      ></div>

      @if (weather.selectedLocation(); as loc) {
        <!-- Pasek górny: Nazwa miejscowości + Województwo + Przycisk przejścia do IMGW -->
        <div class="flex items-center justify-between gap-3 mb-3 relative z-10">
          <div class="flex items-center gap-2 min-w-0">
            <span
              class="w-7 h-7 rounded-lg bg-cyan-950 border border-cyan-800/80 flex items-center justify-center text-cyan-400 shrink-0"
            >
              <mat-icon class="text-sm !w-4 !h-4">location_on</mat-icon>
            </span>
            <div class="truncate">
              <div class="flex items-center gap-1.5 truncate">
                <span class="text-sm font-bold text-white tracking-tight truncate">
                  {{ loc.name }}
                </span>
                <span
                  class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 border border-slate-700/80 truncate shrink-0"
                >
                  {{ loc.voivodeship }}
                </span>
                @if (weather.isFavoriteLocation(loc.id)) {
                  <mat-icon
                    class="text-xs !w-3.5 !h-3.5 text-amber-400 shrink-0"
                    title="Ulubiona lokalizacja IMGW"
                  >star</mat-icon>
                }
              </div>
              <span class="text-[10px] text-slate-400 block truncate">
                Stacja IMGW: {{ loc.synopStationName || loc.sourceDesc || 'Pomiary oficjalne' }}
              </span>
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            <!-- Szybki wybór innej ulubionej lokalizacji jeśli jest ich więcej -->
            @if (weather.favoriteLocations().length > 1) {
              <div class="relative">
                <select
                  [value]="weather.selectedLocationId()"
                  (change)="onLocationChange($any($event.target).value)"
                  class="bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 rounded-lg text-[11px] font-semibold pl-2 pr-6 py-1 cursor-pointer appearance-none transition-colors max-w-[130px] truncate"
                  title="Przełącz ulubioną miejscowość z zakładki Pogoda"
                >
                  @for (fav of weather.favoriteLocations(); track fav.id) {
                    <option [value]="fav.id">⭐ {{ fav.name }}</option>
                  }
                </select>
                <mat-icon
                  class="absolute right-1 top-1 text-slate-400 pointer-events-none text-xs !w-3.5 !h-3.5"
                >unfold_more</mat-icon>
              </div>
            }

            <!-- Przycisk przejścia do pełnego panelu Pogoda IMGW -->
            <button
              type="button"
              (click)="navigateToWeatherTab.emit()"
              class="flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-800 hover:bg-cyan-600/30 text-cyan-300 hover:text-cyan-200 border border-slate-700 hover:border-cyan-500/50 transition-all cursor-pointer shadow-sm"
              title="Otwórz pełny panel Pogody IMGW (wykresy, hydro, ostrzeżenia)"
            >
              <mat-icon class="text-xs !w-3.5 !h-3.5">open_in_new</mat-icon>
              <span class="hidden sm:inline">Panel IMGW</span>
            </button>
          </div>
        </div>

        <!-- Główna siatka wskaźników pogody: Zachmurzenie, Temperatura, Ciśnienie, Przewidywane Opady -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-2.5 relative z-10">
          
          <!-- 1. ZACHMURZENIE Z INTELIGENTNĄ IKONĄ -->
          <div class="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center gap-2.5">
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
              [class]="cloudInfo().colorClass"
            >
              <mat-icon class="text-xl !w-5 !h-5">{{ cloudInfo().icon }}</mat-icon>
            </div>
            <div class="min-w-0">
              <span class="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold block truncate">
                Zachmurzenie
              </span>
              <span class="text-xs font-bold text-white block truncate">
                {{ cloudInfo().label }}
              </span>
              <span class="text-[10px] text-slate-400 block truncate">
                {{ cloudInfo().description }}
              </span>
            </div>
          </div>

          <!-- 2. TEMPERATURA ZEWNĘTRZNA -->
          <div class="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center gap-2.5">
            <div
              class="w-10 h-10 rounded-xl bg-amber-950/40 border border-amber-800/60 flex items-center justify-center text-amber-400 shrink-0"
            >
              <mat-icon class="text-xl !w-5 !h-5">thermostat</mat-icon>
            </div>
            <div class="min-w-0">
              <span class="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold block truncate">
                Temperatura
              </span>
              <div class="flex items-baseline gap-1">
                <span class="text-base font-black text-white tracking-tight">
                  {{ loc.temp !== null ? loc.temp : '--' }}
                </span>
                <span class="text-[11px] font-bold text-amber-400">°C</span>
              </div>
              <span class="text-[10px] text-slate-400 block truncate">
                @if (loc.groundTemp !== null && loc.groundTemp !== undefined) {
                  Grunt: {{ loc.groundTemp }}°C
                } @else if (loc.humidity !== null) {
                  Wilg: {{ loc.humidity }}%
                } @else {
                  IMGW-PIB
                }
              </span>
            </div>
          </div>

          <!-- 3. CIŚNIENIE ATMOSFERYCZNE -->
          <div class="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center gap-2.5">
            <div
              class="w-10 h-10 rounded-xl bg-indigo-950/40 border border-indigo-800/60 flex items-center justify-center text-indigo-400 shrink-0"
            >
              <mat-icon class="text-xl !w-5 !h-5">speed</mat-icon>
            </div>
            <div class="min-w-0">
              <span class="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold block truncate">
                Ciśnienie
              </span>
              <div class="flex items-baseline gap-1">
                <span class="text-base font-black text-white tracking-tight">
                  {{ loc.pressure !== null ? loc.pressure : '--' }}
                </span>
                <span class="text-[11px] font-bold text-indigo-400">hPa</span>
              </div>
              <span class="text-[10px] text-slate-400 block truncate">
                {{ getPressureTrend(loc.pressure) }}
              </span>
            </div>
          </div>

          <!-- 4. PRZEWIDYWANE OPADY / PROGNOZA OPADÓW -->
          <div
            class="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-center gap-2.5"
            [class.border-cyan-500/50]="rainForecast().hasRain"
          >
            <div
              class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
              [class]="rainForecast().intensityColor"
            >
              <mat-icon class="text-xl !w-5 !h-5">
                {{ rainForecast().hasRain ? 'rainy' : 'water_drop' }}
              </mat-icon>
            </div>
            <div class="min-w-0">
              <span class="text-[10px] font-mono uppercase tracking-wider text-slate-400 font-semibold block truncate">
                Przewidywane opady
              </span>
              <div class="flex items-baseline gap-1.5">
                <span class="text-xs font-black text-white tracking-tight truncate">
                  {{ rainForecast().intensityLabel }}
                </span>
                @if (rainForecast().rainAmount > 0) {
                  <span class="text-[11px] font-bold text-cyan-400">
                    {{ rainForecast().rainAmount }} mm
                  </span>
                }
              </div>
              <span class="text-[10px] text-slate-400 block truncate" [title]="rainForecast().summary">
                {{ rainForecast().nextHoursText }}
              </span>
            </div>
          </div>

        </div>

        <!-- Pasek powiadomień/alertów dla wybranej lokalizacji, jeśli IMGW wydało ostrzeżenie -->
        @if (locationWarnings().length > 0) {
          <div
            class="mt-2.5 p-2 rounded-xl bg-amber-950/40 border border-amber-600/60 text-amber-200 text-xs flex items-center justify-between gap-2 animate-in fade-in"
          >
            <div class="flex items-center gap-2 min-w-0">
              <mat-icon class="text-amber-400 text-sm !w-4 !h-4 animate-pulse shrink-0">warning</mat-icon>
              <span class="text-[11px] font-medium truncate">
                <strong>Ostrzeżenie IMGW:</strong> {{ locationWarnings()[0].zdarzenie }} (Stopień {{ locationWarnings()[0].stopien }})
              </span>
            </div>
            <button
              type="button"
              (click)="navigateToWeatherTab.emit()"
              class="text-[10px] font-bold text-amber-300 hover:text-white underline cursor-pointer shrink-0"
            >
              Szczegóły
            </button>
          </div>
        }
      } @else {
        <!-- Stan ładowania danych pogodowych -->
        <div class="flex items-center justify-between py-2 text-xs text-slate-400">
          <div class="flex items-center gap-2">
            <mat-icon class="animate-spin text-cyan-400 text-base !w-4 !h-4">refresh</mat-icon>
            <span>Pobieranie aktualnych odczytów ze stacji IMGW-PIB...</span>
          </div>
          <button
            type="button"
            (click)="navigateToWeatherTab.emit()"
            class="text-cyan-400 hover:underline text-xs font-semibold cursor-pointer"
          >
            Wybierz miejscowość
          </button>
        </div>
      }
    </div>
  `,
})
export class WeatherWidget {
  readonly weather = inject(Weather);

  // Zdarzenie przejścia do zakładki Pogoda IMGW
  readonly navigateToWeatherTab = output<void>();

  // Zmiana wybranej lokalizacji z dropdownu w widgecie
  onLocationChange(locationId: string): void {
    if (locationId) {
      this.weather.selectLocation(locationId);
    }
  }

  // Aktywne ostrzeżenia IMGW dla wybranego województwa
  readonly locationWarnings = computed(() => {
    const loc = this.weather.selectedLocation();
    if (!loc) return [];
    const voivNorm = (loc.voivodeship || '').toLowerCase();
    return this.weather.meteoWarnings().filter((w) => {
      if (!w.obszary) return true;
      return w.obszary.some((o) => (o.wojewodztwo || '').toLowerCase().includes(voivNorm));
    });
  });

  // Obliczenie ikony oraz opisu aktualnego zachmurzenia na bazie wilgotności, opadów i ciśnienia
  readonly cloudInfo = computed<WeatherWidgetCloudInfo>(() => {
    const loc = this.weather.selectedLocation();
    if (!loc) {
      return {
        icon: 'cloud',
        label: 'Umiarkowane',
        description: 'Brak odczytu',
        colorClass: 'bg-slate-800 border-slate-700 text-slate-400',
      };
    }

    const rain = Number(loc.rain || 0);
    const hum = loc.humidity !== null && loc.humidity !== undefined ? Number(loc.humidity) : 65;
    const press = loc.pressure !== null && loc.pressure !== undefined ? Number(loc.pressure) : 1013;

    // 1. Jeśli pada deszcz
    if (rain > 1.5) {
      return {
        icon: 'thunderstorm',
        label: 'Całkowite (Burzowe)',
        description: `Opady ${rain} mm`,
        colorClass: 'bg-violet-950/60 border-violet-700/60 text-violet-300',
      };
    }

    if (rain > 0) {
      return {
        icon: 'rainy',
        label: 'Całkowite (Deszcz)',
        description: `Opady ${rain} mm`,
        colorClass: 'bg-blue-950/60 border-blue-700/60 text-blue-300',
      };
    }

    // 2. Jeśli jest wysoka wilgotność lub niskie ciśnienie
    if (hum >= 85) {
      return {
        icon: 'cloud',
        label: 'Całkowite (8/8)',
        description: 'Gruba pokrywa chmur',
        colorClass: 'bg-slate-800 border-slate-600 text-slate-200',
      };
    }

    if (hum >= 70) {
      return {
        icon: 'cloud_queue',
        label: 'Duże (6/8)',
        description: 'Chmury warstwowe',
        colorClass: 'bg-cyan-950/50 border-cyan-800/60 text-cyan-300',
      };
    }

    if (hum >= 50 || press < 1010) {
      return {
        icon: 'partly_cloudy_day',
        label: 'Umiarkowane (4/8)',
        description: 'Przejaśnienia',
        colorClass: 'bg-amber-950/40 border-amber-700/60 text-amber-300',
      };
    }

    // 3. Niska wilgotność i wysokie ciśnienie -> bezchmurnie / słonecznie
    return {
      icon: 'wb_sunny',
      label: 'Bezchmurnie (0-1/8)',
      description: 'Czyste niebo',
      colorClass: 'bg-amber-500/10 border-amber-500/40 text-amber-400',
    };
  });

  // Obliczenie przewidywanych opadów (analiza bieżącego odczytu + trend z historii godzinowej)
  readonly rainForecast = computed<WeatherRainForecast>(() => {
    const loc = this.weather.selectedLocation();
    const history = this.weather.stationHistory();

    const currentRain = loc && loc.rain !== null && loc.rain !== undefined ? Number(loc.rain) : 0;
    const hum = loc && loc.humidity !== null && loc.humidity !== undefined ? Number(loc.humidity) : 60;
    const press = loc && loc.pressure !== null && loc.pressure !== undefined ? Number(loc.pressure) : 1013;

    // Sprawdź czy w ostatnich godzinach na stacji notowano opady
    let recentRainSum = 0;
    if (Array.isArray(history) && history.length > 0) {
      const recentPoints = history.slice(-4);
      recentRainSum = recentPoints.reduce((acc, p) => acc + (p.opad ? Number(p.opad) : 0), 0);
    }

    const effectiveRain = Math.max(currentRain, Math.round(recentRainSum * 10) / 10);

    if (effectiveRain > 5.0) {
      return {
        hasRain: true,
        rainAmount: effectiveRain,
        chancePercent: 95,
        intensityLabel: 'Ulewny deszcz',
        intensityColor: 'bg-rose-950/60 border-rose-700/70 text-rose-300',
        summary: 'Intensywne opady atmosferyczne wg stacji IMGW',
        nextHoursText: 'Opady ulewne (>5mm)',
      };
    }

    if (effectiveRain > 1.0) {
      return {
        hasRain: true,
        rainAmount: effectiveRain,
        chancePercent: 85,
        intensityLabel: 'Umiarkowany opad',
        intensityColor: 'bg-cyan-950/60 border-cyan-700/70 text-cyan-300',
        summary: 'Ciągłe opady deszczu w rejonie stacji',
        nextHoursText: 'Opady umiarkowane',
      };
    }

    if (effectiveRain > 0) {
      return {
        hasRain: true,
        rainAmount: effectiveRain,
        chancePercent: 70,
        intensityLabel: 'Lekka mżawka / deszcz',
        intensityColor: 'bg-blue-950/60 border-blue-700/60 text-blue-300',
        summary: 'Drobny opad deszczu zarejestrowany na stacji',
        nextHoursText: 'Drobne opady',
      };
    }

    // Prognoza prawdopodobieństwa deszczu przy zerowym bieżącym opadzie
    if (hum >= 85 && press < 1008) {
      return {
        hasRain: false,
        rainAmount: 0,
        chancePercent: 60,
        intensityLabel: 'Możliwy przelotny opad',
        intensityColor: 'bg-slate-900 border-amber-600/50 text-amber-300',
        summary: 'Spadek ciśnienia i wysoka wilgotność (ryzyko deszczu)',
        nextHoursText: 'Szansa opadu ~60%',
      };
    }

    if (hum >= 75) {
      return {
        hasRain: false,
        rainAmount: 0,
        chancePercent: 30,
        intensityLabel: 'Niskie ryzyko opadu',
        intensityColor: 'bg-slate-900 border-slate-700 text-slate-300',
        summary: 'Zachmurzenie bez opadów na stacji',
        nextHoursText: 'Szansa opadu ~30%',
      };
    }

    return {
      hasRain: false,
      rainAmount: 0,
      chancePercent: 5,
      intensityLabel: 'Brak opadów',
      intensityColor: 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400',
      summary: 'Stabilna, sucha aura według wskazań IMGW',
      nextHoursText: 'Sucho (0.0 mm)',
    };
  });

  // Trend ciśnienia
  getPressureTrend(pressure: number | null): string {
    if (pressure === null || pressure === undefined) return 'Normalne';
    const val = Number(pressure);
    if (val > 1020) return 'Wysokie (Wyż)';
    if (val < 1005) return 'Niskie (Niż)';
    return 'Zredukowane';
  }
}
