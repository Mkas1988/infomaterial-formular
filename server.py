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

def fetch_and_map_produkte(config, studienform=100000005, label="Studium neben dem Beruf"):
    """
    Lädt alle aktiven FOM-Studiengänge aus Dynamics 365 und mappt sie
    auf das Format, das das Frontend erwartet.

    studienform: 100000005 = Studium neben dem Beruf, 100000000 = ausbildungsbegleitend
    """
    params = urllib.parse.urlencode({
        "$select": "name,productnumber,bcw_hochschulbereich,bcw_produktkuerzel,bcw_produktgruppe,producturl",
        "$filter": f"bcw_produktstatus eq 100000000 and bcw_produktgruppe eq 100000003 and bcw_studienform eq {studienform}",
        "$orderby": "name asc",
    }, quote_via=urllib.parse.quote)

    print(f"  Lade Produkte aus Dynamics 365 ({label})...")
    raw = dynamics_get_all(config, f"products?{params}")
    print(f"  {len(raw)} Produkt-Records geladen. Lade Details...")

    # Alle Produkte in einem Batch laden mit den Lookup-Feldern
    params_full = urllib.parse.urlencode({
        "$select": (
            "name,productnumber,bcw_hochschulbereich,bcw_produktkuerzel,"
            "bcw_produktgruppe,producturl,bcw_studienform"
        ),
        "$expand": (
            "bcw_Abschluss($select=bcw_name),"
            "bcw_StandortTabelle($select=bcw_name),"
            "bcw_Studienfach($select=bcw_name),"
            "bcw_Produktart($select=bcw_name),"
            "bcw_Zeitmodell($select=bcw_name)"
        ),
        "$filter": f"bcw_produktstatus eq 100000000 and bcw_produktgruppe eq 100000003 and bcw_studienform eq {studienform}",
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

def dynamics_request(config, method, path, body=None):
    """Authenticated request to Dynamics 365 Web API."""
    token = get_access_token(config)
    base = config["org_url"].rstrip("/")
    url = f"{base}/api/data/v9.2/{path}"
    data = json.dumps(body).encode("utf-8") if body else None

    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")
    req.add_header("OData-MaxVersion", "4.0")
    req.add_header("OData-Version", "4.0")
    req.add_header("Prefer", 'odata.include-annotations="*"')
    if body:
        req.add_header("Content-Type", "application/json; charset=utf-8")

    try:
        with urllib.request.urlopen(req, context=SSL_CTX) as resp:
            if resp.status == 204:
                entity_id = resp.headers.get("OData-EntityId", "")
                return {"_entityId": entity_id, "_status": resp.status}
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        raise Exception(f"Dynamics API error {e.code}: {error_body}")


def extract_id(result):
    """Extract entity GUID from OData-EntityId header."""
    entity_id = result.get("_entityId", "")
    if entity_id:
        return entity_id.split("(")[-1].rstrip(")")
    return None


def find_contact_by_email(config, email):
    """Find an existing contact by email address."""
    params = urllib.parse.urlencode({
        "$filter": f"emailaddress1 eq '{email}'",
        "$select": "contactid,firstname,lastname,emailaddress1",
        "$top": "1",
    }, quote_via=urllib.parse.quote)
    result = dynamics_request(config, "GET", f"contacts?{params}")
    records = result.get("value", [])
    return records[0] if records else None


def create_or_update_contact(config, data):
    """Create a new contact or update existing one by email."""
    existing = find_contact_by_email(config, data["email"])

    contact_data = {
        "firstname": data["vorname"],
        "lastname": data["nachname"],
        "emailaddress1": data["email"],
        "emailaddress2": data["email"],
        "bcw_kontaktursprung": 100000003,  # Website Infomaterial
    }

    if existing:
        contact_id = existing["contactid"]
        dynamics_request(config, "PATCH", f"contacts({contact_id})", contact_data)
        return contact_id, "updated"
    else:
        result = dynamics_request(config, "POST", "contacts", contact_data)
        contact_id = extract_id(result)
        if not contact_id:
            created = find_contact_by_email(config, data["email"])
            contact_id = created["contactid"] if created else None
        return contact_id, "created"


def create_produktinteresse(config, contact_id, produkte_ids, post_wunsch=False, semester=None):
    """Create bcw_produktinteresse + bcw_produktinteresseprodukte records."""
    steps = []

    # Versandart: 100000000=E-Mail, 100000001=Post, 100000002=E-Mail & Post
    versandart = 100000002 if post_wunsch else 100000000

    pi_data = {
        "bcw_name": "Infomaterial-Website",
        "bcw_Kontakt@odata.bind": f"/contacts({contact_id})",
        "bcw_eingangskanal": 100000003,  # Website
        "bcw_informationsmaterialiensenden": True,
        "bcw_versandart": versandart,
    }

    if semester:
        pi_data["bcw_semesterstartwunsch"] = semester  # Edm.Date: "2026-09-01"

    result = dynamics_request(config, "POST", "bcw_produktinteresses", pi_data)
    pi_id = extract_id(result)
    steps.append({"step": "Produktinteresse erstellt", "id": pi_id, "infomaterialSenden": True})

    if not pi_id:
        return steps

    # Create Produktinteresseprodukte for each selected product
    # (must be done before closing, as closing may lock the record)
    for prod in produkte_ids:
        name = prod.get("name", "")
        prod_id = prod.get("id", "")

        pip_data = {
            "bcw_name": name,
            "bcw_Produktinteresse@odata.bind": f"/bcw_produktinteresses({pi_id})",
            "bcw_Kontakt@odata.bind": f"/contacts({contact_id})",
        }
        if prod_id:
            pip_data["bcw_Produkt@odata.bind"] = f"/products({prod_id})"

        try:
            result = dynamics_request(config, "POST", "bcw_produktinteresseproduktes", pip_data)
            pip_id = extract_id(result)
            steps.append({"step": f"Produkt verknüpft: {name}", "produktId": prod_id, "id": pip_id})
        except Exception as e:
            steps.append({"step": f"Produkt-Verknüpfung fehlgeschlagen: {name}", "error": str(e)})

    # Close the BPF (Business Process Flow) first, then the Produktinteresse
    BPF_LAST_STAGE_ID = "bbdbeea3-ea9d-4390-8a2d-c0d826d53b0b"  # "Produktinteresse Abschließen"
    try:
        # Find the BPF instance for this PI
        bpf_params = urllib.parse.urlencode({
            "$filter": f"_bpf_bcw_produktinteresseid_value eq '{pi_id}'",
            "$select": "businessprocessflowinstanceid",
            "$top": "1",
        }, quote_via=urllib.parse.quote)
        bpf_result = dynamics_request(config, "GET", f"bcw_studienberatungs?{bpf_params}")
        bpf_records = bpf_result.get("value", [])
        if bpf_records:
            bpf_id = bpf_records[0]["businessprocessflowinstanceid"]
            # Move to last stage
            dynamics_request(config, "PATCH", f"bcw_studienberatungs({bpf_id})", {
                "activestageid@odata.bind": f"/processstages({BPF_LAST_STAGE_ID})",
            })
            # Finish BPF
            dynamics_request(config, "PATCH", f"bcw_studienberatungs({bpf_id})", {
                "statecode": 1,
                "statuscode": 2,
            })
            steps.append({"step": "BPF abgeschlossen"})
    except Exception as e:
        steps.append({"step": "BPF-Abschluss fehlgeschlagen", "error": str(e)})

    # Close the Produktinteresse: statecode=1 (Erfassung abgeschlossen), statuscode=2
    try:
        dynamics_request(config, "PATCH", f"bcw_produktinteresses({pi_id})", {
            "statecode": 1,
            "statuscode": 2,
        })
        steps.append({"step": "Produktinteresse abgeschlossen"})
    except Exception as e:
        steps.append({"step": "Abschluss fehlgeschlagen", "error": str(e)})

    return steps


def fetch_infomaterial_submissions(config):
    """Fetch all 'Infomaterial-Website' Produktinteressen from Dynamics with linked products and contact."""
    params = urllib.parse.urlencode({
        "$select": "bcw_name,createdon,bcw_versandart,bcw_semesterstartwunsch,statecode,statuscode",
        "$expand": "bcw_Kontakt($select=firstname,lastname,emailaddress1,emailaddress2)",
        "$filter": "bcw_name eq 'Infomaterial-Website'",
        "$orderby": "createdon desc",
        "$top": "50",
    }, quote_via=urllib.parse.quote)

    results = dynamics_get(config, f"bcw_produktinteresses?{params}")
    records = results.get("value", [])

    submissions = []
    for rec in records:
        pi_id = rec.get("bcw_produktinteresseid", "")
        contact = rec.get("bcw_Kontakt") or {}

        # Fetch linked Produktinteresseprodukte for this PI
        pip_params = urllib.parse.urlencode({
            "$filter": f"_bcw_produktinteresse_value eq '{pi_id}'",
            "$select": "bcw_name",
            "$expand": "bcw_Produkt($select=name)",
        }, quote_via=urllib.parse.quote)
        try:
            pip_result = dynamics_get(config, f"bcw_produktinteresseproduktes?{pip_params}")
            produkte = []
            for pip in pip_result.get("value", []):
                prod = pip.get("bcw_Produkt") or {}
                produkte.append({"name": prod.get("name", pip.get("bcw_name", ""))})
        except Exception:
            produkte = []

        versandart_val = rec.get("bcw_versandart")
        versand_map = {100000000: "E-Mail", 100000001: "Post", 100000002: "E-Mail & Post"}

        submissions.append({
            "timestamp": rec.get("createdon", ""),
            "status": "success" if rec.get("statecode") in (0, 1) else "error",
            "input": {
                "vorname": contact.get("firstname", ""),
                "nachname": contact.get("lastname", ""),
                "email": contact.get("emailaddress2") or contact.get("emailaddress1", ""),
                "postWunsch": versandart_val in (100000001, 100000002),
                "produkte": produkte,
            },
            "steps": [
                {"step": "Kontakt", "contactId": rec.get("_bcw_kontakt_value", "")},
                {"step": "Produktinteresse erstellt", "id": pi_id},
            ] + [{"step": f"Produkt verknüpft: {p['name']}"} for p in produkte],
            "contactId": rec.get("_bcw_kontakt_value", ""),
            "versand": versand_map.get(versandart_val, "E-Mail"),
            "semester": rec.get("bcw_semesterstartwunsch", ""),
        })

    return submissions


def handle_infomaterial_request(data):
    """Process an infomaterial request: Contact + Produktinteresse in Dynamics."""
    log = {"timestamp": datetime.now().isoformat(), "status": "pending", "steps": [], "input": data}

    try:
        # Validate
        required = ["vorname", "nachname", "email"]
        missing = [f for f in required if not data.get(f)]
        if missing:
            log["status"] = "error"
            log["error"] = f"Fehlende Felder: {', '.join(missing)}"
            return log, 400

        # 1. Create or update contact
        contact_id, action = create_or_update_contact(DYNAMICS_CONFIG, data)
        if not contact_id:
            log["status"] = "error"
            log["error"] = "Kontakt konnte nicht erstellt werden"
            return log, 500
        log["steps"].append({"step": f"Kontakt {action}", "contactId": contact_id})

        # 2. Create Produktinteresse with infomaterialsenden=true
        produkte = data.get("produkte", [])
        post_wunsch = data.get("postWunsch", False)
        semester = data.get("semester", None)
        pi_steps = create_produktinteresse(DYNAMICS_CONFIG, contact_id, produkte, post_wunsch, semester)
        log["steps"].extend(pi_steps)

        log["status"] = "success"
        log["contactId"] = contact_id
        return log, 200

    except Exception as e:
        log["status"] = "error"
        log["error"] = str(e)
        return log, 500


# Store submissions persistently in a JSON file
import os
SUBMISSIONS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "submissions.json")

def load_submissions():
    try:
        with open(SUBMISSIONS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []

def save_submissions(subs):
    with open(SUBMISSIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(subs[:50], f, ensure_ascii=False, indent=2)

recent_submissions = load_submissions()


class APIHandler(http.server.BaseHTTPRequestHandler):
    produkte_data = []
    dual_data = []

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

        elif self.path == "/api/infomaterial/produkte/dual":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            response = json.dumps({
                "success": True,
                "data": self.dual_data,
            }, ensure_ascii=False)
            self.wfile.write(response.encode("utf-8"))

        elif self.path == "/api/infomaterial/submissions":
            # Load all "Infomaterial-Website" Produktinteressen from Dynamics
            try:
                submissions = fetch_infomaterial_submissions(DYNAMICS_CONFIG)
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps(submissions, ensure_ascii=False).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))

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

    def do_POST(self):
        if self.path == "/api/infomaterial/submit":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body.decode("utf-8"))
            except Exception:
                self.send_response(400)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "Invalid JSON"}).encode("utf-8"))
                return

            log, status_code = handle_infomaterial_request(data)
            recent_submissions.insert(0, log)
            if len(recent_submissions) > 50:
                recent_submissions.pop()
            save_submissions(recent_submissions)

            self.send_response(status_code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            response = json.dumps({
                "success": log["status"] == "success",
                "log": log,
            }, ensure_ascii=False)
            self.wfile.write(response.encode("utf-8"))
        else:
            self.send_error(404, "Not Found")

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
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
        APIHandler.produkte_data = fetch_and_map_produkte(DYNAMICS_CONFIG, 100000005, "Studium neben dem Beruf")
    except Exception as e:
        print(f"  ✗ Fehler beim Laden (berufsbegleitend): {e}")
        APIHandler.produkte_data = []

    try:
        APIHandler.dual_data = fetch_and_map_produkte(DYNAMICS_CONFIG, 100000000, "ausbildungsbegleitend")
    except Exception as e:
        print(f"  ✗ Fehler beim Laden (dual): {e}")
        APIHandler.dual_data = []

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
