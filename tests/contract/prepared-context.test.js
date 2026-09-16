import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  estimateContextTokens,
  prepareContextPackage,
  readPreparedContext,
  verifyPreparedContextPackage,
  writePreparedContext,
} from '../../packages/memory/src/prepared-context.js';

const MISSION_ID = 'mission-context-1';
const QUERY = Object.freeze({ key: 'SERVER_IP', text: 'current server address' });

function semanticCurrent() {
  return {
    id: `${MISSION_ID}:semantic:fact-new`,
    memoryType: 'semantic',
    content: { id: 'fact-new', key: 'SERVER_IP', status: 'current', revokedAt: null, reason: null, valueRedacted: true },
    provenance: { source: 'authoritativeFacts', missionId: MISSION_ID, factId: 'fact-new', key: 'SERVER_IP' },
    confidence: 1,
    createdAt: '2026-09-16T08:00:00.000Z',
    validationState: 'current',
    accessPolicy: { read: ['orchestrator'], write: ['mission-state-service'], scope: 'mission-semantic' },
    supersedes: 'fact-old',
    supersededBy: null,
    score: 38,
    mayOverrideCurrent: false,
    scoreReasons: ['current_mission', 'authoritative_current', 'confidence', 'key_match'],
  };
}

function semanticHistorical() {
  return {
    id: `${MISSION_ID}:semantic:fact-old`,
    memoryType: 'semantic',
    content: { id: 'fact-old', key: 'SERVER_IP', status: 'superseded', revokedAt: null, reason: null, valueRedacted: true },
    provenance: { source: 'authoritativeFacts', missionId: MISSION_ID, factId: 'fact-old', key: 'SERVER_IP' },
    confidence: 0.7,
    createdAt: '2026-09-16T07:00:00.000Z',
    validationState: 'superseded',
    accessPolicy: { read: ['orchestrator'], write: ['mission-state-service'], scope: 'mission-semantic' },
    supersedes: null,
    supersededBy: 'fact-new',
    score: 2,
    mayOverrideCurrent: false,
    scoreReasons: ['current_mission', 'historical_semantic', 'confidence', 'key_match'],
  };
}

function noisyWorking() {
  return {
    id: `${MISSION_ID}:working:context`,
    memoryType: 'working',
    content: {
      objective: 'retain the current verified network state',
      status: 'running',
      completedWork: Array.from({ length: 80 }, (_, index) => `completed-${index}-${'x'.repeat(40)}`),
      pendingWork: Array.from({ length: 80 }, (_, index) => `pending-${index}-${'y'.repeat(40)}`),
      failedWork: [],
      activeAgents: ['nyx'],
      environmentObservations: [],
      evidenceCount: 0,
      evidenceRedacted: true,
    },
    provenance: { source: 'mission-state', missionId: MISSION_ID, field: 'working-context' },
    confidence: 1,
    createdAt: '2026-09-16T08:00:00.000Z',
    validationState: 'active',
    accessPolicy: { read: ['orchestrator'], write: ['mission-state-service'], scope: 'mission-working' },
    supersedes: null,
    supersededBy: null,
    score: 17,
    mayOverrideCurrent: false,
    scoreReasons: ['current_mission', 'current_state', 'confidence'],
  };
}

function serviceFixture({
  stateVersion = 7,
  stateHash = 'a'.repeat(64),
  retrieval = null,
} = {}) {
  const current = semanticCurrent();
  const historical = semanticHistorical();
  const working = noisyWorking();
  const retrievalResult = retrieval ?? {
    missionId: MISSION_ID,
    reader: 'orchestrator',
    query: { ...QUERY, preferCurrent: true },
    selected: current,
    candidates: [working, current, historical],
    mode: 'state_aware',
  };
  const safeFacts = [{ id: 'fact-new', key: 'SERVER_IP', value: '10.0.0.2', status: 'current' }];
  const calls = [];
  return {
    calls,
    safeFacts,
    retrievalResult,
    service: {
      async retrieveMemory(request) {
        calls.push(['retrieveMemory', structuredClone(request)]);
        return structuredClone(retrievalResult);
      },
      async select(request) {
        calls.push(['select', structuredClone(request)]);
        assert.deepEqual(request.fields, ['currentFacts']);
        return { missionId: MISSION_ID, stateVersion, currentFacts: structuredClone(safeFacts) };
      },
      async verifyHistory(request) {
        calls.push(['verifyHistory', structuredClone(request)]);
        return {
          valid: true,
          integrityBound: true,
          provenanceRoot: 'create',
          missionId: MISSION_ID,
          stateVersion,
          transitionCount: stateVersion,
          stateHash,
        };
      },
    },
  };
}

async function prepare(fixture, overrides = {}) {
  return prepareContextPackage({
    service: fixture.service,
    missionId: MISSION_ID,
    reader: 'orchestrator',
    query: QUERY,
    limit: 8,
    maxEstimatedTokens: 4096,
    ...overrides,
  });
}

test('prepared context is deterministic, content addressed, and bound to verified mission state', async () => {
  const fixture = serviceFixture();
  const first = await prepare(fixture);
  const second = await prepare(fixture);

  assert.match(first.handle, /^ctx_[a-f0-9]{32}$/);
  assert.equal(first.handle, second.handle);
  assert.equal(first.integrity.sha256, second.integrity.sha256);
  assert.equal(first.schemaVersion, 'athere-prepared-context/v1');
  assert.deepEqual(first.mission, { id: MISSION_ID, stateVersion: 7, stateHash: 'a'.repeat(64) });
  assert.equal(first.policy.retrieval, 'state_aware');
  assert.equal(first.policy.tokenEstimator, 'canonical_utf8_bytes_div_4_ceil');
  assert.equal(verifyPreparedContextPackage(first), true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.context.entries), true);
});

test('verified mission revision/hash changes produce a different prepared-context handle', async () => {
  const first = await prepare(serviceFixture({ stateVersion: 7, stateHash: 'a'.repeat(64) }));
  const second = await prepare(serviceFixture({ stateVersion: 8, stateHash: 'b'.repeat(64) }));

  assert.notEqual(first.handle, second.handle);
  assert.notEqual(first.integrity.sha256, second.integrity.sha256);
});

test('only current semantic memory is hydrated through the safe currentFacts read boundary', async () => {
  const fixture = serviceFixture();
  const prepared = await prepare(fixture);
  const current = prepared.context.entries.find((entry) => entry.id.endsWith(':fact-new'));
  const historical = prepared.context.entries.find((entry) => entry.id.endsWith(':fact-old'));

  assert.equal(prepared.context.entries[0].id, `${MISSION_ID}:semantic:fact-new`);
  assert.equal(current.content.value, '10.0.0.2');
  assert.equal(current.content.valueRedacted, false);
  assert.equal(historical.content.value, undefined);
  assert.equal(historical.content.valueRedacted, true);
  assert.ok(fixture.calls.some(([name]) => name === 'select'));
  assert.ok(fixture.calls.some(([name]) => name === 'verifyHistory'));
});

test('budgeted compaction keeps selected authoritative context and omits lower-priority noise', async () => {
  const fixture = serviceFixture();
  const prepared = await prepare(fixture, { maxEstimatedTokens: 240 });

  assert.equal(prepared.context.entries[0].id, `${MISSION_ID}:semantic:fact-new`);
  assert.ok(prepared.stats.omittedCount >= 1);
  assert.ok(prepared.stats.selectedCount < prepared.stats.sourceCandidateCount);
  assert.ok(prepared.stats.preparedEstimatedTokens <= 240);
  assert.ok(prepared.stats.sourceEstimatedTokens > prepared.stats.preparedEstimatedTokens);
  assert.ok(prepared.stats.compactionRatio > 1);
  assert.equal(estimateContextTokens(prepared.context), prepared.stats.preparedEstimatedTokens);
});

test('a budget too small for the selected entry fails closed instead of silently dropping it', async () => {
  await assert.rejects(
    () => prepare(serviceFixture(), { maxEstimatedTokens: 1 }),
    /selected context exceeds prepared-context token budget/,
  );
});

test('tampering with a prepared context invalidates its digest and handle binding', async () => {
  const prepared = await prepare(serviceFixture());
  const tampered = structuredClone(prepared);
  tampered.context.entries[0].content.value = '10.0.0.99';

  assert.throws(() => verifyPreparedContextPackage(tampered), /prepared-context integrity mismatch/);
});

test('unverified or revision-inconsistent mission history is rejected', async () => {
  const fixture = serviceFixture();
  fixture.service.verifyHistory = async () => ({
    valid: false,
    integrityBound: false,
    missionId: MISSION_ID,
    stateVersion: 7,
    stateHash: 'a'.repeat(64),
  });
  await assert.rejects(() => prepare(fixture), /verified integrity-bound mission history is required/);

  const inconsistent = serviceFixture();
  inconsistent.service.select = async () => ({
    missionId: MISSION_ID,
    stateVersion: 6,
    currentFacts: inconsistent.safeFacts,
  });
  await assert.rejects(() => prepare(inconsistent), /mission state version changed during prepared-context build/);
});

test('prepared-context storage is immutable, idempotent, resolvable by handle, and verifies on read', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-prepared-context-'));
  const prepared = await prepare(serviceFixture());

  const first = await writePreparedContext({ root, contextPackage: prepared });
  const second = await writePreparedContext({ root, contextPackage: prepared });
  const restored = await readPreparedContext({ root, handle: prepared.handle });

  assert.equal(first.handle, prepared.handle);
  assert.equal(first.path, `contexts/${prepared.handle}.json`);
  assert.equal(first.duplicate, undefined);
  assert.equal(second.duplicate, true);
  assert.deepEqual(restored, prepared);
  assert.equal(Object.isFrozen(restored), true);
  assert.equal(verifyPreparedContextPackage(restored), true);
});

test('stored corruption and traversal-shaped handles fail closed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-prepared-context-corrupt-'));
  const prepared = await prepare(serviceFixture());
  const ref = await writePreparedContext({ root, contextPackage: prepared });
  await writeFile(path.join(root, ref.path), `${JSON.stringify({ ...prepared, schemaVersion: 'tampered/v1' })}\n`, 'utf8');

  await assert.rejects(
    () => readPreparedContext({ root, handle: prepared.handle }),
    /prepared-context schema mismatch|prepared-context integrity mismatch/,
  );
  await assert.rejects(
    () => readPreparedContext({ root, handle: '../escape' }),
    /invalid prepared-context handle/,
  );
});

test('query and service-returned source records are not mutated by package construction', async () => {
  const fixture = serviceFixture();
  const sourceBefore = structuredClone(fixture.retrievalResult);
  const factsBefore = structuredClone(fixture.safeFacts);
  const query = { key: 'SERVER_IP', text: 'current server address' };
  const queryBefore = structuredClone(query);

  await prepareContextPackage({
    service: fixture.service,
    missionId: MISSION_ID,
    reader: 'orchestrator',
    query,
    maxEstimatedTokens: 4096,
  });

  assert.deepEqual(query, queryBefore);
  assert.deepEqual(fixture.retrievalResult, sourceBefore);
  assert.deepEqual(fixture.safeFacts, factsBefore);
});