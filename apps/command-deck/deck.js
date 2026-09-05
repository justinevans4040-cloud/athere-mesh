const TOKEN_KEY = 'athere.commandDeck.token';

const state = {
  token: sessionStorage.getItem(TOKEN_KEY) || '',
  hostLabel: '—',
  health: null,
  team: null,
  lastResult: null,
  busy: false,
};

const el = {
  hostLabel: document.getElementById('hostLabel'),
  hostMeta: document.getElementById('hostMeta'),
  fleetHost: document.getElementById('fleetHost'),
  liveChip: document.getElementById('liveChip'),
  pulseDot: document.getElementById('pulseDot'),
  viewTitle: document.getElementById('viewTitle'),
  intent: document.getElementById('intent'),
  runBtn: document.getElementById('runBtn'),
  runHint: document.getElementById('runHint'),
  readyRing: document.getElementById('readyRing'),
  readyScore: document.getElementById('readyScore'),
  statAgents: document.getElementById('statAgents'),
  statBlocked: document.getElementById('statBlocked'),
  statMission: document.getElementById('statMission'),
  statComs: document.getElementById('statComs'),
  missionIdLabel: document.getElementById('missionIdLabel'),
  riverPreview: document.getElementById('riverPreview'),
  riverFull: document.getElementById('riverFull'),
  agentGrid: document.getElementById('agentGrid'),
  fleetCount: document.getElementById('fleetCount'),
  proofHero: document.getElementById('proofHero'),
  proofTitle: document.getElementById('proofTitle'),
  proofBody: document.getElementById('proofBody'),
  proofSha: document.getElementById('proofSha'),
  proofPath: document.getElementById('proofPath'),
  proofStatus: document.getElementById('proofStatus'),
  resultDump: document.getElementById('resultDump'),
  toast: document.getElementById('toast'),
  refreshBtn: document.getElementById('refreshBtn'),
};

function showToast(message, isError = false) {
  el.toast.hidden = false;
  el.toast.textContent = message;
  el.toast.classList.toggle('err', isError);
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { el.toast.hidden = true; }, 3200);
}

async function api(pathname, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (auth) {
    if (!state.token) throw new Error('owner token missing');
    headers.authorization = `Bearer ${state.token}`;
  }
  if (body !== undefined) headers['content-type'] = 'text/plain; charset=utf-8';
  const response = await fetch(pathname, { method, headers, body });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const err = new Error(payload?.error || `HTTP ${response.status}`);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

function setLink(ok) {
  el.pulseDot.classList.toggle('on', ok);
  el.pulseDot.classList.toggle('off', !ok);
  el.liveChip.classList.toggle('down', !ok);
  el.liveChip.innerHTML = ok
    ? '<i></i><b>MESH</b> · live'
    : '<i></i><b>MESH</b> · offline';
}

function readinessScore(health, team) {
  if (!health?.ready) return 0;
  const online = team?.enabledAgents ?? health.enabledAgents ?? 0;
  const blocked = health.recovery?.blocked ?? 0;
  const corrupt = health.recovery?.corrupt ?? 0;
  let score = 55 + Math.min(40, online * 6);
  score -= blocked * 15;
  score -= corrupt * 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function renderHealth() {
  const score = readinessScore(state.health, state.team);
  el.readyScore.textContent = Number.isFinite(score) ? String(score) : '—';
  el.readyRing.style.setProperty('--score', `${score * 3.6}deg`);
  el.statAgents.textContent = String(state.team?.enabledAgents ?? state.health?.enabledAgents ?? '—');
  el.statBlocked.textContent = String(state.health?.recovery?.blocked ?? '—');
}

function signalList(result) {
  const mission = result?.mission;
  if (Array.isArray(result?.signals) && result.signals.length) return result.signals;
  if (Array.isArray(mission?.signals) && mission.signals.length) return mission.signals;
  if (mission?.status) {
    return [{ type: mission.status, detail: `mission ${mission.status}`, agent: 'orchestrator', at: mission.updatedAt || mission.createdAt }];
  }
  return [];
}

function renderRiver(result) {
  const signals = signalList(result);
  const html = signals.length
    ? signals.map((s, i) => {
      const type = String(s.type || 'signal');
      return `<li style="animation-delay:${i * 40}ms">
        <span class="type ${type}">${escapeHtml(type)}</span>
        <p class="detail">${escapeHtml(s.detail || s.message || '—')}</p>
        <span class="agent">${escapeHtml(s.agent || s.role || '')}</span>
      </li>`;
    }).join('')
    : '<li class="river-empty">No signals yet. Start a mission.</li>';
  el.riverPreview.innerHTML = html;
  el.riverFull.innerHTML = html;
}

function extractProof(result) {
  const mission = result?.mission || {};
  const signals = signalList(result);
  const completed = [...signals].reverse().find((s) => s.proof?.sha256 || s.proof?.path);
  const sha = result?.proofSha256
    || mission?.proof?.sha256
    || completed?.proof?.sha256
    || result?.inventory?.proofSha256
    || result?.organize?.proofSha256;
  const path = result?.proofPath
    || mission?.proof?.path
    || completed?.proof?.path
    || mission?.proofPath;
  const status = mission?.status || result?.status || '—';
  const coms = result?.coms
    || (status === 'completed' || status === 'completedWork' ? 'DONE' : status === 'blocked' || status === 'failed' ? 'HOLD' : '—');
  return { sha, path, status, coms, id: mission?.id };
}

function renderProof(result) {
  if (!result) return;
  const proof = extractProof(result);
  el.missionIdLabel.textContent = proof.id || 'no mission';
  el.statMission.textContent = proof.id ? String(proof.id).slice(0, 18) : 'idle';
  el.statComs.textContent = proof.coms;
  el.statComs.className = `coms ${proof.coms === 'DONE' ? 'done' : proof.coms === 'HOLD' ? 'fail' : 'busy'}`;
  el.proofStatus.textContent = proof.status;
  el.proofSha.textContent = proof.sha || '—';
  el.proofPath.textContent = proof.path || '—';
  const certified = proof.coms === 'DONE' && Boolean(proof.sha || proof.path || proof.status === 'completed');
  el.proofHero.classList.toggle('certified', certified);
  el.proofTitle.textContent = certified ? 'COMS DONE' : proof.status === 'blocked' ? 'BLOCKED' : 'In motion';
  el.proofBody.textContent = certified
    ? 'Auditor-certified completion with durable proof. This is what you show — not a chat claim.'
    : 'Mission returned. Inspect the river and raw payload for what the mesh actually did.';
  el.resultDump.textContent = JSON.stringify(result, null, 2);
  renderRiver(result);
}

function renderTeam() {
  const agents = [...(state.team?.agents || [])].sort((a, b) => {
    const rankDiff = (b.rank ?? 0) - (a.rank ?? 0);
    if (rankDiff !== 0) return rankDiff;
    if (a.operational !== b.operational) return a.operational ? -1 : 1;
    return String(a.name || a.id).localeCompare(String(b.name || b.id));
  });
  const online = agents.filter((a) => a.operational);
  el.fleetCount.textContent = `${online.length} online / ${agents.length} registered`;
  el.agentGrid.innerHTML = agents.map((a) => `
    <article class="agent-card ${a.operational ? 'on' : 'off'}">
      <h3 class="name">${escapeHtml(a.name || a.id)}</h3>
      <p class="role">${escapeHtml(a.role || '')}</p>
      <div class="foot">
        <span>${escapeHtml(a.executorId || 'unbound')}</span>
        <span class="state">${a.operational ? 'ONLINE' : 'REGISTERED'}</span>
      </div>
    </article>
  `).join('') || '<p class="river-empty">No agents returned.</p>';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function bootstrap() {
  const boot = await api('/api/deck/bootstrap', { auth: false });
  state.hostLabel = boot.hostLabel || 'local';
  el.hostLabel.textContent = state.hostLabel;
  el.fleetHost.textContent = state.hostLabel;
  el.hostMeta.textContent = `${boot.bind || '127.0.0.1'} · ${boot.profile || 'owner'}`;
  if (boot.ownerToken) {
    state.token = boot.ownerToken;
    sessionStorage.setItem(TOKEN_KEY, state.token);
  }
  if (!state.token) {
    const entered = window.prompt('Owner bearer token (TITAN_API_BEARER_TOKEN):', '');
    if (entered) {
      state.token = entered.trim();
      sessionStorage.setItem(TOKEN_KEY, state.token);
    }
  }
}

async function refresh() {
  try {
    state.health = await api('/health');
    state.team = await api('/api/team');
    setLink(true);
    renderHealth();
    renderTeam();
  } catch (error) {
    setLink(false);
    showToast(error.message || 'Refresh failed', true);
  }
}

async function runMission() {
  const text = el.intent.value.trim();
  if (!text) {
    showToast('Type an intent first', true);
    return;
  }
  if (state.busy) return;
  state.busy = true;
  el.runBtn.disabled = true;
  el.runHint.textContent = 'Running…';
  el.statComs.textContent = 'RUN';
  el.statComs.className = 'coms busy';
  try {
    const result = await api('/api/commands', { method: 'POST', body: text });
    state.lastResult = result;
    renderProof(result);
    await refresh();
    const proof = extractProof(result);
    showToast(proof.coms === 'DONE' ? 'COMS DONE — proof on deck' : `Mission ${proof.status}`);
    document.querySelector('[data-view="proof"]')?.click();
  } catch (error) {
    showToast(error.message || 'Command failed', true);
    el.statComs.textContent = 'HOLD';
    el.statComs.className = 'coms fail';
  } finally {
    state.busy = false;
    el.runBtn.disabled = false;
    el.runHint.textContent = 'Owner API · same machine';
  }
}

function wireUi() {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('nav-active', b === btn));
      document.querySelectorAll('.view').forEach((panel) => {
        panel.classList.toggle('view-active', panel.dataset.viewPanel === view);
      });
      el.viewTitle.textContent = btn.textContent.trim();
    });
  });
  document.getElementById('chips').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-intent]');
    if (!button) return;
    el.intent.value = button.dataset.intent;
    el.intent.focus();
  });
  el.runBtn.addEventListener('click', () => { void runMission(); });
  el.refreshBtn.addEventListener('click', () => { void refresh(); });
  el.intent.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void runMission();
    }
  });
}

async function main() {
  wireUi();
  renderRiver(null);
  try {
    await bootstrap();
    await refresh();
    showToast(`Deck live on ${state.hostLabel}`);
  } catch (error) {
    setLink(false);
    showToast(error.message || 'Bootstrap failed', true);
  }
  setInterval(() => { void refresh(); }, 12_000);
}

void main();
