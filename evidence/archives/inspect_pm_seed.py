#!/usr/bin/env python3
import re
import zipfile
from pathlib import Path

z = Path(
    "/mnt/storage/forgefront-vault/02_PROJECTS/"
    "DCE_SOLAR_COMMAND__SARA_IL_SHINES_JOB_FELL_THROUGH__ARCHIVED_20260905/"
    "04_RELATED_EXISTING_PACKAGES/DCE_Command_Center_V3_Solar_V1_Audited-1.zip"
)
with zipfile.ZipFile(z) as zf:
    html = zf.read("DCE_Command_Center_V3.html").decode("utf-8")
print("len", len(html))
for pat in [
    "function seed",
    "const seed",
    "Nova Mobility",
    "projects:[",
    "settings:{company",
    "function reset",
    "let state",
]:
    print(pat, html.find(pat))
i = html.find("Nova Mobility")
print("---nova context---")
print(html[max(0, i - 500) : i + 300])
j = html.find("function reset")
print("---reset---")
print(html[j : j + 700])
# find how DEMO_SEED or similar
for m in re.finditer(r"(seed|DEMO|demoData|initialState|DEFAULT_STATE)\w*", html):
    if m.start() < 200000:
        pass
names = sorted(set(re.findall(r"function\s+([A-Za-z0-9_]+)\s*\(", html)))
print("functions sample", [n for n in names if any(x in n.lower() for x in ("seed", "reset", "demo", "load", "save", "state"))][:40])
# Look for projects array start more carefully
m = re.search(r"projects\s*:\s*\[", html)
print("projects match", m.start() if m else None)
if m:
    print(html[m.start() - 80 : m.start() + 200])
