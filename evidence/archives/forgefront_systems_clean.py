#!/usr/bin/env python3
"""Build ForgeFront Systems live surfaces from Audited PM package + wipe job/demo residue."""
from __future__ import annotations

import re
import shutil
import subprocess
import zipfile
from pathlib import Path

LIVE = Path("/home/the_founder/forgefront/solar-command")
ZIP = Path(
    "/mnt/storage/forgefront-vault/02_PROJECTS/"
    "DCE_SOLAR_COMMAND__SARA_IL_SHINES_JOB_FELL_THROUGH__ARCHIVED_20260905/"
    "04_RELATED_EXISTING_PACKAGES/DCE_Command_Center_V3_Solar_V1_Audited-1.zip"
)
WORK = Path("/tmp/forgefront_systems_clean")
MARKERS = [
    "Nova Mobility",
    "Helix Bio",
    "Priya Shah",
    "Jordan Lee",
    "Nina Patel",
    "Alex Morgan",
    "DCE-26031",
    "DCE-26044",
    "DCE USA",
    "DCE UK",
    "DCE Director",
    "DCE Agency",
    "DCE Command Center",
    "marketing@example.com",
    "CES Pavilion",
    "Global Medical Congress",
    "Messe Frankfurt",
    "Illinois Shines",
    "LightReach",
    "Agent 32",
    "Agent32",
    "Demo data restored",
    "SOLAR COMMAND",
]


def clean_pm_html(html: str) -> str:
    repls = [
        ("DCE Command Center V3", "ForgeFront Systems"),
        ("Command Center V3", "ForgeFront Systems"),
        ("DCE PROJECT OPERATIONS", "FORGEFRONT SYSTEMS"),
        ("DCE Agency", "ForgeFront Systems"),
        ("DCE Solar // Command", "ForgeFront Systems"),
        ("DCE Solar", "ForgeFront Systems"),
        (
            "Reset DCE Command Center to demo data? This replaces local data.",
            "Reset ForgeFront Systems to an empty workspace? This replaces local data.",
        ),
        ("Demo data restored", "Workspace reset"),
        ("Reset to Demo", "Reset Workspace"),
        ('brand-mark">DCE</div>', 'brand-mark">FF</div>'),
        ("Project + Communications OS", "Project + Solar Operations"),
        ("dce-command-center-v1", "forgefront-systems-v1"),
        ("dce-v3-client-id", "forgefront-systems-client-id"),
        ("dceSolarRepProfileV1", "forgefrontSolarRepProfileV1"),
        ("SOLAR COMMAND", "FORGEFRONT SYSTEMS"),
        ("Solar Command", "ForgeFront Systems"),
        ("PRIVATE SOLAR COPILOT", "PRIVATE FORGEFRONT COPILOT"),
    ]
    for a, b in repls:
        html = html.replace(a, b)

    # Audited package uses: const seed = () => ({ ... });
    start = html.find("const seed = () => ({")
    if start < 0:
        start = html.find("function seed(){return {")
    if start < 0:
        raise SystemExit("seed() not found in PM HTML")

    # Brace-match from first '{' after seed start
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
        raise SystemExit("seed brace match failed")
    # consume trailing `);` or `;}` forms
    tail = html[end : end + 4]
    if tail.startswith(");"):
        end += 2
    elif tail.startswith(";}"):
        end += 1
    elif html[end : end + 1] == ";":
        end += 1

    empty_seed = """const seed = () => ({
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
    solarLeads:[],
    solarCalls:[],
    solarDnc:[],
    solarConfig:{}
  });"""
    html = html[:start] + empty_seed + html[end:]
    html = re.sub(r"<title>[^<]*</title>", "<title>ForgeFront Systems</title>", html, count=1)

    for marker in MARKERS:
        html = html.replace(marker, "")
    return html


def scrub_text(text: str) -> str:
    brand_map = [
        ("SOLAR COMMAND", "FORGEFRONT SYSTEMS"),
        ("Solar Command", "ForgeFront Systems"),
        ("PRIVATE SOLAR COPILOT", "PRIVATE FORGEFRONT COPILOT"),
        ("ForgeFront by Wake Industries", "ForgeFront Systems"),
        ('product":"ForgeFront"', 'product":"ForgeFront Systems"'),
        ('brand":"ForgeFront by Wake Industries"', 'brand":"ForgeFront Systems"'),
        ("DCE Command Center", "ForgeFront Systems"),
        (
            "Connecting your DCE Command Center call.",
            "Connecting your ForgeFront Systems call.",
        ),
        ("Hey — it’s Justin Evans.", "Hey — I’ll be quick."),
        ("Hey — it's Justin Evans.", "Hey — I’ll be quick."),
        ("DCE Solar // Command", "ForgeFront Systems"),
        ("DCE Solar", "ForgeFront Systems"),
    ]
    for a, b in brand_map:
        text = text.replace(a, b)
    for banned in [
        "Illinois Shines",
        "LightReach",
        "Agent 32",
        "Agent32",
        "Nova Mobility",
        "Helix Bio",
        "Demo data restored",
    ]:
        text = text.replace(banned, "")
    return text


def residual_scan(paths: list[Path]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for p in paths:
        if not p.exists():
            continue
        t = p.read_text(encoding="utf-8", errors="replace")
        hits = [m for m in MARKERS if m in t]
        if "ForgeFront Systems" not in t and p.suffix in {".html", ".js"} and p.name in {
            "DCE_Command_Center_V3.html",
            "V3.html",
            "DCE_V3_server.js",
        }:
            hits.append("MISSING:ForgeFront Systems")
        out[str(p.name)] = hits
    return out


def main() -> None:
    if WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(parents=True)
    with zipfile.ZipFile(ZIP) as zf:
        zf.extractall(WORK)

    src = WORK / "DCE_Command_Center_V3.html"
    cleaned = clean_pm_html(src.read_text(encoding="utf-8"))
    (WORK / "DCE_Command_Center_V3.html").write_text(cleaned, encoding="utf-8")
    (WORK / "V3.html").write_text(cleaned, encoding="utf-8")

    bak = LIVE / f".bak-forgefront-systems"
    bak.mkdir(exist_ok=True)
    for name in ("DCE_Command_Center_V3.html", "V3.html"):
        live_path = LIVE / name
        if live_path.exists():
            shutil.copy2(live_path, bak / name)
        shutil.copy2(WORK / name, live_path)

    scrub_targets = [
        "SolarCommand_V3_LIVE.html",
        "solar_call_engine.js",
        "solar_copilot.js",
        "solar_copilot_ui.js",
        "DCE_V3_server.js",
        "EDGE_MIRROR.html",
        "BRAND.md",
        "README.md",
    ]
    for name in scrub_targets:
        p = LIVE / name
        if not p.exists():
            continue
        p.write_text(scrub_text(p.read_text(encoding="utf-8", errors="replace")), encoding="utf-8")

    # Also scrub the installed PM twin once more for any leftover SOLAR COMMAND chrome
    for name in ("DCE_Command_Center_V3.html", "V3.html"):
        p = LIVE / name
        p.write_text(scrub_text(p.read_text(encoding="utf-8", errors="replace")), encoding="utf-8")

    scan = residual_scan(
        [
            LIVE / "DCE_Command_Center_V3.html",
            LIVE / "V3.html",
            LIVE / "SolarCommand_V3_LIVE.html",
            LIVE / "solar_call_engine.js",
            LIVE / "solar_copilot.js",
            LIVE / "DCE_V3_server.js",
        ]
    )
    print("RESIDUAL_SCAN", scan)
    bad = {k: v for k, v in scan.items() if v}
    if bad:
        raise SystemExit(f"residuals remain: {bad}")

    # Restart listener
    try:
        subprocess.run(["sudo", "systemctl", "restart", "solar-command.service"], check=False)
    except Exception:
        pass
    print("OK cleaned ForgeFront Systems live package")


if __name__ == "__main__":
    main()
