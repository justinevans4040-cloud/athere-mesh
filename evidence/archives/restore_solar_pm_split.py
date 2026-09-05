#!/usr/bin/env python3
"""Restore Solar and PM as two separate live apps. Exact Justin order."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
LIVE = Path("/home/the_founder/forgefront/solar-command")
BAK = LIVE / ".bak-forgefront-systems"
SOLAR_ONLY = LIVE / "ZZ_DO_NOT_USE_AS_DEFAULT_ENTRY" / "SolarCommand_V3_LIVE.html"
ZIP = Path(
    "/mnt/storage/forgefront-vault/02_PROJECTS/"
    "ZZ_DO_NOT_USE__DIRTY_DCE_PACKAGES__NEVER_SERVE_AS_LIVE/"
    "FROM_SARA_ARCHIVE__04_RELATED_EXISTING_PACKAGES/"
    "DCE_Command_Center_V3_Solar_V1_Audited-1.zip"
)
# Fallback zip locations
ZIP_CANDIDATES = [
    ZIP,
    Path(
        "/mnt/storage/forgefront-vault/02_PROJECTS/"
        "ZZ_DO_NOT_USE__DIRTY_OR_DUPLICATE_PACKAGES__NEVER_SERVE_AS_LIVE/"
        "FROM_HOME_ROOT/DCE_Command_Center_V3_Solar_V1_Audited-1.zip"
    ),
]


def find_zip() -> Path:
    for z in ZIP_CANDIDATES:
        if z.exists():
            return z
    raise SystemExit("Audited PM zip not found in quarantine")


def empty_seed(html: str) -> str:
    """Remove fabricated Nova/Helix demo records; keep PM UI/graphics."""
    start = html.find("const seed = () => ({")
    if start < 0:
        return html
    brace_at = html.find("{", start)
    depth = 0
    end = None
    for i, ch in enumerate(html[brace_at:], brace_at):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        return html
    if html[end : end + 2] == ");":
        end += 2
    elif html[end : end + 1] == ";":
        end += 1
    # Keep company label ForgeFront Systems; empty all record arrays.
    # Discover keys present in original seed object for structural compatibility.
    block = html[brace_at:end]
    keys = re.findall(r"(\w+)\s*:", block)
    # Always include core collections
    collections = []
    seen = set()
    for k in keys:
        if k in seen or k == "settings":
            continue
        seen.add(k)
        collections.append(f"    {k}:[],")
    body = "\n".join(collections)
    empty = (
        "const seed = () => ({\n"
        "    settings:{company:'ForgeFront Systems',currency:'USD'},\n"
        f"{body}\n"
        "  });"
    )
    return html[:start] + empty + html[end:]


def brand_pm_only(html: str) -> str:
    """Light brand to ForgeFront Systems without gutting layout/CSS/graphics."""
    html = html.replace("DCE Command Center V3", "ForgeFront Systems — Project Management")
    html = html.replace("<title>DCE Command Center V3</title>", "<title>ForgeFront Systems — Project Management</title>")
    html = html.replace("DCE PROJECT OPERATIONS", "FORGEFRONT SYSTEMS")
    html = html.replace("DCE Agency", "ForgeFront Systems")
    html = html.replace('brand-mark">DCE</div>', 'brand-mark">FF</div>')
    html = html.replace("dce-command-center-v1", "forgefront-pm-v1")
    html = html.replace("dce-v3-client-id", "forgefront-pm-client-id")
    html = re.sub(
        r"Reset DCE Command Center to demo data\? This replaces local data\.",
        "Reset ForgeFront Systems PM to an empty workspace? This replaces local data.",
        html,
    )
    html = html.replace("Demo data restored", "Workspace reset")
    html = html.replace("Reset to Demo", "Reset Workspace")
    return empty_seed(html)


def patch_server(server_text: str) -> str:
    """Ensure / is Solar home; /pm serves standalone PM app."""
    # Add PM file to static allowlist if present
    if "ForgeFront_PM.html" not in server_text:
        server_text = server_text.replace(
            "STATIC_FILES = new Set([",
            "STATIC_FILES = new Set(['ForgeFront_PM.html',",
        )
    # Route /pm and /project-management to PM html; keep / as DCE_Command_Center_V3.html (solar restored)
    old = "let rel=u.pathname==='/'?'DCE_Command_Center_V3.html':u.pathname==='/edge'?'EDGE_MIRROR.html':decodeURIComponent(u.pathname.replace(/^\\//,''));"
    # Try flexible match
    if "pathname==='/'" in server_text and "ForgeFront_PM" not in server_text.split("pathname==='/'")[1][:400]:
        server_text = server_text.replace(
            "let rel=u.pathname==='/'?'DCE_Command_Center_V3.html':u.pathname==='/edge'?'EDGE_MIRROR.html':decodeURIComponent(u.pathname.replace(/^\\//,''));",
            "let rel=u.pathname==='/'?'DCE_Command_Center_V3.html':u.pathname==='/pm'||u.pathname==='/project-management'?'ForgeFront_PM.html':u.pathname==='/edge'?'EDGE_MIRROR.html':u.pathname==='/solar'?'SolarCommand_V3_LIVE.html':decodeURIComponent(u.pathname.replace(/^\\//,''));",
        )
    # Brand health already ForgeFront Systems — leave
    return server_text


def restart() -> None:
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


def main() -> None:
    if not BAK.exists():
        raise SystemExit(f"missing solar bak: {BAK}")
    if not SOLAR_ONLY.exists():
        raise SystemExit(f"missing solar-only file: {SOLAR_ONLY}")

    safety = LIVE / f".bak-before-split-restore-{STAMP}"
    safety.mkdir(parents=True)
    for name in ("DCE_Command_Center_V3.html", "V3.html", "SolarCommand_V3_LIVE.html", "DCE_V3_server.js"):
        p = LIVE / name
        if p.exists():
            shutil.copy2(p, safety / name)

    # 1) Restore Solar home (pre-overwrite solar face) as default /
    shutil.copy2(BAK / "DCE_Command_Center_V3.html", LIVE / "DCE_Command_Center_V3.html")
    shutil.copy2(BAK / "V3.html", LIVE / "V3.html")

    # 2) Restore standalone SolarCommand_V3_LIVE.html
    shutil.copy2(SOLAR_ONLY, LIVE / "SolarCommand_V3_LIVE.html")

    # 3) Standalone PM app from Audited package (separate file — does NOT overwrite solar home)
    zpath = find_zip()
    work = Path(f"/tmp/pm_restore_{STAMP}")
    if work.exists():
        shutil.rmtree(work)
    work.mkdir()
    with zipfile.ZipFile(zpath) as zf:
        zf.extract("DCE_Command_Center_V3.html", work)
    pm_raw = (work / "DCE_Command_Center_V3.html").read_text(encoding="utf-8")
    pm = brand_pm_only(pm_raw)
    (LIVE / "ForgeFront_PM.html").write_text(pm, encoding="utf-8")
    shutil.rmtree(work)

    # 4) Server routes: / = solar home, /pm = PM, /solar = SolarCommand_V3_LIVE
    server = LIVE / "DCE_V3_server.js"
    server.write_text(patch_server(server.read_text(encoding="utf-8")), encoding="utf-8")

    # Markers
    (LIVE / "LIVE_SPLIT.md").write_text(
        f"""# Two separate live apps (restored {STAMP})

1. **Solar / sales call app (default home)**  
   URL: `/` → `DCE_Command_Center_V3.html` (restored from `.bak-forgefront-systems`)  
   Also: `/solar` → `SolarCommand_V3_LIVE.html`

2. **Project Management app (standalone)**  
   URL: `/pm` → `ForgeFront_PM.html`  
   (from Audited PM package; empty workspace seed — no Nova demo records)

These are separate. Do not overwrite one with the other.
""",
        encoding="utf-8",
    )

    restart()
    home = subprocess.check_output(["curl", "-sS", "-m", "3", "http://127.0.0.1:8787/"], text=True)
    pm_page = subprocess.check_output(["curl", "-sS", "-m", "3", "http://127.0.0.1:8787/pm"], text=True)
    health = subprocess.check_output(["curl", "-sS", "-m", "3", "http://127.0.0.1:8787/api/health"], text=True)

    evidence = {
        "stamp": STAMP,
        "solar_home_bytes": (LIVE / "DCE_Command_Center_V3.html").stat().st_size,
        "solar_live_bytes": (LIVE / "SolarCommand_V3_LIVE.html").stat().st_size,
        "pm_bytes": (LIVE / "ForgeFront_PM.html").stat().st_size,
        "home_title": re.search(r"<title>([^<]+)</title>", home).group(1) if re.search(r"<title>([^<]+)</title>", home) else None,
        "pm_title": re.search(r"<title>([^<]+)</title>", pm_page).group(1) if re.search(r"<title>([^<]+)</title>", pm_page) else None,
        "home_has_control_room": "Control Room" in home,
        "pm_has_control_room": "Control Room" in pm_page,
        "home_has_live_call": "LIVE CALL" in home or "Live Call" in home,
        "nova_in_home": "Nova" in home,
        "nova_in_pm": "Nova Mobility" in pm_page or "Nova Brand Director" in pm_page,
        "health": health.strip(),
        "ok": True,
    }
    # ok conditions
    evidence["ok"] = (
        not evidence["home_has_control_room"]
        and evidence["pm_has_control_room"]
        and not evidence["nova_in_pm"]
        and evidence["solar_home_bytes"] < 100000
        and evidence["pm_bytes"] > 100000
    )
    Path("/tmp/forgefront-split-restore-evidence.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps(evidence, indent=2))
    if not evidence["ok"]:
        raise SystemExit("restore verification failed")


if __name__ == "__main__":
    main()
