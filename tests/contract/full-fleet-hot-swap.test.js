import test from 'node:test';
import assert from 'node:assert/strict';
import { createHotSwapFleet, DEFAULT_AGENT_CAPABILITIES } from '../../packages/fleet/src/hot-swap.js';
import { createRoleCapabilityExecutor } from '../../packages/execution/src/role-capability-executor.js';
import { fleetRegistry } from '../../packages/fleet/src/registry.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('hot-swap can rebind an agent capability and restore default', () => {
  const swap = createHotSwapFleet();
  swap.validate();
  assert.equal(swap.operationalAgents().length, 28);
  assert.equal(swap.clusters().length, 14);
  swap.bind('loom', 'port-watcher');
  assert.equal(swap.snapshot().binds.loom, 'port-watcher');
  swap.unbind('loom');
  assert.equal(swap.snapshot().binds.loom, DEFAULT_AGENT_CAPABILITIES.loom);
});

test('role capability executor runs LOOM ECHO Caretaker Sentinel with proof', async () => {
  const exec = createRoleCapabilityExecutor({ repositoryRoot: repoRoot });
  const loom = await exec.loomClearance({ thresholds: { min_memory_available_bytes: 1 } });
  assert.equal(loom.capabilityId, 'resource-commander');
  assert.equal(loom.decision, 'CLEAR');
  assert.match(loom.proofSha256, /^[a-f0-9]{64}$/);

  const echo = await exec.echoAnalyze({ thresholds: {} });
  assert.equal(echo.capabilityId, 'resonance-signal-monitor');
  assert.match(echo.proofSha256, /^[a-f0-9]{64}$/);

  const care = await exec.caretakerFleetHealth();
  assert.equal(care.capabilityId, 'fleet-health-runner');
  assert.equal(care.healthy, true);

  const sent = exec.sentinelScreen({ text: 'hello mesh', agentId: 'nyx' });
  assert.equal(sent.capabilityId, 'output-governor');
  assert.ok(sent.proofSha256);

  const wave = await exec.runClusterWave({ clusterId: fleetRegistry.clusters[0].id, memberCount: 6 });
  assert.equal(wave.decision, 'WAVE_READY');
});
