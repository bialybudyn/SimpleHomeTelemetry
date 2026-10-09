import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { Telemetry } from '../../services/telemetry';
import { DeviceCatalogItem } from '../../models/telemetry.models';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-device-catalog',
  imports: [MatIconModule],
  template: `
    <div class="space-y-6">
      <!-- Baner nagłówkowy: Oficjalny ekosystem Sonoff i Tuya -->
      <div class="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-rose-950/40 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div class="space-y-1.5">
          <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <mat-icon class="text-sm !w-4 !h-4">hub</mat-icon>
            <span>Oficjalne Wsparcie Urządzeń Sonoff & Tuya</span>
          </div>
          <h2 class="text-2xl font-bold text-white tracking-tight">
            Katalog Produktów: Głowice TRVZB, Gniazdka, Wyłączniki i Sensory
          </h2>
          <p class="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Nasz panel i backend bezpośrednio wspierają pełną gamę produktów marki <strong class="text-white">Sonoff (ITEAD)</strong> oraz ekosystemu <strong class="text-white">Tuya</strong> zintegrowanych z koordynatorem Sonoff Dongle Max (układ EFR32MG24).
          </p>
        </div>

        <!-- Szybkie akcje -->
        <div class="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            (click)="telemetry.triggerPermitJoin(160)"
            [disabled]="telemetry.isPairing()"
            class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 text-white text-xs font-semibold shadow-lg shadow-cyan-950/40 transition-all cursor-pointer"
          >
            <mat-icon class="text-sm !w-4 !h-4">{{ telemetry.isPairing() ? 'refresh' : 'sensors' }}</mat-icon>
            <span>{{ telemetry.isPairing() ? 'Parowanie (' + telemetry.pairingRemainingSeconds() + 's)' : 'Włącz tryb parowania (160s)' }}</span>
          </button>
          <a
            href="https://sonoff.tech/pl-pl"
            target="_blank"
            rel="noopener"
            class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors cursor-pointer"
          >
            <mat-icon class="text-sm !w-4 !h-4">open_in_new</mat-icon>
            <span>Katalog Sonoff Polska ↗</span>
          </a>
        </div>
      </div>

      <!-- Filtry marki i kategorii w katalogu -->
      <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div class="flex items-center gap-2">
          <button
            (click)="selectedBrand.set('all')"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer"
            [class.bg-slate-800]="selectedBrand() === 'all'"
            [class.text-white]="selectedBrand() === 'all'"
            [class.text-slate-400]="selectedBrand() !== 'all'"
          >
            Wszystkie marki ({{ catalogItems.length }})
          </button>
          <button
            (click)="selectedBrand.set('Sonoff')"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
            [class.bg-rose-500/20]="selectedBrand() === 'Sonoff'"
            [class.text-rose-300]="selectedBrand() === 'Sonoff'"
            [class.border]="selectedBrand() === 'Sonoff'"
            [class.border-rose-500/30]="selectedBrand() === 'Sonoff'"
            [class.text-slate-400]="selectedBrand() !== 'Sonoff'"
          >
            <span class="w-2 h-2 rounded-full bg-rose-500"></span>
            <span>Sonoff (10)</span>
          </button>
          <button
            (click)="selectedBrand.set('Tuya')"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
            [class.bg-cyan-500/20]="selectedBrand() === 'Tuya'"
            [class.text-cyan-300]="selectedBrand() === 'Tuya'"
            [class.border]="selectedBrand() === 'Tuya'"
            [class.border-cyan-500/30]="selectedBrand() === 'Tuya'"
            [class.text-slate-400]="selectedBrand() !== 'Tuya'"
          >
            <span class="w-2 h-2 rounded-full bg-cyan-500"></span>
            <span>Tuya & WiFi (4)</span>
          </button>
        </div>

        <div class="text-xs text-slate-400 font-mono">
          Protokół: Zigbee 3.0 • Koordynator: Sonoff Dongle Max (EFR32MG24)
        </div>
      </div>

      <!-- Siatka kart urządzeń z katalogu -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        @for (item of filteredCatalog(); track item.id) {
          <div class="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 hover:border-slate-700/80 transition-all flex flex-col justify-between">
            <div>
              <!-- Nagłówek karty -->
              <div class="flex items-start justify-between gap-3 mb-2.5">
                <div>
                  <div class="flex items-center gap-2 mb-1">
                    <span
                      class="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-md border"
                      [class.bg-rose-500/10]="item.brand === 'Sonoff'"
                      [class.text-rose-400]="item.brand === 'Sonoff'"
                      [class.border-rose-500/20]="item.brand === 'Sonoff'"
                      [class.bg-cyan-500/10]="item.brand === 'Tuya'"
                      [class.text-cyan-400]="item.brand === 'Tuya'"
                      [class.border-cyan-500/20]="item.brand === 'Tuya'"
                    >
                      {{ item.brand }}
                    </span>
                    <span class="text-[10px] font-mono text-slate-400 font-semibold">
                      {{ item.model }}
                    </span>
                  </div>
                  <h3 class="text-base font-bold text-white tracking-tight">
                    {{ item.name }}
                  </h3>
                </div>

                <div
                  class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
                  [class]="getCategoryIconBg(item.category)"
                >
                  <mat-icon class="text-lg">{{ getCategoryIcon(item.category) }}</mat-icon>
                </div>
              </div>

              <!-- Opis urządzenia -->
              <p class="text-xs text-slate-300 leading-relaxed mb-4">
                {{ item.description }}
              </p>

              <!-- Cechy i parametry -->
              <div class="space-y-1.5 mb-4">
                <div class="text-[10px] font-mono uppercase font-bold text-slate-500">Obsługiwane funkcje w panelu:</div>
                <div class="flex flex-wrap gap-1.5">
                  @for (feat of item.features; track feat) {
                    <span class="text-[11px] px-2 py-0.5 rounded-md bg-slate-950 border border-slate-800 font-mono text-slate-300">
                      ✓ {{ feat }}
                    </span>
                  }
                </div>
              </div>
            </div>

            <!-- Stopka: Instrukcja parowania i zasilanie -->
            <div class="pt-3 border-t border-slate-800/80 space-y-2.5">
              <div class="flex items-start gap-2 text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60 font-mono">
                <mat-icon class="text-xs text-cyan-400 !w-3.5 !h-3.5 shrink-0 mt-0.5">sensors</mat-icon>
                <div>
                  <strong class="text-slate-300">Parowanie:</strong> {{ item.pairingGuide }}
                </div>
              </div>

              <div class="flex items-center justify-between text-[11px]">
                <span class="font-mono text-slate-500">
                  Zasilanie: {{ item.batteryPowered ? 'Bateria' : 'Sieć 230V AC' }}
                </span>
                @if (item.category === 'fan' || item.id.includes('gotze') || item.pairingGuide.includes('Wi-Fi')) {
                  <button
                    (click)="telemetry.triggerWifiPairing('Domowa_Siec_WiFi', '', 160)"
                    class="text-xs text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer flex items-center gap-1"
                  >
                    <mat-icon class="text-xs !w-3.5 !h-3.5">wifi_find</mat-icon>
                    <span>Parowanie Wi-Fi (160s) →</span>
                  </button>
                } @else {
                  <button
                    (click)="telemetry.triggerPermitJoin(160)"
                    class="text-xs text-cyan-400 hover:text-cyan-300 font-semibold cursor-pointer flex items-center gap-1"
                  >
                    <mat-icon class="text-xs !w-3.5 !h-3.5">sensors</mat-icon>
                    <span>Parowanie Zigbee (160s) →</span>
                  </button>
                }
              </div>
            </div>

          </div>
        }
      </div>

    </div>
  `,
})
export class DeviceCatalog {
  readonly telemetry = inject(Telemetry);
  readonly selectedBrand = signal<'all' | 'Sonoff' | 'Tuya'>('all');

  readonly catalogItems: DeviceCatalogItem[] = [
    {
      id: 'sonoff-trvzb-gen2',
      brand: 'Sonoff',
      model: 'TRVZB Gen 2',
      name: 'Sonoff TRVZB Gen 2 (Nowa Generacja)',
      category: 'climate',
      description: 'Zaawansowana inteligentna głowica termostatyczna nowej generacji. Ultra-cichy silnik krokowy, regulacja nastawy co 0.5°C, algorytm PID, ochrona przed zamarzaniem, blokada dziecięca i detekcja otwartego okna.',
      features: ['Nastawa zadana (5-30°C)', 'Tryby Heat/Auto/Off', 'Blokada rodzicielska', 'Detekcja otwartego okna', 'Kalibracja temp.', 'Raport baterii'],
      batteryPowered: true,
      pairingGuide: 'Włóż baterie, przytrzymaj przycisk na pokrętle przez 5 sekund aż dioda zamiga, a symbol Zigbee zacznie pulsować.',
    },
    {
      id: 'sonoff-trvzb',
      brand: 'Sonoff',
      model: 'TRVZB',
      name: 'Sonoff TRVZB Smart Radiator Valve',
      category: 'climate',
      description: 'Głowica termostatyczna Zigbee 3.0 montowana bezpośrednio na zaworze grzejnika M30x1.5. Zapewnia automatyczne ogrzewanie strefowe i oszczędność energii.',
      features: ['Zadana temperatura', 'Bieżący odczyt', 'Tryb pracy', 'Stan zaworu (grzeje/idle)', 'Bateria %'],
      batteryPowered: true,
      pairingGuide: 'Przytrzymaj środkowy przycisk przez 5 sekund aż ikona Wi-Fi/Zigbee zacznie migać.',
    },
    {
      id: 'sonoff-s26r2zb',
      brand: 'Sonoff',
      model: 'S26R2ZB',
      name: 'Sonoff S26R2ZB Smart Plug 16A',
      category: 'plug',
      description: 'Sterowane bezprzewodowo gniazdko elektryczne Zigbee 3.0 o obciążeniu do 16A (4000W). Działa również jako wzmacniacz sygnału (router) w sieci Zigbee mesh.',
      features: ['Zdalne załączanie ON/OFF', 'Funkcja Zigbee Router', 'Stan po zaniku zasilania', 'Diody LED statusu'],
      batteryPowered: false,
      pairingGuide: 'Włóż do gniazdka 230V, przytrzymaj przycisk zasilania przez 5 sekund, aż zielona dioda LED zacznie szybko migać.',
    },
    {
      id: 'sonoff-s40zb',
      brand: 'Sonoff',
      model: 'S40ZB / S31 Lite',
      name: 'Sonoff S40ZB / S31 Smart Plug & Power Meter',
      category: 'plug',
      description: 'Inteligentne gniazdko Zigbee z wbudowanym pomiarem parametrów sieci elektrycznej: mocy chwilowej (W), napięcia (V), prądu (A) i zużycia energii (kWh).',
      features: ['ON/OFF', 'Moc chwilowa (W)', 'Napięcie (V)', 'Natężenie (A)', 'Zużycie energii (kWh)', 'Ochrona przeciążeniowa'],
      batteryPowered: false,
      pairingGuide: 'Przytrzymaj przycisk boczny przez 5 sekund, aż dioda LED wejdzie w tryb szybkiego mignięcia.',
    },
    {
      id: 'sonoff-basic-zb1gsp',
      brand: 'Sonoff',
      model: 'BASIC-ZB1GSP',
      name: 'Sonoff BASIC-ZB1GSP DIN Rail Smart Switch 32A',
      category: 'switch',
      description: 'Wysokoprądowy przekaźnik na standardową szynę DIN 35mm (1 moduł 18mm) o obciążalności do 32A (7680W). Wyposażony w rozłączanie dwubiegunowe (L+N), zaawansowany pomiar energii (W, V, A, kWh) oraz konfigurowalną ochronę przeciążeniową.',
      features: [
        'Obciążenie 32A / 7680W (Szyna DIN 35mm)',
        'Rozłączanie dwubiegunowe L + N',
        'Pomiar energii w czasie rzeczywistym (W, V, A, kWh)',
        'Zabezpieczenie przeciążeniowe (OVP / OCP / OPP)',
        'Wbudowany Router Zigbee 3.0 Mesh',
        'Stan po powrocie zasilania (Power-On Behavior)',
        'Tryb impulsowy (Inching Mode) & Blokada przycisku',
      ],
      batteryPowered: false,
      pairingGuide: 'Zamontuj w rozdzielnicy elektrycznej na szynie DIN 35mm. Po podłączeniu zasilania przytrzymaj przycisk na obudowie przez 5 sekund, aż niebieska dioda LED zacznie szybko migać.',
    },
    {
      id: 'sonoff-zbminir2',
      brand: 'Sonoff',
      model: 'ZBMINIR2',
      name: 'Sonoff ZBMINIR2 Extreme Switch',
      category: 'switch',
      description: 'Miniaturowy przekaźnik dopuszkowy Zigbee 3.0 do montażu w puszce podtynkowej. Obsługuje przełączniki tradycyjne, dzwonkowe oraz schodowe.',
      features: ['Przełącznik obwodu ON/OFF', 'Zigbee Router Mesh', 'Tryb odłączenia przekaźnika (Detach)', 'Stan zasilania'],
      batteryPowered: false,
      pairingGuide: 'Przytrzymaj przycisk parowania na obudowie przez 5 sekund lub przełącz 3 razy podłączony włącznik ścienny.',
    },
    {
      id: 'sonoff-zbmini-l2',
      brand: 'Sonoff',
      model: 'ZBMINI-L2',
      name: 'Sonoff ZBMINI-L2 (Bez Neutralnego N)',
      category: 'switch',
      description: 'Najmniejszy na rynku przekaźnik Zigbee niewymagający doprowadzania przewodu neutralnego N. Idealny do modernizacji oświetlenia w starszych instalacjach.',
      features: ['Sterowanie oświetleniem', 'Brak przewodu N', 'Brak kondensatora anti-flicker', 'Kompaktowy rozmiar'],
      batteryPowered: false,
      pairingGuide: 'Przełącz włącznik podłączony do S1/S2 3 razy w ciągu 3 sekund, aż dioda zamiga na zielono.',
    },
    {
      id: 'sonoff-snzb-04',
      brand: 'Sonoff',
      model: 'SNZB-04',
      name: 'Sonoff SNZB-04 Kontaktron Drzwi / Okien',
      category: 'contact',
      description: 'Dyskretny bezprzewodowy czujnik otwarcia drzwi, okien, szaf i bram. Wykrywa stan magnetyczny i natychmiast raportuje naruszenie obwodu.',
      features: ['Stan Otwarte/Zamknięte', 'Bateria CR2032', 'Natychmiastowe powiadomienie', 'Historia zdarzeń'],
      batteryPowered: true,
      pairingGuide: 'Użyj dołączonej igły i wciśnij przycisk parowania w otworze przez 5 sekund, aż dioda LED zamiga 3 razy.',
    },
    {
      id: 'sonoff-snzb-03',
      brand: 'Sonoff',
      model: 'SNZB-03',
      name: 'Sonoff SNZB-03 Czujnik Ruchu PIR',
      category: 'occupancy',
      description: 'Bezprzewodowy czujnik ruchu na podczerwień o zasięgu 6 metrów i kącie detekcji 110 stopni. Do automatyzacji oświetlenia i systemów alarmowych.',
      features: ['Wykrywanie ruchu PIR', 'Czas podtrzymania obecności', 'Kompaktowa obudowa', 'Bateria CR2450'],
      batteryPowered: true,
      pairingGuide: 'Wciśnij szpilką przycisk parowania przez 5 sekund do momentu potrójnego mignięcia czerwonej diody LED.',
    },
    {
      id: 'sonoff-snzb-05',
      brand: 'Sonoff',
      model: 'SNZB-05',
      name: 'Sonoff SNZB-05 Czujnik Zalania Wodą',
      category: 'water_leak',
      description: 'Precyzyjny czujnik wycieku i zalania wodą ze złoconymi sondami pomiarowymi IP67. Chroni dom przed zalaniem pod pralką, zmywarką lub w kotłowni.',
      features: ['Alarm zalania cieczą', 'Wodoodporność IP67', 'Złocone elektrody', 'Powiadomienie krytyczne'],
      batteryPowered: true,
      pairingGuide: 'Wciśnij i przytrzymaj przycisk na górnej pokrywie przez 5 sekund, aż wskaźnik LED zamiga.',
    },
    {
      id: 'sonoff-snzb-02d',
      brand: 'Sonoff',
      model: 'SNZB-02D',
      name: 'Sonoff SNZB-02D Termohigrometr z Ekranem LCD',
      category: 'sensor',
      description: 'Czujnik temperatury i wilgotności powietrza wyposażony w duży czytelny wyświetlacz LCD oraz szwajcarski sensor Sensirion o dokładności do ±0.2°C.',
      features: ['Ekran LCD 2.5 cala', 'Dokładność ±0.2°C / ±2%RH', 'Historia pomiarów', 'Bateria CR2450 do 2 lat'],
      batteryPowered: true,
      pairingGuide: 'Przytrzymaj przycisk parowania z tyłu obudowy przez 5 sekund, aż ikona sygnału na ekranie zacznie migać.',
    },
    {
      id: 'sonoff-snzb-02',
      brand: 'Sonoff',
      model: 'SNZB-02',
      name: 'Sonoff SNZB-02 Czujnik Temp. i Wilgotności v1 (Bez LCD)',
      category: 'sensor',
      description: 'Klasyczny miniaturowy czujnik temperatury i wilgotności Zigbee 3.0 v1 (wersja bez wyświetlacza LCD). Dyskretny, zasilany baterią CR2450, idealny do schowania w pomieszczeniach.',
      features: ['Pomiar temperatury (°C)', 'Pomiar wilgotności (%RH)', 'Raport poziomu baterii', 'Kompaktowa obudowa', 'Protokół Zigbee 3.0'],
      batteryPowered: true,
      pairingGuide: 'Wciśnij szpilką przycisk reset na bocznej krawędzi obudowy przez 5 sekund, aż czerwona dioda LED zamiga 3 razy.',
    },
    {
      id: 'tuya-ts011f',
      brand: 'Tuya',
      model: 'TS011F',
      name: 'Tuya TS011F Smart Plug z Licznikiem Energii',
      category: 'plug',
      description: 'Popularne gniazdko Zigbee 3.0 ekosystemu Tuya Smart / Smart Life. Precyzyjny pomiar napięcia (V), natężenia (A), mocy (W) oraz łącznego zużycia energii (kWh).',
      features: ['ON/OFF', 'Moc czynna (W)', 'Napięcie sieci (V)', 'Prąd (A)', 'Licznik energii (kWh)', 'Router Zigbee'],
      batteryPowered: false,
      pairingGuide: 'Przytrzymaj przycisk zasilania przez 5-7 sekund, aż dioda LED zacznie szybko pulsować na niebiesko/czerwono.',
    },
    {
      id: 'tuya-ts0601-radar',
      brand: 'Tuya',
      model: 'TS0601 Radar mmWave',
      name: 'Tuya mmWave Radar Obecności 24GHz (ZY-M100)',
      category: 'occupancy',
      description: 'Zaawansowany radar mikrofalowy fal milimetrowych (mmWave). Wykrywa nie tylko ruch, ale również statyczną obecność człowieka (oddech, czytanie) oraz natężenie światła (lux).',
      features: ['Radar obecności 24GHz', 'Wykrywanie mikroruchów (oddech)', 'Czujnik zmierzchu (lux)', 'Zasięg do 9m'],
      batteryPowered: false,
      pairingGuide: 'Wciśnij przycisk reset na obudowie przez 5 sekund, aż dioda wskaźnikowa wejdzie w stan parowania.',
    },
    {
      id: 'tuya-ts0001-switch',
      brand: 'Tuya',
      model: 'TS0001',
      name: 'Tuya TS0001 1-Kanałowy Wyłącznik Ścienny',
      category: 'switch',
      description: 'Dopuszkowy uniwersalny moduł przekaźnikowy Zigbee 3.0 do sterowania obwodami oświetlenia lub urządzeniami o mocy do 2300W.',
      features: ['Przełącznik ON/OFF', 'Współpraca z łącznikami ściennymi', 'Kompaktowy rozmiar', 'Zigbee 3.0 Mesh'],
      batteryPowered: false,
      pairingGuide: 'Użyj przycisku reset i przytrzymaj przez 5 sekund do szybkiego migania diody.',
    },
    {
      id: 'gotze-jensen-gow007',
      brand: 'Tuya',
      model: 'GOW 007 7w1',
      name: 'Götze & Jensen GOW 007 7w1 (Wentylator Kolumnowy Wi-Fi Tuya)',
      category: 'fan',
      description: 'Wentylator 7w1 sterowany przez domową sieć Wi-Fi w ekosystemie Tuya Smart / Smart Life (nie wymaga bramki Zigbee). Posiada 12 prędkości nawiewu, oscylację 70°, jonizację powietrza, nawilżacz mgiełkowy, lampę UV sterylizującą oraz timer.',
      features: ['12 biegów prędkości', 'Jonizator powietrza (Ion)', 'Nawilżacz ultradźwiękowy', 'Lampa UV sterylizująca', 'Oscylacja pozioma 70°', 'Timer do 12h', 'Komunikacja Wi-Fi (Tuya Cloud / Local)'],
      batteryPowered: false,
      pairingGuide: 'Urządzenie sieciowe Wi-Fi (nie wymaga parowania Zigbee permit-join). Podłącz do 230V, przytrzymaj przycisk Wi-Fi/Zasilania przez 5 s aż ikona Wi-Fi zamiga, a następnie sparuj w aplikacji Tuya / Smart Life w domowej sieci Wi-Fi.',
    },
  ];

  filteredCatalog(): DeviceCatalogItem[] {
    const brand = this.selectedBrand();
    if (brand === 'all') return this.catalogItems;
    return this.catalogItems.filter((i) => i.brand === brand);
  }

  getCategoryIcon(cat: string): string {
    switch (cat) {
      case 'fan':
        return 'mode_fan';
      case 'climate':
        return 'thermostat';
      case 'plug':
        return 'power';
      case 'switch':
        return 'toggle_on';
      case 'contact':
        return 'meeting_room';
      case 'occupancy':
        return 'directions_walk';
      case 'water_leak':
        return 'water_damage';
      default:
        return 'sensors';
    }
  }

  getCategoryIconBg(cat: string): string {
    switch (cat) {
      case 'fan':
        return 'bg-cyan-950/60 text-cyan-400 border-cyan-800/80';
      case 'climate':
        return 'bg-rose-950/60 text-rose-400 border-rose-800/80';
      case 'plug':
        return 'bg-emerald-950/60 text-emerald-400 border-emerald-800/80';
      case 'switch':
        return 'bg-cyan-950/60 text-cyan-400 border-cyan-800/80';
      case 'contact':
        return 'bg-indigo-950/60 text-indigo-400 border-indigo-800/80';
      case 'occupancy':
        return 'bg-purple-950/60 text-purple-400 border-purple-800/80';
      case 'water_leak':
        return 'bg-blue-950/60 text-blue-400 border-blue-800/80';
      default:
        return 'bg-slate-950 text-slate-400 border-slate-800';
    }
  }
}
