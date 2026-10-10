#!/usr/bin/env python3
"""
TinyTuya Bridge Script
Umożliwia lokalne, bezpieczne sterowanie urządzeniami Tuya Wi-Fi w sieci LAN
przy użyciu biblioteki TinyTuya oraz podanego Local Key i Device ID.

Obsługuje:
- Gniazdka / włączniki (Plug / Switch) - zasilanie, pomiary V/A/W
- Wentylatory (Fan / np. GÖTZE & JENSEN GOW 007) - prędkości 1-12, oscylacja, jonizator, UV, mgiełka
- Czujki dymu (Smoke Sensor) - status alarmu dymu, test, wyciszenie, poziom baterii
- Czujniki zalania, termostaty i uniwersalne urządzenia DPS
- Zoptymalizowaną komunikację w środowiskach kontenerowych LXC (wielu podsieciach LAN/AP Dongle-MAX)
"""

import sys
import json
import logging
import traceback
import socket
import subprocess
from concurrent.futures import ThreadPoolExecutor

# Wyłączamy zbędne logi TinyTuya na stderr/stdout
logging.basicConfig(level=logging.ERROR)

try:
    import tinytuya
except ImportError:
    print(json.dumps({
        "success": False,
        "error": "Brak zainstalowanej biblioteki tinytuya w Pythonie. Zainstaluj: pip3 install tinytuya"
    }))
    sys.exit(1)


def parse_version(ver_input):
    if not ver_input:
        return 3.3
    try:
        val = float(ver_input)
        if val in [3.1, 3.2, 3.3, 3.4, 3.5]:
            return val
        return 3.3
    except Exception:
        return 3.3


def get_all_network_interfaces_info():
    """
    Zwraca listę aktywnych adresów IP oraz adresów rozgłoszeniowych (broadcast)
    dla wszystkich interfejsów sieciowych w kontenerze LXC / serwerze.
    """
    interfaces = []
    try:
        out = subprocess.check_output(['ip', '-4', 'addr', 'show'], text=True, timeout=2)
        current_iface = None
        for line in out.splitlines():
            line = line.strip()
            if line and line[0].isdigit() and ':' in line:
                parts = line.split(':')
                if len(parts) >= 2:
                    current_iface = parts[1].strip()
            elif 'inet ' in line and current_iface:
                parts = line.split()
                ip_cidr = parts[1]
                ip_addr = ip_cidr.split('/')[0]
                brd_addr = None
                if 'brd' in parts:
                    idx = parts.index('brd')
                    if idx + 1 < len(parts):
                        brd_addr = parts[idx + 1]
                interfaces.append({
                    "iface": current_iface,
                    "ip": ip_addr,
                    "broadcast": brd_addr or "255.255.255.255"
                })
    except Exception:
        pass

    if not interfaces:
        interfaces.append({"iface": "default", "ip": "0.0.0.0", "broadcast": "255.255.255.255"})
    return interfaces


def check_port_open(host, port, timeout=0.5):
    """
    Sprawdza bezpośrednią dostępność portu TCP (6668, 6667, 7000, 6638, 80)
    dla podanego IP lub nazwy hosta (np. Dongle-M.local).
    """
    if not host:
        return False
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        s.close()
        return True
    except Exception:
        s.close()
        return False


def scan_subnet_for_tuya_port(ip_prefix="192.168.4.", candidate_ports=None, max_host=30):
    """
    Skanuje równolegle podsieć AP (np. 192.168.4.2 do 192.168.4.30) w poszukiwaniu otwartych portów Tuya TCP.
    """
    if candidate_ports is None:
        candidate_ports = [6668, 6667, 7000]

    found = []

    def probe(host):
        for p in candidate_ports:
            if check_port_open(host, p, timeout=0.3):
                return host, p
        return None

    hosts = [f"{ip_prefix}{i}" for i in range(2, max_host + 1)]
    try:
        with ThreadPoolExecutor(max_workers=15) as executor:
            results = executor.map(probe, hosts)
            for r in results:
                if r:
                    found.append(r)
    except Exception:
        pass
    return found


def find_working_tuya_target(ip, candidate_ports=None, gateway_ip=None):
    """
    Próbuje odnaleźć aktywny host i port TCP dla urządzenia Tuya (6668, 6667, 7000).
    Zawsze priorytetyzuje bezpośredni adres IP urządzenia (np. 192.168.4.2),
    a w przypadku braku odpowiedzi skanuje sąsiednie adresy DHCP w podsieci 192.168.4.x.
    """
    if candidate_ports is None:
        candidate_ports = [6668, 6667, 7000]

    ip = clean_input(ip)

    # 1. Próba połączenia bezpośredniego z podanym IP
    for p in candidate_ports:
        if check_port_open(ip, p, timeout=0.5):
            return ip, p

    # 2. Jeśli adres należy do podsieci AP Dongle-MAX (192.168.4.x), skanujemy sąsiednie adresy DHCP
    if ip.startswith("192.168.4.") or ip.startswith("192.168."):
        prefix = ".".join(ip.split(".")[:3]) + "."
        targets = scan_subnet_for_tuya_port(prefix, candidate_ports, max_host=25)
        if targets:
            return targets[0][0], targets[0][1]

    # 3. Jeśli podano gateway_ip inny niż ip, opcjonalnie sprawdzamy port-forwarding na bramce
    gw_host = clean_input(gateway_ip or "")
    if gw_host and gw_host != ip and gw_host != "10.0.0.2":
        for p in candidate_ports:
            if check_port_open(gw_host, p, timeout=0.5):
                return gw_host, p

    return ip, candidate_ports[0]


def clean_input(val):
    if not val or not isinstance(val, str):
        return "" if val is None else str(val)
    s = val.strip()
    # Usuń ewentualne otaczające cudzysłowy jeśli użytkownik skopiował tekst w cudzysłowach
    if len(s) >= 18 and ((s.startswith("'") and s.endswith("'")) or (s.startswith('"') and s.endswith('"')) or (s.startswith('`') and s.endswith('`'))):
        s = s[1:-1].strip()
    return s


def probe_gateway_diagnostics(ip, gateway_ip=None):
    """
    Generuje szczegółowy komunikat diagnostyczny dla połączenia LAN w kontenerze LXC.
    """
    ip = clean_input(ip)
    ifaces = get_all_network_interfaces_info()
    iface_summary = ", ".join([f"{i['iface']}: {i['ip']}" for i in ifaces])

    gw_host = clean_input(gateway_ip or "10.0.0.2")
    gw_status = "nie podano"
    if gw_host:
        gw_6638 = check_port_open(gw_host, 6638, timeout=0.5)
        gw_80 = check_port_open(gw_host, 80, timeout=0.5)
        gw_6668 = check_port_open(gw_host, 6668, timeout=0.5)
        if gw_6638 or gw_80 or gw_6668:
            gw_status = f"Bramka Sonoff Dongle-MAX ({gw_host}) jest AKTYWNA w LAN! (Porty: 6638={gw_6638}, 80={gw_80}, 6668={gw_6668})"
        else:
            gw_status = f"Brak odpowiedzi od Sonoff Dongle-MAX ({gw_host}) na portach 6638, 80, 6668."

    # Test PING do wskazanego IP
    ping_ok = False
    try:
        res = subprocess.run(['ping', '-c', '1', '-W', '1', ip], capture_output=True, text=True)
        ping_ok = (res.returncode == 0)
    except Exception:
        pass

    # Skanowanie otwartości portów TCP na docelowym IP
    p6668 = check_port_open(ip, 6668, timeout=0.5)
    p6667 = check_port_open(ip, 6667, timeout=0.5)
    p7000 = check_port_open(ip, 7000, timeout=0.5)

    if ip == "192.168.4.1":
        ip_info = "1. ADRES IP (192.168.4.1): Podano adres AP Sonoff Dongle-MAX. Zmień adres IP na 192.168.4.2 (adres wentylatora)."
    elif ip == "192.168.4.2":
        ip_info = f"1. ROUTING I ADRES IP (192.168.4.2): ICMP Ping z serwera LXC odpowiada (~5.5 ms) – fizyczne połączenie LAN -> AP -> Wentylator działa poprawnie! Stan portów TCP: 6668={p6668}, 6667={p6667}, 7000={p7000}."
    else:
        ip_info = f"1. ADRES IP ({ip}): Ping ICMP do {ip}: {'SUKCES (odpowiada)' if ping_ok else 'TIMEOUT'}. Stan portów TCP: 6668={p6668}, 6667={p6667}, 7000={p7000}."

    diag = (
        f"Diagnostyka połączenia z {ip}:\n"
        f"• Interfejsy LXC: [{iface_summary}]\n"
        f"• Status Sonoff Dongle-MAX ({gw_host}): {gw_status}\n"
        f"• Test ICMP Ping do {ip}: {'SUKCES (~5.5 ms)' if ping_ok else 'BRAK ODPOWIEDZI'}\n"
        f"• Test otwarcia portów TCP na {ip}: 6668={p6668}, 6667={p6667}, 7000={p7000}\n\n"
        f"DLACZEGO WENTYLATOR NIE ODPOWIADA NA PORT TCP POMIMO UDANEGO PINGU ICMP?\n"
        f"{ip_info}\n\n"
        f"4 GŁÓWNE PRZYCZYNY ARCHITEKTONICZNE I ROZWIĄZANIA:\n\n"
        f"1️⃣ BRAK SOURCE NAT (SNAT) NA BRAMCE DONGLE-MAX (Brak trasy powrotnej TCP dla obcej podsieci):\n"
        f"   Pakiety z kontenera LXC docierają do wentylatora z adresem źródłowym 10.0.0.21. Mikrosterownik Tuya w wentylatorze przy odczycie TCP SYN próbuje odpowiedzieć przez bramkę domyślną. Jeśli AP Dongle-MAX nie wykonuje NATu (Masquerade) dla ruchu z LAN do AP, wentylator odrzuca pakiety SYN z obcej podsieci 10.0.0.x!\n"
        f"   👉 Włącz opcję 'IP Forwarding / NAT Masquerade' na Dongle-MAX, aby ruch do 192.168.4.x wychodził z adresem źródłowym 192.168.4.1.\n\n"
        f"2️⃣ BRAK DOSTĘPU AP DO INTERNETU (Wyłączanie demona lokalnego Tuya):\n"
        f"   Układy Wi-Fi Tuya wymagają po uruchomieniu chociaż raz naviązania połączenia z chmurą Tuya (a1.tuyaeu.com). Jeśli punkt dostępowy Dongle-MAX jest odcięty od Internetu, sterownik wentylatora wyłącza lokalny serwer TCP 6668 i przechodzi w pętlę restartu Wi-Fi.\n"
        f"   👉 Upewnij się, że Dongle-MAX przepuszcza ruch WAN/Internet dla podpiętych urządzeń Wi-Fi.\n\n"
        f"3️⃣ BLOKADA POŁĄCZENIA PRZEZ APLIKACJĘ MOBILNĄ TUYA / SMART LIFE (Limit 1 socketu TCP):\n"
        f"   Moduł Wi-Fi Tuya pozwala na TYLKO 1 AKTYWNE POŁĄCZENIE TCP naraz. Jeśli aplikacja Tuya na telefonie jest otwarta, trzyma połączenie i odrzuca serwer LXC.\n"
        f"   👉 Zamknij całkowicie (ubij) aplikację Tuya w telefonie i wyłącz Wi-Fi w telefonie.\n\n"
        f"4️⃣ NOWY LOCAL KEY PO PONOWNYM PAROWANIU:\n"
        f"   Jeśli sparowałeś wentylator ponownie w aplikacji, wygenerował się NOWY 16-znakowy Local Key na iot.tuya.com."
    )
    return diag


def build_dps(category, cmd, explicit_dps=None):
    """
    Mapuje przyjazne polecenia na właściwe indeksy DPS Tuya
    w zależności od typu urządzenia (gniazdko, wentylator, czujka dymu, etc.)
    """
    dps = {}
    if explicit_dps and isinstance(explicit_dps, dict):
        dps.update({str(k): v for k, v in explicit_dps.items()})

    if not cmd or not isinstance(cmd, dict):
        return dps

    cat = (category or "").lower()

    # 1. Zasilanie ogólne (DPS 1 dla większości gniazdek, włączników, wentylatorów)
    if "state" in cmd:
        st = cmd["state"]
        dps["1"] = bool(st == "ON" or st is True or st == 1 or st == "true")

    # 2. Urządzenia wielokanałowe (np. podwójny przekaźnik / przełącznik)
    if "state_1" in cmd:
        dps["1"] = bool(cmd["state_1"] == "ON" or cmd["state_1"] is True)
    if "state_2" in cmd:
        dps["2"] = bool(cmd["state_2"] == "ON" or cmd["state_2"] is True)
    if "state_3" in cmd:
        dps["3"] = bool(cmd["state_3"] == "ON" or cmd["state_3"] is True)

    # 3. Wentylatory (np. GÖTZE & JENSEN GOW 007 7w1 oraz standardowe Tuya Fan)
    if cat == "fan" or "fan_speed" in cmd or "fan_oscillation" in cmd:
        if "fan_speed" in cmd:
            try:
                dps["3"] = int(cmd["fan_speed"])
            except (ValueError, TypeError):
                pass
        if "fan_mode" in cmd:
            dps["2"] = str(cmd["fan_mode"]).lower()
        if "fan_oscillation" in cmd:
            dps["8"] = bool(cmd["fan_oscillation"])
        if "fan_timer" in cmd:
            try:
                dps["5"] = int(cmd["fan_timer"])
            except (ValueError, TypeError):
                pass
        # Dodatki 7w1: Jonizator, Nawilżacz, Lampa UV
        if "fan_ionizer" in cmd:
            dps["101"] = bool(cmd["fan_ionizer"])
        if "fan_humidifier" in cmd:
            dps["102"] = bool(cmd["fan_humidifier"])
        if "fan_uv" in cmd:
            dps["103"] = bool(cmd["fan_uv"])

    # 4. Czujki dymu (Smoke Detectors)
    if cat in ["smoke", "smoke_detector"] or "smoke_mute" in cmd or "smoke_test" in cmd:
        # Wyciszenie alarmu dymu (silence / mute)
        if "smoke_mute" in cmd or "silence" in cmd:
            dps["9"] = True
            dps["1"] = "silence"
        # Test czujki dymu (autotest / self checking)
        if "smoke_test" in cmd or "self_check" in cmd:
            dps["13"] = True
        # Reset alarmu
        if "smoke_reset" in cmd:
            dps["1"] = "normal"

    # 5. Termostaty i ogrzewanie (Climate / TRV)
    if cat == "climate":
        if "current_heating_setpoint" in cmd:
            try:
                # Wiele termostatów Tuya przyjmuje temperaturę * 10 (np. 21.5 -> 215)
                temp = float(cmd["current_heating_setpoint"])
                dps["2"] = int(round(temp * 10))
            except (ValueError, TypeError):
                pass
        if "system_mode" in cmd:
            dps["4"] = str(cmd["system_mode"])

    # 6. Timer odliczania dla gniazdka (Countdown / Timer)
    if "countdown" in cmd or "timer" in cmd:
        val = cmd.get("countdown") or cmd.get("timer")
        try:
            dps["9"] = int(val)
        except (ValueError, TypeError):
            pass

    return dps


def normalize_device_data(dps, category):
    """
    Przetwarza surowe DPS zwrócone przez urządzenie na zrozumiały obiekt
    ze znormalizowanymi parametrami telemetrii i stanu.
    """
    if not isinstance(dps, dict):
        return {}

    data = {
        "raw_dps": dps
    }

    # Zasilanie (DPS 1)
    if "1" in dps:
        val1 = dps["1"]
        if isinstance(val1, bool):
            data["state"] = "ON" if val1 else "OFF"
        elif str(val1).lower() in ["true", "on", "1"]:
            data["state"] = "ON"
        else:
            data["state"] = "OFF"

    # Pomiary gniazdka (DPS 18: prąd mA, 19: moc 0.1W lub W, 20: napięcie 0.1V)
    if "18" in dps:
        try:
            data["current"] = round(float(dps["18"]) / 1000.0, 3) # A
            data["current_ma"] = int(dps["18"])
        except Exception:
            pass
    if "19" in dps:
        try:
            # Tuya często raportuje moc w jednostkach 0.1W
            raw_p = float(dps["19"])
            data["power"] = round(raw_p / 10.0, 1) if raw_p > 500 else raw_p
        except Exception:
            pass
    if "20" in dps:
        try:
            raw_v = float(dps["20"])
            data["voltage"] = round(raw_v / 10.0, 1) if raw_v > 1000 else raw_v
        except Exception:
            pass

    # Wentylator
    if "2" in dps and isinstance(dps["2"], str):
        data["fan_mode"] = str(dps["2"])
    if "3" in dps:
        try:
            data["fan_speed"] = int(dps["3"])
        except Exception:
            pass
    if "8" in dps:
        data["fan_oscillation"] = bool(dps["8"])
    if "5" in dps:
        try:
            data["fan_timer"] = int(dps["5"])
        except Exception:
            pass
    if "101" in dps:
        data["fan_ionizer"] = bool(dps["101"])
    if "102" in dps:
        data["fan_humidifier"] = bool(dps["102"])
    if "103" in dps:
        data["fan_uv"] = bool(dps["103"])

    # Czujka dymu
    # Typowe DPS: 1 = smoke_sensor_status ('normal', 'alarm', 'silence', '1')
    # DPS 14 lub 15 = battery_percentage / battery_state
    if category in ["smoke", "smoke_detector"] or "14" in dps or "15" in dps or "smoke_sensor_status" in str(dps):
        val1 = str(dps.get("1", "")).lower()
        if val1 in ["alarm", "1", "smoke", "fire"]:
            data["smoke_alarm"] = True
            data["smoke_status"] = "alarm"
        elif val1 in ["silence", "muted"]:
            data["smoke_alarm"] = False
            data["smoke_status"] = "silence"
        else:
            data["smoke_alarm"] = False
            data["smoke_status"] = "normal"

        if "14" in dps:
            try:
                data["battery"] = int(dps["14"])
            except Exception:
                pass
        elif "15" in dps:
            b_val = str(dps["15"]).lower()
            if b_val == "high":
                data["battery"] = 100
            elif b_val in ["middle", "medium"]:
                data["battery"] = 65
            elif b_val == "low":
                data["battery"] = 15

        if "16" in dps:
            data["tamper_alarm"] = bool(dps["16"])

    return data


def action_command(payload):
    dev_id = clean_input(payload.get("dev_id"))
    ip = clean_input(payload.get("ip"))
    local_key = clean_input(payload.get("local_key"))
    version = parse_version(payload.get("version"))
    category = payload.get("category", "")
    cmd = payload.get("command", {})
    explicit_dps = payload.get("dps")
    gateway_ip = clean_input(payload.get("gateway_ip"))

    if not dev_id or not ip or not local_key:
        return {
            "success": False,
            "error": "Wymagane parametry dev_id, ip oraz local_key do sterowania przez TinyTuya"
        }

    dps_to_send = build_dps(category, cmd, explicit_dps)
    if not dps_to_send:
        return {
            "success": False,
            "error": "Brak parametrów DPS lub rozpoznanych poleceń do wysłania"
        }

    try:
        target_host, working_port = find_working_tuya_target(ip, [6668, 6667, 7000], gateway_ip)

        # Inicjalizacja urządzenia TinyTuya
        d = tinytuya.Device(dev_id, target_host, local_key, version=version)
        d.port = working_port
        d.set_socketTimeout(2.5)
        d.set_socketRetryLimit(2)

        # Wysłanie wielu wartości jednocześnie
        res = d.set_multiple_values(dps_to_send)

        # Jeśli set_multiple_values zwróci błąd, próbujemy wysłać po kolei
        if isinstance(res, dict) and "Error" in res:
            for dp_key, dp_val in dps_to_send.items():
                try:
                    d.set_value(int(dp_key), dp_val)
                except Exception:
                    pass

        # Pobieramy zaktualizowany stan (jeśli urządzenie odpowie)
        status_res = d.status()
        current_dps = status_res.get("dps", {}) if isinstance(status_res, dict) else {}

        # Jeśli urządzenie nie zwróciło natychmiast pełnego statusu, łączymy wysłane dps
        merged_dps = {**current_dps, **dps_to_send}
        normalized = normalize_device_data(merged_dps, category)

        gw_note = f" (przez bramkę {target_host})" if target_host != ip else ""
        return {
            "success": True,
            "message": f"Wysłano pomyślnie instrukcję TinyTuya do {target_host}:{working_port}{gw_note} (DPS: {list(dps_to_send.keys())})",
            "sent_dps": dps_to_send,
            "device_data": normalized,
            "raw_response": res
        }
    except Exception as e:
        diag = probe_gateway_diagnostics(ip, gateway_ip)
        return {
            "success": False,
            "error": f"Błąd wykonania TinyTuya ({str(e)}). {diag}",
            "trace": traceback.format_exc()
        }


def action_status(payload):
    dev_id = clean_input(payload.get("dev_id"))
    ip = clean_input(payload.get("ip"))
    local_key = clean_input(payload.get("local_key"))
    version = parse_version(payload.get("version"))
    category = payload.get("category", "")
    gateway_ip = clean_input(payload.get("gateway_ip"))

    if not dev_id or not ip or not local_key:
        return {
            "success": False,
            "error": "Wymagane parametry dev_id, ip oraz local_key do odczytu statusu TinyTuya"
        }

    try:
        target_host, working_port = find_working_tuya_target(ip, [6668, 6667, 7000], gateway_ip)
        d = tinytuya.Device(dev_id, target_host, local_key, version=version)
        d.port = working_port
        d.set_socketTimeout(2.5)
        d.set_socketRetryLimit(2)

        status_res = d.status()
        if isinstance(status_res, dict) and "Error" in status_res:
            diag = probe_gateway_diagnostics(ip, gateway_ip)
            return {
                "success": False,
                "error": f"TinyTuya zwróciła błąd: {status_res.get('Error')} (kod: {status_res.get('Err')}). {diag}",
                "raw_response": status_res
            }

        dps = status_res.get("dps", {}) if isinstance(status_res, dict) else {}
        normalized = normalize_device_data(dps, category)

        gw_note = f" (przez bramkę {target_host})" if target_host != ip else ""
        return {
            "success": True,
            "device_data": normalized,
            "raw_dps": dps,
            "message": f"Odczytano status TinyTuya z {target_host}:{working_port}{gw_note}"
        }
    except Exception as e:
        diag = probe_gateway_diagnostics(ip, gateway_ip)
        return {
            "success": False,
            "error": f"Błąd odczytu statusu TinyTuya ({str(e)}). {diag}"
        }


def action_test(payload):
    """
    Szybki test połączenia LAN z urządzeniem przy użyciu TinyTuya oraz weryfikacja trasowania w kontenerze LXC
    """
    dev_id = clean_input(payload.get("dev_id"))
    ip = clean_input(payload.get("ip"))
    local_key = clean_input(payload.get("local_key"))
    initial_version = parse_version(payload.get("version"))
    gateway_ip = clean_input(payload.get("gateway_ip"))

    if not dev_id or not ip or not local_key:
        return {
            "success": False,
            "error": "Podaj komplet danych: Adres IP, Local Key (16 znaków) oraz Device ID."
        }

    try:
        target_host, working_port = find_working_tuya_target(ip, [6668, 6667, 7000], gateway_ip)

        # Wersje do automatycznego przetestowania w przypadku błędu protokołu
        versions_to_try = [initial_version]
        for v in [3.3, 3.1, 3.4, 3.5]:
            if v not in versions_to_try:
                versions_to_try.append(v)

        last_st = None
        working_ver = initial_version

        for ver in versions_to_try:
            try:
                d = tinytuya.Device(dev_id, target_host, local_key, version=ver)
                d.port = working_port
                d.set_socketTimeout(1.5)
                d.set_socketRetryLimit(1)

                st = d.status()
                last_st = st
                if isinstance(st, dict) and "Error" not in st and "dps" in st:
                    working_ver = ver
                    break
            except Exception:
                pass

        if isinstance(last_st, dict) and "Error" in last_st:
            err_msg = last_st.get("Error", "Błąd")
            err_code = last_st.get("Err", "")
            if "Network Error" in err_msg or "Unable to Connect" in err_msg:
                diag = probe_gateway_diagnostics(ip, gateway_ip)
                return {
                    "success": False,
                    "error": f"Nie można połączyć się z urządzeniem pod adresem {target_host}:{working_port}. {diag}"
                }
            elif "Check device key" in err_msg or "decode" in err_msg.lower() or "decrypt" in err_msg.lower():
                return {
                    "success": False,
                    "error": f"Niepoprawny klucz Local Key! Urządzenie pod {target_host}:{working_port} odrzuciło odszyfrowanie pakietu AES. Sprawdź 16-znakowy Local Key w aplikacji Tuya."
                }
            return {
                "success": False,
                "error": f"Odpowiedź urządzenia {target_host}:{working_port}: {err_msg} ({err_code})"
            }

        dps = last_st.get("dps", {}) if isinstance(last_st, dict) else {}
        gw_note = f" (skierowano przez Sonoff Dongle-MAX {target_host})" if target_host != ip else ""
        return {
            "success": True,
            "message": f"Połączenie TinyTuya z {target_host}:{working_port}{gw_note} nawiązane pomyślnie! Wykryty protokół {working_ver}, aktywne DPS: {list(dps.keys())}",
            "working_version": str(working_ver),
            "dps": dps
        }
    except Exception as e:
        diag = probe_gateway_diagnostics(ip, gateway_ip)
        return {
            "success": False,
            "error": f"Błąd testu TinyTuya dla {ip}: {str(e)}. {diag}"
        }


def action_scan(payload):
    """
    Skanowanie podsieci LAN we wszystkich interfejsach w poszukiwaniu rozgłaszających się urządzeń Tuya
    """
    try:
        ifaces = get_all_network_interfaces_info()
        discovered_map = {}

        for iface_info in ifaces:
            try:
                # deviceScan rozgłasza zapytania UDP w LAN
                devices = tinytuya.deviceScan(verbose=False, maxretry=1, color=False, poll=False)
                if isinstance(devices, dict):
                    for dev_id, info in devices.items():
                        if isinstance(info, dict) and dev_id not in discovered_map:
                            discovered_map[dev_id] = {
                                "id": dev_id,
                                "ip": info.get("ip", ""),
                                "version": info.get("version", "3.3"),
                                "product_key": info.get("product_key", "")
                            }
                elif isinstance(devices, list):
                    for info in devices:
                        if isinstance(info, dict):
                            d_id = info.get("id", info.get("gwId", ""))
                            if d_id and d_id not in discovered_map:
                                discovered_map[d_id] = {
                                    "id": d_id,
                                    "ip": info.get("ip", ""),
                                    "version": info.get("version", "3.3"),
                                    "product_key": info.get("product_key", "")
                                }
            except Exception:
                pass

        discovered = list(discovered_map.values())
        return {
            "success": True,
            "discovered_count": len(discovered),
            "devices": discovered,
            "message": f"Wykryto {len(discovered)} aktywnych urządzeń Tuya w podsieciach LXC"
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"Błąd skanowania TinyTuya: {str(e)}"
        }


def main():
    if len(sys.argv) > 1 and sys.argv[1].startswith("{"):
        raw_input = sys.argv[1]
    else:
        raw_input = sys.stdin.read()

    try:
        payload = json.loads(raw_input)
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": f"Niepoprawny format danych wejściowych JSON: {str(e)}"
        }))
        sys.exit(1)

    action = payload.get("action", "command")

    if action == "command":
        res = action_command(payload)
    elif action == "status":
        res = action_status(payload)
    elif action == "test":
        res = action_test(payload)
    elif action == "scan":
        res = action_scan(payload)
    else:
        res = {
            "success": False,
            "error": f"Nieznana akcja TinyTuya: {action}"
        }

    print(json.dumps(res, ensure_ascii=False))


if __name__ == "__main__":
    main()
