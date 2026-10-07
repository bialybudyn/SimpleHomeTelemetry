# Przewodnik wdrożenia: Zigbee Sonoff Dongle Max (Dongle-M EFR32MG24)

Ten przewodnik zawiera instrukcję krok po kroku uruchomienia systemu monitoringu dla obu wariantów backendu na systemach **Linux** oraz **Windows (PowerShell)**, ze szczególnym uwzględnieniem obsługi sieciowej **Sonoff Dongle Max** (Ethernet, PoE, Wi-Fi, port TCP 6638) oraz trybu **Routera mesh** zgodnie z oficjalnym przewodnikiem [dongle.sonoff.tech/guide/dongle-m/](https://dongle.sonoff.tech/guide/dongle-m/).

---

## 1. Architektura sprzętowa Sonoff Dongle Max (Dongle-M)

Urządzenie **Sonoff Dongle Max (Dongle-M / PMG24)** wyposażone jest w podwójny układ SoC:
- **Silicon Labs EFR32MG24**: Zaawansowany procesor radiowy Zigbee 3.0 / Thread / Matter o mocy nadawania **+20 dBm** z dwiema zewnętrznymi antenami zysku **5 dBi**.
- **Espressif ESP32-D0WD**: Kontroler sieciowy zarządzający portem **Ethernet 10/100M** z obsługą **Power over Ethernet (PoE IEEE 802.3af)**, łącznością **Wi-Fi 2.4 GHz** oraz wbudowanym serwerem Web.

### Metody podłączenia do hosta:
1. **Połączenie sieciowe TCP (Ethernet / PoE / Wi-Fi) — zalecane**:
   - Dongle Max łączy się z lokalną siecią LAN przez kabel RJ45 z PoE lub Wi-Fi.
   - Udostępnia mostek szeregowy (Serial-over-IP) na domyślnym gnieździe **TCP port 6638**.
   - Adres mDNS urządzenia: `http://Dongle-M.local` lub statyczny adres IP przydzielony przez router.
   - Ciąg połączenia: `tcp://Dongle-M.local:6638` (lub `socket://Dongle-M.local:6638`).
2. **Połączenie lokalne USB-C (fallback)**:
   - Linux: `/dev/ttyACM0` (lub `/dev/serial/by-id/...`)
   - Windows: `COM3`, `COM4`

---

## 2. Tryby pracy: Koordynator vs Router po sieci (wg dongle.sonoff.tech)

Dokumentacja [dongle.sonoff.tech/guide/dongle-m/](https://dongle.sonoff.tech/guide/dongle-m/) opisuje dwa oficjalne tryby oprogramowania układowego (firmware):

### A. Tryb Koordynatora (Coordinator Mode):
- Oprogramowanie: **EmberZNet NCP (sterownik `ember` / EZSP v7.4+)**.
- Rola: Centralna stacja bazowa tworząca sieć Zigbee PAN.
- Dongle Max przesyła ramki ZCL ze wszystkich czujników przez port TCP 6638 do backendu.

### B. Tryb Routera Zigbee (Dongle Max Router Mode):
- Oprogramowanie: **Zigbee Router Firmware**.
- Instalacja: Bezpośrednio przez przeglądarkę za pomocą oficjalnego narzędzia [Sonoff Web Flasher](https://dongle.sonoff.tech/guide/dongle-m/).
- Rola: Wzmacniacz zasięgu sieci mesh.
- Dzięki zasilaniu przez **PoE** i podwójnym antenom **5 dBi**, urządzenie można umieścić w odległej kondygnacji lub hali magazynowej, retransmitując pakiety ze słabych czujników bateryjnych (temperatura, wilgotność).
- Konsola diagnostyczna `http://Dongle-M.local` pozwala na podgląd jakości połączenia z koordynatorem, tabeli sąsiadów oraz adresu IP.

---

## 3. Automatyczny Instalator Systemowy (1-Click Installer na Hoście)

W projekcie dostępny jest gotowy, przetestowany instalator systemowy instalujący i konfigurujący w tle:
1. **Broker Mosquitto MQTT** (jako usługę systemd `mosquitto.service` na porcie 1883)
2. **Node.js LTS (v20+)**
3. **Zigbee2MQTT w `/opt/zigbee2mqtt`** (jako usługę systemd `zigbee2mqtt.service` na porcie 8080)
4. **Sterownik dla koordynatora Sonoff Dongle Max (EFR32MG24 / adapter ember)**
5. **Panel Telemetrii IoT & SQLite** (`iot-telemetry.service` na porcie 3000)

### Uruchomienie instalatora na Linuxie (Ubuntu / Debian / Raspberry Pi OS):
```bash
# Szybka instalacja 1 poleceniem:
sudo bash install.sh
```

Po zakończeniu wszystkie 3 usługi działają stabilnie w tle z automatycznym restartem po restarcie maszyny:
- Weryfikacja statusu: `systemctl status mosquitto zigbee2mqtt iot-telemetry`
- Podgląd logów Zigbee2MQTT: `journalctl -u zigbee2mqtt -f`
- Podgląd logów brokera Mosquitto: `journalctl -u mosquitto -f`

---

## 4. WARIANT A: Backend Zigbee2MQTT + Mosquitto (Połączenie sieciowe TCP)

### Konfiguracja w `configuration.yaml`:
```yaml
homeassistant: false
permit_join: false

mqtt:
  base_topic: zigbee2mqtt
  server: 'mqtt://localhost:1883'

serial:
  # Połączenie przez sieć LAN z Sonoff Dongle Max (port 6638)
  port: tcp://Dongle-M.local:6638
  adapter: ember
  baudrate: 115200

frontend:
  port: 8080
```

### Uruchomienie na Linuxie (Docker Compose):
```bash
docker-compose up -d
docker-compose logs -f zigbee2mqtt
```
Panel monitoringu dostępny pod adresem: `http://localhost:8000` (lub port przypisany w AI Studio).

### Uruchomienie na Windows (PowerShell):
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

$env:MQTT_BROKER_HOST="localhost"
$env:PORT="8000"
python backend_mqtt.py
```

---

## 4. WARIANT B: Backend Natywny Python (zigpy / bellows / EZSP over TCP)

Natywna obsługa gniazda sieciowego `socket://` bez brokera MQTT.

### Uruchomienie na Linuxie:
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Skonfiguruj gniazdo TCP koordynatora Dongle Max (port 6638):
export ZIGBEE_PORT="socket://Dongle-M.local:6638"
export ZIGBEE_BAUDRATE=115200
export ZIGBEE_FLOW_CONTROL=none
export PORT=8000

python backend_native.py
```

### Uruchomienie na Windows (PowerShell):
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

$env:ZIGBEE_PORT="socket://Dongle-M.local:6638"
$env:ZIGBEE_BAUDRATE="115200"
$env:ZIGBEE_FLOW_CONTROL="none"
$env:PORT="8000"

python backend_native.py
```

---

## 5. Zasada czystych danych ("Brak danych")

System ściśle przestrzega reguły zerowej syntezy nieistniejących danych:
- Jeżeli czujnik nie zgłosił jeszcze odczytu temperatury, wilgotności, baterii lub jakości sygnału (LQI), interfejs i API zwracają wartość `null` i wyświetlają jednoznaczny komunikat **"brak danych"**.
- W sekcji analitycznej (Chart.js), jeśli w wybranym przedziale czasowym (6h - 720 dni) brak próbek w bazie SQLite, wykres wyświetla stan pusty z informacją **"brak danych"**, bez dorysowywania fikcyjnych punktów.

---

## 6. Parowanie czujników i alerty poziomu baterii

1. Kliknij przycisk **"Pairing"** na pasku głównym (aktywuje nasłuch sieci na 60 sekund z odliczaniem).
2. Przytrzymaj przycisk parowania na czujniku (np. Sonoff SNZB-02/SNZB-02D) przez 5 sekund.
3. Czujnik zarejestruje się w bazie SQLite `telemetry.db`.
4. Gdy poziom baterii dowolnego czujnika spadnie do **<= 15%**, serwer automatycznie:
   - Zapisuje zdarzenie w tabeli `notifications`.
   - Wysyła natychmiastowe powiadomienie przez WebSocket (`type: battery_alert`) do panelu WWW i aplikacji Android.

---

## 7. Ekosystem Urządzeń Sonoff i Tuya: Głowice TRVZB, Gniazdka i Wyłączniki

System obsługuje pełną gamę produktów marki **Sonoff (https://sonoff.tech/pl-pl)** oraz urządzeń ekosystemu **Tuya**:

### A. Głowice termostatyczne Sonoff TRVZB oraz TRVZB Gen 2:
- **TRVZB Gen 2 (Nowa Generacja)**: precyzyjny silnik krokowy, algorytm PID, regulacja nastawy w krokach co 0.5°C w zakresie 5.0–30.0°C.
- **Sterowanie na żywo z panelu**:
  - Zmiana nastawy zadanej: `POST /api/devices/{ieee}/set` -> `{"current_heating_setpoint": 22.5}`
  - Tryb pracy: `{"system_mode": "heat" | "auto" | "off"}`
  - Blokada rodzicielska: `{"child_lock": "LOCK" | "UNLOCK"}`
  - Telemetria: stan zaworu (`running_state`: `heat`/`idle`), temperatura bieżąca (`local_temperature`), detekcja otwartego okna (`open_window`).

### B. Inteligentne gniazdka sterowane (Sonoff S26R2ZB, S40ZB, Tuya TS011F):
- Obciążenie do 16A (4000W), funkcja routera Zigbee Mesh.
- Zdalne przełączanie ON/OFF z natychmiastową reakcją: `{"state": "ON"}` / `{"state": "OFF"}`.
- Telemetria energii elektrycznej: moc chwilowa (`power` w W), napięcie (`voltage` w V), natężenie (`current` w A), łączne zużycie (`energy` w kWh).

### C. Wyłączniki i przekaźniki dopuszkowe (Sonoff ZBMINIR2, ZBMINI-L2, Tuya Switch):
- Montaż w puszce podtynkowej 60mm za tradycyjnym włącznikiem ściennym.
- Zdalne bistabilne przełączanie obwodu oświetleniowego (`state`: `ON`/`OFF`).

### D. Sensory magnetyczne, obecności i zalania (Sonoff SNZB-03, 04, 05, Tuya mmWave):
- **SNZB-04**: Kontaktron drzwi/okien (`contact`: `true` = zamknięte, `false` = otwarte).
- **SNZB-03 / Tuya TS0601 Radar mmWave**: Detekcja ruchu i mikroruchów obecności (`occupancy`: `true`/`false`), pomiar natężenia światła (`illuminance` w lux).
- **SNZB-05**: Złocona sonda zalania IP67 (`water_leak`: `true`/`false`).
- **SNZB-02D**: Termohigrometr z ekranem LCD.
