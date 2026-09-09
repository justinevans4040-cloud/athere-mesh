#!/usr/bin/env python3
from pathlib import Path
import re
import zipfile
import subprocess
import time
import json

LIVE = Path("/home/the_founder/forgefront/solar-command")
ZIP = Path(
    "/mnt/storage/forgefront-vault/02_PROJECTS/"
    "ZZ_DO_NOT_USE__DIRTY_DCE_PACKAGES__NEVER_SERVE_AS_LIVE/"
    "FROM_SARA_ARCHIVE__04_RELATED_EXISTING_PACKAGES/"
    "DCE_Command_Center_V3_Solar_V1_Audited-1.zip"
)

with zipfile.ZipFile(ZIP) as zf:
    html = zf.read("DCE_Command_Center_V3.html").decode("utf-8")

for a, b in [
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
]:
    html = html.replace(a, b)

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

start = html.find("const seed = () => ({")
if start < 0:
    raise SystemExit("no seed")
i = html.find("({", start) + 1  # points at '{'
depth = 0
in_str = None
esc = False
end = None
while i < len(html):
    ch = html[i]
    if in_str:
        if esc:
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == in_str:
            in_str = None
    else:
        if ch in ("'", '"', "`"):
            in_str = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    i += 1
if end is None:
    raise SystemExit("brace fail")
if html[end : end + 2] == ");":
    end += 2
else:
    while end < len(html) and html[end] in " \t\r\n":
        end += 1
    if html[end : end + 2] == ");":
        end += 2
html = html[:start] + empty + html[end:]
# Final hard strip of fabricated leftovers anywhere
for token in [
    "Nova Mobility",
    "Nova Brand Director",
    "Nova fascia",
    "Helix Bio",
    "Priya Shah",
    "Jordan Lee",
    "Alex Morgan",
    "Nina Patel",
    "DCE-26031",
    "DCE-26044",
    "DCE-NOVA-FASCIA-26031",
    "marketing@example.com",
    "brand@example.com",
]:
    html = html.replace(token, "")

# Remove any remaining meeting/stakeholder demo object lines that still say Nova
html = re.sub(r"\{id:'mt1'[^}]+\},?\n?", "", html)
html = re.sub(r"\{id:'sh1'[^}]+\},?\n?", "", html)
html = re.sub(r"\{id:'ct1'[^}]+\},?\n?", "", html)
html = re.sub(r"\{id:'ct3'[^}]+\},?\n?", "", html)

(LIVE / "ForgeFront_PM.html").write_text(html, encoding="utf-8")
print("Nova left:", "Nova" in html)
print("Control Room:", "Control Room" in html)
print("seed meetings empty:", "meetings:[]," in html)

# ensure routes
srv = (LIVE / "DCE_V3_server.js").read_text(encoding="utf-8")
changed = False
if "ForgeFront_PM.html" not in srv:
    srv = srv.replace("STATIC_FILES = new Set([", "STATIC_FILES = new Set(['ForgeFront_PM.html',")
    changed = True
if "/pm" not in srv:
    old = "let rel=u.pathname==='/'?'DCE_Command_Center_V3.html':u.pathname==='/edge'?'EDGE_MIRROR.html':decodeURIComponent(u.pathname.replace(/^\\//,''));"
    new = "let rel=u.pathname==='/'?'DCE_Command_Center_V3.html':u.pathname==='/pm'||u.pathname==='/project-management'?'ForgeFront_PM.html':u.pathname==='/edge'?'EDGE_MIRROR.html':u.pathname==='/solar'?'SolarCommand_V3_LIVE.html':decodeURIComponent(u.pathname.replace(/^\\//,''));"
    if old not in srv:
        raise SystemExit("route needle missing")
    srv = srv.replace(old, new)
    changed = True
if changed:
    (LIVE / "DCE_V3_server.js").write_text(srv, encoding="utf-8")

subprocess.run(["fuser", "-k", "8787/tcp"], check=False, capture_output=True)
time.sleep(1)
log = open("/tmp/forgefront-systems.log", "a", encoding="utf-8")
subprocess.Popen(["node", "DCE_V3_server.js"], cwd=str(LIVE), stdout=log, stderr=log, start_new_session=True)
time.sleep(1)
home = subprocess.check_output(["curl", "-sS", "-m", "3", "http://127.0.0.1:8787/"], text=True)
pm = subprocess.check_output(["curl", "-sS", "-m", "3", "http://127.0.0.1:8787/pm"], text=True)
ev = {
    "home_title": re.search(r"<title>([^<]+)</title>", home).group(1),
    "pm_title": re.search(r"<title>([^<]+)</title>", pm).group(1),
    "home_is_solar": ("LIVE CALL" in home) and ("Control Room" not in home),
    "pm_is_pm": ("Control Room" in pm),
    "nova_in_pm": "Nova" in pm,
    "solar_bytes": (LIVE / "DCE_Command_Center_V3.html").stat().st_size,
    "pm_bytes": (LIVE / "ForgeFront_PM.html").stat().st_size,
}
ev["ok"] = ev["home_is_solar"] and ev["pm_is_pm"] and (not ev["nova_in_pm"])
Path("/tmp/forgefront-split-restore-evidence.json").write_text(json.dumps(ev, indent=2), encoding="utf-8")
print(json.dumps(ev, indent=2))
raise SystemExit(0 if ev["ok"] else 1)
