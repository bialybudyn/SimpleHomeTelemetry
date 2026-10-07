#!/usr/bin/env bash
# ==============================================================================
# 1-Click Docker Compose Installer for Mosquitto + Zigbee2MQTT + Telemetry Panel
# ==============================================================================
set -e

echo "=== Uruchamianie stosu kontenerów: Mosquitto + Zigbee2MQTT + IoT Panel ==="

if ! command -v docker >/dev/null 2>&1; then
  echo "Instalacja Dockera..."
  curl -fsSL https://get.docker.com | sh
fi

if ! command -v docker-compose >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
  echo "Instalacja Docker Compose..."
  apt-get update && apt-get install -y docker-compose-plugin || apt-get install -y docker-compose
fi

# Uruchomienie stosu
if docker compose version >/dev/null 2>&1; then
  docker compose up -d
else
  docker-compose up -d
fi

echo "=== Stos kontenerów uruchomiony! ==="
echo "• Broker Mosquitto: localhost:1883"
echo "• Zigbee2MQTT Frontend: http://localhost:8080"
echo "• Panel Telemetrii: http://localhost:3000"
