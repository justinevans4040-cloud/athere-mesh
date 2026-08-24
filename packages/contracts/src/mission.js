const SIGNAL_TYPES = new Set(['accepted', 'running', 'blocked', 'completed']);
const TRANSITIONS = Object.freeze({
  accepted: new Set(['running', 'blocked']),
  running: new Set(['running', 'blocked', 'completed']),
  blocked: new Set(['running']),
  completed: new Set()
});
const SHA256 = /^[a-f0-9]{64}$/;

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function timestamp(clock) {
  const value = clock();
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new TypeError('clock must return an ISO timestamp');
  }
  return value;
}

function signalRecord(missionId, signal, at) {
  return Object.freeze({
    missionId,
    type: signal.type,
    agent: requiredText(signal.agent, 'signal agent'),
    at,
    ...(signal.detail ? { detail: requiredText(signal.detail, 'signal detail') } : {}),
    ...(signal.proof ? { proof: Object.freeze({ ...signal.proof }) } : {}),
    ...(signal.evidence ? { evidence: Object.freeze({ ...signal.evidence }) } : {}),
    ...(signal.result ? { result: Object.freeze({ ...signal.result }) } : {})
  });
}

export function createMission({ id, intent, clock = () => new Date().toISOString() }) {
  const missionId = requiredText(id, 'mission id');
  const createdAt = timestamp(clock);
  const accepted = signalRecord(missionId, { type: 'accepted', agent: 'titan', detail: 'mission accepted by Titan' }, createdAt);
  return Object.freeze({
    id: missionId,
    intent: requiredText(intent, 'mission intent'),
    status: 'accepted',
    coms: 'CLAIM',
    createdAt,
    updatedAt: createdAt,
    signals: Object.freeze([accepted])
  });
}

export function transitionMission(mission, signal, { clock = () => new Date().toISOString() } = {}) {
  if (!mission || !TRANSITIONS[mission.status]) throw new TypeError('mission has an invalid state');
  if (!signal || !SIGNAL_TYPES.has(signal.type)) throw new TypeError('unknown signal type');
  if (!TRANSITIONS[mission.status].has(signal.type)) {
    throw new Error(`illegal mission transition: ${mission.status} -> ${signal.type}`);
  }
  if (signal.type === 'completed') {
    const proof = signal.proof;
    if (!proof || proof.verified !== true || !requiredText(proof.path, 'proof path') || !SHA256.test(proof.sha256)) {
      throw new Error('mission completion requires a verified proof with a SHA-256 hash');
    }
  }
  const updatedAt = timestamp(clock);
  const record = signalRecord(mission.id, signal, updatedAt);
  return Object.freeze({
    ...mission,
    status: signal.type,
    coms: signal.type === 'completed' ? 'DONE' : signal.type === 'blocked' ? 'BLOCK' : 'PLAN',
    updatedAt,
    signals: Object.freeze([...mission.signals, record]),
    ...(signal.type === 'completed' ? {
      proof: record.proof,
      ...(record.result ? { result: record.result } : {}),
    } : {})
  });
}
