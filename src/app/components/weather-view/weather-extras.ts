import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import { Chart, registerables } from 'chart.js';
import type * as Leaflet from 'leaflet';
import { Weather } from '../../services/weather';
import { CollapsibleSection } from '../collapsible-section/collapsible-section';

interface GeoPoint {
  lat: number;
  lon: number;
  source: string;
}

interface ForecastStep {
  time: string;
  temp: number | null;
  dewPoint: number | null;
  humidity: number | null;
  wind: number | null;
  windDir: number | null;
  gust: number | null;
  pressure: number | null;
  cloud: number | null;
  precip: number | null;
  snow: number | null;
}

interface ForecastResponse {
  location: string;
  coords: GeoPoint | null;
  forecast: { run: string; model: string; steps: ForecastStep[]; approxKm: number | null } | null;
  status: { run: string | null; generatedAt: string | null; busy: boolean; progress: string | null; error: string | null };
}

interface RadarResponse {
  frames: { stamp: string; time: string }[];
  coords: GeoPoint | null;
  rain: {
    time: string;
    covered: boolean;
    dbz: number | null;
    rate: number | null;
    maxDbz10km: number | null;
    nearestKm: number | null;
    nearestBearing: number | null;
    nearestKm30minAgo: number | null;
    trend: 'approaching' | 'receding' | 'steady' | null;
  } | null;
}

interface MonthNormal {
  month: number;
  temp: number | null;
  tempMax: number | null;
  tempMin: number | null;
  precip: number | null;
  sunshine: number | null;
  snowDays: number | null;
  recordMax: { value: number; year: number } | null;
  recordMin: { value: number; year: number } | null;
  recordPrecip: { value: number; year: number } | null;
  years: number;
}

interface ClimateResponse {
  location: string;
  station: {
    code: string;
    name: string;
    firstYear: number;
    lastYear: number;
    months: MonthNormal[];
    recent: { year: number; month: number; temp: number | null; precip: number | null }[];
  } | null;
  distanceKm?: number | null;
  status: { generatedAt: string | null; stations: number; busy: boolean; error: string | null };
}

interface MapResponse {
  home: { name: string; coords: GeoPoint | null } | null;
  hydro: { id: string; name: string; river: string; lat: number; lon: number; level: number | null; warning: number | null; alarm: number | null; flow: number | null; time: string | null }[];
  meteo: { code: string; name: string; lat: number; lon: number; temp: number | null; wind: number | null; rain10: number | null }[];
}

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const MONTHS_LOC = ['styczniu', 'lutym', 'marcu', 'kwietniu', 'maju', 'czerwcu', 'lipcu', 'sierpniu', 'wrześniu', 'październiku', 'listopadzie', 'grudniu'];
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const COMPASS_FROM = ['północy', 'północnego wschodu', 'wschodu', 'południowego wschodu', 'południa', 'południowego zachodu', 'zachodu', 'północnego zachodu'];
const RADAR_REFRESH_MS = 5 * 60_000;
/** Mapa IMGW ma 1178×900 px, z czego lewe 900×900 to siatka radaru (1 km/px, odwzorowanie azymutalne). */
const RADAR_IMG_W = 1178;
const RADAR_IMG_H = 900;

function radarPixel(lat: number, lon: number): { x: number; y: number } {
  const rad = Math.PI / 180;
  const la0 = 52.3469 * rad;
  const lo0 = 19.0926 * rad;
  const la = lat * rad;
  const lo = lon * rad;
  const cosc = Math.sin(la0) * Math.sin(la) + Math.cos(la0) * Math.cos(la) * Math.cos(lo - lo0);
  const c = Math.acos(Math.max(-1, Math.min(1, cosc)));
  const k = c === 0 ? 1 : c / Math.sin(c);
  const R = 6370997;
  const x = R * k * Math.cos(la) * Math.sin(lo - lo0);
  const y = R * k * (Math.cos(la0) * Math.sin(la) - Math.sin(la0) * Math.cos(la) * Math.cos(lo - lo0));
  return { x: 450 + x / 1000, y: 450 - y / 1000 };
}

/** Prognoza, radar, normy klimatyczne i mapa stacji dla miejscowości wybranej w zakładce pogody. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-weather-extras',
  imports: [MatIconModule, CollapsibleSection],
  template: `
    <div class="space-y-6">
      <!-- 8. PROGNOZA COSMO -->
      <app-collapsible-section sectionId="weather.forecast" title="Prognoza IMGW (model COSMO 2,8 km)" icon="insights" iconClass="text-violet-400"
        [subtitle]="forecastSubtitle()" (toggled)="$event && redrawForecast()">
        @if (forecast(); as f) {
          @if (f.forecast && f.forecast.steps.length) {
            <div class="space-y-4">
              <div class="relative h-56 w-full rounded-xl bg-slate-950/60 p-3 border border-slate-800/80">
                <canvas #forecastChart class="w-full h-full"></canvas>
              </div>
              <div class="flex gap-2 overflow-x-auto pb-2">
                @for (s of f.forecast.steps; track s.time) {
                  <div class="shrink-0 w-24 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-center space-y-1">
                    <div class="text-[10px] font-mono text-slate-400">{{ dayLabel(s.time) }}</div>
                    <div class="text-xs font-bold text-white">{{ hourLabel(s.time) }}</div>
                    <mat-icon class="!w-6 !h-6 text-2xl" [class]="stepIcon(s).cls">{{ stepIcon(s).icon }}</mat-icon>
                    <div class="text-base font-black text-white">{{ s.temp ?? '--' }}°</div>
                    <div class="text-[10px] text-slate-400 flex items-center justify-center gap-0.5" [title]="'Wiatr z ' + compassFrom(s.windDir)">
                      @if (s.windDir !== null) {
                        <mat-icon class="!w-3 !h-3 text-xs text-slate-300" [style.transform]="'rotate(' + (s.windDir + 180) + 'deg)'">navigation</mat-icon>
                      }
                      {{ kmh(s.wind) }}
                      @if (s.gust !== null && s.gust > (s.wind ?? 0) + 3) {
                        <span class="text-amber-300">/{{ kmh(s.gust) }}</span>
                      }
                      <span>km/h</span>
                    </div>
                    <div class="text-[10px] font-mono" [class.text-sky-300]="(s.precip ?? 0) >= 0.1" [class.text-slate-600]="(s.precip ?? 0) < 0.1">
                      {{ (s.precip ?? 0) >= 0.1 ? s.precip + ' mm' : 'bez opadu' }}
                    </div>
                  </div>
                }
              </div>
              <p class="text-[11px] text-slate-500">
                Przebieg modelu {{ runLabel(f.forecast.run) }} UTC · punkt: {{ f.coords?.source }}
                @if (f.forecast.approxKm !== null) {
                  <span class="text-amber-300">(na razie z punktu oddalonego o {{ f.forecast.approxKm }} km — dokładna prognoza dla tego miejsca pobiera się w tle)</span>
                }
                · kroki co 3 h, opad to suma z 3 h, wiatr średni / porywy.
                IMGW publikuje przebiegi z opóźnieniem, więc prognoza sięga ok. 1–1,5 doby do przodu.
              </p>
            </div>
          } @else if (f.status.busy) {
            <div class="text-sm text-slate-400 flex items-center gap-2"><mat-icon class="animate-spin">progress_activity</mat-icon>{{ f.status.progress || 'Pobieranie prognozy z IMGW…' }}</div>
          } @else if (!f.coords) {
            <div class="text-sm text-slate-400">Nie znam współrzędnych tej miejscowości — wybierz miejscowość ze stacją meteo IMGW.</div>
          } @else {
            <div class="text-sm text-slate-400">
              {{ f.status.error || 'Prognoza jeszcze się nie pobrała — serwer sprawdza nowe przebiegi modelu co godzinę.' }}
            </div>
          }
        } @else {
          <div class="text-sm text-slate-500">Wybierz miejscowość.</div>
        }
      </app-collapsible-section>

      <!-- 9. RADAR OPADÓW -->
      <app-collapsible-section sectionId="weather.radar" title="Radar opadów IMGW (POLRAD)" icon="radar" iconClass="text-emerald-400"
        [subtitle]="radarSubtitle()" (toggled)="radarOpen.set($event)">
        <button section-actions type="button" (click)="toggleRadarPlay()" [disabled]="frames().length < 2"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 cursor-pointer disabled:opacity-40">
          <mat-icon class="text-sm !w-4 !h-4">{{ radarPlaying() ? 'pause' : 'play_arrow' }}</mat-icon>
          <span class="hidden sm:inline">{{ radarPlaying() ? 'Pauza' : 'Animacja 1 h' }}</span>
        </button>
        @if (radar(); as r) {
          @if (radarStaleSince(); as since) {
            <div class="mb-3 px-3 py-2 rounded-xl bg-amber-950/60 border border-amber-700 text-amber-200 text-xs flex items-center gap-2">
              <mat-icon class="text-sm !w-4 !h-4">schedule</mat-icon>
              IMGW nie publikuje nowych obrazów radarowych od {{ since }} — pokazuję ostatnie dostępne.
            </div>
          }
          <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div class="lg:col-span-2 space-y-2">
              @if (frameUrl(); as url) {
                <div class="relative w-full rounded-xl overflow-hidden border border-slate-800 bg-slate-950" [style.aspect-ratio]="'1178 / 900'">
                  <img [src]="url" alt="Mapa radarowa IMGW" class="absolute inset-0 w-full h-full" />
                  @if (homeMarker(); as m) {
                    <div class="absolute w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-full bg-fuchsia-500 border-2 border-white shadow-lg animate-pulse"
                      [style.left.%]="m.left" [style.top.%]="m.top" [title]="r.coords?.source ?? ''"></div>
                  }
                </div>
                <div class="flex items-center gap-3">
                  <input type="range" min="0" [max]="frames().length - 1" [value]="frameIndex()" (input)="setFrame(+$any($event.target).value)"
                    class="flex-1 accent-emerald-500" aria-label="Klatka radaru" />
                  <span class="text-xs font-mono text-slate-300 w-28 text-right">{{ frameTime() }}</span>
                </div>
              } @else {
                <div class="text-sm text-slate-400">Brak klatek radaru.</div>
              }
            </div>
            <div class="space-y-3 text-sm">
              @if (r.rain; as rain) {
                @if (!rain.covered) {
                  <div class="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-slate-400">Miejscowość jest poza zasięgiem radarów IMGW.</div>
                } @else {
                  <div class="p-3 rounded-xl border"
                    [class.bg-sky-950/60]="rain.rate !== null" [class.border-sky-700]="rain.rate !== null"
                    [class.bg-slate-950/70]="rain.rate === null" [class.border-slate-800]="rain.rate === null">
                    <div class="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">{{ radarStaleSince() ? 'O ' + radarStaleSince() : 'Teraz' }} nad {{ weather.selectedLocation()?.name }}</div>
                    <div class="text-lg font-black text-white mt-0.5">
                      {{ rain.rate !== null ? rainLabel(rain.rate) : 'Brak opadu' }}
                    </div>
                    @if (rain.rate !== null) {
                      <div class="text-xs text-sky-300 font-mono">ok. {{ rain.rate }} mm/h · {{ rain.dbz }} dBZ</div>
                    }
                  </div>
                  <div class="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-1">
                    <div class="text-[11px] uppercase tracking-wider text-slate-400 font-semibold">Najbliższy opad</div>
                    @if (rain.nearestKm !== null) {
                      <div class="text-white font-bold">{{ rain.nearestKm === 0 ? 'nad miejscowością' : rain.nearestKm + ' km na ' + compass(rain.nearestBearing) }}</div>
                      @if (rain.trend) {
                        <div class="text-xs"
                          [class.text-amber-300]="rain.trend === 'approaching'" [class.text-emerald-300]="rain.trend === 'receding'" [class.text-slate-400]="rain.trend === 'steady'">
                          {{ trendLabel(rain.trend) }} (30 min temu: {{ rain.nearestKm30minAgo }} km)
                        </div>
                      }
                    } @else {
                      <div class="text-emerald-300 font-bold">brak opadu w promieniu 150 km</div>
                    }
                  </div>
                  <p class="text-[11px] text-slate-500">
                    Natężenie oszacowane z odbiciowości radarowej (wzór Marshalla–Palmera) — przy śniegu i mżawce bywa niedokładne.
                    Kompozyt aktualizowany co 5 min.
                  </p>
                }
              } @else {
                <div class="text-slate-400 text-sm">Nie znam współrzędnych tej miejscowości.</div>
              }
            </div>
          </div>
        } @else {
          <div class="text-sm text-slate-500">Ładowanie radaru…</div>
        }
      </app-collapsible-section>

      <!-- 10. NORMY KLIMATYCZNE -->
      <app-collapsible-section sectionId="weather.climate" title="Normy klimatyczne i rekordy" icon="history" iconClass="text-orange-400"
        [subtitle]="climateSubtitle()">
        @if (climate(); as c) {
          @if (c.station; as st) {
            <div class="space-y-4">
              @if (anomaly(); as a) {
                <div class="p-3 rounded-xl border text-sm"
                  [class.bg-rose-950/50]="a.kind === 'warm'" [class.border-rose-700]="a.kind === 'warm'"
                  [class.bg-sky-950/50]="a.kind === 'cold'" [class.border-sky-700]="a.kind === 'cold'"
                  [class.bg-slate-950/70]="a.kind === 'normal'" [class.border-slate-800]="a.kind === 'normal'">
                  <span class="text-white font-bold">{{ a.text }}</span>
                  <span class="text-slate-400 text-xs block mt-0.5">{{ a.detail }}</span>
                </div>
              }
              <div class="overflow-x-auto">
                <table class="w-full text-xs">
                  <thead>
                    <tr class="text-slate-400 text-[10px] uppercase tracking-wider">
                      <th class="text-left py-1.5 pr-2">Miesiąc</th>
                      <th class="text-right px-2">Śr. temp.</th>
                      <th class="text-right px-2">Śr. max / min</th>
                      <th class="text-right px-2">Opad</th>
                      <th class="text-right px-2 hidden sm:table-cell">Słońce</th>
                      <th class="text-right px-2 hidden sm:table-cell">Dni ze śniegiem</th>
                      <th class="text-right px-2">Rekord max</th>
                      <th class="text-right pl-2">Rekord min</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (m of st.months; track m.month) {
                      <tr class="border-t border-slate-800" [class.bg-orange-950/30]="m.month === currentMonth">
                        <td class="py-1.5 pr-2 font-semibold" [class.text-orange-300]="m.month === currentMonth" [class.text-slate-200]="m.month !== currentMonth">{{ monthName(m.month) }}</td>
                        <td class="text-right px-2 font-mono text-white">{{ fmt(m.temp) }}°</td>
                        <td class="text-right px-2 font-mono text-slate-300">{{ fmt(m.tempMax) }}° / {{ fmt(m.tempMin) }}°</td>
                        <td class="text-right px-2 font-mono text-sky-300">{{ fmt(m.precip, 0) }} mm</td>
                        <td class="text-right px-2 font-mono text-amber-300 hidden sm:table-cell">{{ fmt(m.sunshine, 0) }} h</td>
                        <td class="text-right px-2 font-mono text-slate-300 hidden sm:table-cell">{{ fmt(m.snowDays, 0) }}</td>
                        <td class="text-right px-2 font-mono text-rose-300">{{ m.recordMax ? fmt(m.recordMax.value) + '° (' + m.recordMax.year + ')' : '--' }}</td>
                        <td class="text-right pl-2 font-mono text-sky-300">{{ m.recordMin ? fmt(m.recordMin.value) + '° (' + m.recordMin.year + ')' : '--' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <p class="text-[11px] text-slate-500">
                Stacja {{ st.name }}{{ c.distanceKm ? ' (' + c.distanceKm + ' km od miejsca)' : '' }} · norma = średnia z lat 1991–2020 (standard WMO) · rekordy z lat {{ st.firstYear }}–{{ st.lastYear }} · archiwum IMGW-PIB.
              </p>
            </div>
          } @else if (c.status.busy || !c.status.generatedAt) {
            <div class="text-sm text-slate-400 flex items-center gap-2"><mat-icon class="animate-spin">progress_activity</mat-icon>Pobieranie archiwum IMGW (pierwszy raz trwa chwilę)…</div>
          } @else {
            <div class="text-sm text-slate-400">{{ c.status.error || 'Brak stacji synoptycznej z wieloletnią serią pomiarów dla tej miejscowości.' }}</div>
          }
        } @else {
          <div class="text-sm text-slate-500">Wybierz miejscowość.</div>
        }
      </app-collapsible-section>

      <!-- 11. MAPA STACJI -->
      <app-collapsible-section sectionId="weather.map" title="Mapa stacji IMGW" icon="map" iconClass="text-teal-400"
        subtitle="Stan rzek i temperatura na stacjach wokół domu" (toggled)="onMapToggled($event)">
        <div class="space-y-2">
          <div #mapEl class="w-full h-[28rem] rounded-xl overflow-hidden border border-slate-800 bg-slate-950 z-0"></div>
          <div class="flex flex-wrap gap-3 text-[11px] text-slate-400">
            <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-sky-500"></span>rzeka: stan normalny</span>
            <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>stan ostrzegawczy</span>
            <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-rose-600"></span>stan alarmowy</span>
            <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-slate-500"></span>brak pomiaru</span>
            <span class="flex items-center gap-1"><span class="px-1 rounded bg-slate-800 text-white font-mono">5°</span>stacja meteo</span>
            <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full bg-fuchsia-500 border border-white"></span>wybrana miejscowość</span>
          </div>
        </div>
      </app-collapsible-section>
    </div>
  `,
})
export class WeatherExtras implements OnDestroy {
  readonly weather = inject(Weather);
  private readonly http = inject(HttpClient);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly forecast = signal<ForecastResponse | null>(null);
  readonly radar = signal<RadarResponse | null>(null);
  readonly climate = signal<ClimateResponse | null>(null);
  private readonly mapData = signal<MapResponse | null>(null);

  readonly frameIndex = signal(0);
  readonly radarPlaying = signal(false);
  readonly radarOpen = signal(true);
  readonly currentMonth = new Date().getMonth() + 1;

  private readonly forecastCanvas = viewChild<ElementRef<HTMLCanvasElement>>('forecastChart');
  private readonly mapEl = viewChild<ElementRef<HTMLDivElement>>('mapEl');
  private forecastChart: Chart | null = null;
  private map: Leaflet.Map | null = null;
  private mapLayers: Leaflet.LayerGroup[] = [];
  private leaflet: typeof Leaflet | null = null;
  private radarTimer: ReturnType<typeof setInterval> | null = null;
  private playTimer: ReturnType<typeof setInterval> | null = null;
  private forecastPoll: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  readonly frames = computed(() => this.radar()?.frames ?? []);
  readonly frameUrl = computed(() => {
    const f = this.frames()[this.frameIndex()];
    return f ? `/api/weather/radar/image/${f.stamp}` : null;
  });
  readonly frameTime = computed(() => {
    const f = this.frames()[this.frameIndex()];
    return f ? new Date(f.time).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : '';
  });
  readonly homeMarker = computed(() => {
    const c = this.radar()?.coords;
    if (!c) return null;
    const p = radarPixel(c.lat, c.lon);
    if (p.x < 0 || p.y < 0 || p.x > 900 || p.y > 900) return null;
    return { left: (p.x / RADAR_IMG_W) * 100, top: (p.y / RADAR_IMG_H) * 100 };
  });

  readonly forecastSubtitle = computed(() => {
    const f = this.forecast();
    if (!f) return 'Temperatura, opad, wiatr i zachmurzenie co 3 h';
    if (f.status.busy && f.status.progress) return f.status.progress;
    const first = f.forecast?.steps[0];
    return first ? `${f.location}: teraz ${first.temp ?? '--'}°, ${this.precipSummary(f.forecast!.steps)}` : f.location;
  });

  /** Godzina ostatniej klatki, gdy jest starsza niż 30 min (IMGW przestał publikować). */
  readonly radarStaleSince = computed(() => {
    const last = this.frames().at(-1);
    if (!last) return null;
    const t = new Date(last.time);
    if (Date.now() - t.getTime() < 30 * 60_000) return null;
    const sameDay = t.toDateString() === new Date().toDateString();
    return t.toLocaleString('pl-PL', sameDay ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  });

  readonly radarSubtitle = computed(() => {
    const rain = this.radar()?.rain;
    if (!rain) return 'Opad w okolicy domu, animacja z ostatniej godziny';
    if (this.radarStaleSince()) return `Brak nowych danych z IMGW od ${this.radarStaleSince()}`;
    if (!rain.covered) return 'Poza zasięgiem radarów';
    if (rain.rate !== null) return `Teraz pada: ok. ${rain.rate} mm/h`;
    if (rain.nearestKm !== null) return `Najbliższy opad ${rain.nearestKm} km na ${this.compass(rain.nearestBearing)}${rain.trend === 'approaching' ? ' — zbliża się' : ''}`;
    return 'Brak opadu w promieniu 150 km';
  });

  readonly climateSubtitle = computed(() => {
    const a = this.anomaly();
    return a ? a.text : 'Średnie 1991–2020 i rekordy ze stacji synoptycznej';
  });

  /** Bieżąca temperatura na tle normy miesiąca. */
  readonly anomaly = computed<{ kind: 'warm' | 'cold' | 'normal'; text: string; detail: string } | null>(() => {
    const st = this.climate()?.station;
    const loc = this.weather.selectedLocation();
    if (!st || !loc || loc.temp === null || loc.temp === undefined) return null;
    const m = st.months[this.currentMonth - 1];
    if (m.tempMax === null || m.tempMin === null || m.temp === null) return null;
    const t = loc.temp;
    const kind = t > m.tempMax ? 'warm' : t < m.tempMin ? 'cold' : 'normal';
    const where = MONTHS_LOC[this.currentMonth - 1];
    const text =
      kind === 'warm'
        ? `Teraz ${t}°C — cieplej niż zwykle w ${where}`
        : kind === 'cold'
          ? `Teraz ${t}°C — zimniej niż zwykle w ${where}`
          : `Teraz ${t}°C — typowo jak na ${MONTHS[this.currentMonth - 1]}`;
    return {
      kind,
      text,
      detail: `Normalnie w ${where} średnio od ${m.tempMin}° (noc) do ${m.tempMax}° (dzień), średnia ${m.temp}°. Rekord: ${m.recordMax?.value ?? '--'}° w ${m.recordMax?.year ?? '--'}, ${m.recordMin?.value ?? '--'}° w ${m.recordMin?.year ?? '--'}.`,
    };
  });

  constructor() {
    if (!this.browser) return;
    Chart.register(...registerables);

    effect(() => {
      const id = this.weather.selectedLocationId();
      untracked(() => {
        if (!id) return;
        void this.loadForecast(id);
        void this.loadRadar(id);
        void this.loadClimate(id);
        void this.loadMap(id);
      });
    });

    effect(() => {
      const f = this.forecast();
      untracked(() => {
        if (f?.forecast) queueMicrotask(() => this.redrawForecast());
      });
    });

    effect(() => {
      const data = this.mapData();
      untracked(() => {
        if (data) void this.renderMap(data);
      });
    });

    this.radarTimer = setInterval(() => {
      const id = this.weather.selectedLocationId();
      if (id && this.radarOpen() && !document.hidden) void this.loadRadar(id);
    }, RADAR_REFRESH_MS);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.radarTimer) clearInterval(this.radarTimer);
    if (this.playTimer) clearInterval(this.playTimer);
    if (this.forecastPoll) clearTimeout(this.forecastPoll);
    this.forecastChart?.destroy();
    this.map?.remove();
  }

  // --- pobieranie ---

  private async loadForecast(id: string): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<ForecastResponse>(`/api/weather/forecast/${encodeURIComponent(id)}`));
      if (this.weather.selectedLocationId() !== id) return;
      this.forecast.set(res);
      // Serwer pobiera właśnie prognozę: sprawdzamy ponownie za chwilę
      if (this.forecastPoll) clearTimeout(this.forecastPoll);
      if (res.status.busy && !this.destroyed) this.forecastPoll = setTimeout(() => void this.loadForecast(id), 15_000);
    } catch {
      this.forecast.set(null);
    }
  }

  private async loadRadar(id: string): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<RadarResponse>(`/api/weather/radar?location=${encodeURIComponent(id)}`));
      if (this.weather.selectedLocationId() !== id) return;
      const wasLast = this.frameIndex() >= this.frames().length - 1;
      this.radar.set(res);
      if (wasLast || this.frameIndex() >= res.frames.length) this.frameIndex.set(Math.max(0, res.frames.length - 1));
      this.preloadFrames(res.frames.map((f) => f.stamp));
    } catch {
      this.radar.set(null);
    }
  }

  private async loadClimate(id: string): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<ClimateResponse>(`/api/weather/climate/${encodeURIComponent(id)}`));
      if (this.weather.selectedLocationId() !== id) return;
      this.climate.set(res);
    } catch {
      this.climate.set(null);
    }
  }

  private async loadMap(id: string): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<MapResponse>(`/api/weather/map?location=${encodeURIComponent(id)}`));
      if (this.weather.selectedLocationId() !== id) return;
      this.mapData.set(res);
    } catch {
      // mapa zostaje z poprzednimi danymi
    }
  }

  private preloadFrames(stamps: string[]): void {
    for (const s of stamps) {
      const img = new Image();
      img.src = `/api/weather/radar/image/${s}`;
    }
  }

  // --- radar ---

  setFrame(i: number): void {
    this.frameIndex.set(i);
    this.stopPlay();
  }

  toggleRadarPlay(): void {
    if (this.radarPlaying()) {
      this.stopPlay();
      return;
    }
    this.radarPlaying.set(true);
    this.frameIndex.set(0);
    this.playTimer = setInterval(() => {
      const n = this.frames().length;
      if (n === 0) return;
      this.frameIndex.set((this.frameIndex() + 1) % n);
    }, 600);
  }

  private stopPlay(): void {
    if (this.playTimer) clearInterval(this.playTimer);
    this.playTimer = null;
    this.radarPlaying.set(false);
  }

  // --- prognoza ---

  redrawForecast(): void {
    const canvas = this.forecastCanvas()?.nativeElement;
    const steps = this.forecast()?.forecast?.steps;
    if (!canvas || !steps?.length) return;
    this.forecastChart?.destroy();
    const labels = steps.map((s) => `${this.dayLabel(s.time)} ${this.hourLabel(s.time)}`);
    this.forecastChart = new Chart(canvas, {
      data: {
        labels,
        datasets: [
          {
            type: 'line',
            label: 'Temperatura [°C]',
            data: steps.map((s) => s.temp),
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245,158,11,0.15)',
            tension: 0.35,
            pointRadius: 2,
            yAxisID: 'y',
          },
          {
            type: 'line',
            label: 'Punkt rosy [°C]',
            data: steps.map((s) => s.dewPoint),
            borderColor: '#64748b',
            borderDash: [4, 4],
            pointRadius: 0,
            tension: 0.35,
            yAxisID: 'y',
          },
          {
            type: 'bar',
            label: 'Opad [mm/3 h]',
            data: steps.map((s) => s.precip ?? 0),
            backgroundColor: steps.map((s) => ((s.snow ?? 0) > (s.precip ?? 0) / 2 ? 'rgba(226,232,240,0.8)' : 'rgba(56,189,248,0.7)')),
            yAxisID: 'y2',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { color: '#cbd5e1', boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#94a3b8', maxRotation: 0, autoSkip: true, font: { size: 10 } }, grid: { color: 'rgba(51,65,85,0.4)' } },
          y: { position: 'left', ticks: { color: '#f59e0b' }, grid: { color: 'rgba(51,65,85,0.4)' } },
          y2: { position: 'right', beginAtZero: true, suggestedMax: 3, ticks: { color: '#38bdf8' }, grid: { display: false } },
        },
      },
    });
  }

  // --- mapa ---

  onMapToggled(open: boolean): void {
    if (open) setTimeout(() => this.map?.invalidateSize(), 50);
  }

  private async renderMap(data: MapResponse): Promise<void> {
    const el = this.mapEl()?.nativeElement;
    if (!el) return;
    if (!this.leaflet) {
      const mod = await import('leaflet');
      this.leaflet = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
    }
    const L = this.leaflet;
    const home = data.home?.coords;
    if (!this.map) {
      this.map = L.map(el, { zoomControl: true, attributionControl: true }).setView(home ? [home.lat, home.lon] : [52.1, 19.4], home ? 9 : 6);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · dane: IMGW-PIB',
      }).addTo(this.map);
    } else if (home) {
      this.map.setView([home.lat, home.lon], Math.max(this.map.getZoom(), 8));
    }
    for (const l of this.mapLayers) l.remove();
    this.mapLayers = [];

    const hydro = L.layerGroup();
    for (const h of data.hydro) {
      const color = h.level === null ? '#64748b' : h.alarm !== null && h.level >= h.alarm ? '#e11d48' : h.warning !== null && h.level >= h.warning ? '#f59e0b' : '#0ea5e9';
      L.circleMarker([h.lat, h.lon], { radius: 6, color: '#0f172a', weight: 1, fillColor: color, fillOpacity: 0.9 })
        .bindTooltip(
          `<b>${esc(h.name)}</b> (${esc(h.river)})<br>stan: ${h.level ?? '--'} cm` +
            (h.warning !== null ? ` · ostrz. ${h.warning}` : '') +
            (h.alarm !== null ? ` · alarm ${h.alarm}` : '') +
            (h.flow !== null ? `<br>przepływ: ${h.flow} m³/s` : ''),
        )
        .addTo(hydro);
    }
    const meteo = L.layerGroup();
    for (const m of data.meteo) {
      if (m.temp === null) continue;
      L.marker([m.lat, m.lon], {
        icon: L.divIcon({
          className: '',
          html: `<span style="display:inline-block;padding:0 4px;border-radius:4px;background:rgba(15,23,42,.85);color:#fff;font:600 10px monospace;border:1px solid #334155;white-space:nowrap">${m.temp}°</span>`,
          iconSize: [30, 14],
          iconAnchor: [15, 7],
        }),
      })
        .bindTooltip(`<b>${esc(m.name)}</b><br>${m.temp}°C` + (m.wind !== null ? ` · wiatr ${m.wind} m/s` : '') + (m.rain10 ? ` · opad ${m.rain10} mm/10 min` : ''))
        .addTo(meteo);
    }
    const homeLayer = L.layerGroup();
    if (home) {
      L.circleMarker([home.lat, home.lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#d946ef', fillOpacity: 1 })
        .bindTooltip(`<b>${esc(data.home!.name)}</b><br>${esc(home.source)}`)
        .addTo(homeLayer);
    }
    for (const g of [hydro, meteo, homeLayer]) {
      g.addTo(this.map);
      this.mapLayers.push(g);
    }
    setTimeout(() => this.map?.invalidateSize(), 50);
  }

  // --- formatowanie ---

  dayLabel(iso: string): string {
    return new Date(iso).toLocaleDateString('pl-PL', { weekday: 'short' });
  }

  hourLabel(iso: string): string {
    return new Date(iso).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  }

  runLabel(run: string): string {
    return `${run.slice(6, 8)}.${run.slice(4, 6)} ${run.slice(8, 10)}:${run.slice(10, 12)}`;
  }

  stepIcon(s: ForecastStep): { icon: string; cls: string } {
    const hour = new Date(s.time).getHours();
    const night = hour < 6 || hour >= 20;
    if ((s.snow ?? 0) >= 0.1 && (s.snow ?? 0) >= (s.precip ?? 0) / 2) return { icon: 'ac_unit', cls: 'text-slate-100' };
    if ((s.precip ?? 0) >= 0.1) return { icon: 'umbrella', cls: 'text-sky-400' };
    if ((s.cloud ?? 0) >= 75) return { icon: 'cloud', cls: 'text-slate-400' };
    if ((s.cloud ?? 0) >= 30) return { icon: 'filter_drama', cls: 'text-slate-300' };
    return night ? { icon: 'nights_stay', cls: 'text-indigo-300' } : { icon: 'wb_sunny', cls: 'text-amber-400' };
  }

  compass(deg: number | null): string {
    if (deg === null) return '--';
    return COMPASS[Math.round(deg / 45) % 8];
  }

  compassFrom(deg: number | null): string {
    if (deg === null) return '--';
    return COMPASS_FROM[Math.round(deg / 45) % 8];
  }

  trendLabel(t: 'approaching' | 'receding' | 'steady'): string {
    return t === 'approaching' ? 'Opad się zbliża' : t === 'receding' ? 'Opad się oddala' : 'Opad stoi w miejscu';
  }

  rainLabel(rate: number): string {
    if (rate < 0.5) return 'Słaby opad';
    if (rate < 2.5) return 'Umiarkowany opad';
    if (rate < 10) return 'Silny opad';
    return 'Bardzo silny opad';
  }

  kmh(ms: number | null): string {
    return ms === null ? '--' : String(Math.round(ms * 3.6));
  }

  monthName(m: number): string {
    return MONTHS[m - 1];
  }

  fmt(v: number | null, digits = 1): string {
    return v === null || v === undefined ? '--' : v.toFixed(digits).replace('.', ',');
  }

  private precipSummary(steps: ForecastStep[]): string {
    const next24 = steps.filter((s) => new Date(s.time).getTime() <= Date.now() + 24 * 3600_000);
    const sum = next24.reduce((a, s) => a + (s.precip ?? 0), 0);
    return sum >= 0.2 ? `opad w 24 h: ${sum.toFixed(1).replace('.', ',')} mm` : 'bez opadu w 24 h';
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
