# Plan Implementacji: Docelowa Lokalizacja, Synchronizacja Zigbee2MQTT oraz Obsługa Urządzeń Wi-Fi eWeLink

Wdrożenie konfiguracji docelowej lokalizacji w Ustawieniach Serwera z wyszukiwarką dowolnych miejscowości w Polsce (OpenStreetMap Nominatim z automatycznym mapowaniem do stacji IMGW), usunięcie przycisku testu budzika, wzmocnienie dwukierunkowej synchronizacji z Zigbee2MQTT oraz optymalizacja obsługi urządzeń Wi-Fi eWeLink/Sonoff na wzór biblioteki `ewelink`.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> Kluczowe decyzje architektoniczne i produktowe uzgodnione w Fazie 1 wywiadu:

- **Confirmed Decision 1 (Baza miejscowości)**: Wyszukiwanie miejscowości w czasie rzeczywistym przez bezpieczne serwerowe proxy OpenStreetMap Nominatim z filtrowaniem `countrycodes=pl`, geokodowaniem współrzędnych i automatycznym przypisywaniem najbliższej stacji IMGW (SYNOP/METEO).
- **Confirmed Decision 2 (Integracja Wi-Fi eWeLink)**: Architektura hybrydowa łącząca bezpośredni protokół LAN Zeroconf (port 8081, AES-128-CBC) z chmurowym API eWeLink (CoolKit v2/v1 i WebSocket) zgodnie ze wzorcem biblioteki `NicklasWallgren/ewelink`. Pobieranie kluczy `devicekey` z konta chmurowego umożliwia bezproblemowe, natychmiastowe sterowanie po sieci lokalnej bez ręcznego wpisywania kluczy.
- **Confirmed Decision 3 (Wpływ docelowej lokalizacji)**: Wybrana w Ustawieniach Serwera miejscowość staje się nadrzędną lokalizacją domową dla całego systemu — definiuje domyślną pogodę IMGW, alerty hydrologiczno-meteorologiczne oraz punkt odniesienia do wyliczania delty temperatur (temperatura w domu vs. na zewnątrz).
- **Confirmed Decision 4 (Przycisk Testu Budzika)**: Całkowite usunięcie przycisku „Test budzika” z paska nagłówka aplikacji (`src/app/app.html`), pozostawiając czysty, minimalistyczny pasek akcji.

---

### 1. Overview & Core Concept

- **Co realizuje**: 
  1. Dodaje w zakładce **Ustawienia Serwera** dedykowany moduł konfiguracji docelowej lokalizacji domowej z wyszukiwarką na żywo obejmującą wszystkie miasta, miasteczka i wsie w Polsce (nieograniczoną tylko do miast ze stacjami IMGW).
  2. Usuwa z górnego paska narzędziowego zbędny przycisk „Test budzika”.
  3. Usprawnia i stabilizuje synchronizację stanu urządzeń Zigbee2MQTT z panelem SimpleHomeTelemetry (obsługa zdarzeń `device_joined`, `device_renamed`, `device_leave`, automatyczne ciche odpytywanie `bridge/request/devices` oraz natychmiastowy rozgłos SSE/WebSocket).
  4. Rozszerza i optymalizuje obsługę urządzeń Wi-Fi (Sonoff/Tuya), integrując jednoklikowe pobieranie metadanych i kluczy szyfrujących (`devicekey`) z chmury eWeLink, automatyczne wiązanie adresów IP w sieci LAN i hybrydowe sterowanie.
- **Grupa docelowa**: Użytkownicy domowych instalacji IoT, posiadający koordynatory Zigbee (np. Sonoff Dongle-M) oraz gniazdka/przekaźniki Wi-Fi (Sonoff S26, S60, ZBMINI, Tuya), chcący monitorować swój dom i warunki pogodowe dla dokładnej lokalizacji zamieszkania.
- **Główna wartość**: Pełna swoboda wyboru dowolnej miejscowości w Polsce, eliminacja błędów synchronizacji z Zigbee2MQTT oraz bezproblemowe dodawanie i sterowanie urządzeniami Wi-Fi bez żmudnego szukania kluczy szyfrujących.

---

### 2. User Experience & Visual Design

#### Kluczowe ścieżki użytkownika (User Flows)
1. **Wybór docelowej miejscowości**:
   - Użytkownik wchodzi w *Ustawienia serwera* $\rightarrow$ nowa podzakładka *Lokalizacja domowa* (lub dedykowana sekcja w centrum administracji).
   - Wpisuje w pole wyszukiwania dowolną miejscowość (np. „Krośniewice”, „Milanówek”, „Zakopane”).
   - Po 300 ms debouncingu pojawia się lista podpowiedzi z województwem i powiatem.
   - Po kliknięciu podgląd pokazuje współrzędne geograficzne oraz automatycznie wyznaczoną najbliższą stację synoptyczną IMGW z odległością w kilometrach.
   - Kliknięcie „Zapisz jako lokalizację domową” zapisuje wybór na serwerze i natychmiast uaktualnia pulpit pogodowy oraz delty czujników.
2. **Czysty nagłówek bez przycisku budzika**:
   - W nagłówku (`app.html`) usunięty zostaje żółty przycisk „Test budzika”, dzięki czemu pasek narzędziowy zyskuje lepszą czytelność i zachowuje spójną hierarchię (wyciszanie dźwięków, konfiguracja urządzeń, wybór motywu).
3. **Synchronizacja Zigbee2MQTT**:
   - Po sparowaniu, zmianie nazwy lub przełączeniu stanu w panelu Zigbee2MQTT, dane w SimpleHomeTelemetry aktualizują się natychmiast bez konieczności odświeżania strony.
   - W Ustawieniach Serwera dostępny jest czytelny przycisk „Synchronizuj z Zigbee2MQTT” ze statusem połączenia z brokerem Mosquitto.
4. **Zarządzanie urządzeniami Wi-Fi eWeLink**:
   - Użytkownik w panelu konfiguracji Wi-Fi może zalogować się do eWeLink: serwer pobiera listę urządzeń, identyfikatory `deviceId` oraz klucze `devicekey`.
   - Urządzenia Wi-Fi natychmiast pojawiają się na pulpicie ze statusem online/offline, a sterowanie działa z priorytetem sieci lokalnej LAN (0 ms opóźnienia), z automatycznym przełączeniem na chmurę w razie braku widoczności LAN.

#### Tożsamość wizualna i stylistyka (Zgodnie z `frontend-design`)
- **Estetyka**: Czysty, techniczny, profesjonalny kokpit IoT (ciemna paleta `slate-950` / `slate-900`, akcenty `cyan-400`, `emerald-400`, `indigo-400`).
- **Typografia**: Liczby, współrzędne, adresy IP i telemetria wyłącznie w krojach `font-mono` / `tabular-nums` dla uniknięcia drgań layoutu.
- **Dyscyplina Anti-Slop & Zero-Pill**: Brak cukierkowych etykiet-pigułek dla metadanych. Wszystkie informacje o lokalizacji, odległości stacji i statusach urządzeń sformatowane jako czysty tekst z subtelnymi separatorami (`·` lub `/`).
- **Gęstość i responsywność**: Układ dopasowany do ekranów od telefonów po ekrany 1440px+ z zachowaniem minimalnego rozmiaru celów dotykowych $\ge 40\text{px}$.

---

### 3. Key Product Decisions & Trade-Offs

- **Decyzja 1: Serwerowe proxy dla OpenStreetMap Nominatim zamiast zapytań bezpośrednio z przeglądarki**
  - *Wybrane rozwiązanie*: Utworzenie bezpiecznego endpointu `/api/locations/search?q=...` w `src/server.ts`, który odpytuje OpenStreetMap z prawidłowym nagłówkiem `User-Agent: SimpleHomeTelemetry/1.0`, buforuje wyniki w pamięci podręcznej i natychmiast kalkuluje najbliższą stację IMGW.
  - *Dlaczego*: Bezpośrednie zapytania z przeglądarki do Nominatim często napotykają na blokady CORS, brak wymaganego `User-Agent` oraz limity zapytań. Serwerowe proxy rozwiązuje te problemy i odciąża klienta.
- **Decyzja 2: Hybrydowe sterowanie urządzeniami Wi-Fi Sonoff/eWeLink**
  - *Wybrane rozwiązanie*: Implementacja dwustopniowego silnika wykonawczego:
    1. Krok A: Bezpośredni HTTP POST na port 8081 urządzenia (`/zeroconf/switch` z AES-128-CBC i `devicekey`).
    2. Krok B: Jeśli urządzenie nie odpowiada w LAN w ciągu 1200 ms, automatyczne wysłanie żądania do CoolKit/eWeLink Cloud API (REST/WebSocket) na wzór biblioteki `NicklasWallgren/ewelink`.
  - *Dlaczego*: Zapewnia to 100% niezawodności — urządzenia w sieci domowej działają błyskawicznie bez internetu, a urządzenia chwilowo niedostępne w LAN są sterowane przez chmurę.
- **Decyzja 3: Stała synchronizacja Zigbee2MQTT w tle bez włączania trybu parowania**
  - *Wybrane rozwiązanie*: Ciche odpytywanie `bridge/request/devices` co 45 sekund oraz nasłuchiwanie zdarzeń `bridge/event` bez wysyłania `permit_join: true`.
  - *Dlaczego*: Zapobiega to ciągłemu otwieraniu sieci Zigbee na nowe urządzenia (co irytowało użytkownika), zapewniając jednocześnie pełną świeżość listy urządzeń.

---

### 4. Technical Architecture & Data Strategy

```text
┌───────────────────────────────────────────────────────────────────────────────┐
│                           PRZEGLĄDARKA / KLIENT ANGULAR                        │
│                                                                               │
│  ┌────────────────────────┐  ┌────────────────────────┐  ┌─────────────────┐  │
│  │     Pulpit Domowy      │  │   Ustawienia Serwera   │  │ Moduł Pogodowy  │  │
│  │ (Bez 'Testu Budzika')  │  │ (Wyszukiwarka Miast PL)│  │ (IMGW + Delta)  │  │
│  └───────────┬────────────┘  └───────────┬────────────┘  └────────┬────────┘  │
│              │                           │                        │           │
│              ▼                           ▼                        ▼           │
│       TelemetryService             WeatherService           SettingsService   │
│       (SSE / WebSockets)          (Nominatim + IMGW)       (Target Location)  │
└──────────────────────┬───────────────────┬────────────────────────┬───────────┘
                       │                   │                        │
                       ▼                   ▼                        ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                              SERWER NODE.JS / EXPRESS                         │
│                                                                               │
│  ┌────────────────────────┐  ┌────────────────────────┐  ┌─────────────────┐  │
│  │  Proxy OpenStreetMap   │  │   Manager Zigbee2MQTT  │  │ eWeLink Hybrid  │  │
│  │  Nominatim + Haversine │  │  (Mosquitto MQTT Sub)  │  │ (LAN + CoolKit) │  │
│  └───────────┬────────────┘  └───────────┬────────────┘  └────────┬────────┘  │
│              │                           │                        │           │
│              ▼                           ▼                        ▼           │
│       target_location.json       Mosquitto Broker       Gniazdka Wi-Fi Sonoff │
│      (Trwała konfiguracja)      (Port 1883 / Z2M)        (Port 8081 / Chmura) │
└───────────────────────────────────────────────────────────────────────────────┘
```

#### Model danych docelowej lokalizacji (`TargetLocationConfig`)
```ts
interface TargetLocationConfig {
  name: string;              // np. "Krośniewice"
  voivodeship: string;       // np. "Łódzkie"
  county?: string;           // np. "kutnowski"
  lat: number;               // np. 52.2531
  lon: number;               // np. 19.1685
  nearestSynopId: string;    // np. "12330" (Płock)
  nearestSynopName: string;  // np. "Płock"
  synopDistanceKm: number;   // np. 28.4
  updatedAt: string;
}
```

#### Komponenty i punkty integracji do modyfikacji:
1. **`src/app/app.html`**:
   - Usunięcie przycisku `<!-- Przycisk Testu Głośnego Alarmu Budzika -->` (linie 131–139).
2. **`src/server.ts`**:
   - Dodanie endpointów `/api/locations/search?q=...` (z integracją OpenStreetMap Nominatim i obliczaniem odległości Haversine do stacji IMGW).
   - Dodanie endpointów `/api/settings/target-location` (GET i POST) z zapisem w `target_location.json`.
   - Zoptymalizowanie obsługi MQTT dla tematów `zigbee2mqtt/bridge/event`, `bridge/response/devices` oraz wyzwalania `bridge/request/devices`.
   - Rozbudowa obsługi Wi-Fi eWeLink (szybsze kojarzenie `devicekey` i adresów IP, uaktualnienie statusu online).
3. **`src/app/components/server-settings/`**:
   - Dodanie sekcji / podzakładki `Lokalizacja docelowa` z polem autocomplete, podglądem mapowanej stacji IMGW i przyciskiem zapisu.
4. **`src/app/services/weather.ts` & `src/app/services/telemetry.ts`**:
   - Automatyczne wczytywanie docelowej lokalizacji przy starcie i ustawianie jej jako domyślnej w całym systemie.
   - Wzmocnienie obsługi komunikatów SSE o zmianach stanu urządzeń Zigbee.
