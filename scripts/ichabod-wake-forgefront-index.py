#!/usr/bin/env python3
import json
import os

roots = [
    "/mnt/storage/WAKE",
    "/mnt/storage/forgefront-vault",
    "/mnt/storage/WAKE_OFFLOAD",
    "/mnt/storage/archive",
]
out = {"host": "ichabodcrane", "roots": []}
for root in roots:
    if not os.path.isdir(root):
        out["roots"].append({"path": root, "missing": True})
        continue
    total = 0
    count = 0
    top = []
    for dp, dns, fns in os.walk(root):
        for name in fns:
            fp = os.path.join(dp, name)
            try:
                st = os.stat(fp)
            except OSError:
                continue
            total += st.st_size
            count += 1
            top.append((st.st_size, fp))
    top.sort(reverse=True)
    out["roots"].append({
        "path": root,
        "files": count,
        "bytes": total,
        "gb": round(total / 1024**3, 3),
        "top20": [{"bytes": b, "gb": round(b / 1024**3, 3), "path": p} for b, p in top[:20]],
    })
out["totalBytes"] = sum(r.get("bytes", 0) for r in out["roots"])
out["totalGB"] = round(out["totalBytes"] / 1024**3, 3)
path = "/mnt/storage/wake-forgefront-MASTER-INDEX-20260905.json"
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2)
print(json.dumps({"wrote": path, "totalGB": out["totalGB"], "perRoot": [
    {"path": r.get("path"), "gb": r.get("gb"), "files": r.get("files")} for r in out["roots"]
]}))
