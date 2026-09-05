import test from 'node:test';
import assert from 'node:assert/strict';
import { fleetRegistry, qraForces, fleetClusters, operationalAgents, validateOperationalFleet } from '../../packages/fleet/src/registry.js';
import { planValePrimeDeployment } from '../../packages/fleet/src/vale-deployment.js';

test('fleet registry preserves every recovered agent and cluster with full operational binds', () => {
  assert.equal(fleetRegistry.agents.length, 28);
  assert.equal(fleetRegistry.clusters.length, 14);
  assert.equal(qraForces().length, 11);
  assert.equal(fleetClusters().length, 14);
  assert.equal(operationalAgents().length, 28);
  assert.ok(operationalAgents().every(agent => typeof agent.executorId === 'string' && agent.executorId.length > 0));
  assert.ok(fleetRegistry.agents.every(agent => agent.enabled === true));
  assert.ok(fleetRegistry.clusters.every(cluster => cluster.enabled === true && cluster.executorId === 'cluster-runner'));
  assert.doesNotThrow(() => validateOperationalFleet());
  const byId = Object.fromEntries(operationalAgents().map((a) => [a.id, a.executorId]));
  assert.equal(byId.loom, 'resource-commander');
  assert.equal(byId.echo, 'resonance-signal-monitor');
  assert.equal(byId.caretaker, 'fleet-health-runner');
  assert.equal(byId.qra_sentinel, 'output-governor');
  assert.equal(byId['the-britt'], 'dangerous-authority-coholder');
});

test('Vale Prime is the sole Miss Vale; legacy ids are aliases only', () => {
  const vale = fleetRegistry.agents.find(agent => agent.id === 'miss-vale-prime');
  assert.equal(vale.name, 'Vale Prime');
  assert.equal(vale.soleMissVale, true);
  assert.ok(vale.aliases.includes('vale-prime'));
  assert.ok(vale.aliases.includes('miss-vale-core'));
  assert.equal(vale.provenance, 'drive-recovered-canonical-doctrine');
  assert.equal(vale.distribution, 'owner-only');
  const missVales = fleetRegistry.agents.filter((a) => a.soleMissVale === true);
  assert.equal(missVales.length, 1);
  assert.equal(missVales[0].id, 'miss-vale-prime');
});

test('Public chat specialist is not Vale Prime / not Miss Vale; Caretaker remains a founder agent', () => {
  const agentVale = fleetRegistry.agents.find(agent => agent.id === 'agent-vale');
  assert.equal(agentVale.name, 'Public Chat Specialist');
  assert.equal(agentVale.soleMissVale, false);
  assert.equal(agentVale.distribution, 'public');
  assert.equal(agentVale.role, 'customer_safe_specialist');
  const caretaker = fleetRegistry.agents.find(agent => agent.id === 'caretaker');
  assert.equal(caretaker.name, 'Caretaker');
  assert.equal(caretaker.role, 'fleet_orchestration');
  assert.equal(fleetRegistry.jobs.some(job => job.id === 'caretaker'), false);
});

test('founder doctrine agents LOOM ECHO Caretaker Sentinel Governor Britt and QC remain agents', () => {
  const byId = Object.fromEntries(fleetRegistry.agents.map((agent) => [agent.id, agent]));
  assert.equal(byId.loom.name, 'LOOM');
  assert.equal(byId.loom.role, 'resource_allocator');
  assert.equal(byId.echo.name, 'ECHO');
  assert.equal(byId.echo.role, 'brand_signal_monitor');
  assert.equal(byId.caretaker.name, 'Caretaker');
  assert.equal(byId.caretaker.role, 'fleet_orchestration');
  assert.equal(byId.cluster_core_qc_sentinel.name, 'Cluster QC Sentinel');
  assert.equal(byId.cluster_core_qc_sentinel.role, 'output_reviewer');
  assert.equal(byId.qra_sentinel.name, 'QRA Sentinel');
  assert.equal(byId.qra_sentinel.role, 'output_governor');
  assert.equal(byId.qra_sentinel.lastLineOfDefense, true);
  assert.equal(byId.qra_sentinel.screens, 'output');
  assert.equal(byId['the-britt'].name, 'The Britt 4.0');
  assert.equal(byId['the-britt'].dangerousAuthority, true);
  assert.equal(byId['miss-vale-prime'].name, 'Vale Prime');
  assert.equal(byId['miss-vale-prime'].dangerousAuthority, true);
  assert.equal(byId['miss-vale-prime'].authorityRank, 2);
  assert.equal(byId['miss-vale-prime'].soleMissVale, true);
  assert.equal(byId['agent-vale'].dangerousAuthority, undefined);
  assert.equal(byId['agent-vale'].soleMissVale, false);
  assert.equal(fleetRegistry.jobs.some((job) => ['caretaker', 'qra_sentinel', 'the-britt', 'cluster_core_qc_sentinel'].includes(job.id)), false);
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
  assert.equal(plan.approvals[0].targetCount, 25);
  assert.equal(plan.approvals[0].targetCount, qraForces().length + fleetClusters().length);
});

test('approved Vale Prime deployment points at QRA then every fleet cluster', () => {
  const plan = planValePrimeDeployment({
    artifact: { path: 'artifacts/vale-prime.bundle', sha256: 'c'.repeat(64), verified: true },
    approval: { id: 'approval-1', artifactSha256: 'c'.repeat(64), approved: true }
  });
  assert.equal(plan.status, 'staged');
  assert.deepEqual(plan.waves.map(wave => wave.name), ['qra-forces', 'vanguard-clusters', 'commercial-clusters']);
  assert.equal(plan.agentId, 'miss-vale-prime');
  assert.equal(plan.waves[0].targets.length, 11);
  assert.equal(plan.waves[1].targets.length, 7);
  assert.equal(plan.waves[2].targets.length, 7);
  assert.equal(new Set(plan.waves.flatMap(wave => wave.targets)).size, 25);
});

test('approval cannot be replayed for a different Vale artifact', () => {
  assert.throws(() => planValePrimeDeployment({
    artifact: { path: 'artifacts/vale-prime.bundle', sha256: 'd'.repeat(64), verified: true },
    approval: { id: 'approval-1', artifactSha256: 'e'.repeat(64), approved: true }
  }), /artifact hash/i);
});
