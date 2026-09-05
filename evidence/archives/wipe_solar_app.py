#!/usr/bin/env python3
"""Wipe Solar live app of job/campaign/demo leftovers. Explicit Justin order."""
from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path

LIVE = Path("/home/the_founder/forgefront/solar-command")
STAMP = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())

BANNED = [
    "Illinois Shines",
    "IL Shines",
    "LightReach",
    "Agent 32",
    "Agent32",
    "SARA",
    "Sara packet",
    "Nova Mobility",
    "Nova Brand Director",
    "Helix Bio",
    "Priya Shah",
    "Jordan Lee",
    "Alex Morgan",
    "Nina Patel",
    "DCE Agency",
    "DCE-26031",
    "DCE-26044",
    "marketing@example.com",
    "brand@example.com",
    "Demo data restored",
    "Reset to Demo",
]

# Soft identity theater / old job openers
SOFT = [
    ("Hey — it’s Justin Evans.", "Hey — I’ll be quick."),
    ("Hey — it's Justin Evans.", "Hey — I’ll be quick."),
    ("Hey — it’s Justin.", "Hey — I’ll be quick."),
]


def wipe_text(text: str) -> str:
    for a, b in SOFT:
        text = text.replace(a, b)
    for b in BANNED:
        text = text.replace(b, "")
    # Common job-adjacent leftovers
    text = re.sub(r"\bComEd\b(?=.*LightReach)", "utility", text)  # only if paired — skip if too aggressive
    return text


def scrub_seed_talk(html: str) -> str:
    """Force empty/unapproved company identity defaults in solar HTML if present."""
    html = re.sub(
        r"seedTalkDefaults\s*=\s*\{[\s\S]*?\}",
        "seedTalkDefaults = { companyName:'', vendorName:'', companyIdentityApproved:false }",
        html,
        count=1,
    )
    html = html.replace("companyIdentityApproved:true", "companyIdentityApproved:false")
    html = html.replace("companyIdentityApproved: true", "companyIdentityApproved: false")
    return html


def main() -> None:
    targets = [
        "DCE_Command_Center_V3.html",
        "V3.html",
        "SolarCommand_V3_LIVE.html",
        "solar_call_engine.js",
        "solar_copilot.js",
        "solar_copilot_ui.js",
        "solar_operator_runtime.js",
        "EDGE_MIRROR.html",
    ]
    bak = LIVE / f".bak-before-solar-wipe-{STAMP}"
    bak.mkdir(exist_ok=True)
    changed = []
    scan_before = {}
    scan_after = {}

    for name in targets:
        p = LIVE / name
        if not p.exists():
            continue
        raw = p.read_text(encoding="utf-8", errors="replace")
        shutil_copy = bak / name
        shutil_copy.write_text(raw, encoding="utf-8")
        hits = [b for b in BANNED if b in raw]
        scan_before[name] = hits
        out = wipe_text(raw)
        if name.endswith(".html"):
            out = scrub_seed_talk(out)
            # Brand chrome only — keep solar UI structure
            out = out.replace("<title>DCE Solar // Command</title>", "<title>ForgeFront // Command</title>")
            out = out.replace("SOLAR COMMAND", "FORGEFRONT SOLAR")
            out = out.replace(">SOLAR COMMAND<", ">FORGEFRONT SOLAR<")
            out = out.replace("<strong>SOLAR COMMAND</strong>", "<strong>FORGEFRONT SOLAR</strong>")
        if out != raw:
            p.write_text(out, encoding="utf-8")
            changed.append(name)
        scan_after[name] = [b for b in BANNED if b in out]

    # Restart
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
    residual_home = [b for b in BANNED if b in home]
    # also catch SOLAR COMMAND old chrome
    chrome = {
        "SOLAR COMMAND": "SOLAR COMMAND" in home,
        "FORGEFRONT SOLAR": "FORGEFRONT SOLAR" in home or "ForgeFront" in home,
        "LIVE CALL": "LIVE CALL" in home,
        "Control Room": "Control Room" in home,
        "Illinois Shines": "Illinois Shines" in home,
        "LightReach": "LightReach" in home,
        "Nova": "Nova Mobility" in home or "Nova Brand" in home,
    }
    evidence = {
        "stamp": STAMP,
        "changed": changed,
        "scan_before": scan_before,
        "scan_after": {k: v for k, v in scan_after.items() if v},
        "home_residuals_banned": residual_home,
        "home_chrome": chrome,
        "ok": (not residual_home)
        and (not chrome["Control Room"])
        and chrome["LIVE CALL"]
        and (not chrome["Illinois Shines"])
        and (not chrome["LightReach"])
        and (not chrome["Nova"]),
    }
    Path("/tmp/forgefront-solar-wipe-evidence.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps(evidence, indent=2))
    if not evidence["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
