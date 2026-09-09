import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMissionStateService } from '../packages/mission/src/mission-state-service.js';
import { createAgentOperationEnvelope } from '../packages/contracts/src/agent-operation.js';

const root = await mkdtemp(join(tmpdir(), 'mea-hostile-'));
const clock = () => '2026-09-05T13:00:00.000Z';
const svc = createMissionStateService({ root, clock });
const created = await svc.create({
  id: 'mea-probe-1',
  operationId: 'op-create',
  objective: 'probe',
  goals: [{ id: 'g1', objective: 'g' }],
  subgoals: [
    { id: 'inspect', goalId: 'g1', objective: 'inspect' },
    { id: 'verify', goalId: 'g1', objective: 'verify' },
  ],
  constraints: [],
  environmentObservations: [{ source: 'runtime', key: 'mea', value: true, observedAt: '2026-09-05T12:59:00.000Z' }],
  currentPlan: { id: 'p1', version: 1, steps: ['inspect', 'verify'] },
  permissions: [
    { actor: 'nyx', actions: ['observe_repository'] },
    { actor: 'rune', actions: ['execute_node_tests'] },
    { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
    { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
    {
      actor: 'qra_recovery_driver',
      actions: [
        'block_interrupted_mission',
        'create_checkpoint',
        'create_branch',
        'quarantine_branch',
        'rollback_to_checkpoint',
        'retry_from_checkpoint',
      ],
    },
    { actor: 'sales_hunter', actions: ['hunt_outbound', 'outreach_send'] },
    { actor: 'the-britt', actions: ['cohold_dangerous_authority'] },
    { actor: 'caretaker', actions: ['fleet_health_check'] },
    { actor: 'qra_sentinel', actions: ['screen_agent_output'] },
    { actor: 'cluster_core_qc_sentinel', actions: ['review_outbound_output'] },
  ],
});

const attacks = [];
async function tryAttack(name, fn) {
  try {
    const r = await fn();
    attacks.push({
      name,
      result: 'ACCEPT',
      status: r?.mission?.status,
      completedWork: r?.mission?.completedWork,
      revision: r?.revision,
    });
  } catch (e) {
    attacks.push({ name, result: 'REJECT', error: String(e.message || e).slice(0, 220) });
  }
}

await tryAttack('executor_completedWork', async () => {
  const env = createAgentOperationEnvelope({
    record: created,
    operationId: 'a1',
    agentId: 'nyx',
    objective: 'probe',
    createdAt: clock(),
  });
  return svc.transition({
    operationId: 'a1',
    missionId: 'mea-probe-1',
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'work' },
    update: {
      completedWork: ['inspect'],
      pendingWork: ['verify'],
      evidence: [{ agent: 'nyx', note: 'did it' }],
    },
    envelope: env,
  });
});

await tryAttack('auditor_no_performers_completedWork', async () => {
  const env = createAgentOperationEnvelope({
    record: created,
    operationId: 'a2',
    agentId: 'qra_emerge_audit',
    objective: 'probe',
    createdAt: clock(),
  });
  return svc.transition({
    operationId: 'a2',
    missionId: 'mea-probe-1',
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit', detail: 'cert' },
    update: { completedWork: ['inspect'], pendingWork: ['verify'] },
    envelope: env,
  });
});

await tryAttack('manager_vale_completedWork', async () => {
  const env = createAgentOperationEnvelope({
    record: created,
    operationId: 'a3',
    agentId: 'miss-vale-prime',
    objective: 'probe',
    createdAt: clock(),
  });
  return svc.transition({
    operationId: 'a3',
    missionId: 'mea-probe-1',
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'miss-vale-prime', detail: 'mgr' },
    update: { completedWork: ['inspect'], pendingWork: ['verify'] },
    envelope: env,
  });
});

await tryAttack('the_britt_completedWork', async () => {
  const env = createAgentOperationEnvelope({
    record: created,
    operationId: 'a4',
    agentId: 'the-britt',
    objective: 'probe',
    createdAt: clock(),
  });
  return svc.transition({
    operationId: 'a4',
    missionId: 'mea-probe-1',
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'the-britt', detail: 'britt' },
    update: { completedWork: ['inspect'], pendingWork: ['verify'] },
    envelope: env,
  });
});

await tryAttack('sales_hunter_completedWork', async () => {
  const env = createAgentOperationEnvelope({
    record: created,
    operationId: 'a5',
    agentId: 'sales_hunter',
    objective: 'probe',
    createdAt: clock(),
  });
  return svc.transition({
    operationId: 'a5',
    missionId: 'mea-probe-1',
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'sales_hunter', detail: 'hunt' },
    update: { completedWork: ['inspect'], pendingWork: ['verify'] },
    envelope: env,
  });
});

await tryAttack('qra_sentinel_completedWork', async () => {
  const env = createAgentOperationEnvelope({
    record: created,
    operationId: 'a6',
    agentId: 'qra_sentinel',
    objective: 'probe',
    createdAt: clock(),
  });
  return svc.transition({
    operationId: 'a6',
    missionId: 'mea-probe-1',
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'qra_sentinel', detail: 'screen' },
    update: { completedWork: ['inspect'], pendingWork: ['verify'] },
    envelope: env,
  });
});

await tryAttack('cluster_qc_completedWork', async () => {
  const env = createAgentOperationEnvelope({
    record: created,
    operationId: 'a7',
    agentId: 'cluster_core_qc_sentinel',
    objective: 'probe',
    createdAt: clock(),
  });
  return svc.transition({
    operationId: 'a7',
    missionId: 'mea-probe-1',
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'cluster_core_qc_sentinel', detail: 'qc' },
    update: { completedWork: ['inspect'], pendingWork: ['verify'] },
    envelope: env,
  });
});

await tryAttack('recovery_transition_completedWork', async () => {
  const env = createAgentOperationEnvelope({
    record: created,
    operationId: 'a8',
    agentId: 'qra_recovery_driver',
    objective: 'probe',
    createdAt: clock(),
    action: 'block_interrupted_mission',
  });
  return svc.transition({
    operationId: 'a8',
    missionId: 'mea-probe-1',
    expectedRevision: created.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'block' },
    update: { completedWork: ['inspect'], pendingWork: ['verify'] },
    envelope: env,
  });
});

let afterNyx = null;
await tryAttack('honest_nyx_evidence', async () => {
  const env = createAgentOperationEnvelope({
    record: created,
    operationId: 'h1',
    agentId: 'nyx',
    objective: 'probe',
    createdAt: clock(),
  });
  afterNyx = await svc.transition({
    operationId: 'h1',
    missionId: 'mea-probe-1',
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'work' },
    update: {
      evidence: [{ agent: 'nyx', note: 'observed' }],
      activeAgents: ['nyx'],
      pendingWork: ['inspect', 'verify'],
    },
    envelope: env,
  });
  return afterNyx;
});

await tryAttack('auditor_after_nyx_partial_ok', async () => {
  const env = createAgentOperationEnvelope({
    record: afterNyx,
    operationId: 'h2',
    agentId: 'qra_emerge_audit',
    objective: 'probe',
    createdAt: clock(),
  });
  return svc.transition({
    operationId: 'h2',
    missionId: 'mea-probe-1',
    expectedRevision: afterNyx.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit', detail: 'cert inspect' },
    update: { completedWork: ['inspect'], pendingWork: ['verify'] },
    envelope: env,
  });
});

await tryAttack('auditor_perform_and_certify_same_update', async () => {
  const fresh = await svc.create({
    id: 'mea-probe-2',
    operationId: 'op-create-2',
    objective: 'probe2',
    goals: [{ id: 'g1', objective: 'g' }],
    subgoals: [{ id: 'inspect', goalId: 'g1', objective: 'inspect' }],
    constraints: [],
    environmentObservations: [{ source: 'runtime', key: 'mea', value: true, observedAt: '2026-09-05T12:59:00.000Z' }],
    currentPlan: { id: 'p1', version: 1, steps: ['inspect'] },
    permissions: [
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
    ],
  });
  const nyx = await svc.transition({
    operationId: 'p2-nyx',
    missionId: 'mea-probe-2',
    expectedRevision: fresh.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'work' },
    update: { evidence: [{ agent: 'nyx', note: 'x' }], activeAgents: ['nyx'] },
    envelope: createAgentOperationEnvelope({
      record: fresh,
      operationId: 'p2-nyx',
      agentId: 'nyx',
      objective: 'probe2',
      createdAt: clock(),
    }),
  });
  return svc.transition({
    operationId: 'p2-bad',
    missionId: 'mea-probe-2',
    expectedRevision: nyx.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit', detail: 'self' },
    update: {
      completedWork: ['inspect'],
      pendingWork: [],
      evidence: [{ agent: 'qra_emerge_audit', note: 'I also did work' }],
    },
    envelope: createAgentOperationEnvelope({
      record: nyx,
      operationId: 'p2-bad',
      agentId: 'qra_emerge_audit',
      objective: 'probe2',
      createdAt: clock(),
    }),
  });
});

console.log(JSON.stringify({ root, attacks }, null, 2));
