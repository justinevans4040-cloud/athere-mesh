/**
 * Item 23 — self-improvement sandbox.
 * Experimental improvement only through gated stages; no uncontrolled self-mod.
 */

import {
  assertCannotSelfDeclareProduction,
  assertImprovementApprover,
  assertImprovementDeployer,
  assertImprovementStageOrder,
  compareWithFrozenControl,
  evaluateImprovementQr18,
  normalizeImprovementMetrics,
  normalizeImprovementProposal,
} from '../../contracts/src/self-improvement.js';

/** Hard cap against improvement-proposal DoS. */
export const MAX_IMPROVEMENT_PROPOSALS = 64;

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function assertMonitorActor(actor) {
  try {
    return assertImprovementApprover(actor);
  } catch {
    return assertImprovementDeployer(actor);
  }
}

export function createSelfImprovementSandbox({ now = () => new Date().toISOString() } = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  const proposals = new Map();

  function get(proposalId) {
    const id = requiredText(proposalId, 'proposalId');
    const entry = proposals.get(id);
    if (!entry) throw new Error(`unknown improvement proposal: ${id}`);
    return entry;
  }

  function advance(entry, expectedStage, nextStage, patch) {
    if (entry.stage !== expectedStage) {
      throw new Error(`improvement stage mismatch: expected ${expectedStage}, got ${entry.stage}`);
    }
    assertImprovementStageOrder(expectedStage, nextStage);
    const updated = Object.freeze({
      ...entry,
      ...patch,
      stage: nextStage,
      updatedAt: now(),
      uncontrolledSelfModification: false,
    });
    proposals.set(entry.id, updated);
    return updated;
  }

  return Object.freeze({
    async propose(input) {
      const proposal = normalizeImprovementProposal(input);
      if (proposals.has(proposal.id)) throw new Error(`duplicate proposal id: ${proposal.id}`);
      if (proposals.size >= MAX_IMPROVEMENT_PROPOSALS) {
        throw new Error(`improvement proposals exceed cap (${MAX_IMPROVEMENT_PROPOSALS})`);
      }
      const record = Object.freeze({
        ...proposal,
        stage: 'propose',
        production: false,
        rolledBack: false,
        uncontrolledSelfModification: false,
        benchmark: null,
        comparison: null,
        security: null,
        qr18: null,
        approvedBy: null,
        deployedBy: null,
        createdAt: now(),
        updatedAt: now(),
      });
      proposals.set(proposal.id, record);
      return record;
    },

    async enterSandbox({ proposalId }) {
      return advance(get(proposalId), 'propose', 'sandbox', { sandboxed: true });
    },

    async benchmark({ proposalId, result }) {
      const metrics = normalizeImprovementMetrics(result, 'benchmark');
      return advance(get(proposalId), 'sandbox', 'benchmark', { benchmark: metrics });
    },

    async compareWithFrozenControl({ proposalId, control }) {
      const entry = get(proposalId);
      if (!entry.benchmark) throw new Error('benchmark required before control compare');
      const comparison = compareWithFrozenControl({
        control,
        candidate: entry.benchmark,
      });
      if (comparison.regression || !comparison.improved) {
        throw new Error('improvement regression or not improved vs frozen control');
      }
      return advance(entry, 'benchmark', 'compare_with_frozen_control', { comparison });
    },

    async securityCheck({ proposalId, result }) {
      if (result?.passed !== true) throw new Error('improvement security check failed');
      const findings = Array.isArray(result.findings) ? result.findings : null;
      if (!findings) throw new TypeError('security findings must be an array');
      if (findings.length > 0) {
        throw new Error('improvement security check failed: findings present');
      }
      const entry = get(proposalId);
      if ((entry.benchmark?.securityFindings ?? 0) > 0) {
        throw new Error('improvement security check failed: benchmark reported securityFindings');
      }
      return advance(entry, 'compare_with_frozen_control', 'security_check', {
        security: Object.freeze({ passed: true, findings: Object.freeze([]) }),
      });
    },

    async qr18Validate({ proposalId, result }) {
      const qr18 = evaluateImprovementQr18(result);
      if (!qr18.verified) {
        throw new Error(`improvement QR18 validation failed: ${qr18.reasons.join('; ')}`);
      }
      return advance(get(proposalId), 'security_check', 'qr18_validation', { qr18 });
    },

    async approve({ proposalId, actor }) {
      const entry = get(proposalId);
      const approver = assertImprovementApprover(actor);
      if (approver === entry.proposedBy) {
        throw new Error('improvement self-approval forbidden: proposer cannot approve');
      }
      return advance(entry, 'qr18_validation', 'approve', { approvedBy: approver });
    },

    async deploy({ proposalId, actor }) {
      const entry = get(proposalId);
      const deployer = assertImprovementDeployer(actor);
      if (entry.approvedBy == null) throw new Error('improvement deploy requires approval');
      if (deployer === entry.proposedBy) {
        throw new Error('improvement self-deploy forbidden: proposer cannot deploy');
      }
      if (deployer === entry.approvedBy) {
        throw new Error('improvement approve-and-deploy by same actor forbidden');
      }
      return advance(entry, 'approve', 'deploy', {
        deployedBy: deployer,
        production: true,
      });
    },

    async deployToProduction(payload = {}) {
      assertCannotSelfDeclareProduction({
        ...payload,
        production: true,
        selfDeclaredBetter: payload.selfDeclaredBetter === true || payload.claim === 'better',
        claim: payload.claim ?? (payload.selfDeclaredBetter ? 'better' : undefined),
      });
    },

    async monitor({ proposalId, actor, observation }) {
      assertMonitorActor(actor);
      const entry = get(proposalId);
      if (entry.stage !== 'deploy' && entry.stage !== 'monitor') {
        throw new Error('monitor requires deployed proposal');
      }
      if (entry.stage === 'deploy') assertImprovementStageOrder('deploy', 'monitor');
      const updated = Object.freeze({
        ...entry,
        stage: 'monitor',
        observation: Object.freeze({ ...observation }),
        monitoredBy: requiredText(actor, 'actor'),
        updatedAt: now(),
      });
      proposals.set(entry.id, updated);
      return updated;
    },

    async rollbackIfRequired({ proposalId, actor }) {
      const deployer = assertImprovementDeployer(actor);
      const entry = get(proposalId);
      if (entry.stage !== 'monitor') throw new Error('rollback requires monitor stage');
      assertImprovementStageOrder('monitor', 'rollback_if_required');
      const needsRollback = entry.observation?.healthy === false;
      if (!needsRollback) {
        const steady = Object.freeze({
          ...entry,
          stage: 'rollback_if_required',
          rolledBack: false,
          production: true,
          updatedAt: now(),
        });
        proposals.set(entry.id, steady);
        return steady;
      }
      const rolled = Object.freeze({
        ...entry,
        stage: 'rollback_if_required',
        rolledBack: true,
        production: false,
        rolledBackBy: deployer,
        updatedAt: now(),
      });
      proposals.set(entry.id, rolled);
      return rolled;
    },

    async runPipeline({
      proposal,
      benchmark,
      control,
      security,
      qr18,
      approver,
      deployer,
    }) {
      const submitted = await this.propose(proposal);
      await this.enterSandbox({ proposalId: submitted.id });
      await this.benchmark({ proposalId: submitted.id, result: benchmark });
      await this.compareWithFrozenControl({ proposalId: submitted.id, control });
      await this.securityCheck({ proposalId: submitted.id, result: security });
      await this.qr18Validate({ proposalId: submitted.id, result: qr18 });
      await this.approve({ proposalId: submitted.id, actor: approver });
      return this.deploy({ proposalId: submitted.id, actor: deployer });
    },

    get(proposalId) {
      return get(proposalId);
    },

    list() {
      return Object.freeze([...proposals.values()]);
    },
  });
}
