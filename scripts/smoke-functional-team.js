const MISSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const OPERATIONAL_AGENT_IDS = Object.freeze([
  'miss-vale-prime',
  'agent-vale',
  'nyx',
  'rune',
  'qra_emerge_audit',
  'qra_recovery_driver',
]);

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function requireNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function requireProof(value, missionId, label) {
  const proof = requireObject(value, label);
  if (proof.path !== `proofs/${missionId}.json`) throw new Error(`${label} must reference the mission proof path`);
  if (!SHA256.test(proof.sha256)) throw new Error(`${label} must have a lowercase SHA-256 hash`);
  if (proof.verified !== true) throw new Error(`${label} must be verified`);
  return Object.freeze({ path: proof.path, sha256: proof.sha256, verified: true });
}

function responseStatus(response, label) {
  if (!response || !Number.isSafeInteger(response.status)) throw new Error(`${label} returned an invalid response`);
  if (response.status < 200 || response.status > 299) throw new Error(`${label} returned HTTP ${response.status}`);
}

async function fetchJson(fetchImpl, url, label, options) {
  const response = await fetchImpl(url, options);
  responseStatus(response, label);
  if (typeof response.json !== 'function') throw new Error(`${label} did not return JSON`);
  return requireObject(await response.json(), `${label} response`);
}

function endpoint(baseUrl, pathname) {
  return new URL(pathname, baseUrl).toString();
}

function normalizeBaseUrl(baseUrl) {
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) throw new TypeError('baseUrl must be a non-empty URL');
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new TypeError('baseUrl must use HTTP or HTTPS');
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) throw new TypeError('baseUrl must not include a path, search, or hash');
  return parsed.toString();
}

function validateTeam(team) {
  if (team.enabledAgents !== OPERATIONAL_AGENT_IDS.length) throw new Error('team did not report the expected enabled agent count');
  if (!Array.isArray(team.agents)) throw new Error('team agents must be an array');
  const operational = team.agents.filter((agent) => agent?.operational === true).map((agent) => agent.id).sort();
  const expected = [...OPERATIONAL_AGENT_IDS].sort();
  if (operational.length !== expected.length || operational.some((id, index) => id !== expected[index])) {
    throw new Error('team operational agents do not match the functional team');
  }
}

function validateTests(value) {
  const tests = requireObject(value, 'command tests');
  const counts = Object.freeze({
    tests: requireNonNegativeInteger(tests.tests, 'command tests.tests'),
    passed: requireNonNegativeInteger(tests.passed, 'command tests.passed'),
    failed: requireNonNegativeInteger(tests.failed, 'command tests.failed'),
    skipped: requireNonNegativeInteger(tests.skipped, 'command tests.skipped'),
  });
  if (counts.tests < counts.passed + counts.failed + counts.skipped) throw new Error('command test totals are inconsistent');
  if (counts.failed !== 0) throw new Error(`command reported ${counts.failed} failed tests`);
  return counts;
}

export async function runFunctionalTeamSmoke({
  baseUrl = process.env.TITAN_API_URL ?? 'http://127.0.0.1:5050',
  fetchImpl = globalThis.fetch,
  write = (line) => process.stdout.write(line),
} = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof write !== 'function') throw new TypeError('write must be a function');

  const health = await fetchJson(fetchImpl, endpoint(normalizedBaseUrl, '/health'), 'health');
  if (health.ready !== true || health.enabledAgents !== OPERATIONAL_AGENT_IDS.length) {
    throw new Error('health did not report a ready functional team');
  }

  const team = await fetchJson(fetchImpl, endpoint(normalizedBaseUrl, '/api/team'), 'team');
  validateTeam(team);

  const command = await fetchJson(fetchImpl, endpoint(normalizedBaseUrl, '/api/commands'), 'command', {
    method: 'POST',
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: 'test all of Titan',
  });
  const commandMission = requireObject(command.mission, 'command mission');
  if (!MISSION_ID.test(commandMission.id)) throw new Error('command returned an invalid mission id');
  if (commandMission.status !== 'completed') throw new Error(`command mission did not complete: ${commandMission.status}`);
  const tests = validateTests(command.tests);
  const commandProof = requireProof(commandMission.proof, commandMission.id, 'command mission proof');

  const stored = await fetchJson(
    fetchImpl,
    endpoint(normalizedBaseUrl, `/api/missions/${encodeURIComponent(commandMission.id)}`),
    'mission retrieval',
  );
  const storedMission = requireObject(stored.mission, 'stored mission');
  if (storedMission.id !== commandMission.id) throw new Error('stored mission id does not match command mission id');
  if (storedMission.status !== 'completed') throw new Error(`stored mission did not complete: ${storedMission.status}`);
  const storedProof = requireProof(storedMission.proof, commandMission.id, 'stored mission proof');
  if (storedProof.path !== commandProof.path || storedProof.sha256 !== commandProof.sha256) {
    throw new Error('stored mission proof does not match command proof');
  }

  const evidence = Object.freeze({
    smoke: 'functional-team',
    baseUrl: new URL(normalizedBaseUrl).origin,
    missionId: commandMission.id,
    status: 'completed',
    tests,
    proof: storedProof,
  });
  write(`${JSON.stringify(evidence)}\n`);
  return evidence;
}

if (import.meta.main) {
  try {
    await runFunctionalTeamSmoke();
  } catch (error) {
    process.stderr.write(`functional team smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
