/**
 * Hostile closes for OPEN holes from dual audit:
 * 1) Symbol.for brand forge → WeakSet instance brand REJECT
 * 2) Revoked identity learning/improvement writes → assertActive REJECT
 * 3) Method-shape improvement injection → branded factory REJECT
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createMissionStore } from '../../packages/mission/src/mission-store.js';
import { createAgentIdentityRegistry } from '../../packages/identity/src/agent-identity-registry.js';
import { createGatedLearningPipeline } from '../../packages/learning/src/gated-learning-pipeline.js';
import { createSelfImprovementSandbox } from '../../packages/improvement/src/self-improvement-sandbox.js';

function clock() {
  return '2026-09-05T15:00:00.000Z';
}

test('CLOSED: Symbol.for brand forge is rejected (WeakSet instance brand)', async () => {
  const BRAND = Symbol.for('athere.distributedMissionStore');
  const root = await mkdtemp(path.join(tmpdir(), 'athere-probe-brand-'));
  const forged = {
    [BRAND]: true,
    async loadMission() { return { revision: 1, mission: { id: 'x' } }; },
    async saveMission({ mission }) { return { revision: 1, mission }; },
    async loadMissionReplica() {
      return { revision: 1, mission: { id: 'x' }, authoritative: true, role: 'primary' };
    },
    topology() {
      return { singleWriter: false, multiMaster: true, crdtAuthorityMerge: true };
    },
    listStateEvents() { return []; },
    resolveShard() { return 'shard-0'; },
  };

  assert.throws(
    () => createMissionStateService({
      root,
      store: createMissionStore(),
      distributed: forged,
      clock,
    }),
    /branded distributedMissionStore/,
  );
});

test('CLOSED: revoked identity cannot submit learning or propose improvements', async () => {
  const identities = createAgentIdentityRegistry();
  const learning = createGatedLearningPipeline({ now: clock, identities });
  const improvement = createSelfImprovementSandbox({ now: clock, identities });
  identities.revoke('nyx', { revokedAt: clock(), reason: 'compromised' });

  await assert.rejects(
    () => learning.submitExperience({
      id: 'exp-probe-revoked',
      missionId: 'mission-probe',
      actor: 'nyx',
      summary: 'still writing',
      outcome: 'success',
    }),
    /revoked/,
  );
  await assert.rejects(
    () => improvement.propose({
      id: 'imp-probe-revoked',
      target: 'code',
      summary: 'still proposing',
      change: { patch: 'x' },
      proposedBy: 'nyx',
    }),
    /revoked/,
  );
});

test('CLOSED: method-shape improvement injection is rejected', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-probe-imp-'));
  const fakeImprovement = {
    async runPipeline() {
      return {
        stage: 'deploy',
        production: true,
        proposedBy: 'nyx',
        approvedBy: 'nyx',
        deployedBy: 'nyx',
      };
    },
    async deployToProduction() {
      return { production: true, selfDeclaredBetter: true };
    },
    list() { return []; },
  };
  assert.throws(
    () => createMissionStateService({ root, improvement: fakeImprovement, clock }),
    /branded selfImprovementSandbox/,
  );
});

test('CLOSED: method-shape learning injection is rejected', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-probe-learn-'));
  const fakeLearning = {
    async runPipeline() { return { stage: 'measure', id: 'forged' }; },
    async storePermanent() { return { stage: 'store', id: 'forged-permanent' }; },
    listPermanent() { return []; },
  };
  assert.throws(
    () => createMissionStateService({ root, learning: fakeLearning, clock }),
    /branded gatedLearningPipeline/,
  );
});
