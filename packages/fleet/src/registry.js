const agent = (id, name, role, rank, executor, extra = {}) => Object.freeze({
  id, name, role, rank, executor, enabled: false, ...extra
});
const cluster = (id, name, tier, rank, memberCount) => Object.freeze({
  id, name, tier, rank, memberCount, enabled: false
});

const agents = Object.freeze([
  agent('miss-vale-prime', 'Miss Vale Prime', 'founder_operator', 100, 'titan', {
    aliases: ['miss-vale-core', 'val_core', 'val_exec_tier_preview'],
    provenance: 'drive-recovered-canonical-doctrine',
    distribution: 'owner-only',
    enabled: true,
    executorId: 'mission-supervisor',
    authorityRank: 2,
    dangerousAuthority: true,
    notes: 'Second only to founder Justin Evans. Holds dangerous-authority keys with The Britt.',
  }),
  agent('the-britt', 'The Britt 4.0', 'dangerous_authority', 99, 'titan', {
    distribution: 'owner-only',
    provenance: 'founder-locked-authority-chain-2026-09-03',
    authorityRank: 3,
    dangerousAuthority: true,
    notes: 'Co-holder of dangerous-authority keys with Miss Vale Prime. Sentinel makes the call; Britt and Vale authorize.',
  }),
  agent('caretaker', 'Caretaker', 'fleet_orchestration', 98, 'titan', { distribution: 'owner-only' }),
  agent('agent-vale', 'Agent Vale', 'customer_safe_specialist', 76, 'titan', {
    provenance: 'drive-recovered-separation-contract',
    distribution: 'public',
    enabled: true,
    executorId: 'ollama-chat',
    notes: 'Public specialist — not Miss Vale Prime. No dangerous-authority keys.',
  }),
  agent('qra_sentinel', 'QRA Sentinel', 'output_governor', 97, 'titan', {
    distribution: 'owner-only',
    provenance: 'ichabod-titan-recovered-governor-doctrine',
    lastLineOfDefense: true,
    screens: 'output',
    notes: 'Governor. Last line of defense. Makes the blast-radius call on agent output. Does not outrank Vale Prime or The Britt. Not Cluster QC Sentinel.',
  }),
  agent('nyx', 'NYX', 'apex_coder', 95, 'houston_bay', { enabled: true, executorId: 'repository-inspector' }),
  agent('loom', 'LOOM', 'resource_allocator', 95, 'houston_bay'),
  agent('rune', 'RUNE', 'code_validator', 95, 'houston_bay', { enabled: true, executorId: 'node-test-runner' }),
  agent('echo', 'ECHO', 'brand_signal_monitor', 95, 'houston_bay'),
  agent('wake_operator', 'WAKE Operator', 'configuration_engine', 95, 'houston_bay'),
  agent('aether_wlm', 'AETHER', 'execution_kernel', 76, 'houston_bay'),
  agent('qra_emerge_orchestration', 'QRA AI Orchestration Strike', 'system_integration_runner', 76, 'titan'),
  agent('qra_emerge_ai_secops', 'QRA AI SecOps Strike', 'prompt_injection_defense', 76, 'titan'),
  agent('qra_emerge_audit', 'QRA Audit Evidence Strike', 'evidence_collector', 76, 'titan', { enabled: true, executorId: 'proof-verifier' }),
  agent('qra_emerge_context', 'QRA Context Engineering Strike', 'context_memory_lock', 76, 'titan'),
  agent('qra_emerge_ethics_liaison', 'QRA Ethics Stakeholder Strike', 'compliance_liaison', 76, 'titan'),
  agent('qra_emerge_mlops_data', 'QRA ML Data Ops Strike', 'data_pipeline_validator', 76, 'titan'),
  agent('qra_emerge_governance', 'QRA Governance Risk Strike', 'policy_gatekeeper', 76, 'titan'),
  agent('qra_recovery_driver', 'QRA Recovery Driver', 'recovery_executor', 76, 'titan', { enabled: true, executorId: 'recovery-coordinator' }),
  agent('qra_route_controller', 'QRA Route Controller', 'task_cluster_router', 76, 'titan'),
  agent('qra_signal_watch', 'QRA Signal Watch', 'port_watcher', 76, 'titan'),
  agent('sales_hunter', 'Sales Hunter', 'outbound_acquisition', 76, 'titan'),
  agent('cluster_core_loop_captain', 'Cluster Loop Captain', 'sprint_supervisor', 76, 'titan'),
  agent('cluster_core_ship_lead', 'Cluster Ship Lead', 'hotfix_shipper', 76, 'titan'),
  agent('cluster_core_qc_sentinel', 'Cluster QC Sentinel', 'output_reviewer', 76, 'titan', {
    notes: 'Daily QC for outbound work. Not the QRA Governor. Existential risk is qra_sentinel.',
  }),
  agent('cluster_core_metrics', 'Cluster Metrics Clerk', 'metrics_logger', 76, 'titan'),
  agent('cluster_core_comms', 'Cluster Comms', 'stakeholder_comms', 76, 'titan'),
  agent('ronan_v01', 'Ronan v.01', 'forensic_investigator', 76, 'titan')
]);

const clusters = Object.freeze([
  cluster('vanguard_content_creator', 'Vanguard Content Creator Cluster', 'vanguard', 95, 6),
  cluster('vanguard_lead_intake_followup', 'Vanguard Lead Intake & Follow-Up Cluster', 'vanguard', 95, 6),
  cluster('vanguard_marketing', 'Vanguard Marketing Cluster', 'vanguard', 95, 5),
  cluster('vanguard_operations_support', 'Vanguard Operations Support Cluster', 'vanguard', 95, 6),
  cluster('vanguard_service_business_dispatch', 'Vanguard Service Business Dispatch Cluster', 'vanguard', 95, 6),
  cluster('vanguard_qra_incident_response', 'Vanguard QRA Incident Response Cluster', 'vanguard', 95, 6),
  cluster('vanguard_security_deployment', 'Vanguard Security Deployment Team', 'vanguard', 95, 10),
  cluster('commercial_content_creator', 'Content Creator Cluster', 'commercial', 76, 6),
  cluster('commercial_lead_intake_followup', 'Lead Intake & Follow-Up Cluster', 'commercial', 76, 6),
  cluster('commercial_marketing', 'Marketing Cluster', 'commercial', 76, 5),
  cluster('commercial_operations_support', 'Operations Support Cluster', 'commercial', 76, 6),
  cluster('commercial_service_business_dispatch', 'Service Business Dispatch Cluster', 'commercial', 76, 6),
  cluster('commercial_qra_incident_response', 'QRA Incident Response Cluster', 'commercial', 76, 6),
  cluster('commercial_security_deployment', 'Security Deployment Team', 'commercial', 76, 10)
]);

const jobs = Object.freeze([]);

export const fleetRegistry = Object.freeze({ version: 2, agents, clusters, jobs });
export const qraForces = () => agents.filter(item => item.id.startsWith('qra_'));
export const fleetClusters = () => [...clusters];
export const operationalAgents = () => agents.filter((agent) => agent.enabled);
export const validateOperationalFleet = () => {
  for (const agent of operationalAgents()) {
    if (typeof agent.executorId !== 'string' || agent.executorId.trim().length === 0) {
      throw new Error(`operational agent requires executor ID: ${agent.id}`);
    }
  }
};
