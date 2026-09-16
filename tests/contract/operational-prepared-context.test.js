import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createModelAdapter } from '../../packages/agent/src/model-adapter.js';
import { createMissionOrchestrator } from '../../packages/orchestrator/src/mission-orchestrator.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function executorFixture() {
  return Object.freeze({
    async inspect() {
      return {
        package: { name: 'athere-titan', version: '0.1.0' },
        sourceFilesOnDisk: 42,
        testFilesOnDisk: 24,
      };
    },
    async runTests() {
      return {
        command: 'node --test',
        exitCode: 0,
        tests: 3,
        passed: 3,
        failed: 0,
        skipped: 0,
        stdout: '3 tests passed',
        stderr: '',
      };
    },
  });
}

test('operational NYX reasoning receives current Prepared Context and records the exact identity as advisory evidence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-operational-context-'));
  const advisoryContent = 'Use current mission state; deterministic executors remain authoritative.';
  let providerRequest;
  const modelAdapter = createModelAdapter({
    provider: 'local',
    model: 'nyx-operational-context-test',
    complete: async (request) => {
      providerRequest = request;
      return { content: advisoryContent };
    },
  });

  try {
    const orchestrator = createMissionOrchestrator({
      root,
      repositoryRoot,
      executor: executorFixture(),
      operationalModelAdapter: modelAdapter,
      idFactory: () => '11111111-1111-4111-8111-111111111111',
    });

    const result = await orchestrator.execute({ profile: 'owner', text: 'test all of Titan' });
    assert.equal(result.mission.status, 'completed');
    assert.ok(providerRequest, 'operational model provider was not invoked');
    assert.equal(providerRequest.agent.id, 'nyx');
    assert.equal(providerRequest.envelope.mission_id, result.mission.id);
    assert.equal(providerRequest.envelope.agent_id, 'nyx');
    assert.equal(providerRequest.envelope.capability_id, 'repository-inspector');
    assert.equal(providerRequest.envelope.state_version, providerRequest.preparedContext.stateVersion);
    assert.equal(providerRequest.preparedContext.reader, 'nyx');

    const reasoningOperationId = `${result.mission.id}-nyx-context-reasoning`;
    const reasoning = result.mission.transitionHistory.find((entry) => entry.operationId === reasoningOperationId);
    assert.ok(reasoning, 'NYX context reasoning transition was not recorded');
    assert.equal(reasoning.actor, 'miss-vale-prime');
    assert.equal(reasoning.action, 'supervise_mission');
    assert.equal(reasoning.evidence.stage, 'nyx-context-reasoning');
    assert.equal(reasoning.evidence.advisory, true);
    assert.equal(reasoning.evidence.reasoningAgent, 'nyx');
    assert.equal(reasoning.evidence.context.handle, providerRequest.preparedContext.handle);
    assert.equal(reasoning.evidence.context.integritySha256, providerRequest.preparedContext.integritySha256);
    assert.equal(reasoning.evidence.context.stateVersion, providerRequest.preparedContext.stateVersion);
    assert.equal(reasoning.evidence.context.stateHash, providerRequest.preparedContext.stateHash);
    assert.equal(reasoning.evidence.context.reader, 'nyx');
    assert.equal(
      reasoning.evidence.output.sha256,
      createHash('sha256').update(advisoryContent, 'utf8').digest('hex'),
    );
    assert.equal(reasoning.evidence.output.utf8Bytes, Buffer.byteLength(advisoryContent, 'utf8'));
    assert.equal('content' in reasoning.evidence.output, false, 'raw model content must not become mission evidence');

    const inspection = result.mission.evidence.find((entry) => entry.agent === 'nyx' && entry.executor === 'repository-inspector');
    assert.ok(inspection, 'deterministic NYX repository inspection must remain authoritative work evidence');
    assert.equal(result.mission.objective, 'test all of Titan');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('without an operational model adapter, the deterministic mission path remains unchanged and model-free', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-operational-context-off-'));
  try {
    const orchestrator = createMissionOrchestrator({
      root,
      repositoryRoot,
      executor: executorFixture(),
      idFactory: () => '22222222-2222-4222-8222-222222222222',
    });
    const result = await orchestrator.execute({ profile: 'owner', text: 'test all of Titan' });
    assert.equal(result.mission.status, 'completed');
    assert.equal(
      result.mission.transitionHistory.some((entry) => entry.operationId.endsWith('-nyx-context-reasoning')),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
