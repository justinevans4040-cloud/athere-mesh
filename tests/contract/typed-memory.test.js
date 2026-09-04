import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MEMORY_MAX_EPISODIC,
  MEMORY_TYPES,
  assertMemoryKindsDistinct,
  authorizeMemoryWrite,
  classifyMemoryEntry,
  projectMissionMemory,
} from '../../packages/memory/src/typed-memory.js';

const baseMission = {
  id: 'mission-mem-1',
  status: 'running',
  objective: 'test all of Titan',
  createdAt: '2026-09-04T15:00:00.000Z',
  updatedAt: '2026-09-04T15:01:00.000Z',
  pendingWork: ['run-node-tests'],
  completedWork: ['inspect-repository'],
  failedWork: [],
  activeAgents: ['nyx'],
  environmentObservations: [
    { source: 'titan', key: 'repository_root', value: '/secret/path', observedAt: '2026-09-04T15:00:00.000Z' },
  ],
  evidence: [{ agent: 'nyx', note: 'inspected' }],
  authoritativeFacts: [
    { id: 'fact-1', key: 'SERVER_IP', value: '10.0.0.1', status: 'current' },
    { id: 'fact-0', key: 'SERVER_IP', value: '10.0.0.0', status: 'superseded', supersededBy: 'fact-1' },
  ],
  currentPlan: { id: 'plan-1', version: 1, steps: ['inspect-repository', 'run-node-tests'] },
  workflowGraph: { nodes: [{ id: 'inspect-repository' }], edges: [] },
  artifactReferences: [{
    id: 'mission-proof',
    artifactHash: 'a'.repeat(64),
    proofHash: 'b'.repeat(64),
    agent: 'qra_emerge_audit',
    action: 'verified_mission_proof',
    verified: true,
    verifierResult: { verifier: 'qra_emerge_audit', verified: true },
  }],
  executionTrace: [{
    kind: 'tool_call',
    at: '2026-09-04T15:00:30.000Z',
    agentId: 'nyx',
    detail: { tool: 'repository-inspector', ok: true, dump: 'a'.repeat(5000) },
  }],
  transitionHistory: [{
    transitionId: 'mission-mem-1-transition-1',
    stateVersion: 1,
    actor: 'titan',
    action: 'create',
    timestamp: '2026-09-04T15:00:00.000Z',
    input: { envelope: { agent_id: 'titan', secret: 'should-not-leak' } },
    changes: { status: { before: null, after: 'accepted' } },
  }],
};

test('Item 14 contract: six memory types are defined', () => {
  assert.deepEqual([...MEMORY_TYPES], [
    'working',
    'episodic',
    'semantic',
    'procedural',
    'artifact',
    'state_history',
  ]);
});

test('Item 14 contract: projectMissionMemory separates kinds with required metadata', () => {
  const projected = projectMissionMemory(baseMission, { reader: 'orchestrator' });

  for (const type of MEMORY_TYPES) {
    assert.ok(Array.isArray(projected[type]), `missing bucket ${type}`);
  }
  assert.ok(projected.working.length >= 1);
  assert.ok(projected.semantic.some((entry) => entry.validationState === 'current'));
  assert.ok(projected.semantic.some((entry) => entry.validationState === 'superseded'));
  assert.ok(projected.procedural.length >= 1);
  assert.ok(projected.artifact.length >= 1);
  assert.ok(projected.episodic.length >= 1);
  assert.ok(projected.state_history.length >= 1);

  for (const type of MEMORY_TYPES) {
    for (const entry of projected[type]) {
      assert.equal(entry.memoryType, type);
      assert.equal(typeof entry.id, 'string');
      assert.ok(entry.provenance);
      assert.equal(typeof entry.confidence, 'number');
      assert.equal(typeof entry.createdAt, 'string');
      assert.equal(typeof entry.validationState, 'string');
      assert.ok(entry.accessPolicy);
      assert.ok(entry.accessPolicy.read.includes('orchestrator'));
    }
  }

  const distinction = assertMemoryKindsDistinct(projected);
  assert.equal(distinction.currentState, 'working');
  assert.equal(distinction.rememberedHistory, 'episodic');
  assert.equal(distinction.learnedKnowledge, 'semantic');
  assert.equal(distinction.executableSkill, 'procedural');
});

test('Item 14 contract: classifyMemoryEntry rejects ambiguous / forged kinds', () => {
  assert.equal(classifyMemoryEntry({ memoryType: 'semantic', validationState: 'current' }).role, 'learned_knowledge');
  assert.equal(classifyMemoryEntry({ memoryType: 'working' }).role, 'current_state');
  assert.equal(classifyMemoryEntry({ memoryType: 'procedural' }).role, 'executable_skill');
  assert.equal(classifyMemoryEntry({ memoryType: 'episodic' }).role, 'remembered_history');
  assert.throws(
    () => classifyMemoryEntry({ memoryType: 'semantic', validationState: 'current', pretendWorking: true }),
    /unsupported memory field/,
  );
  assert.throws(() => classifyMemoryEntry({ memoryType: 'not-a-type' }), /unknown memory type/);
});

test('Item 14 security: reader is required and unauthorized readers fail closed', () => {
  assert.throws(() => projectMissionMemory(baseMission), /memory reader/);
  assert.throws(() => projectMissionMemory(baseMission, { reader: 'nyx' }), /unauthorized memory reader/);
  assert.throws(() => authorizeMemoryWrite({ writer: 'nyx' }), /unauthorized memory writer/);
  assert.equal(authorizeMemoryWrite({ writer: 'mission-state-service' }), true);
});

test('Item 14 security: semantic values and history envelopes are redacted', () => {
  const projected = projectMissionMemory(baseMission, { reader: 'auditor' });
  const blob = JSON.stringify(projected);
  assert.equal(blob.includes('10.0.0.1'), false);
  assert.equal(blob.includes('should-not-leak'), false);
  assert.equal(blob.includes('/secret/path'), false);
  assert.equal(blob.includes('a'.repeat(5000)), false);
  assert.equal(projected.semantic[0].content.valueRedacted, true);
  assert.equal(projected.state_history[0].content.envelopesRedacted, true);
  assert.equal(projected.working[0].content.evidenceRedacted, true);
});

test('Item 14 security: oversized episodic projection fails closed', () => {
  const huge = {
    ...baseMission,
    executionTrace: Array.from({ length: MEMORY_MAX_EPISODIC + 1 }, (_, i) => ({
      kind: 'tool_call',
      at: '2026-09-04T15:00:30.000Z',
      agentId: 'nyx',
      detail: { tool: `t${i}`, ok: true },
    })),
    signals: [],
  };
  assert.throws(
    () => projectMissionMemory(huge, { reader: 'orchestrator', types: ['episodic'] }),
    /episodic exceeds cap/,
  );
});
