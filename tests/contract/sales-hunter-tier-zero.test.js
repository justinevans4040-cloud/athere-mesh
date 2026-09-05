import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSalesHunterExecutor } from '../../packages/execution/src/sales-hunter-executor.js';
import { createRoleCapabilityExecutor } from '../../packages/execution/src/role-capability-executor.js';
import { fleetRegistry } from '../../packages/fleet/src/registry.js';

test('Sales Hunter tier-zero fails closed without offer + segment + close date', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sales-hunter-'));
  const hunter = createSalesHunterExecutor({ workspaceRoot });
  await assert.rejects(
    () => hunter.huntOutbound({ text: 'go sell something' }),
    /offer|segment|close date/i,
  );
});

test('Sales Hunter tier-zero builds qualified pipeline + drafts only (never send) with durable proof', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sales-hunter-'));
  const hunter = createSalesHunterExecutor({ workspaceRoot });
  const result = await hunter.huntOutbound({
    offer: 'Athere Mesh local AI OS for CNC shops',
    segment: 'US job shops with 10-80 machines',
    closeDate: '2026-10-15',
    location: 'Midwest',
    leads: [
      { name: 'Precision Tooling Co', fit: 'high', signal: 'hiring CNC programmers' },
      { name: 'Random Coffee Cart', fit: 'low', signal: 'food truck' },
      { name: 'Midwest Proto Labs', fit: 'high', signal: 'quoted new 5-axis cell' },
    ],
  });

  assert.equal(result.capabilityId, 'outbound-acquisition');
  assert.equal(result.action, 'hunt_outbound');
  assert.equal(result.tier, 0);
  assert.equal(result.decision, 'PIPELINE_READY');
  assert.equal(result.sendAuthorized, false);
  assert.equal(result.deniedTools.includes('outreach_send'), true);
  assert.ok(result.pipeline.length >= 2);
  assert.ok(result.pipeline.every((lead) => lead.stage && lead.disqualified !== undefined));
  assert.equal(result.pipeline.filter((lead) => lead.disqualified).length, 1);
  assert.ok(result.drafts.length >= 2);
  assert.ok(result.drafts.every((draft) => draft.cta && draft.body.length < 600));
  assert.ok(result.drafts.every((draft) => draft.screened?.safe === true));
  assert.match(result.proofSha256, /^[a-f0-9]{64}$/);
  assert.ok(result.artifactPath);

  const artifact = JSON.parse(await readFile(path.join(workspaceRoot, result.artifactPath), 'utf8'));
  assert.equal(artifact.sendAuthorized, false);
  assert.equal(artifact.agentId, 'sales_hunter');
});

test('role capability executor routes outbound-acquisition through Sales Hunter T0', async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'sales-hunter-role-'));
  const exec = createRoleCapabilityExecutor({ repositoryRoot: process.cwd(), workspaceRoot });
  const result = await exec.execute('outbound-acquisition', {
    agentId: 'sales_hunter',
    offer: 'Mesh install for back-office CNC ops',
    segment: 'contract manufacturers',
    closeDate: '2026-11-01',
  });
  assert.equal(result.capabilityId, 'outbound-acquisition');
  assert.equal(result.tier, 0);
  assert.equal(result.decision, 'PIPELINE_READY');
});

test('roster lock: NYX tip of sword; Sales Hunter tier zero; clusters parked; Ronan deferred', () => {
  const byId = Object.fromEntries(fleetRegistry.agents.map((a) => [a.id, a]));
  assert.equal(byId.nyx.tipOfSword, true);
  assert.equal(byId.sales_hunter.tierZero, true);
  assert.equal(byId.ronan_v01.deferred, true);
  assert.equal(byId.aether_wlm.wlmTarget, true);
  assert.ok(fleetRegistry.clusters.every((c) => c.parked === true && c.enabled === true));
});
