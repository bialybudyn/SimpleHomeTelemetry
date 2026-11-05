# SimpleHomeTelemetry

Lekki panel do domu: czujniki i urządzenia **Zigbee** (przez Zigbee2MQTT), gniazdka **Sonoff Wi-Fi** (eWeLink LAN) i urządzenia **Tuya Wi-Fi** (protokół lokalny). Do tego historia pomiarów, alarmy (e-mail, Telegram) i pogoda IMGW.

Wszystko działa lokalnie. Chmura eWeLink lub Tuya jest potrzebna tylko raz, do pobrania kluczy urządzeń.

## Architektura

```
przeglądarka ──HTTP/WebSocket──► panel (Node.js, port 3000)
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
| `DATA_DIR` | `/var/lib/simplehome` | baza i cache |
| `RAW_RETENTION_DAYS` | `30` | jak długo trzymać surowe próbki |
| `HOURLY_RETENTION_DAYS` | `730` | jak długo trzymać średnie godzinowe |

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
- Gniazdka w tej samej sieci **ogłaszają się same** przez mDNS. Panel nie skanuje sieci.
- Do odczytu stanu i sterowania potrzebny jest `devicekey` urządzenia. Masz dwie drogi:
  - **Import z konta eWeLink** (Wi-Fi → Sonoff). Potrzebny jest własny, darmowy AppID i AppSecret z [dev.ewelink.cc](https://dev.ewelink.cc). Hasło nie jest zapisywane.
  - **Ręcznie**, jeśli znasz `deviceid` i `devicekey`. W trybie DIY klucz nie jest potrzebny.
- Panel musi być w tej samej sieci L2 co gniazdka, bo mDNS nie przechodzi przez routery. W Proxmox LXC wystarczy zwykły bridge (`vmbr0`).
- Pomiar mocy zależy od modelu i firmware. Część modeli wysyła go tylko do chmury.

### Tuya Wi-Fi (np. wentylator 7w1)
- **Import kodem QR** (Wi-Fi → Tuya): kod użytkownika z aplikacji Smart Life (Ja → Ustawienia → Konto i bezpieczeństwo), potem skan QR. Pobierane są Device ID, Local Key i **mapa DP**, czyli który numer DP to prędkość, tryb czy oscylacja.
- Dodanie ręczne: Device ID, Local Key i wersja protokołu (3.1, 3.3, 3.4 lub 3.5). Mapę DP możesz wtedy wpisać w ustawieniach urządzenia jako JSON. Surowy stan DP jest widoczny obok.
- Panel utrzymuje jedno stałe połączenie z każdym urządzeniem, więc zmiany z pilota lub aplikacji widać od razu.

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
- Klucze urządzeń nie trafiają do przeglądarki. Plik kopii zapasowej je zawiera, więc trzymaj go bezpiecznie.
- Mosquitto instalowany przez `--with-mosquitto` wymaga logowania. Starsze instalacje z `allow_anonymous true` warto przestawić na hasła.
