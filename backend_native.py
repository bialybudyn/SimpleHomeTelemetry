"""
backend_native.py - Natywna implementacja backendu IoT bezposrednio komunikujaca sie z koordynatorem
Sonoff Dongle-M (uklad Silicon Labs EFR32MG24) z wykorzystaniem biblioteki zigpy oraz bellows (EZSP/Ember).
Dziala w 100% bez Home Assistanta i bez brokera MQTT!
Odbiera atrybuty klastrow ZCL (temperatura, wilgotnosc, bateria), zapisuje do SQLite i streamuje do WebSockets.
"""

import os
import json
import asyncio
import logging
from typing import Set, Dict, Any, Optional
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

import database

# Logowanie
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("backend_native")

# Konfiguracja polaczenia z koordynatorem Sonoff Dongle Max (Dongle-M / EFR32MG24)
# Oficjalna dokumentacja Sonoff: https://dongle.sonoff.tech/guide/dongle-m/
# 1. Polaczenie sieciowe TCP (Ethernet / PoE / Wi-Fi) — zalecane dla Dongle Max:
#    ZIGBEE_PORT="socket://Dongle-M.local:6638" lub "socket://192.168.1.120:6638"
# 2. Polaczenie lokalne USB:
#    Linux: /dev/ttyACM0 lub /dev/serial/by-id/...
#    Windows: COM3, COM4
SERIAL_PORT = os.environ.get("ZIGBEE_PORT", "socket://Dongle-M.local:6638")
SERIAL_BAUDRATE = int(os.environ.get("ZIGBEE_BAUDRATE", "115200"))
FLOW_CONTROL = os.environ.get("ZIGBEE_FLOW_CONTROL", "none") # hardware / software / none
HTTP_PORT = int(os.environ.get("PORT", "8000"))

# Menadzer polaczen WebSocket
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
        dead = set()
        for conn in self.active_connections:
            try:
                await conn.send_text(msg_str)
            except Exception:
                dead.add(conn)
        for d in dead:
            self.active_connections.discard(d)

manager = ConnectionManager()
zigpy_app = None
main_loop: Optional[asyncio.AbstractEventLoop] = None

# Pamiec podreczna ostatnich stanow urzadzen dla agregacji atrybutow
device_cache: Dict[str, Dict[str, Any]] = {}


def handle_attribute_updated(device_ieee: str, cluster_id: int, attribute_id: int, value: Any):
    """
    Callback wywolywany przez klastry ZCL zigpy przy odebraniu raportu atrybutu od czujnika.
    Klastry:
      - 0x0402 (TemperatureMeasurement): Atrybut 0x0000 = zmierzona wartosc w 0.01 °C (np. 2150 = 21.50 °C)
      - 0x0405 (RelativeHumidity): Atrybut 0x0000 = zmierzona wartosc w 0.01 % (np. 4520 = 45.20 %)
      - 0x0001 (PowerConfiguration): Atrybut 0x0021 = BatteryPercentageRemaining w jednostkach 0.5% (np. 180 = 90%)
    """
    if device_ieee not in device_cache:
        device_cache[device_ieee] = {
            "temperature": None,
            "humidity": None,
            "battery": None,
            "linkquality": 85
        }

    dev_data = device_cache[device_ieee]
    updated = False

    # Temperatura (ZCL 0x0402)
    if cluster_id == 0x0402 and attribute_id == 0x0000:
        dev_data["temperature"] = round(float(value) / 100.0, 2)
        updated = True

    # Wilgotnosc wzgledna (ZCL 0x0405)
    elif cluster_id == 0x0405 and attribute_id == 0x0000:
        dev_data["humidity"] = round(float(value) / 100.0, 2)
        updated = True

    # Poziom baterii (ZCL 0x0001, BatteryPercentageRemaining)
    elif cluster_id == 0x0001 and attribute_id == 0x0021:
        # Wartosc 0-200 oznacza 0-100% (skok o 0.5%)
        battery_pct = int(min(100, max(0, int(value) // 2)))
        dev_data["battery"] = battery_pct
        updated = True

    # Jesli mamy odczyt temperatury i wilgotnosci, zapisz do bazy i rozglos przez WebSocket
    if updated and dev_data.get("temperature") is not None and dev_data.get("humidity") is not None:
        now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        record = {
            "device_ieee": device_ieee,
            "temperature": dev_data["temperature"],
            "humidity": dev_data["humidity"],
            "battery": dev_data.get("battery"),
            "linkquality": dev_data.get("linkquality"),
            "timestamp": now_str
        }

        # Zapisz do bazy SQLite
        database.record_telemetry(
            device_ieee=device_ieee,
            temperature=record["temperature"],
            humidity=record["humidity"],
            battery=record["battery"],
            linkquality=record["linkquality"],
            timestamp=now_str
        )

        # Wyslij powiadomienie przez WebSocket
        if main_loop and not main_loop.is_closed():
            asyncio.run_coroutine_threadsafe(
                manager.broadcast({
                    "type": "telemetry",
                    "device_ieee": device_ieee,
                    "data": record
                }),
                main_loop
            )

            # System powiadomien o baterii: jesli poziom spadnie ponizej 15%
            if record["battery"] is not None and record["battery"] <= 15:
                asyncio.run_coroutine_threadsafe(
                    manager.broadcast({
                        "type": "battery_alert",
                        "device_ieee": device_ieee,
                        "friendly_name": device_ieee,
                        "battery": record["battery"],
                        "message": f"Ostrzezenie: Bateria czujnika {device_ieee} spadla do {record['battery']}%! Wymagana wymiana.",
                        "timestamp": now_str
                    }),
                    main_loop
                )


async def init_native_zigpy():
    """Inicjalizuje stos Zigbee z obsluga protokolu EZSP/Ember dla ukladu EFR32MG24."""
    global zigpy_app
    try:
        import bellows.zigbee.application
        import zigpy.config

        config = {
            zigpy.config.CONF_DEVICE: {
                zigpy.config.CONF_DEVICE_PATH: SERIAL_PORT,
                zigpy.config.CONF_DEVICE_BAUDRATE: SERIAL_BAUDRATE,
                "flow_control": FLOW_CONTROL
            },
            zigpy.config.CONF_DATABASE_PATH: "zigbee_native.db",
            zigpy.config.CONF_NWK: {
                zigpy.config.CONF_NWK_CHANNEL: 15,
                zigpy.config.CONF_NWK_EXTENDED_PAN_ID: "dd:dd:dd:dd:dd:dd:dd:dd",
                zigpy.config.CONF_NWK_PAN_ID: 0x1A62,
            }
        }

        logger.info(f"Nawiazywanie polaczenia z donglem Sonoff (EFR32MG24) na porcie {SERIAL_PORT}...")
        zigpy_app = await bellows.zigbee.application.ControllerApplication.new(config)
        await zigpy_app.startup(auto_form=True)
        logger.info(f"Koordynator Zigbee uruchomiony pomyslnie. IEEE: {zigpy_app.state.node_info.ieee}")

        # Podpiecie listenerow dla zarejestrowanych i nowych urzadzen
        for dev in zigpy_app.devices.values():
            register_device_listeners(dev)

        def on_device_joined(device):
            logger.info(f"Nowe urzadzenie dolaczylo do sieci Zigbee: IEEE {device.ieee}")
            register_device_listeners(device)
            if main_loop:
                asyncio.run_coroutine_threadsafe(
                    manager.broadcast({
                        "type": "device_joined",
                        "ieee_address": str(device.ieee),
                        "model": getattr(device, "model", "Zigbee Sensor")
                    }),
                    main_loop
                )

        zigpy_app.add_listener("device_joined", on_device_joined)

    except ImportError:
        logger.warning("Pakiet bellows/zigpy nie jest zainstalowany. Backend dziala w trybie symulacji REST/WebSocket.")
    except Exception as e:
        logger.warning(f"Nie udalo sie polaczyc z donglem sprzetowym na {SERIAL_PORT}: {e}. Dziala tryb REST/WebSocket.")


def register_device_listeners(device):
    """Rejestruje nasluchiwanie raportow atrybutow dla klastrow czujnika."""
    ieee_str = str(device.ieee)
    for endpoint in device.endpoints.values():
        if hasattr(endpoint, "in_clusters"):
            for cluster_id, cluster in endpoint.in_clusters.items():
                if cluster_id in (0x0402, 0x0405, 0x0001):
                    def make_attr_listener(c_id):
                        def listener(attr_id, value):
                            handle_attribute_updated(ieee_str, c_id, attr_id, value)
                        return listener
                    cluster.add_listener("attribute_updated", make_attr_listener(cluster_id))


@asynccontextmanager
async def lifespan(app: FastAPI):
    global main_loop
    main_loop = asyncio.get_running_loop()
    database.init_db()

    # Uruchomienie watku koordynatora w tle
    asyncio.create_task(init_native_zigpy())

    yield

    if zigpy_app:
        try:
            await zigpy_app.shutdown()
        except Exception:
            pass


app = FastAPI(
    title="Zigbee Sonoff Dongle-M Telemetry Monitor (Natywny zigpy/EZSP)",
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
    coordinator_status = "connected" if zigpy_app else "standby_or_simulated"
    return {
        "status": "online",
        "backend": "native_zigpy_ezsp",
        "chip": "Silicon Labs EFR32MG24 (Sonoff Dongle-M)",
        "port": SERIAL_PORT,
        "coordinator_status": coordinator_status,
        "ws_clients": len(manager.active_connections),
        "timestamp": datetime.utcnow().isoformat()
    }


@app.get("/api/devices")
async def get_devices():
    loop = asyncio.get_running_loop()
    devices = await loop.run_in_executor(None, database.get_devices)
    return {"devices": devices}


@app.get("/api/devices/{device_ieee}")
async def get_device(device_ieee: str):
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
    loop = asyncio.get_running_loop()
    success = await loop.run_in_executor(None, database.update_device_name, device_ieee, payload.friendly_name)
    if not success:
        raise HTTPException(status_code=404, detail="Device not found")

    await manager.broadcast({
        "type": "device_renamed",
        "device_ieee": device_ieee,
        "friendly_name": payload.friendly_name
    })
    return {"status": "ok", "device_ieee": device_ieee, "friendly_name": payload.friendly_name}


@app.post("/api/permit-join")
async def permit_join(payload: PermitJoinRequest = PermitJoinRequest()):
    """Wlacza parowanie (permit_join) bezposrednio w koordynatorze zigpy."""
    duration = max(10, min(240, payload.duration))
    if zigpy_app:
        try:
            await zigpy_app.permit(duration)
            logger.info(f"Koordynator zezwolil na parowanie przez {duration} sekund.")
        except Exception as e:
            logger.error(f"Blad uruchamiania parowania w koordynatorze: {e}")

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
    """Wywolanie powiadomienia o niskim stanie baterii."""
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
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    database.record_telemetry(
        device_ieee=payload.device_ieee,
        temperature=payload.temperature,
        humidity=payload.humidity,
        battery=payload.battery,
        linkquality=payload.linkquality,
        timestamp=now_str
    )
    record = {
        "device_ieee": payload.device_ieee,
        "temperature": payload.temperature,
        "humidity": payload.humidity,
        "battery": payload.battery,
        "linkquality": payload.linkquality,
        "timestamp": now_str
    }
    await manager.broadcast({
        "type": "telemetry",
        "device_ieee": payload.device_ieee,
        "data": record
    })
    return {"status": "simulated", "record": record}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        await websocket.send_text(json.dumps({
            "type": "system_hello",
            "message": "Polaczono z natywnym backendem Zigpy Sonoff Dongle-M",
            "timestamp": datetime.utcnow().isoformat()
        }))
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
    except Exception:
        manager.disconnect(websocket)


if os.path.exists("static"):
    app.mount("/static", StaticFiles(directory="static"), name="static")

    @app.get("/")
    async def serve_index():
        return FileResponse("static/index.html")


if __name__ == "__main__":
    import uvicorn
    print(f"Uruchamianie natywnego serwera na porcie {HTTP_PORT}...")
    uvicorn.run("backend_native:app", host="0.0.0.0", port=HTTP_PORT, reload=False)
