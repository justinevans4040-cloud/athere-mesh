#!/usr/bin/env python3
"""Force-wipe Solar runtime identity pollution (localStorage + defaults)."""
from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path

LIVE = Path("/home/the_founder/forgefront/solar-command")

BANNED_IDENTITY = [
    "Illinois Shines",
    "IL Shines",
    "LightReach",
    "Sara",
    "SARA",
    "Agent 32",
    "Agent32",
    "Nova Mobility",
    "Helix Bio",
]


def patch_html(html: str) -> str:
    # Kill Agent-32-ish default rep id
    html = html.replace("setv('repId','32')", "setv('repId','')")
    html = html.replace('setv("repId","32")', 'setv("repId","")')

    # Bump solar storage namespaces so polluted localStorage is abandoned
    for old, new in [
        ("dceSolarRepProfileV1", "forgefrontSolarRepProfileV2"),
        ("forgefrontSolarRepProfileV1", "forgefrontSolarRepProfileV2"),
        ("dce-solar-v1", "forgefront-solar-v2"),
        ("solarLeadsV1", "forgefrontSolarLeadsV2"),
    ]:
        html = html.replace(old, new)

    # Inject boot sanitizer before seedTalkDefaults IIFE if not present
    sanitizer = r"""
(function wipeBannedSolarIdentity(){
  const banned=[%s];
  const dirty=v=>banned.some(b=>String(v||'').toLowerCase().includes(String(b).toLowerCase()));
  try{
    const keys=[];
    for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k) keys.push(k); }
    for(const k of keys){
      const raw=localStorage.getItem(k)||'';
      if(dirty(raw) || /solar|forgefront|dce|repProfile|lead/i.test(k) && dirty(raw)){
        // If this key holds solar identity pollution, drop it
        if(dirty(raw)) localStorage.removeItem(k);
      }
    }
  }catch(e){}
  try{
    if(typeof val==='function' && typeof setv==='function'){
      if(dirty(val('companyIdentity'))) { setv('companyIdentity',''); setv('companyIdentityApproved', false); }
      if(String(val('repId')||'')==='32') setv('repId','');
      if(/justin\s*evans/i.test(String(val('repName')||''))) setv('repName','');
    }
  }catch(e){}
})();
""" % (",".join(json.dumps(x) for x in BANNED_IDENTITY))

    if "wipeBannedSolarIdentity" not in html:
        # Prefer insert right before seedTalkDefaults
        anchor = "(function seedTalkDefaults()"
        if anchor in html:
            html = html.replace(anchor, sanitizer + "\n" + anchor, 1)
        else:
            html = html.replace("</body>", "<script>" + sanitizer + "</script></body>", 1)

    # Also harden OPEN line: never interpolate companyIdentity if banned substring slips through
    # Patch inline render paths that display companyIdentity raw — engine already claim-gates,
    # but stored approved+identity bypasses. Force approved false when dirty in data() path.
    guard = """
function forgefrontSanitizeIdentityFields(){
  const banned=[%s];
  const dirty=v=>banned.some(b=>String(v||'').toLowerCase().includes(String(b).toLowerCase()));
  try{
    if(dirty(val('companyIdentity'))){ setv('companyIdentity',''); setv('companyIdentityApproved', false); }
    if(String(val('repId')||'')==='32') setv('repId','');
  }catch(e){}
}
""" % (",".join(json.dumps(x) for x in BANNED_IDENTITY))
    if "forgefrontSanitizeIdentityFields" not in html:
        html = html.replace(
            "function data(){",
            guard + "\nfunction data(){ forgefrontSanitizeIdentityFields();",
            1,
        )

    return html


def patch_engine(js: str) -> str:
    # If companyIdentity contains banned terms, treat as unapproved empty
    needle = "if(!ctx.companyIdentity){ ctx.companyIdentity=''; ctx.companyIdentityApproved=false; }"
    repl = (
        "if(!ctx.companyIdentity){ ctx.companyIdentity=''; ctx.companyIdentityApproved=false; }\n"
        "        {\n"
        "          const banned=['Illinois Shines','IL Shines','LightReach','Sara','SARA','Agent 32','Nova Mobility','Helix Bio'];\n"
        "          const dirty=v=>banned.some(b=>String(v||'').toLowerCase().includes(String(b).toLowerCase()));\n"
        "          if(dirty(ctx.companyIdentity)){ ctx.companyIdentity=''; ctx.companyIdentityApproved=false; }\n"
        "        }"
    )
    if "const banned=['Illinois Shines'" not in js:
        if needle not in js:
            raise SystemExit("engine needle missing")
        js = js.replace(needle, repl, 1)
    return js


def main() -> None:
    for name in ("DCE_Command_Center_V3.html", "V3.html", "SolarCommand_V3_LIVE.html"):
        p = LIVE / name
        if not p.exists() or p.stat().st_size < 1000:
            continue
        p.write_text(patch_html(p.read_text(encoding="utf-8", errors="replace")), encoding="utf-8")
        print("patched", name)

    eng = LIVE / "solar_call_engine.js"
    eng.write_text(patch_engine(eng.read_text(encoding="utf-8")), encoding="utf-8")
    print("patched engine")

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
    eng_txt = (LIVE / "solar_call_engine.js").read_text(encoding="utf-8")
    html = (LIVE / "DCE_Command_Center_V3.html").read_text(encoding="utf-8")
    evidence = {
        "has_sanitizer": "wipeBannedSolarIdentity" in html,
        "has_data_guard": "forgefrontSanitizeIdentityFields" in html,
        "engine_banned_guard": "Illinois Shines" in eng_txt and "dirty(ctx.companyIdentity)" in eng_txt,
        "repId_32_default_gone": "setv('repId','32')" not in html,
        "storage_v2": "forgefrontSolarRepProfileV2" in html,
        "static_html_clean": not any(
            x in home
            for x in ("LightReach", "Illinois Shines", "Sara campaign", "Agent 32")
        ),
    }
    evidence["ok"] = all(
        [
            evidence["has_sanitizer"],
            evidence["has_data_guard"],
            evidence["engine_banned_guard"],
            evidence["repId_32_default_gone"],
            evidence["storage_v2"],
            evidence["static_html_clean"],
        ]
    )
    Path("/tmp/forgefront-solar-identity-kill-evidence.json").write_text(
        json.dumps(evidence, indent=2), encoding="utf-8"
    )
    print(json.dumps(evidence, indent=2))
    if not evidence["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
