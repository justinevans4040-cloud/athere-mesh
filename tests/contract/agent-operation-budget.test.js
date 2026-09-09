import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeAgentOperation,
  createAgentOperationEnvelope,
} from '../../packages/contracts/src/agent-operation.js';

test('state mutation authorization requires a positive max_state_mutations budget', () => {
  const record = {
    revision: 1,
    mission: {
      id: 'mission-budget-1',
      permissions: [{ actor: 'nyx', actions: ['observe_repository'] }],
    },
  };
  const envelope = createAgentOperationEnvelope({
    record,
    operationId: 'op-budget-1',
    agentId: 'nyx',
    objective: 'attempt mutation without mutation budget',
    createdAt: '2026-09-07T16:00:00.000Z',
    resourceBudget: { max_tool_calls: 1, max_state_mutations: 0 },
  });
  assert.throws(
    () => authorizeAgentOperation({
      envelope,
      mission: record.mission,
      expectedRevision: record.revision,
      operationId: 'op-budget-1',
      nowMs: Date.parse('2026-09-07T16:00:00.000Z'),
      requiredBudgetKey: 'max_state_mutations',
    }),
    /resource_budget\.max_state_mutations must be positive/,
  );
});
