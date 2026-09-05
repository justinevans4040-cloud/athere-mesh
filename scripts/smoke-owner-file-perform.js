#!/usr/bin/env node
/**
 * Live owner perform smoke against Desktop/athere-mesh-scratch (jailed scratch).
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMissionOrchestrator } from '../packages/orchestrator/src/mission-orchestrator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const scratch = path.join(os.homedir(), 'Desktop', 'athere-mesh-scratch');
const runRoot = path.join(repoRoot, 'workspace', `perform-smoke-${stamp}`);

await mkdir(scratch, { recursive: true });
await mkdir(runRoot, { recursive: true });
await writeFile(path.join(scratch, `note-${stamp}.txt`), 'owner perform smoke\n');
await writeFile(path.join(scratch, `shot-${stamp}.png`), 'png-bytes');

const orchestrator = createMissionOrchestrator({
  root: runRoot,
  repositoryRoot: repoRoot,
  executor: {
    async inspect() {
      return { package: { name: 'athere-mesh', version: '0.0.0' }, sourceFilesOnDisk: 1, testFilesOnDisk: 1 };
    },
    async runTests() {
      return {
        command: 'noop', exitCode: 0, tests: 0, passed: 0, failed: 0, skipped: 0, stdout: '', stderr: '',
      };
    },
  },
});

const inventory = await orchestrator.execute({
  profile: 'owner',
  text: 'Inventory my scratch folder',
});
const organize = await orchestrator.execute({
  profile: 'owner',
  text: 'Organize my scratch folder by type',
});

const evidence = {
  stamp,
  scratch,
  inventory: {
    status: inventory.mission?.status ?? inventory.status,
    fileCount: inventory.fileWork?.fileCount,
    root: inventory.fileWork?.root,
    proofSha256: inventory.mission?.result?.proofSha256,
    missionId: inventory.mission?.id,
  },
  organize: {
    status: organize.mission?.status ?? organize.status,
    movedCount: organize.fileWork?.movedCount,
    proofSha256: organize.mission?.result?.proofSha256,
    missionId: organize.mission?.id,
  },
  ok: inventory.mission?.status === 'completed'
    && organize.mission?.status === 'completed'
    && (organize.fileWork?.movedCount ?? 0) >= 1,
};

const outPath = path.join(repoRoot, 'evidence', `smoke-owner-file-perform-${stamp}.json`);
await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: evidence.ok, outPath, evidence }, null, 2));
process.exit(evidence.ok ? 0 : 1);
