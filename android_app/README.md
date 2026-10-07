# Aplikacja Android: Zigbee Sonoff Dongle-M Telemetry Monitor

Natywna aplikacja mobilna na platformę Android (Kotlin + Jetpack Compose + Material 3), dedykowana do bezprzewodowego monitorowania czujników Zigbee podłączonych do koordynatora Sonoff Dongle-M (układ Silicon Labs EFR32MG24).

## Główne Funkcjonalności
1. **Pobieranie danych przez REST API (`/api/devices`)**:
   - Wyświetlanie kafelków temperatury, wilgotności, stanu baterii i poziomu sygnału (LQI).
2. **Powiadomienia w czasie rzeczywistym w tle (Foreground Service + WebSocket)**:
   - Ciągłe połączenie z serwerem przez protokół WebSocket (`/ws`).
   - Generowanie powiadomień Heads-Up w systemie Android przy:
     - Przekroczeniu maksymalnej temperatury (domyślnie > 28°C).
     - Spadku temperatury poniżej minimum (domyślnie < 15°C).
     - Niskim poziomie baterii czujnika (< 20%).
     - Dołączeniu nowego urządzenia do sieci Zigbee.
3. **Sterowanie koordynatorem**:
   - Przycisk parowania (`permit-join` na 60 sekund) z odliczaniem na żywo.
4. **Konfigurator połączenia**:
   - Prosta zmiana adresu IP i portu serwera z poziomu aplikacji.

## Wymagania
- Android SDK 26 (Android 8.0 Oreo) lub nowszy.
- Android Studio Hedgehog / Iguana / Jellyfish (lub nowszy).
- Java / JDK 17+.

## Instrukcja Kompilacji i Uruchomienia
1. Otwórz katalog `android_app` w Android Studio (`File -> Open`).
2. Poczekaj na synchronizację projektu przez Gradle.
3. Podłącz telefon z włączonym debugowaniem USB lub uruchom emulator.
4. W pliku `MainActivity.kt` lub w oknie ustawień aplikacji wpisz adres IP komputera/serwera, na którym działa `backend_native.py` lub `backend_mqtt.py` (np. `192.168.1.150:8000`).
5. Uruchom aplikację przyciskiem **Run** (Shift + F10) lub wygeneruj plik APK:
   ```bash
   ./gradlew assembleDebug
   ```
   Gotowy plik APK znajdziesz w: `android_app/app/build/outputs/apk/debug/app-debug.apk`.
