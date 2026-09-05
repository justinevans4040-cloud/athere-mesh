import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorkspaceFileExecutor } from '../../packages/execution/src/workspace-file-executor.js';

test('workspace file executor inventories a target folder', async () => {
  const repo = await mkdtemp(path.join(tmpdir(), 'athere-file-work-'));
  const workspace = path.join(repo, 'workspace', 'inbox');
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, 'a.txt'), 'hello');
  await writeFile(path.join(workspace, 'b.pdf'), 'pdf');

  // Point "workspace" target at repo/workspace — inventory counts nested files.
  const executor = createWorkspaceFileExecutor({ repositoryRoot: repo });
  const result = await executor.inventory({ target: 'workspace' });
  assert.equal(result.operation, 'inventory');
  assert.equal(result.exists, true);
  assert.ok(result.fileCount >= 2);
  assert.ok(result.files.some((file) => file.path.endsWith('a.txt')));
});

test('workspace file executor organizes files by extension', async () => {
  const repo = await mkdtemp(path.join(tmpdir(), 'athere-organize-'));
  // Use workspace target with files directly under workspace/
  const workspace = path.join(repo, 'workspace');
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, 'note.txt'), 'x');
  await writeFile(path.join(workspace, 'shot.png'), 'y');

  const executor = createWorkspaceFileExecutor({ repositoryRoot: repo });
  const result = await executor.organizeByType({ target: 'workspace', dryRun: false });
  assert.equal(result.movedCount, 2);
  const names = await readdir(workspace);
  assert.ok(names.includes('txt'));
  assert.ok(names.includes('png'));
  const txtFiles = await readdir(path.join(workspace, 'txt'));
  assert.deepEqual(txtFiles, ['note.txt']);
});
