/**
 * Founder authority chain for Athere Mesh.
 * Justin Evans (founder) > Vale Prime (sole Miss Vale) > The Britt 4.0 for dangerous keys.
 * QRA Sentinel makes the output-screen / blast-radius call; it does not outrank Vale/Britt.
 */

export const FOUNDER = Object.freeze({
  id: 'justin-evans',
  name: 'Justin Evans',
  title: 'founder',
});

export const AUTHORITY = Object.freeze({
  founder: FOUNDER.id,
  valePrime: 'miss-vale-prime',
  theBritt: 'the-britt',
  qraSentinel: 'qra_sentinel',
  clusterQcSentinel: 'cluster_core_qc_sentinel',
  agentValePublic: 'agent-vale',
});

/** Agents allowed to authorize dangerous / high-blast actions (besides founder). */
export const DANGEROUS_AUTHORITY_HOLDERS = Object.freeze([
  AUTHORITY.valePrime,
  AUTHORITY.theBritt,
]);

export const RISK_LEVELS = Object.freeze({
  green: 'green',
  yellow: 'yellow',
  red: 'red',
});

export const BLAST_RADIUS = Object.freeze({
  none: 'none',
  limited: 'limited',
  high: 'high',
  existential: 'existential',
});

const COMMAND_GRADE = Object.freeze([
  /rm\s+-rf\b/i,
  /\bdrop\s+table\b/i,
  /\bdrop\s+database\b/i,
  /\bdelete\s+from\b/i,
  /\btruncate\s+table\b/i,
  /\bformat\s+c:/i,
  /\bdel\s+\/f\b/i,
  /\bmkfs\b/i,
  /\bshutdown\s+-h\b/i,
]);

const POSITRONIC = Object.freeze([
  /\bmoney\s+laundering\b/i,
  /\bfraud\b/i,
  /\bfalsify\b/i,
  /\bcover\s+up\b/i,
  /\bdestroy\s+evidence\b/i,
  /\bbribe\b/i,
  /\bextort\b/i,
  /\bcircumvent\s+law\b/i,
  /\bunauthorized\s+access\b/i,
  /\bhack\s+into\b/i,
  /\bexploit\s+vulnerability\b/i,
  /\bexfiltrate\b/i,
]);

const FINANCIAL = Object.freeze([
  /\bwire\s+transfer\b/i,
  /\bsend\s+funds\b/i,
  /\binitiate\s+transfer\b/i,
]);

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

export function isDangerousAuthorityHolder(agentId) {
  return DANGEROUS_AUTHORITY_HOLDERS.includes(agentId);
}

export function isFounder(actorId) {
  return actorId === AUTHORITY.founder || actorId === 'founder';
}

/**
 * Who may authorize a dangerous action after Sentinel flags it.
 * Founder always. Vale Prime and The Britt hold the keys. Sentinel does not.
 */
export function authorizeDangerousAction({ actorId } = {}) {
  const actor = requiredText(actorId, 'actorId');
  if (isFounder(actor)) {
    return Object.freeze({
      granted: true,
      actor,
      rank: 'founder',
      reason: 'authenticated founder authority supersedes agent safeguards',
    });
  }
  if (isDangerousAuthorityHolder(actor)) {
    return Object.freeze({
      granted: true,
      actor,
      rank: actor === AUTHORITY.valePrime ? 'vale_prime' : 'the_britt',
      reason: 'dangerous-authority key holder second only to the founder',
    });
  }
  return Object.freeze({
    granted: false,
    actor,
    rank: null,
    reason: 'actor lacks dangerous-authority keys; only founder, Vale Prime, or The Britt may authorize',
  });
}

/**
 * QRA Sentinel output screen — last line of defense.
 * Screens agent OUTPUT only. Never use this on founder/operator input.
 */
export function screenAgentOutput({ output, agentId = 'unknown', founderOverride = false } = {}) {
  const text = requiredText(output, 'output');
  const agent = requiredText(agentId, 'agentId');

  for (const pattern of POSITRONIC) {
    const match = text.match(pattern);
    if (match) {
      const verdict = Object.freeze({
        safe: false,
        cleared: false,
        riskLevel: RISK_LEVELS.red,
        blastRadius: BLAST_RADIUS.existential,
        trigger: match[0],
        tier: 'positronic_hard_stop',
        feedback: '[QRA SENTINEL — OUTPUT BLOCKED] Founder-security intent in agent output.',
        agentId: agent,
        screened: 'output',
        overridden: founderOverride === true,
        requiresAuthority: Object.freeze([...DANGEROUS_AUTHORITY_HOLDERS]),
      });
      if (founderOverride === true) {
        return Object.freeze({ ...verdict, safe: true, cleared: true, feedback: 'Founder override: assessed, logged, not suppressed.' });
      }
      return verdict;
    }
  }

  for (const pattern of COMMAND_GRADE) {
    const match = text.match(pattern);
    if (match) {
      const verdict = Object.freeze({
        safe: false,
        cleared: false,
        riskLevel: RISK_LEVELS.red,
        blastRadius: BLAST_RADIUS.high,
        trigger: match[0],
        tier: 'high_blast_radius',
        feedback: '[QRA SENTINEL — OUTPUT BLOCKED] High blast-radius command-grade syntax in agent output. Rollback required; Vale Prime or The Britt must authorize.',
        agentId: agent,
        screened: 'output',
        overridden: founderOverride === true,
        requiresAuthority: Object.freeze([...DANGEROUS_AUTHORITY_HOLDERS]),
      });
      if (founderOverride === true) {
        return Object.freeze({ ...verdict, safe: true, cleared: true, feedback: 'Founder override: assessed, logged, not suppressed.' });
      }
      return verdict;
    }
  }

  for (const pattern of FINANCIAL) {
    const match = text.match(pattern);
    if (match) {
      const verdict = Object.freeze({
        safe: false,
        cleared: false,
        riskLevel: RISK_LEVELS.yellow,
        blastRadius: BLAST_RADIUS.limited,
        trigger: match[0],
        tier: 'moderate_financial',
        feedback: '[QRA SENTINEL — OUTPUT BLOCKED] Financial-movement instruction requires Vale Prime or The Britt review.',
        agentId: agent,
        screened: 'output',
        overridden: founderOverride === true,
        requiresAuthority: Object.freeze([...DANGEROUS_AUTHORITY_HOLDERS]),
      });
      if (founderOverride === true) {
        return Object.freeze({ ...verdict, safe: true, cleared: true, feedback: 'Founder override: assessed, logged, not suppressed.' });
      }
      return verdict;
    }
  }

  return Object.freeze({
    safe: true,
    cleared: true,
    riskLevel: RISK_LEVELS.green,
    blastRadius: BLAST_RADIUS.none,
    trigger: null,
    tier: 'cleared',
    feedback: 'Cleared. Positronic scan passed. Proceed.',
    agentId: agent,
    screened: 'output',
    overridden: false,
    requiresAuthority: Object.freeze([]),
  });
}
