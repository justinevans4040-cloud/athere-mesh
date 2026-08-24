import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const unitPath = join(repositoryRoot, 'deploy', 'systemd-user', 'athere-titan.service');

test('the Titan user service starts the functional team API from the reconstruction root', async () => {
  const unit = await readFile(unitPath, 'utf8');

  assert.match(unit, /^\[Unit\]$/m);
  assert.match(unit, /^WorkingDirectory=\/home\/the_founder\/athere-titan-reconstruction$/m);
  assert.match(unit, /^EnvironmentFile=-\/home\/the_founder\/athere-titan-reconstruction\/.env\.local$/m);
  assert.match(unit, /^ExecStart=\/usr\/bin\/node scripts\/start-agent-api\.js$/m);
  assert.match(unit, /^Restart=on-failure$/m);
  assert.match(unit, /^RestartSec=3$/m);
  assert.match(unit, /^NoNewPrivileges=true$/m);
  assert.match(unit, /^TasksMax=256$/m);
  assert.match(unit, /^MemoryMax=2G$/m);
  assert.match(unit, /^CPUQuota=200%$/m);
  assert.match(unit, /^WantedBy=default\.target$/m);
});
