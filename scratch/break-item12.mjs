/**
 * Hostile break attempts for Item 12 (checkpoints / branch / quarantine / rollback / retry).
 * OPEN_COUNT must be 0.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMissionStateService } from '../packages/mission/src/mission-state-service.js';
import { createAgentOperationEnvelope } from '../packages/contracts/src/agent-operation.js';
import { MAX_BRANCHES } from '../packages/mission/src/mission-checkpoints.js';
import { healMissionFromCheckpoint } from '../packages/recovery/src/recovery-coordinator.js';

const clock = () => '2026-09-07T09:00:00.000Z';
const results = [];

function note(id, result, detail) {
  results.push({ id, result, detail: String(detail).slice(0, 220) });
}

const RECOVERY = [
  'block_interrupted_mission',
  'create_checkpoint',
  'create_branch',
  'quarantine_branch',
  'rollback_to_checkpoint',
  'retry_from_checkpoint',
];

function env(record, operationId, agentId, action) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    action,
    objective: 'break12',
    createdAt: clock(),
  });
}

async function setup(id) {
  const root = await mkdtemp(join(tmpdir(), `${id}-`));
  const svc = createMissionStateService({ root, clock });
  const created = await svc.create({
    operationId: `c-${id}`,
    id,
    objective: 'item12 break',
    goals: [{ id: 'g1', objective: 'g' }],
    subgoals: [
      { id: 'a', goalId: 'g1', objective: 'A' },
      { id: 'b', goalId: 'g1', objective: 'B' },
    ],
    dependencies: [{ prerequisite: 'a', dependent: 'b' }],
    currentPlan: { id: 'p', version: 1, steps: ['a', 'b'] },
    constraints: [],
    environmentObservations: [],
    permissions: [
      { actor: 'nyx', actions: ['observe_repository', 'record_fact'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: [...RECOVERY] },
    ],
  });
  const nyx = await svc.transition({
    operationId: 'n',
    missionId: id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: { evidence: [{ agent: 'nyx', note: 'real' }], activeAgents: ['nyx'] },
    envelope: env(created, 'n', 'nyx'),
  });
  const cert = await svc.transition({
    operationId: 'cert',
    missionId: id,
    expectedRevision: nyx.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: { completedWork: ['a'], pendingWork: ['b'], activeAgents: [] },
    envelope: env(nyx, 'cert', 'qra_emerge_audit'),
  });
  const cp = await svc.createCheckpoint({
    operationId: 'cp',
    missionId: id,
    expectedRevision: cert.revision,
    label: 'good',
    envelope: env(cert, 'cp', 'qra_recovery_driver', 'create_checkpoint'),
  });
  return { root, svc, created, cp };
}

// H12-01 forge checkpoints via transition
{
  const { svc, cp } = await setup('h1201');
  try {
    await svc.transition({
      operationId: 'forge',
      missionId: 'h1201',
      expectedRevision: cp.revision,
      signal: { type: 'running', agent: 'nyx' },
      update: { checkpoints: [{ id: 'x', verified: true }], activeAgents: ['nyx'] },
      envelope: env(cp, 'forge', 'nyx'),
    });
    note('H12_01_forge_checkpoint_transition', 'ACCEPT_BAD', 'forge allowed');
  } catch (e) {
    note('H12_01_forge_checkpoint_transition', /checkpoint|unsupported/i.test(e.message) ? 'REJECT_OK' : 'REJECT_BAD', e.message);
  }
}

// H12-07 fact poison then retry
{
  const { root, svc, cp } = await setup('h1207');
  const withFact = await svc.recordFact({
    operationId: 'gf',
    missionId: 'h1207',
    expectedRevision: cp.revision,
    actor: 'nyx',
    fact: { id: 'good', key: 'K', value: 1, status: 'current' },
    envelope: env(cp, 'gf', 'nyx', 'record_fact'),
  });
  const cp2 = await svc.createCheckpoint({
    operationId: 'cp2',
    missionId: 'h1207',
    expectedRevision: withFact.revision,
    label: 'with-fact',
    envelope: env(withFact, 'cp2', 'qra_recovery_driver', 'create_checkpoint'),
  });
  const poison = await svc.recordFact({
    operationId: 'pf',
    missionId: 'h1207',
    expectedRevision: cp2.revision,
    actor: 'nyx',
    fact: { id: 'bad', key: 'POISON', value: true, status: 'current' },
    envelope: env(cp2, 'pf', 'nyx', 'record_fact'),
  });
  const blocked = await svc.transition({
    operationId: 'blk',
    missionId: 'h1207',
    expectedRevision: poison.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'fail' },
    update: { activeAgents: [] },
    envelope: env(poison, 'blk', 'qra_recovery_driver', 'block_interrupted_mission'),
  });
  const good = cp2.mission.checkpoints.find((c) => c.label === 'with-fact');
  const retried = await svc.retryFromCheckpoint({
    operationId: 'rt',
    missionId: 'h1207',
    expectedRevision: blocked.revision,
    checkpointId: good.id,
    envelope: env(blocked, 'rt', 'qra_recovery_driver', 'retry_from_checkpoint'),
  });
  note(
    'H12_07_poison_fact_retry',
    retried.mission.authoritativeFacts.some((f) => f.id === 'good')
      && !retried.mission.authoritativeFacts.some((f) => f.id === 'bad')
      ? 'REJECT_OK'
      : 'ACCEPT_BAD',
    JSON.stringify(retried.mission.authoritativeFacts.map((f) => f.id)),
  );
}

// H12-09 branch forks state (must block first when diverged)
{
  const { svc, cp } = await setup('h1209');
  const diverged = await svc.transition({
    operationId: 'div',
    missionId: 'h1209',
    expectedRevision: cp.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: { completedWork: ['a', 'b'], pendingWork: [], activeAgents: ['nyx'] },
    envelope: env(cp, 'div', 'qra_emerge_audit'),
  });
  try {
    await svc.createBranch({
      operationId: 'br-run',
      missionId: 'h1209',
      expectedRevision: diverged.revision,
      checkpointId: cp.mission.checkpoints[0].id,
      strategy: 'alt',
      envelope: env(diverged, 'br-run', 'qra_recovery_driver', 'create_branch'),
    });
    note('H12_09a_branch_rewind_running', 'ACCEPT_BAD', 'rewind while running');
  } catch (e) {
    note('H12_09a_branch_rewind_running', /diverged running state/.test(e.message) ? 'REJECT_OK' : 'REJECT_BAD', e.message);
  }
  const blocked = await svc.transition({
    operationId: 'blk',
    missionId: 'h1209',
    expectedRevision: diverged.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'x' },
    update: { activeAgents: [] },
    envelope: env(diverged, 'blk', 'qra_recovery_driver', 'block_interrupted_mission'),
  });
  const branched = await svc.createBranch({
    operationId: 'br',
    missionId: 'h1209',
    expectedRevision: blocked.revision,
    checkpointId: cp.mission.checkpoints[0].id,
    strategy: 'alt',
    envelope: env(blocked, 'br', 'qra_recovery_driver', 'create_branch'),
  });
  note(
    'H12_09_branch_forks_state',
    JSON.stringify(branched.mission.completedWork) === JSON.stringify(['a'])
      && branched.mission.activeAgents.length === 0
      ? 'REJECT_OK'
      : 'ACCEPT_BAD',
    JSON.stringify({ completed: branched.mission.completedWork, agents: branched.mission.activeAgents }),
  );
}

// H12-10 heal from branch origin
{
  const { root, svc, cp } = await setup('h1210');
  const origin = cp.mission.checkpoints[0];
  const branched = await svc.createBranch({
    operationId: 'br',
    missionId: 'h1210',
    expectedRevision: cp.revision,
    checkpointId: origin.id,
    strategy: 'alt',
    envelope: env(cp, 'br', 'qra_recovery_driver', 'create_branch'),
  });
  const advanced = await svc.transition({
    operationId: 'adv',
    missionId: 'h1210',
    expectedRevision: branched.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: { completedWork: ['a', 'b'], pendingWork: [], activeAgents: [] },
    envelope: env(branched, 'adv', 'qra_emerge_audit'),
  });
  const late = await svc.createCheckpoint({
    operationId: 'late',
    missionId: 'h1210',
    expectedRevision: advanced.revision,
    label: 'late',
    envelope: env(advanced, 'late', 'qra_recovery_driver', 'create_checkpoint'),
  });
  const marked = await svc.transition({
    operationId: 'mark',
    missionId: 'h1210',
    expectedRevision: late.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: { completedWork: ['a'], pendingWork: [], failedWork: ['b'], activeAgents: [] },
    envelope: env(late, 'mark', 'qra_emerge_audit'),
  });
  await svc.transition({
    operationId: 'blk',
    missionId: 'h1210',
    expectedRevision: marked.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'x' },
    update: { activeAgents: [] },
    envelope: env(marked, 'blk', 'qra_recovery_driver', 'block_interrupted_mission'),
  });
  const heal = await healMissionFromCheckpoint({ root, missionId: 'h1210', clock });
  note(
    'H12_10_heal_branch_origin',
    heal.status === 'healed' && heal.checkpointId === origin.id ? 'REJECT_OK' : 'ACCEPT_BAD',
    JSON.stringify(heal),
  );
}

// H12-15 branch cap
{
  const { svc, cp } = await setup('h1215');
  let record = cp;
  const id = cp.mission.checkpoints[0].id;
  let overflow = false;
  for (let i = 0; i < MAX_BRANCHES + 1; i += 1) {
    try {
      record = await svc.createBranch({
        operationId: `br${i}`,
        missionId: 'h1215',
        expectedRevision: record.revision,
        checkpointId: id,
        strategy: `s${i}`,
        envelope: env(record, `br${i}`, 'qra_recovery_driver', 'create_branch'),
      });
    } catch (e) {
      overflow = /branches exceed cap/.test(e.message);
      break;
    }
  }
  note('H12_15_branch_cap', overflow ? 'REJECT_OK' : 'ACCEPT_BAD', `branches=${record.mission.branches?.length}`);
}

// H12-04 completed rollback reject
{
  const { root, svc, cp } = await setup('h1204');
  // Use item12 honest incomplete — just try rollback while running
  try {
    await svc.rollbackToCheckpoint({
      operationId: 'roll',
      missionId: 'h1204',
      expectedRevision: cp.revision,
      checkpointId: cp.mission.checkpoints[0].id,
      envelope: env(cp, 'roll', 'qra_recovery_driver', 'rollback_to_checkpoint'),
    });
    note('H12_04_rollback_while_running', 'ACCEPT_BAD', 'rollback allowed while running');
  } catch (e) {
    note('H12_04_rollback_while_running', /blocked mission/.test(e.message) ? 'REJECT_OK' : 'REJECT_BAD', e.message);
  }
}

// H12-A2 rollback clears active branch
{
  const { svc, cp } = await setup('h12a2');
  const branched = await svc.createBranch({
    operationId: 'br',
    missionId: 'h12a2',
    expectedRevision: cp.revision,
    checkpointId: cp.mission.checkpoints[0].id,
    strategy: 'failed-alt',
    envelope: env(cp, 'br', 'qra_recovery_driver', 'create_branch'),
  });
  const blocked = await svc.transition({
    operationId: 'blk',
    missionId: 'h12a2',
    expectedRevision: branched.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'fail' },
    update: { activeAgents: [] },
    envelope: env(branched, 'blk', 'qra_recovery_driver', 'block_interrupted_mission'),
  });
  const rolled = await svc.rollbackToCheckpoint({
    operationId: 'roll',
    missionId: 'h12a2',
    expectedRevision: blocked.revision,
    checkpointId: cp.mission.checkpoints[0].id,
    envelope: env(blocked, 'roll', 'qra_recovery_driver', 'rollback_to_checkpoint'),
  });
  note(
    'H12_A2_rollback_clears_active_branch',
    rolled.mission.activeBranchId === 'main' && rolled.mission.branches[0].status === 'quarantined'
      ? 'REJECT_OK'
      : 'ACCEPT_BAD',
    JSON.stringify({ active: rolled.mission.activeBranchId, branch: rolled.mission.branches[0]?.status }),
  );
}

console.log(JSON.stringify(results, null, 2));
const bad = results.filter((r) => ['ACCEPT_BAD', 'ACCEPT_WEAK', 'REJECT_BAD', 'BAD'].includes(r.result));
console.log('OPEN_COUNT', bad.length);
console.log('OPEN', JSON.stringify(bad, null, 2));
