#!/usr/bin/env python3
import json
import subprocess
from pathlib import Path

LIVE = Path("/home/the_founder/forgefront/solar-command")
js = r"""
const E = require('./solar_call_engine.js');
const s = E.createSession();
const dirty = E.getGuidance(s, {
  repName: 'the rep',
  companyIdentity: 'LightReach / Illinois Shines (Sara campaign)',
  companyIdentityApproved: true
});
const clean = E.getGuidance(s, {
  repName: 'the rep',
  companyIdentity: 'Acme Solar Approved',
  companyIdentityApproved: true
});
console.log(JSON.stringify({
  dirtyLine: dirty.recommendedLine,
  cleanLine: clean.recommendedLine,
  dirtyHasSara: /LightReach|Illinois|Sara/i.test(dirty.recommendedLine || ''),
  cleanHasAcme: /Acme Solar Approved/.test(clean.recommendedLine || '')
}));
"""
Path("/tmp/test_solar_guidance.js").write_text(js, encoding="utf-8")
out = subprocess.check_output(
    ["node", "/tmp/test_solar_guidance.js"], cwd=str(LIVE), text=True
)
print(out)
data = json.loads(out)
html = (LIVE / "DCE_Command_Center_V3.html").read_text(encoding="utf-8")
ev = {
    "dirtyHasSara": data["dirtyHasSara"],
    "cleanHasAcme": data["cleanHasAcme"],
    "dirtyLine": data["dirtyLine"],
    "cleanLine": data["cleanLine"],
    "has_sanitizer": "wipeBannedSolarIdentity" in html,
    "repId_32_gone": "setv('repId','32')" not in html,
    "ok": (not data["dirtyHasSara"]) and data["cleanHasAcme"] and ("wipeBannedSolarIdentity" in html),
}
Path("/tmp/forgefront-solar-identity-kill-evidence.json").write_text(
    json.dumps(ev, indent=2), encoding="utf-8"
)
print(json.dumps(ev, indent=2))
raise SystemExit(0 if ev["ok"] else 1)
