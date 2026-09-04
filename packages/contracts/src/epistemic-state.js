/**
 * Item 17 — explicit epistemic uncertainty / confidence state.
 * unknown (do not know) is not verified_false and not verified_true.
 */

export const EPISTEMIC_POLARITIES = Object.freeze([
  'unknown',
  'verified_true',
  'verified_false',
]);

export const EPISTEMIC_MAX_CLAIMS = 64;
export const EPISTEMIC_MAX_EVIDENCE_REFS = 16;

const POLARITY_SET = new Set(EPISTEMIC_POLARITIES);

const KIND_BY_POLARITY = Object.freeze({
  unknown: 'do_not_know',
  verified_true: 'verified_true',
  verified_false: 'verified_false',
});

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requiredId(value, label) {
  const id = requiredText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) throw new TypeError(`${label} is invalid`);
  return id;
}

export function assertEpistemicPolaritiesDistinct() {
  const kinds = EPISTEMIC_POLARITIES.map((polarity) => KIND_BY_POLARITY[polarity]);
  if (new Set(kinds).size !== kinds.length) {
    throw new Error('epistemic polarities must map to distinct kinds');
  }
  if (KIND_BY_POLARITY.unknown === KIND_BY_POLARITY.verified_false) {
    throw new Error('unknown must not equal verified_false');
  }
  if (KIND_BY_POLARITY.unknown === KIND_BY_POLARITY.verified_true) {
    throw new Error('unknown must not equal verified_true');
  }
  return true;
}

export function classifyEpistemicPolarity(polarity) {
  const value = requiredText(polarity, 'epistemic polarity');
  if (!POLARITY_SET.has(value)) throw new Error(`unsupported epistemic polarity: ${value}`);
  return Object.freeze({
    polarity: value,
    kind: KIND_BY_POLARITY[value],
  });
}

export function normalizeEpistemicClaim(input) {
  if (!plainObject(input)) throw new TypeError('epistemic claim must be an object');
  const polarity = requiredText(input.polarity, 'epistemic polarity');
  if (!POLARITY_SET.has(polarity)) throw new Error(`unsupported epistemic polarity: ${polarity}`);
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new TypeError('confidence must be a number between 0 and 1');
  }
  const claim = {
    id: requiredId(input.id, 'epistemic claim id'),
    subject: requiredText(input.subject, 'epistemic subject'),
    polarity,
    kind: KIND_BY_POLARITY[polarity],
    confidence: input.confidence,
    reason: requiredText(input.reason, 'epistemic reason'),
    evidenceRefs: Object.freeze((() => {
      const refs = Array.isArray(input.evidenceRefs)
        ? input.evidenceRefs.map((ref) => requiredText(ref, 'evidence ref'))
        : [];
      if (refs.length > EPISTEMIC_MAX_EVIDENCE_REFS) {
        throw new Error(`evidenceRefs exceed cap (${EPISTEMIC_MAX_EVIDENCE_REFS})`);
      }
      return refs;
    })()),
  };
  return Object.freeze(claim);
}

export function resolveUncertaintyTriggers(claim) {
  const normalized = plainObject(claim) && claim.polarity
    ? claim
    : normalizeEpistemicClaim(claim);
  const polarity = normalized.polarity;
  if (polarity === 'unknown') {
    return Object.freeze(['collect_evidence', 'research', 'alternate_model']);
  }
  if (polarity === 'verified_false') {
    return Object.freeze(['second_verifier', 'alternate_model', 'change_strategy', 'simulation']);
  }
  if (polarity === 'verified_true') {
    return Object.freeze(['continue']);
  }
  throw new Error(`unsupported epistemic polarity: ${polarity}`);
}

export function assessEpistemicState(claims = []) {
  if (!Array.isArray(claims)) throw new TypeError('epistemicClaims must be an array');
  if (claims.length > EPISTEMIC_MAX_CLAIMS) {
    throw new Error(`epistemicClaims exceed cap (${EPISTEMIC_MAX_CLAIMS})`);
  }
  const normalized = claims.map((claim) => normalizeEpistemicClaim(claim));
  const kinds = Object.freeze({
    do_not_know: normalized.filter((claim) => claim.kind === 'do_not_know').length,
    verified_true: normalized.filter((claim) => claim.kind === 'verified_true').length,
    verified_false: normalized.filter((claim) => claim.kind === 'verified_false').length,
  });
  const triggers = Object.freeze([...new Set(normalized.flatMap((claim) => [...resolveUncertaintyTriggers(claim)]))]);
  let primaryPolarity = 'verified_true';
  if (kinds.do_not_know > 0) primaryPolarity = 'unknown';
  else if (kinds.verified_false > 0) primaryPolarity = 'verified_false';
  return Object.freeze({
    claims: Object.freeze(normalized),
    kinds,
    triggers,
    primaryPolarity,
    acceptance: Object.freeze({
      doNotKnowDistinctFromFalse: KIND_BY_POLARITY.unknown !== KIND_BY_POLARITY.verified_false,
      doNotKnowDistinctFromTrue: KIND_BY_POLARITY.unknown !== KIND_BY_POLARITY.verified_true,
    }),
  });
}
