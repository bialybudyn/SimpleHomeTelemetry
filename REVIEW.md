# Code review — SimpleHomeTelemetry

Stan na commit `3fc321e`. Wdrożenie produkcyjne to to, co instaluje `install.sh`:
Mosquitto + Zigbee2MQTT + **serwer Node (`src/server.ts`, Angular SSR, port 3000)** jako usługa `iot-telemetry`.
Backend w Pythonie (`backend_*.py`, `database.py`, `Dockerfile`, `docker-compose.yml`) **nie jest w ogóle uruchamiany**.

Raport jest uporządkowany według zgłoszonych objawów, potem bezpieczeństwo, śmieci i rekomendacja.

---

## 1. Gniazdka Sonoff Wi-Fi „zatykają się”, gdy panel działa  🔴 KRYTYCZNE

### 1.1 Skanowanie sieci co 45 sekund
`src/server.ts:4048`
```ts
setInterval(() => { performDongleMaxAutoDiscovery().catch(() => {}); }, 45000);
```
Każdy cykl (`server.ts:3814-4034` → `sonoff-lan-service.ts:1203-1297`):

- skanuje **co najmniej 4 podsieci** (`192.168.4`, `192.168.1`, `192.168.0`, podsieć hosta, podsieć Dongle) — po ~90 adresów każda, plus wszystko z tablicy ARP,
- wysyła do **każdego** adresu `POST http://IP:8081/zeroconf/info` — **wszystkie naraz** (`Promise.allSettled` bez limitu współbieżności),
- odpytuje `http://<x>.1/api/dhcp/clients` — czyli Twój **router**,
- uruchamia `execSync('ip neigh')` i `execSync('arp -an')` — **blokuje pętlę zdarzeń Node** (cały serwer staje),
- publikuje do Z2M nieistniejący temat `bridge/request/devices`.

Gniazdka Sonoff (ESP8266/ESP32) mają bardzo mały stos TCP — obsługują kilka równoległych połączeń.
Co 45 s dostają serię zapytań HTTP, a do tego utrzymują połączenie z chmurą eWeLink. Efekt: zapchany stos,
komendy z aplikacji eWeLink docierają z dużym opóźnieniem. **Po wyłączeniu LXC problem znika — zgodnie z objawem.**

### 1.2 Pojedyncze kliknięcie = nawet kilkanaście zapytań
`sonoff-lan-service.ts:1021-1060` + `sendSonoffHttpRequest` (`:713-800`):

- 3 warianty ścieżki/payloadu (`/switch`, `/switches`, `/switch` z multi),
- każda odpowiedź z błędem → **rekurencyjna** próba `/switches` (`:769-779`),
- każda odpowiedź z błędem przy podanym kluczu → ponowienie **bez szyfrowania** (`:782-800`),
- timeout 2,2 s na próbę, potem fallback do chmury eWeLink.

Przy złym kluczu (patrz 1.3) każda próba LAN się nie udaje, a komenda ostatecznie idzie przez chmurę po kilku sekundach.

### 1.3 Zły klucz szyfrowania
W trybie eWeLink LAN (nie-DIY) payload szyfruje się AES-128-CBC kluczem `MD5(devicekey)` — **devicekey konkretnego urządzenia**.
Kod używa `matchedEwe.deviceKey || matchedEwe.apiKey` (`server.ts:2118, 2945, 3544, 3723`), a `apiKey` to klucz **konta użytkownika** — z nim urządzenie odrzuci każdą komendę.

### 1.4 Brak odczytu stanu
- `/zeroconf/info` bez szyfrowania działa **tylko w trybie DIY**. W normalnym trybie eWeLink stan (switch, power, voltage, current) urządzenie rozgłasza przez **mDNS (`_ewelink._tcp`, rekordy TXT `data1..data4`, szyfrowane devicekey)**. W kodzie nie ma żadnego nasłuchu mDNS → panel nigdy nie dostaje prawdziwych odczytów.
- Brak cyklicznego/zdarzeniowego odświeżania stanu — panel pokazuje to, co sam ostatnio wysłał.

### 1.5 Sztuczne dane
`server.ts:3966-3993` — nowo „wykryte” gniazdko dostaje zmyślone wartości:
```ts
power: found.power ?? (found.switch === 'on' ? 140 : 0),
voltage: found.voltage ?? 230,
current: found.current ?? (found.switch === 'on' ? 0.6 : 0),
energy: 0.1, linkquality: 100, overload_power_threshold: 4000, ...
```
Model zawsze jest ustawiany na `"SONOFF Smartplug S60TFP Wi-Fi 16A"` (`sonoff-lan-service.ts:1279`), niezależnie od tego, co odpowiedziało.
Przy wyłączeniu `power`/`current` są zerowane bez potwierdzenia (`server.ts:2964-2967`).

### 1.6 Wbudowane klucze CoolKit
`sonoff-lan-service.ts:19-24` — zaszyty `appId`/`appSecret` cudzej aplikacji. Może zostać w każdej chwili unieważniony; logowanie do chmury przestanie działać.
Hasło do konta eWeLink trzymane jest jawnym tekstem w `ewelink_config.json`.

---

## 2. Zigbee2MQTT — brak danych, brak odczytu „na żądanie”  🔴 KRYTYCZNE

### 2.1 Komunikaty `availability` nadpisują stan urządzenia
Z2M publikuje `zigbee2mqtt/<nazwa>/availability` z `{"state":"online"}` / `{"state":"offline"}`.
Parser (`server.ts:1420-1460`) ignoruje tylko `/get` i `/set`, więc ten komunikat trafia do ścieżki telemetrii:
- `dev.state = "online"` → **gniazdko/przekaźnik traci stan ON/OFF** (`:1629`),
- `{"state":"offline"}` ustawia `connection_status = 'online'` i odświeża `last_seen` (`:1567-1569`) — urządzenie offline wygląda na żywe,
- dopisuje fałszywy punkt do historii.

### 2.2 Nazwy z ukośnikiem
Z2M pozwala na `friendly_name` typu `salon/termometr`. Kod bierze tylko pierwszy segment tematu (`baseTopic = topicParts[0]`, `:1423`) → nie dopasuje urządzenia i **utworzy „ducha”** o nazwie `salon` (`:1540-1558`). To bardzo prawdopodobna przyczyna „część urządzeń nie dostaje danych”.

### 2.3 Zapisywana jest tylko zahardkodowana lista pól
`server.ts:1510-1662` — przepisywane są wyłącznie pola znane z góry (temperature, humidity, battery, power, contact, ...).
Wszystko inne (`pressure`, `co2`, `voc`, `pm25`, `formaldehyd`, `soil_moisture`, `action`, `illuminance_lux`, `device_temperature`, `energy` z innym kluczem, ...) jest **wyrzucane**.
Lista `exposes` z `bridge/devices` jest w ogóle ignorowana — aplikacja nie wie, co dane urządzenie potrafi.

### 2.4 Odczyt „na żądanie” nie działa
`requestDeviceSyncAll()` (`server.ts:1149-1176`):
- publikuje do `bridge/request/devices` i `bridge/config/devices` — **takich endpointów w Z2M nie ma** (lista urządzeń przychodzi sama jako retained `bridge/devices`),
- do każdego urządzenia wysyła `/get` z `{"state":""}` — czujniki nie mają atrybutu `state`, więc nic nie odpowiada. Poprawny `/get` musi zawierać atrybuty z `exposes`, które mają bit `access & 2` (GET),
- urządzenia bateryjne (śpiące) i tak nie odpowiedzą na `/get` — dla nich jedyne źródło to ostatni retained/zgłoszony stan.

### 2.5 Status online/offline
`isDeviceOnline()` (`server.ts:772-780`) = „ostatni komunikat < 60 min”. Czujniki bateryjne (kontaktrony, zalania) raportują co kilka godzin → pokazywane jako offline. Prawidłowe źródło to temat `availability` z Z2M.

### 2.6 Rejestr urządzeń
- Urządzenie usunięte z Z2M nie znika z panelu; zmiana nazwy w Z2M zostawia stare „duchy”.
- Heurystyka „migracji tymczasowych urządzeń” (`:1341-1372`) skleja urządzenia po znormalizowanej nazwie — może połączyć dwa różne.
- `POST /api/devices/:ieee/set` dla nieznanego `ieee` **tworzy nowe urządzenie** (`:2703-2719`).
- `tryLoadExistingZ2mDevices()` (`:1752-1834`) czyta bezpośrednio plik `database.db` Z2M i parsuje YAML regexem — zbędne i kruche, skoro `bridge/devices` jest retained.
- Stan po `/set` jest ustawiany optymistycznie (`:2728`) bez potwierdzenia.

### 2.7 Historia i wydajność
- Każdy komunikat MQTT → nowy punkt w `telemetryStore` w RAM **bez limitu** + 2 broadcasty z pełnym obiektem urządzenia.
- Na dysk zapisywane jest tylko **ostatnie 200 punktów na urządzenie**, całym plikiem JSON (`:711-720`). Po restarcie historia to kilka godzin; zakresy 30 d / 360 d / 720 d w UI są fikcją.
- UI twierdzi, że dane pochodzą z „bazy SQLite” (`analytics-modal.ts:427`, `analytics-view.ts:384`) — w serwerze Node nie ma żadnej bazy.

---

## 3. Tuya / wentylator 7w1 (GOW 007)  🔴 KRYTYCZNE

- **Biblioteka `tinytuya` nie jest instalowana** przez `install.sh` → `scripts/tinytuya_bridge.py` wywala się na imporcie, każda komenda kończy się błędem i fallbackiem do TuyAPI.
- Każda komenda = **nowy proces Pythona** (`tinytuya-manager.ts:72-109`, timeout 12 s). Brak trwałego połączenia → brak zdarzeń o zmianie stanu, brak odczytu stanu w tle.
- **Mapowanie DP wentylatora jest zgadnięte** (`tinytuya_bridge.py:262-285`: speed=3, mode=2, oscillation=8, timer=5, jonizator/nawilżacz/UV=101/102/103). Nie pochodzi z urządzenia. Trzeba odczytać prawdziwe DP (`tinytuya` status / schemat z chmury Tuya) i zmapować per model.
- Domyślna wersja protokołu `3.3`; nowsze urządzenia to 3.4/3.5 — kod próbuje wersji po kolei, co dodatkowo spowalnia.
- Bridge również skanuje porty i pinguje adresy (`find_working_tuya_target`, `scan_subnet_for_tuya_port`) — kolejny ruch w sieci.

---

## 4. Bezpieczeństwo  🟠 WYSOKIE

- **Brak jakiejkolwiek autoryzacji**, serwer słucha na `0.0.0.0:3000`. Każdy w sieci może:
  - `POST /api/system/git-update` — uruchamia `git fetch/pull` na serwerze,
  - `GET /api/backup/export` — pobiera wszystkie `local_key` Tuya, klucze Sonoff i dane eWeLink,
  - `POST /api/devices/reset`, `/api/reset-data` — kasuje dane,
  - `POST /api/sonoff/ewelink/login` itd.
- `GET /api/devices` wysyła do przeglądarki pełne obiekty z `local_key` i `sonoff_api_key`.
- Sekrety w jawnych plikach JSON w katalogu roboczym; pliki konfiguracyjne (`ewelink_config.json`, `notification_config.json`, `dongle_max_config.json`, cache) **są śledzone przez git**. W historii nie znalazłem haseł — jedynie Twój adres e-mail (wcześniej zaszyty w UI, usunięty w `62507db`).
- Mosquitto: `allow_anonymous true` na wszystkich interfejsach.
- Zaszyte klucze aplikacji CoolKit (pkt 1.6).

---

## 5. Śmieci i problemy strukturalne  🟡

| Co | Gdzie | Uwagi |
|---|---|---|
| Drugi, nieużywany backend w Pythonie | `backend_mqtt.py`, `backend_native.py`, `database.py`, `requirements.txt`, `Dockerfile`, `docker-compose.yml`, `mosquitto.conf`, `configuration.yaml` | Dockerfile uruchamia zupełnie inną aplikację niż `install.sh` |
| Stare UI w czystym JS | `static/`, `public/app.js`, `public/static/` | `public/` jest kopiowane do builda Angulara |
| Fałszywy generator APK | `server.ts:5126+` | ZIP z pustym `classes.dex` udający APK |
| Funkcje demo | `simulator`, `/api/simulate`, `code-viewer`, `installer-view`, `android-viewer` | |
| Artefakty AI Studio | `.aistudio/`, `metadata.json` | |
| Dane runtime w repo | `*_cache.json` (w tym 400 KB `imgw_weather_cache.json`), `*_config.json` | do `.gitignore` + `*.example.json` |
| Monolit | `server.ts` 5658 linii, `device-card.ts` 1922 linie | |
| `package.json` | `start: node server.ts` (pliku nie ma), `lint` = `echo` | |
| Menedżery pakietów | `bun.lock` + `package-lock.json` + `.npmrc` pod pnpm; `install.sh` używa pnpm z `--no-frozen-lockfile` i awaryjnie kasuje `package-lock.json` | wersje zależności niepowtarzalne |
| `angular.json` | `externalDependencies` zawiera `ewelink-api`, którego nie ma w zależnościach | |
| `execSync` w serwerze | `server.ts:657, 676, 2577, 3912, 3925, 4718, 4759, 4798` | blokuje cały serwer |
| Brak README | | |
| Testy | `app.spec.ts` — szablonowy | |

---

## 6. Rekomendacja

Problemów nie da się sensownie załatać punktowo — logika integracji (Sonoff, Tuya, Z2M) jest w dużej mierze zgadnięta, a całość siedzi w jednym pliku z dużą ilością martwego kodu. Proponuję **przepisanie backendu** na małe, testowalne moduły, z zachowaniem tego, co w UI się sprawdza:

1. **Natychmiast (hotfix):** wyłączyć skan co 45 s i skany Tuya, usunąć fałszywe wartości. To powinno od razu odblokować gniazdka.
2. **Porządki:** usunąć martwy kod/pliki (pkt 5), dane runtime do `.gitignore`, jeden lockfile, poprawny `package.json`, README.
3. **Adapter Zigbee2MQTT od nowa:**
   - rejestr urządzeń wyłącznie z `bridge/devices` (retained), z `exposes`,
   - stan = pełny ostatni payload (generycznie, bez listy pól), tematy dopasowywane po pełnym `friendly_name`,
   - `availability` jako źródło online/offline,
   - odczyt na żądanie: `/get` z atrybutami `exposes` mającymi `access & 2`,
   - UI renderuje kafelki z `exposes` zamiast zahardkodowanych pól.
4. **Adapter Sonoff:** jednorazowe pobranie `deviceid` + `devicekey` z chmury eWeLink, potem nasłuch mDNS `_ewelink._tcp` (stan bez odpytywania) + szyfrowane komendy na 8081, **jedno** zapytanie na komendę, bez skanowania sieci.
5. **Adapter Tuya:** trwałe połączenie (TuyAPI / tinytuya w jednym procesie), rzeczywiste DP odczytane z urządzenia, mapowanie per model.
6. **Historia:** SQLite (`better-sqlite3`) z retencją i agregacją.
7. **Bezpieczeństwo:** logowanie (choćby jedno hasło/token), nie wysyłać kluczy do przeglądarki, Mosquitto z użytkownikiem i hasłem.

Alternatywa warta rozważenia: jeśli celem jest po prostu działający panel, Home Assistant ma dojrzałe integracje dla wszystkich trzech ekosystemów (MQTT/Z2M, SonoffLAN, Tuya Local). Własna aplikacja ma sens, jeśli zależy Ci na własnym UI i nauce — wtedy plan powyżej.
