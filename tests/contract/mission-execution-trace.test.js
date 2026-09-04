import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRACE_KINDS,
  TRACE_SCHEMA_VERSION,
  appendTraceEvents,
  buildExecutionTrace,
  createTraceEvent,
  eventsFromTransition,
  reconstructFailedMission,
} from '../../packages/mission/src/mission-execution-trace.js';

test('Item 13 contract: trace kinds cover the backlog capture set', () => {
  for (const kind of [
    'state_change',
    'agent',
    'model',
    'input_contract',
    'tool_call',
    'verifier_decision',
    'evidence',
    'latency',
    'token_usage',
    'cost',
    'retry',
    'failure',
    'rollback',
  ]) {
    assert.ok(TRACE_KINDS.includes(kind), `missing kind ${kind}`);
  }
  assert.equal(TRACE_SCHEMA_VERSION, 1);
});

test('Item 13 contract: eventsFromTransition derives state/agent/failure from a blocked lineage', () => {
  const events = eventsFromTransition({
    transitionId: 'mission-1-transition-3',
    stateVersion: 3,
    actor: 'qra_recovery_driver',
    action: 'block_interrupted_mission',
    timestamp: '2026-09-04T12:00:00.000Z',
    input: {
      envelope: {
        agent_id: 'qra_recovery_driver',
        allowed_actions: ['block_interrupted_mission'],
        objective: 'block after tool failure',
      },
      signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'node test execution failed' },
      update: { failedWork: ['run-node-tests'] },
    },
    output: { status: 'blocked', changedFields: ['status', 'failedWork'] },
    evidence: null,
    changes: {
      status: { before: 'running', after: 'blocked' },
      failedWork: { before: [], after: ['run-node-tests'] },
    },
  });
  const kinds = events.map((event) => event.kind);
  assert.ok(kinds.includes('state_change'));
  assert.ok(kinds.includes('agent'));
  assert.ok(kinds.includes('input_contract'));
  assert.ok(kinds.includes('failure'));
});

test('Item 13 contract: observability bag records tool/latency/model/token/cost', () => {
  const events = eventsFromTransition({
    transitionId: 'mission-1-transition-2',
    stateVersion: 2,
    actor: 'nyx',
    action: 'observe_repository',
    timestamp: '2026-09-04T12:00:01.000Z',
    input: { signal: { type: 'running', agent: 'nyx' }, update: {} },
    output: { status: 'running', changedFields: ['evidence'] },
    evidence: { executor: 'repository-inspector' },
    changes: { evidence: { before: [], after: [{ agent: 'nyx' }] } },
  }, {
    toolCalls: [{ tool: 'repository-inspector', agentId: 'nyx', ok: true }],
    latencyMs: 42,
    models: [{ provider: 'local', model: 'none' }],
    tokenUsage: 0,
    costUsd: 0,
  });
  const kinds = events.map((event) => event.kind);
  assert.ok(kinds.includes('tool_call'));
  assert.ok(kinds.includes('latency'));
  assert.ok(kinds.includes('model'));
  assert.ok(kinds.includes('token_usage'));
  assert.ok(kinds.includes('cost'));
  assert.ok(kinds.includes('evidence'));
});

test('Item 13 contract: reconstructFailedMission builds a machine-readable timeline', () => {
  const trace = appendTraceEvents([], [
    createTraceEvent({
      kind: 'state_change',
      at: '2026-09-04T12:00:00.000Z',
      agentId: 'nyx',
      detail: { action: 'observe_repository', status: 'running', stateVersion: 2 },
    }),
    createTraceEvent({
      kind: 'failure',
      at: '2026-09-04T12:00:05.000Z',
      agentId: 'qra_recovery_driver',
      detail: { reason: 'node test execution failed', status: 'blocked' },
    }),
  ]);
  const mission = {
    id: 'mission-fail-1',
    status: 'blocked',
    objective: 'test all of Titan',
    transitionHistory: [{ stateVersion: 1 }, { stateVersion: 2 }, { stateVersion: 3 }],
    executionTrace: trace,
  };
  const reconstruction = reconstructFailedMission(mission);
  assert.equal(reconstruction.schemaVersion, TRACE_SCHEMA_VERSION);
  assert.equal(reconstruction.missionId, 'mission-fail-1');
  assert.equal(reconstruction.status, 'blocked');
  assert.ok(reconstruction.timeline.length >= 2);
  assert.ok(reconstruction.failures.length >= 1);
  assert.equal(buildExecutionTrace(mission).missionId, 'mission-fail-1');
});

test('Item 13 contract: reconstruct fails closed without durable history', () => {
  assert.throws(
    () => reconstructFailedMission({ id: 'mission-empty', status: 'blocked', executionTrace: [], transitionHistory: [] }),
    /cannot reconstruct/,
  );
});

test('Item 13 security: spoofed tool_call agentId is rejected', () => {
  assert.throws(
    () => eventsFromTransition({
      transitionId: 'mission-1-transition-2',
      stateVersion: 2,
      actor: 'nyx',
      action: 'observe_repository',
      timestamp: '2026-09-04T12:00:01.000Z',
      input: { signal: { type: 'running', agent: 'nyx' }, update: {} },
      output: { status: 'running', changedFields: ['evidence'] },
      changes: {},
    }, {
      toolCalls: [{ tool: 'node-test-runner', agentId: 'qra_emerge_audit', ok: true }],
      latencyMs: 1,
      models: [],
      tokenUsage: 0,
      costUsd: 0,
    }),
    /tool_call agentId must match authorized actor/,
  );
});

test('Item 13 security: unbounded observability bags are rejected', () => {
  const lineage = {
    transitionId: 'mission-1-transition-2',
    stateVersion: 2,
    actor: 'nyx',
    action: 'observe_repository',
    timestamp: '2026-09-04T12:00:01.000Z',
    input: { signal: { type: 'running', agent: 'nyx' }, update: {} },
    output: { status: 'running', changedFields: [] },
    changes: {},
  };
  assert.throws(
    () => eventsFromTransition(lineage, {
      toolCalls: Array.from({ length: 9 }, (_, i) => ({ tool: `t${i}`, agentId: 'nyx', ok: true })),
    }),
    /observability toolCalls exceed cap/,
  );
  assert.throws(
    () => eventsFromTransition(lineage, {
      models: Array.from({ length: 9 }, (_, i) => ({ provider: 'x', model: `m${i}` })),
    }),
    /observability models exceed cap/,
  );
  assert.throws(
    () => eventsFromTransition(lineage, {
      toolCalls: [{ tool: 'x', agentId: 'nyx', ok: true, dump: 'a'.repeat(20_000) }],
    }),
    /observability payload exceeds size cap/,
  );
});
