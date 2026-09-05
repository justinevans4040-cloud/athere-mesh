/**
 * Fleet capability catalog — hot-swappable bindings for every registry agent.
 * Ports founder_elite contracts (LOOM/ECHO/Caretaker) into the Node mesh without
 * inventing a thinner roster. Clusters bind to a cluster-runner capability.
 */
import { fleetRegistry } from './registry.js';

/** Default executorId per agent — full roster, nothing left unbound. */
export const DEFAULT_AGENT_CAPABILITIES = Object.freeze({
  'miss-vale-prime': 'mission-supervisor',
  'the-britt': 'dangerous-authority-coholder',
  caretaker: 'fleet-health-runner',
  'agent-vale': 'ollama-chat',
  qra_sentinel: 'output-governor',
  nyx: 'repository-inspector',
  loom: 'resource-commander',
  rune: 'node-test-runner',
  echo: 'resonance-signal-monitor',
  wake_operator: 'configuration-engine',
  aether_wlm: 'execution-kernel',
  qra_emerge_orchestration: 'system-integration-runner',
  qra_emerge_ai_secops: 'prompt-injection-defense',
  qra_emerge_audit: 'proof-verifier',
  qra_emerge_context: 'context-memory-lock',
  qra_emerge_ethics_liaison: 'compliance-liaison',
  qra_emerge_mlops_data: 'data-pipeline-validator',
  qra_emerge_governance: 'policy-gatekeeper',
  qra_recovery_driver: 'recovery-coordinator',
  qra_route_controller: 'task-cluster-router',
  qra_signal_watch: 'port-watcher',
  sales_hunter: 'outbound-acquisition',
  cluster_core_loop_captain: 'sprint-supervisor',
  cluster_core_ship_lead: 'hotfix-shipper',
  cluster_core_qc_sentinel: 'output-reviewer',
  cluster_core_metrics: 'metrics-logger',
  cluster_core_comms: 'stakeholder-comms',
  ronan_v01: 'forensic-investigator',
});

export const DEFAULT_CLUSTER_CAPABILITY = 'cluster-runner';

export const CAPABILITY_ACTIONS = Object.freeze({
  'mission-supervisor': 'supervise_mission',
  'dangerous-authority-coholder': 'cohold_dangerous_authority',
  'fleet-health-runner': 'fleet_health_check',
  'ollama-chat': 'advisory_chat',
  'output-governor': 'screen_agent_output',
  'repository-inspector': 'observe_repository',
  'resource-commander': 'resource_clearance',
  'node-test-runner': 'execute_node_tests',
  'resonance-signal-monitor': 'analyze_resonance_signals',
  'configuration-engine': 'configure_wake',
  'execution-kernel': 'execute_wlm_kernel',
  'system-integration-runner': 'run_system_integration',
  'prompt-injection-defense': 'screen_prompt_injection',
  'proof-verifier': 'verify_proof',
  'context-memory-lock': 'lock_context_memory',
  'compliance-liaison': 'liaise_compliance',
  'data-pipeline-validator': 'validate_data_pipeline',
  'policy-gatekeeper': 'gate_policy',
  'recovery-coordinator': 'block_interrupted_mission',
  'task-cluster-router': 'route_cluster_task',
  'port-watcher': 'watch_ports',
  'outbound-acquisition': 'hunt_outbound',
  'sprint-supervisor': 'supervise_sprint',
  'hotfix-shipper': 'ship_hotfix',
  'output-reviewer': 'review_outbound_output',
  'metrics-logger': 'log_metrics',
  'stakeholder-comms': 'communicate_stakeholders',
  'forensic-investigator': 'investigate_forensics',
  'cluster-runner': 'run_cluster_wave',
  'workspace-file-worker': 'mutate_workspace_files',
  'titan-build-runner': 'execute_titan_build',
});

function cloneAgent(agent, executorId) {
  return Object.freeze({
    ...agent,
    enabled: true,
    executorId,
  });
}

function cloneCluster(cluster) {
  return Object.freeze({
    ...cluster,
    enabled: true,
    executorId: DEFAULT_CLUSTER_CAPABILITY,
  });
}

/**
 * Live hot-swap surface: bind/unbind capability ids without rewriting doctrine identities.
 */
export function createHotSwapFleet({ base = fleetRegistry, initialBinds = DEFAULT_AGENT_CAPABILITIES } = {}) {
  const binds = new Map(Object.entries(initialBinds));
  const clusterBinds = new Map(base.clusters.map((c) => [c.id, DEFAULT_CLUSTER_CAPABILITY]));

  function agents() {
    return Object.freeze(base.agents.map((agent) => {
      const executorId = binds.get(agent.id);
      if (!executorId) {
        throw new Error(`agent missing capability bind: ${agent.id}`);
      }
      return cloneAgent(agent, executorId);
    }));
  }

  function clusters() {
    return Object.freeze(base.clusters.map((cluster) => {
      const executorId = clusterBinds.get(cluster.id) || DEFAULT_CLUSTER_CAPABILITY;
      return cloneCluster({ ...cluster, executorId });
    }));
  }

  function bind(agentId, executorId) {
    if (typeof agentId !== 'string' || !agentId.trim()) throw new TypeError('agentId required');
    if (typeof executorId !== 'string' || !executorId.trim()) throw new TypeError('executorId required');
    if (!base.agents.some((a) => a.id === agentId)) throw new Error(`unknown agent: ${agentId}`);
    if (!Object.hasOwn(CAPABILITY_ACTIONS, executorId)) throw new Error(`unknown capability: ${executorId}`);
    binds.set(agentId, executorId.trim());
    return snapshot();
  }

  function unbind(agentId) {
    if (!binds.has(agentId)) throw new Error(`agent not bound: ${agentId}`);
    const fallback = DEFAULT_AGENT_CAPABILITIES[agentId];
    if (!fallback) throw new Error(`no default capability for ${agentId}`);
    binds.set(agentId, fallback);
    return snapshot();
  }

  function bindCluster(clusterId, executorId = DEFAULT_CLUSTER_CAPABILITY) {
    if (!base.clusters.some((c) => c.id === clusterId)) throw new Error(`unknown cluster: ${clusterId}`);
    if (!Object.hasOwn(CAPABILITY_ACTIONS, executorId)) throw new Error(`unknown capability: ${executorId}`);
    clusterBinds.set(clusterId, executorId);
    return snapshot();
  }

  function snapshot() {
    const nextAgents = agents();
    const nextClusters = clusters();
    return Object.freeze({
      version: base.version,
      agents: nextAgents,
      clusters: nextClusters,
      jobs: base.jobs,
      binds: Object.freeze(Object.fromEntries(binds)),
      clusterBinds: Object.freeze(Object.fromEntries(clusterBinds)),
    });
  }

  function validate() {
    for (const agent of agents()) {
      if (agent.enabled !== true) throw new Error(`agent not enabled: ${agent.id}`);
      if (typeof agent.executorId !== 'string' || agent.executorId.trim().length === 0) {
        throw new Error(`operational agent requires executor ID: ${agent.id}`);
      }
    }
    for (const cluster of clusters()) {
      if (cluster.enabled !== true) throw new Error(`cluster not enabled: ${cluster.id}`);
    }
  }

  return Object.freeze({
    bind,
    unbind,
    bindCluster,
    snapshot,
    validate,
    agents,
    clusters,
    operationalAgents: () => agents().filter((a) => a.enabled === true),
  });
}

/** Static full-fleet registry derived from doctrine catalog + default binds. */
export function createFullyBoundFleetRegistry(base = fleetRegistry) {
  const swap = createHotSwapFleet({ base });
  swap.validate();
  return swap.snapshot();
}
