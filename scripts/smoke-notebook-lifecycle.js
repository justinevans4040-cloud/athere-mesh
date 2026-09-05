/**
 * Live evidence: keep-mesh OS lifecycle with Vale Prime + NYX Apex Coder.
 * Does not touch live mission workspace data beyond a temp root.
 */
import { mkdir, writeFile, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryResonanceBus } from '../packages/resonance/src/resonance-bus.js';
import { createMissionOrchestrator } from '../packages/orchestrator/src/mission-orchestrator.js';

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const outDir = path.join(process.cwd(), 'evidence');
await mkdir(outDir, { recursive: true });

const root = await mkdtemp(path.join(tmpdir(), 'athere-lifecycle-live-'));
const stub = {
  async inspect() {
    return { package: { name: 'athere-mesh', version: '0.1.0' }, sourceFilesOnDisk: 1, testFilesOnDisk: 1 };
  },
  async runTests() {
    return {
      command: 'node --test (stub)',
      exitCode: 0,
      tests: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      stdout: 'ok',
      stderr: '',
    };
  },
};

const orchestrator = createMissionOrchestrator({
  root,
  repositoryRoot: process.cwd(),
  bus: createMemoryResonanceBus(),
  executor: stub,
  idFactory: () => `lifecycle-live-${stamp}`,
});

const result = await orchestrator.execute({ profile: 'owner', text: 'test all of Titan' });
const agents = result.mission.signals.map(({ agent }) => agent);
const expected = [
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
];

const lifecycle = result.mission.result?.lifecycle ?? null;
const ok = result.mission.status === 'completed'
  && JSON.stringify(agents) === JSON.stringify(expected)
  && lifecycle?.vale === 'Vale Prime'
  && lifecycle?.apexCoder === 'nyx'
  && lifecycle?.stages?.includes('nyx')
  && lifecycle?.stages?.includes('qra_route_controller')
  && Array.isArray(result.mission.evidence)
  && result.mission.evidence.map((e) => e.agent).join(',') === 'nyx,rune';

const evidence = {
  stamp,
  claim: 'Keep mesh; add design: Vale Prime sole Miss Vale; QRA routes NYX Apex Coder; LOOM/ECHO/Sentinel gates; auditor alone completes; MEA evidence stays nyx/rune.',
  ok,
  status: result.mission.status,
  missionId: result.mission.id,
  revision: result.revision,
  agents,
  lifecycle,
  evidenceAgents: (result.mission.evidence ?? []).map((e) => e.agent),
  proofSha256: result.mission.proof?.sha256 ?? null,
  residual: 'Remote fabric still env-gated; full IN/OUT roster cut still open; NYX still executor-backed (schema on route, not full upgrade ladder).',
};

const outPath = path.join(outDir, `smoke-notebook-lifecycle-${stamp}.json`);
await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ outPath, ok, agents, lifecycle }, null, 2));
if (!ok) process.exit(1);
