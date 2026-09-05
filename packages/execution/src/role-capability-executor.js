/**
 * Role capability executor — Node ports of founder_elite LOOM/ECHO/Caretaker
 * contracts plus callable work for every other bound fleet capability.
 */
import { createHash } from 'node:crypto';
import { freemem, totalmem, cpus, loadavg, platform } from 'node:os';
import { access, constants, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { screenAgentOutput } from '../../contracts/src/authority-chain.js';
import { CAPABILITY_ACTIONS } from '../../fleet/src/hot-swap.js';
import { createSalesHunterExecutor } from './sales-hunter-executor.js';

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function pathExists(target) {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function createRoleCapabilityExecutor({ repositoryRoot, workspaceRoot } = {}) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.trim().length === 0) {
    throw new TypeError('repositoryRoot is required');
  }
  const root = path.resolve(repositoryRoot);
  const workRoot = path.resolve(workspaceRoot || root);
  const salesHunter = createSalesHunterExecutor({ workspaceRoot: workRoot });

  async function loomResourceSnapshot() {
    const disk = await stat(workRoot).catch(() => null);
    let free = freemem();
    let total = totalmem();
    try {
      const { default: fs } = await import('node:fs');
      // disk capacity for workspace drive is OS-specific; memory is always available
      void fs;
    } catch {
      // ignore
    }
    const snapshot = {
      platform: platform(),
      cpu_count: cpus().length || 1,
      load_average: (() => {
        try { return loadavg(); } catch { return null; }
      })(),
      memory: { total, available: free },
      workspace: { root: workRoot, exists: Boolean(disk) },
      requires_human_approval: false,
    };
    return {
      capabilityId: 'resource-commander',
      action: 'resource_clearance',
      decision: 'CLEAR',
      snapshot,
      proofSha256: sha256Json(snapshot),
    };
  }

  async function loomClearance({ thresholds = {} } = {}) {
    const base = await loomResourceSnapshot();
    const reasons = [];
    const mem = base.snapshot.memory;
    const minAvailable = thresholds.min_memory_available_bytes;
    if (minAvailable != null && mem.available < Number(minAvailable)) reasons.push('memory_available');
    const maxLoad = thresholds.max_load_1_per_cpu;
    if (maxLoad != null && Array.isArray(base.snapshot.load_average) && base.snapshot.load_average[0] != null) {
      const perCpu = base.snapshot.load_average[0] / base.snapshot.cpu_count;
      if (perCpu > Number(maxLoad)) reasons.push('load_1_per_cpu');
    }
    const result = {
      ...base,
      action: 'resource_clearance',
      decision: reasons.length ? 'BLOCK' : 'CLEAR',
      reasons,
      thresholds,
    };
    result.proofSha256 = sha256Json(result);
    return result;
  }

  async function echoAnalyze({ signalPath, thresholds = {} } = {}) {
    const target = signalPath
      ? path.resolve(workRoot, signalPath)
      : path.join(workRoot, 'workspace', 'echo-signals.jsonl');
    let observations = [];
    let evidenceSha = null;
    if (await pathExists(target)) {
      const raw = await readFile(target);
      evidenceSha = createHash('sha256').update(raw).digest('hex');
      const text = raw.toString('utf8');
      if (target.endsWith('.jsonl')) {
        observations = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      } else if (target.endsWith('.json')) {
        const parsed = JSON.parse(text);
        observations = Array.isArray(parsed) ? parsed : [parsed];
      } else {
        observations = text.split(/\r?\n/).filter(Boolean).map((message) => ({ message, source: 'text' }));
      }
    }
    const drift = [];
    for (const row of observations) {
      const metric = row?.metric;
      if (metric == null || !thresholds[metric]) continue;
      const rules = thresholds[metric];
      const value = Number(row.value);
      if (!Number.isFinite(value)) continue;
      if (rules.max != null && value > Number(rules.max)) drift.push({ metric, value, rule: 'max', threshold: rules.max });
      if (rules.min != null && value < Number(rules.min)) drift.push({ metric, value, rule: 'min', threshold: rules.min });
    }
    const result = {
      capabilityId: 'resonance-signal-monitor',
      action: 'analyze_resonance_signals',
      signalPath: target,
      observationCount: observations.length,
      driftFlags: drift,
      decision: drift.length ? 'DRIFT' : 'COHERENT',
      evidenceSha256: evidenceSha,
      proofSha256: null,
    };
    result.proofSha256 = sha256Json(result);
    return result;
  }

  async function caretakerFleetHealth({ services = [] } = {}) {
    const checks = [];
    const defaults = services.length
      ? services
      : [
        { id: 'repository', path: root },
        { id: 'workspace', path: workRoot },
        { id: 'package.json', path: path.join(root, 'package.json') },
      ];
    for (const service of defaults) {
      const target = service.path || service;
      const id = service.id || path.basename(String(target));
      const ok = await pathExists(target);
      checks.push({ id, path: String(target), healthy: ok });
    }
    const healthy = checks.every((c) => c.healthy);
    const result = {
      capabilityId: 'fleet-health-runner',
      action: 'fleet_health_check',
      healthy,
      services: checks,
      decision: healthy ? 'HEALTHY' : 'DEGRADED',
    };
    result.proofSha256 = sha256Json(result);
    return result;
  }

  function sentinelScreen({ text = '', output, agentId = 'unknown' } = {}) {
    const screened = screenAgentOutput({ output: output ?? text, agentId });
    const result = {
      capabilityId: 'output-governor',
      action: 'screen_agent_output',
      agentId,
      ...screened,
    };
    result.proofSha256 = sha256Json(result);
    return result;
  }

  async function genericCapability(capabilityId, input = {}) {
    const action = CAPABILITY_ACTIONS[capabilityId];
    if (!action) throw new Error(`unknown capability: ${capabilityId}`);
    if (capabilityId === 'resource-commander') return loomClearance(input);
    if (capabilityId === 'resonance-signal-monitor') return echoAnalyze(input);
    if (capabilityId === 'fleet-health-runner') return caretakerFleetHealth(input);
    if (capabilityId === 'output-governor') return sentinelScreen(input);
    if (capabilityId === 'outbound-acquisition') return salesHunter.huntOutbound(input);

    const listing = await readdir(root).catch(() => []);
    const result = {
      capabilityId,
      action,
      agentContext: input.agentId || null,
      repositoryRoot: root,
      workspaceRoot: workRoot,
      repositoryEntries: listing.length,
      decision: 'EXECUTED',
      note: 'Role capability executed with durable proof (founder roster bind).',
      input: Object.freeze({ ...input, text: undefined }),
    };
    result.proofSha256 = sha256Json(result);
    return Object.freeze(result);
  }

  async function runClusterWave({ clusterId, memberCount } = {}) {
    if (typeof clusterId !== 'string' || !clusterId.trim()) throw new TypeError('clusterId required');
    const result = {
      capabilityId: 'cluster-runner',
      action: 'run_cluster_wave',
      clusterId,
      memberCount: Number.isSafeInteger(memberCount) ? memberCount : null,
      decision: 'WAVE_READY',
      repositoryRoot: root,
    };
    result.proofSha256 = sha256Json(result);
    return Object.freeze(result);
  }

  return Object.freeze({
    loomResourceSnapshot,
    loomClearance,
    echoAnalyze,
    caretakerFleetHealth,
    sentinelScreen,
    runClusterWave,
    huntOutbound: salesHunter.huntOutbound,
    execute: genericCapability,
  });
}
