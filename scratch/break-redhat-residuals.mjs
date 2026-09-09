/**
 * Red Hat residual assault after ckpt 131.
 * Every named residual must have a concrete verifier. OPEN_COUNT must be 0.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const results = [];

function run(id, files, expected) {
  const execution = spawnSync(process.execPath, ['--test', ...files], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const output = `${execution.stdout ?? ''}\n${execution.stderr ?? ''}`;
  const pass = execution.status === 0 && expected.every((value) => output.includes(value));
  results.push({
    id,
    result: pass ? 'REJECT_OK' : 'ACCEPT_BAD',
    detail: pass
      ? expected.join(' | ')
      : `exit=${execution.status}; ${output.slice(-500)}`,
  });
}

run('RH_R01_mutation_budget_bound', [
  'tests/contract/agent-operation-budget.test.js',
], ['positive max_state_mutations budget']);

run('RH_R02_recovery_edges_enforced', [
  'tests/contract/workflow-graph.test.js',
], ['recovery edges are enforced']);

run('RH_R03_artifact_revision_replay_rejected', [
  'tests/integration/artifact-proof.test.js',
], ['artifact proof binds exact artifact bytes']);

run('RH_R04_fact_lineage_redacted', [
  'tests/integration/mission-state-fact-operations.test.js',
  'tests/integration/typed-memory-item14.test.js',
], [
  'ordinary mission reads expose current facts only',
  'superseded semantic fact is not current working state',
]);

run('RH_R05_checkpoint_snapshot_not_selectable', [
  'tests/integration/mea-hostile-item12-gaps.test.js',
], ['checkpoint selection exposes metadata but never embedded state snapshots']);

run('RH_R06_missing_recovery_permission_is_corrupt', [
  'tests/integration/recovery-permission-boot.test.js',
], [
  'shared mission lacks recovery permission',
  'empty permissions deny recovery',
  'repeated interruptions use revision-bound recovery IDs',
]);

run('RH_R07_loopback_chat_requires_bearer', [
  'tests/integration/text-chat-api.test.js',
], ['never sends denied recognized execution requests']);

run('RH_R08_unmarked_bus_fails_closed', [
  'tests/integration/mission-orchestrator.test.js',
], ['unmarked bus publish failure fails closed']);

const checkpointSource = readFileSync('packages/mission/src/mission-checkpoints.js', 'utf8');
results.push({
  id: 'RH_R09_dead_recovery_export_removed',
  result: checkpointSource.includes('recoveryPermissionActions')
    ? 'ACCEPT_BAD'
    : 'REJECT_OK',
  detail: 'recoveryPermissionActions absent',
});

const serviceSource = readFileSync('packages/mission/src/mission-state-service.js', 'utf8');
const sharedRestoreUses = (serviceSource.match(/return restoreCheckpointOperation\(\{/g) ?? []).length;
results.push({
  id: 'RH_R10_rollback_retry_share_one_restore_path',
  result: sharedRestoreUses === 2 ? 'REJECT_OK' : 'ACCEPT_BAD',
  detail: `restoreCheckpointOperation callers=${sharedRestoreUses}`,
});

console.log(JSON.stringify(results, null, 2));
const open = results.filter(({ result }) => result !== 'REJECT_OK');
console.log('OPEN_COUNT', open.length);
console.log('OPEN', JSON.stringify(open, null, 2));
process.exitCode = open.length === 0 ? 0 : 1;
