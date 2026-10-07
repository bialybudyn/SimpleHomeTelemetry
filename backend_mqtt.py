"""
backend_mqtt.py - Implementacja backendu IoT oparta o Zigbee2MQTT, broker Eclipse Mosquitto oraz FastAPI.
Subskrybuje temat 'zigbee2mqtt/#', ignoruje komunikaty systemowe 'zigbee2mqtt/bridge/*',
buforuje odczyty w asynchronicznej kolejce (async worker) i zapisuje do bazy SQLite (telemetry.db).
Dostarcza REST API oraz streaming WebSocket do frontendu WWW i aplikacji Android.
"""

import os
import json
import asyncio
import logging
from typing import Set, Dict, Any, Optional
from datetime import datetime
from contextlib import asynccontextmanager

import paho.mqtt.client as mqtt
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

import database

# Konfiguracja logowania
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("backend_mqtt")

# Konfiguracja srodowiskowa
MQTT_BROKER_HOST = os.environ.get("MQTT_BROKER_HOST", "localhost")
MQTT_BROKER_PORT = int(os.environ.get("MQTT_BROKER_PORT", "1883"))
MQTT_TOPIC_PREFIX = os.environ.get("MQTT_TOPIC_PREFIX", "zigbee2mqtt")
MQTT_USERNAME = os.environ.get("MQTT_USERNAME", None)
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD", None)

HTTP_PORT = int(os.environ.get("PORT", "8000"))

# Kolejka asynchroniczna do buforowania zapisow bazy danych (SQLite batch worker)
telemetry_queue: asyncio.Queue = asyncio.Queue()

# Menadzer aktywnych polaczen WebSocket
class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info(f"Klient WebSocket polaczony. Lacznie aktywnych: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)
        logger.info(f"Klient WebSocket rozlaczony. Pozostalo: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        if not self.active_connections:
            return
        msg_str = json.dumps(message)
        dead_connections = set()
        for connection in self.active_connections:
            try:
                await connection.send_text(msg_str)
            except Exception as e:
                logger.warning(f"Blad wysylania do WebSocket: {e}")
                dead_connections.add(connection)
        for dead in dead_connections:
            self.active_connections.discard(dead)

manager = ConnectionManager()
mqtt_client: Optional[mqtt.Client] = None
main_event_loop: Optional[asyncio.AbstractEventLoop] = None


# Worker buforujacy zapisy do SQLite
async def sqlite_batch_worker():
    """Asynchroniczny proces zbierajacy rekordy z kolejki i wykonujacy okresowy batch insert."""
    logger.info("Uruchomiono SQLite batch worker.")
    buffer = []
    last_flush = asyncio.get_event_loop().time()

    while True:
        try:
            # Pobierz element z kolejki z timeoutem 1.5 sekundy
            try:
                item = await asyncio.wait_for(telemetry_queue.get(), timeout=1.5)
                buffer.append(item)
                telemetry_queue.task_done()
            except asyncio.TimeoutError:
                pass

            now = asyncio.get_event_loop().time()
            # Zrzucaj bufor jesli zebralo sie >= 20 wpisow lub minely 2 sekundy od ostatniego zrzutu
            if buffer and (len(buffer) >= 20 or (now - last_flush) >= 2.0):
                loop = asyncio.get_running_loop()
                count = await loop.run_in_executor(None, database.batch_record_telemetry, buffer.copy())
                logger.debug(f"Zapisano w batchu {count} rekordow do SQLite.")
                buffer.clear()
                last_flush = now

        except asyncio.CancelledError:
            if buffer:
                database.batch_record_telemetry(buffer)
            break
        except Exception as e:
            logger.error(f"Nieoczekiwany blad w sqlite_batch_worker: {e}", exc_info=True)
            await asyncio.sleep(1)


# Callbacki klienta MQTT (Paho MQTT)
def on_connect(client, userdata, flags, rc, properties=None):
    if rc == 0:
        logger.info(f"Polaczono z brokerem MQTT {MQTT_BROKER_HOST}:{MQTT_BROKER_PORT}")
        # Subskrypcja tematu Zigbee2MQTT
        sub_topic = f"{MQTT_TOPIC_PREFIX}/#"
        client.subscribe(sub_topic)
        logger.info(f"Subskrypcja tematu MQTT: {sub_topic}")
    else:
        logger.error(f"Blad polaczenia z brokerem MQTT, kod: {rc}")


def on_message(client, userdata, msg):
    """Przetwarza przychodzace wiadomosci z Zigbee2MQTT."""
    try:
        topic = msg.topic
        payload_str = msg.payload.decode("utf-8")

        # 1. Ignoruj wiadomosci systemowe Zigbee2MQTT
        if topic.startswith(f"{MQTT_TOPIC_PREFIX}/bridge/"):
            return

        # 2. Wyodrebnij identyfikator urzadzenia (np. 'zigbee2mqtt/0x00124b002a...' -> '0x00124b002a...')
        parts = topic.split("/")
        if len(parts) < 2:
            return
        device_identifier = parts[1]

        # 3. Parsuj payload JSON
        payload = json.loads(payload_str)
        if not isinstance(payload, dict):
            return

        # Sprawdz czy to odczyt telemetrii z czujnika srodowiskowego
        temperature = payload.get("temperature")
        humidity = payload.get("humidity")
        battery = payload.get("battery")
        linkquality = payload.get("linkquality")

        # Jesli brak kluczowych pomiarow (np. urzadzenie innego typu), ignorujemy
        if temperature is None and humidity is None:
            return

        now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

        record = {
            "device_ieee": device_identifier,
            "temperature": float(temperature) if temperature is not None else None,
            "humidity": float(humidity) if humidity is not None else None,
            "battery": int(battery) if battery is not None else None,
            "linkquality": int(linkquality) if linkquality is not None else None,
            "timestamp": now_str
        }

        # 4. Przekaz do asynchronicznej kolejki i wyslij przez WebSocket do klientow
        if main_event_loop and not main_event_loop.is_closed():
            main_event_loop.call_soon_threadsafe(telemetry_queue.put_nowait, record)

            ws_payload = {
                "type": "telemetry",
                "device_ieee": device_identifier,
                "data": record
            }
            asyncio.run_coroutine_threadsafe(manager.broadcast(ws_payload), main_event_loop)

            # System powiadomien o baterii: jesli poziom spadnie ponizej 15%
            if battery is not None and int(battery) <= 15:
                alert_payload = {
                    "type": "battery_alert",
                    "device_ieee": device_identifier,
                    "friendly_name": device_identifier,
                    "battery": int(battery),
                    "message": f"Ostrzezenie: Bateria czujnika {device_identifier} spadla do {battery}%! Wymagana wymiana.",
                    "timestamp": now_str
                }
                asyncio.run_coroutine_threadsafe(manager.broadcast(alert_payload), main_event_loop)

    except json.JSONDecodeError:
        pass
    except Exception as e:
        logger.error(f"Blad przetwarzania wiadomosci MQTT: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global mqtt_client, main_event_loop
    # 1. Inicjalizacja bazy danych
    database.init_db()
    main_event_loop = asyncio.get_running_loop()

    # 2. Uruchomienie workera buforujacego
    worker_task = asyncio.create_task(sqlite_batch_worker())

    # 3. Inicjalizacja klienta MQTT
    try:
        mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="sonoff_dongle_monitor_backend")
        if MQTT_USERNAME and MQTT_PASSWORD:
            mqtt_client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)
        mqtt_client.on_connect = on_connect
        mqtt_client.on_message = on_message
        mqtt_client.connect_async(MQTT_BROKER_HOST, MQTT_BROKER_PORT, 60)
        mqtt_client.loop_start()
        logger.info(f"Uruchomiono petle MQTT w tle ({MQTT_BROKER_HOST}:{MQTT_BROKER_PORT})")
    except Exception as e:
        logger.warning(f"Nie udalo sie polaczyc z MQTT brokerem podczas startu: {e}. Dziala tryb REST API/WebSocket.")

    yield

    # Sprzatanie
    if mqtt_client:
        mqtt_client.loop_stop()
        mqtt_client.disconnect()
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Zigbee Sonoff Dongle-M Telemetry Monitor (MQTT/Z2M)",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Modele danych Pydantic dla REST API
class RenameRequest(BaseModel):
    friendly_name: str

class PermitJoinRequest(BaseModel):
    duration: int = 60

class TelemetrySimulateRequest(BaseModel):
    device_ieee: str
    temperature: float
    humidity: float
    battery: Optional[int] = 100
    linkquality: Optional[int] = 85


# REST API Endpoints
@app.get("/api/system/status")
async def get_system_status():
    """Zwraca status dzialania backendu, polaczenia z brokerem MQTT i liczbe klientow WebSocket."""
    mqtt_connected = mqtt_client.is_connected() if mqtt_client else False
    return {
        "status": "online",
        "backend": "mqtt_z2m",
        "mqtt_connected": mqtt_connected,
        "mqtt_broker": f"{MQTT_BROKER_HOST}:{MQTT_BROKER_PORT}",
        "ws_clients": len(manager.active_connections),
        "queue_size": telemetry_queue.qsize(),
        "timestamp": datetime.utcnow().isoformat()
    }


@app.get("/api/devices")
async def get_devices():
    """Zwraca liste wszystkich czujnikow wraz z ostatnimi odczytami."""
    loop = asyncio.get_running_loop()
    devices = await loop.run_in_executor(None, database.get_devices)
    return {"devices": devices}


@app.get("/api/devices/{device_ieee}")
async def get_device(device_ieee: str):
    """Pobiera szczegoly pojedynczego czujnika."""
    loop = asyncio.get_running_loop()
    device = await loop.run_in_executor(None, database.get_device, device_ieee)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"device": device}


@app.get("/api/devices/{device_ieee}/history")
async def get_device_history(
    device_ieee: str,
    range: str = Query("24h", regex="^(6h|24h|7d|30d|90d|360d|720d)$")
):
    """
    Zwraca historie pomiarow dla wybranego zakresu czasowego:
    (6h, 24h, 7d, 30d, 90d, 360d, 720d).
    Dla dlugich zakresow dane sa zoptymalizowane i zagregowane w SQLite.
    """
    loop = asyncio.get_running_loop()
    history = await loop.run_in_executor(None, database.get_telemetry_history, device_ieee, range)
    stats = await loop.run_in_executor(None, database.get_telemetry_stats, device_ieee, range)
    return {
        "device_ieee": device_ieee,
        "range": range,
        "count": len(history),
        "stats": stats,
        "history": history
    }


@app.post("/api/devices/{device_ieee}/rename")
async def rename_device(device_ieee: str, payload: RenameRequest):
    """Zmienia przyjazna nazwe czujnika w bazie SQLite."""
    loop = asyncio.get_running_loop()
    success = await loop.run_in_executor(None, database.update_device_name, device_ieee, payload.friendly_name)
    if not success:
        raise HTTPException(status_code=404, detail="Device not found")

    # Powiadom podlaczone frontendy przez WebSocket
    await manager.broadcast({
        "type": "device_renamed",
        "device_ieee": device_ieee,
        "friendly_name": payload.friendly_name
    })
    return {"status": "ok", "device_ieee": device_ieee, "friendly_name": payload.friendly_name}


@app.post("/api/permit-join")
async def permit_join(payload: PermitJoinRequest = PermitJoinRequest()):
    """Wlacza tryb parowania nowych urzadzen w Zigbee2MQTT przez publikacje na temat bridge."""
    duration = max(10, min(240, payload.duration))
    if mqtt_client and mqtt_client.is_connected():
        topic = f"{MQTT_TOPIC_PREFIX}/bridge/request/permit_join"
        msg = json.dumps({"value": True, "time": duration})
        mqtt_client.publish(topic, msg)
        logger.info(f"Wyslano zadanie permit_join ({duration}s) do Zigbee2MQTT.")
    
    # Rozglos zdarzenie do frontendow, aby uruchomic licznik
    await manager.broadcast({
        "type": "permit_join",
        "duration": duration,
        "expires_at": (datetime.utcnow().timestamp() + duration)
    })
    return {"status": "ok", "duration": duration}


@app.get("/api/notifications")
async def get_notifications(limit: int = 50):
    """Pobiera liste powiadomien systemowych, w tym alerty baterii < 15%."""
    loop = asyncio.get_running_loop()
    notifs = await loop.run_in_executor(None, database.get_notifications, limit)
    return {"notifications": notifs}


@app.post("/api/notifications/{notification_id}/acknowledge")
async def acknowledge_notification(notification_id: int):
    """Oznacza powiadomienie jako potwierdzone/odczytane."""
    loop = asyncio.get_running_loop()
    success = await loop.run_in_executor(None, database.acknowledge_notification, notification_id)
    return {"status": "ok", "acknowledged": success}


@app.post("/api/alerts/battery")
async def trigger_battery_alert(device_ieee: str, battery: int):
    """Reczne lub zdalne wywolanie powiadomienia o niskim stanie baterii."""
    loop = asyncio.get_running_loop()
    alert = await loop.run_in_executor(None, database.check_and_create_battery_alert, device_ieee, battery)
    if alert:
        await manager.broadcast({
            "type": "battery_alert",
            **alert
        })
    return {"status": "ok", "alert": alert}


@app.post("/api/simulate")
async def simulate_telemetry(payload: TelemetrySimulateRequest):
    """Punkt koncowy do symulacji i testowania odczytow srodowiskowych."""
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    record = {
        "device_ieee": payload.device_ieee,
        "temperature": payload.temperature,
        "humidity": payload.humidity,
        "battery": payload.battery,
        "linkquality": payload.linkquality,
        "timestamp": now_str
    }
    await telemetry_queue.put(record)
    await manager.broadcast({
        "type": "telemetry",
        "device_ieee": payload.device_ieee,
        "data": record
    })
    if payload.battery is not None and payload.battery <= 15:
        await manager.broadcast({
            "type": "battery_alert",
            "device_ieee": payload.device_ieee,
            "friendly_name": payload.device_ieee,
            "battery": payload.battery,
            "message": f"Niski poziom baterii ({payload.battery}%) w czujniku {payload.device_ieee}!",
            "timestamp": now_str
        })
    return {"status": "simulated", "record": record}


# WebSocket endpoint
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """Streaming pomiarow telemetrii w czasie rzeczywistym do przegladarki i aplikacji Android."""
    await manager.connect(websocket)
    try:
        # Wyslij powitanie ze statusem
        await websocket.send_text(json.dumps({
            "type": "system_hello",
            "message": "Polaczono ze strumieniem telemetrycznym Zigbee Sonoff Dongle-M",
            "timestamp": datetime.utcnow().isoformat()
        }))

        # Petla nasluchujaca wiadomosci od klienta (np. ping-pong)
        while True:
            data = await websocket.receive_text()
            try:
                parsed = json.loads(data)
                if parsed.get("type") == "ping":
                    await websocket.send_text(json.dumps({"type": "pong", "time": datetime.utcnow().isoformat()}))
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        logger.warning(f"Blad sesji WebSocket: {e}")
        manager.disconnect(websocket)


# Obsluga plikow statycznych frontendu (jesli katalog static/ istnieje)
if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn
    print(f"Uruchamianie serwera na porcie {HTTP_PORT}...")
    uvicorn.run("backend_mqtt:app", host="0.0.0.0", port=HTTP_PORT, reload=False)
