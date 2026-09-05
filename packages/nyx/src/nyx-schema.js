/**
 * NYX upgrade ladder step 1 — schema.
 * Kill switch, permission profiles, tool ids, output contract, peers.
 */
export const NYX_SCHEMA_VERSION = '1.0.0';

export const NYX_PERMISSION_PROFILES = Object.freeze([
  'trusted_repo',
  'ask_first',
  'ci_automation',
]);

export const NYX_TOOL_IDS = Object.freeze([
  'read_file',
  'write_file',
  'search_repo',
  'run_tests',
  'git_status',
  'hash_path',
  'handoff',
]);

export const NYX_PEERS = Object.freeze({
  integrity: 'rune',
  resources: 'loom',
  mission: 'miss-vale-prime',
});

export const NYX_OUTPUT_STATUSES = Object.freeze([
  'chat',
  'executed',
  'not_executed',
  'needs_approval',
]);

export function createNyxSchema({ killSwitch = false } = {}) {
  return Object.freeze({
    version: NYX_SCHEMA_VERSION,
    identity: 'nyx-coding-operator',
    killSwitch: killSwitch === true,
    permissionProfiles: NYX_PERMISSION_PROFILES,
    tools: NYX_TOOL_IDS,
    peers: NYX_PEERS,
    outputStatuses: NYX_OUTPUT_STATUSES,
    reflectionRequired: true,
  });
}

export function assertNyxKillSwitch(schema) {
  if (schema?.killSwitch === true) {
    const error = new Error('NYX kill switch engaged — no tool execution');
    error.code = 'NYX_KILL_SWITCH';
    throw error;
  }
}
