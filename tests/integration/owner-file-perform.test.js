import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMissionOrchestrator } from '../../packages/orchestrator/src/mission-orchestrator.js';

function stubTestExecutor() {
  return {
    async inspect() {
      return { package: { name: 'athere-mesh', version: '0.0.0' }, sourceFilesOnDisk: 1, testFilesOnDisk: 1 };
    },
    async runTests() {
      return {
        command: 'node --test',
        exitCode: 0,
        tests: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        stdout: '',
        stderr: '',
      };
    },
  };
}

test('owner inventory command completes with proof (not Titan self-test)', async () => {
  const repo = await mkdtemp(path.join(tmpdir(), 'athere-perform-inv-'));
  const root = path.join(repo, 'run');
  const workspace = path.join(repo, 'workspace');
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, 'memo.txt'), 'perform');
  await writeFile(path.join(workspace, 'shot.png'), 'img');

  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: repo,
    executor: stubTestExecutor(),
  });
  const result = await orchestrator.execute({
    profile: 'owner',
    text: 'Inventory my workspace folder',
  });
  assert.equal(result.mission?.status ?? result.status, 'completed');
  assert.equal(result.fileWork?.operation, 'inventory');
  assert.ok(result.fileWork.fileCount >= 2);
  assert.ok(result.mission.result?.proofSha256);
});

test('owner organize command moves files by extension with proof', async () => {
  const repo = await mkdtemp(path.join(tmpdir(), 'athere-perform-org-'));
  const root = path.join(repo, 'run');
  const workspace = path.join(repo, 'workspace');
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, 'memo.txt'), 'perform');
  await writeFile(path.join(workspace, 'shot.png'), 'img');

  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: repo,
    executor: stubTestExecutor(),
  });
  const result = await orchestrator.execute({
    profile: 'owner',
    text: 'Organize my workspace by type',
  });
  assert.equal(result.mission?.status ?? result.status, 'completed');
  assert.equal(result.fileWork?.operation, 'organize-by-type');
  assert.equal(result.fileWork.movedCount, 2);
  const names = await readdir(workspace);
  assert.ok(names.includes('txt'));
  assert.ok(names.includes('png'));
});
