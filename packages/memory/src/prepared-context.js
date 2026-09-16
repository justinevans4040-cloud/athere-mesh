import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PREPARED_CONTEXT_SCHEMA_VERSION = 'athere-prepared-context/v1';

const HANDLE_PATTERN = /^ctx_[a-f0-9]{32}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TOKEN_ESTIMATOR = 'canonical_utf8_bytes_div_4_ceil';

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function positiveSafeInteger(value, label, fallback = null) {
  const resolved = value === undefined || value === null ? fallback : value;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return resolved;
}

function canonicalize(value) {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError('prepared-context values must be JSON-serializable');
  }
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (typeof value === 'object') {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      normalized[key] = canonicalize(value[key]);
    }
    return normalized;
  }
  throw new TypeError('prepared-context values must be JSON-serializable');
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function canonicalClone(value) {
  return JSON.parse(canonicalJson(value));
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function validateService(service) {
  if (!plainObject(service)) throw new TypeError('mission service is required');
  for (const method of ['retrieveMemory', 'select', 'verifyHistory']) {
    if (typeof service[method] !== 'function') {
      throw new TypeError(`mission service ${method}() is required`);
    }
  }
}

function validateResolverService(service) {
  if (!plainObject(service) || typeof service.verifyHistory !== 'function') {
    throw new TypeError('mission service verifyHistory() is required');
  }
}

function validateVerifiedHistory(history, missionId) {
  if (!plainObject(history)
    || history.valid !== true
    || history.integrityBound !== true
    || history.missionId !== missionId
    || !Number.isSafeInteger(history.stateVersion)
    || history.stateVersion < 0
    || typeof history.stateHash !== 'string'
    || !SHA256_PATTERN.test(history.stateHash)) {
    throw new Error('verified integrity-bound mission history is required');
  }
  return history;
}

function assertStableRevision(before, selectedState, after, missionId) {
  if (before.missionId !== missionId
    || after.missionId !== missionId
    || before.stateVersion !== after.stateVersion
    || before.stateHash !== after.stateHash
    || !plainObject(selectedState)
    || selectedState.missionId !== missionId
    || selectedState.stateVersion !== after.stateVersion) {
    throw new Error('mission state version changed during prepared-context build');
  }
}

function orderedRetrievalCandidates(retrieval) {
  if (!plainObject(retrieval) || retrieval.mode !== 'state_aware') {
    throw new Error('state-aware retrieval result is required');
  }
  if (!plainObject(retrieval.selected) || typeof retrieval.selected.id !== 'string') {
    throw new Error('state-aware retrieval did not select context');
  }
  const ordered = [retrieval.selected, ...(Array.isArray(retrieval.candidates) ? retrieval.candidates : [])];
  const seen = new Set();
  const result = [];
  for (const candidate of ordered) {
    if (!plainObject(candidate) || typeof candidate.id !== 'string' || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    result.push(candidate);
  }
  return result;
}

function safeFactIndex(currentFacts) {
  const byId = new Map();
  for (const fact of Array.isArray(currentFacts) ? currentFacts : []) {
    if (!plainObject(fact) || fact.status !== 'current' || typeof fact.id !== 'string') continue;
    byId.set(fact.id, fact);
  }
  return byId;
}

function semanticContent(candidate, factsById) {
  const content = canonicalClone(plainObject(candidate.content) ? candidate.content : {});
  delete content.value;

  const status = content.status ?? candidate.validationState ?? null;
  const factId = content.id ?? candidate.provenance?.factId ?? null;
  const key = content.key ?? candidate.provenance?.key ?? null;
  const safeFact = typeof factId === 'string' ? factsById.get(factId) : null;
  const matchesKey = safeFact && (key === null || key === undefined || safeFact.key === key);

  if (status === 'current' && safeFact && safeFact.status === 'current' && matchesKey) {
    content.value = canonicalClone(safeFact.value);
    content.valueRedacted = false;
  } else {
    content.valueRedacted = true;
  }
  return content;
}

function compactCandidate(candidate, factsById) {
  const projection = {
    id: requiredText(candidate.id, 'memory candidate id'),
    memoryType: requiredText(candidate.memoryType, 'memory candidate type'),
    validationState: candidate.validationState ?? null,
    confidence: Number.isFinite(candidate.confidence) ? candidate.confidence : 0,
    score: Number.isFinite(candidate.score) ? candidate.score : 0,
    scoreReasons: Array.isArray(candidate.scoreReasons) ? canonicalClone(candidate.scoreReasons) : [],
    provenance: canonicalClone(plainObject(candidate.provenance) ? candidate.provenance : {}),
    content: candidate.memoryType === 'semantic'
      ? semanticContent(candidate, factsById)
      : canonicalClone(candidate.content ?? null),
  };
  return canonicalClone(projection);
}

export function estimateContextTokens(value) {
  const canonical = canonicalJson(value);
  return Math.ceil(Buffer.byteLength(canonical, 'utf8') / 4);
}

function compactToBudget(projected, maxEstimatedTokens) {
  if (projected.length === 0) throw new Error('state-aware retrieval did not select context');
  const sourceContext = { entries: projected };
  const sourceEstimatedTokens = estimateContextTokens(sourceContext);
  const kept = [];

  for (const [index, candidate] of projected.entries()) {
    const proposed = { entries: [...kept, candidate] };
    const proposedTokens = estimateContextTokens(proposed);
    if (proposedTokens <= maxEstimatedTokens) {
      kept.push(candidate);
      continue;
    }
    if (index === 0) {
      throw new Error('selected context exceeds prepared-context token budget');
    }
  }

  const context = canonicalClone({ entries: kept });
  const preparedEstimatedTokens = estimateContextTokens(context);
  return {
    context,
    sourceEstimatedTokens,
    preparedEstimatedTokens,
  };
}

function packagePayload({
  missionId,
  reader,
  query,
  limit,
  maxEstimatedTokens,
  stateVersion,
  stateHash,
  context,
  sourceCandidateCount,
  sourceEstimatedTokens,
  preparedEstimatedTokens,
}) {
  const selectedCount = context.entries.length;
  const compactionRatio = Number((sourceEstimatedTokens / preparedEstimatedTokens).toFixed(6));
  return canonicalClone({
    schemaVersion: PREPARED_CONTEXT_SCHEMA_VERSION,
    mission: {
      id: missionId,
      stateVersion,
      stateHash,
    },
    reader,
    query,
    policy: {
      retrieval: 'state_aware',
      maxEntries: limit,
      maxEstimatedTokens,
      tokenEstimator: TOKEN_ESTIMATOR,
    },
    context,
    stats: {
      sourceCandidateCount,
      selectedCount,
      omittedCount: sourceCandidateCount - selectedCount,
      sourceEstimatedTokens,
      preparedEstimatedTokens,
      compactionRatio,
    },
  });
}

export async function prepareContextPackage({
  service,
  missionId,
  reader,
  query = {},
  limit = 8,
  maxEstimatedTokens = 4096,
} = {}) {
  validateService(service);
  const mission = requiredText(missionId, 'missionId');
  const memoryReader = requiredText(reader, 'reader');
  const retrievalLimit = positiveSafeInteger(limit, 'limit', 8);
  const tokenBudget = positiveSafeInteger(maxEstimatedTokens, 'maxEstimatedTokens', 4096);
  const queryClone = canonicalClone(query ?? {});

  const historyBefore = validateVerifiedHistory(await service.verifyHistory({ missionId: mission }), mission);
  const retrieval = await service.retrieveMemory({
    missionId: mission,
    reader: memoryReader,
    query: queryClone,
    limit: retrievalLimit,
  });
  if (!plainObject(retrieval) || retrieval.missionId !== mission) {
    throw new Error('state-aware retrieval mission mismatch');
  }

  const selectedState = await service.select({ missionId: mission, fields: ['currentFacts'] });
  const historyAfter = validateVerifiedHistory(await service.verifyHistory({ missionId: mission }), mission);
  assertStableRevision(historyBefore, selectedState, historyAfter, mission);

  const candidates = orderedRetrievalCandidates(retrieval);
  const factsById = safeFactIndex(selectedState.currentFacts);
  const projected = candidates.map((candidate) => compactCandidate(candidate, factsById));
  const { context, sourceEstimatedTokens, preparedEstimatedTokens } = compactToBudget(projected, tokenBudget);

  const payload = packagePayload({
    missionId: mission,
    reader: memoryReader,
    query: canonicalClone(retrieval.query ?? queryClone),
    limit: retrievalLimit,
    maxEstimatedTokens: tokenBudget,
    stateVersion: historyAfter.stateVersion,
    stateHash: historyAfter.stateHash,
    context,
    sourceCandidateCount: projected.length,
    sourceEstimatedTokens,
    preparedEstimatedTokens,
  });
  const canonical = canonicalJson(payload);
  const digest = sha256(canonical);
  const prepared = canonicalClone({
    ...payload,
    handle: `ctx_${digest.slice(0, 32)}`,
    integrity: {
      algorithm: 'sha256',
      sha256: digest,
      canonicalSize: Buffer.byteLength(canonical, 'utf8'),
    },
  });
  verifyPreparedContextPackage(prepared);
  return deepFreeze(prepared);
}

export function verifyPreparedContextPackage(contextPackage) {
  if (!plainObject(contextPackage)) throw new TypeError('prepared-context package must be an object');
  if (contextPackage.schemaVersion !== PREPARED_CONTEXT_SCHEMA_VERSION) {
    throw new Error('prepared-context schema mismatch');
  }
  if (typeof contextPackage.handle !== 'string' || !HANDLE_PATTERN.test(contextPackage.handle)) {
    throw new Error('invalid prepared-context handle');
  }
  if (!plainObject(contextPackage.integrity)
    || contextPackage.integrity.algorithm !== 'sha256'
    || typeof contextPackage.integrity.sha256 !== 'string'
    || !SHA256_PATTERN.test(contextPackage.integrity.sha256)
    || !Number.isSafeInteger(contextPackage.integrity.canonicalSize)
    || contextPackage.integrity.canonicalSize < 0) {
    throw new Error('prepared-context integrity mismatch');
  }

  const { handle, integrity, ...payload } = contextPackage;
  const canonical = canonicalJson(payload);
  const digest = sha256(canonical);
  const expectedHandle = `ctx_${digest.slice(0, 32)}`;
  const canonicalSize = Buffer.byteLength(canonical, 'utf8');
  if (digest !== integrity.sha256
    || handle !== expectedHandle
    || canonicalSize !== integrity.canonicalSize) {
    throw new Error('prepared-context integrity mismatch');
  }
  return true;
}

function validateHandle(handle) {
  if (typeof handle !== 'string' || !HANDLE_PATTERN.test(handle)) {
    throw new Error('invalid prepared-context handle');
  }
  return handle;
}

function storagePaths(root, handle) {
  const rootPath = requiredText(root, 'prepared-context root');
  const validatedHandle = validateHandle(handle);
  const contextsDir = path.resolve(rootPath, 'contexts');
  const finalPath = path.resolve(contextsDir, `${validatedHandle}.json`);
  if (path.dirname(finalPath) !== contextsDir) throw new Error('prepared-context path escaped contexts root');
  return {
    contextsDir,
    finalPath,
    relativePath: `contexts/${validatedHandle}.json`,
  };
}

export async function writePreparedContext({ root, contextPackage } = {}) {
  verifyPreparedContextPackage(contextPackage);
  const { contextsDir, finalPath, relativePath } = storagePaths(root, contextPackage.handle);
  await mkdir(contextsDir, { recursive: true });
  const serialized = `${canonicalJson(contextPackage)}\n`;
  const tempPath = path.join(contextsDir, `.${contextPackage.handle}.${randomUUID()}.tmp`);
  let duplicate = false;
  let primaryError = null;

  try {
    await writeFile(tempPath, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    try {
      await link(tempPath, finalPath);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await readFile(finalPath, 'utf8');
      if (existing !== serialized) {
        throw new Error(`prepared-context idempotency conflict: ${contextPackage.handle}`);
      }
      duplicate = true;
    }
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await rm(tempPath, { force: true });
    } catch (cleanupError) {
      if (primaryError) {
        throw new AggregateError([primaryError, cleanupError], 'prepared-context write and cleanup both failed');
      }
      throw cleanupError;
    }
  }

  return deepFreeze({
    handle: contextPackage.handle,
    path: relativePath,
    integritySha256: contextPackage.integrity.sha256,
    integrityVerified: true,
    ...(duplicate ? { duplicate: true } : {}),
  });
}

export async function readPreparedContext({ root, handle } = {}) {
  const validatedHandle = validateHandle(handle);
  const { finalPath } = storagePaths(root, validatedHandle);
  const raw = await readFile(finalPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`prepared-context stored JSON is invalid: ${error.message}`);
  }
  verifyPreparedContextPackage(parsed);
  if (parsed.handle !== validatedHandle) {
    throw new Error('prepared-context handle does not match requested handle');
  }
  return deepFreeze(canonicalClone(parsed));
}

export async function resolvePreparedContext({ root, handle, service, reader } = {}) {
  validateResolverService(service);
  const requestedReader = requiredText(reader, 'reader');
  const prepared = await readPreparedContext({ root, handle });
  if (prepared.reader !== requestedReader) {
    throw new Error('prepared-context reader mismatch');
  }
  const history = validateVerifiedHistory(
    await service.verifyHistory({ missionId: prepared.mission.id }),
    prepared.mission.id,
  );
  if (history.stateVersion !== prepared.mission.stateVersion
    || history.stateHash !== prepared.mission.stateHash) {
    throw new Error('prepared-context is stale for current mission state');
  }
  return prepared;
}
