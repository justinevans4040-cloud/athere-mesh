#!/usr/bin/env python3
from pathlib import Path
import re
import subprocess
import time
from collections import Counter

LIVE = Path("/home/the_founder/forgefront/solar-command")

for name in [
    "DCE_Command_Center_V3.html",
    "V3.html",
    "SolarCommand_V3_LIVE.html",
    "solar_call_engine.js",
    "solar_copilot.js",
]:
    p = LIVE / name
    if not p.exists():
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    orig = t
    t = t.replace("Justin Evans", "the rep")
    t = t.replace("Hey — it’s the rep.", "Hey — I’ll be quick.")
    t = t.replace("Hey — it's the rep.", "Hey — I'll be quick.")
    t = t.replace("Hey — it’s the rep. I’ll be quick.", "Hey — I’ll be quick.")
    # Avoid "the rep" in opener if we created awkward text
    t = re.sub(
        r"Hey — it’s the rep\. I’ll be quick\.",
        "Hey — I’ll be quick.",
        t,
    )
    if t != orig:
        p.write_text(t, encoding="utf-8")
        print("updated", name)

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
hits = re.findall(
    r"Illinois Shines|LightReach|Agent 32|\bSara\b|Nova Mobility|SOLAR COMMAND|Justin Evans|LIVE CALL|FORGEFRONT SOLAR",
    home,
)
print(dict(Counter(hits)))
ok = (
    "Justin Evans" not in home
    and "Illinois Shines" not in home
    and "LightReach" not in home
    and "LIVE CALL" in home
    and "Control Room" not in home
)
print("ok", ok)
raise SystemExit(0 if ok else 1)
