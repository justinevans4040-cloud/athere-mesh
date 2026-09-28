from pathlib import Path

root = Path("/home/the_founder/athere-ui-upgrade-20260928/apps/command-deck")
html_path = root / "index.html"
js_path = root / "deck.js"
css_path = root / "deck.css"

html = html_path.read_text()

mission_strip = r'''
    <section class="mission-strip" id="missionStrip" aria-live="polite">
      <div class="mission-beacon"><i></i><span>LIVE MISSION</span></div>
      <div class="mission-cell"><span>STATE</span><strong id="missionState">IDLE</strong></div>
      <div class="mission-cell"><span>ELAPSED</span><strong id="missionElapsed">00:00</strong></div>
      <div class="mission-cell"><span>ACTIVE</span><strong id="activeAgent">—</strong></div>
      <div class="mission-cell mission-event"><span>LAST EVENT</span><strong id="lastEvent">Waiting for mission trace</strong></div>
    </section>
'''

needle = '''    </header>

    <section class="view view-active" data-view-panel="command">'''
assert needle in html
html = html.replace(needle, '''    </header>
''' + mission_strip + '''
    <section class="view view-active" data-view-panel="command">''', 1)

mesh_panel = r'''
      <div class="panel mesh-panel">
        <div class="panel-head">
          <div>
            <span class="eyebrow">LIVE FABRIC</span>
            <h2>Signal topology</h2>
          </div>
          <span class="mono" id="meshActivity">trace-linked · idle</span>
        </div>
        <div class="mesh-map" id="meshMap">
          <svg class="mesh-links" viewBox="0 0 1000 360" preserveAspectRatio="none" aria-hidden="true">
            <path d="M90 180 H245 M300 180 H445 M555 180 H700 M755 180 H910" />
            <path d="M500 120 V55 M500 240 V305" />
          </svg>
          <div class="mesh-node operator" data-node="operator"><b>S24</b><span>OPERATOR</span></div>
          <div class="mesh-node lenovo" data-node="lenovo"><b>LENOVO</b><span>GAME / CONTROL</span></div>
          <div class="mesh-node titan" data-node="titan"><b>TITAN</b><span>MISSION CORE</span></div>
          <div class="mesh-node agent" data-node="agent"><b>AGENT CORE</b><span>EXECUTION</span></div>
          <div class="mesh-node proof" data-node="proof"><b>PROOF VAULT</b><span>EVIDENCE</span></div>
          <div class="mesh-node ichabod" data-node="ichabod"><b>ICHABOD</b><span>COMPUTE HOST</span></div>
          <div class="mesh-node qra" data-node="qra"><b>QRA SENTINEL</b><span>VERIFY</span></div>
          <div class="signal-layer" id="signalLayer" aria-hidden="true"></div>
        </div>
        <p class="mesh-caption">Motion is emitted only when Titan returns new mission trace or signal events. It is an execution visualization, not simulated network traffic.</p>
      </div>
'''

needle = '''      <div class="command-grid">'''
assert needle in html
html = html.replace(needle, mesh_panel + '''
      <div class="command-grid">''', 1)

proof_stages = r'''
        <div class="proof-stages" id="proofStages">
          <div class="proof-stage" data-proof-stage="action"><i>1</i><span>Action</span></div>
          <div class="proof-stage" data-proof-stage="artifact"><i>2</i><span>Artifact</span></div>
          <div class="proof-stage" data-proof-stage="state-transition"><i>3</i><span>State</span></div>
          <div class="proof-stage" data-proof-stage="subgoal"><i>4</i><span>Subgoal</span></div>
          <div class="proof-stage" data-proof-stage="workflow"><i>5</i><span>Workflow</span></div>
          <div class="proof-stage" data-proof-stage="mission"><i>6</i><span>Mission</span></div>
        </div>
'''

needle = '''        <div class="proof-meta">'''
assert needle in html
html = html.replace(needle, proof_stages + '''
        <div class="proof-meta">''', 1)
html_path.write_text(html)

js = js_path.read_text()
js = js.replace(
'''  lastResult: null,
  busy: false,''',
'''  lastResult: null,
  currentMission: null,
  currentMissionId: null,
  missionStartedAt: null,
  activeAgentId: null,
  seenTraceKeys: new Set(),
  busy: false,''',
1)

js = js.replace(
'''  refreshBtn: document.getElementById('refreshBtn'),
};''',
'''  refreshBtn: document.getElementById('refreshBtn'),
  missionStrip: document.getElementById('missionStrip'),
  missionState: document.getElementById('missionState'),
  missionElapsed: document.getElementById('missionElapsed'),
  activeAgent: document.getElementById('activeAgent'),
  lastEvent: document.getElementById('lastEvent'),
  meshMap: document.getElementById('meshMap'),
  signalLayer: document.getElementById('signalLayer'),
  meshActivity: document.getElementById('meshActivity'),
  proofStages: document.getElementById('proofStages'),
};''',
1)

live_code = r'''
function currentMissionId(currentJob) {
  if (!currentJob) return null;
  if (typeof currentJob === 'string') return currentJob;
  return currentJob.missionId || currentJob.id || currentJob.currentMissionId || currentJob.mission?.id || null;
}

function eventActor(event = {}) {
  return String(event.agentId || event.agent || event.actor || event.executorId || event.role || event.model || event.tool || 'titan');
}

function eventLabel(event = {}) {
  return String(event.detail || event.message || event.kind || event.type || event.action || event.status || 'mission event');
}

function eventTime(event = {}) {
  return event.at || event.timestamp || event.createdAt || event.updatedAt || null;
}

function eventKey(event = {}, index = 0) {
  return String(event.id || event.traceId || event.eventId || `${event.kind || event.type || 'event'}:${eventTime(event) || index}:${eventActor(event)}:${eventLabel(event)}`);
}

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function mapNode(value) {
  const v = normalized(value);
  if (v.includes('proof') || v.includes('audit')) return 'proof';
  if (v.includes('qra') || v.includes('sentinel') || v.includes('verify')) return 'qra';
  if (v.includes('lenovo')) return 'lenovo';
  if (v.includes('s24') || v.includes('operator') || v.includes('founder')) return 'operator';
  if (v.includes('ichabod') || v.includes('host')) return 'ichabod';
  if (v.includes('titan') || v.includes('orchestrator') || v.includes('mission')) return 'titan';
  return 'agent';
}

function markAgentActive(actor) {
  state.activeAgentId = actor || 'titan';
  el.activeAgent.textContent = state.activeAgentId;
  document.querySelectorAll('.agent-card.active-now').forEach((card) => card.classList.remove('active-now'));
  const key = normalized(actor);
  const card = [...document.querySelectorAll('.agent-card')].find((item) => {
    return [item.dataset.agentId, item.dataset.agentName, item.dataset.executor].some((value) => normalized(value) === key);
  });
  if (card) {
    card.classList.add('active-now');
    clearTimeout(card._activityTimer);
    card._activityTimer = setTimeout(() => card.classList.remove('active-now'), 2200);
  }
}

function fireSignalPing(from, to, label = 'signal') {
  if (!el.meshMap || !el.signalLayer) return;
  const start = el.meshMap.querySelector(`[data-node="${from}"]`);
  const end = el.meshMap.querySelector(`[data-node="${to}"]`);
  if (!start || !end) return;
  const mapRect = el.meshMap.getBoundingClientRect();
  const a = start.getBoundingClientRect();
  const b = end.getBoundingClientRect();
  const x1 = a.left + a.width / 2 - mapRect.left;
  const y1 = a.top + a.height / 2 - mapRect.top;
  const x2 = b.left + b.width / 2 - mapRect.left;
  const y2 = b.top + b.height / 2 - mapRect.top;
  const ping = document.createElement('span');
  ping.className = 'signal-ping';
  ping.style.left = `${x1}px`;
  ping.style.top = `${y1}px`;
  ping.style.setProperty('--dx', `${x2 - x1}px`);
  ping.style.setProperty('--dy', `${y2 - y1}px`);
  ping.title = label;
  el.signalLayer.appendChild(ping);
  start.classList.add('firing');
  end.classList.add('receiving');
  setTimeout(() => {
    ping.remove();
    start.classList.remove('firing');
    end.classList.remove('receiving');
  }, 1050);
}

function proofLevels(mission = {}) {
  const candidates = [
    mission.qr18?.levels,
    mission.proofVerification?.levels,
    mission.verification?.levels,
    mission.proof?.levels,
  ].find(Array.isArray);
  return candidates || [];
}

function renderProofStages(mission = {}) {
  const levels = proofLevels(mission);
  const completed = mission.status === 'completed' || mission.status === 'completedWork';
  el.proofStages?.querySelectorAll('.proof-stage').forEach((stage) => {
    const record = levels.find((level) => level.id === stage.dataset.proofStage);
    const verified = record?.verified === true || (completed && stage.dataset.proofStage === 'mission' && Boolean(mission.proof || mission.proofPath));
    stage.classList.toggle('verified', verified);
    stage.classList.toggle('checking', !verified && ['running', 'in_progress', 'active'].includes(String(mission.status)));
  });
}

function liveEvents(mission = {}) {
  const trace = Array.isArray(mission.executionTrace) ? mission.executionTrace : [];
  const signals = Array.isArray(mission.signals) ? mission.signals : [];
  return [...trace, ...signals];
}

function renderLiveMission(mission) {
  if (!mission) {
    el.missionState.textContent = 'IDLE';
    el.missionElapsed.textContent = '00:00';
    el.activeAgent.textContent = '—';
    el.lastEvent.textContent = 'Waiting for mission trace';
    return;
  }
  const status = String(mission.status || 'active').toUpperCase();
  el.missionState.textContent = status;
  el.missionStrip.dataset.state = String(mission.status || 'active');
  const started = Date.parse(mission.createdAt || mission.startedAt || '') || state.missionStartedAt || Date.now();
  state.missionStartedAt = started;
  const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
  el.missionElapsed.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const events = liveEvents(mission);
  const latest = events.at(-1);
  if (latest) {
    const actor = eventActor(latest);
    el.lastEvent.textContent = eventLabel(latest);
    markAgentActive(actor);
  }
}

function renderLiveRiver(mission) {
  const events = liveEvents(mission);
  if (!events.length) return;
  const signals = events.slice(-24).map((event) => ({
    type: event.kind || event.type || event.status || 'trace',
    detail: eventLabel(event),
    agent: eventActor(event),
    at: eventTime(event),
    proof: event.proof,
  }));
  renderRiver({ mission: { ...mission, signals } });
}

function processNewEvents(mission) {
  const events = liveEvents(mission);
  events.forEach((event, index) => {
    const key = eventKey(event, index);
    if (state.seenTraceKeys.has(key)) return;
    state.seenTraceKeys.add(key);
    const actor = eventActor(event);
    const label = eventLabel(event);
    const source = mapNode(event.from || event.source || (actor === 'titan' ? 'ichabod' : 'titan'));
    let target = mapNode(event.to || event.destination || actor);
    if (/proof|verify|audit|cert/i.test(`${event.kind || ''} ${event.type || ''} ${label}`)) target = target === 'proof' ? 'proof' : 'qra';
    if (/completed|done|certified/i.test(`${event.status || ''} ${event.type || ''} ${label}`)) target = 'proof';
    fireSignalPing(source, target, label);
    markAgentActive(actor);
    el.meshActivity.textContent = `${actor} · ${label}`.slice(0, 80);
  });
}

async function pollLiveMission() {
  if (!state.token) return;
  try {
    const health = await api('/health');
    state.health = health;
    setLink(true);
    renderHealth();
    const missionId = currentMissionId(health.currentJob);
    if (!missionId) {
      renderLiveMission(state.currentMission);
      return;
    }
    const mission = await api(`/api/missions/${encodeURIComponent(missionId)}`);
    if (state.currentMissionId !== missionId) {
      state.currentMissionId = missionId;
      state.seenTraceKeys = new Set();
      state.missionStartedAt = Date.parse(mission.createdAt || mission.startedAt || '') || Date.now();
    }
    state.currentMission = mission;
    renderLiveMission(mission);
    renderProof({ mission });
    renderProofStages(mission);
    renderLiveRiver(mission);
    processNewEvents(mission);
  } catch (error) {
    setLink(false);
    el.meshActivity.textContent = `live poll · ${error.message || 'failed'}`;
  }
}
'''

needle = '''function signalList(result) {'''
assert needle in js
js = js.replace(needle, live_code + '\n' + needle, 1)

js = js.replace(
'''    <article class="agent-card ${a.operational ? 'on' : 'off'}">''',
'''    <article class="agent-card ${a.operational ? 'on' : 'off'} ${normalized(state.activeAgentId) === normalized(a.id) ? 'active-now' : ''}"
      data-agent-id="${escapeHtml(a.id)}" data-agent-name="${escapeHtml(a.name || '')}" data-executor="${escapeHtml(a.executorId || '')}">''',
1)

js = js.replace(
'''  el.proofBody.textContent = certified
    ? 'Auditor-certified completion with durable proof. This is what you show — not a chat claim.'
    : 'Mission returned. Inspect the river and raw payload for what the mesh actually did.';
  el.resultDump.textContent = JSON.stringify(result, null, 2);''',
'''  el.proofBody.textContent = certified
    ? 'Auditor-certified completion with durable proof. This is what you show — not a chat claim.'
    : 'Mission returned. Inspect the river and raw payload for what the mesh actually did.';
  renderProofStages(mission);
  el.resultDump.textContent = JSON.stringify(result, null, 2);''',
1)

js = js.replace(
'''  state.busy = true;
  el.runBtn.disabled = true;''',
'''  state.busy = true;
  fireSignalPing('operator', 'titan', text);
  el.meshActivity.textContent = 'operator → Titan · command admitted';
  el.runBtn.disabled = true;''',
1)

js = js.replace(
'''    await bootstrap();
    await refresh();
    showToast(`Deck live on ${state.hostLabel}`);''',
'''    await bootstrap();
    await refresh();
    await pollLiveMission();
    showToast(`Deck live on ${state.hostLabel}`);''',
1)

js = js.replace(
'''  setInterval(() => { void refresh(); }, 12_000);
}''',
'''  setInterval(() => { void refresh(); }, 12_000);
  setInterval(() => { void pollLiveMission(); }, 1000);
  setInterval(() => { if (state.currentMission) renderLiveMission(state.currentMission); }, 1000);
}''',
1)
js_path.write_text(js)

css = css_path.read_text()
css += r'''

/* Live mission-control visualization. Motion is driven by real mission events. */
.mission-strip {
  display: grid;
  grid-template-columns: 150px repeat(3, minmax(110px, 0.55fr)) minmax(260px, 1.8fr);
  align-items: stretch;
  gap: 1px;
  margin: 18px 32px 0;
  border: 1px solid rgba(46,230,214,0.24);
  background: rgba(46,230,214,0.08);
  box-shadow: 0 0 40px rgba(46,230,214,0.07), inset 0 0 30px rgba(46,230,214,0.03);
}
.mission-beacon, .mission-cell {
  min-height: 58px;
  padding: 11px 14px;
  background: rgba(5,8,10,0.88);
  border-right: 1px solid var(--line-soft);
}
.mission-beacon { display: flex; align-items: center; gap: 10px; color: var(--cyan); font: 600 10px IBM Plex Mono, monospace; letter-spacing: .12em; }
.mission-beacon i { width: 9px; height: 9px; border-radius: 50%; background: var(--cyan); box-shadow: 0 0 16px var(--cyan); animation: missionPulse 1.2s ease-in-out infinite; }
.mission-cell span { display: block; color: var(--dim); font: 600 8px IBM Plex Mono, monospace; letter-spacing: .14em; }
.mission-cell strong { display: block; margin-top: 7px; color: #dff9f6; font: 600 12px IBM Plex Mono, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mission-strip[data-state="completed"] .mission-beacon i { background: var(--green); box-shadow: 0 0 16px var(--green); animation: none; }
.mission-strip[data-state="failed"] .mission-beacon i,
.mission-strip[data-state="blocked"] .mission-beacon i { background: var(--red); box-shadow: 0 0 16px var(--red); }
@keyframes missionPulse { 50% { opacity: .28; transform: scale(.72); } }

.mesh-panel { margin-bottom: 14px; overflow: hidden; }
.mesh-map {
  position: relative;
  min-height: 360px;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 50%, rgba(46,230,214,.09), transparent 32%),
    linear-gradient(rgba(46,230,214,.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(46,230,214,.035) 1px, transparent 1px),
    #070b0d;
  background-size: auto, 32px 32px, 32px 32px, auto;
}
.mesh-map::after {
  content: "";
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(100deg, transparent 35%, rgba(46,230,214,.05) 50%, transparent 65%);
  transform: translateX(-100%);
  animation: meshScan 8s linear infinite;
}
@keyframes meshScan { to { transform: translateX(100%); } }
.mesh-links { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 1; }
.mesh-links path { fill: none; stroke: rgba(46,230,214,.18); stroke-width: 1.3; vector-effect: non-scaling-stroke; stroke-dasharray: 5 8; }
.mesh-node {
  position: absolute; z-index: 3; width: 132px; min-height: 62px;
  display: grid; place-items: center; text-align: center;
  border: 1px solid rgba(46,230,214,.24);
  background: linear-gradient(145deg, rgba(16,29,31,.96), rgba(7,12,14,.96));
  box-shadow: 0 10px 28px rgba(0,0,0,.34), inset 0 0 20px rgba(46,230,214,.03);
  transform: translate(-50%, -50%);
  transition: border-color .2s, box-shadow .2s, transform .2s;
}
.mesh-node b { display: block; color: #eaffff; font: 700 17px Barlow Condensed, sans-serif; letter-spacing: .07em; }
.mesh-node span { display: block; margin-top: 3px; color: var(--dim); font: 600 8px IBM Plex Mono, monospace; letter-spacing: .08em; }
.mesh-node.operator { left: 9%; top: 50%; }
.mesh-node.lenovo { left: 27%; top: 50%; }
.mesh-node.titan { left: 50%; top: 50%; width: 152px; min-height: 78px; border-color: rgba(46,230,214,.5); box-shadow: 0 0 40px rgba(46,230,214,.12), inset 0 0 24px rgba(46,230,214,.05); }
.mesh-node.agent { left: 72%; top: 50%; }
.mesh-node.proof { left: 91%; top: 50%; border-color: rgba(95,219,139,.35); }
.mesh-node.ichabod { left: 50%; top: 15%; border-color: rgba(240,180,41,.28); }
.mesh-node.qra { left: 50%; top: 85%; border-color: rgba(174,126,255,.35); }
.mesh-node.firing, .mesh-node.receiving { border-color: var(--cyan); box-shadow: 0 0 34px rgba(46,230,214,.42), inset 0 0 24px rgba(46,230,214,.12); transform: translate(-50%, -50%) scale(1.04); }
.signal-layer { position: absolute; inset: 0; z-index: 6; pointer-events: none; }
.signal-ping {
  position: absolute; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%;
  background: #eaffff; border: 2px solid var(--cyan);
  box-shadow: 0 0 9px #fff, 0 0 24px var(--cyan), 0 0 48px rgba(46,230,214,.7);
  animation: signalFlight 1s cubic-bezier(.2,.75,.25,1) forwards;
}
.signal-ping::after { content: ""; position: absolute; inset: -10px; border: 1px solid rgba(46,230,214,.45); border-radius: 50%; animation: signalRipple .55s ease-out infinite; }
@keyframes signalFlight { to { transform: translate(var(--dx), var(--dy)) scale(.6); opacity: .7; } }
@keyframes signalRipple { to { transform: scale(1.6); opacity: 0; } }
.mesh-caption { margin: 0; padding: 10px 18px 14px; color: var(--dim); border-top: 1px solid var(--line-soft); font: 500 9px/1.5 IBM Plex Mono, monospace; }

.agent-card.active-now { border-color: var(--cyan); box-shadow: 0 0 28px rgba(46,230,214,.3), inset 0 0 20px rgba(46,230,214,.08); animation: agentLive .8s ease-in-out infinite alternate; }
.agent-card.active-now .name::after { content: "  • ACTIVE"; color: var(--cyan); font: 600 8px IBM Plex Mono, monospace; letter-spacing: .1em; }
@keyframes agentLive { to { transform: translateY(-2px); } }

.proof-stages {
  display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px;
  margin: 0 0 22px;
}
.proof-stage {
  position: relative; min-height: 72px; padding: 12px 10px;
  border: 1px solid var(--line); background: #070c0e;
  overflow: hidden;
}
.proof-stage i { display: grid; place-items: center; width: 24px; height: 24px; margin-bottom: 9px; border: 1px solid var(--line); border-radius: 50%; color: var(--dim); font: 600 9px IBM Plex Mono, monospace; font-style: normal; }
.proof-stage span { color: var(--muted); font: 600 9px IBM Plex Mono, monospace; letter-spacing: .06em; text-transform: uppercase; }
.proof-stage.checking { border-color: rgba(46,230,214,.3); }
.proof-stage.checking::after { content: ""; position: absolute; left: -60%; bottom: 0; width: 60%; height: 2px; background: var(--cyan); box-shadow: 0 0 12px var(--cyan); animation: proofSweep 1.4s linear infinite; }
.proof-stage.verified { border-color: rgba(95,219,139,.5); background: rgba(95,219,139,.06); box-shadow: inset 0 0 24px rgba(95,219,139,.04); }
.proof-stage.verified i { color: #04140b; background: var(--green); border-color: var(--green); box-shadow: 0 0 14px rgba(95,219,139,.45); }
.proof-stage.verified span { color: var(--green); }
@keyframes proofSweep { to { left: 110%; } }

@media (max-width: 1100px) {
  .mission-strip { grid-template-columns: 130px repeat(3, minmax(95px, .5fr)) minmax(190px, 1.2fr); }
  .mesh-node { width: 112px; }
  .proof-stages { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 760px) {
  .mission-strip { margin: 12px 16px 0; grid-template-columns: 1fr 1fr; }
  .mission-beacon, .mission-event { grid-column: 1 / -1; }
  .mesh-map { min-height: 520px; }
  .mesh-node.operator { left: 18%; top: 18%; }
  .mesh-node.lenovo { left: 50%; top: 18%; }
  .mesh-node.ichabod { left: 82%; top: 18%; }
  .mesh-node.titan { left: 50%; top: 46%; }
  .mesh-node.agent { left: 18%; top: 76%; }
  .mesh-node.qra { left: 50%; top: 76%; }
  .mesh-node.proof { left: 82%; top: 76%; }
  .mesh-links { display: none; }
  .proof-stages { grid-template-columns: repeat(2, 1fr); }
}
'''
css_path.write_text(css)
print("patched", html_path, js_path, css_path)
