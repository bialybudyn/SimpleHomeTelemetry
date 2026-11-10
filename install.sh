#!/usr/bin/env bash
# ==============================================================================
# SimpleHomeTelemetry — instalator / aktualizator panelu (Debian / Ubuntu / Raspberry Pi OS, LXC)
#
# Użycie (z katalogu repozytorium):
#   sudo ./install.sh                     # instalacja lub aktualizacja panelu
#   sudo ./install.sh --with-mosquitto    # dodatkowo zainstaluj broker MQTT (jeśli go nie ma)
#   sudo ./install.sh --with-z2m          # dodatkowo zainstaluj Zigbee2MQTT (jeśli go nie ma)
#
# Zasady:
#  - Istniejące instalacje Mosquitto i Zigbee2MQTT NIE są modyfikowane (konfiguracja, restarty).
#  - Panel działa jako osobny użytkownik systemowy "simplehome".
#  - Kod: /opt/simplehome, dane: /var/lib/simplehome, ustawienia: /etc/simplehome/panel.env
# ==============================================================================
set -euo pipefail

APP_USER="simplehome"
APP_DIR="/opt/simplehome"
DATA_DIR="/var/lib/simplehome"
CONF_DIR="/etc/simplehome"
ENV_FILE="${CONF_DIR}/panel.env"
SERVICE="simplehome"
NODE_MAJOR=22
NODE_MIN_MINOR=13 # node:sqlite bez flagi od 22.13

WITH_MOSQUITTO=false
WITH_Z2M=false
MOSQUITTO_INSTALLED_NOW=false
Z2M_INSTALLED_NOW=false
for arg in "$@"; do
  case "$arg" in
    --with-mosquitto) WITH_MOSQUITTO=true ;;
    --with-z2m) WITH_Z2M=true ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Nieznana opcja: $arg"; exit 1 ;;
  esac
done

c_ok() { echo -e "\033[0;32m[OK]\033[0m $*"; }
c_info() { echo -e "\033[0;36m[..]\033[0m $*"; }
c_warn() { echo -e "\033[1;33m[!!]\033[0m $*"; }
die() { echo -e "\033[0;31m[BŁĄD]\033[0m $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Uruchom jako root: sudo ./install.sh"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SRC_DIR/package.json" ] && [ -f "$SRC_DIR/src/server.ts" ] || die "Uruchom skrypt z katalogu repozytorium SimpleHomeTelemetry."

gen_secret() { head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24; }

# ------------------------------------------------------------------------------
# 1. Pakiety systemowe i Node.js
# ------------------------------------------------------------------------------
c_info "Instalacja pakietów bazowych..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null
apt-get install -y --no-install-recommends ca-certificates curl gnupg git rsync >/dev/null

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v major minor
  v="$(node -v | tr -d v)"
  major="${v%%.*}"
  minor="$(echo "$v" | cut -d. -f2)"
  [ "$major" -gt "$NODE_MAJOR" ] || { [ "$major" -eq "$NODE_MAJOR" ] && [ "$minor" -ge "$NODE_MIN_MINOR" ]; }
}

if ! node_ok; then
  c_info "Instalacja Node.js ${NODE_MAJOR}.x (NodeSource)..."
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y >/dev/null
  apt-get install -y nodejs >/dev/null
fi
node_ok || die "Wymagany Node.js >= ${NODE_MAJOR}.${NODE_MIN_MINOR} (jest: $(node -v 2>/dev/null || echo brak))."
NODE_BIN="$(command -v node)"
c_ok "Node.js $(node -v)"

# ------------------------------------------------------------------------------
# 2. Mosquitto (opcjonalnie, tylko jeśli nie ma)
# ------------------------------------------------------------------------------
MQTT_USER_PANEL=""
MQTT_PASS_PANEL=""
MQTT_USER_Z2M=""
MQTT_PASS_Z2M=""
if $WITH_MOSQUITTO; then
  if command -v mosquitto >/dev/null 2>&1; then
    c_warn "Mosquitto jest już zainstalowany — pomijam (konfiguracja bez zmian)."
  else
    c_info "Instalacja Mosquitto z logowaniem użytkowników..."
    apt-get install -y mosquitto mosquitto-clients >/dev/null
    MQTT_USER_PANEL="simplehome"; MQTT_PASS_PANEL="$(gen_secret)"
    MQTT_USER_Z2M="zigbee2mqtt"; MQTT_PASS_Z2M="$(gen_secret)"
    touch /etc/mosquitto/passwd
    mosquitto_passwd -b /etc/mosquitto/passwd "$MQTT_USER_PANEL" "$MQTT_PASS_PANEL"
    mosquitto_passwd -b /etc/mosquitto/passwd "$MQTT_USER_Z2M" "$MQTT_PASS_Z2M"
    chown mosquitto:mosquitto /etc/mosquitto/passwd
    chmod 600 /etc/mosquitto/passwd
    cat > /etc/mosquitto/conf.d/simplehome.conf <<'EOF'
listener 1883
allow_anonymous false
password_file /etc/mosquitto/passwd
EOF
    systemctl enable --now mosquitto >/dev/null
    systemctl restart mosquitto
    MOSQUITTO_INSTALLED_NOW=true
    c_ok "Mosquitto działa na porcie 1883 (logowanie wymagane)."
  fi
fi

# ------------------------------------------------------------------------------
# 3. Zigbee2MQTT (opcjonalnie, tylko jeśli nie ma)
# ------------------------------------------------------------------------------
if $WITH_Z2M; then
  if [ -d /opt/zigbee2mqtt ]; then
    c_warn "Zigbee2MQTT już istnieje w /opt/zigbee2mqtt — pomijam (konfiguracja bez zmian)."
  else
    read -rp "Port koordynatora (np. tcp://192.168.1.50:6638 lub /dev/ttyACM0): " Z2M_PORT
    [ -n "$Z2M_PORT" ] || die "Nie podano portu koordynatora."
    read -rp "Adapter [ember]: " Z2M_ADAPTER
    Z2M_ADAPTER="${Z2M_ADAPTER:-ember}"

    c_info "Instalacja Zigbee2MQTT (git + pnpm + build)..."
    id zigbee2mqtt >/dev/null 2>&1 || useradd --system --home /opt/zigbee2mqtt --shell /usr/sbin/nologin --groups dialout zigbee2mqtt
    command -v pnpm >/dev/null 2>&1 || npm install -g pnpm >/dev/null
    git clone --depth 1 https://github.com/Koenkk/zigbee2mqtt.git /opt/zigbee2mqtt
    chown -R zigbee2mqtt:zigbee2mqtt /opt/zigbee2mqtt
    (cd /opt/zigbee2mqtt && sudo -u zigbee2mqtt pnpm install --frozen-lockfile && sudo -u zigbee2mqtt pnpm run build)

    MQTT_AUTH_YAML=""
    if [ -n "$MQTT_USER_Z2M" ]; then
      MQTT_AUTH_YAML="  user: ${MQTT_USER_Z2M}
  password: ${MQTT_PASS_Z2M}"
    fi
    mkdir -p /opt/zigbee2mqtt/data
    cat > /opt/zigbee2mqtt/data/configuration.yaml <<EOF
version: 4
homeassistant:
  enabled: false
mqtt:
  base_topic: zigbee2mqtt
  server: mqtt://localhost:1883
${MQTT_AUTH_YAML}
serial:
  port: ${Z2M_PORT}
  adapter: ${Z2M_ADAPTER}
frontend:
  enabled: true
  port: 8080
advanced:
  network_key: GENERATE
  pan_id: GENERATE
  ext_pan_id: GENERATE
availability:
  enabled: true
EOF
    chown -R zigbee2mqtt:zigbee2mqtt /opt/zigbee2mqtt/data
    chmod 600 /opt/zigbee2mqtt/data/configuration.yaml

    cat > /etc/systemd/system/zigbee2mqtt.service <<EOF
[Unit]
Description=Zigbee2MQTT
After=network-online.target mosquitto.service
Wants=network-online.target

[Service]
Type=simple
User=zigbee2mqtt
WorkingDirectory=/opt/zigbee2mqtt
ExecStart=${NODE_BIN} index.js
Environment=NODE_ENV=production
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable --now zigbee2mqtt
    Z2M_INSTALLED_NOW=true
    c_ok "Zigbee2MQTT zainstalowany (frontend na porcie 8080)."
  fi
fi

# ------------------------------------------------------------------------------
# 4. Budowanie panelu
# ------------------------------------------------------------------------------
c_info "Budowanie panelu (npm ci + ng build)..."
BUILD_OWNER="$(stat -c %U "$SRC_DIR")"
run_as_owner() { if [ "$BUILD_OWNER" = "root" ]; then bash -c "$1"; else sudo -u "$BUILD_OWNER" bash -c "$1"; fi; }
run_as_owner "cd '$SRC_DIR' && NG_CLI_ANALYTICS=false npm ci --no-audit --no-fund && NG_CLI_ANALYTICS=false npm run build"
[ -f "$SRC_DIR/dist/app/server/server.mjs" ] || die "Build nie utworzył dist/app/server/server.mjs."
c_ok "Zbudowano."

# ------------------------------------------------------------------------------
# 5. Użytkownik, katalogi, ustawienia
# ------------------------------------------------------------------------------
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" "$DATA_DIR" "$CONF_DIR"
rsync -a --delete "$SRC_DIR/dist/" "$APP_DIR/dist/"
chown -R root:root "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"

NEW_PASSWORD=""
if [ ! -f "$ENV_FILE" ]; then
  NEW_PASSWORD="$(gen_secret)"
  cat > "$ENV_FILE" <<EOF
# Ustawienia panelu SimpleHome (po zmianie: systemctl restart ${SERVICE})
PORT=3000
HOST=0.0.0.0
DATA_DIR=${DATA_DIR}

# Logowanie do panelu (HTTP Basic). Puste hasło = brak logowania.
PANEL_USER=admin
PANEL_PASSWORD=${NEW_PASSWORD}

# Broker MQTT i temat bazowy Zigbee2MQTT
MQTT_URL=mqtt://127.0.0.1:1883
MQTT_TOPIC=zigbee2mqtt
MQTT_USER=${MQTT_USER_PANEL}
MQTT_PASSWORD=${MQTT_PASS_PANEL}

# Retencja historii (dni)
RAW_RETENTION_DAYS=30
HOURLY_RETENTION_DAYS=730
EOF
  c_ok "Utworzono ${ENV_FILE}"
else
  c_ok "Zachowano istniejące ustawienia ${ENV_FILE}"
fi
chown root:"$APP_USER" "$ENV_FILE"
chmod 640 "$ENV_FILE"

# ------------------------------------------------------------------------------
# 6. Usługa systemd
# ------------------------------------------------------------------------------
# Wyłączenie starej wersji panelu (iot-telemetry.service z /opt/zigbee-telemetry-panel)
# (bez "| grep -q": przy set -o pipefail grep kończy się wcześniej, systemctl dostaje SIGPIPE i warunek wychodzi fałszywy)
if [ -n "$(systemctl list-unit-files iot-telemetry.service --no-legend 2>/dev/null)" ]; then
  c_warn "Wyłączam starą usługę iot-telemetry (stary panel). Katalog /opt/zigbee-telemetry-panel możesz usunąć ręcznie."
  systemctl disable --now iot-telemetry.service >/dev/null 2>&1 || true
fi

cat > "/etc/systemd/system/${SERVICE}.service" <<EOF
[Unit]
Description=SimpleHome Telemetry panel
After=network-online.target mosquitto.service zigbee2mqtt.service
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
EnvironmentFile=${ENV_FILE}
WorkingDirectory=${DATA_DIR}
ExecStart=${NODE_BIN} --disable-warning=ExperimentalWarning ${APP_DIR}/dist/app/server/server.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=${DATA_DIR}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
sleep 2
if systemctl is-active --quiet "$SERVICE"; then
  c_ok "Panel działa: http://$(hostname -I | awk '{print $1}'):$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2)"
else
  journalctl -u "$SERVICE" -n 30 --no-pager || true
  die "Usługa ${SERVICE} nie wystartowała."
fi

if [ -n "$NEW_PASSWORD" ]; then
  echo
  c_ok "Login do panelu: admin"
  c_ok "Hasło do panelu: ${NEW_PASSWORD}   (zmiana w ${ENV_FILE})"
fi
if $MOSQUITTO_INSTALLED_NOW && ! $Z2M_INSTALLED_NOW; then
  c_warn "Mosquitto wymaga logowania. Dla istniejącego Zigbee2MQTT ustaw w configuration.yaml: mqtt.user=${MQTT_USER_Z2M}, mqtt.password=${MQTT_PASS_Z2M}"
fi
echo
c_info "Logi: journalctl -u ${SERVICE} -f"
c_info "Aktualizacja: git pull && sudo ./install.sh"
