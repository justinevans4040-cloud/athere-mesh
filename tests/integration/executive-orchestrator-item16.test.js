import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMissionOrchestrator } from '../../packages/orchestrator/src/mission-orchestrator.js';

test('Item 16: orchestrator consults decideNext and changes strategy on failure', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-orch-16-'));
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    clock: () => '2026-09-05T18:00:00.000Z',
    idFactory: () => 'exec-wire-16',
    executor: {
      async inspect() {
        return { package: { name: 'athere-titan', version: '0.1.0' }, sourceFilesOnDisk: 12, testFilesOnDisk: 60 };
      },
      async runTests() {
        return {
          command: 'node --test',
          exitCode: 1,
          tests: 10,
          passed: 9,
          failed: 1,
          skipped: 0,
          stdout: 'fail',
          stderr: 'boom',
        };
      },
    },
  });

  const result = await orchestrator.execute({ profile: 'owner', text: 'test all of Titan' });
  assert.equal(result.healed, true);
  assert.equal(result.status, 'running');
  assert.equal(result.executive?.nextAction, 'change_strategy');
  assert.equal(result.executive?.agentId, 'qra_recovery_driver');
  assert.equal(result.executive?.strategyChange?.action, 'retry_from_checkpoint');
  assert.equal(result.executive?.canCertifySuccess, false);
  assert.equal(result.executive?.mutatesMission, false);
  assert.ok(result.mission.checkpoints.length >= 1);
});

test('Item 16: orchestrator escalates when blocked with no checkpoint', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-orch-16b-'));
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    clock: () => '2026-09-05T18:05:00.000Z',
    idFactory: () => 'exec-wire-16b',
    executor: {
      async inspect() {
        return { package: 'not-package-metadata', sourceFilesOnDisk: -1, testFilesOnDisk: 'many' };
      },
      async runTests() {
        throw new Error('must not run');
      },
    },
  });

  const result = await orchestrator.execute({ profile: 'owner', text: 'test all of Titan' });
  assert.equal(result.mission.status, 'blocked');
  assert.equal(result.executive?.nextAction, 'escalate_human');
  assert.equal(result.executive?.humanInterventionRequired, true);
  assert.equal(result.executive?.canCertifySuccess, false);
});
