const OWNER_ALLOW = new Set(['read', 'search', 'test', 'build', 'local_write', 'ssh_read']);
const OWNER_APPROVAL = new Set(['delete', 'publish', 'payment', 'privilege', 'credential_change', 'policy_expand', 'fleet_deploy']);
const PUBLIC_ALLOW = new Set(['read', 'search', 'test', 'build', 'sandbox_write']);
const PUBLIC_DENY = new Set(['host_write', 'ssh_read', 'ssh_execute', 'payment', 'publish', 'external_model', 'delete', 'privilege', 'credential_change', 'policy_expand', 'fleet_deploy']);

const result = (decision, reason) => Object.freeze({ decision, reason });

export function evaluateAction(profile, action) {
  const kind = action?.kind;
  if (profile === 'owner') {
    if (OWNER_ALLOW.has(kind)) return result('allow', 'routine scoped owner operation');
    if (kind === 'fleet_deploy') return result('require_approval', 'one consequential approval for an exact fleet deployment batch');
    if (OWNER_APPROVAL.has(kind)) return result('require_approval', 'consequential owner operation');
    return result('deny', 'unknown owner action kind');
  }
  if (profile === 'public') {
    if (PUBLIC_ALLOW.has(kind) && action?.target === 'sandbox') return result('allow', 'public sandbox operation');
    if (PUBLIC_DENY.has(kind)) return result('deny', 'public edition boundary');
    return result('deny', 'unknown or out-of-sandbox public action');
  }
  return result('deny', 'unknown policy profile');
}
