import { createHash } from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SIGNAL_TYPES = new Set(['accepted', 'running', 'blocked', 'completed']);

function requireId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

function validate(signal) {
  if (!signal || typeof signal !== 'object') throw new TypeError('signal is required');
  requireId(signal.id, 'signal id');
  requireId(signal.missionId, 'mission id');
  if (!SIGNAL_TYPES.has(signal.type)) throw new Error('invalid signal type');
  requireId(signal.agent, 'signal agent');
}

function fingerprint(signal) {
  const ordered = Object.fromEntries(Object.keys(signal).sort().map((key) => [key, signal[key]]));
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

// Exported so every transport implements one signal contract rather than a
// second copy of it. The memory bus below still uses these directly.
export { requireId as requireSignalId, validate as validateSignal, fingerprint as fingerprintSignal };

export function createMemoryResonanceBus() {
  const streams = new Map();
  const identities = new Map();

  return Object.freeze({
    async publish(signal) {
      validate(signal);
      const hash = fingerprint(signal);
      const prior = identities.get(signal.id);
      if (prior) {
        if (prior.hash !== hash) throw new Error('idempotency conflict: signal id already has different content');
        return { accepted: true, duplicate: true, sequence: prior.sequence };
      }

      const stream = streams.get(signal.missionId) ?? [];
      const sequence = stream.length + 1;
      const record = Object.freeze({ ...signal, sequence });
      stream.push(record);
      streams.set(signal.missionId, stream);
      identities.set(signal.id, { hash, sequence });
      return { accepted: true, duplicate: false, sequence };
    },

    async read({ missionId }) {
      requireId(missionId, 'mission id');
      return Object.freeze([...(streams.get(missionId) ?? [])]);
    },
  });
}
