"""
database.py - Obsługa bazy danych SQLite (telemetry.db) dla systemu monitoringu Zigbee.
Przechowuje rejestr urządzeń oraz historię pomiarów środowiskowych (temperatura, wilgotność, bateria, LQI).
Zawiera zoptymalizowane zapytania agregujące dla długich zakresów czasowych (6h, 24h, 7d, 30d, 90d, 360d, 720d).
"""

import sqlite3
import os
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

DB_FILE = os.environ.get("SQLITE_DB_PATH", "telemetry.db")


def get_db_connection(db_path: str = DB_FILE) -> sqlite3.Connection:
    """Tworzy połączenie z bazą SQLite w trybie WAL dla wysokiej współbieżności zapisu/odczytu."""
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # Włączenie trybu WAL (Write-Ahead Logging) dla bezpiecznego zapisu asynchronicznego
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    return conn


def init_db(db_path: str = DB_FILE) -> None:
    """Inicjalizuje schemat tabel i indeksów w bazie SQLite."""
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()

        # Tabela urządzeń Zigbee
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS devices (
                ieee_address TEXT PRIMARY KEY,
                friendly_name TEXT,
                model TEXT DEFAULT 'Zigbee Sensor',
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                battery INTEGER,
                last_temperature REAL,
                last_humidity REAL,
                linkquality INTEGER
            );
        """)

        # Tabela historii telemetrii
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS telemetry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_ieee TEXT NOT NULL,
                temperature REAL NOT NULL,
                humidity REAL NOT NULL,
                battery INTEGER,
                linkquality INTEGER,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (device_ieee) REFERENCES devices(ieee_address) ON DELETE CASCADE
            );
        """)

        # Tabela powiadomień i alertów (w tym alerty niskiego stanu baterii < 15%)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS notifications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_ieee TEXT NOT NULL,
                device_name TEXT,
                type TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                value REAL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                acknowledged INTEGER DEFAULT 0
            );
        """)

        # Indeksy wydajnościowe dla zapytań czasowych
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_telemetry_device_time 
            ON telemetry(device_ieee, timestamp DESC);
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_telemetry_timestamp 
            ON telemetry(timestamp DESC);
        """)
        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_notifications_ack
            ON notifications(acknowledged, timestamp DESC);
        """)

        conn.commit()


def check_and_create_battery_alert(
    device_ieee: str,
    battery: Optional[int],
    friendly_name: Optional[str] = None,
    db_path: str = DB_FILE
) -> Optional[Dict[str, Any]]:
    """Sprawdza stan baterii. Jeśli <= 15%, tworzy powiadomienie alarmowe w SQLite (jeśli nie powstało w ciągu ostatnich 12h)."""
    if battery is None or battery > 15:
        return None

    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        
        # Pobierz nazwę urządzenia jeśli nie podano
        if not friendly_name:
            cursor.execute("SELECT friendly_name FROM devices WHERE ieee_address = ?", (device_ieee,))
            row = cursor.fetchone()
            dev_name = row["friendly_name"] if row else f"Sensor {device_ieee[-4:]}"
        else:
            dev_name = friendly_name

        # Sprawdź czy w ciągu ostatnich 12 godzin nie wysłano już alertu dla tego urządzenia
        twelve_hours_ago = (datetime.utcnow() - timedelta(hours=12)).strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute("""
            SELECT id FROM notifications 
            WHERE device_ieee = ? AND type = 'battery_low' AND timestamp >= ?
        """, (device_ieee, twelve_hours_ago))
        existing_alert = cursor.fetchone()

        if existing_alert:
            return None

        message = f"Niski poziom baterii ({battery}%) w czujniku {dev_name} ({device_ieee}). Wymagana wymiana baterii."
        now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

        cursor.execute("""
            INSERT INTO notifications (device_ieee, device_name, type, level, message, value, timestamp, acknowledged)
            VALUES (?, ?, 'battery_low', 'critical', ?, ?, ?, 0)
        """, (device_ieee, dev_name, message, float(battery), now))
        inserted_id = cursor.lastrowid
        conn.commit()

        return {
            "id": inserted_id,
            "device_ieee": device_ieee,
            "device_name": dev_name,
            "type": "battery_low",
            "level": "critical",
            "message": message,
            "battery": battery,
            "timestamp": now
        }


def get_notifications(limit: int = 50, db_path: str = DB_FILE) -> List[Dict[str, Any]]:
    """Pobiera listę powiadomień z bazy SQLite."""
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, device_ieee, device_name, type, level, message, value, timestamp, acknowledged
            FROM notifications
            ORDER BY timestamp DESC
            LIMIT ?
        """, (limit,))
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def acknowledge_notification(notification_id: int, db_path: str = DB_FILE) -> bool:
    """Oznacza powiadomienie jako przeczytane/potwierdzone."""
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE notifications SET acknowledged = 1 WHERE id = ?", (notification_id,))
        conn.commit()
        return cursor.rowcount > 0


def upsert_device(
    ieee_address: str,
    friendly_name: Optional[str] = None,
    model: Optional[str] = None,
    temperature: Optional[float] = None,
    humidity: Optional[float] = None,
    battery: Optional[int] = None,
    linkquality: Optional[int] = None,
    db_path: str = DB_FILE
) -> None:
    """Aktualizuje lub rejestruje urządzenie Zigbee w tabeli devices."""
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

        cursor.execute("SELECT friendly_name, model, battery FROM devices WHERE ieee_address = ?", (ieee_address,))
        existing = cursor.fetchone()

        if existing:
            # Zachowaj istniejącą przyjazną nazwę jeśli nie podano nowej
            target_name = friendly_name if friendly_name else existing["friendly_name"]
            target_model = model if model else existing["model"]
            target_battery = battery if battery is not None else existing["battery"]

            cursor.execute("""
                UPDATE devices
                SET friendly_name = ?,
                    model = ?,
                    last_seen = ?,
                    battery = COALESCE(?, battery),
                    last_temperature = COALESCE(?, last_temperature),
                    last_humidity = COALESCE(?, last_humidity),
                    linkquality = COALESCE(?, linkquality)
                WHERE ieee_address = ?
            """, (target_name, target_model, now, target_battery, temperature, humidity, linkquality, ieee_address))
        else:
            default_name = friendly_name if friendly_name else f"Sensor {ieee_address[-4:]}"
            default_model = model if model else "Zigbee EFR32 Sensor"
            cursor.execute("""
                INSERT INTO devices (ieee_address, friendly_name, model, last_seen, battery, last_temperature, last_humidity, linkquality)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (ieee_address, default_name, default_model, now, battery, temperature, humidity, linkquality))

        conn.commit()


def record_telemetry(
    device_ieee: str,
    temperature: float,
    humidity: float,
    battery: Optional[int] = None,
    linkquality: Optional[int] = None,
    timestamp: Optional[str] = None,
    db_path: str = DB_FILE
) -> int:
    """Pojedynczy zapis rekordu telemetrii do tabeli telemetry oraz aktualizacja statusu urządzenia."""
    if timestamp is None:
        timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    # Uaktualnij stan urządzenia w tabeli devices
    upsert_device(
        ieee_address=device_ieee,
        temperature=temperature,
        humidity=humidity,
        battery=battery,
        linkquality=linkquality,
        db_path=db_path
    )

    # Sprawdź alert niskiego poziomu baterii (< 15%)
    if battery is not None and battery <= 15:
        check_and_create_battery_alert(device_ieee, battery, db_path=db_path)

    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO telemetry (device_ieee, temperature, humidity, battery, linkquality, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (device_ieee, round(temperature, 2), round(humidity, 2), battery, linkquality, timestamp))
        inserted_id = cursor.lastrowid
        conn.commit()
        return inserted_id


def batch_record_telemetry(records: List[Dict[str, Any]], db_path: str = DB_FILE) -> int:
    """Zoptymalizowany zapis bufora pomiarów (batch insert) z poziomu asynchronicznego workera."""
    if not records:
        return 0

    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        now = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

        insert_rows = []
        for r in records:
            ieee = r.get("device_ieee")
            temp = r.get("temperature")
            hum = r.get("humidity")
            bat = r.get("battery")
            lqi = r.get("linkquality")
            ts = r.get("timestamp", now)

            if ieee and temp is not None and hum is not None:
                insert_rows.append((ieee, round(float(temp), 2), round(float(hum), 2), bat, lqi, ts))
                # Uaktualnij cache urządzenia
                cursor.execute("""
                    INSERT INTO devices (ieee_address, friendly_name, model, last_seen, battery, last_temperature, last_humidity, linkquality)
                    VALUES (?, ?, 'Zigbee Sensor', ?, ?, ?, ?, ?)
                    ON CONFLICT(ieee_address) DO UPDATE SET
                        last_seen = excluded.last_seen,
                        battery = COALESCE(excluded.battery, devices.battery),
                        last_temperature = excluded.last_temperature,
                        last_humidity = excluded.last_humidity,
                        linkquality = COALESCE(excluded.linkquality, devices.linkquality);
                """, (ieee, f"Sensor {ieee[-4:]}", ts, bat, temp, hum, lqi))

        if insert_rows:
            cursor.executemany("""
                INSERT INTO telemetry (device_ieee, temperature, humidity, battery, linkquality, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            """, insert_rows)

        conn.commit()

        # Sprawdź powiadomienia baterii dla zrzucanych rekordów
        for r in records:
            b = r.get("battery")
            d_ieee = r.get("device_ieee")
            if b is not None and b <= 15 and d_ieee:
                check_and_create_battery_alert(d_ieee, b, db_path=db_path)

        return len(insert_rows)


def get_devices(db_path: str = DB_FILE) -> List[Dict[str, Any]]:
    """Zwraca listę wszystkich zarejestrowanych urządzeń wraz z ostatnimi pomiarami."""
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT ieee_address, friendly_name, model, last_seen, battery, last_temperature, last_humidity, linkquality
            FROM devices
            ORDER BY friendly_name ASC
        """)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def get_device(ieee_address: str, db_path: str = DB_FILE) -> Optional[Dict[str, Any]]:
    """Pobiera pojedyncze urządzenie po adresie IEEE."""
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT ieee_address, friendly_name, model, last_seen, battery, last_temperature, last_humidity, linkquality
            FROM devices
            WHERE ieee_address = ?
        """, (ieee_address,))
        row = cursor.fetchone()
        return dict(row) if row else None


def update_device_name(ieee_address: str, friendly_name: str, db_path: str = DB_FILE) -> bool:
    """Zmienia przyjazną nazwę czujnika."""
    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE devices SET friendly_name = ? WHERE ieee_address = ?
        """, (friendly_name, ieee_address))
        conn.commit()
        return cursor.rowcount > 0


def _parse_range_cutoff(range_str: str) -> tuple[datetime, Optional[str]]:
    """Konwertuje zakres (6h, 24h, 7d, 30d, 90d, 360d, 720d) na datę odcięcia oraz interwał agregacji SQL."""
    now = datetime.utcnow()
    unit = range_str[-1].lower()
    val = int(range_str[:-1]) if range_str[:-1].isdigit() else 24

    if unit == 'h':
        delta = timedelta(hours=val)
        downsample = None if val <= 6 else "%Y-%m-%d %H:%M" # dla 24h co parę minut
    elif unit == 'd':
        delta = timedelta(days=val)
        if val <= 7:
            downsample = "%Y-%m-%d %H:00" # co godzinę
        elif val <= 30:
            downsample = "%Y-%m-%d %H:00" # co godzinę
        else:
            downsample = "%Y-%m-%d" # co dzień
    else:
        delta = timedelta(hours=24)
        downsample = None

    cutoff = now - delta
    return cutoff, downsample


def get_telemetry_history(
    device_ieee: str,
    range_str: str = "24h",
    limit: int = 500,
    db_path: str = DB_FILE
) -> List[Dict[str, Any]]:
    """
    Pobiera historię pomiarów dla danego czujnika.
    Dla krótkich zakresów (6h, 24h) zwraca surowe dane.
    Dla długich zakresów (7d, 30d, 90d, 360d, 720d) wykonuje agregację SQL w locie,
    zapewniając natychmiastowe ładowanie wykresów w Chart.js.
    """
    cutoff, downsample_fmt = _parse_range_cutoff(range_str)
    cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S")

    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()

        if downsample_fmt:
            # Agregacja czasowa z użyciem strftime w SQLite
            query = f"""
                SELECT 
                    strftime('{downsample_fmt}', timestamp) AS bucket,
                    ROUND(AVG(temperature), 2) AS temperature,
                    ROUND(AVG(humidity), 2) AS humidity,
                    ROUND(AVG(battery)) AS battery,
                    ROUND(AVG(linkquality)) AS linkquality,
                    MIN(timestamp) AS timestamp
                FROM telemetry
                WHERE device_ieee = ? AND timestamp >= ?
                GROUP BY bucket
                ORDER BY timestamp ASC
                LIMIT ?
            """
            cursor.execute(query, (device_ieee, cutoff_str, limit))
        else:
            query = """
                SELECT id, device_ieee, temperature, humidity, battery, linkquality, timestamp
                FROM telemetry
                WHERE device_ieee = ? AND timestamp >= ?
                ORDER BY timestamp ASC
                LIMIT ?
            """
            cursor.execute(query, (device_ieee, cutoff_str, limit))

        rows = cursor.fetchall()
        return [dict(row) for row in rows]


def get_telemetry_stats(
    device_ieee: str,
    range_str: str = "24h",
    db_path: str = DB_FILE
) -> Dict[str, Any]:
    """Oblicza min, max, avg dla temperatury i wilgotności w wybranym przedziale czasowym."""
    cutoff, _ = _parse_range_cutoff(range_str)
    cutoff_str = cutoff.strftime("%Y-%m-%d %H:%M:%S")

    with get_db_connection(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT 
                COUNT(*) as count,
                ROUND(MIN(temperature), 2) as min_temp,
                ROUND(MAX(temperature), 2) as max_temp,
                ROUND(AVG(temperature), 2) as avg_temp,
                ROUND(MIN(humidity), 2) as min_hum,
                ROUND(MAX(humidity), 2) as max_hum,
                ROUND(AVG(humidity), 2) as avg_hum,
                MIN(battery) as min_bat,
                MAX(battery) as max_bat
            FROM telemetry
            WHERE device_ieee = ? AND timestamp >= ?
        """, (device_ieee, cutoff_str))
        row = cursor.fetchone()
        return dict(row) if row else {}


if __name__ == "__main__":
    init_db()
    print("Baza danych telemetry.db zainicjalizowana pomyślnie.")
