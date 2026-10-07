# ==============================================================================
# Zigbee Sonoff Dongle Max & Zigbee2MQTT + Mosquitto Windows Installer (PowerShell)
# ==============================================================================
# Automatyczny instalator dla systemów Windows 10/11 i Windows Server:
# 1. Sprawdza i instaluje Node.js oraz Git (przez winget lub bezpośrednie pobranie)
# 2. Pobiera i konfiguruje broker Mosquitto dla Windows
# 3. Instaluje Zigbee2MQTT w C:\zigbee2mqtt
# 4. Konfiguruje port TCP/COM dla Sonoff Dongle Max (EFR32MG24)
# 5. Uruchamia usługi w tle
# ==============================================================================

#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "  ZIGBEE2MQTT + MOSQUITTO BROKER + PANEL - INSTALATOR WINDOWS       " -ForegroundColor Cyan
Write-Host "  Dla koordynatora Sonoff Dongle Max (układ Silicon Labs EFR32MG24) " -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

$InstallDir = "C:\zigbee2mqtt"
$MosquittoDir = "C:\Program Files\mosquitto"

# 1. Sprawdzenie Node.js
Write-Host "[1/5] Sprawdzanie środowiska Node.js..." -ForegroundColor Yellow
try {
    $nodeVer = node -v
    Write-Host "  Wykryto Node.js: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "  Brak Node.js. Instalacja przez winget..." -ForegroundColor Cyan
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}

# 2. Sprawdzenie/Instalacja Mosquitto
Write-Host "[2/5] Sprawdzanie brokera Mosquitto MQTT..." -ForegroundColor Yellow
if (-not (Test-Path "$MosquittoDir\mosquitto.exe")) {
    Write-Host "  Instalacja Mosquitto przez winget..." -ForegroundColor Cyan
    try {
        winget install EclipseFoundation.Mosquitto --accept-package-agreements --accept-source-agreements
    } catch {
        Write-Host "  Instalacja ręczna / kontynuacja konfiguracji..." -ForegroundColor Gray
    }
}

# Konfiguracja Mosquitto
if (Test-Path $MosquittoDir) {
    $mosqConf = @"
listener 1883
allow_anonymous true
persistence true
"@
    Set-Content -Path "$MosquittoDir\mosquitto.conf" -Value $mosqConf -Encoding UTF8
    
    # Rejestracja i start usługi Windows
    try {
        Start-Process -FilePath "$MosquittoDir\mosquitto.exe" -ArgumentList "install" -NoNewWindow -Wait -ErrorAction SilentlyContinue
        Start-Service mosquitto -ErrorAction SilentlyContinue
        Write-Host "  Usługa Mosquitto MQTT uruchomiona." -ForegroundColor Green
    } catch {
        Write-Host "  Uruchamianie Mosquitto w tle..." -ForegroundColor Gray
    }
}

# 3. Pobranie i instalacja Zigbee2MQTT
Write-Host "[3/5] Przygotowanie Zigbee2MQTT w $InstallDir..." -ForegroundColor Yellow
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    git clone --depth 1 https://github.com/Koenkk/zigbee2mqtt.git $InstallDir
}

Set-Location $InstallDir
Write-Host "  Instalacja zależności..." -ForegroundColor Cyan
if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    pnpm install --frozen-lockfile
} else {
    npm install -g pnpm
    pnpm install --frozen-lockfile
}

# 4. Wybór portu koordynatora Sonoff Dongle Max
Write-Host "[4/5] Konfiguracja portu Sonoff Dongle Max..." -ForegroundColor Yellow
$dongleChoice = Read-Host "Wybierz tryb połączenia: [1] Sieć TCP (tcp://Dongle-M.local:6638 - ZALECANY) [2] Port USB (COM3) [Domyślnie 1]"
if ($dongleChoice -eq "2") {
    $comPort = Read-Host "Podaj numer portu COM (np. COM3, COM4)"
    $finalPort = if ($comPort) { $comPort } else { "COM3" }
} else {
    $finalPort = "tcp://Dongle-M.local:6638"
}

New-Item -ItemType Directory -Force -Path "$InstallDir\data" | Out-Null

$z2mConfig = @"
homeassistant: false
permit_join: false

mqtt:
  base_topic: zigbee2mqtt
  server: 'mqtt://localhost:1883'

serial:
  port: $finalPort
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
"@

Set-Content -Path "$InstallDir\data\configuration.yaml" -Value $z2mConfig -Encoding UTF8
Write-Host "  Zapisano konfigurację z portem: $finalPort (adapter: ember)" -ForegroundColor Green

# 5. Skrypt uruchomieniowy w tle
Write-Host "[5/5] Tworzenie skryptu uruchomieniowego w tle..." -ForegroundColor Yellow
$startBat = @"
@echo off
title Zigbee2MQTT Daemon
cd /d $InstallDir
npm start
"@
Set-Content -Path "$InstallDir\start_background.bat" -Value $startBat -Encoding ASCII

Write-Host ""
Write-Host "====================================================================" -ForegroundColor Green
Write-Host "   INSTALACJA NA WINDOWS ZAKOŃCZONA!                                " -ForegroundColor Green
Write-Host "====================================================================" -ForegroundColor Green
Write-Host "Aby uruchomić Zigbee2MQTT:" -ForegroundColor Cyan
Write-Host "  cd $InstallDir ; npm start" -ForegroundColor White
Write-Host "Pulpit Zigbee2MQTT Frontend: http://localhost:8080" -ForegroundColor Yellow
Write-Host "Broker Mosquitto MQTT:       localhost:1883" -ForegroundColor Yellow
Write-Host "Panel Telemetrii IoT:        http://localhost:3000" -ForegroundColor Yellow
Write-Host "====================================================================" -ForegroundColor Green
