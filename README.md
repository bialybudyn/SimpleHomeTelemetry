# SimpleHomeTelemetry

Lekki panel do domu: czujniki i urządzenia **Zigbee** (przez Zigbee2MQTT), gniazdka **Sonoff Wi-Fi** (eWeLink LAN) i urządzenia **Tuya Wi-Fi** (protokół lokalny). Do tego historia pomiarów, alarmy (e-mail, Telegram) i pogoda IMGW.

Wszystko działa lokalnie. Chmura eWeLink lub Tuya jest potrzebna tylko raz, do pobrania kluczy urządzeń.

## Architektura

```
przeglądarka ──HTTPS/WebSocket──► panel (Node.js, port 3000)
                                   ├─ Zigbee2MQTT driver ──MQTT──► Mosquitto ◄── Zigbee2MQTT ◄── koordynator
                                   ├─ Sonoff driver ── mDNS (stan) + HTTP :8081 (polecenia)
                                   ├─ Tuya driver ── stałe połączenie TCP :6668 (TuyAPI)
                                   └─ SQLite (/var/lib/simplehome/simplehome.db)
```

| Katalog | Zawartość |
|---|---|
| `src/server.ts` | start serwera: Express, Angular SSR, WebSocket |
| `src/backend/` | backend: rejestr urządzeń, historia, powiadomienia, logowanie |
| `src/backend/drivers/` | sterowniki Zigbee2MQTT, Sonoff, Tuya i ich protokoły |
| `src/backend/routes/` | endpointy REST |
| `src/app/` | frontend Angular |

## Instalacja (Debian / Ubuntu / Raspberry Pi OS / LXC)

```bash
git clone https://github.com/bialybudyn/SimpleHomeTelemetry.git
```

```bash
cd SimpleHomeTelemetry && sudo ./install.sh
```

Instalator:
- instaluje Node.js 22, jeśli trzeba,
- buduje panel,
- kopiuje go do `/opt/simplehome`,
- tworzy użytkownika `simplehome` i usługę `simplehome.service`,
- generuje hasło do panelu (wypisuje je na końcu).

**Istniejących instalacji Mosquitto i Zigbee2MQTT nie dotyka.** Na czystym systemie możesz je doinstalować:

```bash
sudo ./install.sh --with-mosquitto --with-z2m
```

Aktualizacja:

```bash
git pull && sudo ./install.sh
```

Przy przejściu ze starej wersji instalator wyłącza usługę `iot-telemetry`. Katalog `/opt/zigbee-telemetry-panel` możesz potem usunąć ręcznie.

### Ustawienia — `/etc/simplehome/panel.env`

| Zmienna | Domyślnie | Opis |
|---|---|---|
| `PANEL_USER` / `PANEL_PASSWORD` | `admin` / losowe | logowanie do panelu; puste hasło wyłącza logowanie |
| `MQTT_URL` | `mqtt://127.0.0.1:1883` | broker MQTT |
| `MQTT_USER` / `MQTT_PASSWORD` | puste | dane logowania do brokera |
| `MQTT_TOPIC` | `zigbee2mqtt` | temat bazowy Zigbee2MQTT |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | adres panelu |
| `TLS_CERT` / `TLS_KEY` | `/etc/simplehome/tls/*.pem` | certyfikat HTTPS (instalator tworzy samopodpisany); zwykłe HTTP na tym porcie tylko przekierowuje na HTTPS; puste = HTTP |
| `DATA_DIR` | `/var/lib/simplehome` | baza i cache |
| `RAW_RETENTION_DAYS` | `30` | jak długo trzymać surowe próbki |
| `HOURLY_RETENTION_DAYS` | `730` | jak długo trzymać średnie godzinowe |
| `INVERTER_RETENTION_DAYS` | `366` | jak długo trzymać historię falownika (próbki co 5 min i liczniki dzienne) |

Po zmianie uruchom:

```bash
sudo systemctl restart simplehome
```

## Urządzenia

### Zigbee (Zigbee2MQTT)
- Lista urządzeń i ich możliwości przychodzą z Zigbee2MQTT (`bridge/devices`), a kafelek dobiera się do tych możliwości.
- Zapisywany jest **cały** stan urządzenia. Atrybuty bez dedykowanego widoku są w sekcji „Wszystkie atrybuty” na kafelku.
- Przycisk odczytu stanu wysyła `/get` tylko z atrybutami, które urządzenie pozwala odczytać. Czujniki bateryjne nie odpowiadają na `/get`, bo wysyłają dane same po wybudzeniu.
- Status online/offline najlepiej działa z włączonym `availability` w Zigbee2MQTT (`availability: enabled: true` w `configuration.yaml`).

### Sonoff Wi-Fi (eWeLink LAN)
Protokół jest taki sam jak w integracji [SonoffLAN](https://github.com/AlexxIT/SonoffLAN). S60TPF (UIID 190) obsługuje sterowanie lokalne.

- Gniazdka **ogłaszają się same** przez mDNS (`_ewelink._tcp`). Panel nie skanuje sieci.
- Do sterowania potrzebny jest `devicekey` każdego urządzenia. Jest dostępny tylko w chmurze eWeLink, więc trzeba go raz pobrać.
- Import kluczy idzie przez **OAuth 2.0**. Aplikacje z dev.ewelink.cc (rola Standard) nie mogą logować się hasłem — `/v2/user/login` zwraca błąd 407.
  1. Załóż konto na [dev.ewelink.cc](https://dev.ewelink.cc) i utwórz aplikację.
  2. W aplikacji ustaw Redirect URL `http://<IP-panelu>:3000/api/sonoff/ewelink/oauth/callback`.
  3. W panelu otwórz Wi-Fi → Sonoff, wpisz AppID i AppSecret, a potem kliknij „Zaloguj przez eWeLink”.
  4. Jeśli przekierowanie nie wróci do panelu, wklej adres z paska przeglądarki w pole „Importuj”.
- Alternatywa: wpisz `deviceid` i `devicekey` ręcznie. W trybie DIY klucz nie jest potrzebny.
- **Wymagania sieciowe:**
  - panel i gniazdka w tej samej sieci L2 z działającym multicastem,
  - bez izolacji klientów Wi-Fi i bez drugiego routera po drodze,
  - kontener LXC podłączony przez bridge, nie NAT.
- W aplikacji eWeLink musi być włączone „Sterowanie LAN”, jeśli model ma taką opcję.
- Diagnostyka: w oknie Wi-Fi → Sonoff widać, które urządzenia panel słyszy przez mDNS i czy klucz pasuje.
- Moc, napięcie i prąd: S60TPF odsyła je w odpowiedzi na zapytania LAN. Część modeli POW wysyła pomiary tylko do chmury.

### Tuya Wi-Fi (np. wentylator 7w1)
- **Import kodem QR** (Wi-Fi → Tuya): kod użytkownika z aplikacji Smart Life (Ja → Ustawienia → Konto i bezpieczeństwo), potem skan QR. Pobierane są Device ID, Local Key i **mapa DP**, czyli który numer DP to prędkość, tryb czy oscylacja.
- Dodanie ręczne: Device ID, Local Key i wersja protokołu (3.1, 3.3, 3.4 lub 3.5). Mapę DP możesz wtedy wpisać w ustawieniach urządzenia jako JSON. Surowy stan DP jest widoczny obok.
- Panel utrzymuje jedno stałe połączenie z każdym urządzeniem, więc zmiany z pilota lub aplikacji widać od razu.

### Falownik Deye (logger Solarman)

Sekcja falownika w zakładce **Monitor Energii** czyta falownik Deye SUN-xK-SG04LP3 przez logger Wi-Fi Solarman (protokół V5, port 8899).
Logger nie ma hasła, wystarczy jego numer seryjny. Wpisujesz go w sekcji „Połączenie z loggerem”.

- Odczyt co 30 s (ustawialne): PV, bateria, sieć z podziałem na fazy, zużycie domu, temperatury i liczniki energii.
- Historia przez rok: średnie co 5 min i liczniki dzienne według zegara falownika.
  Wykresy pokazują 24 h, 7 dni, 30 dni i rok.
- Logger dostaje adres z DHCP. Po dwóch nieudanych odczytach panel szuka go w sieci, najwyżej co 5 min:
  - przeszukuje podsieć /24 ostatniego adresu i podsieci serwera,
  - rozpoznaje logger po numerze seryjnym,
  - sam aktualizuje zapisany adres.
- Gdy falownik nie odpowiada dłużej niż 15 min, dostajesz powiadomienie.
- **Sterowanie jest domyślnie wyłączone.** Po włączeniu panel może zmieniać:
  - tryb pracy,
  - limit oddawania i sprzedaż z PV,
  - prądy baterii,
  - ładowanie z sieci,
  - harmonogram (6 przedziałów: moc, minimalny SOC, ładowanie z sieci).

  Każdą zmianę panel sprawdza z zakresem, zapisuje funkcją Modbus 0x10, odczytuje z powrotem i notuje w dzienniku zdarzeń.
  Parametrów baterii (napięcia, typ, progi wyłączenia) panel nie zmienia.

### Przekaźniki SONOFF BASIC-ZB1GSP

Każdy sparowany przekaźnik BASIC-ZB1GSP ma w zakładce **Monitor Energii** własną zwijaną sekcję (sterowanie przez Zigbee2MQTT):

- moc, napięcie, prąd i liczniki energii (dziś, wczoraj, miesiąc, łącznie) na żywo,
- wykres mocy i napięcia (24 h, 7 dni, 30 dni, rok) oraz zużycie dzienne liczone z licznika `total_energy`,
- załączanie i wyłączanie (wyłączenie wymaga potwierdzenia),
- ustawienia: stan po zaniku zasilania, dioda sieci, ochrona nadprądowa, nadnapięciowa i mocy z progami, tryb impulsowy.
  Panel pokazuje tylko te ustawienia, które Zigbee2MQTT zgłasza dla danego urządzenia, sprawdza zakresy i zapisuje zmiany po potwierdzeniu.

### Kamery CCTV (RTSP)

Zakładka **CCTV** pokazuje do 9 kamer na żywo w siatce 3×3; kliknięcie kafelka powiększa obraz (Esc zamyka, strzałki przełączają kamery).

- **Nic nie jest nagrywane.** ffmpeg czyta strumień RTSP i oddaje klatki JPEG tylko przez stdout, a serwer przekazuje je do przeglądarki
  jednym WebSocketem (`/ws/cctv`). Strumień działa tylko, gdy ktoś go ogląda (zatrzymuje się kilka sekund po zamknięciu podglądu).
  Zapisywana jest wyłącznie lista kamer (nazwa i adres) w bazie panelu.
- Kafelek używa strumienia pomocniczego (niska rozdzielczość, 5 kl/s), powiększenie — głównego (do 1920 px, 12 kl/s).
  Podanie strumienia pomocniczego mocno odciąża serwer.
- Hasła kamer nie wracają do przeglądarki (adres jest pokazywany z ukrytym hasłem).
- Wymaga programu `ffmpeg` (instaluje go `install.sh`; inna ścieżka: zmienna `FFMPEG_PATH`).

## Rozwój

```bash
npm ci
```

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build && DATA_DIR=./data node dist/app/server/server.mjs
```

Tryb deweloperski: `NG_DEV_BACKEND=1 npm run dev`. Działa bez WebSocketu, zdarzenia na żywo idą przez SSE.

## Bezpieczeństwo
- Ustaw `PANEL_PASSWORD`. Bez hasła każdy w sieci ma pełny dostęp, łącznie z kopią zapasową z kluczami.
- Panel działa po HTTPS (`TLS_CERT`/`TLS_KEY`), bo logowanie HTTP Basic po zwykłym HTTP wysyła login i hasło otwartym tekstem. Certyfikat od instalatora jest samopodpisany: przeglądarka poprosi o akceptację, a `cert.pem` możesz dodać do zaufanych.
- Klucze urządzeń nie trafiają do przeglądarki. Plik kopii zapasowej je zawiera, więc trzymaj go bezpiecznie.
- W Zigbee2MQTT włącz `availability: enabled: true` i `advanced.last_seen: ISO_8601` — panel wtedy pokazuje rzeczywistą dostępność urządzeń zamiast zgadywać ją z czasu ostatniej wiadomości.
- Mosquitto instalowany przez `--with-mosquitto` wymaga logowania. Starsze instalacje z `allow_anonymous true` warto przestawić na hasła.
