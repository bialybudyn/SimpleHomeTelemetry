import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  OnDestroy,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import {
  Weather,
  ImgwWarning,
  ImgwHydroStation,
  ImgwHourlyPoint,
  WeatherLocation,
  ImgwMeteoStation,
  GeocodeResult,
  warningInVoivodeship,
} from '../../services/weather';
import { Telemetry } from '../../services/telemetry';
import { Chart, ChartDataset, registerables } from 'chart.js';
import { CollapsibleSection } from '../collapsible-section/collapsible-section';
import { WeatherExtras } from './weather-extras';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-weather-view',
  imports: [MatIconModule, CollapsibleSection, WeatherExtras],
  template: `
    <div class="space-y-6">

      <!-- 1. NAGŁÓWEK PANELU POGODY -->
      <app-collapsible-section sectionId="weather.header" title="Pogoda IMGW-PIB" icon="cloud" iconClass="text-cyan-400"
        [subtitle]="headerSubtitle()">
        <button section-actions
          type="button"
          (click)="refreshData()"
          [disabled]="weather.isLoadingLocations() || weather.isLoadingDetails()"
          class="flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white border border-slate-700 transition-colors cursor-pointer"
          title="Odśwież pomiary ze stacji IMGW"
        >
          <mat-icon class="text-sm !w-4 !h-4 text-cyan-400" [class.animate-spin]="weather.isLoadingLocations() || weather.isLoadingDetails()">refresh</mat-icon>
          <span class="hidden sm:inline">Odśwież dane</span>
        </button>
        <p class="text-xs text-slate-400 max-w-3xl leading-relaxed">
          Oficjalne dane IMGW-PIB dla ponad 850 miast i stacji pomiarowych: pomiary synoptyczne i meteorologiczne, stan rzek,
          ostrzeżenia, prognoza modelu COSMO, radar opadów i normy klimatyczne — zestawione z czujnikami Twojego domu.
        </p>
      </app-collapsible-section>

      <!-- 2. PASEK OSTRZEŻEŃ METEO & HYDRO DLA POLSKI / REGIONU -->
      @if (totalWarningsCount() > 0) {
        <div
          class="p-4 rounded-2xl border shadow-lg space-y-2.5 transition-all"
          [class.bg-rose-950/50]="weather.regionWarnings().length > 0 && weather.regionWarnings()[0].stopien === '3'"
          [class.border-rose-600/80]="weather.regionWarnings().length > 0 && weather.regionWarnings()[0].stopien === '3'"
          [class.bg-amber-950/50]="!(weather.regionWarnings().length > 0 && weather.regionWarnings()[0].stopien === '3')"
          [class.border-amber-600/70]="!(weather.regionWarnings().length > 0 && weather.regionWarnings()[0].stopien === '3')"
          [class.text-amber-200]="true"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2.5">
              <mat-icon
                class="text-lg animate-pulse !w-5 !h-5"
                [class.text-rose-400]="weather.regionWarnings().length > 0"
                [class.text-amber-400]="weather.regionWarnings().length === 0"
              >warning</mat-icon>
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs font-bold uppercase tracking-wide text-white">
                  Ostrzeżenia IMGW-PIB (Wykryto: {{ totalWarningsCount() }})
                </span>
                @if (weather.selectedLocation(); as loc) {
                  @if (weather.regionWarnings().length > 0) {
                    <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-900 border border-rose-600 text-rose-200 font-bold">
                      ⚠️ Aktywne dla regionu {{ loc.name }} ({{ weather.regionWarnings().length }})
                    </span>
                  } @else {
                    <span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-700/80 text-emerald-300 font-bold">
                      ✓ Brak zagrożeń dla {{ loc.name }}
                    </span>
                  }
                }
              </div>
            </div>
            <button
              type="button"
              (click)="toggleWarningsExpanded()"
              class="text-xs font-semibold text-amber-300 hover:text-white underline cursor-pointer flex items-center gap-1"
            >
              <span>{{ warningsExpanded() ? 'Zwiń szczegóły' : 'Pokaż szczegóły ostrzeżeń' }}</span>
              <mat-icon class="text-sm !w-4 !h-4">{{ warningsExpanded() ? 'expand_less' : 'expand_more' }}</mat-icon>
            </button>
          </div>

          <div class="text-xs text-amber-300/90 leading-relaxed flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Wykryto {{ weather.meteoWarnings().length }} ostrzeżeń meteorologicznych oraz {{ weather.hydroWarnings().length }} hydrologicznych w bazie IMGW.</span>
            @if (weather.selectedLocation(); as loc) {
              @if (weather.regionWarnings().length > 0) {
                <span class="text-rose-300 font-bold">
                  Dla wybranej lokalizacji {{ loc.name }} (woj. {{ loc.voivodeship }}) obowiązuje {{ weather.regionWarnings().length }} ostrzeżeń!
                </span>
              }
            }
          </div>

          @if (warningsExpanded()) {
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-amber-700/50">
              @for (w of allWarnings(); track $index) {
                <div
                  class="p-3 rounded-xl border space-y-1.5 text-xs transition-all"
                  [class.bg-rose-950/60]="isWarningForCurrentRegion(w)"
                  [class.border-rose-500]="isWarningForCurrentRegion(w)"
                  [class.bg-slate-950/80]="!isWarningForCurrentRegion(w)"
                  [class.border-amber-800/80]="!isWarningForCurrentRegion(w)"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-bold text-white flex items-center gap-1.5 truncate">
                      <mat-icon class="text-xs !w-3.5 !h-3.5" [class.text-rose-400]="w.type === 'hydro'" [class.text-amber-400]="w.type === 'meteo'">
                        {{ w.type === 'hydro' ? 'waves' : 'thunderstorm' }}
                      </mat-icon>
                      <span class="truncate">{{ w.zdarzenie }}</span>
                      @if (isWarningForCurrentRegion(w)) {
                        <span class="text-[9px] font-mono px-1.5 py-0.2 rounded bg-rose-900 border border-rose-600 text-rose-200">
                          TWÓJ REGION
                        </span>
                      }
                    </span>
                    <span class="font-mono text-[10px] px-2 py-0.5 rounded bg-amber-900/60 text-amber-300 border border-amber-700/60 font-semibold shrink-0">
                      @if (w.type === 'hydro' && (w.stopien === '-1' || w.stopien === -1 || w.zdarzenie.toLowerCase().includes('susza'))) {
                        Hydrologiczne (ciągłe)
                      } @else {
                        Stopień {{ w.stopien }}
                      }
                    </span>
                  </div>
                  @if (w.przebieg) {
                    <p class="text-slate-300 text-[11px] leading-relaxed">{{ w.przebieg }}</p>
                  }
                  @if (weather.areasText(w); as areas) {
                    <p class="text-slate-500 text-[10px]">Obszar: {{ areas }}</p>
                  }
                  <div class="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-800 font-mono">
                    <span>Ważne: {{ weather.formatValidity(w.data_od, w.data_do) }}</span>
                    @if (w.prawdopodobienstwo) {
                      <span>Prawdopodobieństwo: {{ w.prawdopodobienstwo }}%</span>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }

      <!-- 3. WYBÓR MIEJSCOWOŚCI, FILTRY WOJEWÓDZTW I ULUBIONE MIEJSCA ⭐ -->
      <app-collapsible-section sectionId="weather.locations" title="Wybór miejscowości" icon="travel_explore" iconClass="text-amber-400"
        subtitle="Ulubione, wyszukiwarka i filtry województw">
      <div class="space-y-4">

        <!-- Górny pasek: Szybkie ulubione (Pinned Towns ⭐) -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <mat-icon class="text-amber-400 text-sm !w-4 !h-4">star</mat-icon>
              <span>Ulubione miejscowości (szybkie przełączanie):</span>
            </span>
            <span class="text-[11px] font-mono text-slate-500">
              Katalog: {{ weather.locations().length }} miejscowości i stacji
            </span>
          </div>

          <div class="flex flex-wrap gap-2">
            @for (fav of weather.favoriteLocations(); track fav.id) {
              <button
                type="button"
                (click)="selectLocation(fav.id)"
                class="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer border shadow-sm"
                [class.bg-cyan-950]="weather.selectedLocationId() === fav.id"
                [class.border-cyan-500]="weather.selectedLocationId() === fav.id"
                [class.text-cyan-200]="weather.selectedLocationId() === fav.id"
                [class.bg-slate-950/80]="weather.selectedLocationId() !== fav.id"
                [class.border-slate-800]="weather.selectedLocationId() !== fav.id"
                [class.text-slate-300]="weather.selectedLocationId() !== fav.id"
                [class.hover:border-slate-700]="weather.selectedLocationId() !== fav.id"
              >
                <mat-icon class="text-xs !w-3.5 !h-3.5 text-amber-400">star</mat-icon>
                <span class="font-bold">{{ fav.name }}</span>
                @if (fav.temp !== null && fav.temp !== undefined) {
                  <span class="font-mono text-[11px] text-cyan-400 font-semibold">{{ fav.temp }}°C</span>
                }
              </button>
            }
            @if (weather.favoriteLocations().length === 0) {
              <span class="text-xs text-slate-500 italic">Brak ulubionych miejsc. Wyszukaj miejscowość poniżej i kliknij gwiazdkę, aby ją przypiąć.</span>
            }
          </div>
        </div>

        <!-- Wyszukiwarka i filtry -->
        <div class="pt-3 border-t border-slate-800/80 space-y-3">
          <div class="grid grid-cols-1 md:grid-cols-12 gap-3">

            <!-- Pole wyszukiwania miejscowości (Input text z autouzupełnianiem) -->
            <div class="md:col-span-5 relative">
              <label for="locationSearchInput" class="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Wyszukaj miejscowość, wieś lub stację:
              </label>
              <div class="relative">
                <mat-icon class="absolute left-3 top-2.5 text-slate-400 text-sm !w-4 !h-4 pointer-events-none">search</mat-icon>
                <input
                  id="locationSearchInput"
                  #searchInput
                  type="text"
                  [value]="weather.searchQuery()"
                  (input)="onSearchInput(searchInput.value)"
                  (keydown.enter)="searchOsm(searchInput.value)"
                  (keydown.escape)="clearSearch(searchInput)"
                  autocomplete="off"
                  placeholder="Wpisz miasto albo wieś i naciśnij Enter, np. Stanisławów"
                  class="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-medium focus:outline-none focus:border-cyan-500 placeholder:text-slate-500"
                />
                @if (weather.searchQuery()) {
                  <button
                    type="button"
                    (click)="clearSearch(searchInput)"
                    class="absolute right-2.5 top-2.5 text-slate-400 hover:text-white cursor-pointer"
                    title="Wyczyść szukanie"
                  >
                    <mat-icon class="text-sm !w-4 !h-4">close</mat-icon>
                  </button>
                }
              </div>

              @if (weather.searchQuery().trim().length >= 2) {
                <!-- Podpowiedzi: katalog IMGW od razu, wsie i adresy z OpenStreetMap po Enter -->
                <div class="absolute z-30 left-0 right-0 mt-1 max-h-96 overflow-y-auto rounded-xl bg-slate-950 border border-slate-700 shadow-2xl text-xs">
                  @for (loc of suggestions(); track loc.id) {
                    <button type="button" (click)="pickLocation(loc.id, searchInput)"
                      class="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-800 cursor-pointer">
                      <span class="min-w-0">
                        <span class="font-bold text-white">{{ loc.name }}</span>
                        <span class="text-slate-400"> · {{ loc.voivodeship }}</span>
                        @if (loc.type !== 'city' && loc.type !== 'place') {
                          <span class="ml-1 text-[10px] font-mono text-slate-500">{{ loc.type === 'synop' ? 'SYNOP' : 'METEO' }}</span>
                        }
                      </span>
                      @if (loc.temp !== null) {
                        <span class="font-mono text-cyan-400 shrink-0">{{ loc.temp }}°C</span>
                      }
                    </button>
                  }
                  <div class="border-t border-slate-800 px-3 py-2 space-y-1">
                    @if (osmLoading()) {
                      <div class="text-slate-400 flex items-center gap-2"><mat-icon class="animate-spin text-sm !w-4 !h-4">progress_activity</mat-icon>Szukam w OpenStreetMap…</div>
                    } @else if (osmResults(); as results) {
                      <div class="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">OpenStreetMap — kliknij, aby zapisać jako swoje miejsce</div>
                      @for (r of results; track r.lat + ',' + r.lon) {
                        <button type="button" (click)="pickPlace(r, searchInput)"
                          class="w-full flex items-start gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-slate-800 cursor-pointer">
                          <mat-icon class="text-sm !w-4 !h-4 text-fuchsia-400 mt-0.5 shrink-0">place</mat-icon>
                          <span class="min-w-0">
                            <span class="font-bold text-white">{{ r.name }}</span>
                            <span class="text-slate-500"> ({{ r.kind }})</span>
                            <span class="block text-slate-400 truncate">{{ r.label }}</span>
                          </span>
                        </button>
                      } @empty {
                        <div class="text-slate-400">Nic nie znaleziono w Polsce. Spróbuj dopisać gminę, np. „Stanisławów, gmina Stanisławów”.</div>
                      }
                    } @else {
                      <button type="button" (click)="searchOsm(searchInput.value)"
                        class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-fuchsia-300 hover:bg-slate-800 cursor-pointer">
                        <mat-icon class="text-sm !w-4 !h-4">travel_explore</mat-icon>
                        Szukaj „{{ weather.searchQuery().trim() }}” w OpenStreetMap (wsie, przysiółki, adresy) — Enter
                      </button>
                    }
                    @if (osmError(); as e) {
                      <div class="text-rose-300">{{ e }}</div>
                    }
                  </div>
                </div>
              }
            </div>

            <!-- Filtr Województwa -->
            <div class="md:col-span-4">
              <label for="voivodeshipSelect" class="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Województwo:
              </label>
              <div class="relative">
                <select
                  id="voivodeshipSelect"
                  [value]="weather.selectedVoivodeship()"
                  (change)="weather.setVoivodeship($any($event.target).value)"
                  class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-semibold focus:outline-none focus:border-cyan-500 cursor-pointer appearance-none pr-8"
                >
                  @for (voiv of weather.voivodeships; track voiv) {
                    <option [value]="voiv">{{ voiv }}</option>
                  }
                </select>
                <mat-icon class="absolute right-2.5 top-2.5 text-slate-400 pointer-events-none text-sm !w-4 !h-4">unfold_more</mat-icon>
              </div>
            </div>

            <!-- Filtr Typu Stacji -->
            <div class="md:col-span-3">
              <label for="typeFilterSelect" class="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                Kategoria:
              </label>
              <div class="relative">
                <select
                  id="typeFilterSelect"
                  [value]="weather.selectedTypeFilter()"
                  (change)="weather.setTypeFilter($any($event.target).value)"
                  class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-semibold focus:outline-none focus:border-cyan-500 cursor-pointer appearance-none pr-8"
                >
                  <option value="all">Wszystkie kategorie</option>
                  <option value="city">Miasta i miejscowości</option>
                  <option value="synop">Główne stacje (SYNOP)</option>
                  <option value="meteo">Lokalne stacje (METEO)</option>
                </select>
                <mat-icon class="absolute right-2.5 top-2.5 text-slate-400 pointer-events-none text-sm !w-4 !h-4">filter_list</mat-icon>
              </div>
            </div>

          </div>

          <!-- Główny selektor wyboru miejscowości / stacji -->
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <div class="w-full sm:flex-1">
              <label for="locationPickerSelect" class="block text-[11px] font-bold uppercase tracking-wider text-cyan-400 mb-1">
                Wybierz miejscowość z listy (Znaleziono: {{ weather.filteredLocations().length }}):
              </label>
              <div class="relative">
                <select
                  id="locationPickerSelect"
                  [value]="weather.selectedLocationId()"
                  (change)="selectLocation($any($event.target).value)"
                  class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-600/70 text-white text-xs font-semibold focus:outline-none focus:border-cyan-400 cursor-pointer appearance-none pr-9 shadow-inner"
                >
                  @if (!selectedInFiltered()) {
                    <option value="" disabled selected>— {{ weather.selectedLocation()?.name ?? 'wybierz' }} (wybierz z {{ weather.filteredLocations().length }} wyników) —</option>
                  }
                  @for (loc of weather.filteredLocations(); track loc.id) {
                    <option [value]="loc.id">
                      {{ loc.name }} ({{ loc.voivodeship }}) — {{ loc.temp !== null ? loc.temp + '°C' : '--' }} [{{ loc.type === 'city' ? 'MIASTO' : loc.type === 'synop' ? 'SYNOP' : loc.type === 'place' ? 'MOJE MIEJSCE' : 'METEO' }}]
                    </option>
                  }
                </select>
                <mat-icon class="absolute right-3 top-3 text-cyan-400 pointer-events-none text-sm !w-4 !h-4">location_city</mat-icon>
              </div>
            </div>

            <!-- Przycisk Ulubione ⭐ dla aktualnie wybranej miejscowości -->
            @if (weather.selectedLocation(); as curLoc) {
              <div class="self-end sm:self-center shrink-0">
                <button
                  type="button"
                  (click)="weather.toggleFavoriteLocation(curLoc.id)"
                  class="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer"
                  [class.bg-amber-950/60]="weather.isFavoriteLocation(curLoc.id)"
                  [class.border-amber-600]="weather.isFavoriteLocation(curLoc.id)"
                  [class.text-amber-300]="weather.isFavoriteLocation(curLoc.id)"
                  [class.bg-slate-950]="!weather.isFavoriteLocation(curLoc.id)"
                  [class.border-slate-800]="!weather.isFavoriteLocation(curLoc.id)"
                  [class.text-slate-400]="!weather.isFavoriteLocation(curLoc.id)"
                  [class.hover:text-white]="!weather.isFavoriteLocation(curLoc.id)"
                >
                  <mat-icon class="text-sm !w-4 !h-4" [class.text-amber-400]="weather.isFavoriteLocation(curLoc.id)">
                    {{ weather.isFavoriteLocation(curLoc.id) ? 'star' : 'star_border' }}
                  </mat-icon>
                  <span>{{ weather.isFavoriteLocation(curLoc.id) ? 'W ulubionych' : 'Dodaj do ulubionych' }}</span>
                </button>
              </div>
              @if (curLoc.type === 'place') {
                <div class="self-end sm:self-center shrink-0">
                  <button type="button" (click)="removePlace(curLoc)"
                    class="flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-rose-800 bg-rose-950/50 text-rose-300 text-xs font-semibold hover:bg-rose-900/60 cursor-pointer">
                    <mat-icon class="text-sm !w-4 !h-4">delete</mat-icon>
                    <span>Usuń miejsce</span>
                  </button>
                </div>
              }
            }
          </div>

          <!-- Szybkie chipy popularnych miast w Polsce -->
          <div class="flex items-center gap-1.5 flex-wrap pt-2">
            <span class="text-[10px] font-mono uppercase text-slate-500 mr-1">Popularne:</span>
            @for (city of popularCities; track city.id) {
              <button
                type="button"
                (click)="selectLocation(city.id)"
                class="px-2 py-0.5 rounded-lg bg-slate-950 hover:bg-slate-800 text-[11px] text-slate-300 hover:text-white border border-slate-800 transition-colors cursor-pointer"
              >
                {{ city.name }}
              </button>
            }
          </div>

        </div>

      </div>
      </app-collapsible-section>

      <!-- 4. GŁÓWNA KARTA AKTUALNYCH DANYCH POGODOWYCH DLA WYBRANEJ MIEJSCOWOŚCI -->
      @if (weather.selectedLocation(); as loc) {
        <app-collapsible-section sectionId="weather.current" title="Aktualne pomiary" icon="thermostat" iconClass="text-amber-400"
          [subtitle]="loc.name + (loc.measurementTime ? ' · ' + loc.measurementTime : '')">
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">

          <!-- 1. Temperatura powietrza -->
          <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800 relative overflow-hidden shadow-md group hover:border-cyan-500/50 transition-all">
            <div class="flex items-center justify-between text-slate-400 mb-1">
              <span class="text-[11px] uppercase tracking-wider font-semibold">Temperatura</span>
              <mat-icon class="text-base text-amber-400 !w-4 !h-4">thermostat</mat-icon>
            </div>
            <div class="text-2xl font-black text-white tracking-tight flex items-baseline gap-1">
              <span>{{ loc.temp !== null ? loc.temp : '--' }}</span>
              <span class="text-xs font-normal text-slate-400">°C</span>
            </div>
            <div class="text-[10px] text-slate-400 mt-1 truncate">
              {{ loc.sourceDesc }}
            </div>
          </div>

          <!-- 2. Wilgotność względna -->
          <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800 relative overflow-hidden shadow-md group hover:border-cyan-500/50 transition-all">
            <div class="flex items-center justify-between text-slate-400 mb-1">
              <span class="text-[11px] uppercase tracking-wider font-semibold">Wilgotność</span>
              <mat-icon class="text-base text-blue-400 !w-4 !h-4">water_drop</mat-icon>
            </div>
            <div class="text-2xl font-black text-white tracking-tight flex items-baseline gap-1">
              <span>{{ loc.humidity !== null ? loc.humidity : '--' }}</span>
              <span class="text-xs font-normal text-slate-400">%</span>
            </div>
            <div class="text-[10px] text-slate-400 mt-1">
              {{ getHumidityDescription(loc.humidity) }}
            </div>
          </div>

          <!-- 3. Ciśnienie atmosferyczne -->
          <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800 relative overflow-hidden shadow-md group hover:border-cyan-500/50 transition-all">
            <div class="flex items-center justify-between text-slate-400 mb-1">
              <span class="text-[11px] uppercase tracking-wider font-semibold">Ciśnienie</span>
              <mat-icon class="text-base text-indigo-400 !w-4 !h-4">speed</mat-icon>
            </div>
            <div class="text-2xl font-black text-white tracking-tight flex items-baseline gap-1">
              <span>{{ loc.pressure !== null ? loc.pressure : '--' }}</span>
              <span class="text-xs font-normal text-slate-400">hPa</span>
            </div>
            <div class="text-[10px] text-slate-400 mt-1 truncate">
              Zredukowane (stacja: {{ loc.synopStationName || 'IMGW' }})
            </div>
          </div>

          <!-- 4. Wiatr i porywy -->
          <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800 relative overflow-hidden shadow-md group hover:border-cyan-500/50 transition-all">
            <div class="flex items-center justify-between text-slate-400 mb-1">
              <span class="text-[11px] uppercase tracking-wider font-semibold">Prędkość wiatru</span>
              <mat-icon class="text-base text-teal-400 !w-4 !h-4">air</mat-icon>
            </div>
            <div class="text-2xl font-black text-white tracking-tight flex items-baseline gap-1">
              <span>{{ loc.windSpeed !== null ? loc.windSpeed : '--' }}</span>
              <span class="text-xs font-normal text-slate-400">m/s</span>
            </div>
            <div class="text-[10px] text-slate-400 mt-1 truncate">
              @if (loc.windGust) {
                <span>Porywy: {{ loc.windGust }} m/s</span>
              } @else if (loc.windSpeed) {
                <span>{{ getWindSpeedKmh(loc.windSpeed) }} km/h</span>
              } @else {
                <span>Wiatr umiarkowany</span>
              }
            </div>
          </div>

          <!-- 5. Suma opadów -->
          <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800 relative overflow-hidden shadow-md group hover:border-cyan-500/50 transition-all">
            <div class="flex items-center justify-between text-slate-400 mb-1">
              <span class="text-[11px] uppercase tracking-wider font-semibold">Suma opadu</span>
              <mat-icon class="text-base text-cyan-400 !w-4 !h-4">rainy</mat-icon>
            </div>
            <div class="text-2xl font-black text-white tracking-tight flex items-baseline gap-1">
              <span>{{ loc.rain !== null ? loc.rain : '0' }}</span>
              <span class="text-xs font-normal text-slate-400">mm</span>
            </div>
            <div class="text-[10px] text-slate-400 mt-1 truncate">
              {{ hasRain(loc.rain) ? 'Opady deszczu/śniegu' : 'Brak opadów w stacji' }}
            </div>
          </div>

          <!-- 6. Temperatura gruntu / czas pomiaru -->
          <div class="p-4 rounded-2xl bg-slate-900 border border-slate-800 relative overflow-hidden shadow-md group hover:border-cyan-500/50 transition-all">
            <div class="flex items-center justify-between text-slate-400 mb-1">
              <span class="text-[11px] uppercase tracking-wider font-semibold">Przy gruncie</span>
              <mat-icon class="text-base text-emerald-400 !w-4 !h-4">grass</mat-icon>
            </div>
            <div class="text-2xl font-black text-white tracking-tight flex items-baseline gap-1">
              @if (loc.groundTemp !== null && loc.groundTemp !== undefined) {
                <span>{{ loc.groundTemp }}</span>
                <span class="text-xs font-normal text-slate-400">°C</span>
              } @else {
                <span class="text-lg text-slate-300 font-bold">Lokalnie</span>
              }
            </div>
            <div class="text-[10px] text-slate-400 mt-1 truncate">
              {{ loc.measurementTime ? 'Pomiar: ' + loc.measurementTime : 'Aktualizacja na żywo' }}
            </div>
          </div>

        </div>
        </app-collapsible-section>
      }

      <!-- 5. PORÓWNANIE Z WYBRANYM CZUJNIKIEM DOMOWYM (DELTA TEMPERATURY) ⚖️ -->
      <app-collapsible-section sectionId="weather.compare" title="Porównanie z czujnikiem domowym" icon="compare_arrows" iconClass="text-indigo-400"
        subtitle="Różnica temperatur między czujnikiem w domu a stacją IMGW">
      <div class="space-y-4">
        <div class="flex flex-col md:flex-row md:items-center justify-end gap-4">
          <!-- Selektor domowego czujnika temperatury -->
          <div class="flex items-center gap-2 w-full md:w-auto">
            <label for="comparisonSensorSelect" class="text-xs font-semibold text-slate-300 shrink-0">Wybierz czujnik:</label>
            <div class="relative w-full md:w-64">
              <select
                id="comparisonSensorSelect"
                [value]="weather.comparisonSensorIeee() || ''"
                (change)="weather.setComparisonSensor($any($event.target).value)"
                class="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs font-semibold focus:outline-none focus:border-cyan-500 cursor-pointer appearance-none pr-8"
              >
                @for (d of weather.temperatureSensors(); track d.ieee_address) {
                  <option [value]="d.ieee_address">
                    {{ d.friendly_name || d.ieee_address }} ({{ d.last_temperature }}°C)
                  </option>
                }
              </select>
              <mat-icon class="absolute right-2.5 top-2.5 text-slate-400 pointer-events-none text-sm !w-4 !h-4">sensors</mat-icon>
            </div>
          </div>
        </div>

        <!-- Wynik porównania: Karta Delty -->
        @if (weather.deltaInfo(); as delta) {
          <div class="p-4 rounded-xl bg-slate-950/80 border border-slate-800 grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
            
            <div class="md:col-span-4 flex items-center gap-3">
              <div
                class="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg shrink-0 border"
                [class.bg-rose-950]="delta.status === 'warmer'"
                [class.border-rose-700]="delta.status === 'warmer'"
                [class.text-rose-400]="delta.status === 'warmer'"
                [class.bg-sky-950]="delta.status === 'cooler'"
                [class.border-sky-700]="delta.status === 'cooler'"
                [class.text-sky-400]="delta.status === 'cooler'"
                [class.bg-emerald-950]="delta.status === 'equal'"
                [class.border-emerald-700]="delta.status === 'equal'"
                [class.text-emerald-400]="delta.status === 'equal'"
              >
                <mat-icon class="text-2xl">
                  {{ delta.status === 'warmer' ? 'arrow_upward' : (delta.status === 'cooler' ? 'arrow_downward' : 'drag_handle') }}
                </mat-icon>
              </div>
              <div>
                <div class="text-[11px] font-mono uppercase text-slate-400 font-bold">Delta Temperatury</div>
                <div class="text-2xl font-black text-white tracking-tight">
                  <span
                    [class.text-rose-400]="delta.status === 'warmer'"
                    [class.text-sky-400]="delta.status === 'cooler'"
                    [class.text-emerald-400]="delta.status === 'equal'"
                  >
                    {{ delta.deltaFormatted }}
                  </span>
                </div>
              </div>
            </div>

            <div class="md:col-span-8 flex flex-col justify-center space-y-1">
              <p class="text-xs text-slate-200 leading-relaxed font-medium">
                {{ delta.interpretation }}
              </p>
              <div class="flex items-center gap-4 text-[11px] text-slate-400 font-mono">
                <span>Czujnik domowy: <strong class="text-white">{{ delta.sensorTemp }}°C</strong></span>
                <span>Zewnątrz ({{ delta.locationName }}): <strong class="text-cyan-400">{{ delta.synopTemp }}°C</strong></span>
                @if (delta.deltaHum !== null) {
                  <span>Delta wilgotności: <strong class="text-blue-300">{{ delta.deltaHum > 0 ? '+' : '' }}{{ delta.deltaHum }}%</strong></span>
                }
              </div>
            </div>

          </div>
        }
      </div>
      </app-collapsible-section>

      <!-- 6. WYKRES GODZINOWY TEMPERATURY (CHART.JS) 📈 -->
      <app-collapsible-section sectionId="weather.hourly" title="Przebieg temperatury (24 h)" icon="show_chart" iconClass="text-cyan-400"
        [subtitle]="(weather.selectedLocation()?.name ?? '') + ' · pomiary synoptyczne'">
        <button section-actions
          type="button"
          (click)="toggleOverlaySensorChart()"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer"
          [class.bg-amber-950/60]="showSensorOnChart()"
          [class.border-amber-600]="showSensorOnChart()"
          [class.text-amber-300]="showSensorOnChart()"
          [class.bg-slate-950]="!showSensorOnChart()"
          [class.border-slate-800]="!showSensorOnChart()"
          [class.text-slate-400]="!showSensorOnChart()"
          title="Nałóż krzywą z czujnika domowego"
        >
          <mat-icon class="text-sm !w-4 !h-4">{{ showSensorOnChart() ? 'check_box' : 'check_box_outline_blank' }}</mat-icon>
          <span class="hidden sm:inline">Czujnik domowy</span>
        </button>
        <div class="relative h-72 w-full rounded-xl bg-slate-950/60 p-3 border border-slate-800/80">
          <canvas #hourlyWeatherChart class="w-full h-full"></canvas>
        </div>
      </app-collapsible-section>

      <!-- 7. MONITORING HYDROLOGICZNY (STAN RZEK W REGIONIE) 🌊 -->
      <app-collapsible-section sectionId="weather.hydro" title="Stan rzek (IMGW Hydro)" icon="waves" iconClass="text-blue-400"
        subtitle="Poziom wód, stany ostrzegawcze i alarmowe">
      <div class="space-y-4">
        <div class="flex justify-end">
          <!-- Wyszukiwarka stacji hydro -->
          <div class="relative w-full sm:w-64">
            <mat-icon class="absolute left-3 top-2.5 text-slate-400 text-sm !w-4 !h-4">search</mat-icon>
            <input
              #hydroInput
              type="text"
              [value]="weather.hydroSearch()"
              (input)="weather.loadHydroStations(hydroInput.value)"
              placeholder="Filtruj rzekę lub stację hydro..."
              class="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-700 text-white text-xs focus:outline-none focus:border-blue-500 placeholder:text-slate-500"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 max-h-80 overflow-y-auto pr-1">
          @for (h of weather.hydroStations(); track h.id_stacji) {
            <div class="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2 text-xs">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <div class="font-bold text-white">{{ h.stacja }}</div>
                  <div class="text-[11px] text-blue-400 font-semibold">Rzeka: {{ h.rzeka }}</div>
                </div>
                <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                  {{ h.wojewodztwo || 'Polska' }}
                </span>
              </div>

              <div class="pt-1 border-t border-slate-800/80 flex items-center justify-between">
                <div>
                  <div class="text-[10px] text-slate-400">Aktualny stan:</div>
                  <div class="text-base font-black text-white">
                    {{ h.stan_wody !== null ? h.stan_wody : '--' }} <span class="text-xs font-normal text-slate-400">cm</span>
                  </div>
                </div>
                <div class="text-right">
                  <div class="text-[10px] text-slate-400">Status rzeki:</div>
                  <div class="text-[11px] font-bold" [class]="getWaterStatusClass(h)">
                    {{ getWaterStatusLabel(h) }}
                  </div>
                </div>
              </div>

              <!-- Pasek poziomu względem stanów ostrzegawczych -->
              <div class="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  [class]="getWaterBarClass(h)"
                  [style.width.%]="calcWaterPercentage(h)"
                ></div>
              </div>

              <div class="flex items-center justify-between text-[10px] text-slate-500 pt-0.5 font-mono">
                <span>Ostrz: {{ h.stan_ostrzegawczy || '--' }} cm</span>
                <span>Alarm: {{ h.stan_alarmowy || '--' }} cm</span>
              </div>
            </div>
          }
          @if (weather.hydroStations().length === 0) {
            <div class="col-span-full p-4 rounded-xl bg-slate-950 text-slate-500 text-center text-xs">
              Brak stacji hydrologicznych pasujących do filtra.
            </div>
          }
        </div>
      </div>
      </app-collapsible-section>

      <!-- 8–11. PROGNOZA COSMO, RADAR, NORMY KLIMATYCZNE, MAPA STACJI -->
      <app-weather-extras />

    </div>
  `,
})
export class WeatherView implements OnDestroy {
  readonly weather = inject(Weather);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly chartCanvas = viewChild<ElementRef<HTMLCanvasElement>>('hourlyWeatherChart');
  private chartInstance: Chart | null = null;

  readonly warningsExpanded = signal<boolean>(false);
  readonly osmResults = signal<GeocodeResult[] | null>(null);
  readonly osmLoading = signal(false);
  readonly osmError = signal<string | null>(null);
  /** Najlepsze dopasowania z katalogu: najpierw nazwy zaczynające się od wpisanego tekstu. */
  readonly suggestions = computed(() => {
    const q = this.weather.searchQuery().trim().toLowerCase();
    const list = this.weather.filteredLocations();
    const starts = list.filter((l) => l.name.toLowerCase().startsWith(q));
    const rest = list.filter((l) => !l.name.toLowerCase().startsWith(q));
    return [...starts, ...rest].slice(0, 8);
  });
  readonly selectedInFiltered = computed(() => this.weather.filteredLocations().some((l) => l.id === this.weather.selectedLocationId()));
  readonly headerSubtitle = computed(() => {
    const loc = this.weather.selectedLocation();
    return loc ? `${loc.name} · woj. ${loc.voivodeship}` : 'Instytut Meteorologii i Gospodarki Wodnej';
  });
  readonly showSensorOnChart = signal<boolean>(true);

  // Popularne miejscowości w Polsce dla szybkiego wyboru
  readonly popularCities = [
    { id: 'city_warszawa', name: 'Warszawa' },
    { id: 'city_krakow', name: 'Kraków' },
    { id: 'city_wroclaw', name: 'Wrocław' },
    { id: 'city_poznan', name: 'Poznań' },
    { id: 'city_gdansk', name: 'Gdańsk' },
    { id: 'city_katowice', name: 'Katowice' },
    { id: 'city_lodz', name: 'Łódź' },
    { id: 'city_lublin', name: 'Lublin' },
    { id: 'city_szczecin', name: 'Szczecin' },
    { id: 'city_radom', name: 'Radom' },
    { id: 'city_czestochowa', name: 'Częstochowa' },
    { id: 'city_gdynia', name: 'Gdynia' },
    { id: 'city_bydgoszcz', name: 'Bydgoszcz' },
    { id: 'city_bialystok', name: 'Białystok' },
    { id: 'city_rzeszow', name: 'Rzeszów' },
    { id: 'city_torun', name: 'Toruń' },
    { id: 'city_kielce', name: 'Kielce' },
    { id: 'city_siedlce', name: 'Siedlce' },
    { id: 'city_piaseczno', name: 'Piaseczno' },
    { id: 'city_zakopane', name: 'Zakopane' },
  ];

  readonly totalWarningsCount = computed<number>(() => {
    return this.weather.meteoWarnings().length + this.weather.hydroWarnings().length;
  });

  readonly allWarnings = computed<ImgwWarning[]>(() => {
    // Najpierw ostrzeżenia dla wybranego województwa
    const all = [...this.weather.meteoWarnings(), ...this.weather.hydroWarnings()];
    return [...all.filter((w) => this.isWarningForCurrentRegion(w)), ...all.filter((w) => !this.isWarningForCurrentRegion(w))];
  });

  isWarningForCurrentRegion(w: ImgwWarning): boolean {
    const loc = this.weather.selectedLocation();
    return !!loc && warningInVoivodeship(w, loc.voivodeship);
  }

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      Chart.register(...registerables);
    }

    // Automatyczna aktualizacja wykresu Chart.js przy zmianie historii lub czujnika
    effect(() => {
      const history = this.weather.stationHistory();
      const canvasEl = this.chartCanvas()?.nativeElement;
      const showSensor = this.showSensorOnChart();
      const delta = this.weather.deltaInfo();

      if (canvasEl && Array.isArray(history) && history.length > 0 && isPlatformBrowser(this.platformId)) {
        this.renderWeatherChart(canvasEl, history, showSensor, delta.sensorTemp);
      }
    });
  }

  ngOnDestroy(): void {
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }
  }

  onSearchInput(val: string): void {
    this.weather.setSearchQuery(val);
    this.osmResults.set(null);
    this.osmError.set(null);
  }

  clearSearch(inputEl: HTMLInputElement): void {
    inputEl.value = '';
    this.weather.setSearchQuery('');
    this.osmResults.set(null);
    this.osmError.set(null);
  }

  pickLocation(id: string, inputEl: HTMLInputElement): void {
    this.weather.selectLocation(id);
    this.clearSearch(inputEl);
  }

  async searchOsm(q: string): Promise<void> {
    const query = q.trim();
    if (query.length < 2 || this.osmLoading()) return;
    this.osmLoading.set(true);
    this.osmError.set(null);
    try {
      this.osmResults.set(await this.weather.searchPlaces(query));
    } catch {
      this.osmError.set('Wyszukiwarka OpenStreetMap nie odpowiada — spróbuj za chwilę.');
    } finally {
      this.osmLoading.set(false);
    }
  }

  async pickPlace(r: GeocodeResult, inputEl: HTMLInputElement): Promise<void> {
    try {
      await this.weather.addPlace(r);
      this.clearSearch(inputEl);
    } catch {
      this.osmError.set('Nie udało się zapisać miejsca.');
    }
  }

  async removePlace(loc: WeatherLocation): Promise<void> {
    if (!confirm(`Usunąć „${loc.name}” z zapisanych miejsc?`)) return;
    await this.weather.removePlace(loc.id);
  }

  selectLocation(locId: string): void {
    this.weather.selectLocation(locId);
  }

  refreshData(): void {
    this.weather.loadLocations(false);
    this.weather.loadLocationDetails(this.weather.selectedLocationId());
    this.weather.loadWarnings();
    this.weather.loadHydroStations();
  }

  toggleWarningsExpanded(): void {
    this.warningsExpanded.update((v) => !v);
  }

  toggleOverlaySensorChart(): void {
    this.showSensorOnChart.update((v) => !v);
  }

  getHumidityDescription(hum: number | null): string {
    if (hum === null || hum === undefined) return 'Brak odczytu';
    const val = Number(hum);
    if (val > 75) return 'Wysoka (wilgotno)';
    if (val < 40) return 'Niska (suche powietrze)';
    return 'Optymalna wilgotność';
  }

  getWindSpeedKmh(wind: number | null): string {
    if (wind === null || wind === undefined) return '0.0';
    return (Number(wind) * 3.6).toFixed(1);
  }

  hasRain(rain: number | null): boolean {
    return rain !== null && rain !== undefined && Number(rain) > 0;
  }

  getWaterStatusLabel(h: ImgwHydroStation): string {
    const cur = Number(h.stan_wody);
    const warn = Number(h.stan_ostrzegawczy);
    const alert = Number(h.stan_alarmowy);

    if (alert && cur >= alert) return 'STAN ALARMOWY!';
    if (warn && cur >= warn) return 'STAN OSTRZEGAWCZY';
    return 'W normie';
  }

  getWaterStatusClass(h: ImgwHydroStation): string {
    const cur = Number(h.stan_wody);
    const warn = Number(h.stan_ostrzegawczy);
    const alert = Number(h.stan_alarmowy);

    if (alert && cur >= alert) return 'text-rose-400 font-extrabold animate-pulse';
    if (warn && cur >= warn) return 'text-amber-400 font-bold';
    return 'text-emerald-400';
  }

  getWaterBarClass(h: ImgwHydroStation): string {
    const cur = Number(h.stan_wody);
    const warn = Number(h.stan_ostrzegawczy);
    const alert = Number(h.stan_alarmowy);

    if (alert && cur >= alert) return 'bg-rose-500';
    if (warn && cur >= warn) return 'bg-amber-500';
    return 'bg-blue-500';
  }

  calcWaterPercentage(h: ImgwHydroStation): number {
    const cur = Number(h.stan_wody) || 0;
    const max = Number(h.stan_alarmowy) || Number(h.stan_ostrzegawczy) || Math.max(cur, 300);
    return Math.min(100, Math.max(10, Math.round((cur / max) * 100)));
  }

  private renderWeatherChart(
    canvas: HTMLCanvasElement,
    history: ImgwHourlyPoint[],
    showSensor: boolean,
    sensorTemp?: number | null,
  ): void {
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }

    const labels = history.map((h) => h.time_label);
    const locName = this.weather.selectedLocation()?.name || 'Stacja IMGW';
    const synopData = history.map((h) => h.temperatura);

    const datasets: ChartDataset<'line'>[] = [
      {
        label: `Zewnątrz: ${locName} (°C)`,
        data: synopData,
        borderColor: '#06b6d4', // cyan-500
        backgroundColor: 'rgba(6, 182, 212, 0.12)',
        borderWidth: 2.5,
        tension: 0.35,
        fill: true,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: '#06b6d4',
      },
    ];

    if (showSensor && sensorTemp !== null && sensorTemp !== undefined) {
      const sensorVal = Math.round(Number(sensorTemp) * 10) / 10;
      const sensorData = history.map(() => sensorVal);

      const sensorName = this.weather.selectedSensor()?.friendly_name || 'Czujnik domowy';
      datasets.push({
        label: `Dom: ${sensorName} (°C)`,
        data: sensorData,
        borderColor: '#f59e0b', // amber-500
        backgroundColor: 'rgba(245, 158, 11, 0.08)',
        borderWidth: 2,
        borderDash: [5, 4],
        tension: 0.3,
        fill: false,
        pointRadius: 2.5,
        pointHoverRadius: 5,
        pointBackgroundColor: '#f59e0b',
      });
    }

    this.chartInstance = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index',
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            labels: {
              color: '#cbd5e1',
              font: { size: 12, weight: 600 },
              usePointStyle: true,
              boxWidth: 8,
            },
          },
          tooltip: {
            backgroundColor: '#0f172a',
            borderColor: '#334155',
            borderWidth: 1,
            titleColor: '#f8fafc',
            bodyColor: '#e2e8f0',
            padding: 10,
            boxPadding: 4,
            callbacks: {
              label: (context) => {
                return ` ${context.dataset.label}: ${context.parsed.y}°C`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: 'rgba(51, 65, 85, 0.35)' },
            ticks: { color: '#94a3b8', font: { size: 11 } },
          },
          y: {
            grid: { color: 'rgba(51, 65, 85, 0.35)' },
            ticks: {
              color: '#94a3b8',
              font: { size: 11 },
              callback: (val) => `${val}°C`,
            },
          },
        },
      },
    });
  }
}
