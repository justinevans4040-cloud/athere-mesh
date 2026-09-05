#!/usr/bin/env node
/**
 * Live Titan build smoke — owner NL → MEA build mission → proof.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMissionOrchestrator } from '../packages/orchestrator/src/mission-orchestrator.js';
import { createNodeTestExecutor } from '../packages/execution/src/node-test-executor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const runRoot = path.join(repoRoot, 'workspace', `titan-build-smoke-${stamp}`);
await mkdir(runRoot, { recursive: true });

const orchestrator = createMissionOrchestrator({
  root: runRoot,
  repositoryRoot: repoRoot,
  executor: createNodeTestExecutor({ repositoryRoot: repoRoot }),
});

const result = await orchestrator.execute({
  profile: 'owner',
  text: 'Build Titan now',
});

const evidence = {
  stamp,
  host: process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? 'local',
  status: result.mission?.status ?? result.status,
  missionId: result.mission?.id,
  proofSha256: result.mission?.result?.proofSha256,
  build: result.build
    ? {
      exitCode: result.build.exitCode,
      checkedCount: result.build.checkedCount,
      failedCount: result.build.failedCount,
      packageName: result.build.packageName,
      packageVersion: result.build.packageVersion,
    }
    : null,
  reason: result.reason,
  ok: result.mission?.status === 'completed' && result.build?.exitCode === 0,
};

const outPath = path.join(repoRoot, 'evidence', `smoke-owner-titan-build-${stamp}.json`);
await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ok: evidence.ok, outPath, evidence }, null, 2));
process.exit(evidence.ok ? 0 : 1);
