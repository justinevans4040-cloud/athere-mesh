#!/usr/bin/env python3
"""Apply LIVE vs DO_NOT_USE layout across Ichabod project homes."""
from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
HOME = Path("/home/the_founder")
VAULT = Path("/mnt/storage/forgefront-vault")
PROJECTS = VAULT / "02_PROJECTS"
QUARANTINE = VAULT / "09_QUARANTINE"
CANONICAL = VAULT / "01_CANONICAL"
FF = HOME / "forgefront"
GLOBAL_DONOT = PROJECTS / "ZZ_DO_NOT_USE__DIRTY_OR_DUPLICATE_PACKAGES__NEVER_SERVE_AS_LIVE"


def banner(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.strip() + "\n", encoding="utf-8")


def move_into(src: Path, dest_dir: Path) -> str | None:
    if not src.exists():
        return None
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / src.name
    if dest.exists():
        dest = dest_dir / f"{src.name}__{STAMP}"
    shutil.move(str(src), str(dest))
    return str(dest)


def write_doctrine() -> None:
    banner(
        CANONICAL / "LIVE_VS_DO_NOT_USE.md",
        f"""
# LIVE vs DO_NOT_USE — every project (Justin hard rule)

Updated: {STAMP}

## Three buckets

1. **LIVE** — only tree/URL agents may open or demo as the product
2. **ARCHIVE_ONLY** — history; preserve; never serve as live
3. **ZZ_DO_NOT_USE / 09_QUARANTINE** — dirty demos, old brands, duplicate “latest”, security backups

## ForgeFront Systems LIVE

- `/home/the_founder/forgefront/solar-command/`
- Meta: `/home/the_founder/forgefront/forgefront-meta/LIVE_PRODUCT.md`

## Vault

- Projects: `{PROJECTS}`
- Quarantine root: `{QUARANTINE}`
- Global dirty packages: `{GLOBAL_DONOT}`
""",
    )


def ensure_project_labels() -> list[str]:
    notes = []
    GLOBAL_DONOT.mkdir(parents=True, exist_ok=True)
    banner(
        GLOBAL_DONOT / "00_READ_ME_FIRST__DO_NOT_USE.md",
        f"""
# DO NOT USE — NEVER SERVE AS LIVE

Global quarantine for dirty zips, duplicate trees, and pullable packages that confuse agents.

Created/updated: {STAMP}
Live ForgeFront: `/home/the_founder/forgefront/solar-command/`
""",
    )

    # Move existing DCE dirty quarantine under global or keep sibling — keep existing folder, add pointer
    dce = PROJECTS / "ZZ_DO_NOT_USE__DIRTY_DCE_PACKAGES__NEVER_SERVE_AS_LIVE"
    if dce.exists():
        banner(
            GLOBAL_DONOT / "SEE_ALSO_DCE_QUARANTINE.md",
            f"DCE-specific quarantine remains at:\n{dce}\n",
        )

    # Label each 02_PROJECTS entry
    for child in sorted(PROJECTS.iterdir()):
        if not child.is_dir():
            continue
        name = child.name
        if name.startswith("ZZ_DO_NOT_USE"):
            banner(
                child / "00_READ_ME_FIRST__DO_NOT_USE.md",
                "# DO NOT USE — NEVER SERVE AS LIVE\n\nThis entire folder is quarantine.\n",
            )
            notes.append(f"labeled DO_NOT_USE {name}")
            continue
        if "ARCHIVED" in name or name.endswith("_ARCHIVED") or "FELL_THROUGH" in name:
            banner(
                child / "00_ARCHIVE_ONLY__DO_NOT_SERVE_AS_LIVE.md",
                "# ARCHIVE ONLY — DO NOT SERVE AS LIVE\n\nHistory/evidence only. Not the live product.\n",
            )
            notes.append(f"labeled ARCHIVE {name}")
            continue
        # Active-ish vault projects: require LIVE marker if absent
        live_marker = child / "LIVE_PRODUCT.md"
        if not live_marker.exists():
            banner(
                live_marker,
                f"""
# LIVE marker required

Project folder: `{child}`

If this is NOT the runnable live product, rename/move it under:
`{GLOBAL_DONOT}` or `{QUARANTINE}`

If it IS live, replace this file with the exact live path/URL and brand name.
Updated: {STAMP}
""",
            )
            notes.append(f"added LIVE_PRODUCT stub {name}")
    return notes


def quarantine_home_loose_packages() -> list[str]:
    notes = []
    dest = GLOBAL_DONOT / "FROM_HOME_ROOT"
    dest.mkdir(parents=True, exist_ok=True)
    patterns = [
        "DCE_Command_Center_V3_Solar_V1_Audited-1.zip",
        "ODIN_LINEFORGE_NFL_COMPLETE_V3_1_HARDENED_2026-08-13.zip",
        "FORENSIC_SWEEPER_SEARCH_20260813-025557.txt",
    ]
    for name in patterns:
        src = HOME / name
        moved = move_into(src, dest)
        if moved:
            notes.append(f"moved home loose -> {moved}")
    return notes


def quarantine_forgefront_duplicates() -> list[str]:
    notes = []
    dest = GLOBAL_DONOT / "FROM_FORGEFRONT_DUPLICATES"
    # solar-command-latest is a classic confusion trap
    latest = FF / "solar-command-latest"
    if latest.exists():
        moved = move_into(latest, dest)
        if moved:
            notes.append(f"quarantined solar-command-latest -> {moved}")
            stub = FF / "solar-command-latest"
            stub.mkdir(exist_ok=True)
            banner(
                stub / "00_MOVED__DO_NOT_USE.md",
                f"""
# MOVED — DO NOT USE

`solar-command-latest` was a duplicate/confusion trap.

Quarantined to: `{moved}`

**LIVE ONLY:** `/home/the_founder/forgefront/solar-command/`
""",
            )
    # wakecodex leave unless dirty — just mark
    for name in ["pre-rebrand-20260905", "pre-wipe-copy-20260905"]:
        # these are under forgefront-meta usually
        pass
    meta = FF / "forgefront-meta"
    for name in ["pre-rebrand-20260905", "pre-wipe-copy-20260905", "disposed-job-apis-20260905"]:
        p = meta / name
        if p.exists() and p.is_dir():
            banner(
                p / "00_ARCHIVE_ONLY__DO_NOT_SERVE_AS_LIVE.md",
                "# ARCHIVE ONLY — DO NOT SERVE AS LIVE\n\nSnapshot/dispose history. Live is solar-command/.\n",
            )
            notes.append(f"archive-labeled meta/{name}")
    banner(
        FF / "LIVE_PRODUCT.md",
        f"""
# LIVE — ForgeFront Systems

Path: `/home/the_founder/forgefront/solar-command/`
URL (Lenovo tunnel): `http://127.0.0.1:18787/`
Brand: ForgeFront Systems

DO NOT USE duplicates: see `{GLOBAL_DONOT}`
Updated: {STAMP}
""",
    )
    return notes


def quarantine_odin_backups() -> list[str]:
    notes = []
    dest = GLOBAL_DONOT / "FROM_ODIN_SECURITY_BACKUPS"
    dest.mkdir(parents=True, exist_ok=True)
    for child in sorted(HOME.glob("odin-security-backup-*")):
        if child.is_dir():
            # leave in place but add hard banner + symlink index in DO_NOT_USE
            banner(
                child / "00_DO_NOT_USE__NOT_LIVE_ODIN.md",
                "# DO NOT USE AS LIVE ODIN\n\nSecurity/backup snapshot only. Never open this as the ODIN product.\n",
            )
            link = dest / child.name
            if not link.exists():
                try:
                    link.symlink_to(child)
                except OSError:
                    banner(dest / f"{child.name}.path.txt", str(child))
            notes.append(f"odin backup labeled {child.name}")
    # home quarantine folder
    q = HOME / ".odin-lineforge-nfl.quarantine-20260829T1245Z"
    if q.exists():
        banner(
            q / "00_DO_NOT_USE__NOT_LIVE_ODIN.md",
            "# DO NOT USE AS LIVE ODIN\n\nAlready quarantined. Not live.\n",
        )
        notes.append("labeled .odin quarantine dir")
    return notes


def quarantine_reconstruction_trees() -> list[str]:
    notes = []
    for name in ["athere-titan-reconstruction", "athere-titan"]:
        p = HOME / name
        if p.exists():
            banner(
                p / "00_DO_NOT_USE__NOT_LIVE_ATHERE_MESH.md",
                """
# DO NOT USE AS LIVE ATHERE MESH

Live Mesh work continues in `athere-mesh` on master (ACTIVE_RUN).

This tree is reconstruction/legacy — not the live product unless Justin explicitly names it.
""",
            )
            notes.append(f"labeled {name}")
    return notes


def vault_quarantine_banner() -> None:
    banner(
        QUARANTINE / "00_READ_ME_FIRST__QUARANTINE.md",
        f"""
# VAULT 09_QUARANTINE

Nothing in this tree is LIVE product.

Use for recovered/dirty imports. Prefer also naming folders `ZZ_DO_NOT_USE__...` when they are pullable packages.

Updated: {STAMP}
""",
    )


def main() -> None:
    write_doctrine()
    vault_quarantine_banner()
    actions = []
    actions += ensure_project_labels()
    actions += quarantine_home_loose_packages()
    actions += quarantine_forgefront_duplicates()
    actions += quarantine_odin_backups()
    actions += quarantine_reconstruction_trees()
    evidence = {
        "stamp": STAMP,
        "global_do_not_use": str(GLOBAL_DONOT),
        "doctrine": str(CANONICAL / "LIVE_VS_DO_NOT_USE.md"),
        "actions": actions,
        "ok": True,
    }
    out = Path("/tmp/live-vs-do-not-use-rollout.json")
    out.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
