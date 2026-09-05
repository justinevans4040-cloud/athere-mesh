import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMissionOrchestrator } from '../../packages/orchestrator/src/mission-orchestrator.js';
import { planCommand } from '../../packages/command/src/command-planner.js';

function stubTestExecutor() {
  return {
    async inspect() {
      return { package: { name: 'athere-titan', version: '0.1.0' }, sourceFilesOnDisk: 1, testFilesOnDisk: 1 };
    },
    async runTests() {
      return {
        command: 'noop', exitCode: 0, tests: 0, passed: 0, failed: 0, skipped: 0, stdout: '', stderr: '',
      };
    },
  };
}

test('owner build language plans a titan build action', () => {
  assert.deepEqual(planCommand({ profile: 'owner', text: 'Build Titan now' }), {
    status: 'ready',
    action: { kind: 'build', target: 'titan' },
    authority: { decision: 'allow', reason: 'routine scoped owner operation' },
  });
});

test('owner build mission completes with proof (not blocked)', async () => {
  const repo = await mkdtemp(path.join(tmpdir(), 'athere-build-'));
  const root = path.join(repo, 'run');
  await mkdir(path.join(repo, 'packages', 'example', 'src'), { recursive: true });
  await mkdir(path.join(repo, 'scripts'), { recursive: true });
  await mkdir(path.join(repo, 'tests'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({ name: 'athere-titan', version: '0.1.0' }));
  await writeFile(path.join(repo, 'packages', 'example', 'src', 'ok.js'), 'export const x = 1;\n');
  await writeFile(path.join(repo, 'scripts', 'ok.js'), 'console.log(1);\n');

  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: repo,
    executor: stubTestExecutor(),
  });
  const result = await orchestrator.execute({ profile: 'owner', text: 'Build Titan now' });
  assert.equal(result.mission?.status ?? result.status, 'completed');
  assert.equal(result.build?.exitCode, 0);
  assert.ok(result.build?.checkedCount >= 1);
  assert.ok(result.mission.result?.proofSha256);
});
