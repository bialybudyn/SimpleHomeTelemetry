#!/usr/bin/env bash
# ==============================================================================
# Zigbee Sonoff Dongle Max (Dongle-M) & Zigbee2MQTT + Mosquitto Auto-Installer
# ==============================================================================
# Ten skrypt instaluje i konfiguruje na systemie Linux (Debian, Ubuntu, Raspberry Pi OS, Armbian):
# 1. Broker MQTT Eclipse Mosquitto (działający w tle jako usługa systemd na porcie 1883)
# 2. Node.js LTS (v20+) i menedżer pakietów npm
# 3. Zigbee2MQTT (zainstalowane w /opt/zigbee2mqtt, działające w tle jako usługa systemd)
# 4. Sterownik dla koordynatora Sonoff Dongle Max (układ EFR32MG24 / adapter: ember)
#    z obsługą połączenia sieciowego (tcp://Dongle-M.local:6638) lub portu USB (/dev/ttyACM0)
# 5. Serwer panelu telemetrycznego IoT z bazą SQLite
# ==============================================================================

set -e

# Kolory wyjścia terminala
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${CYAN}====================================================================${NC}"
echo -e "${CYAN}   AUTOMATYCZNY INSTALATOR: ZIGBEE2MQTT + MOSQUITTO BROKER + PANEL   ${NC}"
echo -e "${CYAN}   Dla koordynatora Sonoff Dongle Max (układ Silicon Labs EFR32MG24) ${NC}"
echo -e "${CYAN}====================================================================${NC}\n"

# 1. Weryfikacja uprawnień root / sudo
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[BŁĄD] Proszę uruchomić ten skrypt z uprawnieniami roota (sudo bash install.sh)${NC}"
  exit 1
fi

REAL_USER=${SUDO_USER:-$USER}
USER_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)

echo -e "${YELLOW}[1/7] Aktualizacja repozytoriów systemowych i instalacja narzędzi bazowych...${NC}"
apt-get update -y
apt-get install -y curl wget git build-essential sqlite3 libsqlite3-dev socat ufw

# 2. Instalacja i konfiguracja brokera Mosquitto
echo -e "\n${YELLOW}[2/7] Instalacja brokera MQTT Eclipse Mosquitto...${NC}"
apt-get install -y mosquitto mosquitto-clients

echo -e "${CYAN}Tworzenie konfiguracji brokera /etc/mosquitto/conf.d/iot-zigbee.conf...${NC}"
cat << 'EOF' > /etc/mosquitto/conf.d/iot-zigbee.conf
# Konfiguracja Mosquitto dla sieci IoT Zigbee
listener 1883
allow_anonymous true
persistence true
persistence_location /var/lib/mosquitto/
log_dest file /var/log/mosquitto/mosquitto.log
log_type error
log_type warning
log_type notice
log_type information
EOF

systemctl restart mosquitto
systemctl enable mosquitto

if systemctl is-active --quiet mosquitto; then
  echo -e "${GREEN}[OK] Broker Mosquitto MQTT działa w tle na porcie 1883.${NC}"
else
  echo -e "${RED}[UWAGA] Sprawdź status usługi mosquitto (systemctl status mosquitto).${NC}"
fi

# 3. Instalacja Node.js LTS
echo -e "\n${YELLOW}[3/7] Sprawdzanie i instalacja środowiska Node.js LTS...${NC}"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 18 ]; then
  echo -e "${CYAN}Instalacja Node.js LTS (wersja 20.x)...${NC}"
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi

NODE_VER=$(node -v)
NPM_VER=$(npm -v)
echo -e "${GREEN}[OK] Zainstalowano Node.js: ${NODE_VER}, npm: ${NPM_VER}${NC}"

# 4. Wybór trybu połączenia z koordynatorem Sonoff Dongle Max
echo -e "\n${YELLOW}[4/7] Konfiguracja połączenia z koordynatorem Sonoff Dongle Max...${NC}"
echo -e "Wybierz metodę podłączenia dongla:"
echo -e "  1) Połączenie sieciowe TCP (Ethernet / PoE / Wi-Fi) -> tcp://Dongle-M.local:6638 [ZALECANE]"
echo -e "  2) Port USB bezpośrednio wpięty do tego komputera -> /dev/ttyACM0"
echo -e "  3) Wprowadź niestandardowy adres IP/port (np. tcp://192.168.1.120:6638)"

read -rp "Twój wybór [1/2/3, domyślnie 1]: " DONGLE_CHOICE
DONGLE_CHOICE=${DONGLE_CHOICE:-1}

if [ "$DONGLE_CHOICE" -eq 1 ]; then
  DONGLE_PORT="tcp://Dongle-M.local:6638"
elif [ "$DONGLE_CHOICE" -eq 2 ]; then
  # Sprawdzenie portu USB
  if [ -e "/dev/ttyACM0" ]; then
    DONGLE_PORT="/dev/ttyACM0"
  else
    DONGLE_PORT=$(ls /dev/serial/by-id/usb-Silicon_Labs* 2>/dev/null || echo "/dev/ttyACM0")
  fi
  usermod -aG dialout "$REAL_USER" || true
else
  read -rp "Podaj pełny ciąg połączenia (np. tcp://192.168.1.50:6638): " CUSTOM_PORT
  DONGLE_PORT=${CUSTOM_PORT:-"tcp://Dongle-M.local:6638"}
fi

echo -e "${GREEN}[OK] Wybrano port koordynatora: ${DONGLE_PORT}${NC}"

# 5. Instalacja Zigbee2MQTT w /opt/zigbee2mqtt
echo -e "\n${YELLOW}[5/7] Instalacja Zigbee2MQTT w katalogu /opt/zigbee2mqtt...${NC}"
mkdir -p /opt/zigbee2mqtt
chown -R "$REAL_USER":"$REAL_USER" /opt/zigbee2mqtt

if [ ! -d "/opt/zigbee2mqtt/.git" ]; then
  git clone --depth 1 https://github.com/Koenkk/zigbee2mqtt.git /opt/zigbee2mqtt
fi

cd /opt/zigbee2mqtt
sudo -u "$REAL_USER" npm ci --no-audit --no-fund

# Przygotowanie konfiguracji Zigbee2MQTT
mkdir -p /opt/zigbee2mqtt/data
cat << EOF > /opt/zigbee2mqtt/data/configuration.yaml
homeassistant: false
permit_join: false

mqtt:
  base_topic: zigbee2mqtt
  server: 'mqtt://localhost:1883'

serial:
  port: ${DONGLE_PORT}
  adapter: ember
  baudrate: 115200

frontend:
  port: 8080
  host: 0.0.0.0

advanced:
  network_key: GENERATE
  pan_id: GENERATE
  ext_pan_id: GENERATE
  channel: 15
  log_level: info
EOF

chown -R "$REAL_USER":"$REAL_USER" /opt/zigbee2mqtt/data

# 6. Utworzenie usługi systemd dla Zigbee2MQTT
echo -e "\n${YELLOW}[6/7] Konfiguracja usługi systemd dla Zigbee2MQTT...${NC}"
cat << EOF > /etc/systemd/system/zigbee2mqtt.service
[Unit]
Description=Zigbee2MQTT Daemon (Sonoff Dongle Max EFR32MG24)
After=network.target mosquitto.service
Wants=mosquitto.service

[Service]
Type=simple
User=${REAL_USER}
WorkingDirectory=/opt/zigbee2mqtt
ExecStart=$(which npm) start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=zigbee2mqtt
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable zigbee2mqtt
systemctl restart zigbee2mqtt

# 7. Konfiguracja i uruchomienie Panelu Telemetrii IoT
echo -e "\n${YELLOW}[7/7] Konfiguracja Panelu Telemetrycznego i API...${NC}"
APP_DIR="/opt/zigbee-telemetry-panel"
mkdir -p "$APP_DIR"

# Kopiowanie plików aplikacji do katalogu docelowego jeśli uruchamiane z repozytorium
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/package.json" ]; then
  cp -r "$SCRIPT_DIR"/* "$APP_DIR/" 2>/dev/null || true
fi

chown -R "$REAL_USER":"$REAL_USER" "$APP_DIR"

cat << EOF > /etc/systemd/system/iot-telemetry.service
[Unit]
Description=Zigbee IoT Telemetry Panel & SQLite Backend
After=network.target mosquitto.service zigbee2mqtt.service

[Service]
Type=simple
User=${REAL_USER}
WorkingDirectory=${APP_DIR}
Environment="PORT=3000"
Environment="MQTT_URL=mqtt://127.0.0.1:1883"
Environment="MQTT_TOPIC=zigbee2mqtt"
ExecStart=$(which npm) run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable iot-telemetry 2>/dev/null || true

echo -e "\n${GREEN}====================================================================${NC}"
echo -e "${GREEN}   INSTALACJA ZAKOŃCZONA SUKCESEM!                                  ${NC}"
echo -e "${GREEN}====================================================================${NC}"
echo -e "Usługi działające w tle:"
echo -e "  • ${CYAN}Mosquitto MQTT Broker${NC} : port 1883 (systemctl status mosquitto)"
echo -e "  • ${CYAN}Zigbee2MQTT Daemon${NC}    : port 8080 (systemctl status zigbee2mqtt)"
echo -e "  • ${CYAN}Panel IoT & SQLite${NC}    : port 3000 (systemctl status iot-telemetry)"
echo -e "Koordynator:"
echo -e "  • ${CYAN}Sonoff Dongle Max${NC}     : ${DONGLE_PORT} (adapter: ember)"
echo -e "\nAdresy WWW:"
echo -e "  • Pulpit monitoringu: ${YELLOW}http://$(hostname -I | awk '{print $1}'):3000${NC} lub ${YELLOW}http://localhost:3000${NC}"
echo -e "  • Frontend Zigbee2MQTT: ${YELLOW}http://$(hostname -I | awk '{print $1}'):8080${NC}"
echo -e "\nLogi na żywo:"
echo -e "  journalctl -u zigbee2mqtt -f"
echo -e "  journalctl -u mosquitto -f"
echo -e "${GREEN}====================================================================${NC}\n"
