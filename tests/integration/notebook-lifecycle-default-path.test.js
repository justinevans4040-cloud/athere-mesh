/**
 * Keep-mesh OS lifecycle — Vale Prime + NYX Apex Coder on every owner mission.
 * Does not replace MEA; auditor alone certifies.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMemoryResonanceBus } from '../../packages/resonance/src/resonance-bus.js';
import { createMissionOrchestrator } from '../../packages/orchestrator/src/mission-orchestrator.js';

function clock() {
  let index = 0;
  return () => {
    const n = index++;
    const mm = String(Math.floor(n / 60)).padStart(2, '0');
    const ss = String(n % 60).padStart(2, '0');
    return `2026-09-05T20:${mm}:${ss}.000Z`;
  };
}

function passingExecutor() {
  return {
    async inspect() {
      return { package: { name: 'athere-titan', version: '0.1.0' }, sourceFilesOnDisk: 12, testFilesOnDisk: 60 };
    },
    async runTests() {
      return {
        command: 'node --test', exitCode: 0, tests: 60, passed: 60, failed: 0, skipped: 0,
        stdout: 'ok', stderr: '',
      };
    },
  };
}

async function workspace() {
  return mkdtemp(path.join(tmpdir(), 'athere-notebook-lifecycle-'));
}

const LIFECYCLE_AGENTS = Object.freeze([
  'titan',
  'miss-vale-prime',
  'caretaker',
  'qra_emerge_orchestration',
  'qra_route_controller',
  'loom',
  'the-britt',
  'nyx',
  'rune',
  'the-britt',
  'echo',
  'qra_sentinel',
  'qra_emerge_audit',
]);

test('owner test mission runs Vale Prime + NYX Apex Coder lifecycle on default path', async () => {
  const root = await workspace();
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus: createMemoryResonanceBus(),
    executor: passingExecutor(),
    clock: clock(),
    idFactory: () => 'notebook-lifecycle-test-1',
  });

  const result = await orchestrator.execute({ profile: 'owner', text: 'test all of Titan' });

  assert.equal(result.mission.status, 'completed');
  assert.deepEqual(result.mission.signals.map(({ agent }) => agent), LIFECYCLE_AGENTS);
  assert.match(result.mission.signals[1].detail, /Vale Prime/);
  assert.match(result.mission.signals[4].detail, /NYX Apex Coder/);
  assert.deepEqual(result.mission.evidence.map(({ agent }) => agent), ['nyx', 'rune']);
  assert.equal(result.mission.result.auditorVerification.verified, true);
  assert.equal(result.mission.result.lifecycle?.vale, 'Vale Prime');
  assert.equal(result.mission.result.lifecycle?.apexCoder, 'nyx');
  assert.equal(result.mission.result.lifecycle.stages.includes('nyx'), true);
  assert.equal(result.mission.result.lifecycle.stages.includes('qra_route_controller'), true);
  assert.equal(result.mission.result.lifecycle.stages.includes('loom'), true);
  assert.equal(result.mission.result.lifecycle.stages.includes('echo'), true);
});

test('LOOM BLOCK aborts before NYX work (no self-certify)', async () => {
  const root = await workspace();
  const roleExecutor = {
    async caretakerFleetHealth() {
      return { decision: 'HEALTHY', healthy: true, proofSha256: 'a'.repeat(64) };
    },
    async execute() {
      return { decision: 'EXECUTED', proofSha256: 'b'.repeat(64) };
    },
    async loomClearance() {
      return { decision: 'BLOCK', reasons: ['memory_available'], proofSha256: 'c'.repeat(64) };
    },
    async echoAnalyze() {
      throw new Error('echo must not run after LOOM BLOCK');
    },
    sentinelScreen() {
      throw new Error('sentinel must not run after LOOM BLOCK');
    },
  };
  let specialistRan = false;
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus: createMemoryResonanceBus(),
    executor: {
      async inspect() {
        specialistRan = true;
        return { package: { name: 'x' }, sourceFilesOnDisk: 1, testFilesOnDisk: 1 };
      },
      async runTests() {
        specialistRan = true;
        return { command: 'x', exitCode: 0, tests: 1, passed: 1, failed: 0, skipped: 0, stdout: '', stderr: '' };
      },
    },
    roleExecutor,
    clock: clock(),
    idFactory: () => 'notebook-lifecycle-block-1',
  });

  const result = await orchestrator.execute({ profile: 'owner', text: 'test all of Titan' });
  assert.equal(specialistRan, false);
  assert.equal(result.mission.status, 'blocked');
  assert.match(String(result.reason ?? result.mission.signals.at(-1)?.detail ?? ''), /LOOM|resource|BLOCK/i);
  assert.notEqual(result.mission.status, 'completed');
});
