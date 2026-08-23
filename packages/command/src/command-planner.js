import { evaluateAction } from '../../contracts/src/policy.js';

function recognize(text) {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (/\bdeploy\b/.test(normalized) && /\bvale prime\b/.test(normalized) && /\bqra\b/.test(normalized) && /\bfleet\b/.test(normalized)) {
    return { kind: 'fleet_deploy', target: 'qra-and-fleet', agentId: 'miss-vale-prime' };
  }
  if (/\b(inspect|read|check|show)\b/.test(normalized) && /\b(log|logs)\b/.test(normalized) && /\b(ubuntu|ssh|server)\b/.test(normalized)) {
    return { kind: 'ssh_read', target: 'ubuntu', resource: 'logs' };
  }
  if (/\b(test|tests|testing)\b/.test(normalized) && /\btitan\b/.test(normalized)) {
    return { kind: 'test', target: 'titan', scope: /\b(all|every)\b/.test(normalized) ? 'all' : 'default' };
  }
  if (/\b(build|compile)\b/.test(normalized) && /\btitan\b/.test(normalized)) {
    return { kind: 'build', target: 'titan' };
  }
  return undefined;
}

export function planCommand({ profile, text }) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return Object.freeze({ status: 'needs_clarification', question: 'What should Titan change or run, and on which target?' });
  }
  const action = recognize(text);
  if (!action) {
    return Object.freeze({ status: 'needs_clarification', question: 'What should Titan change or run, and on which target?' });
  }
  const authority = evaluateAction(profile, action);
  const status = authority.decision === 'allow' ? 'ready' : authority.decision === 'require_approval' ? 'needs_approval' : 'denied';
  return Object.freeze({ status, action: Object.freeze(action), authority });
}
