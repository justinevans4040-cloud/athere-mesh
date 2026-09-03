import test from 'node:test';
import assert from 'node:assert/strict';
import { fleetRegistry, qraForces, fleetClusters, operationalAgents, validateOperationalFleet } from '../../packages/fleet/src/registry.js';
import { planValePrimeDeployment } from '../../packages/fleet/src/vale-deployment.js';

test('fleet registry preserves every recovered agent and cluster while limiting operational status to implemented executors', () => {
  assert.equal(fleetRegistry.agents.length, 26);
  assert.equal(fleetRegistry.clusters.length, 14);
  assert.equal(qraForces().length, 10);
  assert.equal(fleetClusters().length, 14);
  assert.deepEqual(
    operationalAgents().map(({ id, executorId }) => ({ id, executorId })),
    [
      { id: 'miss-vale-prime', executorId: 'mission-supervisor' },
      { id: 'agent-vale', executorId: 'ollama-chat' },
      { id: 'nyx', executorId: 'repository-inspector' },
      { id: 'rune', executorId: 'node-test-runner' },
      { id: 'qra_emerge_audit', executorId: 'proof-verifier' },
      { id: 'qra_recovery_driver', executorId: 'recovery-coordinator' },
    ],
  );
  assert.ok(operationalAgents().every(agent => typeof agent.executorId === 'string' && agent.executorId.length > 0));
  assert.ok(fleetRegistry.agents.filter(agent => !agent.enabled).every(agent => agent.enabled === false));
  assert.ok(fleetRegistry.clusters.every(cluster => cluster.enabled === false));
  assert.doesNotThrow(() => validateOperationalFleet());
});

test('Vale Prime is canonical while legacy core remains a compatibility alias', () => {
  const vale = fleetRegistry.agents.find(agent => agent.id === 'miss-vale-prime');
  assert.deepEqual(vale.aliases, ['miss-vale-core', 'val_core', 'val_exec_tier_preview']);
  assert.equal(vale.provenance, 'drive-recovered-canonical-doctrine');
  assert.equal(vale.distribution, 'owner-only');
});

test('Agent Vale remains a separate public specialist and Caretaker remains a founder agent', () => {
  const agentVale = fleetRegistry.agents.find(agent => agent.id === 'agent-vale');
  assert.equal(agentVale.distribution, 'public');
  assert.equal(agentVale.role, 'customer_safe_specialist');
  const caretaker = fleetRegistry.agents.find(agent => agent.id === 'caretaker');
  assert.equal(caretaker.name, 'Caretaker');
  assert.equal(caretaker.role, 'fleet_orchestration');
  assert.equal(fleetRegistry.jobs.some(job => job.id === 'caretaker'), false);
});

test('founder doctrine agents LOOM ECHO Caretaker and Sentinel remain agents', () => {
  const byId = Object.fromEntries(fleetRegistry.agents.map((agent) => [agent.id, agent]));
  assert.equal(byId.loom.name, 'LOOM');
  assert.equal(byId.loom.role, 'resource_allocator');
  assert.equal(byId.echo.name, 'ECHO');
  assert.equal(byId.echo.role, 'brand_signal_monitor');
  assert.equal(byId.caretaker.name, 'Caretaker');
  assert.equal(byId.caretaker.role, 'fleet_orchestration');
  assert.equal(byId.cluster_core_qc_sentinel.name, 'Cluster QC Sentinel');
  assert.equal(byId.cluster_core_qc_sentinel.role, 'output_reviewer');
});

test('Vale Prime deployment requires a verified artifact before any target is staged', () => {
  assert.throws(
    () => planValePrimeDeployment({ artifact: { path: 'vale.bundle', sha256: 'a'.repeat(64), verified: false } }),
    /verified Vale Prime artifact/i
  );
});

test('Vale Prime fleet deployment asks once for the exact batch, not once per target', () => {
  const plan = planValePrimeDeployment({
    artifact: { path: 'artifacts/vale-prime.bundle', sha256: 'b'.repeat(64), verified: true }
  });
  assert.equal(plan.status, 'needs_approval');
  assert.equal(plan.approvals.length, 1);
  assert.equal(plan.approvals[0].action, 'fleet_deploy');
  assert.equal(plan.approvals[0].targetCount, 24);
});

test('approved Vale Prime deployment points at QRA then every fleet cluster', () => {
  const plan = planValePrimeDeployment({
    artifact: { path: 'artifacts/vale-prime.bundle', sha256: 'c'.repeat(64), verified: true },
    approval: { id: 'approval-1', artifactSha256: 'c'.repeat(64), approved: true }
  });
  assert.equal(plan.status, 'staged');
  assert.deepEqual(plan.waves.map(wave => wave.name), ['qra-forces', 'vanguard-clusters', 'commercial-clusters']);
  assert.equal(plan.agentId, 'miss-vale-prime');
  assert.equal(plan.waves[0].targets.length, 10);
  assert.equal(plan.waves[1].targets.length, 7);
  assert.equal(plan.waves[2].targets.length, 7);
  assert.equal(new Set(plan.waves.flatMap(wave => wave.targets)).size, 24);
});

test('approval cannot be replayed for a different Vale artifact', () => {
  assert.throws(() => planValePrimeDeployment({
    artifact: { path: 'artifacts/vale-prime.bundle', sha256: 'd'.repeat(64), verified: true },
    approval: { id: 'approval-1', artifactSha256: 'e'.repeat(64), approved: true }
  }), /artifact hash/i);
});
