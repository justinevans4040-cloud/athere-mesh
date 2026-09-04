import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertRetrievalDoesNotOverrideCurrentState,
  rankMemoryCandidates,
  retrieveStateAwareMemory,
} from '../../packages/memory/src/state-aware-retrieval.js';
import { projectMissionMemory } from '../../packages/memory/src/typed-memory.js';

function missionWithSupersededIp() {
  return {
    id: 'mission-ret-1',
    status: 'running',
    objective: 'keep current SERVER_IP authoritative',
    createdAt: '2026-09-04T18:00:00.000Z',
    updatedAt: '2026-09-04T18:05:00.000Z',
    goals: [{ id: 'goal-net', objective: 'network truth' }],
    pendingWork: ['verify'],
    completedWork: ['inspect'],
    failedWork: [],
    activeAgents: ['nyx'],
    environmentObservations: [],
    evidence: [],
    authoritativeFacts: [
      { id: 'fact-old', key: 'SERVER_IP', value: '10.0.0.1', status: 'superseded', supersededBy: 'fact-new' },
      { id: 'fact-new', key: 'SERVER_IP', value: '10.0.0.2', status: 'current', supersedes: 'fact-old' },
    ],
    currentPlan: { id: 'plan-1', version: 1, steps: ['inspect', 'verify'] },
    workflowGraph: { nodes: [{ id: 'inspect' }, { id: 'verify' }], edges: [] },
    artifactReferences: [],
    executionTrace: [],
    signals: [],
    transitionHistory: [{
      transitionId: 't1',
      stateVersion: 1,
      actor: 'titan',
      action: 'create',
      timestamp: '2026-09-04T18:00:00.000Z',
      transitionResult: 'committed',
    }],
  };
}

test('Item 15 contract: superseded but similar semantic memory cannot override current', () => {
  const mission = missionWithSupersededIp();
  const projected = projectMissionMemory(mission, { reader: 'orchestrator' });
  const result = retrieveStateAwareMemory({
    mission,
    projected,
    reader: 'orchestrator',
    query: {
      key: 'SERVER_IP',
      text: 'SERVER_IP address for the mesh host',
      goalId: 'goal-net',
    },
  });

  assert.equal(result.selected.memoryType, 'semantic');
  assert.equal(result.selected.validationState, 'current');
  assert.equal(result.selected.content.id, 'fact-new');
  assert.equal(result.selected.mayOverrideCurrent, false);
  assert.ok(result.candidates.some((entry) => entry.content.id === 'fact-old'));
  const old = result.candidates.find((entry) => entry.content.id === 'fact-old');
  assert.equal(old.validationState, 'superseded');
  assert.equal(old.mayOverrideCurrent, false);
  assert.ok(old.score < result.selected.score);
  assertRetrievalDoesNotOverrideCurrentState(result, mission);
});

test('Item 15 contract: similarity-only ranking without state factors is rejected', () => {
  assert.throws(
    () => rankMemoryCandidates({
      entries: [],
      mission: missionWithSupersededIp(),
      query: { text: 'anything' },
      mode: 'similarity_only',
    }),
    /semantic similarity alone is insufficient/,
  );
});

test('Item 15 contract: unauthorized reader fails closed', () => {
  const mission = missionWithSupersededIp();
  const projected = projectMissionMemory(mission, { reader: 'auditor' });
  assert.throws(
    () => retrieveStateAwareMemory({
      mission,
      projected,
      reader: 'nyx',
      query: { key: 'SERVER_IP' },
    }),
    /unauthorized memory reader/,
  );
});
