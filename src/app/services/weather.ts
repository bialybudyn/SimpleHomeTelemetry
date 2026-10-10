import {
  Injectable,
  inject,
  signal,
  computed,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Telemetry } from './telemetry';
import { Device } from '../models/telemetry.models';

export interface ImgwSynopStation {
  id_stacji: string;
  stacja: string;
  data_pomiaru: string;
  godzina_pomiaru: string;
  temperatura: string | number | null;
  predkosc_wiatru: string | number | null;
  kierunek_wiatru: string | number | null;
  wilgotnosc_wzgledna: string | number | null;
  suma_opadu: string | number | null;
  cisnienie: string | number | null;
}

export interface ImgwHourlyPoint {
  timestamp: string;
  time_label: string;
  temperatura: number | null;
  wilgotnosc: number | null;
  cisnienie: number | null;
  wiatr: number | null;
  opad: number | null;
}

export interface ImgwHydroStation {
  id_stacji: string;
  stacja: string;
  rzeka: string;
  wojewodztwo?: string;
  stan_wody: number | string | null;
  stan_ostrzegawczy: number | string | null;
  stan_alarmowy: number | string | null;
  stan_wody_data_pomiaru: string | null;
  temperatura_wody: number | string | null;
  przeplyw: number | string | null;
  zjawisko_lodowe?: string | null;
  zjawisko_zarastania?: string | null;
}

export interface ImgwMeteoStation {
  kod_stacji: string;
  nazwa_stacji: string;
  wysokosc_npm?: string | null;
  temperatura_powietrza?: string | number | null;
  temperatura_gruntu?: string | number | null;
  wilgotnosc_wzgledna?: string | number | null;
  opad_10min?: string | number | null;
  wiatr_srednia_predkosc?: string | number | null;
  wiatr_poryw_10min?: string | number | null;
  wiatr_kierunek?: string | number | null;
}

export interface ImgwWarning {
  type: 'meteo' | 'hydro';
  id?: string;
  numer?: string;
  zdarzenie: string;
  stopien: string | number;
  prawdopodobienstwo?: string | number;
  data_od: string;
  data_do: string;
  opublikowano?: string;
  biuro?: string;
  przebieg?: string;
  komentarz?: string;
  obszary?: { wojewodztwo?: string; opis?: string; kod_zlewni?: string[] }[];
}

export interface WeatherLocation {
  id: string;
  name: string;
  voivodeship: string;
  type: 'city' | 'synop' | 'meteo';
  synopStationId: string;
  synopStationName?: string;
  meteoStationCode?: string;
  meteoStationName?: string;
  temp: number | null;
  humidity: number | null;
  pressure: number | null;
  windSpeed: number | null;
  windGust: number | null;
  rain: number | null;
  groundTemp: number | null;
  measurementTime?: string;
  sourceDesc: string;
}

export interface WeatherLocationDetails {
  location: WeatherLocation;
  synop: ImgwSynopStation | null;
  meteo: ImgwMeteoStation | null;
  history: ImgwHourlyPoint[];
  nearbyHydro: ImgwHydroStation[];
  warnings: ImgwWarning[];
}

function normalizePl(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/ą/g, 'a')
    .replace(/ć/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ł/g, 'l')
    .replace(/ń/g, 'n')
    .replace(/ó/g, 'o')
    .replace(/ś/g, 's')
    .replace(/ź/g, 'z')
    .replace(/ż/g, 'z')
    .replace(/[\s\-_.,/]/g, '')
    .trim();
}

@Injectable({
  providedIn: 'root',
})
export class Weather {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly telemetry = inject(Telemetry);

  // Lista województw
  readonly voivodeships = [
    'Wszystkie województwa',
    'Dolnośląskie',
    'Kujawsko-Pomorskie',
    'Lubelskie',
    'Lubuskie',
    'Łódzkie',
    'Małopolskie',
    'Mazowieckie',
    'Opolskie',
    'Podkarpackie',
    'Podlaskie',
    'Pomorskie',
    'Śląskie',
    'Świętokrzyskie',
    'Warmińsko-Mazurskie',
    'Wielkopolskie',
    'Zachodniopomorskie',
  ];

  // Wszystkie miejscowości i stacje IMGW (katalog > 850 pozycji)
  readonly locations = signal<WeatherLocation[]>([]);
  readonly isLoadingLocations = signal<boolean>(false);
  readonly locationsError = signal<string | null>(null);

  // Filtrowanie i wyszukiwanie miejscowości
  readonly searchQuery = signal<string>('');
  readonly selectedVoivodeship = signal<string>('all');
  readonly selectedTypeFilter = signal<'all' | 'city' | 'synop' | 'meteo'>('all');

  // Aktywnie wybrana lokalizacja
  readonly selectedLocationId = signal<string>('city_warszawa');
  readonly selectedLocationDetails = signal<WeatherLocationDetails | null>(null);
  readonly isLoadingDetails = signal<boolean>(false);

  // Ulubione lokalizacje (miejscowości i stacje)
  readonly favoriteLocationIds = signal<string[]>([
    'city_warszawa',
    'city_krakow',
    'city_wroclaw',
    'city_poznan',
    'city_gdansk',
    'city_radom',
    'city_katowice',
    'city_lodz',
  ]);

  // Backward-compatibility: stacje synoptyczne i ich ID
  readonly synopStations = signal<ImgwSynopStation[]>([]);
  readonly selectedStationId = signal<string>('12375');
  readonly isLoadingStations = signal<boolean>(false);
  readonly stationsError = signal<string | null>(null);

  // Historia godzinowa
  readonly stationHistory = signal<ImgwHourlyPoint[]>([]);
  readonly isLoadingHistory = signal<boolean>(false);

  // Ulubione stacje synoptyczne
  readonly favoriteStationIds = signal<string[]>(['12375', '12566', '12500', '12160', '12295']);

  // Hydro & Meteo & Ostrzeżenia
  readonly hydroStations = signal<ImgwHydroStation[]>([]);
  readonly hydroSearch = signal<string>('');
  readonly isLoadingHydro = signal<boolean>(false);

  readonly meteoStations = signal<ImgwMeteoStation[]>([]);
  readonly meteoSearch = signal<string>('');
  readonly isLoadingMeteo = signal<boolean>(false);

  readonly meteoWarnings = signal<ImgwWarning[]>([]);
  readonly hydroWarnings = signal<ImgwWarning[]>([]);
  readonly isLoadingWarnings = signal<boolean>(false);

  // Klucze zamkniętych powiadomień ostrzeżeń IMGW przez użytkownika
  readonly dismissedWarningKeys = signal<string[]>([]);
  readonly isWarningAlertDismissed = signal<boolean>(false);

  // Wszystkie aktywne ostrzeżenia IMGW
  readonly allWarnings = computed<ImgwWarning[]>(() => {
    return [...this.meteoWarnings(), ...this.hydroWarnings()];
  });

  // Ostrzeżenia meteorologiczne i hydrologiczne ściśle dla wybranego regionu/województwa
  readonly regionWarnings = computed<ImgwWarning[]>(() => {
    const loc = this.selectedLocation();
    const all = this.allWarnings();
    if (!loc || all.length === 0) return [];

    const locVoiv = normalizePl(loc.voivodeship);
    const locName = normalizePl(loc.name);

    return all.filter((w) => {
      // Jeśli ostrzeżenie nie ma zdefiniowanych obszarów, przyjmujemy, że dotyczy całego kraju
      if (!w.obszary || w.obszary.length === 0) return true;

      return w.obszary.some((o) => {
        const oVoiv = normalizePl(o.wojewodztwo || '');
        const oOpis = normalizePl(o.opis || '');
        if (oVoiv && (oVoiv.includes(locVoiv) || locVoiv.includes(oVoiv))) return true;
        if (oOpis && (oOpis.includes(locName) || oOpis.includes(locVoiv))) return true;
        return false;
      });
    });
  });

  // Ostrzeżenia meteorologiczne dla wybranego regionu
  readonly regionMeteoWarnings = computed<ImgwWarning[]>(() => {
    return this.regionWarnings().filter((w) => w.type === 'meteo');
  });

  // Unikalny identyfikator aktualnego zestawu ostrzeżeń dla regionu (do detekcji nowych ostrzeżeń)
  readonly regionWarningsKey = computed<string>(() => {
    const warnings = this.regionWarnings();
    if (warnings.length === 0) return '';
    return warnings
      .map((w) => `${w.type}_${w.numer || ''}_${w.zdarzenie}_${w.stopien}_${w.data_od}`)
      .sort()
      .join('|');
  });

  // Czy powiadomienie (alert banner) w widoku głównym powinno być aktywne i widoczne
  readonly activeRegionWarningAlert = computed<{
    visible: boolean;
    location: WeatherLocation;
    warnings: ImgwWarning[];
    meteoCount: number;
    hydroCount: number;
    highestLevel: number;
    primaryWarning: ImgwWarning;
    summary: string;
  } | null>(() => {
    const loc = this.selectedLocation();
    const warnings = this.regionWarnings();
    const key = this.regionWarningsKey();

    if (!loc || warnings.length === 0) return null;
    if (this.isWarningAlertDismissed() || this.dismissedWarningKeys().includes(key)) {
      return null;
    }

    const meteoCount = warnings.filter((w) => w.type === 'meteo').length;
    const hydroCount = warnings.filter((w) => w.type === 'hydro').length;

    let highestLevel = 1;
    for (const w of warnings) {
      const lvl = parseInt(String(w.stopien || '1'), 10);
      if (!isNaN(lvl) && lvl > highestLevel) {
        highestLevel = lvl;
      }
    }

    // Wybierz priorytetowe ostrzeżenie (preferowane meteorologiczne o najwyższym stopniu)
    const sorted = [...warnings].sort((a, b) => {
      const lvlA = parseInt(String(a.stopien || '1'), 10) || 1;
      const lvlB = parseInt(String(b.stopien || '1'), 10) || 1;
      return lvlB - lvlA;
    });

    const primary = sorted[0];
    const summary = primary.przebieg || primary.komentarz || `${primary.zdarzenie} (Stopień ${primary.stopien})`;

    return {
      visible: true,
      location: loc,
      warnings,
      meteoCount,
      hydroCount,
      highestLevel,
      primaryWarning: primary,
      summary,
    };
  });

  dismissWarningAlert(): void {
    const key = this.regionWarningsKey();
    if (key) {
      this.dismissedWarningKeys.update((prev) => [...prev, key]);
    }
    this.isWarningAlertDismissed.set(true);
  }

  restoreWarningAlert(): void {
    this.isWarningAlertDismissed.set(false);
  }

  // Wybrany czujnik domowy do porównania
  readonly comparisonSensorIeee = signal<string | null>(null);

  // Obliczona wybrana lokalizacja
  readonly selectedLocation = computed<WeatherLocation | null>(() => {
    const locId = this.selectedLocationId();
    const list = this.locations();
    let found = list.find((l) => l.id === locId);
    if (!found) {
      found = list.find((l) => l.synopStationId === locId);
    }
    if (!found && list.length > 0) {
      return list[0];
    }
    return found || null;
  });

  // Przefiltrowana lista miejscowości i stacji
  readonly filteredLocations = computed<WeatherLocation[]>(() => {
    let list = this.locations();
    const q = normalizePl(this.searchQuery());
    const voiv = this.selectedVoivodeship();
    const type = this.selectedTypeFilter();

    if (voiv && voiv !== 'all' && voiv !== 'Wszystkie województwa') {
      const qVoiv = normalizePl(voiv);
      list = list.filter((l) => normalizePl(l.voivodeship) === qVoiv);
    }

    if (type && type !== 'all') {
      list = list.filter((l) => l.type === type);
    }

    if (q) {
      list = list.filter((l) =>
        normalizePl(l.name).includes(q) ||
        normalizePl(l.voivodeship).includes(q) ||
        (l.meteoStationCode && l.meteoStationCode.includes(q)) ||
        (l.synopStationName && normalizePl(l.synopStationName).includes(q))
      );
    }

    return list;
  });

  // Obiekty ulubionych lokalizacji
  readonly favoriteLocations = computed<WeatherLocation[]>(() => {
    const favSet = new Set(this.favoriteLocationIds());
    return this.locations().filter((l) => favSet.has(l.id));
  });

  // Kompatybilność wsteczna: wybrana stacja synoptyczna
  readonly selectedStation = computed<ImgwSynopStation | null>(() => {
    const details = this.selectedLocationDetails();
    if (details?.synop) return details.synop;

    const synopId = this.selectedLocation()?.synopStationId || this.selectedStationId();
    return this.synopStations().find((s) => s.id_stacji === synopId) || null;
  });

  // Kompatybilność wsteczna: lista obiektów ulubionych stacji synoptycznych
  readonly favoriteStations = computed<ImgwSynopStation[]>(() => {
    const favs = new Set(this.favoriteStationIds());
    return this.synopStations().filter((s) => favs.has(s.id_stacji));
  });

  // Lista czujników z odczytem temperatury
  readonly temperatureSensors = computed<Device[]>(() => {
    return this.telemetry.devices().filter((d) => {
      return (
        d.last_temperature !== null &&
        d.last_temperature !== undefined &&
        !isNaN(Number(d.last_temperature)) &&
        !d.is_deleted
      );
    });
  });

  // Aktualnie wybrany czujnik domowy
  readonly selectedSensor = computed<Device | null>(() => {
    const ieee = this.comparisonSensorIeee();
    if (!ieee) return null;
    return this.telemetry.devices().find((d) => d.ieee_address === ieee) || null;
  });

  // Delta temperatury rzeczywistej (czujnik w domu) vs zewnętrznej (wybrana miejscowość / stacja IMGW)
  readonly deltaInfo = computed<{
    sensorTemp: number | null;
    synopTemp: number | null;
    delta: number | null;
    deltaFormatted: string;
    interpretation: string;
    status: 'warmer' | 'cooler' | 'equal' | 'none';
    sensorHum: number | null;
    synopHum: number | null;
    deltaHum: number | null;
    locationName: string;
  }>(() => {
    const sensor = this.selectedSensor();
    const loc = this.selectedLocation();
    const synop = this.selectedStation();

    const sensorTemp =
      sensor && sensor.last_temperature !== null && sensor.last_temperature !== undefined
        ? Number(sensor.last_temperature)
        : null;

    // Preferuj temperaturę wybranej miejscowości/stacji, a fallback to stacja synoptyczna
    const synopTemp =
      loc && loc.temp !== null && loc.temp !== undefined
        ? Number(loc.temp)
        : (synop && synop.temperatura !== null && synop.temperatura !== undefined
            ? Number(synop.temperatura)
            : null);

    const sensorHum =
      sensor && sensor.last_humidity !== null && sensor.last_humidity !== undefined
        ? Number(sensor.last_humidity)
        : null;

    const synopHum =
      loc && loc.humidity !== null && loc.humidity !== undefined
        ? Number(loc.humidity)
        : (synop && synop.wilgotnosc_wzgledna !== null && synop.wilgotnosc_wzgledna !== undefined
            ? Number(synop.wilgotnosc_wzgledna)
            : null);

    const locName = loc?.name || synop?.stacja || 'Stacja IMGW';

    if (sensorTemp === null || synopTemp === null) {
      return {
        sensorTemp,
        synopTemp,
        delta: null,
        deltaFormatted: '--',
        interpretation: `Wybierz czujnik temperatury, aby obliczyć deltę względem miejscowości ${locName}.`,
        status: 'none',
        sensorHum,
        synopHum,
        deltaHum: null,
        locationName: locName,
      };
    }

    const delta = Math.round((sensorTemp - synopTemp) * 10) / 10;
    const deltaHum =
      sensorHum !== null && synopHum !== null
        ? Math.round((sensorHum - synopHum) * 10) / 10
        : null;

    const deltaFormatted = `${delta > 0 ? '+' : ''}${delta.toFixed(1)}°C`;
    let interpretation = '';
    let status: 'warmer' | 'cooler' | 'equal' = 'equal';

    const sensorName = sensor?.friendly_name || 'Czujnik domowy';

    if (Math.abs(delta) < 0.5) {
      interpretation = `Temperatura w strefie „${sensorName}” jest niemal identyczna jak na zewnątrz w miejscowości ${locName}. Różnica wynosi zaledwie ${deltaFormatted}.`;
      status = 'equal';
    } else if (delta > 0) {
      interpretation = `W pomieszczeniu „${sensorName}” jest cieplej o ${Math.abs(delta).toFixed(1)}°C niż na zewnątrz w ${locName} (efekt ogrzewania / izolacji budynku).`;
      status = 'warmer';
    } else {
      interpretation = `W strefie „${sensorName}” jest chłodniej o ${Math.abs(delta).toFixed(1)}°C niż na zewnątrz w ${locName} (klimatyzacja / zacienienie / mikroklimat).`;
      status = 'cooler';
    }

    return {
      sensorTemp,
      synopTemp,
      delta,
      deltaFormatted,
      interpretation,
      status,
      sensorHum,
      synopHum,
      deltaHum,
      locationName: locName,
    };
  });

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.loadSavedFavorites();
      this.loadLocations();
      this.loadSynopStations();
      this.loadWarnings();
      this.loadHydroStations();
      this.loadMeteoStations();

      // Automatyczny wybór pierwszego sensora temperatury do porównania
      setTimeout(() => {
        const sensors = this.temperatureSensors();
        if (sensors.length > 0 && !this.comparisonSensorIeee()) {
          this.comparisonSensorIeee.set(sensors[0].ieee_address);
        }
      }, 1500);

      // Odświeżanie danych co 5 minut
      setInterval(() => {
        this.loadLocations(false);
        this.loadLocationDetails(this.selectedLocationId());
        this.loadWarnings();
      }, 5 * 60 * 1000);
    }
  }

  // Pobiera pełny katalog miejscowości i stacji
  loadLocations(silent = false): void {
    if (!silent) this.isLoadingLocations.set(true);
    this.http.get<WeatherLocation[]>('/api/weather/locations').subscribe({
      next: (list) => {
        if (Array.isArray(list) && list.length > 0) {
          this.locations.set(list);
          this.locationsError.set(null);

          // Jeśli wybrana lokalizacja nie istnieje na liście, ustaw pierwszą ulubioną lub pierwszą z listy
          const curId = this.selectedLocationId();
          if (!list.some((l) => l.id === curId)) {
            const firstFav = this.favoriteLocationIds().find((fid) => list.some((l) => l.id === fid));
            this.selectedLocationId.set(firstFav || list[0].id);
          }

          // Załaduj szczegóły i historię dla wybranej lokalizacji
          this.loadLocationDetails(this.selectedLocationId());
        }
        if (!silent) this.isLoadingLocations.set(false);
      },
      error: () => {
        this.locationsError.set('Nie udało się pobrać listy miejscowości IMGW');
        if (!silent) this.isLoadingLocations.set(false);
      },
    });
  }

  // Wybór miejscowości / stacji
  selectLocation(locationId: string): void {
    if (!locationId) return;
    this.selectedLocationId.set(locationId);
    this.isWarningAlertDismissed.set(false);

    const loc = this.locations().find((l) => l.id === locationId);
    if (loc?.synopStationId) {
      this.selectedStationId.set(loc.synopStationId);
    }

    this.loadLocationDetails(locationId);
  }

  // Pobiera szczegóły i historię dla wybranej lokalizacji
  loadLocationDetails(locationId: string): void {
    if (!locationId) return;
    this.isLoadingDetails.set(true);

    this.http.get<WeatherLocationDetails>(`/api/weather/location/${encodeURIComponent(locationId)}`).subscribe({
      next: (details) => {
        if (details) {
          this.selectedLocationDetails.set(details);
          if (Array.isArray(details.history)) {
            this.stationHistory.set(details.history);
          }
          if (details.synop) {
            this.selectedStationId.set(details.synop.id_stacji);
          }
        }
        this.isLoadingDetails.set(false);
      },
      error: () => {
        // Fallback: pobierz historię ze stacji synoptycznej
        const loc = this.locations().find((l) => l.id === locationId);
        const synId = loc?.synopStationId || locationId;
        this.loadStationHistory(synId);
        this.isLoadingDetails.set(false);
      },
    });
  }

  // Dodawanie/usuwanie miejscowości z ulubionych
  toggleFavoriteLocation(locationId: string): void {
    const cur = [...this.favoriteLocationIds()];
    const idx = cur.indexOf(locationId);
    if (idx !== -1) {
      cur.splice(idx, 1);
    } else {
      cur.push(locationId);
    }
    this.favoriteLocationIds.set(cur);
    this.saveFavorites(cur);
  }

  isFavoriteLocation(locationId: string): boolean {
    return this.favoriteLocationIds().includes(locationId);
  }

  setVoivodeship(voiv: string): void {
    this.selectedVoivodeship.set(voiv);
  }

  setTypeFilter(type: 'all' | 'city' | 'synop' | 'meteo'): void {
    this.selectedTypeFilter.set(type);
  }

  setSearchQuery(q: string): void {
    this.searchQuery.set(q);
  }

  // Kompatybilność ze starymi metodami
  loadSynopStations(force = false): void {
    this.isLoadingStations.set(true);
    const url = `/api/weather/synop${force ? '?force=true' : ''}`;
    this.http.get<ImgwSynopStation[]>(url).subscribe({
      next: (stations) => {
        if (Array.isArray(stations) && stations.length > 0) {
          stations.sort((a, b) => a.stacja.localeCompare(b.stacja, 'pl'));
          this.synopStations.set(stations);
          this.stationsError.set(null);
        }
        this.isLoadingStations.set(false);
      },
      error: () => {
        this.stationsError.set('Nie udało się pobrać stacji IMGW');
        this.isLoadingStations.set(false);
      },
    });
  }

  selectStation(stationId: string): void {
    const matchLoc = this.locations().find((l) => l.synopStationId === stationId || l.id === stationId);
    if (matchLoc) {
      this.selectLocation(matchLoc.id);
    } else {
      this.selectedStationId.set(stationId);
      this.loadStationHistory(stationId);
    }
  }

  loadStationHistory(stationId: string): void {
    if (!stationId) return;
    this.isLoadingHistory.set(true);
    this.http.get<{ station: ImgwSynopStation; history: ImgwHourlyPoint[] }>(`/api/weather/history/${stationId}`).subscribe({
      next: (res) => {
        if (res && Array.isArray(res.history)) {
          this.stationHistory.set(res.history);
        }
        this.isLoadingHistory.set(false);
      },
      error: () => {
        this.isLoadingHistory.set(false);
      },
    });
  }

  loadHydroStations(search = ''): void {
    this.isLoadingHydro.set(true);
    const url = `/api/weather/hydro?limit=40${search ? '&search=' + encodeURIComponent(search) : ''}`;
    this.http.get<ImgwHydroStation[]>(url).subscribe({
      next: (data) => {
        if (Array.isArray(data)) {
          this.hydroStations.set(data);
        }
        this.isLoadingHydro.set(false);
      },
      error: () => {
        this.isLoadingHydro.set(false);
      },
    });
  }

  loadMeteoStations(search = ''): void {
    this.isLoadingMeteo.set(true);
    const url = `/api/weather/meteo?limit=40${search ? '&search=' + encodeURIComponent(search) : ''}`;
    this.http.get<ImgwMeteoStation[]>(url).subscribe({
      next: (data) => {
        if (Array.isArray(data)) {
          this.meteoStations.set(data);
        }
        this.isLoadingMeteo.set(false);
      },
      error: () => {
        this.isLoadingMeteo.set(false);
      },
    });
  }

  loadWarnings(): void {
    this.isLoadingWarnings.set(true);
    this.http.get<{ meteo: ImgwWarning[]; hydro: ImgwWarning[]; count: number }>('/api/weather/warnings').subscribe({
      next: (res) => {
        if (res) {
          this.meteoWarnings.set(res.meteo || []);
          this.hydroWarnings.set(res.hydro || []);
        }
        this.isLoadingWarnings.set(false);
      },
      error: () => {
        this.isLoadingWarnings.set(false);
      },
    });
  }

  toggleFavorite(stationId: string): void {
    this.toggleFavoriteLocation(stationId);
  }

  isFavorite(stationId: string): boolean {
    return this.isFavoriteLocation(stationId) || this.favoriteStationIds().includes(stationId);
  }

  setComparisonSensor(ieee: string): void {
    this.comparisonSensorIeee.set(ieee);
  }

  private loadSavedFavorites(): void {
    try {
      const stored = localStorage.getItem('imgw_favorites_locations');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.favoriteLocationIds.set(parsed);
          return;
        }
      }
    } catch {
      // Fallback
    }

    this.http.get<{ favorites: string[] }>('/api/weather/favorites').subscribe({
      next: (res) => {
        if (res && Array.isArray(res.favorites) && res.favorites.length > 0) {
          this.favoriteLocationIds.set(res.favorites);
        }
      },
    });
  }

  private saveFavorites(favs: string[]): void {
    if (isPlatformBrowser(this.platformId)) {
      try {
        localStorage.setItem('imgw_favorites_locations', JSON.stringify(favs));
      } catch (err) {
        console.debug('Cannot save favorites to localStorage', err);
      }
    }
    this.http.post('/api/weather/favorites', { favorites: favs }).subscribe({
      error: (err) => {
        console.debug('Cannot save favorites to server', err);
      },
    });
  }
}
