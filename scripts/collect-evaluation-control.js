import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';

import { collectAndFreezeNodeControl } from '../packages/evaluation/src/node-control-collector.js';
import { createNodeTestExecutor } from '../packages/execution/src/node-test-executor.js';

const execFile = promisify(execFileCallback);
const root = process.cwd();
const gitOptions = { cwd: root, shell: false, windowsHide: true };
const { stdout: status } = await execFile('git', ['status', '--porcelain'], gitOptions);
if (status.trim().length > 0) throw new Error('refusing to collect a control from a dirty worktree');
const { stdout: revisionOutput } = await execFile('git', ['rev-parse', 'HEAD'], gitOptions);
const systemVersion = revisionOutput.trim();
if (!/^[a-f0-9]{40}$/.test(systemVersion)) throw new Error('git did not return a full commit revision');

const suitePath = path.join(root, 'evaluations', 'suites', 'titan-core-v2.json');
const suite = JSON.parse(await readFile(suitePath, 'utf8'));
const result = await collectAndFreezeNodeControl({
  root,
  cohortId: `${suite.id}-${systemVersion.slice(0, 12)}`,
  suite,
  systemVersion,
  repetitions: 3,
  seed: 42,
  nodeVersion: process.versions.node,
  platform: `${process.platform}-${os.arch()}`,
  executor: createNodeTestExecutor({ repositoryRoot: root }),
});

process.stdout.write(`${JSON.stringify({ path: result.path, sha256: result.sha256, trials: result.cohort.trials.length })}\n`);
