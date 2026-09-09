#!/usr/bin/env python3
from pathlib import Path

live = Path("/home/the_founder/forgefront/solar-command")

# Health / brand product string
server = live / "DCE_V3_server.js"
t = server.read_text(encoding="utf-8")
t = t.replace('product:"ForgeFront"', 'product:"ForgeFront Systems"')
t = t.replace('product: "ForgeFront"', 'product: "ForgeFront Systems"')
t = t.replace("'product':'ForgeFront'", "'product':'ForgeFront Systems'")
# common JSON builders
t = t.replace('"product":"ForgeFront"', '"product":"ForgeFront Systems"')
server.write_text(t, encoding="utf-8")

# Fix no-demo test expectations for new brand/storage
p = live / "solar_no_demo_data.test.js"
tt = p.read_text(encoding="utf-8")
tt = tt.replace("dceSolarRepProfileV1", "forgefrontSolarRepProfileV1")
tt = tt.replace("Reset DCE Command Center to demo data", "Reset ForgeFront Systems to an empty workspace")
p.write_text(tt, encoding="utf-8")

# Scan HTML for solarCleanSlate / EMPTY_SOLAR — if missing, tests that require solar-only DOM need update
html = (live / "V3.html").read_text(encoding="utf-8")
print("has solarCleanSlate", "solarCleanSlate" in html or 'id="solarCleanSlate"' in html)
print("has EMPTY_SOLAR_STATE", "EMPTY_SOLAR_STATE" in html)
print("has forgefrontSolarRepProfileV1", "forgefrontSolarRepProfileV1" in html)
print("has Nova", "Nova Mobility" in html)
print("title ok", "<title>ForgeFront Systems</title>" in html)
print("seed empty projects", "projects:[]," in html)
