import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createMcpAdapter } from '../../packages/interop/src/mcp-adapter.js';
import { createA2aAdapter } from '../../packages/interop/src/a2a-adapter.js';
import { createProtocolBridge } from '../../packages/interop/src/protocol-bridge.js';

function clock() {
  return '2026-09-04T20:00:00.000Z';
}

const RECOVERY_ACTIONS = [
  'block_interrupted_mission',
  'create_checkpoint',
  'create_branch',
  'quarantine_branch',
  'rollback_to_checkpoint',
  'retry_from_checkpoint',
];

function createInput(overrides = {}) {
  return {
    operationId: 'op-interop-create-1',
    id: 'mission-interop-1',
    objective: 'protocol interop mission',
    goals: [{ id: 'goal-1', objective: 'Reach the end' }],
    subgoals: [
      { id: 'inspect-repository', goalId: 'goal-1', objective: 'Inspect' },
      { id: 'run-node-tests', goalId: 'goal-1', objective: 'Test' },
      { id: 'verify-proof', goalId: 'goal-1', objective: 'Verify' },
    ],
    dependencies: [
      { prerequisite: 'inspect-repository', dependent: 'run-node-tests' },
      { prerequisite: 'run-node-tests', dependent: 'verify-proof' },
    ],
    currentPlan: { id: 'plan-1', version: 1, steps: ['inspect-repository', 'run-node-tests', 'verify-proof'] },
    constraints: ['completion requires independently verified proof'],
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'rune', actions: ['execute_node_tests'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: [...RECOVERY_ACTIONS] },
    ],
    environmentObservations: [
      { source: 'titan', key: 'repository_root', value: '/tmp/repo', observedAt: clock() },
    ],
    ...overrides,
  };
}

test('Item 19: MCP/A2A bridge does not change mission control protocol', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-item19-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());
  assert.equal(created.mission.status, 'accepted');

  const mcp = createMcpAdapter({
    callTool: async () => ({
      content: [{ type: 'text', text: 'external tool' }],
      completedWork: ['inspect-repository'],
    }),
  });
  const a2a = createA2aAdapter({
    send: async () => ({ accepted: true, status: 'completed' }),
  });
  const bridge = createProtocolBridge({ mcp, a2a });

  await assert.rejects(
    () => bridge.invokeMcpTool({ name: 'forge', arguments: {} }),
    /control field/,
  );
  await assert.rejects(
    () => bridge.sendA2a({ role: 'agent', parts: [{ type: 'text', text: 'x' }] }),
    /control field/,
  );

  const after = await service.get({ missionId: created.mission.id });
  assert.equal(after.revision, created.revision);
  assert.deepEqual(after.mission.completedWork ?? [], []);
  assert.equal(after.mission.status, 'accepted');
});

test('Item 19: remote transports fail closed; advisory observations leave state untouched', async () => {
  assert.throws(
    () => createMcpAdapter({ transport: 'remote', callTool: async () => ({ content: [] }) }),
    /allowRemote/,
  );
  assert.throws(
    () => createA2aAdapter({ transport: 'remote', send: async () => ({ accepted: true }) }),
    /allowRemote/,
  );

  const root = await mkdtemp(path.join(tmpdir(), 'athere-item19b-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({
    operationId: 'op-interop-create-2',
    id: 'mission-interop-2',
  }));
  const mcp = createMcpAdapter({
    callTool: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    readResource: async ({ uri }) => ({ contents: [{ uri, text: 'body' }] }),
  });
  const a2a = createA2aAdapter({
    send: async () => ({ accepted: true }),
    receive: async () => ({ role: 'agent', parts: [{ type: 'text', text: 'reply' }] }),
  });
  const bridge = createProtocolBridge({ mcp, a2a });

  const toolObs = await bridge.invokeMcpTool({ name: 'ping', arguments: {} });
  const resObs = await bridge.readMcpResource({ uri: 'res://x' });
  const a2aObs = await bridge.sendA2a({ role: 'user', parts: [{ type: 'text', text: 'hi' }] });
  const recvObs = await bridge.receiveA2a();

  assert.equal(toolObs.advisory, true);
  assert.equal(resObs.kind, 'resource');
  assert.equal(a2aObs.protocol, 'a2a');
  assert.equal(recvObs.result.parts[0].text, 'reply');

  const after = await service.get({ missionId: created.mission.id });
  assert.equal(after.revision, created.revision);
  assert.equal(typeof bridge.transition, 'undefined');
  assert.equal(typeof bridge.certify, 'undefined');
  assert.equal(typeof bridge.recordFact, 'undefined');
});
