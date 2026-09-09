#!/usr/bin/env python3
"""Keep ONE Solar + ONE PM live copy. Delete all other app copies. Justin order."""
from __future__ import annotations

import json
import shutil
import subprocess
import time
from pathlib import Path

LIVE = Path("/home/the_founder/forgefront/solar-command")
FF = Path("/home/the_founder/forgefront")
META = FF / "forgefront-meta"
VAULT = Path("/mnt/storage/forgefront-vault/02_PROJECTS")
STAMP = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())

# Canonical live files (exactly one Solar UI + one PM UI)
KEEP_SOLAR = LIVE / "DCE_Command_Center_V3.html"
KEEP_PM = LIVE / "ForgeFront_PM.html"

APP_HTML_NAMES = {
    "DCE_Command_Center_V3.html",
    "V3.html",
    "SolarCommand_V3_LIVE.html",
    "ForgeFront_PM.html",
}
APP_ZIP_GLOBS = (
    "*DCE_Command*",
    "*Solar*V1*",
    "*SolarCommand*",
    "*ForgeFront*PM*",
)


def rm(path: Path, deleted: list[str]) -> None:
    if not path.exists() and not path.is_symlink():
        return
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)
    deleted.append(str(path))


def main() -> None:
    if not KEEP_SOLAR.exists() or not KEEP_PM.exists():
        raise SystemExit(f"canonical missing: solar={KEEP_SOLAR.exists()} pm={KEEP_PM.exists()}")

    deleted: list[str] = []
    kept = [str(KEEP_SOLAR), str(KEEP_PM)]

    # --- Live tree: remove twin/alt solar HTML ---
    for name in ("V3.html", "SolarCommand_V3_LIVE.html"):
        p = LIVE / name
        if p.exists():
            rm(p, deleted)

    # bak folders + stub dirs inside live
    for p in LIVE.iterdir():
        if p.name.startswith(".bak") or p.name == "ZZ_DO_NOT_USE_AS_DEFAULT_ENTRY":
            rm(p, deleted)

    # solar-command-latest stub (confusion trap)
    latest = FF / "solar-command-latest"
    if latest.exists():
        rm(latest, deleted)

    # Meta snapshots that are copies of the apps
    for snap in (
        META / "pre-wipe-copy-20260905",
        META / "pre-rebrand-20260905",
    ):
        if snap.exists():
            # delete only app HTML/js UI copies inside, or whole snap folder?
            # Whole folder is app snapshot — remove it.
            rm(snap, deleted)

    # Vault: delete DO_NOT_USE app package trees + peeks + duplicate audited zips
    for name in (
        "ZZ_DO_NOT_USE__DIRTY_DCE_PACKAGES__NEVER_SERVE_AS_LIVE",
        "ZZ_DO_NOT_USE__DIRTY_OR_DUPLICATE_PACKAGES__NEVER_SERVE_AS_LIVE",
    ):
        p = VAULT / name
        if p.exists():
            rm(p, deleted)

    # Job archive: strip app HTML/UI snapshots; keep job packet docs
    job = VAULT / "DCE_SOLAR_COMMAND__SARA_IL_SHINES_JOB_FELL_THROUGH__ARCHIVED_20260905"
    if job.exists():
        for sub in (
            "02_PRE_WIPE_UI_AND_ENGINE_SNAPSHOT",
            "03_PRE_REBRAND_SNAPSHOT",
            "04_RELATED_EXISTING_PACKAGES",
        ):
            p = job / sub
            if p.exists():
                rm(p, deleted)
        # any leftover app html under job archive
        for p in job.rglob("*"):
            if p.is_file() and p.name in APP_HTML_NAMES:
                rm(p, deleted)

    # Patch server: / and /pm only; no /solar / V3 twin
    server = LIVE / "DCE_V3_server.js"
    txt = server.read_text(encoding="utf-8")
    # Normalize route line to solar home + pm only
    import re

    txt2 = re.sub(
        r"let rel=u\.pathname==='/'[^;]+;",
        "let rel=u.pathname==='/'?'DCE_Command_Center_V3.html':u.pathname==='/pm'||u.pathname==='/project-management'?'ForgeFront_PM.html':u.pathname==='/edge'?'EDGE_MIRROR.html':decodeURIComponent(u.pathname.replace(/^\\//,''));",
        txt,
        count=1,
    )
    # Remove SolarCommand from STATIC_FILES if present
    txt2 = txt2.replace("'SolarCommand_V3_LIVE.html',", "")
    txt2 = txt2.replace('"SolarCommand_V3_LIVE.html",', "")
    txt2 = txt2.replace("'V3.html',", "")
    txt2 = txt2.replace('"V3.html",', "")
    if txt2 != txt:
        server.write_text(txt2, encoding="utf-8")

    # Update LIVE markers
    (FF / "LIVE_PRODUCT.md").write_text(
        f"""# LIVE — one copy each (restored cleanup {STAMP})

## Solar
- File: `{KEEP_SOLAR}`
- URL: `/` → http://127.0.0.1:8787/ (Lenovo :18787)

## Project Management
- File: `{KEEP_PM}`
- URL: `/pm` → http://127.0.0.1:8787/pm

All other app HTML/zip duplicates were deleted per Justin order.
""",
        encoding="utf-8",
    )
    (LIVE / "LIVE_SPLIT.md").write_text(
        f"""# One Solar + one PM only ({STAMP})

- Solar: `/` → DCE_Command_Center_V3.html
- PM: `/pm` → ForgeFront_PM.html

No V3 twin. No SolarCommand_V3_LIVE. No bak/peek/Drive-duplicate trees on this host.
""",
        encoding="utf-8",
    )

    # Restart + verify
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

    remaining = []
    for root in (FF, VAULT):
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if p.is_file() and p.name in APP_HTML_NAMES:
                remaining.append(str(p))

    evidence = {
        "stamp": STAMP,
        "kept": kept,
        "deleted_count": len(deleted),
        "deleted": deleted,
        "remaining_app_html": remaining,
        "home_live_call": "LIVE CALL" in home,
        "home_control_room": "Control Room" in home,
        "pm_control_room": "Control Room" in pm,
        "ok": (
            KEEP_SOLAR.exists()
            and KEEP_PM.exists()
            and ("LIVE CALL" in home)
            and ("Control Room" not in home)
            and ("Control Room" in pm)
            and set(remaining) == set(kept)
        ),
    }
    Path("/tmp/forgefront-one-copy-each-evidence.json").write_text(
        json.dumps(evidence, indent=2), encoding="utf-8"
    )
    print(json.dumps({k: evidence[k] for k in ("stamp", "deleted_count", "remaining_app_html", "home_live_call", "pm_control_room", "ok")}, indent=2))
    print("DELETED_PATHS_START")
    for d in deleted:
        print(d)
    print("DELETED_PATHS_END")
    if not evidence["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
