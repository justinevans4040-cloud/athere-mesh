#!/usr/bin/env python3
"""Filter S24 paths for wake/forgefront; write JSON to stdout and optional outfile."""
import json, os, re, sys
pat = re.compile(r"wake|forgefront|forge.?front|blox|helios|wakecodex", re.I)
hits = []
# Termux home dirs of interest
home = os.path.expanduser("~")
for rel in ["wake-offload", ".ollama", "SolarCommand_V3_LIVE.html", "odin-worker-s24", ".odin-lineforge-nfl", "ignite"]:
    p = os.path.join(home, rel)
    if os.path.isdir(p):
        for dp, dns, fns in os.walk(p):
            for name in fns:
                fp = os.path.join(dp, name)
                try:
                    st = os.stat(fp)
                    hits.append({"path": fp, "name": name, "bytes": st.st_size, "source": "s24-termux"})
                except OSError:
                    pass
    elif os.path.isfile(p):
        st = os.stat(p)
        hits.append({"path": p, "name": os.path.basename(p), "bytes": st.st_size, "source": "s24-termux"})
hits.sort(key=lambda h: -h["bytes"])
total = sum(h["bytes"] for h in hits)
out = {
    "wakeForgeTermuxHitCount": len(hits),
    "wakeForgeTermuxHitBytes": total,
    "wakeForgeTermuxHitGB": round(total / 1024**3, 3),
    "top30": hits[:30],
}
path = os.path.expanduser("~/s24-mesh-dump/wake-forgefront-termux.json")
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2)
print(json.dumps(out))
