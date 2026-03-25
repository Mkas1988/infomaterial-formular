#!/usr/bin/env python3
"""
Backend-Server für das Infomaterial-Formular.
Zieht Produkte (Studiengänge) aus Dynamics 365.

Usage:
    python server.py    # Startet den API-Server auf Port 5050
"""

import json
import sys
import ssl
import http.server
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
import certifi

SSL_CTX = ssl.create_default_context(cafile=certifi.where())

# ---------------------------------------------------------------------------
# Dynamics 365 Konfiguration
# ---------------------------------------------------------------------------

DYNAMICS_CONFIG = {
    "org_url": "https://bcw-gruppe.crm4.dynamics.com",
    "client_id": "affd8c64-dac7-44a3-9d1c-2ffc52f63205",
    "client_secret": "oVZ8Q~_MMX_V_iOf_-BjZSiEmAq8s6sof33YYaOv",
    "tenant_id": "25341995-fa74-43de-8fbf-e48ba0e30a0b",
    "authority": "https://login.microsoftonline.com/{tenant_id}",
}

SERVER_PORT = 5050

# Mapping Hochschulbereich-Codes → Frontend-Labels
HOCHSCHULBEREICH_MAP = {
    "FOM - WM": "FOM School of Business & Management",
    "FOM - IT": "FOM School of IT Management",
    "FOM - WP": "FOM School of Psychology",
    "FOM - Ing": "School of Engineering",
    "FOM - GuS": "School of Health & Social Management",
    "FOM - WR": "School of Law",
    "FOM - DS": "School of Dual Studies",
    "FOM-AS": "Open Business School",
}

# ---------------------------------------------------------------------------
# Auth + API
# ---------------------------------------------------------------------------

_token_cache = {"token": None, "expires": None}


def get_access_token(config):
    now = datetime.now()
    if _token_cache["token"] and _token_cache["expires"] and _token_cache["expires"] > now:
        return _token_cache["token"]

    authority = config["authority"].format(tenant_id=config["tenant_id"])
    token_url = f"{authority}/oauth2/v2.0/token"
    scope = f"{config['org_url']}/.default"

    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": config["client_id"],
        "client_secret": config["client_secret"],
        "scope": scope,
    }).encode()

    req = urllib.request.Request(token_url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    with urllib.request.urlopen(req, context=SSL_CTX) as resp:
        result = json.loads(resp.read())
        _token_cache["token"] = result["access_token"]
        _token_cache["expires"] = now + timedelta(minutes=50)
        return result["access_token"]


def dynamics_get(config, path):
    token = get_access_token(config)
    base = config["org_url"].rstrip("/")
    url = f"{base}/api/data/v9.2/{path}"

    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("OData-MaxVersion", "4.0")
    req.add_header("OData-Version", "4.0")
    req.add_header("Accept", "application/json")
    req.add_header("Prefer", "odata.include-annotations=*,odata.maxpagesize=5000")

    with urllib.request.urlopen(req, context=SSL_CTX) as resp:
        return json.loads(resp.read())


def dynamics_get_all(config, path):
    """Paginiert durch alle Ergebnisse."""
    all_records = []
    token = get_access_token(config)
    base = config["org_url"].rstrip("/")
    url = f"{base}/api/data/v9.2/{path}"

    while url:
        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("OData-MaxVersion", "4.0")
        req.add_header("OData-Version", "4.0")
        req.add_header("Accept", "application/json")
        req.add_header("Prefer", "odata.include-annotations=*,odata.maxpagesize=5000")

        with urllib.request.urlopen(req, context=SSL_CTX) as resp:
            data = json.loads(resp.read())
            all_records.extend(data.get("value", []))
            url = data.get("@odata.nextLink")

    return all_records


# ---------------------------------------------------------------------------
# Produkte laden und für Frontend aufbereiten
# ---------------------------------------------------------------------------

def fetch_and_map_produkte(config):
    """
    Lädt alle aktiven FOM-Studiengänge aus Dynamics 365 und mappt sie
    auf das Format, das das Frontend erwartet.

    Dynamics-Struktur:
    - Jedes Produkt = eine Instanz (Studienfach + Standort + Zeitmodell)
    - Mehrere Instanzen gehören zum selben Studienfach (z.B. "BWL" in Berlin, Hamburg, Virtuell)

    Frontend erwartet:
    - Produktname, ProduktTypName, Hochschulbereich, StandortName,
      InstanzID, ECTS, DauerZahl, DauerEinheit, AbschlussName
    """
    params = urllib.parse.urlencode({
        "$select": "name,productnumber,bcw_hochschulbereich,bcw_produktkuerzel,bcw_produktgruppe,producturl",
        "$filter": "bcw_produktstatus eq 100000000 and bcw_produktgruppe eq 100000003",
        "$orderby": "name asc",
    }, quote_via=urllib.parse.quote)

    print("  Lade Produkte aus Dynamics 365...")
    raw = dynamics_get_all(config, f"products?{params}")
    print(f"  {len(raw)} Produkt-Records geladen. Lade Details...")

    # Alle Produkte in einem Batch laden mit den Lookup-Feldern
    params_full = urllib.parse.urlencode({
        "$select": (
            "name,productnumber,bcw_hochschulbereich,bcw_produktkuerzel,"
            "bcw_produktgruppe,producturl"
        ),
        "$expand": (
            "bcw_Abschluss($select=bcw_name),"
            "bcw_StandortTabelle($select=bcw_name),"
            "bcw_Studienfach($select=bcw_name),"
            "bcw_Produktart($select=bcw_name),"
            "bcw_Zeitmodell($select=bcw_name)"
        ),
        "$filter": "bcw_produktstatus eq 100000000 and bcw_produktgruppe eq 100000003",
        "$orderby": "name asc",
    }, quote_via=urllib.parse.quote)

    try:
        products = dynamics_get_all(config, f"products?{params_full}")
        print(f"  {len(products)} Produkte mit Details geladen.")
    except Exception as e:
        print(f"  Expand fehlgeschlagen ({e}), nutze Basis-Daten...")
        products = raw

    mapped = []
    for p in products:
        # Hochschulbereich: Dynamics gibt Code-Wert, Annotation hat Label
        hb_label = p.get("bcw_hochschulbereich@OData.Community.Display.V1.FormattedValue", "")
        hochschulbereich = HOCHSCHULBEREICH_MAP.get(hb_label, hb_label)

        # Abschluss
        abschluss = ""
        if p.get("bcw_Abschluss"):
            abschluss = p["bcw_Abschluss"].get("bcw_name", "")
        elif "_bcw_abschluss_value@OData.Community.Display.V1.FormattedValue" in p:
            abschluss = p["_bcw_abschluss_value@OData.Community.Display.V1.FormattedValue"]

        # Standort
        standort = ""
        if p.get("bcw_StandortTabelle"):
            standort = p["bcw_StandortTabelle"].get("bcw_name", "")
        elif "_bcw_standorttabelle_value@OData.Community.Display.V1.FormattedValue" in p:
            standort = p["_bcw_standorttabelle_value@OData.Community.Display.V1.FormattedValue"]

        # Studienfach
        studienfach = ""
        if p.get("bcw_Studienfach"):
            studienfach = p["bcw_Studienfach"].get("bcw_name", "")
        elif "_bcw_studienfach_value@OData.Community.Display.V1.FormattedValue" in p:
            studienfach = p["_bcw_studienfach_value@OData.Community.Display.V1.FormattedValue"]

        # Produktart → ProduktTypName
        produktart = ""
        if p.get("bcw_Produktart"):
            produktart = p["bcw_Produktart"].get("bcw_name", "")
        elif "_bcw_produktart_value@OData.Community.Display.V1.FormattedValue" in p:
            produktart = p["_bcw_produktart_value@OData.Community.Display.V1.FormattedValue"]

        # ProduktTypName aus Produktart ableiten
        if "bachelor" in produktart.lower():
            typ = "Bachelor"
        elif "master" in produktart.lower():
            typ = "Master"
        else:
            # Fallback: aus Name ableiten
            name_lower = p.get("name", "").lower()
            if "bachelor" in name_lower or "b.a." in name_lower or "b.sc." in name_lower or "ll.b." in name_lower:
                typ = "Bachelor"
            elif "master" in name_lower or "m.a." in name_lower or "m.sc." in name_lower or "mba" in name_lower or "ll.m." in name_lower:
                typ = "Master"
            else:
                typ = produktart or "Sonstige"

        # Produktname = Studienfach mit Abschluss (so wie im Original)
        produktname = p.get("name", "")

        # Nur den Studienfach-Teil als Produktname verwenden, wenn vorhanden
        if studienfach:
            produktname = studienfach

        # Produktname mit Abschluss-Prefix, so wie im Original
        if abschluss and studienfach:
            produktname = f"{abschluss} in {studienfach}"

        mapped.append({
            "Produktname": produktname,
            "ProduktTypName": typ,
            "Hochschulbereich": hochschulbereich,
            "StandortName": standort,
            "InstanzID": p.get("productid", ""),
            "ECTS": "",  # Nicht direkt in Dynamics vorhanden
            "DauerZahl": "",
            "DauerEinheit": "",
            "AbschlussName": abschluss,
            "ProduktNummer": p.get("productnumber", ""),
            "ProduktKuerzel": p.get("bcw_produktkuerzel", ""),
        })

    # Nur FOM-Hochschulbereiche behalten (kein BCW, IIS etc.)
    fom_produkte = [m for m in mapped if m["ProduktTypName"] in ("Bachelor", "Master")]
    print(f"  {len(fom_produkte)} Bachelor/Master Studiengänge für Frontend bereit.")

    return fom_produkte


# ---------------------------------------------------------------------------
# HTTP Server
# ---------------------------------------------------------------------------

class APIHandler(http.server.BaseHTTPRequestHandler):
    produkte_data = []

    def do_GET(self):
        if self.path == "/api/infomaterial/produkte":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            response = json.dumps({
                "success": True,
                "data": self.produkte_data,
            }, ensure_ascii=False)
            self.wfile.write(response.encode("utf-8"))

        elif self.path == "/api/infomaterial/produkte/refresh":
            print("  Refresh angefordert...")
            try:
                APIHandler.produkte_data = fetch_and_map_produkte(DYNAMICS_CONFIG)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True,
                    "count": len(APIHandler.produkte_data),
                }).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))

        else:
            self.send_error(404, "Not Found")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, format, *args):
        print(f"  [{datetime.now().strftime('%H:%M:%S')}] {args[0]}")


def main():
    print()
    print("=" * 56)
    print("  Infomaterial-Formular — Dynamics 365 Backend")
    print("=" * 56)
    print(f"\n  Dynamics: {DYNAMICS_CONFIG['org_url']}")

    # Token testen
    print("\n  Authentifizierung...")
    try:
        get_access_token(DYNAMICS_CONFIG)
        print("  ✓ Token erfolgreich")
    except Exception as e:
        print(f"  ✗ Auth fehlgeschlagen: {e}")
        sys.exit(1)

    # Produkte laden
    print()
    try:
        APIHandler.produkte_data = fetch_and_map_produkte(DYNAMICS_CONFIG)
    except Exception as e:
        print(f"  ✗ Fehler beim Laden: {e}")
        print("  Server startet trotzdem — /api/infomaterial/produkte/refresh zum Nachladen")
        APIHandler.produkte_data = []

    # Server starten
    server = http.server.HTTPServer(("127.0.0.1", SERVER_PORT), APIHandler)
    print(f"\n  API: http://127.0.0.1:{SERVER_PORT}/api/infomaterial/produkte")
    print(f"  Beenden mit Ctrl+C\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Server gestoppt.")
        server.server_close()


if __name__ == "__main__":
    main()
