#!/usr/bin/env python3
from pathlib import Path
import re
import subprocess
import time

p = Path("/home/the_founder/forgefront/solar-command/DCE_V3_server.js")
t = p.read_text(encoding="utf-8")
t2 = t
# Broad replace of product field values that are exactly ForgeFront
t2 = re.sub(
    r'(["\']product["\']\s*:\s*["\'])ForgeFront(["\'])',
    r"\1ForgeFront Systems\2",
    t2,
)
t2 = re.sub(
    r'(product\s*:\s*["\'])ForgeFront(["\'])',
    r"\1ForgeFront Systems\2",
    t2,
)
p.write_text(t2, encoding="utf-8")
print("changed", t != t2)
for i, line in enumerate(t2.splitlines(), 1):
    if "product" in line and "ForgeFront" in line:
        print(f"{i}:{line.strip()[:140]}")

subprocess.run(["fuser", "-k", "8787/tcp"], check=False, capture_output=True)
time.sleep(1)
log = open("/tmp/forgefront-systems.log", "a", encoding="utf-8")
subprocess.Popen(
    ["node", "DCE_V3_server.js"],
    cwd="/home/the_founder/forgefront/solar-command",
    stdout=log,
    stderr=log,
    start_new_session=True,
)
time.sleep(1)
print(subprocess.check_output(["curl", "-sS", "-m", "3", "http://127.0.0.1:8787/api/health"], text=True))
