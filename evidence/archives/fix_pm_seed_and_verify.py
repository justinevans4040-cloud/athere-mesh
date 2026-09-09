#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
import time
import zipfile
from pathlib import Path

LIVE = Path("/home/the_founder/forgefront/solar-command")
ZIP = Path(
    "/mnt/storage/forgefront-vault/02_PROJECTS/"
    "ZZ_DO_NOT_USE__DIRTY_DCE_PACKAGES__NEVER_SERVE_AS_LIVE/"
    "FROM_SARA_ARCHIVE__04_RELATED_EXISTING_PACKAGES/"
    "DCE_Command_Center_V3_Solar_V1_Audited-1.zip"
)


def main() -> None:
    with zipfile.ZipFile(ZIP) as zf:
        html = zf.read("DCE_Command_Center_V3.html").decode("utf-8")

    repls = [
        ("DCE Command Center V3", "ForgeFront Systems — Project Management"),
        ("<title>DCE Command Center V3</title>", "<title>ForgeFront Systems — Project Management</title>"),
        ("DCE PROJECT OPERATIONS", "FORGEFRONT SYSTEMS"),
        ("DCE Agency", "ForgeFront Systems"),
        ('brand-mark">DCE</div>', 'brand-mark">FF</div>'),
        ("dce-command-center-v1", "forgefront-pm-v1"),
        ("dce-v3-client-id", "forgefront-pm-client-id"),
        (
            "Reset DCE Command Center to demo data? This replaces local data.",
            "Reset ForgeFront Systems PM to an empty workspace? This replaces local data.",
        ),
        ("Demo data restored", "Workspace reset"),
        ("Reset to Demo", "Reset Workspace"),
    ]
    for a, b in repls:
        html = html.replace(a, b)

    start = html.find("const seed = () => ({")
    brace = html.find("{", start)
    depth = 0
    end = None
    for i, ch in enumerate(html[brace:], brace):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if html[end : end + 2] == ");":
        end += 2
    elif html[end : end + 1] == ";":
        end += 1

    empty = """const seed = () => ({
    settings:{company:'ForgeFront Systems',currency:'USD'},
    projects:[],
    tasks:[],
    approvals:[],
    production:[],
    logistics:[],
    budget:[],
    risks:[],
    changes:[],
    actions:[],
    onsite:[],
    calendar:[],
    pubs:[],
    accessTokens:[],
    contacts:[],
    meetings:[],
    stakeholders:[],
    solarLeads:[],
    solarCalls:[],
    solarDnc:[],
    solarConfig:{}
  });"""
    html = html[:start] + empty + html[end:]
    for m in [
        "Nova Mobility",
        "Nova Brand Director",
        "Helix Bio",
        "Priya Shah",
        "Jordan Lee",
        "Alex Morgan",
        "Nina Patel",
        "DCE-26031",
        "DCE-26044",
        "marketing@example.com",
        "brand@example.com",
    ]:
        html = html.replace(m, "")

    (LIVE / "ForgeFront_PM.html").write_text(html, encoding="utf-8")

    srv_path = LIVE / "DCE_V3_server.js"
    srv = srv_path.read_text(encoding="utf-8")
    if "ForgeFront_PM.html" not in srv:
        srv = srv.replace("STATIC_FILES = new Set([", "STATIC_FILES = new Set(['ForgeFront_PM.html',")
    needle = "let rel=u.pathname==='/'?'DCE_Command_Center_V3.html':u.pathname==='/edge'?'EDGE_MIRROR.html':decodeURIComponent(u.pathname.replace(/^\\//,''));"
    replacement = "let rel=u.pathname==='/'?'DCE_Command_Center_V3.html':u.pathname==='/pm'||u.pathname==='/project-management'?'ForgeFront_PM.html':u.pathname==='/edge'?'EDGE_MIRROR.html':u.pathname==='/solar'?'SolarCommand_V3_LIVE.html':decodeURIComponent(u.pathname.replace(/^\\//,''));"
    if "/pm" not in srv:
        if needle not in srv:
            raise SystemExit("server route needle not found")
        srv = srv.replace(needle, replacement)
        srv_path.write_text(srv, encoding="utf-8")

    subprocess.run(["fuser", "-k", "8787/tcp"], check=False, capture_output=True)
    time.sleep(1)
    log = open("/tmp/forgefront-systems.log", "a", encoding="utf-8")
    subprocess.Popen(
        ["node", "DCE_V3_server.js"],
        cwd=str(LIVE),
        stdout=log,
        stderr=log,
        start_new_session=True,
    )
    time.sleep(1)

    home = subprocess.check_output(["curl", "-sS", "-m", "3", "http://127.0.0.1:8787/"], text=True)
    pm = subprocess.check_output(["curl", "-sS", "-m", "3", "http://127.0.0.1:8787/pm"], text=True)
    ev = {
        "home_title": re.search(r"<title>([^<]+)</title>", home).group(1),
        "pm_title": re.search(r"<title>([^<]+)</title>", pm).group(1),
        "home_control_room": "Control Room" in home,
        "pm_control_room": "Control Room" in pm,
        "home_live_call": "LIVE CALL" in home,
        "nova_pm": ("Nova Mobility" in pm) or ("Nova Brand Director" in pm) or ("Nova fascia" in pm),
        "solar_bytes": (LIVE / "DCE_Command_Center_V3.html").stat().st_size,
        "pm_bytes": (LIVE / "ForgeFront_PM.html").stat().st_size,
        "solar_live_bytes": (LIVE / "SolarCommand_V3_LIVE.html").stat().st_size,
    }
    ev["ok"] = (
        (not ev["home_control_room"])
        and ev["pm_control_room"]
        and ev["home_live_call"]
        and (not ev["nova_pm"])
        and ev["solar_bytes"] < 100000
        and ev["pm_bytes"] > 100000
    )
    Path("/tmp/forgefront-split-restore-evidence.json").write_text(json.dumps(ev, indent=2), encoding="utf-8")
    print(json.dumps(ev, indent=2))
    if not ev["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
