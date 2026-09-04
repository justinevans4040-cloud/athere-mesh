/**
 * Item 15 — state-aware memory retrieval over Item 14 projections.
 * Semantic similarity alone is insufficient; current verified state wins.
 */

import {
  MEMORY_TYPES,
  assertMemoryReader,
  authorizeMemoryRead,
  projectMissionMemory,
} from './typed-memory.js';

export const RETRIEVAL_MAX_RESULTS = 32;

const QUERY_KEYS = new Set([
  'key',
  'text',
  'goalId',
  'types',
  'missionId',
  'preferCurrent',
]);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeQuery(query) {
  if (!plainObject(query)) throw new TypeError('retrieval query must be an object');
  for (const key of Object.keys(query)) {
    if (!QUERY_KEYS.has(key)) throw new Error(`unsupported retrieval query field: ${key}`);
  }
  const normalized = {};
  if (query.key !== undefined) normalized.key = requiredText(query.key, 'query.key');
  if (query.text !== undefined) normalized.text = requiredText(query.text, 'query.text');
  if (query.goalId !== undefined) normalized.goalId = requiredText(query.goalId, 'query.goalId');
  if (query.missionId !== undefined) normalized.missionId = requiredText(query.missionId, 'query.missionId');
  if (query.types !== undefined) {
    const types = Array.isArray(query.types) ? query.types : [query.types];
    normalized.types = Object.freeze(types.map((type) => {
      if (!MEMORY_TYPES.includes(type)) throw new Error(`unknown memory type: ${type}`);
      return type;
    }));
  }
  normalized.preferCurrent = query.preferCurrent !== false;
  if (!normalized.key && !normalized.text && !normalized.goalId) {
    throw new Error('retrieval query requires key, text, or goalId');
  }
  return Object.freeze(normalized);
}

function textOverlapScore(haystack, needle) {
  if (typeof haystack !== 'string' || typeof needle !== 'string') return 0;
  const left = haystack.toLowerCase();
  const right = needle.toLowerCase();
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.6;
  const tokens = right.split(/[^a-z0-9_]+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((token) => left.includes(token)).length;
  return hits / tokens.length * 0.4;
}

function entryHaystack(entry) {
  const parts = [
    entry.memoryType,
    entry.validationState,
    entry.content?.key,
    entry.content?.id,
    entry.content?.objective,
    entry.content?.status,
    entry.provenance?.key,
    entry.provenance?.factId,
    entry.provenance?.source,
  ];
  return parts.filter((part) => typeof part === 'string').join(' ');
}

function isAuthoritativeCurrent(entry) {
  return entry.memoryType === 'semantic' && entry.validationState === 'current';
}

function isHistoricalSemantic(entry) {
  return entry.memoryType === 'semantic'
    && ['superseded', 'corrected', 'revoked', 'historical'].includes(entry.validationState);
}

function scoreEntry({ entry, mission, query }) {
  let score = 0;
  const reasons = [];

  // Current mission binding
  if (entry.provenance?.missionId === mission.id) {
    score += 5;
    reasons.push('current_mission');
  }
  if (query.missionId && entry.provenance?.missionId === query.missionId) {
    score += 2;
    reasons.push('query_mission');
  }

  // Current state / working context
  if (entry.memoryType === 'working') {
    score += 8;
    reasons.push('current_state');
  }

  // Goal / dependency relevance
  if (query.goalId) {
    const goalHit = JSON.stringify(mission.goals ?? []).includes(query.goalId)
      || JSON.stringify(entry.content ?? {}).includes(query.goalId);
    if (goalHit) {
      score += 3;
      reasons.push('goal');
    }
  }

  // Supersession / authority
  if (isAuthoritativeCurrent(entry)) {
    score += 20;
    reasons.push('authoritative_current');
  } else if (isHistoricalSemantic(entry)) {
    score -= 15;
    reasons.push('historical_semantic');
  } else if (entry.validationState === 'tentative') {
    score -= 5;
    reasons.push('tentative');
  }

  // Confidence
  if (Number.isFinite(entry.confidence)) {
    score += entry.confidence * 2;
    reasons.push('confidence');
  }

  // Recency
  if (typeof entry.createdAt === 'string' && !Number.isNaN(Date.parse(entry.createdAt))) {
    const ageMs = Date.parse(mission.updatedAt ?? entry.createdAt) - Date.parse(entry.createdAt);
    if (Number.isFinite(ageMs)) {
      const recency = Math.max(0, 3 - Math.min(3, ageMs / (60_000 * 60)));
      score += recency;
      reasons.push('recency');
    }
  }

  // Key relevance (structural, not embedding)
  if (query.key) {
    if (entry.content?.key === query.key || entry.provenance?.key === query.key) {
      score += 10;
      reasons.push('key_match');
    }
  }

  // Text relevance is secondary only
  if (query.text) {
    const overlap = textOverlapScore(entryHaystack(entry), query.text);
    score += overlap;
    if (overlap > 0) reasons.push('text_overlap');
  }

  // Past success hint for procedural / verified artifacts
  if (entry.memoryType === 'procedural' && String(entry.validationState).startsWith('verified')) {
    score += 4;
    reasons.push('past_success_procedural');
  }
  if (entry.memoryType === 'artifact' && entry.validationState === 'verified') {
    score += 3;
    reasons.push('past_success_artifact');
  }

  const mayOverrideCurrent = false;
  return Object.freeze({
    ...entry,
    score,
    mayOverrideCurrent,
    scoreReasons: Object.freeze(reasons),
  });
}

export function rankMemoryCandidates({ entries, mission, query, mode = 'state_aware' }) {
  if (mode === 'similarity_only') {
    throw new Error('semantic similarity alone is insufficient for memory retrieval');
  }
  if (mode !== 'state_aware') throw new Error(`unsupported retrieval mode: ${mode}`);
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
  if (!plainObject(mission) || typeof mission.id !== 'string') {
    throw new TypeError('mission is required for state-aware ranking');
  }
  const normalizedQuery = normalizeQuery(query);
  const ranked = entries.map((entry) => scoreEntry({ entry, mission, query: normalizedQuery }));
  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return String(left.id).localeCompare(String(right.id));
  });
  return Object.freeze(ranked);
}

export function assertRetrievalDoesNotOverrideCurrentState(result, mission) {
  if (!plainObject(result) || !plainObject(result.selected)) {
    throw new TypeError('retrieval result with selected entry is required');
  }
  if (result.selected.mayOverrideCurrent === true) {
    throw new Error('retrieval selected an entry that may override current verified state');
  }
  if (isHistoricalSemantic(result.selected) && result.selected.content?.key) {
    const key = result.selected.content.key;
    const hasCurrent = (mission.authoritativeFacts ?? []).some(
      (fact) => fact.key === key && fact.status === 'current',
    );
    if (hasCurrent) {
      throw new Error('old semantic memory cannot override current verified state');
    }
  }
  for (const entry of result.candidates ?? []) {
    if (entry.mayOverrideCurrent === true) {
      throw new Error('retrieval candidate marked as mayOverrideCurrent');
    }
  }
  return true;
}

export function retrieveStateAwareMemory({
  mission,
  projected = null,
  reader,
  query,
  limit = 8,
} = {}) {
  const readerId = assertMemoryReader(reader);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > RETRIEVAL_MAX_RESULTS) {
    throw new Error(`retrieval limit must be between 1 and ${RETRIEVAL_MAX_RESULTS}`);
  }
  const normalizedQuery = normalizeQuery(query);
  // Never trust caller-supplied projected entry content. Optional projected bags are
  // accepted only as a reader-binding check; ranking always re-projects from mission.
  if (projected !== null && projected !== undefined) {
    if (!plainObject(projected) || projected.reader !== readerId) {
      throw new Error('projected memory reader mismatch');
    }
  }
  const memory = projectMissionMemory(mission, {
    reader: readerId,
    ...(normalizedQuery.types ? { types: normalizedQuery.types } : {}),
  });

  const types = normalizedQuery.types ?? MEMORY_TYPES;
  const entries = [];
  for (const type of types) {
    for (const entry of memory[type] ?? []) {
      authorizeMemoryRead({ reader: readerId, entry });
      entries.push(entry);
    }
  }

  const ranked = rankMemoryCandidates({
    entries,
    mission,
    query: normalizedQuery,
    mode: 'state_aware',
  });

  // Prefer authoritative current semantic when key matches, even if text overlap favored historical.
  let selected = ranked[0] ?? null;
  if (normalizedQuery.key) {
    const current = ranked.find((entry) => (
      isAuthoritativeCurrent(entry)
      && (entry.content?.key === normalizedQuery.key || entry.provenance?.key === normalizedQuery.key)
    ));
    if (current) selected = current;
  }
  if (!selected) throw new Error('no memory candidates matched retrieval query');

  const candidates = Object.freeze(ranked.slice(0, limit));
  const result = Object.freeze({
    missionId: mission.id,
    reader: readerId,
    query: normalizedQuery,
    selected,
    candidates,
    mode: 'state_aware',
  });
  assertRetrievalDoesNotOverrideCurrentState(result, mission);
  return result;
}
